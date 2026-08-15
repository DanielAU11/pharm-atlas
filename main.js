const { app, BrowserWindow, ipcMain, Notification, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

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
const emailConfigPath = path.join(defaultDataDir, 'email-config.json');
let lastKnownDbMtimeMs = 0;
let lastKnownDbFingerprint = '';

function dbFingerprintFromText(text) {
    return crypto.createHash('sha256').update(String(text || '').replace(/^\uFEFF/, '')).digest('hex');
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
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
        pass: process.env.PHARMATLAS_EMAIL_APP_PASSWORD || savedConfig.appPassword || savedConfig.pass || ''
    };
}

const emailConfig = loadEmailConfig();
const transporter = emailConfig.user && emailConfig.pass
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: emailConfig
    })
    : null;

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
            error: 'Email is not configured. Add email-config.json to the PharmAtlasData folder.'
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

ipcMain.handle('save-db', (event, data) => {
    const conflictBackup = preserveDbConflictBackupIfNeeded();
    writeDbToPath(dbPath, data);
    return { success: true, conflictBackup };
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
            error: 'Email is not configured. Add email-config.json to the PharmAtlasData folder.'
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

app.whenReady().then(createWindow);

// Handle app quitting properly
app.on('before-quit', () => {
    app.isQuiting = true;
});
