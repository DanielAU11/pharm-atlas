const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

// 1. Setup Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'danielanthonyuribe@gmail.com',
        pass: 'nmjv lyav hzsh tkbo' // Ensure this is a 16-character App Password
    }
});

app.setAppUserModelId("com.pharmatlas.app"); 

const dataDir = path.join(app.getPath('desktop'), 'PharmAtlasData');
const dbPath = path.join(dataDir, 'db.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let win; 

function createWindow() {
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    win = new BrowserWindow({
        width: width,
        height: height,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    win.loadFile('index.html');

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
    console.log(`Attempting to send email to: ${recipient}`);
    const mailOptions = {
        from: 'danielanthonyuribe@gmail.com',
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

// 3. IPC Handlers
ipcMain.handle('send-email', async (event, { to, subject, body }) => {
    return await sendEmailNotification(to, subject, body);
});

ipcMain.handle('save-db', (event, data) => {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    return true;
});

ipcMain.handle('load-db', () => {
    if (!fs.existsSync(dbPath)) return { family: [], inventory: [], schedules: [], history: [] };
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data);
});

ipcMain.handle('save-image', (event, fileName, base64Data) => {
    const imagePath = path.join(dataDir, fileName);
    fs.writeFileSync(imagePath, base64Data, 'base64');
    return imagePath;
});

ipcMain.handle('save-pdf-report', async (event, { html, fileName }) => {
    const safeName = String(fileName || `PharmAtlas_Report_${Date.now()}.pdf`)
        .replace(/[<>:"/\\|?*]+/g, '_');
    const finalName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
    const pdfPath = path.join(dataDir, finalName);
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
        const pdfData = await reportWindow.webContents.printToPDF({
            printBackground: true,
            pageSize: 'Letter',
            margins: { marginType: 'default' }
        });
        fs.writeFileSync(pdfPath, pdfData);
        return pdfPath;
    } finally {
        reportWindow.destroy();
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
