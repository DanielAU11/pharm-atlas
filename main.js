const { app, BrowserWindow, ipcMain, Notification, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const os = require('os');
const nodemailer = require('nodemailer');
const SyncCore = require('./sync-core');

if (require('electron-squirrel-startup')) app.quit();

// Keep source runs isolated from the installed app so an older background
// process cannot capture the dev launch or lock Chromium's cache.
const runtimeProfileName = app.isPackaged ? 'PharmAtlas' : 'PharmAtlas-Dev';
const localAppData = process.env.LOCALAPPDATA || app.getPath('appData');
const runtimeDataDir = path.join(localAppData, runtimeProfileName);
const sessionDataDir = path.join(runtimeDataDir, 'SessionData');
const cacheDir = path.join(runtimeDataDir, 'Cache');
fs.mkdirSync(sessionDataDir, { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });
app.setPath('userData', runtimeDataDir);
app.setPath('sessionData', sessionDataDir);
app.commandLine.appendSwitch('disk-cache-dir', cacheDir);

let win;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    });
}

app.setAppUserModelId(app.isPackaged ? 'com.squirrel.pharm-atlas.PharmAtlas' : 'PharmAtlas');

const defaultDataDir = path.join(app.getPath('desktop'), 'PharmAtlasData');
const dataLocationConfigPath = path.join(runtimeDataDir, 'data-location.json');
let dataDir = loadDataDirSetting();
let dbPath = path.join(dataDir, 'db.json');
const emailConfigPath = path.join(runtimeDataDir, 'email-config.json');
const localSyncConfigPath = path.join(runtimeDataDir, 'local-sync.json');
let lastKnownDbMtimeMs = 0;
let lastKnownDbFingerprint = '';
let localSyncServer = null;
let localSyncState = loadLocalSyncConfig();
const localSyncNonces = new Map();

