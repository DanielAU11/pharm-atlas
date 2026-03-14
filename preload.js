const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    save: (data) => ipcRenderer.invoke('save-db', data),
    load: () => ipcRenderer.invoke('load-db'),
    saveImage: (fileName, base64Data) => ipcRenderer.invoke('save-image', fileName, base64Data),
    notify: (title, body) => ipcRenderer.invoke('notify', title, body),
    sendEmail: (details) => ipcRenderer.invoke('send-email', details)
});
