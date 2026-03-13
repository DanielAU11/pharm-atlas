const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
app.setAppUserModelId("com.pharmatlas.app"); 

const dataDir = path.join(app.getPath('desktop'), 'PharmAtlasData');
const dbPath = path.join(dataDir, 'db.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function createWindow() {
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    const win = new BrowserWindow({
        width: width, // Full width
        height: height, // Full height
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    win.loadFile('index.html');
}




ipcMain.handle('save-db', (event, data) => {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    return true;
});

ipcMain.handle('load-db', () => {
    if (!fs.existsSync(dbPath)) return { family: [], inventory: [], schedules: [], history: [], recipes: [] };
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data);
});

ipcMain.handle('save-image', (event, fileName, base64Data) => {
    const imagePath = path.join(dataDir, fileName);
    fs.writeFileSync(imagePath, base64Data, 'base64');
    return imagePath;
});

app.whenReady().then(() => {
    // 1. Register IPC handlers FIRST
    ipcMain.handle('notify', (event, title, body) => {
        new Notification({ title, body }).show();
    });

    // 2. Then create the window
    createWindow();
});