function dbFingerprintFromText(text) {
    return crypto.createHash('sha256').update(String(text || '').replace(/^\uFEFF/, '')).digest('hex');
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function randomBase64Url(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
}

function loadLocalSyncConfig() {
    try {
        if (fs.existsSync(localSyncConfigPath)) {
            const saved = JSON.parse(fs.readFileSync(localSyncConfigPath, 'utf8').replace(/^\uFEFF/, ''));
            return {
                enabled: saved.enabled === true,
                deviceId: saved.deviceId || `desktop-${crypto.randomUUID()}`,
                key: saved.key || randomBase64Url(),
                port: Number(saved.port) || 43127,
                pairedAt: saved.pairedAt || ''
            };
        }
    } catch (error) {
        console.error('Unable to read local sync configuration:', error.message);
    }
    return { enabled: false, deviceId: `desktop-${crypto.randomUUID()}`, key: randomBase64Url(), port: 43127, pairedAt: '' };
}

function saveLocalSyncConfig() {
    ensureDir(runtimeDataDir);
    fs.writeFileSync(localSyncConfigPath, JSON.stringify(localSyncState, null, 2));
}

function desktopDeviceId() {
    return localSyncState.deviceId;
}

function loadDataDirSetting() {
    try {
        if (fs.existsSync(dataLocationConfigPath)) {
            const saved = JSON.parse(fs.readFileSync(dataLocationConfigPath, 'utf8').replace(/^\uFEFF/, ''));
            if (saved?.dataDir && path.isAbsolute(saved.dataDir)) return saved.dataDir;
        }
    } catch (error) {
        console.error('Unable to read PharmAtlas data location setting:', error.message);
    }
    return defaultDataDir;
}

function saveDataDirSetting(nextDataDir) {
    ensureDir(runtimeDataDir);
    fs.writeFileSync(dataLocationConfigPath, JSON.stringify({
        dataDir: nextDataDir,
        updatedAt: new Date().toISOString()
    }, null, 2));
}

function clearDataDirSetting() {
    try {
        if (fs.existsSync(dataLocationConfigPath)) fs.unlinkSync(dataLocationConfigPath);
    } catch (error) {
        console.error('Unable to clear data location setting:', error.message);
    }
}

function setActiveDataDir(nextDataDir) {
    dataDir = nextDataDir;
    dbPath = path.join(dataDir, 'db.json');
    ensureDir(dataDir);
}

function isEmptyDbData(data) {
    if (!data || typeof data !== 'object') return true;
    const keys = ['family', 'inventory', 'schedules', 'history', 'recipes', 'compoundPreps', 'vitals', 'orderSets', 'prescribers', 'prepackQueues', 'formularyItems', 'inventoryOrders', 'medKits'];
    return keys.every(key => !Array.isArray(data[key]) || data[key].length === 0);
}

function defaultEmptyDb() {
    return {
        family: [],
        inventory: [],
        schedules: [],
        history: [],
        recipes: [],
        compoundPreps: [],
        vitals: [],
        orderSets: [],
        prescribers: [],
        reminderLog: [],
        prepackQueues: [],
        formularyItems: [],
        inventoryOrders: [],
        medKits: [],
        auditTrail: [],
        settings: {}
    };
}

function readDbFromPath(filePath) {
    if (!fs.existsSync(filePath)) return defaultEmptyDb();
    const rawData = fs.readFileSync(filePath, 'utf8');
    const data = rawData.replace(/^\uFEFF/, '');
    try {
        if (path.resolve(filePath) === path.resolve(dbPath)) {
            lastKnownDbMtimeMs = fs.statSync(filePath).mtimeMs;
            lastKnownDbFingerprint = dbFingerprintFromText(rawData);
        }
    } catch (error) {
        console.error('Unable to read database timestamp:', error.message);
    }
    return JSON.parse(data);
}

function writeDbToPath(filePath, data) {
    ensureDir(path.dirname(filePath));
    const serialized = JSON.stringify(data || defaultEmptyDb(), null, 2);
    fs.writeFileSync(filePath, serialized);
    try {
        if (path.resolve(filePath) === path.resolve(dbPath)) {
            lastKnownDbMtimeMs = fs.statSync(filePath).mtimeMs;
            lastKnownDbFingerprint = dbFingerprintFromText(serialized);
        }
    } catch (error) {
        console.error('Unable to update database timestamp:', error.message);
    }
}

function preserveDbConflictBackupIfNeeded() {
    if (!fs.existsSync(dbPath)) return null;
    try {
        const currentMtime = fs.statSync(dbPath).mtimeMs;
        if (lastKnownDbMtimeMs && currentMtime > lastKnownDbMtimeMs + 1000) {
            const currentText = fs.readFileSync(dbPath, 'utf8');
            const currentFingerprint = dbFingerprintFromText(currentText);
            if (lastKnownDbFingerprint && currentFingerprint === lastKnownDbFingerprint) {
                lastKnownDbMtimeMs = currentMtime;
                return null;
            }
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            const backupPath = path.join(dataDir, `db_conflict_backup_${stamp}.json`);
            fs.copyFileSync(dbPath, backupPath);
            lastKnownDbFingerprint = currentFingerprint;
            return backupPath;
        }
    } catch (error) {
        console.error('Unable to preserve conflict backup:', error.message);
    }
    return null;
}

function copyImagesIntoDataDir(data, targetDir) {
    if (!Array.isArray(data?.inventory)) return data;
    data.inventory.forEach((med, index) => {
        if (!med?.imagePath || /^https?:\/\//i.test(med.imagePath) || !fs.existsSync(med.imagePath)) return;
        const original = med.imagePath;
        const extension = path.extname(original) || '.png';
        const targetName = safeAssetFileName(`${path.basename(original, extension)}_${med.id || index}${extension}`);
        const targetPath = path.join(targetDir, targetName);
        try {
            if (path.resolve(original) !== path.resolve(targetPath)) fs.copyFileSync(original, targetPath);
            med.imagePath = targetPath;
        } catch (error) {
            console.error('Unable to copy medication image into synced data folder:', error.message);
        }
    });
    return data;
}

function normalizeSyncTargetFolder(selectedFolder) {
    const baseName = path.basename(selectedFolder).toLowerCase();
    return baseName === 'pharmatlasdata'
        ? selectedFolder
        : path.join(selectedFolder, 'PharmAtlasData');
}

ensureDir(defaultDataDir);
ensureDir(dataDir);

function loadEmailConfig() {
    let savedConfig = {};
    try {
        if (fs.existsSync(emailConfigPath)) {
            savedConfig = JSON.parse(fs.readFileSync(emailConfigPath, 'utf8').replace(/^\uFEFF/, ''));
        }
    } catch (error) {
        console.error('Unable to read local email configuration:', error.message);
    }

    return {
        user: process.env.PHARMATLAS_EMAIL_USER || savedConfig.user || '',
        pass: process.env.PHARMATLAS_EMAIL_APP_PASSWORD || savedConfig.appPassword || savedConfig.pass || '',
        host: savedConfig.host || 'smtp.gmail.com',
        port: Number(savedConfig.port) || 465,
        secure: savedConfig.secure !== false
    };
}

let emailConfig = loadEmailConfig();
let transporter = createEmailTransporter(emailConfig);

function createEmailTransporter(config) {
    if (!config?.user || !config?.pass) return null;
    return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.pass }
    });
}

