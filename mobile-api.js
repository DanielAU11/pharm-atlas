(function() {
    if (window.api) return;

    window.__PHARMATLAS_MOBILE__ = true;
    document.documentElement.classList.add('mobile-runtime');
    if (/iPad|iPhone|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
        document.documentElement.classList.add('ios-runtime');
    }

    const dbKey = 'pharmatlas-db';
    const settingsKey = 'pharmatlas-mobile-settings';
    const emptyDb = { family: [], inventory: [], schedules: [], history: [], recipes: [], vitals: [], orderSets: [], prescribers: [], reminderLog: [], prepackQueues: [] };
    const indexedDbName = 'PharmAtlasMobile';
    const indexedDbStore = 'records';
    const mobileDeviceId = localStorage.getItem('pharmatlas-mobile-device-id') || `ios-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem('pharmatlas-mobile-device-id', mobileDeviceId);
    let lastMobileDatabase = null;
    let mobileSyncTimer = null;
    let mobileSyncInProgress = false;
    let mobileSettings = { notificationsEnabled: false, pairing: null, lastSyncAt: '', lastSyncError: '' };
    let mobileSettingsReady = Promise.resolve();

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

    function nativePlugin(name) {
        return window.Capacitor?.Plugins?.[name] || null;
    }

    async function loadMobileSettings() {
        try {
            const raw = await readMobileRecord(settingsKey);
            if (raw) mobileSettings = { ...mobileSettings, ...JSON.parse(raw) };
        } catch (error) {
            const raw = localStorage.getItem(settingsKey);
            if (raw) mobileSettings = { ...mobileSettings, ...JSON.parse(raw) };
        }
        return mobileSettings;
    }

    async function saveMobileSettings() {
        const raw = JSON.stringify(mobileSettings);
        try { await writeMobileRecord(settingsKey, raw); } catch (error) { localStorage.setItem(settingsKey, raw); }
        localStorage.setItem(settingsKey, raw);
        renderMobileCompanionPanel();
    }

    function stableNotificationId(value) {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return Math.abs(hash | 0) || 1;
    }

    function memberName(member) {
        return [member?.firstName, member?.lastName].filter(Boolean).join(' ') || 'Member';
    }

    function medName(med) {
        const strength = med?.displayStrength || [med?.strength, med?.units].filter(value => value !== '' && value != null).join('');
        return [med?.name || 'Medication', strength].filter(Boolean).join(' ');
    }

    function notificationCandidates(data) {
        if (typeof window.getScheduleInstancesInRange !== 'function') return [];
        const now = new Date();
        const today = typeof window.localDateKey === 'function' ? window.localDateKey(now) : now.toISOString().slice(0, 10);
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + 30);
        const end = typeof window.localDateKey === 'function' ? window.localDateKey(endDate) : endDate.toISOString().slice(0, 10);
        const historyKeys = new Set((data.history || []).map(entry => entry.scheduleInstanceKey).filter(Boolean));
        const candidates = [];
        (data.schedules || []).forEach(schedule => {
            const member = (data.family || []).find(item => item.id === schedule.memberId);
            if (!member || member.notificationPrefs?.medicationReminders === false || schedule.status === 'discontinued' || schedule.status === 'completed') return;
            const med = (data.inventory || []).find(item => item.id === schedule.medId);
            (window.getScheduleInstancesInRange(schedule, today, end) || []).forEach(instance => {
                const key = `${schedule.id}|${instance.date}|${instance.time}`;
                if (historyKeys.has(key)) return;
                const at = new Date(`${instance.date}T${instance.time}:00`);
                if (!Number.isFinite(at.getTime()) || at <= now) return;
                candidates.push({
                    id: stableNotificationId(`med|${key}`),
                    title: 'Medication due',
                    body: `${memberName(member)}: ${medName(med)}`,
                    schedule: { at },
                    sound: 'default',
                    extra: { source: 'pharmatlas', kind: 'medication', scheduleId: schedule.id, date: instance.date, time: instance.time }
                });
            });
        });
        (data.careReminders || []).forEach(reminder => {
            const member = (data.family || []).find(item => item.id === reminder.memberId);
            if (!member || member.notificationPrefs?.medicationReminders === false || reminder.enabled === false) return;
            (window.getScheduleInstancesInRange(reminder, today, end) || []).forEach(instance => {
                const at = new Date(`${instance.date}T${instance.time}:00`);
                if (!Number.isFinite(at.getTime()) || at <= now) return;
                const key = `care|${reminder.id}|${instance.date}|${instance.time}`;
                candidates.push({
                    id: stableNotificationId(key),
                    title: 'Monitoring reminder',
                    body: `${memberName(member)}: ${reminder.title || reminder.type || 'Monitoring check'}`,
                    schedule: { at },
                    sound: 'default',
                    extra: { source: 'pharmatlas', kind: 'monitoring', reminderId: reminder.id, date: instance.date, time: instance.time }
                });
            });
        });
        return candidates.sort((a, b) => a.schedule.at - b.schedule.at).slice(0, 60);
    }

    async function refreshNativeNotifications(data, requestPermission = false) {
        const plugin = nativePlugin('LocalNotifications');
        if (!plugin || !mobileSettings.notificationsEnabled) return { scheduled: 0, permission: 'unavailable' };
        let permission = await plugin.checkPermissions();
        if (requestPermission && permission.display !== 'granted') permission = await plugin.requestPermissions();
        if (permission.display !== 'granted') return { scheduled: 0, permission: permission.display };
        const pending = await plugin.getPending();
        const ours = (pending.notifications || []).filter(item => item.extra?.source === 'pharmatlas').map(item => ({ id: item.id }));
        if (ours.length) await plugin.cancel({ notifications: ours });
        const notifications = notificationCandidates(data);
        if (notifications.length) await plugin.schedule({ notifications });
        return { scheduled: notifications.length, permission: 'granted' };
    }

    function base64UrlToBytes(value) {
        const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
        const binary = atob(padded);
        return Uint8Array.from(binary, character => character.charCodeAt(0));
    }

    function bytesToBase64Url(bytes) {
        let binary = '';
        bytes.forEach(value => { binary += String.fromCharCode(value); });
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    async function importPairingKeys(pairing) {
        const raw = base64UrlToBytes(pairing.key);
        return {
            aes: await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']),
            hmac: await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
        };
    }

    async function encryptSyncValue(value, key) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encryptedWithTag = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(JSON.stringify(value))));
        const data = encryptedWithTag.slice(0, -16);
        const tag = encryptedWithTag.slice(-16);
        return { iv: bytesToBase64Url(iv), data: bytesToBase64Url(data), tag: bytesToBase64Url(tag) };
    }

    async function decryptSyncValue(envelope, key) {
        const data = base64UrlToBytes(envelope.data);
        const tag = base64UrlToBytes(envelope.tag);
        const combined = new Uint8Array(data.length + tag.length);
        combined.set(data); combined.set(tag, data.length);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv), tagLength: 128 }, key, combined);
        return JSON.parse(new TextDecoder().decode(plain));
    }

    async function signedSyncRequest(action, payload) {
        const pairing = mobileSettings.pairing;
        if (!pairing) throw new Error('Pair this iPhone or iPad with the desktop first.');
        const keys = await importPairingKeys(pairing);
        const path = `/pharmatlas-sync/${encodeURIComponent(pairing.id)}/${action}`;
        const body = JSON.stringify(await encryptSyncValue(payload, keys.aes));
        const timestamp = String(Date.now());
        const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
        const signingText = ['POST', path, timestamp, nonce, body].join('\n');
        const signature = bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', keys.hmac, new TextEncoder().encode(signingText))));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        let response;
        try {
            response = await fetch(`http://${pairing.host}:${pairing.port}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-PharmAtlas-Timestamp': timestamp,
                    'X-PharmAtlas-Nonce': nonce,
                    'X-PharmAtlas-Signature': signature
                },
                body,
                signal: controller.signal
            });
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('The desktop did not respond within 12 seconds.');
            throw error;
        } finally {
            clearTimeout(timeout);
        }
        const responseBody = await response.json();
        if (!response.ok) throw new Error(responseBody.error || `Desktop returned ${response.status}.`);
        return decryptSyncValue(responseBody, keys.aes);
    }

    async function syncWithDesktop(data = lastMobileDatabase, quiet = false) {
        if (!mobileSettings.pairing || mobileSyncInProgress || !data) return null;
        mobileSyncInProgress = true;
        try {
            const pushed = await signedSyncRequest('push', { protocol: 1, deviceName: 'iPhone or iPad', data });
            const merged = window.PharmAtlasSyncCore.mergeDatabases(data, pushed.data, mobileDeviceId, new Date().toISOString(), { preferIncomingOnTie: true });
            lastMobileDatabase = merged;
            await writeMobileRecord(dbKey, JSON.stringify(merged));
            mobileSettings.lastSyncAt = new Date().toISOString();
            mobileSettings.lastSyncError = '';
            await saveMobileSettings();
            await refreshNativeNotifications(merged);
            if (typeof window.applyMobileSyncedDatabase === 'function') window.applyMobileSyncedDatabase(merged);
            return merged;
        } catch (error) {
            mobileSettings.lastSyncError = error.message || 'Unable to reach desktop.';
            await saveMobileSettings();
            if (!quiet) throw error;
            return null;
        } finally {
            mobileSyncInProgress = false;
        }
    }

    function queueDesktopSync(data) {
        clearTimeout(mobileSyncTimer);
        if (!mobileSettings.pairing) return;
        mobileSyncTimer = setTimeout(() => syncWithDesktop(data, true), 800);
    }

    mobileSettingsReady = loadMobileSettings();

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
            await mobileSettingsReady;
            const prepared = window.PharmAtlasSyncCore.prepareDatabase(lastMobileDatabase || {}, data, mobileDeviceId);
            const serialized = JSON.stringify(prepared);
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
            lastMobileDatabase = prepared;
            refreshNativeNotifications(prepared).catch(error => console.warn('Native reminders could not be refreshed.', error));
            queueDesktopSync(prepared);
            return true;
        },

        async load() {
            await mobileSettingsReady;
            let raw = null;
            try {
                raw = await readMobileRecord(dbKey);
            } catch (error) {
                console.warn('IndexedDB load failed; checking local storage.', error);
            }
            if (!raw) raw = localStorage.getItem(dbKey);
            if (!raw) {
                lastMobileDatabase = { ...emptyDb };
                return lastMobileDatabase;
            }
            try {
                const parsed = { ...emptyDb, ...JSON.parse(raw) };
                lastMobileDatabase = parsed;
                try { await writeMobileRecord(dbKey, JSON.stringify(parsed)); } catch (error) { console.warn('Mobile data migration was deferred.', error); }
                setTimeout(() => refreshNativeNotifications(parsed).catch(error => console.warn('Native reminders could not be refreshed.', error)), 0);
                setTimeout(() => syncWithDesktop(parsed, true), 500);
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
            const plugin = nativePlugin('LocalNotifications');
            if (plugin && mobileSettings.notificationsEnabled) {
                const permission = await plugin.checkPermissions();
                if (permission.display === 'granted') {
                    await plugin.schedule({ notifications: [{
                        id: stableNotificationId(`immediate|${title}|${body}|${Date.now()}`),
                        title,
                        body,
                        schedule: { at: new Date(Date.now() + 1000) },
                        sound: 'default',
                        extra: { source: 'pharmatlas', kind: 'immediate' }
                    }] });
                    return true;
                }
            }
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

    function parsePairingPayload(value) {
        const url = new URL(String(value || '').trim());
        if (url.protocol !== 'pharmatlas-sync:' || url.hostname !== 'pair') throw new Error('This is not a PharmAtlas desktop pairing code.');
        const pairing = {
            version: Number(url.searchParams.get('v')),
            host: url.searchParams.get('host') || '',
            port: Number(url.searchParams.get('port')),
            id: url.searchParams.get('id') || '',
            key: url.searchParams.get('key') || '',
            name: url.searchParams.get('name') || 'PharmAtlas Desktop'
        };
        const privateAddress = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(pairing.host);
        if (pairing.version !== 1 || !privateAddress || !Number.isInteger(pairing.port) || pairing.port < 1 || pairing.port > 65535 || !pairing.id || base64UrlToBytes(pairing.key).length !== 32) {
            throw new Error('The pairing code is incomplete or does not point to a private local network.');
        }
        return pairing;
    }

    window.enableIphoneReminders = async function() {
        const plugin = nativePlugin('LocalNotifications');
        if (!plugin) return window.appAlert?.('Native notifications are available in the installed iPhone or iPad app.', 'iPhone Reminders');
        mobileSettings.notificationsEnabled = true;
        await saveMobileSettings();
        const result = await refreshNativeNotifications(lastMobileDatabase || emptyDb, true);
        if (result.permission !== 'granted') {
            mobileSettings.notificationsEnabled = false;
            await saveMobileSettings();
            return window.appAlert?.('Notifications were not allowed. Enable PharmAtlas in iOS Settings > Notifications, then try again.', 'Notifications Not Enabled');
        }
        return window.appAlert?.(`${result.scheduled} upcoming reminders are scheduled directly on this device. No email service is used.`, 'iPhone Reminders Ready');
    };

    window.disableIphoneReminders = async function() {
        mobileSettings.notificationsEnabled = false;
        await saveMobileSettings();
        const plugin = nativePlugin('LocalNotifications');
        if (plugin) {
            const pending = await plugin.getPending();
            const ours = (pending.notifications || []).filter(item => item.extra?.source === 'pharmatlas').map(item => ({ id: item.id }));
            if (ours.length) await plugin.cancel({ notifications: ours });
        }
        renderMobileCompanionPanel();
    };

    window.pairMobileWithDesktop = async function() {
        let value = '';
        const scanner = nativePlugin('CapacitorBarcodeScanner');
        if (scanner) {
            try {
                const result = await scanner.scanBarcode({ hint: 0, cameraDirection: 1, scanOrientation: 1, scanInstructions: 'Scan the pairing code shown by PharmAtlas Desktop', cancelButtonAccessibilityLabel: 'Cancel pairing scan' });
                value = result?.ScanResult || '';
            } catch (error) {
                if (!String(error?.message || '').toLowerCase().includes('cancel')) console.warn('Pairing QR scan did not complete:', error);
            }
        }
        if (!value) value = document.getElementById('mobile-pairing-code')?.value || '';
        if (!value) return window.appAlert?.('Scan the QR shown by Desktop > Device Sync, or paste its pairing text into the field.', 'Pair Desktop');
        try {
            mobileSettings.pairing = parsePairingPayload(value);
            mobileSettings.lastSyncError = '';
            await saveMobileSettings();
            await syncWithDesktop(lastMobileDatabase || emptyDb);
            return window.appAlert?.(`Paired with ${mobileSettings.pairing.name}. Changes sync while both apps are open on the same local network.`, 'Desktop Paired');
        } catch (error) {
            mobileSettings.pairing = null;
            mobileSettings.lastSyncError = error.message;
            await saveMobileSettings();
            return window.appAlert?.(`${error.message}\nKeep the desktop app open and confirm both devices use the same Wi-Fi network.`, 'Pairing Failed');
        }
    };

    window.syncMobileWithDesktopNow = async function() {
        try {
            await syncWithDesktop(lastMobileDatabase || emptyDb);
            return window.appAlert?.('Phone and desktop changes were merged. A safety backup is created on the desktop before incoming changes are written.', 'Sync Complete');
        } catch (error) {
            return window.appAlert?.(`${error.message}\nKeep PharmAtlas Desktop open and use the same Wi-Fi network.`, 'Sync Unavailable');
        }
    };

    window.unpairMobileDesktop = async function() {
        const approved = window.appConfirm ? await window.appConfirm('Disconnect this iPhone or iPad from the paired desktop?', 'Unpair Desktop') : confirm('Unpair desktop?');
        if (!approved) return;
        mobileSettings.pairing = null;
        mobileSettings.lastSyncAt = '';
        mobileSettings.lastSyncError = '';
        await saveMobileSettings();
    };

    function renderMobileCompanionPanel() {
        const host = document.getElementById('mobile-companion-panel');
        if (!host) return;
        const deviceName = window.innerWidth >= 700 ? 'iPad' : 'iPhone';
        const paired = mobileSettings.pairing;
        const lastSync = mobileSettings.lastSyncAt ? new Date(mobileSettings.lastSyncAt).toLocaleString() : 'Not synced yet';
        host.innerHTML = `
            <div class="mobile-companion-heading"><span class="win98-icon icon-calendar"></span><strong>${deviceName} Companion</strong></div>
            <div class="mobile-companion-actions">
                <button type="button" onclick="${mobileSettings.notificationsEnabled ? 'disableIphoneReminders()' : 'enableIphoneReminders()'}"><span class="win98-icon icon-calendar"></span>${mobileSettings.notificationsEnabled ? 'Reminders On' : 'Enable Reminders'}</button>
                <button type="button" onclick="pairMobileWithDesktop()"><span class="win98-icon icon-view"></span>${paired ? 'Re-pair Desktop' : 'Pair Desktop'}</button>
                <button type="button" onclick="syncMobileWithDesktopNow()" ${paired ? '' : 'disabled'}><span class="win98-icon icon-view"></span>Sync Now</button>
                ${paired ? '<button type="button" title="Disconnect desktop" onclick="unpairMobileDesktop()"><span class="win98-icon icon-clear"></span>Unpair</button>' : ''}
            </div>
            <input id="mobile-pairing-code" class="mobile-pairing-code" type="text" placeholder="Pairing text fallback" aria-label="Desktop pairing text">
            <div class="mobile-companion-status ${mobileSettings.lastSyncError ? 'error' : ''}">${paired ? `Paired: ${paired.name} | Last sync: ${lastSync}` : 'Not paired with a desktop.'}${mobileSettings.lastSyncError ? ` | ${mobileSettings.lastSyncError}` : ''}</div>`;
    }

    function applyMobileFeatureSet() {
        document.documentElement.classList.add('mobile-companion-mode');
        ['tab-prepackage', 'tab-recipes'].forEach(id => document.getElementById(id)?.setAttribute('hidden', ''));
        const dashboard = document.getElementById('panel-dashboard');
        if (dashboard && !document.getElementById('mobile-companion-panel')) {
            const panel = document.createElement('section');
            panel.id = 'mobile-companion-panel';
            panel.className = 'mobile-companion-panel';
            dashboard.prepend(panel);
        }
        const deviceName = window.innerWidth >= 700 ? 'iPad' : 'iPhone';
        document.querySelector('.app-window > .title-bar .title-bar-text')?.replaceChildren(document.createTextNode(`PharmAtlas ${deviceName}`));
        renderMobileCompanionPanel();
    }

    async function initializeMobileRuntime() {
        await mobileSettingsReady;
        applyMobileFeatureSet();
        setInterval(() => {
            if (document.visibilityState === 'visible' && mobileSettings.pairing) syncWithDesktop(lastMobileDatabase, true);
        }, 20000);
    }

    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initializeMobileRuntime, { once: true });
    else initializeMobileRuntime();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && mobileSettings.pairing) syncWithDesktop(lastMobileDatabase, true);
    });
})();
