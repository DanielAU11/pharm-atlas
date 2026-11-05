const assert = require('assert');
const SyncCore = require('../sync-core');

const initial = {
    family: [{ id: 'member-1', firstName: 'Jordan' }],
    inventory: [{ id: 'med-1', name: 'Medication A', stock: 20 }],
    schedules: [{ id: 'schedule-1', medId: 'med-1', times: ['08:00'] }],
    settings: { theme: 'classic' }
};

const firstPhoneCopy = {
    ...initial,
    inventory: [{ id: 'med-1', name: 'Old phone name', stock: 15 }, { id: 'med-phone', name: 'Phone-only medication', stock: 4 }]
};
const firstMerge = SyncCore.mergeDatabases(initial, firstPhoneCopy, 'desktop');
assert.equal(firstMerge.inventory.find(item => item.id === 'med-1').name, 'Medication A', 'Desktop must win an unstamped first-pair tie.');
assert.ok(firstMerge.inventory.some(item => item.id === 'med-phone'), 'Unique phone records must be added.');

const phoneEdit = SyncCore.prepareDatabase(initial, {
    ...initial,
    inventory: [{ id: 'med-1', name: 'Medication A', stock: 12 }]
}, 'phone', '2026-11-05T10:00:00.000Z');
const editMerge = SyncCore.mergeDatabases(initial, phoneEdit, 'desktop');
assert.equal(editMerge.inventory[0].stock, 12, 'A newer phone edit must reach desktop.');

const phoneDelete = SyncCore.prepareDatabase(phoneEdit, { ...phoneEdit, schedules: [] }, 'phone', '2026-11-05T10:05:00.000Z');
const deleteMerge = SyncCore.mergeDatabases(editMerge, phoneDelete, 'desktop');
assert.equal(deleteMerge.schedules.length, 0, 'A newer phone deletion must remove the desktop record.');
const staleResurrection = SyncCore.mergeDatabases(deleteMerge, initial, 'desktop');
assert.equal(staleResurrection.schedules.length, 0, 'A tombstone must prevent stale schedule resurrection.');

const desktopEdit = SyncCore.prepareDatabase(editMerge, {
    ...editMerge,
    inventory: [{ ...editMerge.inventory[0], stock: 9 }]
}, 'desktop', '2026-11-05T11:00:00.000Z');
const stalePhoneMerge = SyncCore.mergeDatabases(desktopEdit, phoneEdit, 'desktop');
assert.equal(stalePhoneMerge.inventory[0].stock, 9, 'A stale phone edit must not replace a newer desktop edit.');

const phonePull = SyncCore.mergeDatabases(firstPhoneCopy, initial, 'phone', '2026-11-05T12:00:00.000Z', { preferIncomingOnTie: true });
assert.equal(phonePull.inventory.find(item => item.id === 'med-1').name, 'Medication A', 'A first phone pull must accept the desktop copy on a legacy tie.');

process.stdout.write(JSON.stringify({ passed: 7, tombstones: phoneDelete.syncTombstones.length }, null, 2));