function emailStatus() {
    return {
        configured: !!transporter,
        user: emailConfig.user || '',
        host: emailConfig.host || '',
        port: emailConfig.port || 465,
        secure: emailConfig.secure !== false
    };
}

function privateIpv4Addresses() {
    const addresses = [];
    Object.values(os.networkInterfaces()).flat().forEach(entry => {
        if (!entry || entry.internal || entry.family !== 'IPv4') return;
        if (/^(169\.254|127\.)/.test(entry.address)) return;
        addresses.push(entry.address);
    });
    return addresses.sort((a, b) => {
        const privateA = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a) ? 0 : 1;
        const privateB = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(b) ? 0 : 1;
        return privateA - privateB;
    });
}

function localSyncKeyBuffer() {
    return Buffer.from(localSyncState.key, 'base64url');
}

function encryptLocalSyncPayload(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', localSyncKeyBuffer(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return {
        iv: iv.toString('base64url'),
        data: encrypted.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url')
    };
}

function decryptLocalSyncPayload(envelope) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', localSyncKeyBuffer(), Buffer.from(envelope.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64url')),
        decipher.final()
    ]).toString('utf8'));
}

function localSyncSignature(method, requestPath, timestamp, nonce, body) {
    return crypto.createHmac('sha256', localSyncKeyBuffer())
        .update([method.toUpperCase(), requestPath, timestamp, nonce, body].join('\n'))
        .digest('base64url');
}

function timingSafeTextEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function localSyncRequestIsAuthorized(request, body) {
    const timestamp = String(request.headers['x-pharmatlas-timestamp'] || '');
    const nonce = String(request.headers['x-pharmatlas-nonce'] || '');
    const signature = String(request.headers['x-pharmatlas-signature'] || '');
    const timestampMs = Number(timestamp);
    if (!timestamp || !nonce || !signature || !Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 120000) return false;
    const nonceKey = `${timestamp}|${nonce}`;
    if (localSyncNonces.has(nonceKey)) return false;
    const expected = localSyncSignature(request.method, request.url, timestamp, nonce, body);
    if (!timingSafeTextEqual(signature, expected)) return false;
    localSyncNonces.set(nonceKey, Date.now());
    for (const [key, seenAt] of localSyncNonces) {
        if (Date.now() - seenAt > 180000) localSyncNonces.delete(key);
    }
    return true;
}

