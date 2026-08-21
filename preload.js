const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    save: (data) => ipcRenderer.invoke('save-db', data),
    load: () => ipcRenderer.invoke('load-db'),
    saveImage: (fileName, base64Data) => ipcRenderer.invoke('save-image', fileName, base64Data),
    notify: (title, body) => ipcRenderer.invoke('notify', title, body),
    sendEmail: (details) => ipcRenderer.invoke('send-email', details),
    savePdfReport: (details) => ipcRenderer.invoke('save-pdf-report', details),
    emailPdfReport: (details) => ipcRenderer.invoke('email-pdf-report', details),
    backupData: (data) => ipcRenderer.invoke('backup-data', data),
    archiveData: (payload) => ipcRenderer.invoke('archive-data', payload),
    restoreData: () => ipcRenderer.invoke('restore-data'),
    getDataLocation: () => ipcRenderer.invoke('get-data-location'),
    chooseSyncFolder: () => ipcRenderer.invoke('choose-sync-folder'),
    useDefaultDataFolder: () => ipcRenderer.invoke('use-default-data-folder')
});
