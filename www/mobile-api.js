(function() {
    if (window.api) return;

    const dbKey = 'pharmatlas-db';
    const imagePrefix = 'pharmatlas-image:';
    const emptyDb = { family: [], inventory: [], schedules: [], history: [], recipes: [], vitals: [], orderSets: [], prescribers: [], reminderLog: [], prepackQueues: [] };

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
            localStorage.setItem(dbKey, JSON.stringify(data));
            return true;
        },

        async load() {
            const raw = localStorage.getItem(dbKey);
            if (!raw) return { ...emptyDb };
            try {
                return { ...emptyDb, ...JSON.parse(raw) };
            } catch (error) {
                console.error('Unable to load local PharmAtlas data:', error);
                return { ...emptyDb };
            }
        },

        async saveImage(fileName, base64Data) {
            const dataUrl = `data:${getMimeType(fileName)};base64,${base64Data}`;
            localStorage.setItem(`${imagePrefix}${fileName}`, dataUrl);
            return dataUrl;
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