function localSyncCorsHeaders(request) {
    const origin = String(request.headers.origin || '');
    const allowed = !origin || origin === 'capacitor://localhost' || origin === 'http://localhost' || origin === 'https://localhost';
    return {
        'Access-Control-Allow-Origin': allowed && origin ? origin : 'capacitor://localhost',
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-PharmAtlas-Timestamp, X-PharmAtlas-Nonce, X-PharmAtlas-Signature',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    };
}

function sendLocalSyncJson(response, request, status, value) {
    const body = JSON.stringify(value);
    response.writeHead(status, { ...localSyncCorsHeaders(request), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    response.end(body);
}

function preserveMobileSyncBackup() {
    if (!fs.existsSync(dbPath)) return '';
    const backupDir = path.join(dataDir, 'sync-backups');
    ensureDir(backupDir);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const target = path.join(backupDir, `db_before_mobile_sync_${stamp}.json`);
    fs.copyFileSync(dbPath, target);
    return target;
}

async function handleLocalSyncRequest(request, response) {
    if (request.method === 'OPTIONS') {
        response.writeHead(204, localSyncCorsHeaders(request));
        return response.end();
    }
    const expectedPrefix = `/pharmatlas-sync/${encodeURIComponent(localSyncState.deviceId)}/`;
    if (request.method !== 'POST' || !request.url?.startsWith(expectedPrefix)) return sendLocalSyncJson(response, request, 404, { error: 'Not found' });
    let body = '';
    for await (const chunk of request) {
        body += chunk;
        if (body.length > 25 * 1024 * 1024) {
            request.destroy();
            return;
        }
    }
    if (!localSyncRequestIsAuthorized(request, body)) return sendLocalSyncJson(response, request, 401, { error: 'Pairing credentials were rejected.' });
    try {
        const payload = decryptLocalSyncPayload(JSON.parse(body));
        if (request.url.endsWith('/pull')) {
            const data = readDbFromPath(dbPath);
            return sendLocalSyncJson(response, request, 200, encryptLocalSyncPayload({
                protocol: 1,
                desktopName: os.hostname(),
                revision: dbFingerprintFromText(JSON.stringify(data)),
                data
            }));
        }
        if (request.url.endsWith('/push')) {
            if (!payload?.data || typeof payload.data !== 'object') throw new Error('The phone did not send a valid database.');
            const current = readDbFromPath(dbPath);
            const merged = SyncCore.mergeDatabases(current, payload.data, desktopDeviceId());
            const currentFingerprint = dbFingerprintFromText(JSON.stringify(current));
            const mergedFingerprint = dbFingerprintFromText(JSON.stringify(merged));
            let backupPath = '';
            if (currentFingerprint !== mergedFingerprint) {
                backupPath = preserveMobileSyncBackup();
                writeDbToPath(dbPath, merged);
                localSyncState.pairedAt = localSyncState.pairedAt || new Date().toISOString();
                saveLocalSyncConfig();
                win?.webContents.send('db-updated-from-mobile', { deviceName: payload.deviceName || 'iPhone or iPad', backupPath });
            }
            return sendLocalSyncJson(response, request, 200, encryptLocalSyncPayload({
                protocol: 1,
                revision: dbFingerprintFromText(JSON.stringify(merged)),
                changed: currentFingerprint !== mergedFingerprint,
                data: merged
            }));
        }
        return sendLocalSyncJson(response, request, 404, { error: 'Unknown sync action.' });
    } catch (error) {
        console.error('Local companion sync failed:', error.message);
        return sendLocalSyncJson(response, request, 400, { error: 'Unable to decrypt or merge this companion sync request.' });
    }
}

function localSyncPairingInfo() {
    const host = privateIpv4Addresses()[0] || '';
    if (!host || !localSyncServer) return { enabled: !!localSyncServer, available: false, error: 'Connect this desktop to the same Wi-Fi network as the iPhone or iPad.' };
    const payload = new URL('pharmatlas-sync://pair');
    payload.searchParams.set('v', '1');
    payload.searchParams.set('host', host);
    payload.searchParams.set('port', String(localSyncState.port));
    payload.searchParams.set('id', localSyncState.deviceId);
    payload.searchParams.set('key', localSyncState.key);
    payload.searchParams.set('name', os.hostname());
    return {
        enabled: true,
        available: true,
        host,
        port: localSyncState.port,
        deviceId: localSyncState.deviceId,
        pairingPayload: payload.toString(),
        pairedAt: localSyncState.pairedAt || ''
    };
}

function startLocalSyncServer() {
    if (localSyncServer) return Promise.resolve(localSyncPairingInfo());
    const listen = port => new Promise((resolve, reject) => {
        const server = http.createServer((request, response) => handleLocalSyncRequest(request, response));
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () => {
            server.removeListener('error', reject);
            server.on('error', error => console.error('Local companion sync server error:', error.message));
            localSyncServer = server;
            localSyncState.enabled = true;
            localSyncState.port = server.address().port;
            saveLocalSyncConfig();
            resolve(localSyncPairingInfo());
        });
    });
    const preferredPort = localSyncState.port || 43127;
    return listen(preferredPort).catch(error => {
        if (error?.code !== 'EADDRINUSE') throw error;
        console.warn(`Local sync port ${preferredPort} is already in use; selecting another local port.`);
        return listen(0);
    });
}

function stopLocalSyncServer() {
    return new Promise(resolve => {
        localSyncState.enabled = false;
        saveLocalSyncConfig();
        if (!localSyncServer) return resolve(true);
        const server = localSyncServer;
        localSyncServer = null;
        server.close(() => resolve(true));
    });
}

function createWindow() {
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    const appIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'pharmatlas.ico'));

    win = new BrowserWindow({
        width: width,
        height: height,
        icon: appIcon,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
        }
    });

    win.loadFile('index.html');
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (level >= 2) {
            console.error(`[renderer] ${message} (${sourceId}:${line})`);
        }
    });

    // FIX: Close logic must be inside createWindow so 'win' is defined
    win.on('close', function (event) {
        if (!app.isQuiting) {
            event.preventDefault();
            win.hide();
        }
        return false;
    });
}

