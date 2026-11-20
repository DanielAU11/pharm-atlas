(function() {
    if (window.api) return;

    window.__PHARMATLAS_MOBILE__ = true;
    document.documentElement.classList.add('mobile-runtime');
    if (!localStorage.getItem('pharmAtlasMobileCalendarDefaultV1')) {
        localStorage.setItem('pharmAtlasDashboardCalendarView', 'day');
        localStorage.setItem('pharmAtlasCustomEventCalendarView', 'day');
        localStorage.setItem('pharmAtlasMemberCalendarView', 'day');
        localStorage.setItem('pharmAtlasMobileCalendarDefaultV1', '1');
    }
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
    let mobileSettings = { notificationsEnabled: false, pairing: null, lastSyncAt: '', lastSyncError: '', pendingChangesAt: '' };
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
        const prepared = window.getPharmAtlasNativePlugin?.(name);
        if (prepared) return prepared;
        const registered = window.PharmAtlasNativePlugins?.[name] || window.Capacitor?.Plugins?.[name];
        if (registered) return registered;
        const registerPlugin = window.Capacitor?.registerPlugin;
        if (typeof registerPlugin !== 'function') return null;
        try {
            window.PharmAtlasNativePlugins = window.PharmAtlasNativePlugins || {};
            window.PharmAtlasNativePlugins[name] = registerPlugin(name);
            return window.PharmAtlasNativePlugins[name];
        } catch (error) {
            console.warn(`Unable to register native plugin ${name}.`, error);
            return null;
        }
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

    function isNativeAppleRuntime() {
        return document.documentElement.classList.contains('ios-runtime')
            && window.Capacitor?.isNativePlatform?.() === true;
    }

    async function localNetworkJsonRequest(url, options = {}) {
        const method = options.method || 'GET';
        const timeoutMs = Number(options.timeoutMs) || 7000;
        const nativeHttp = isNativeAppleRuntime() ? nativePlugin('CapacitorHttp') : null;
        if (nativeHttp?.request) {
            const result = await nativeHttp.request({
                url,
                method,
                headers: options.headers || {},
                ...(options.body === undefined ? {} : { data: options.body }),
                connectTimeout: timeoutMs,
                readTimeout: timeoutMs,
                responseType: 'json',
                disableRedirects: true
            });
            let data = result?.data;
            if (typeof data === 'string' && data) {
                try { data = JSON.parse(data); } catch { data = {}; }
            }
            const status = Number(result?.status) || 0;
            return { ok: status >= 200 && status < 300, status, data: data || {} };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method,
                headers: options.headers || {},
                body: options.body,
                cache: 'no-store',
                signal: controller.signal
            });
            return {
                ok: response.ok,
                status: response.status,
                data: await response.json().catch(() => ({}))
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    async function signedSyncRequest(action, payload) {
        const pairing = mobileSettings.pairing;
        if (!pairing) throw new Error('Pair this iPhone or iPad with the desktop first.');
        const keys = await importPairingKeys(pairing);
        const path = `/pharmatlas-sync/${encodeURIComponent(pairing.id)}/${action}`;
        const body = JSON.stringify(await encryptSyncValue(payload, keys.aes));
        const hosts = syncHostCandidates(pairing);
        let lastError = null;
        for (const host of hosts) {
            const timestamp = String(Date.now());
            const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
            const signingText = ['POST', path, timestamp, nonce, body].join('\n');
            const signature = bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', keys.hmac, new TextEncoder().encode(signingText))));
            try {
                const response = await localNetworkJsonRequest(`http://${host}:${pairing.port}${path}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-PharmAtlas-Timestamp': timestamp,
                        'X-PharmAtlas-Nonce': nonce,
                        'X-PharmAtlas-Signature': signature
                    },
                    body,
                    timeoutMs: 9000
                });
                const responseBody = response.data || {};
                if (!response.ok) throw new Error(responseBody.error || `Desktop returned ${response.status}.`);
                if (pairing.host !== host) {
                    pairing.host = host;
                    await saveMobileSettings();
                }
                return decryptSyncValue(responseBody, keys.aes);
            } catch (error) {
                lastError = error;
            }
        }
        const addresses = hosts.map(host => `${host}:${pairing.port}`).join(', ');
        const detail = lastError?.name === 'AbortError' ? 'The desktop did not respond in time.' : (lastError?.message || 'The desktop could not be reached.');
        throw new Error(`${detail} Tried ${addresses}. Keep PharmAtlas Desktop open and allow it through the Windows private-network firewall.`);
    }

    function cloudPairingConfigured(pairing = mobileSettings.pairing) {
        return !!pairing?.relay && !!pairing?.vault && !!pairing?.token;
    }

    async function cloudRelayFetch(pairing, method, envelope = null, revision = '') {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(`${pairing.relay}/v1/vaults/${encodeURIComponent(pairing.vault)}`, {
                method,
                headers: {
                    'Authorization': `Bearer ${pairing.token}`,
                    'Content-Type': 'application/json',
                    ...(method === 'PUT' ? { 'If-Match': revision || '*' } : {})
                },
                body: method === 'PUT' ? JSON.stringify({ envelope }) : undefined,
                cache: 'no-store',
                signal: controller.signal
            });
            if (response.status === 404) return { missing: true };
            const result = await response.json().catch(() => ({}));
            if (response.status === 409 || response.status === 412) return { conflict: true, revision: result.revision || '' };
            if (!response.ok) throw new Error(result.error || `Encrypted relay returned ${response.status}.`);
            return result;
        } catch (error) {
            if (error?.name === 'AbortError') throw new Error('The encrypted sync relay did not respond within 15 seconds.');
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    async function syncWithCloudRelay(data, retry = true) {
        const pairing = mobileSettings.pairing;
        const keys = await importPairingKeys(pairing);
        const pulled = await cloudRelayFetch(pairing, 'GET');
        if (pulled.missing) {
            const created = await cloudRelayFetch(pairing, 'PUT', await encryptSyncValue(data, keys.aes), '');
            if (created.conflict && retry) return syncWithCloudRelay(data, false);
            if (created.conflict) throw new Error('The encrypted vault changed while it was being initialized. Try again.');
            return data;
        }
        if (!pulled.envelope || !pulled.revision) throw new Error('The encrypted sync relay returned an incomplete vault.');
        const incoming = await decryptSyncValue(pulled.envelope, keys.aes);
        const merged = window.PharmAtlasSyncCore.mergeDatabases(data, incoming, mobileDeviceId, new Date().toISOString(), { preferIncomingOnTie: true });
        if (window.PharmAtlasSyncCore.canonical(incoming) !== window.PharmAtlasSyncCore.canonical(merged)) {
            const pushed = await cloudRelayFetch(pairing, 'PUT', await encryptSyncValue(merged, keys.aes), pulled.revision);
            if (pushed.conflict && retry) return syncWithCloudRelay(merged, false);
            if (pushed.conflict) throw new Error('Another device updated the encrypted vault. Tap Sync Now to merge the newest changes.');
        }
        return merged;
    }

    async function syncWithDesktop(data = lastMobileDatabase, quiet = false) {
        if (!mobileSettings.pairing || mobileSyncInProgress || !data) return null;
        mobileSyncInProgress = true;
        try {
            if (cloudPairingConfigured()) {
                const merged = await syncWithCloudRelay(data);
                lastMobileDatabase = merged;
                await writeMobileRecord(dbKey, JSON.stringify(merged));
                mobileSettings.lastSyncAt = new Date().toISOString();
                mobileSettings.lastSyncError = '';
                mobileSettings.pendingChangesAt = '';
                await saveMobileSettings();
                await refreshNativeNotifications(merged);
                if (typeof window.applyMobileSyncedDatabase === 'function') window.applyMobileSyncedDatabase(merged);
                return merged;
            }
            // Always establish a desktop baseline before sending phone changes. This makes
            // first pairing additive and gives the desktop a revision it can verify.
            const pulled = await signedSyncRequest('pull', { protocol: 1, deviceId: mobileDeviceId });
            const phoneBaseline = window.PharmAtlasSyncCore.mergeDatabases(
                data,
                pulled.data,
                mobileDeviceId,
                new Date().toISOString(),
                { preferIncomingOnTie: true }
            );
            const pushed = await signedSyncRequest('push', {
                protocol: 1,
                deviceId: mobileDeviceId,
                deviceName: 'iPhone or iPad',
                baseRevision: pulled.revision,
                data: phoneBaseline
            });
            const merged = window.PharmAtlasSyncCore.mergeDatabases(phoneBaseline, pushed.data, mobileDeviceId, new Date().toISOString(), { preferIncomingOnTie: true });
            lastMobileDatabase = merged;
            await writeMobileRecord(dbKey, JSON.stringify(merged));
            mobileSettings.lastSyncAt = new Date().toISOString();
            mobileSettings.lastSyncError = '';
            mobileSettings.pendingChangesAt = '';
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
            mobileSettings.pendingChangesAt = mobileSettings.pendingChangesAt || new Date().toISOString();
            await saveMobileSettings();
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
        const privateAddress = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
        const hosts = [...new Set(url.searchParams.getAll('host').map(host => host.trim()).filter(host => privateAddress.test(host)))];
        const pairing = {
            version: Number(url.searchParams.get('v')),
            host: hosts[0] || '',
            hosts,
            port: Number(url.searchParams.get('port')),
            id: url.searchParams.get('id') || '',
            key: url.searchParams.get('key') || '',
            name: url.searchParams.get('name') || 'PharmAtlas Desktop'
        };
        pairing.relay = url.searchParams.get('relay') || '';
        pairing.vault = url.searchParams.get('vault') || '';
        pairing.token = url.searchParams.get('token') || '';
        if (pairing.version !== 1 || !pairing.hosts.length || !Number.isInteger(pairing.port) || pairing.port < 1 || pairing.port > 65535 || !pairing.id || base64UrlToBytes(pairing.key).length !== 32) {
            throw new Error('The pairing code is incomplete or does not point to a private local network.');
        }
        if ((pairing.relay || pairing.vault || pairing.token) && (!/^https:\/\//i.test(pairing.relay) || !pairing.vault || pairing.token.length < 32)) {
            throw new Error('The remote-sync portion of this pairing code is incomplete. Generate a new code on the desktop.');
        }
        return pairing;
    }

    function syncHostCandidates(pairing) {
        const privateAddress = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
        return [...new Set([pairing?.host, ...(Array.isArray(pairing?.hosts) ? pairing.hosts : [])])]
            .map(host => String(host || '').trim())
            .filter(host => privateAddress.test(host));
    }

    async function requestNativeLocalNetworkAccess(pairing) {
        if (!isNativeAppleRuntime()) return pairing;
        const probe = nativePlugin('PharmAtlasLocalNetwork');
        if (!probe?.probe) throw new Error('The iOS Local Network bridge is unavailable. Pull the newest source, run npm run cap:sync, then delete and reinstall PharmAtlas from Xcode.');
        const hosts = syncHostCandidates(pairing);
        const results = [];
        for (const host of hosts) {
            try {
                const result = await probe.probe({ host, port: pairing.port, timeoutMs: 30000 });
                results.push({ host, ...result });
                if (result?.status === 'allowed') return { ...pairing, host, hosts };
                if (result?.status === 'denied') {
                    throw new Error('Local Network access was denied. PharmAtlas should now appear in iPhone Settings > Privacy & Security > Local Network. Turn it on, return to PharmAtlas, and pair again.');
                }
            } catch (error) {
                if (/denied|Local Network access/i.test(error?.message || '')) throw error;
                results.push({ host, status: 'error', message: error?.message || String(error) });
            }
        }
        if (results.some(result => result.status === 'timeout')) {
            throw new Error('The Local Network permission request was not completed. Pair again and respond to the iOS permission sheet before it closes.');
        }
        return pairing;
    }

    async function verifyDesktopReachable(pairing) {
        const hosts = syncHostCandidates(pairing);
        const tryHosts = () => Promise.all(hosts.map(async host => {
                try {
                    const response = await localNetworkJsonRequest(`http://${host}:${pairing.port}/pharmatlas-sync/ping`, {
                        method: 'GET',
                        timeoutMs: 8000
                    });
                    if (!response.ok) throw new Error(`Desktop returned ${response.status}.`);
                    const result = response.data;
                    if (result?.protocol !== 1 || result?.deviceId !== pairing.id) {
                        throw new Error('A different or outdated PharmAtlas desktop answered at this address. Generate a new pairing code.');
                    }
                    return { host, ok: true };
                } catch (error) {
                    return { host, ok: false, error };
                }
            }));
        let attempts = [];
        let reachable = null;
        for (const delay of [0, 2000, 5000]) {
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            attempts = await tryHosts();
            reachable = attempts.find(attempt => attempt.ok);
            if (reachable) break;
        }
        if (reachable) return { ...pairing, host: reachable.host, hosts };
        const identityError = attempts.find(attempt => /different|outdated/i.test(attempt.error?.message || ''));
        if (identityError) throw identityError.error;
        const addresses = hosts.map(host => `${host}:${pairing.port}`).join(', ');
        throw new Error(`Cannot reach ${addresses}. On iPhone, open Settings > Privacy & Security > Local Network and allow PharmAtlas. If PharmAtlas is still missing there, delete the iPhone app, install this build again from Xcode, and tap Allow when pairing asks for local-network access. Also disable VPN/Private Relay temporarily and avoid guest Wi-Fi or client isolation.`);
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

    async function finishDesktopPairing(value) {
        if (!value) return window.appAlert?.('Paste the pairing text from Desktop > Device Sync, then choose Pair Text.', 'Pair Desktop');
        const previousPairing = mobileSettings.pairing;
        try {
            let pairing = parsePairingPayload(value);
            if (isNativeAppleRuntime() && !localStorage.getItem('pharmAtlasLocalNetworkExplainedV1')) {
                await window.appAlert?.('PharmAtlas will now ask to find your desktop on the local network. Tap Allow in the iOS permission message. No medication data is shared with other nearby devices.', 'Allow Local Network');
                localStorage.setItem('pharmAtlasLocalNetworkExplainedV1', '1');
            }
            pairing = await requestNativeLocalNetworkAccess(pairing);
            try {
                pairing = await verifyDesktopReachable(pairing);
            } catch (localError) {
                if (!cloudPairingConfigured(pairing)) throw localError;
                await cloudRelayFetch(pairing, 'GET');
            }
            mobileSettings.pairing = pairing;
            mobileSettings.lastSyncError = '';
            await saveMobileSettings();
            await syncWithDesktop(lastMobileDatabase || emptyDb);
            const mode = cloudPairingConfigured(pairing)
                ? 'Encrypted remote sync is enabled, so changes can wait securely while the desktop is offline.'
                : 'Direct sync works while both apps are open on the same local network.';
            return window.appAlert?.(`Paired with ${mobileSettings.pairing.name}. ${mode}`, 'Desktop Paired');
        } catch (error) {
            mobileSettings.pairing = previousPairing;
            mobileSettings.lastSyncError = error.message;
            await saveMobileSettings();
            return window.appAlert?.(`${error.message}\nInitial pairing still requires the desktop and phone on the same network.`, 'Pairing Failed');
        }
    }

    window.scanMobileDesktopQr = async function() {
        const scanner = nativePlugin('CapacitorBarcodeScanner');
        if (!scanner?.scanBarcode) {
            const platform = window.Capacitor?.getPlatform?.() || 'web';
            return window.appAlert?.(`The native QR scanner is unavailable (${platform}). Update the iPhone app from the latest project, run npm run cap:sync, delete the old PharmAtlas app from the iPhone, and install it again from Xcode. Pair Text remains available.`, 'QR Scanner Unavailable');
        }
        try {
            const result = await scanner.scanBarcode({
                hint: 0,
                scanButton: false,
                scanText: ' ',
                cameraDirection: 1,
                scanOrientation: 3,
                scanInstructions: 'Scan the pairing code shown by PharmAtlas Desktop',
                cancelButtonAccessibilityLabel: 'Cancel pairing scan'
            });
            const value = result?.ScanResult || '';
            if (!value) return window.appAlert?.('No QR code was detected. Try again, or use Pair Text in the iOS Simulator.', 'QR Not Detected');
            return finishDesktopPairing(value);
        } catch (error) {
            const message = String(error?.message || error || 'The camera could not be opened.');
            if (message.toLowerCase().includes('cancel')) return;
            console.warn('Pairing QR scan did not complete:', error);
            const permissionHelp = /denied|permission|camera access/i.test(message)
                ? 'Camera access was denied. Open iPhone Settings > Privacy & Security > Camera and enable PharmAtlas. If PharmAtlas is not listed, delete the app and install this build again from Xcode so iOS can show the permission prompt.'
                : 'The iOS Simulator has no camera for QR scanning; use Pair Text there. On a physical iPhone, rebuild after npm run cap:sync and try again.';
            return window.appAlert?.(`${message}\n\n${permissionHelp}`, 'QR Scanner Unavailable');
        }
    };

    function updateMobileNavigation(activeTab = '') {
        document.querySelectorAll('.mobile-bottom-nav button[data-mobile-tab], .mobile-more-sheet button[data-mobile-tab]').forEach(button => {
            const active = button.dataset.mobileTab === activeTab;
            button.classList.toggle('active', active);
            button.setAttribute('aria-current', active ? 'page' : 'false');
        });
    }

    function resetMobilePrimaryScroll() {
        const panelScroller = document.querySelector('.app-panel-window > .window-body');
        [panelScroller, document.scrollingElement].forEach(scroller => {
            if (!scroller) return;
            scroller.scrollTop = 0;
            scroller.scrollLeft = 0;
        });
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    window.mobileSwitchTab = function(tabName) {
        window.toggleMobileMore?.(false);
        window.switchTab?.(tabName);
        updateMobileNavigation(tabName);
        resetMobilePrimaryScroll();
        requestAnimationFrame(() => {
            resetMobilePrimaryScroll();
            document.getElementById(`panel-${tabName}`)?.getBoundingClientRect();
        });
    };

    window.toggleMobileMore = function(forceOpen) {
        const sheet = document.getElementById('mobile-more-sheet');
        if (!sheet) return;
        const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : sheet.hasAttribute('hidden');
        sheet.toggleAttribute('hidden', !shouldOpen);
    };

    function installMobileNavigation() {
        if (document.getElementById('mobile-bottom-nav')) return;
        const nav = document.createElement('nav');
        nav.id = 'mobile-bottom-nav';
        nav.className = 'mobile-bottom-nav';
        nav.setAttribute('aria-label', 'Primary navigation');
        nav.innerHTML = `
            <button type="button" data-mobile-tab="dashboard" onclick="mobileSwitchTab('dashboard')"><span class="win98-icon icon-dashboard"></span><span>Today</span></button>
            <button type="button" data-mobile-tab="schedules" onclick="mobileSwitchTab('schedules')"><span class="win98-icon icon-calendar"></span><span>Schedule</span></button>
            <button type="button" data-mobile-tab="family" onclick="mobileSwitchTab('family')"><span class="win98-icon icon-family"></span><span>Members</span></button>
            <button type="button" data-mobile-tab="vitals" onclick="mobileSwitchTab('vitals')"><span class="win98-icon icon-monitor"></span><span>Checks</span></button>
            <button type="button" onclick="toggleMobileMore()" aria-controls="mobile-more-sheet"><span class="win98-icon icon-info"></span><span>More</span></button>`;
        const sheet = document.createElement('section');
        sheet.id = 'mobile-more-sheet';
        sheet.className = 'mobile-more-sheet window';
        sheet.setAttribute('hidden', '');
        sheet.innerHTML = `
            <div class="title-bar"><div class="title-bar-text">More PharmAtlas tools</div><div class="title-bar-controls"><button type="button" aria-label="Close" onclick="toggleMobileMore(false)"></button></div></div>
            <div class="window-body mobile-more-actions">
                <button type="button" data-mobile-tab="order-sets" onclick="mobileSwitchTab('order-sets')"><span class="win98-icon icon-regimen"></span>Regimens</button>
                <button type="button" data-mobile-tab="inventory" onclick="mobileSwitchTab('inventory')"><span class="win98-icon icon-inventory"></span>Inventory</button>
                <button type="button" data-mobile-tab="drug-info" onclick="mobileSwitchTab('drug-info')"><span class="win98-icon icon-info"></span>Drug information</button>
                <button type="button" data-mobile-tab="help" onclick="mobileSwitchTab('help')"><span class="win98-icon icon-info"></span>Help &amp; setup</button>
            </div>`;
        document.body.append(sheet, nav);
        updateMobileNavigation('dashboard');
    }

    window.pairMobileWithDesktop = async function() {
        const value = document.getElementById('mobile-pairing-code')?.value?.trim() || '';
        return finishDesktopPairing(value);
    };

    window.syncMobileWithDesktopNow = async function() {
        try {
            await syncWithDesktop(lastMobileDatabase || emptyDb);
            const location = cloudPairingConfigured() ? 'encrypted relay' : 'paired desktop';
            return window.appAlert?.(`Changes were merged through the ${location}. A safety backup is created on the desktop before incoming changes are written.`, 'Sync Complete');
        } catch (error) {
            const help = cloudPairingConfigured()
                ? 'Check this device\'s internet connection and the configured relay status.'
                : 'Keep PharmAtlas Desktop open and use the same Wi-Fi network.';
            return window.appAlert?.(`${error.message}\n${help}`, 'Sync Unavailable');
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
        const remote = cloudPairingConfigured(paired);
        const lastSync = mobileSettings.lastSyncAt ? new Date(mobileSettings.lastSyncAt).toLocaleString() : 'Not synced yet';
        const pending = Boolean(mobileSettings.pendingChangesAt);
        const offline = navigator.onLine === false;
        const syncState = !paired
            ? { tone: 'local', title: 'Saved on this device', detail: 'Pair once to share changes with your desktop.' }
            : pending && offline
                ? { tone: 'waiting', title: 'Saved offline', detail: 'Changes will sync automatically when internet returns.' }
                : pending
                    ? { tone: 'waiting', title: 'Changes waiting to sync', detail: remote ? 'Automatic remote sync is on.' : 'Open the desktop app on the same network.' }
                    : mobileSettings.lastSyncError
                        ? { tone: 'waiting', title: 'Saved safely on this device', detail: remote ? 'Automatic sync will retry.' : 'Open the desktop app on the same network to sync.' }
                        : { tone: 'ready', title: 'Up to date', detail: `Last sync: ${lastSync}` };
        host.innerHTML = `
            <div class="mobile-companion-heading"><span class="win98-icon icon-calendar"></span><strong>${deviceName} Sync &amp; Reminders</strong></div>
            <div class="mobile-sync-state ${syncState.tone}" role="status" aria-live="polite"><strong>${syncState.title}</strong><span>${syncState.detail}</span></div>
            <div class="mobile-companion-actions">
                <button type="button" onclick="${mobileSettings.notificationsEnabled ? 'disableIphoneReminders()' : 'enableIphoneReminders()'}"><span class="win98-icon icon-calendar"></span>${mobileSettings.notificationsEnabled ? 'Reminders On' : 'Enable Reminders'}</button>
                <button type="button" class="mobile-camera-pair" onclick="scanMobileDesktopQr()"><span class="win98-icon icon-view"></span>${paired ? 'Scan New QR' : 'Scan Desktop QR'}</button>
                <button type="button" onclick="syncMobileWithDesktopNow()" ${paired ? '' : 'disabled'}><span class="win98-icon icon-view"></span>${pending ? 'Sync Changes' : 'Sync Now'}</button>
                ${paired ? '<button type="button" title="Disconnect desktop" onclick="unpairMobileDesktop()"><span class="win98-icon icon-clear"></span>Unpair</button>' : ''}
            </div>
            <details class="mobile-pairing-fallback">
                <summary>Camera unavailable? Use pairing text</summary>
                <div class="mobile-pairing-fallback-row"><input id="mobile-pairing-code" class="mobile-pairing-code" type="text" placeholder="Paste pairing text" aria-label="Desktop pairing text"><button type="button" onclick="pairMobileWithDesktop()"><span class="win98-icon icon-receive"></span>Pair</button></div>
            </details>
            <div class="mobile-companion-status ${mobileSettings.lastSyncError ? 'error' : ''}">${paired ? `${remote ? 'Encrypted remote sync' : 'Nearby desktop sync'} | ${paired.name}` : 'Not paired with a desktop.'}${mobileSettings.lastSyncError ? `<details><summary>Sync details</summary>${mobileSettings.lastSyncError}</details>` : ''}</div>`;
        host.querySelector('#mobile-pairing-code')?.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            window.pairMobileWithDesktop();
        });
    }

    function applyMobileFeatureSet() {
        document.documentElement.classList.add('mobile-companion-mode');
        ['tab-prepackage', 'tab-recipes', 'tab-drug-info', 'tab-help'].forEach(id => document.getElementById(id)?.setAttribute('hidden', ''));
        const dashboard = document.getElementById('panel-dashboard');
        if (dashboard && !document.getElementById('mobile-companion-panel')) {
            const panel = document.createElement('section');
            panel.id = 'mobile-companion-panel';
            panel.className = 'mobile-companion-panel';
            dashboard.prepend(panel);
        }
        const deviceName = window.innerWidth >= 700 ? 'iPad' : 'iPhone';
        document.querySelector('.app-window > .title-bar .title-bar-text')?.replaceChildren(document.createTextNode(`PharmAtlas ${deviceName}`));
        installMobileNavigation();
        renderMobileCompanionPanel();
    }

    async function initializeMobileRuntime() {
        await mobileSettingsReady;
        applyMobileFeatureSet();
        setInterval(() => {
            if (document.visibilityState === 'visible' && mobileSettings.pairing) syncWithDesktop(lastMobileDatabase, true);
        }, 15000);
    }

    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initializeMobileRuntime, { once: true });
    else initializeMobileRuntime();

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && mobileSettings.pairing) syncWithDesktop(lastMobileDatabase, true);
    });
    window.addEventListener('online', () => {
        renderMobileCompanionPanel();
        if (mobileSettings.pairing) syncWithDesktop(lastMobileDatabase, true);
    });
    window.addEventListener('offline', renderMobileCompanionPanel);
})();
