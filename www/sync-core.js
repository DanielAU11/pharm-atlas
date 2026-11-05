(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PharmAtlasSyncCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
    const META_FIELDS = new Set(['_syncUpdatedAt', '_syncDeviceId']);

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function canonical(value) {
        if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).filter(key => !META_FIELDS.has(key)).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
        }
        return JSON.stringify(value);
    }

    function recordTime(record) {
        const candidates = [record?._syncUpdatedAt, record?.updatedAt, record?.modifiedAt, record?.timestamp, record?.createdAt];
        for (const value of candidates) {
            const parsed = Date.parse(value || '');
            if (Number.isFinite(parsed)) return parsed;
        }
        return 0;
    }

    function isRecordCollection(value) {
        return Array.isArray(value) && value.some(item => item && typeof item === 'object' && item.id != null);
    }

    function collectionNames(...databases) {
        const names = new Set();
        databases.forEach(database => Object.entries(database || {}).forEach(([key, value]) => {
            if (key !== 'syncTombstones' && isRecordCollection(value)) names.add(key);
        }));
        return [...names];
    }

    function newestByKey(items, keyFor) {
        const map = new Map();
        (items || []).forEach(item => {
            const key = keyFor(item);
            if (!key) return;
            const existing = map.get(key);
            if (!existing || recordTime(item) >= recordTime(existing)) map.set(key, clone(item));
        });
        return map;
    }

    function prepareDatabase(previous, next, deviceId, now = new Date().toISOString()) {
        const before = previous && typeof previous === 'object' ? previous : {};
        const prepared = clone(next && typeof next === 'object' ? next : {});
        const tombstones = newestByKey(
            [...(before.syncTombstones || []), ...(prepared.syncTombstones || [])],
            item => `${item?.collection || ''}|${item?.id || ''}`
        );

        collectionNames(before, prepared).forEach(collection => {
            const oldRows = new Map((before[collection] || []).filter(row => row?.id != null).map(row => [String(row.id), row]));
            const nextRows = Array.isArray(prepared[collection]) ? prepared[collection] : [];
            const nextIds = new Set();
            prepared[collection] = nextRows.map(row => {
                if (!row || row.id == null) return row;
                const id = String(row.id);
                nextIds.add(id);
                const old = oldRows.get(id);
                if (!old || canonical(old) !== canonical(row)) {
                    return { ...row, _syncUpdatedAt: now, _syncDeviceId: deviceId };
                }
                if (row._syncUpdatedAt || old._syncUpdatedAt) {
                    return { ...row, _syncUpdatedAt: row._syncUpdatedAt || old._syncUpdatedAt, _syncDeviceId: row._syncDeviceId || old._syncDeviceId || deviceId };
                }
                return row;
            });
            oldRows.forEach((row, id) => {
                if (nextIds.has(id)) return;
                const key = `${collection}|${id}`;
                const deletion = { collection, id, deletedAt: now, _syncUpdatedAt: now, _syncDeviceId: deviceId };
                const existing = tombstones.get(key);
                if (!existing || recordTime(deletion) >= recordTime(existing)) tombstones.set(key, deletion);
            });
        });

        if (canonical(before.settings || {}) !== canonical(prepared.settings || {})) {
            prepared._syncSettingsUpdatedAt = now;
            prepared._syncSettingsDeviceId = deviceId;
        } else {
            prepared._syncSettingsUpdatedAt = prepared._syncSettingsUpdatedAt || before._syncSettingsUpdatedAt || now;
            prepared._syncSettingsDeviceId = prepared._syncSettingsDeviceId || before._syncSettingsDeviceId || deviceId;
        }
        prepared.syncTombstones = [...tombstones.values()];
        prepared._syncRootUpdatedAt = now;
        prepared._syncRootDeviceId = deviceId;
        return prepared;
    }

    function mergeDatabases(local, incoming, deviceId, now = new Date().toISOString(), options = {}) {
        const left = clone(local && typeof local === 'object' ? local : {});
        const right = clone(incoming && typeof incoming === 'object' ? incoming : {});
        const merged = { ...left };
        const tombstones = newestByKey(
            [...(left.syncTombstones || []), ...(right.syncTombstones || [])],
            item => `${item?.collection || ''}|${item?.id || ''}`
        );

        collectionNames(left, right).forEach(collection => {
            const rows = new Map();
            const consider = (row, sourcePriority) => {
                if (!row || row.id == null) return;
                const id = String(row.id);
                const current = rows.get(id);
                const tieWins = options.preferIncomingOnTie === true && sourcePriority > current?.priority;
                if (!current || recordTime(row) > recordTime(current.row) || (recordTime(row) === recordTime(current.row) && tieWins)) {
                    rows.set(id, { row: clone(row), priority: sourcePriority });
                }
            };
            (left[collection] || []).forEach(row => consider(row, 1));
            (right[collection] || []).forEach(row => consider(row, 2));
            merged[collection] = [...rows.entries()]
                .filter(([id, value]) => {
                    const deletion = tombstones.get(`${collection}|${id}`);
                    return !deletion || recordTime(value.row) > recordTime(deletion);
                })
                .map(([, value]) => value.row);
        });

        const leftSettingsTime = Date.parse(left._syncSettingsUpdatedAt || '') || 0;
        const rightSettingsTime = Date.parse(right._syncSettingsUpdatedAt || '') || 0;
        if (rightSettingsTime > leftSettingsTime || (rightSettingsTime === leftSettingsTime && options.preferIncomingOnTie === true)) {
            merged.settings = clone(right.settings || {});
            merged._syncSettingsUpdatedAt = right._syncSettingsUpdatedAt;
            merged._syncSettingsDeviceId = right._syncSettingsDeviceId;
        } else {
            merged.settings = clone(left.settings || right.settings || {});
            merged._syncSettingsUpdatedAt = left._syncSettingsUpdatedAt || right._syncSettingsUpdatedAt || now;
            merged._syncSettingsDeviceId = left._syncSettingsDeviceId || right._syncSettingsDeviceId || deviceId;
        }

        const leftRoot = Date.parse(left._syncRootUpdatedAt || '') || 0;
        const rightRoot = Date.parse(right._syncRootUpdatedAt || '') || 0;
        const newerRoot = rightRoot > leftRoot || (rightRoot === leftRoot && options.preferIncomingOnTie === true) ? right : left;
        Object.keys(newerRoot).forEach(key => {
            if (key === 'settings' || key === 'syncTombstones' || isRecordCollection(newerRoot[key])) return;
            merged[key] = clone(newerRoot[key]);
        });
        merged.syncTombstones = [...tombstones.values()];
        merged._syncRootUpdatedAt = now;
        merged._syncRootDeviceId = deviceId;
        return merged;
    }

    return { canonical, recordTime, prepareDatabase, mergeDatabases };
});