// 2. Email Function with better error logging
async function sendEmailNotification(recipient, subject, text) {
    if (!transporter) {
        return {
            success: false,
            error: 'Desktop email is not configured. Open Desktop Email Setup and enter your own sender account.'
        };
    }

    console.log(`Attempting to send email to: ${recipient}`);
    const mailOptions = {
        from: emailConfig.user,
        to: recipient,
        subject: subject,
        text: text
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully: ' + info.response);
        return { success: true };
    } catch (error) {
        console.error("NodeMailer Error Details:", error);
        return { success: false, error: error.message };
    }
}

function safePdfFileName(fileName) {
    const safeName = String(fileName || `PharmAtlas_Report_${Date.now()}.pdf`)
        .replace(/[<>:"/\\|?*]+/g, '_');
    return safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
}

function safeJsonFileName(fileName) {
    const safeName = String(fileName || `PharmAtlas_Backup_${Date.now()}.json`)
        .replace(/[<>:"/\\|?*]+/g, '_');
    return safeName.toLowerCase().endsWith('.json') ? safeName : `${safeName}.json`;
}

function safeAssetFileName(fileName) {
    return String(fileName || `asset_${Date.now()}`)
        .replace(/[<>:"/\\|?*]+/g, '_');
}

async function renderPdfBuffer(html) {
    const reportWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    try {
        await reportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        return await reportWindow.webContents.printToPDF({
            printBackground: true,
            pageSize: 'Letter',
            margins: { marginType: 'default' }
        });
    } finally {
        reportWindow.destroy();
    }
}

// 3. IPC Handlers
ipcMain.handle('send-email', async (event, { to, subject, body }) => {
    return await sendEmailNotification(to, subject, body);
});

ipcMain.handle('get-email-status', () => emailStatus());

ipcMain.handle('configure-email', async (event, config) => {
    const next = {
        user: String(config?.user || '').trim(),
        appPassword: String(config?.pass || ''),
        host: String(config?.host || 'smtp.gmail.com').trim(),
        port: Number(config?.port) || 465,
        secure: config?.secure !== false
    };
    if (!next.user || !next.appPassword || !next.host) return { success: false, error: 'Enter your sender email, SMTP host, and app password.' };
    const candidate = createEmailTransporter({ ...next, pass: next.appPassword });
    try {
        await candidate.verify();
        ensureDir(runtimeDataDir);
        fs.writeFileSync(emailConfigPath, JSON.stringify(next, null, 2));
        emailConfig = { ...next, pass: next.appPassword };
        transporter = candidate;
        return { success: true, status: emailStatus() };
    } catch (error) {
        candidate.close?.();
        return { success: false, error: `The SMTP account could not be verified: ${error.message}` };
    }
});

ipcMain.handle('get-local-sync-status', () => localSyncPairingInfo());
ipcMain.handle('start-local-sync', () => startLocalSyncServer());
ipcMain.handle('stop-local-sync', () => stopLocalSyncServer());
ipcMain.handle('reset-local-sync-pairing', async () => {
    await stopLocalSyncServer();
    localSyncState = { enabled: false, deviceId: `desktop-${crypto.randomUUID()}`, key: randomBase64Url(), port: 43127, pairedAt: '' };
    saveLocalSyncConfig();
    return startLocalSyncServer();
});

ipcMain.handle('save-db', (event, data) => {
    const conflictBackup = preserveDbConflictBackupIfNeeded();
    const current = readDbFromPath(dbPath);
    const prepared = SyncCore.prepareDatabase(current, data, desktopDeviceId());
    writeDbToPath(dbPath, prepared);
    return { success: true, conflictBackup, revision: dbFingerprintFromText(JSON.stringify(prepared)) };
});

ipcMain.handle('load-db', () => {
    return readDbFromPath(dbPath);
});

ipcMain.handle('get-data-location', () => ({
    dataDir,
    dbPath,
    defaultDataDir,
    usingDefault: path.resolve(dataDir) === path.resolve(defaultDataDir)
}));

ipcMain.handle('choose-sync-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
        title: 'Choose OneDrive, Google Drive Desktop, or another synced folder',
        properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths?.[0]) return null;

    const nextDataDir = normalizeSyncTargetFolder(result.filePaths[0]);
    ensureDir(nextDataDir);
    const nextDbPath = path.join(nextDataDir, 'db.json');
    const currentDb = readDbFromPath(dbPath);
    const folderDbExists = fs.existsSync(nextDbPath);
    let mode = 'copy-current';

    if (folderDbExists && path.resolve(nextDbPath) !== path.resolve(dbPath) && !isEmptyDbData(readDbFromPath(nextDbPath))) {
        const choice = await dialog.showMessageBox(win, {
            type: 'question',
            title: 'PharmAtlas Data Found',
            message: 'This folder already has PharmAtlas data. Which file should this desktop use?',
            detail: `Folder:\n${nextDataDir}`,
            buttons: ['Copy current data into this folder', 'Use data already in this folder', 'Cancel'],
            defaultId: 0,
            cancelId: 2
        });
        if (choice.response === 2) return null;
        mode = choice.response === 1 ? 'use-folder' : 'copy-current';
    }

    if (mode === 'copy-current') {
        const migratedDb = copyImagesIntoDataDir(JSON.parse(JSON.stringify(currentDb)), nextDataDir);
        writeDbToPath(nextDbPath, migratedDb);
    }

    saveDataDirSetting(nextDataDir);
    setActiveDataDir(nextDataDir);
    return {
        dataDir,
        dbPath,
        defaultDataDir,
        usingDefault: false,
        data: readDbFromPath(dbPath)
    };
});

ipcMain.handle('use-default-data-folder', async () => {
    const currentDb = readDbFromPath(dbPath);
    const defaultDbPath = path.join(defaultDataDir, 'db.json');
    let mode = 'copy-current';

    if (path.resolve(dataDir) !== path.resolve(defaultDataDir) && fs.existsSync(defaultDbPath) && !isEmptyDbData(readDbFromPath(defaultDbPath))) {
        const choice = await dialog.showMessageBox(win, {
            type: 'question',
            title: 'Use Local Data Folder',
            message: 'The default desktop PharmAtlasData folder already has data.',
            detail: `Default folder:\n${defaultDataDir}`,
            buttons: ['Copy current data there', 'Use data already there', 'Cancel'],
            defaultId: 0,
            cancelId: 2
        });
        if (choice.response === 2) return null;
        mode = choice.response === 1 ? 'use-folder' : 'copy-current';
    }

    if (mode === 'copy-current') {
        const migratedDb = copyImagesIntoDataDir(JSON.parse(JSON.stringify(currentDb)), defaultDataDir);
        writeDbToPath(defaultDbPath, migratedDb);
    }

    clearDataDirSetting();
    setActiveDataDir(defaultDataDir);
    return {
        dataDir,
        dbPath,
        defaultDataDir,
        usingDefault: true,
        data: readDbFromPath(dbPath)
    };
});

ipcMain.handle('backup-data', async (event, data) => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const result = await dialog.showSaveDialog(win, {
        title: 'Save PharmAtlas Backup',
        defaultPath: path.join(dataDir, safeJsonFileName(`PharmAtlas_Backup_${stamp}.json`)),
        filters: [{ name: 'PharmAtlas Backup', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return null;
    const images = [];
    (data?.inventory || []).forEach(med => {
        const imagePath = med?.imagePath;
        if (!imagePath || !fs.existsSync(imagePath)) return;
        try {
            images.push({
                originalPath: imagePath,
                fileName: safeAssetFileName(path.basename(imagePath)),
                base64: fs.readFileSync(imagePath).toString('base64')
            });
        } catch (error) {
            console.error('Unable to add image to backup:', error.message);
        }
    });
    const payload = {
        app: 'PharmAtlas',
        backupVersion: 1,
        createdAt: new Date().toISOString(),
        images,
        data
    };
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2));
    return result.filePath;
});

ipcMain.handle('archive-data', async (event, payload) => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const result = await dialog.showSaveDialog(win, {
        title: 'Save PharmAtlas Archive',
        defaultPath: path.join(dataDir, safeJsonFileName(`PharmAtlas_Archive_${stamp}.json`)),
        filters: [{ name: 'PharmAtlas Archive', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, JSON.stringify({
        app: 'PharmAtlas',
        archiveVersion: 1,
        createdAt: new Date().toISOString(),
        payload
    }, null, 2));
    return result.filePath;
});

ipcMain.handle('restore-data', async () => {
    const result = await dialog.showOpenDialog(win, {
        title: 'Restore PharmAtlas Backup',
        properties: ['openFile'],
        filters: [{ name: 'PharmAtlas Backup', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    const raw = fs.readFileSync(result.filePaths[0], 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    const restored = parsed && parsed.app === 'PharmAtlas' && parsed.data ? parsed.data : parsed;
    if (parsed?.images?.length && Array.isArray(restored?.inventory)) {
        const pathMap = new Map();
        parsed.images.forEach((image, index) => {
            if (!image?.base64 || !image.originalPath) return;
            const fileName = safeAssetFileName(image.fileName || `restored_image_${index}.png`);
            const targetPath = path.join(dataDir, fileName);
            try {
                fs.writeFileSync(targetPath, image.base64, 'base64');
                pathMap.set(image.originalPath, targetPath);
            } catch (error) {
                console.error('Unable to restore image from backup:', error.message);
            }
        });
        restored.inventory.forEach(med => {
            if (pathMap.has(med.imagePath)) med.imagePath = pathMap.get(med.imagePath);
        });
    }
    fs.writeFileSync(dbPath, JSON.stringify(restored, null, 2));
    return restored;
});

ipcMain.handle('save-image', (event, fileName, base64Data) => {
    const imagePath = path.join(dataDir, fileName);
    fs.writeFileSync(imagePath, base64Data, 'base64');
    return imagePath;
});

ipcMain.handle('save-pdf-report', async (event, { html, fileName }) => {
    const finalName = safePdfFileName(fileName);
    const pdfPath = path.join(dataDir, finalName);
    const pdfData = await renderPdfBuffer(html);
    fs.writeFileSync(pdfPath, pdfData);
    return pdfPath;
});

ipcMain.handle('email-pdf-report', async (event, { html, fileName, to, subject, body }) => {
    const finalName = safePdfFileName(fileName);
    if (!transporter) {
        return {
            success: false,
            error: 'Desktop email is not configured. Open Desktop Email Setup and enter your own sender account.'
        };
    }

    try {
        const pdfData = await renderPdfBuffer(html);
        await transporter.sendMail({
            from: emailConfig.user,
            to,
            subject,
            text: body,
            attachments: [{
                filename: finalName,
                content: pdfData,
                contentType: 'application/pdf'
            }]
        });
        return { success: true };
    } catch (error) {
        console.error("PDF Email Error Details:", error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('notify', (event, title, body) => {
    new Notification({ title, body }).show();
});

app.whenReady().then(async () => {
    createWindow();
    if (localSyncState.enabled) {
        try {
            await startLocalSyncServer();
        } catch (error) {
            console.error('Unable to resume local companion sync:', error.message);
        }
    }
});

// Handle app quitting properly
app.on('before-quit', () => {
    app.isQuiting = true;
    if (localSyncServer) {
        localSyncServer.close();
        localSyncServer = null;
    }
});
