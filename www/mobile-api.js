(function() {
    if (window.api) return;

    window.__PHARMATLAS_MOBILE__ = true;
    document.documentElement.classList.add('mobile-runtime');
    if (/iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
        document.documentElement.classList.add('ios-runtime');
    }

    const dbKey = 'pharmatlas-db';
    const emptyDb = { family: [], inventory: [], schedules: [], history: [], recipes: [], vitals: [], orderSets: [], prescribers: [], reminderLog: [], prepackQueues: [] };
    const indexedDbName = 'PharmAtlasMobile';
    const indexedDbStore = 'records';

    function openMobileDatabase() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
            const request = indexedDB.open(indexedDbName, 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(indexedDbStore)) request.result.createObjectStore(indexedDbStore);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('Unable to open mobile database'));
        });
    }

    async function readMobileRecord(key) {
        const database = await openMobileDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(indexedDbStore, 'readonly');
            const request = transaction.objectStore(indexedDbStore).get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('Unable to read mobile data'));
            transaction.oncomplete = () => database.close();
        });
    }

    async function writeMobileRecord(key, value) {
        const database = await openMobileDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(indexedDbStore, 'readwrite');
            transaction.objectStore(indexedDbStore).put(value, key);
            transaction.oncomplete = () => {
                database.close();
                resolve(true);
            };
            transaction.onerror = () => {
                database.close();
                reject(transaction.error || new Error('Unable to save mobile data'));
            };
        });
    }

    function getMimeType(fileName) {
        const lower = String(fileName || '').toLowerCase();
        if (lower.endsWith('.png')) return 'image/png';
        if (lower.endsWith('.gif')) return 'image/gif';
        if (lower.endsWith('.webp')) return 'image/webp';
        return 'image/jpeg';
    }

    function downloadTextFile(fileName, text, mimeType) {
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    window.api = {
        async save(data) {
            const serialized = JSON.stringify(data);
            try {
                await writeMobileRecord(dbKey, serialized);
            } catch (error) {
                console.warn('IndexedDB save failed; using local storage fallback.', error);
                localStorage.setItem(dbKey, serialized);
            }
            try {
                if (serialized.length < 1500000) localStorage.setItem(dbKey, serialized);
            } catch (error) {
                console.warn('Local mobile backup was skipped.', error);
            }
            return true;
        },

        async load() {
            let raw = null;
            try {
                raw = await readMobileRecord(dbKey);
            } catch (error) {
                console.warn('IndexedDB load failed; checking local storage.', error);
            }
            if (!raw) raw = localStorage.getItem(dbKey);
            if (!raw) return { ...emptyDb };
            try {
                const parsed = { ...emptyDb, ...JSON.parse(raw) };
                try { await writeMobileRecord(dbKey, JSON.stringify(parsed)); } catch (error) { console.warn('Mobile data migration was deferred.', error); }
                return parsed;
            } catch (error) {
                console.error('Unable to load local PharmAtlas data:', error);
                return { ...emptyDb };
            }
        },

        async saveImage(fileName, base64Data) {
            const dataUrl = `data:${getMimeType(fileName)};base64,${base64Data}`;
            return dataUrl;
        },

        async getDataLocation() {
            return { usingDefault: true, dataDir: 'On this iPhone or iPad (IndexedDB)' };
        },

        async backupData(data) {
            const fileName = `PharmAtlas_Backup_${new Date().toISOString().slice(0, 10)}.json`;
            downloadTextFile(fileName, JSON.stringify(data, null, 2), 'application/json');
            return `${fileName} downloaded`;
        },

        async restoreData() {
            return new Promise((resolve, reject) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'application/json,.json';
                input.onchange = async () => {
                    try {
                        const file = input.files?.[0];
                        if (!file) return resolve(null);
                        const parsed = JSON.parse(await file.text());
                        await window.api.save(parsed);
                        resolve(parsed);
                    } catch (error) {
                        reject(error);
                    }
                };
                input.click();
            });
        },

        async archiveData(data) {
            const fileName = `PharmAtlas_Archive_${new Date().toISOString().slice(0, 10)}.json`;
            downloadTextFile(fileName, JSON.stringify(data, null, 2), 'application/json');
            return `${fileName} downloaded`;
        },

        async notify(title, body) {
            if ('Notification' in window) {
                if (Notification.permission === 'default') await Notification.requestPermission();
                if (Notification.permission === 'granted') {
                    new Notification(title, { body });
                    return true;
                }
            }
            console.log(`${title}: ${body}`);
            return false;
        },

        async sendEmail(details) {
            const subject = encodeURIComponent(details?.subject || '');
            const body = encodeURIComponent(details?.body || '');
            const to = encodeURIComponent(details?.to || '');
            window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
            return { success: true };
        },

        async savePdfReport({ html, fileName }) {
            const safeName = fileName || `PharmAtlas_Report_${Date.now()}.html`;
            downloadTextFile(safeName.replace(/\.pdf$/i, '.html'), html, 'text/html');
            return `${safeName.replace(/\.pdf$/i, '.html')} downloaded`;
        },

        async emailPdfReport({ html, fileName, to, subject, body }) {
            const safeName = fileName || `PharmAtlas_Report_${Date.now()}.html`;
            downloadTextFile(safeName.replace(/\.pdf$/i, '.html'), html, 'text/html');
            const encodedSubject = encodeURIComponent(subject || '');
            const encodedBody = encodeURIComponent(`${body || ''}\n\nThe report file was downloaded separately because email attachments require the desktop app.`);
            window.location.href = `mailto:${encodeURIComponent(to || '')}?subject=${encodedSubject}&body=${encodedBody}`;
            return { success: true };
        }
    };
})();
