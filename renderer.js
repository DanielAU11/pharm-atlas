const emptyDb = {
    family: [],
    inventory: [],
    schedules: [],
    history: [],
    recipes: [],
    compoundPreps: [],
    vitals: [],
    orderSets: [],
    prescribers: [],
    reminderLog: [],
    prepackQueues: [],
    formularyItems: [],
    inventoryOrders: [],
    medKits: [],
    auditTrail: [],
    settings: {}
};
let db = { ...emptyDb };
let currentEditingMedId = null;
let currentEditingMemberId = null;
const notifiedDoseKeys = new Set();
const componentUnitOptions = ['mg', 'mL', 'mg/mL', 'mg/g', 'mEq', 'IU', 'mcg', 'g', 'g/g', '%', 'units', 'U/mL', 'CFU'];
const componentPerUnitOptions = ['', 'mL', 'g', 'mg', 'tablet', 'capsule', 'packet', 'spray', 'drop', 'inhalation', 'patch', 'suppository'];
const formulationDoseUnits = {
    Tablets: 'tablet',
    Capsules: 'capsule',
    mL: 'mL',
    Powder: 'g',
    Granules: 'packet',
    Packet: 'packet',
    Inhalations: 'inhalation',
    Sprays: 'spray',
    Suppository: 'suppository',
    Cream: 'application',
    Ointment: 'application',
    Gel: 'application',
    'Topical Packet': 'application',
    'Topical Solution': 'application',
    Patch: 'patch',
    Drops: 'drop',
    Other: 'unit'
};
const dosageFormDefinitions = {
    Tablets: { label: 'Tablets', stockUnit: 'tablet', adminUnit: 'tablet', perUnit: 'tablet', strengthStyle: 'per-unit' },
    Capsules: { label: 'Capsules', stockUnit: 'capsule', adminUnit: 'capsule', perUnit: 'capsule', strengthStyle: 'per-unit' },
    mL: { label: 'Liquid (mL)', stockUnit: 'mL', adminUnit: 'mL', perUnit: 'mL', strengthStyle: 'concentration' },
    Powder: { label: 'Powder / Bulk Powder', stockUnit: 'g', adminUnit: 'g', perUnit: 'g', strengthStyle: 'bulk' },
    Granules: { label: 'Granules', stockUnit: 'packet', adminUnit: 'packet', perUnit: 'packet', strengthStyle: 'per-unit' },
    Packet: { label: 'Packet', stockUnit: 'packet', adminUnit: 'packet', perUnit: 'packet', strengthStyle: 'per-unit' },
    Inhalations: { label: 'Inhalations', stockUnit: 'inhalation', adminUnit: 'inhalation', perUnit: 'inhalation', strengthStyle: 'per-unit' },
    Sprays: { label: 'Sprays', stockUnit: 'spray', adminUnit: 'spray', perUnit: 'spray', strengthStyle: 'per-unit' },
    Suppository: { label: 'Suppository', stockUnit: 'suppository', adminUnit: 'suppository', perUnit: 'suppository', strengthStyle: 'per-unit' },
    Cream: { label: 'Cream', stockUnit: 'tube', adminUnit: 'application', perUnit: 'g', strengthStyle: 'topical', containerTracking: true, containerUnit: 'tube' },
    Ointment: { label: 'Ointment', stockUnit: 'tube', adminUnit: 'application', perUnit: 'g', strengthStyle: 'topical', containerTracking: true, containerUnit: 'tube' },
    Gel: { label: 'Gel', stockUnit: 'tube', adminUnit: 'application', perUnit: 'g', strengthStyle: 'topical', containerTracking: true, containerUnit: 'tube' },
    'Topical Packet': { label: 'Topical Packet', stockUnit: 'packet', adminUnit: 'application', perUnit: 'packet', strengthStyle: 'topical', containerTracking: true, containerUnit: 'packet' },
    'Topical Solution': { label: 'Topical Solution', stockUnit: 'bottle', adminUnit: 'application', perUnit: 'mL', strengthStyle: 'topical', containerTracking: true, containerUnit: 'bottle' },
    Patch: { label: 'Patch', stockUnit: 'patch', adminUnit: 'patch', perUnit: 'patch', strengthStyle: 'per-unit' },
    Drops: { label: 'Drops', stockUnit: 'drop', adminUnit: 'drop', perUnit: 'drop', strengthStyle: 'per-unit' },
    Other: { label: 'Unit Dose', stockUnit: 'unit', adminUnit: 'unit', perUnit: 'unit', strengthStyle: 'per-unit' }
};
const glucoseGoalPresets = {
    diabetic: { low: 70, high: 180 },
    nondiabetic: { low: 70, high: 140 },
    custom: { low: 70, high: 180 }
};
const defaultBpGoals = { systolicLow: 90, systolicHigh: 130, diastolicLow: 60, diastolicHigh: 80 };
const defaultHrGoals = { low: 60, high: 100 };
const defaultWeightGoals = { low: '', high: '', unit: 'lb' };
let memberTimelineStart = null;
let dashboardCalendarStart = localDateKey();
let memberCalendarStart = localDateKey();
let activePrepackQueueId = null;
let activeMedKitId = null;
let activeCompoundRecipeId = null;
let prepackScanTimer = null;
let pendingScheduleOrders = [];
let pendingNewMedImage = null;
let pendingModalMedImage = null;
let modalBarcodeCodes = [];
let orderSetRowCounter = 0;
let lastDataConflictBackup = '';

window.addEventListener('DOMContentLoaded', async () => {
    const loadedData = await window.api.load();
    db = { ...emptyDb, ...loadedData, settings: { ...emptyDb.settings, ...(loadedData?.settings || {}) } };
    const medicationCodesAdded = ensureMedicationCodes();
    const completionStatesAdded = updateScheduleCompletionStates();
    renderAll();
    refreshDataLocation();
    maybeOpenFirstRunSetupGuide();
    renderFrequencyControls('sched');
    updateInventoryEntryMode();
    setupImageDropzone('med-image-dropzone', image => { pendingNewMedImage = image; });
    setupImageDropzone('modal-image-dropzone', image => {
        pendingModalMedImage = image;
        const container = document.getElementById('modal-image-container');
        if (container) container.innerHTML = `<img src="${image.preview}" style="max-width:100%; max-height:100%;">`;
    });
    checkSchedules();
    if (medicationCodesAdded || completionStatesAdded) await window.api.save(db);
});

// Helper: Convert file to Base64 for saving
const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
});

async function imageFileToPending(file) {
    if (!file || !file.type?.startsWith('image/')) return null;
    const base64 = await toBase64(file);
    return {
        base64,
        name: file.name || `pasted_image_${Date.now()}.png`,
        preview: `data:${file.type || 'image/png'};base64,${base64}`
    };
}

function imageUrlToPending(value) {
    const url = String(value || '').trim();
    if (!/^https?:\/\//i.test(url)) return null;
    return {
        base64: '',
        name: `linked_image_${Date.now()}.png`,
        preview: url,
        remoteUrl: url
    };
}

function updateImageDropzone(zoneId, pendingImage) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.innerHTML = pendingImage
        ? `<img src="${pendingImage.preview}" alt="Medication preview"><span>Paste or drop to replace</span>`
        : 'Paste or drop image here';
}

function setupImageDropzone(zoneId, assignPending) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    const acceptFile = async file => {
        const pending = await imageFileToPending(file);
        if (!pending) return;
        assignPending(pending);
        updateImageDropzone(zoneId, pending);
    };
    const acceptUrl = value => {
        const pending = imageUrlToPending(value);
        if (!pending) return false;
        assignPending(pending);
        updateImageDropzone(zoneId, pending);
        return true;
    };
    zone.addEventListener('dragover', event => {
        event.preventDefault();
        zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', event => {
        event.preventDefault();
        zone.classList.remove('drag-over');
        const file = Array.from(event.dataTransfer?.files || []).find(item => item.type?.startsWith('image/'));
        if (file) {
            void acceptFile(file);
        } else if (acceptUrl(event.dataTransfer?.getData('text/uri-list')) || acceptUrl(event.dataTransfer?.getData('text/plain'))) {
            event.preventDefault();
        }
    });
    zone.addEventListener('paste', event => {
        const file = Array.from(event.clipboardData?.items || [])
            .map(item => item.kind === 'file' ? item.getAsFile() : null)
            .find(fileItem => fileItem?.type?.startsWith('image/'));
        if (file) {
            event.preventDefault();
            void acceptFile(file);
        } else if (acceptUrl(event.clipboardData?.getData('text/plain'))) {
            event.preventDefault();
        }
    });
}

async function savePendingMedicationImage(pendingImage) {
    if (!pendingImage) return null;
    if (pendingImage.remoteUrl) return pendingImage.remoteUrl;
    const safeName = String(pendingImage.name || `image_${Date.now()}.png`).replace(/\s/g, '_').replace(/[^\w.\-]/g, '_');
    return window.api.saveImage(`img_${Date.now()}_${safeName}`, pendingImage.base64);
}

function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeMedicationCode(value) {
    return String(value || '').trim().toUpperCase();
}

function medicationCodes(med) {
    const codes = [
        med?.barcodeCode,
        ...(Array.isArray(med?.barcodeCodes) ? med.barcodeCodes : [])
    ].map(normalizeMedicationCode).filter(Boolean);
    return Array.from(new Set(codes));
}

function addMedicationBarcode(med, code) {
    const normalized = normalizeMedicationCode(code);
    if (!med || !normalized) return false;
    const codes = medicationCodes(med);
    if (codes.includes(normalized)) return false;
    med.barcodeCodes = [...codes, normalized];
    if (!med.barcodeCode) med.barcodeCode = normalized;
    return true;
}

function findInventoryByBarcode(code) {
    const normalized = normalizeMedicationCode(code);
    if (!normalized) return null;
    return db.inventory.find(med => medicationCodes(med).includes(normalized)) || null;
}

function barcodeConflictItems(code, excludedMedId = '') {
    const normalized = normalizeMedicationCode(code);
    if (!normalized) return [];
    return db.inventory.filter(med =>
        med.id !== excludedMedId && medicationCodes(med).includes(normalized)
    );
}

function barcodeConflictHtml(code, conflicts) {
    const items = conflicts.map(med =>
        `<li>${escapeHtml(inventoryDisplayName(med))}</li>`
    ).join('');
    return `<div class="barcode-warning">
        The barcode/QR code <strong>${escapeHtml(normalizeMedicationCode(code))}</strong> already matches:
        <ul>${items}</ul>
        Use a different code or edit the existing inventory item instead.
    </div>`;
}

async function warnBarcodeConflict(code, excludedMedId = '') {
    const conflicts = barcodeConflictItems(code, excludedMedId);
    if (conflicts.length === 0) return false;
    await showActionModal('Barcode Conflict', barcodeConflictHtml(code, conflicts), 'OK');
    return true;
}

function createMedicationCode() {
    let code = '';
    do {
        code = `PA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    } while (db.inventory.some(med => medicationCodes(med).includes(code)));
    return code;
}

function ensureMedicationCodes() {
    let changed = false;
    const used = new Set();
    db.inventory.forEach(med => {
        let code = normalizeMedicationCode(med.barcodeCode);
        if (!code || used.has(code)) {
            code = createMedicationCode();
            med.barcodeCode = code;
            changed = true;
        } else if (med.barcodeCode !== code) {
            med.barcodeCode = code;
            changed = true;
        }
        const codes = medicationCodes(med);
        if (!Array.isArray(med.barcodeCodes) || med.barcodeCodes.join('|') !== codes.join('|')) {
            med.barcodeCodes = codes;
            changed = true;
        }
        codes.forEach(item => used.add(item));
    });
    return changed;
}

window.generateMedicationCode = function(inputId) {
    const input = document.getElementById(inputId);
    if (input) input.value = createMedicationCode();
};

function collectProfileBarcodeCodes(includePendingInput = true) {
    const pendingInput = includePendingInput
        ? normalizeMedicationCode(document.getElementById('modal-barcode-code')?.value)
        : '';
    return Array.from(new Set([
        ...modalBarcodeCodes.map(normalizeMedicationCode),
        pendingInput
    ].filter(Boolean)));
}

function renderModalBarcodeCodes() {
    const container = document.getElementById('modal-barcode-list');
    if (!container) return;
    const codes = collectProfileBarcodeCodes(false);
    if (codes.length === 0) {
        container.innerHTML = '<span class="barcode-code-empty">No codes assigned yet.</span>';
        return;
    }
    container.innerHTML = codes.map((code, index) => `
        <div class="barcode-code-row ${index === 0 ? 'primary' : ''}">
            <span>
                <strong>${index === 0 ? 'Primary' : 'Alias'}</strong>
                ${escapeHtml(code)}
            </span>
            ${index === 0
                ? '<span class="barcode-code-primary">prints on labels</span>'
                : `<button type="button" data-code="${escapeHtml(code)}" onclick="setPrimaryModalBarcodeCode(this.dataset.code)">Make Primary</button>`}
            <button type="button" data-code="${escapeHtml(code)}" onclick="removeModalBarcodeCode(this.dataset.code)">X</button>
        </div>
    `).join('');
}

window.addModalBarcodeCode = async function() {
    const input = document.getElementById('modal-barcode-code');
    const code = normalizeMedicationCode(input?.value || createMedicationCode());
    if (!code) return;
    if (code.length > 100) {
        await appAlert('Enter a QR/barcode code containing no more than 100 characters.');
        return;
    }
    if (modalBarcodeCodes.map(normalizeMedicationCode).includes(code)) {
        await appAlert('That QR/barcode code is already assigned to this medication.');
        if (input) input.value = '';
        return;
    }
    if (await warnBarcodeConflict(code, currentEditingMedId)) return;
    modalBarcodeCodes = [...modalBarcodeCodes, code];
    if (input) input.value = '';
    renderModalBarcodeCodes();
};

window.removeModalBarcodeCode = function(code) {
    const normalized = normalizeMedicationCode(code);
    modalBarcodeCodes = modalBarcodeCodes.filter(item => normalizeMedicationCode(item) !== normalized);
    renderModalBarcodeCodes();
};

window.setPrimaryModalBarcodeCode = function(code) {
    const normalized = normalizeMedicationCode(code);
    if (!normalized) return;
    modalBarcodeCodes = [normalized, ...modalBarcodeCodes.filter(item => normalizeMedicationCode(item) !== normalized)];
    renderModalBarcodeCodes();
};

function medicationCodeIsAvailable(code, excludedMedId = '') {
    const normalized = normalizeMedicationCode(code);
    return normalized && barcodeConflictItems(normalized, excludedMedId).length === 0;
}

function medicationQrDataUrl(code) {
    if (typeof window.qrcode !== 'function') return '';
    const qr = window.qrcode(0, 'M');
    qr.addData(normalizeMedicationCode(code));
    qr.make();
    return qr.createDataURL(4, 1);
}

// Helper to parse "YYYY-MM-DD" as a local date (avoiding UTC shift)
function parseLocal(dateStr) {
    if (!dateStr || dateStr === "Ongoing") return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function daysBetween(dateA, dateB) {
    const oneDayMs = 1000 * 60 * 60 * 24;
    const first = parseLocal(dateA);
    const second = parseLocal(dateB);
    if (!first || !second) return NaN;
    const firstUtc = Date.UTC(first.getFullYear(), first.getMonth(), first.getDate());
    const secondUtc = Date.UTC(second.getFullYear(), second.getMonth(), second.getDate());
    return Math.floor((firstUtc - secondUtc) / oneDayMs);
}

function dateKeysInRange(startDate, endDate) {
    const start = parseLocal(startDate);
    const end = parseLocal(endDate);
    if (!start || !end || end < start) return [];
    const dates = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        dates.push(localDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
}

function addDaysKey(dateStr, days) {
    const date = parseLocal(dateStr);
    if (!date) return '';
    date.setDate(date.getDate() + days);
    return localDateKey(date);
}

function dateRangeKeys(startDate, endDate) {
    const start = parseLocal(startDate);
    const end = parseLocal(endDate);
    if (!start || !end || end < start) return [];
    const keys = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        keys.push(localDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
}

function addAudit(action, subject = '', details = '', meta = {}) {
    db.auditTrail = Array.isArray(db.auditTrail) ? db.auditTrail : [];
    db.auditTrail.unshift({
        id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: new Date().toISOString(),
        action,
        subject,
        details,
        meta
    });
    db.auditTrail = db.auditTrail.slice(0, 1000);
}

function auditDisplayTime(entry) {
    const date = new Date(entry.timestamp || Date.now());
    return Number.isNaN(date.getTime()) ? String(entry.timestamp || '') : date.toLocaleString();
}

function medicationDailyUseEstimate(medId, days = 28) {
    const today = localDateKey();
    const end = addDaysKey(today, days - 1);
    const total = db.schedules
        .filter(schedule => schedule.medId === medId && !isScheduleArchived(schedule) && schedule.freq !== 'PRN')
        .reduce((sum, schedule) => {
            const med = db.inventory.find(item => item.id === schedule.medId);
            if (!med || usesContainerTracking(med)) return sum;
            return sum + getScheduleInstancesInRange(schedule, today, end).length * parseAmount(schedule.doseQty, 0);
        }, 0);
    return total / days;
}

function refillForecastForMed(med) {
    if (!med || usesContainerTracking(med)) return null;
    const dailyUse = medicationDailyUseEstimate(med.id);
    if (!Number.isFinite(dailyUse) || dailyUse <= 0) return null;
    const stock = parseAmount(med.stock, 0);
    const daysRemaining = Math.max(0, Math.floor(stock / dailyUse));
    return {
        dailyUse,
        daysRemaining,
        runOutDate: addDaysKey(localDateKey(), daysRemaining)
    };
}

function refillForecastText(med) {
    const forecast = refillForecastForMed(med);
    if (!forecast) return '';
    return `~${forecast.daysRemaining} day${forecast.daysRemaining === 1 ? '' : 's'} left; runs out ${forecast.runOutDate}`;
}

function timeToMinutes(time) {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return (hours * 60) + minutes;
}

function minutesToTime(totalMinutes) {
    const normalized = ((totalMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60).toString().padStart(2, '0');
    const minutes = (normalized % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

function generateIntervalTimes(startTime, intervalHours) {
    const start = timeToMinutes(startTime);
    const interval = parseInt(intervalHours, 10);
    if (start === null || !Number.isInteger(interval) || interval < 1 || interval > 24) return [];

    const times = [];
    const step = interval * 60;
    for (let elapsed = 0; elapsed < 1440; elapsed += step) {
        times.push(minutesToTime(start + elapsed));
    }
    return times;
}

function dateTimeFromParts(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    const date = parseLocal(dateStr);
    const minutes = timeToMinutes(timeStr);
    if (!date || minutes === null) return null;
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return date;
}

function dateTimeParts(date) {
    return {
        date: localDateKey(date),
        time: `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
    };
}

function intervalAnchorDateTime(schedule, useRolling = true) {
    if (!schedule || schedule.freq !== 'QXH') return null;
    const rolling = useRolling && schedule.rollingAnchorDate && schedule.rollingAnchorTime
        ? dateTimeFromParts(schedule.rollingAnchorDate, schedule.rollingAnchorTime)
        : null;
    return rolling || dateTimeFromParts(schedule.startDate, schedule.startTime || schedule.times?.[0]);
}

function latestIntervalAnchorFromHistory(schedule) {
    if (!schedule || schedule.freq !== 'QXH') return null;
    return db.history
        .filter(entry => entry.scheduleId === schedule.id && ['late', 'early'].includes(entry.doseStatus || 'given'))
        .map(entry => historyEntryDateTime(entry))
        .filter(parts => parts.date && parts.time)
        .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0] || null;
}

function effectiveIntervalRollingAnchor(schedule) {
    if (!schedule || schedule.freq !== 'QXH') return null;
    const savedAnchor = schedule.rollingAnchorDate && schedule.rollingAnchorTime
        ? { date: schedule.rollingAnchorDate, time: schedule.rollingAnchorTime }
        : null;
    const historyAnchor = latestIntervalAnchorFromHistory(schedule);
    const latest = [savedAnchor, historyAnchor]
        .filter(Boolean)
        .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0];
    return latest ? dateTimeFromParts(latest.date, latest.time) : null;
}

function intervalInstancesBetween(schedule, from, through, stopBefore = null) {
    const interval = parseInt(schedule?.intervalHours, 10);
    const anchor = intervalAnchorDateTime(schedule, false);
    if (!anchor || !Number.isInteger(interval) || interval < 1 || interval > 24) return [];

    const stepMs = interval * 60 * 60 * 1000;
    let cursor = new Date(anchor);
    if (cursor < from) {
        const steps = Math.max(0, Math.ceil((from - cursor) / stepMs));
        cursor = new Date(cursor.getTime() + (steps * stepMs));
    }

    const instances = [];
    const hardStop = stopBefore && stopBefore < through ? stopBefore : through;
    while (cursor <= hardStop) {
        if (!stopBefore || cursor < stopBefore) instances.push(new Date(cursor));
        cursor = new Date(cursor.getTime() + stepMs);
    }
    return instances;
}

function rollingIntervalInstancesBetween(schedule, from, through) {
    const interval = parseInt(schedule?.intervalHours, 10);
    const originalAnchor = intervalAnchorDateTime(schedule, false);
    const rollingAnchor = effectiveIntervalRollingAnchor(schedule);
    const anchor = rollingAnchor || intervalAnchorDateTime(schedule, true);
    if (!anchor || !Number.isInteger(interval) || interval < 1 || interval > 24) return [];

    const isUsingRollingAnchor = !!(rollingAnchor && anchor.getTime() === rollingAnchor.getTime());
    const instances = [];
    if (rollingAnchor && originalAnchor && rollingAnchor > originalAnchor && from < rollingAnchor) {
        instances.push(...intervalInstancesBetween(schedule, from, through, rollingAnchor));
    }

    const stepMs = interval * 60 * 60 * 1000;
    let cursor = new Date(isUsingRollingAnchor ? anchor.getTime() + stepMs : anchor.getTime());
    if (cursor < from) {
        const steps = Math.max(0, Math.ceil((from - cursor) / stepMs));
        cursor = new Date(cursor.getTime() + (steps * stepMs));
    }
    while (cursor <= through) {
        instances.push(new Date(cursor));
        cursor = new Date(cursor.getTime() + stepMs);
    }

    const byKey = new Map();
    instances.forEach(date => {
        const parts = dateTimeParts(date);
        byKey.set(`${parts.date}|${parts.time}`, date);
    });
    return Array.from(byKey.values()).sort((a, b) => a - b);
}

function intervalPreviewHistoryRows(schedule, dateKey) {
    if (!schedule) return [];
    return db.history
        .filter(entry => entry.scheduleId === schedule.id && historyEntryDateKey(entry) === dateKey && isGivenStatus(entry.doseStatus || 'given'))
        .map(entry => ({
            date: dateKey,
            time: historyEntryDateTime(entry).time,
            administered: true,
            entryId: entry.id
        }));
}

function getIntervalPreviewRows(prefix) {
    const startDate = document.getElementById(prefix === 'mod' ? 'mod-start' : 'sched-start')?.value || localDateKey();
    const endValue = document.getElementById(prefix === 'mod' ? 'mod-end' : 'sched-end')?.value || '';
    const intervalHours = parseInt(document.getElementById(prefix === 'mod' ? 'mod-interval-hours' : 'sched-interval-hours')?.value, 10);
    const startTime = document.querySelector(`#${prefix === 'mod' ? 'mod-time-fields' : 'sched-time-fields'} .${prefix}-time-input`)?.value;
    if (!startDate || !startTime || !Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 24) return { dates: [], rows: [] };

    const today = localDateKey();
    const isModifier = prefix === 'mod';
    const previewStartKey = isModifier ? addDaysKey(today, -1) : startDate;
    const previewEndKey = isModifier ? addDaysKey(today, 2) : addDaysKey(startDate, 2);
    const scheduleStart = isModifier && startDate < today ? today : startDate;
    const previewEnd = parseLocal(previewEndKey);
    const endDate = endValue ? parseLocal(endValue) : null;
    const through = endDate && endDate < previewEnd ? endDate : previewEnd;
    through.setHours(23, 59, 59, 999);

    const scheduleId = document.getElementById('mod-sched-id')?.value || '';
    const existingSchedule = isModifier ? db.schedules.find(item => item.id === scheduleId) : null;
    const historyAnchor = latestIntervalAnchorFromHistory(existingSchedule);
    const schedule = {
        id: scheduleId || 'preview',
        freq: 'QXH',
        startDate: scheduleStart,
        endDate: endValue || 'Ongoing',
        startTime,
        times: [startTime],
        intervalHours,
        rollingAnchorDate: existingSchedule?.rollingAnchorDate || historyAnchor?.date || '',
        rollingAnchorTime: existingSchedule?.rollingAnchorTime || historyAnchor?.time || ''
    };
    const from = dateTimeFromParts(scheduleStart, startTime);
    const previewDates = dateKeysInRange(previewStartKey, localDateKey(through));
    const generatedRows = rollingIntervalInstancesBetween(schedule, from, through)
        .filter(date => {
            const parts = dateTimeParts(date);
            return isScheduleDueOnDate(schedule, parts.date);
        })
        .map(date => {
            const parts = dateTimeParts(date);
            const instance = { ...parts, key: scheduleInstanceKey(scheduleId || 'preview', parts.date, parts.time) };
            const documented = existingSchedule ? findHistoryForScheduleInstance(existingSchedule, instance) : null;
            return { ...parts, administered: !!documented && isGivenStatus(documented.doseStatus || 'given'), entryId: documented?.id || '' };
        });
    const yesterdayRows = isModifier ? intervalPreviewHistoryRows(existingSchedule, previewStartKey) : [];
    const rowKeys = new Set();
    const rows = [...yesterdayRows, ...generatedRows].filter(row => {
        const key = `${row.date}|${row.time}`;
        if (rowKeys.has(key)) return false;
        rowKeys.add(key);
        return true;
    });
    return { dates: previewDates, rows };
}

function renderIntervalPreview(prefix) {
    const preview = document.getElementById(`${prefix}-interval-preview`);
    if (!preview) return;
    const { dates, rows } = getIntervalPreviewRows(prefix);
    if (dates.length === 0) {
        preview.innerHTML = '<div class="interval-preview-empty">Enter a start date, start time, and interval to preview doses.</div>';
        return;
    }
    const grouped = dates.reduce((map, date) => {
        map.set(date, []);
        return map;
    }, new Map());
    rows.forEach(item => {
        if (!grouped.has(item.date)) grouped.set(item.date, []);
        grouped.get(item.date).push(item);
    });
    preview.innerHTML = `
        <table class="interval-preview-table">
            <thead><tr><th>Date</th><th>Administration times</th></tr></thead>
            <tbody>${Array.from(grouped.entries()).map(([date, times]) => {
                const displayTimes = times.length
                    ? times
                        .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))
                        .map(item => `<span class="${item.administered ? 'interval-preview-administered' : ''}">${escapeHtml(item.time)}</span>`)
                        .join(', ')
                    : '<span class="interval-preview-empty">-</span>';
                return `<tr><td>${escapeHtml(date)}</td><td>${displayTimes}</td></tr>`;
            }).join('')}</tbody>
        </table>`;
}

function weekStartDate(dateStr) {
    const date = parseLocal(dateStr);
    if (!date) return null;
    date.setDate(date.getDate() - date.getDay());
    date.setHours(0, 0, 0, 0);
    return date;
}

function weeksBetweenDates(dateStr, anchorStr) {
    const dateWeek = weekStartDate(dateStr);
    const anchorWeek = weekStartDate(anchorStr);
    if (!dateWeek || !anchorWeek) return NaN;
    const dateUtc = Date.UTC(dateWeek.getFullYear(), dateWeek.getMonth(), dateWeek.getDate());
    const anchorUtc = Date.UTC(anchorWeek.getFullYear(), anchorWeek.getMonth(), anchorWeek.getDate());
    return Math.floor((dateUtc - anchorUtc) / (7 * 24 * 60 * 60 * 1000));
}

function isScheduleDueOnDate(schedule, dateStr) {
    if (!schedule || schedule.freq === 'PRN') return false;
    if (!schedule.startDate || dateStr < schedule.startDate) return false;
    if (schedule.endDate !== "Ongoing" && schedule.endDate && dateStr > schedule.endDate) return false;
    if (Array.isArray(schedule.includedDates) && schedule.includedDates.length > 0 && !schedule.includedDates.includes(dateStr)) return false;

    if (schedule.freq === 'ONCE') {
        return dateStr === schedule.startDate;
    }

    if (schedule.freq === 'QOD') {
        const anchor = schedule.qodStart || schedule.startDate;
        const diff = daysBetween(dateStr, anchor);
        return diff >= 0 && diff % 2 === 0;
    }

    if (schedule.freq === 'QW') {
        const diff = daysBetween(dateStr, schedule.startDate);
        return diff >= 0 && diff % 7 === 0;
    }

    if (schedule.freq === 'QXW' || schedule.freq === 'XPW') {
        const current = parseLocal(dateStr);
        const weekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays.map(Number) : [];
        if (!current || !weekdays.includes(current.getDay())) return false;
        if (schedule.freq === 'XPW') return true;
        const weekDifference = weeksBetweenDates(dateStr, schedule.startDate);
        const intervalWeeks = parseInt(schedule.intervalWeeks, 10) || 1;
        return weekDifference >= 0 && weekDifference % intervalWeeks === 0;
    }

    if (schedule.freq === 'Monthly') {
        const current = parseLocal(dateStr);
        const start = parseLocal(schedule.startDate);
        const anchor = parseLocal(schedule.monthlyAnchor || schedule.startDate);
        if (!current || !start || !anchor || current < start || dateStr < localDateKey(anchor)) return false;
        const lastDayOfCurrentMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
        return current.getDate() === Math.min(anchor.getDate(), lastDayOfCurrentMonth);
    }

    return true;
}

function isScheduleArchived(schedule) {
    return ['completed', 'discontinued'].includes(schedule?.status);
}

function scheduleEndDateTime(schedule) {
    if (!schedule?.endDate || schedule.endDate === 'Ongoing') return null;
    const times = getScheduleTimes(schedule);
    if (times.length > 0) {
        const latest = times.slice().sort((a, b) => timeToMinutes(b) - timeToMinutes(a))[0];
        return new Date(`${schedule.endDate}T${latest}`);
    }
    const end = parseLocal(schedule.endDate);
    if (!end) return null;
    end.setHours(23, 59, 59, 999);
    return end;
}

function scheduleHasFinished(schedule, now = new Date()) {
    if (!schedule || schedule.status === 'discontinued') return false;
    if (schedule.status === 'completed') return true;
    const end = scheduleEndDateTime(schedule);
    return !!end && end < now;
}

function markScheduleCompleted(schedule, completedAt = new Date().toISOString()) {
    if (!schedule || isScheduleArchived(schedule)) return false;
    schedule.status = 'completed';
    schedule.completedAt = completedAt;
    return true;
}

function updateScheduleCompletionStates(now = new Date()) {
    let changed = false;
    db.schedules.forEach(schedule => {
        if (scheduleHasFinished(schedule, now)) {
            changed = markScheduleCompleted(schedule, now.toISOString()) || changed;
        }
    });
    db.orderSets.forEach(set => {
        if (!set.memberId) return;
        const schedules = db.schedules.filter(schedule => schedule.orderSetId === set.id);
        const complete = schedules.length > 0 && schedules.every(isScheduleArchived);
        if (complete && set.status !== 'completed') {
            set.status = 'completed';
            set.completedAt = now.toISOString();
            changed = true;
        }
        if (!complete && set.status === 'completed') {
            set.status = '';
            set.completedAt = '';
            changed = true;
        }
    });
    return changed;
}

function getScheduleTimes(schedule) {
    const times = Array.isArray(schedule.times) ? schedule.times.filter(Boolean) : [];
    if (schedule && schedule.freq === 'QXH' && times[0] && schedule.intervalHours) {
        return generateIntervalTimes(times[0], schedule.intervalHours);
    }
    return times;
}

function getExpectedTimeCount(freq) {
    return { ONCE: 1, QD: 1, Nightly: 1, QOD: 1, QW: 1, QXW: 1, XPW: 1, Monthly: 1, BID: 2, TID: 3, QID: 4 }[freq] || 0;
}

function formatFrequency(schedule) {
    if (!schedule) return '';
    const selectedDates = Array.isArray(schedule.includedDates) && schedule.includedDates.length > 0
        ? ` on ${schedule.includedDates.length} selected date${schedule.includedDates.length === 1 ? '' : 's'}`
        : '';
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const selectedDays = (schedule.weekdays || [])
        .map(day => dayNames[Number(day)])
        .filter(Boolean)
        .join(', ');
    if (schedule.freq === 'QXW') {
        const interval = parseInt(schedule.intervalWeeks, 10) || 1;
        return `Every ${interval} week${interval === 1 ? '' : 's'}${selectedDays ? ` on ${selectedDays}` : ''}${selectedDates}`;
    }
    if (schedule.freq === 'XPW') {
        const count = parseInt(schedule.timesPerWeek, 10) || schedule.weekdays?.length || 1;
        return `${count} time${count === 1 ? '' : 's'} per week${selectedDays ? ` on ${selectedDays}` : ''}${selectedDates}`;
    }
    if (schedule.freq === 'QXH') {
        const interval = parseInt(schedule.intervalHours, 10);
        return Number.isInteger(interval) && interval > 0 ? `Q${interval}H${selectedDates}` : `Every X Hours${selectedDates}`;
    }
    return `${schedule.freq || ''}${selectedDates}`;
}

function scheduleExceptionText(schedule) {
    const count = Array.isArray(schedule?.excludedInstances) ? schedule.excludedInstances.length : 0;
    return count ? ` | ${count} excluded dose${count === 1 ? '' : 's'}` : '';
}

function defaultTimeForIndex(index, freq = '') {
    if (freq === 'Nightly' && index === 0) return '21:00';
    return ['08:00', '12:00', '17:00', '21:00'][index] || '';
}

function getFieldIds(prefix) {
    return prefix === 'mod'
        ? {
            freq: 'mod-freq',
            timeFields: 'mod-time-fields',
            qodContainer: 'mod-qod-start-container',
            qodStart: 'mod-qod-start-date',
            intervalContainer: 'mod-interval-container',
            intervalHours: 'mod-interval-hours',
            weekIntervalContainer: 'mod-week-interval-container',
            intervalWeeks: 'mod-interval-weeks',
            monthlyContainer: 'mod-monthly-container',
            monthlyAnchor: 'mod-monthly-anchor',
            weeklyCountContainer: 'mod-weekly-count-container',
            timesPerWeek: 'mod-times-per-week',
            weekdayContainer: 'mod-weekday-container',
            prnContainer: 'mod-prn-limit-container',
            prnMaxDoses: 'mod-prn-max-doses',
            prnWindowHours: 'mod-prn-window-hours'
        }
        : {
            freq: 'sched-freq',
            timeFields: 'sched-time-fields',
            qodContainer: 'qod-start-container',
            qodStart: 'qod-start-date',
            intervalContainer: 'sched-interval-container',
            intervalHours: 'sched-interval-hours',
            weekIntervalContainer: 'sched-week-interval-container',
            intervalWeeks: 'sched-interval-weeks',
            monthlyContainer: 'sched-monthly-container',
            monthlyAnchor: 'sched-monthly-anchor',
            weeklyCountContainer: 'sched-weekly-count-container',
            timesPerWeek: 'sched-times-per-week',
            weekdayContainer: 'sched-weekday-container',
            prnContainer: 'sched-prn-limit-container',
            prnMaxDoses: 'sched-prn-max-doses',
            prnWindowHours: 'sched-prn-window-hours'
        };
}

async function refreshDataLocation(location = null) {
    if (!window.api?.getDataLocation && !location) return;
    try {
        const info = location || await window.api.getDataLocation();
        const status = document.getElementById('data-location-status');
        const pathEl = document.getElementById('data-location-path');
        if (status) status.textContent = info?.usingDefault ? 'Local desktop data folder' : 'Synced desktop data folder';
        if (pathEl) pathEl.textContent = info?.dataDir || 'Data folder unavailable in this build.';
    } catch (error) {
        console.error(error);
        const pathEl = document.getElementById('data-location-path');
        if (pathEl) pathEl.textContent = 'Unable to read data folder.';
    }
}

async function applyDataLocationResult(result, message) {
    if (!result) return;
    if (result.data) {
        db = { ...emptyDb, ...result.data, settings: { ...emptyDb.settings, ...(result.data?.settings || {}) } };
        pendingScheduleOrders = [];
        activePrepackQueueId = null;
        renderAll();
    }
    await refreshDataLocation(result);
    await appAlert(`${message}\n\nCurrent data folder:\n${result.dataDir}`, 'Data Folder Updated');
}

window.chooseDesktopSyncFolder = async function() {
    if (!window.api?.chooseSyncFolder) {
        await appAlert('Desktop sync folder support is not available in this build. Restart the desktop app and try again.');
        return;
    }
    if (!await appConfirm('Choose a folder managed by OneDrive, Google Drive Desktop, Dropbox, or another sync app. PharmAtlas will store db.json and medication images there. Continue?', 'Use Synced Folder')) return;
    try {
        const result = await window.api.chooseSyncFolder();
        await applyDataLocationResult(result, 'PharmAtlas is now using the selected synced folder.');
    } catch (error) {
        console.error(error);
        await appAlert('Unable to switch to that folder. Make sure the folder is available and writable.', 'Sync Folder Failed');
    }
};

window.useLocalDesktopDataFolder = async function() {
    if (!window.api?.useDefaultDataFolder) {
        await appAlert('Local data folder support is not available in this build. Restart the desktop app and try again.');
        return;
    }
    if (!await appConfirm('Switch back to the local Desktop\\PharmAtlasData folder? PharmAtlas can copy your current synced data back there.', 'Use Local Folder')) return;
    try {
        const result = await window.api.useDefaultDataFolder();
        await applyDataLocationResult(result, 'PharmAtlas is now using the local desktop data folder.');
    } catch (error) {
        console.error(error);
        await appAlert('Unable to switch back to the local folder.', 'Local Folder Failed');
    }
};

window.openFirstRunSetupGuide = async function() {
    await showActionModal('PharmAtlas Setup Guide', `
        <div class="setup-guide">
            <div class="setup-step"><strong>1. Add members</strong><span>Create each person profile, then add allergies, intolerances, diagnoses, providers, goals, and preferred calendar color.</span></div>
            <div class="setup-step"><strong>2. Add inventory</strong><span>Enter medication name, strength, formulation, stock unit, expiration, storage, assignment, barcode, and stock tracking mode.</span></div>
            <div class="setup-step"><strong>3. Schedule medications</strong><span>Stage orders in Pending Scheduled Medications, review safety warnings, then Schedule Medications.</span></div>
            <div class="setup-step"><strong>4. Print labels / prepackage</strong><span>Use individual labels, date-range labels, or Prepackage Meds when preparing doses ahead of time.</span></div>
            <div class="setup-step"><strong>5. Document doses</strong><span>Use Today View, member profiles, calendar blocks, or regimen administer buttons. Late, early, skipped, and missed doses stay in the record.</span></div>
            <div class="setup-step"><strong>6. Maintain data</strong><span>Use Backup Data, Desktop Sync Folder, Data Health Check, Audit Trail, and reports before major workflow changes.</span></div>
            <div class="important-note"><strong>Safety note:</strong> PharmAtlas organizes medication information and documentation. It does not replace prescriber, pharmacist, emergency, or clinical judgment.</div>
        </div>
    `, 'Close');
    db.settings = { ...(db.settings || {}), setupGuideSeen: true };
    await window.api.save(db);
};

function maybeOpenFirstRunSetupGuide() {
    const isEmptyStart = (db.family || []).length === 0 && (db.inventory || []).length === 0;
    if (!isEmptyStart || db.settings?.setupGuideSeen) return;
    setTimeout(() => openFirstRunSetupGuide(), 600);
}

window.renderFrequencyControls = function(prefix, existingTimes = null) {
    const ids = getFieldIds(prefix);
    const freq = document.getElementById(ids.freq).value;
    const container = document.getElementById(ids.timeFields);
    if (!container) return;
    const startWrap = document.getElementById(prefix === 'mod' ? 'mod-start-date-wrap' : 'sched-start-date-wrap');
    if (startWrap) startWrap.style.display = freq === 'QOD' ? 'none' : '';
    const endInput = document.getElementById(prefix === 'mod' ? 'mod-end' : 'sched-end');
    if (endInput) {
        endInput.disabled = freq === 'ONCE';
        if (freq === 'ONCE') endInput.value = '';
    }

    const qodContainer = document.getElementById(ids.qodContainer);
    const intervalContainer = document.getElementById(ids.intervalContainer);
    const weekIntervalContainer = document.getElementById(ids.weekIntervalContainer);
    const monthlyContainer = document.getElementById(ids.monthlyContainer);
    const weeklyCountContainer = document.getElementById(ids.weeklyCountContainer);
    const weekdayContainer = document.getElementById(ids.weekdayContainer);
    const prnContainer = document.getElementById(ids.prnContainer);
    if (qodContainer) qodContainer.style.display = freq === 'QOD' ? 'block' : 'none';
    if (freq === 'QOD') {
        const qodStartInput = document.getElementById(ids.qodStart);
        const startInput = document.getElementById(prefix === 'mod' ? 'mod-start' : 'sched-start');
        if (qodStartInput && !qodStartInput.value) qodStartInput.value = startInput?.value || localDateKey();
    }
    if (intervalContainer) intervalContainer.style.display = freq === 'QXH' ? 'flex' : 'none';
    if (weekIntervalContainer) weekIntervalContainer.style.display = freq === 'QXW' ? 'flex' : 'none';
    if (monthlyContainer) monthlyContainer.style.display = freq === 'Monthly' ? 'flex' : 'none';
    if (weeklyCountContainer) weeklyCountContainer.style.display = freq === 'XPW' ? 'flex' : 'none';
    if (weekdayContainer) weekdayContainer.style.display = ['QXW', 'XPW'].includes(freq) ? 'flex' : 'none';
    if (prnContainer) prnContainer.style.display = freq === 'PRN' ? 'flex' : 'none';
    if (weekdayContainer && ['QXW', 'XPW'].includes(freq) && !weekdayContainer.querySelector('input:checked')) {
        const startDate = document.getElementById(prefix === 'mod' ? 'mod-start' : 'sched-start')?.value || localDateKey();
        const weekday = parseLocal(startDate)?.getDay() ?? new Date().getDay();
        const checkbox = weekdayContainer.querySelector(`input[value="${weekday}"]`);
        if (checkbox) checkbox.checked = true;
    }

    container.innerHTML = '';
    if (freq === 'PRN') {
        container.innerHTML = '<span style="font-size:11px;">No scheduled administration times for PRN orders.</span>';
        return;
    }

    const times = Array.isArray(existingTimes) ? existingTimes : [];
    const count = freq === 'QXH' ? 1 : getExpectedTimeCount(freq);
    for (let i = 0; i < count; i++) {
        const row = document.createElement('div');
        row.className = 'field-row';
        row.style.marginBottom = '4px';
        const label = freq === 'QXH' ? 'Start time:' : `Dose ${i + 1}:`;
        row.innerHTML = `<label>${label}</label><input class="${prefix}-time-input" type="time" value="${times[i] || defaultTimeForIndex(i, freq)}">`;
        container.appendChild(row);
    }
    if (freq === 'QXH') {
        const preview = document.createElement('div');
        preview.id = `${prefix}-interval-preview`;
        preview.className = 'interval-preview sunken-panel';
        container.appendChild(preview);
        const update = () => renderIntervalPreview(prefix);
        container.querySelector(`.${prefix}-time-input`)?.addEventListener('input', update);
        document.getElementById(ids.intervalHours)?.addEventListener('input', update);
        document.getElementById(prefix === 'mod' ? 'mod-start' : 'sched-start')?.addEventListener('input', update);
        document.getElementById(prefix === 'mod' ? 'mod-end' : 'sched-end')?.addEventListener('input', update);
        renderIntervalPreview(prefix);
    }
};

function collectFrequencyDetails(prefix) {
    const ids = getFieldIds(prefix);
    const freq = document.getElementById(ids.freq).value;
    const intervalInput = document.getElementById(ids.intervalHours);
    const intervalHours = freq === 'QXH' ? parseInt(intervalInput.value, 10) : null;
    const intervalWeeks = freq === 'QXW' ? parseInt(document.getElementById(ids.intervalWeeks)?.value, 10) : null;
    const monthlyAnchor = freq === 'Monthly' ? document.getElementById(ids.monthlyAnchor)?.value : '';
    const timesPerWeek = freq === 'XPW' ? parseInt(document.getElementById(ids.timesPerWeek)?.value, 10) : null;
    const weekdays = ['QXW', 'XPW'].includes(freq)
        ? Array.from(document.querySelectorAll(`#${ids.weekdayContainer} input[type="checkbox"]:checked`)).map(input => parseInt(input.value, 10)).sort()
        : [];
    const prnMaxDoses = freq === 'PRN' ? parseInt(document.getElementById(ids.prnMaxDoses)?.value, 10) : null;
    const prnWindowHours = freq === 'PRN' ? parseInt(document.getElementById(ids.prnWindowHours)?.value, 10) : null;
    const rawTimes = Array.from(document.querySelectorAll(`#${ids.timeFields} .${prefix}-time-input`))
        .map(input => input.value)
        .filter(Boolean);

    if (freq === 'PRN') {
        if (document.getElementById(ids.prnMaxDoses)?.value && (!Number.isInteger(prnMaxDoses) || prnMaxDoses < 1)) {
            alert("PRN maximum doses must be 1 or higher.");
            return null;
        }
        if (document.getElementById(ids.prnWindowHours)?.value && (!Number.isInteger(prnWindowHours) || prnWindowHours < 1 || prnWindowHours > 168)) {
            alert("PRN maximum window must be between 1 and 168 hours.");
            return null;
        }
        return { freq, times: [], intervalHours: null, prnMaxDoses: prnMaxDoses || null, prnWindowHours: prnWindowHours || 24 };
    }
    if (freq === 'QXH') {
        if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 24) {
            alert("Every X Hours must be between 1 and 24.");
            return null;
        }
        if (!rawTimes[0]) {
            alert("Enter the start time for the Every X Hours schedule.");
            return null;
        }
        return { freq, times: generateIntervalTimes(rawTimes[0], intervalHours), intervalHours, startTime: rawTimes[0] };
    }
    if (freq === 'QXW') {
        if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 52) {
            alert("Every X Weeks must be between 1 and 52 weeks.");
            return null;
        }
        if (weekdays.length === 0) {
            alert("Select at least one weekday for the Every X Weeks schedule.");
            return null;
        }
    }
    if (freq === 'XPW') {
        if (!Number.isInteger(timesPerWeek) || timesPerWeek < 1 || timesPerWeek > 7) {
            alert("Times per week must be between 1 and 7.");
            return null;
        }
        if (weekdays.length !== timesPerWeek) {
            alert(`Select exactly ${timesPerWeek} weekday${timesPerWeek === 1 ? '' : 's'}.`);
            return null;
        }
    }
    if (freq === 'Monthly' && !monthlyAnchor) {
        alert("Enter the first monthly dose date.");
        return null;
    }

    const expected = getExpectedTimeCount(freq);
    if (rawTimes.length !== expected) {
        alert(`Enter ${expected} administration time${expected === 1 ? '' : 's'} for this frequency.`);
        return null;
    }

    const uniqueTimes = Array.from(new Set(rawTimes)).sort();
    if (uniqueTimes.length !== rawTimes.length) {
        alert("Administration times cannot be duplicated.");
        return null;
    }

    return { freq, times: uniqueTimes, intervalHours: null, intervalWeeks, timesPerWeek, weekdays, monthlyAnchor };
}

function setWeekdaySelections(containerId, weekdays = []) {
    const selected = new Set((weekdays || []).map(Number));
    document.querySelectorAll(`#${containerId} input[type="checkbox"]`).forEach(input => {
        input.checked = selected.has(parseInt(input.value, 10));
    });
}

function parseAmount(value, fallback = 0) {
    const amount = parseFloat(value);
    return Number.isFinite(amount) ? amount : fallback;
}

function parseMoney(value, fallback = 0) {
    const amount = parseFloat(String(value || '').replace(/[$,\s]/g, ''));
    return Number.isFinite(amount) ? amount : fallback;
}

function formatAmount(value) {
    const amount = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(amount)) return '0';
    return amount.toLocaleString('en-US', {
        useGrouping: false,
        maximumFractionDigits: 20
    });
}

function getMemberGoals(member) {
    return {
        glucose: { preset: 'diabetic', ...glucoseGoalPresets.diabetic, ...(member?.vitalGoals?.glucose || {}) },
        bp: { ...defaultBpGoals, ...(member?.vitalGoals?.bp || {}) },
        hr: { ...defaultHrGoals, ...(member?.vitalGoals?.hr || {}) },
        weight: { ...defaultWeightGoals, ...(member?.vitalGoals?.weight || {}) }
    };
}

window.applyGlucosePreset = function() {
    const preset = document.getElementById('m-glucose-preset')?.value || 'custom';
    if (preset === 'custom') return;
    const goals = glucoseGoalPresets[preset];
    document.getElementById('m-glucose-low').value = goals.low;
    document.getElementById('m-glucose-high').value = goals.high;
};

function setMemberGoalFields(member) {
    const goals = getMemberGoals(member);
    const safeSet = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? '';
    };
    safeSet('m-glucose-preset', goals.glucose.preset);
    safeSet('m-glucose-low', goals.glucose.low);
    safeSet('m-glucose-high', goals.glucose.high);
    safeSet('m-bp-sys-low', goals.bp.systolicLow);
    safeSet('m-bp-sys-high', goals.bp.systolicHigh);
    safeSet('m-bp-dia-low', goals.bp.diastolicLow);
    safeSet('m-bp-dia-high', goals.bp.diastolicHigh);
    safeSet('m-hr-low', goals.hr.low);
    safeSet('m-hr-high', goals.hr.high);
    safeSet('m-weight-low', goals.weight.low);
    safeSet('m-weight-high', goals.weight.high);
    safeSet('m-weight-unit', goals.weight.unit || 'lb');
}

function collectMemberGoals() {
    const goals = {
        glucose: {
            preset: document.getElementById('m-glucose-preset').value,
            low: parseAmount(document.getElementById('m-glucose-low').value, 70),
            high: parseAmount(document.getElementById('m-glucose-high').value, 180)
        },
        bp: {
            systolicLow: parseAmount(document.getElementById('m-bp-sys-low').value, 90),
            systolicHigh: parseAmount(document.getElementById('m-bp-sys-high').value, 130),
            diastolicLow: parseAmount(document.getElementById('m-bp-dia-low').value, 60),
            diastolicHigh: parseAmount(document.getElementById('m-bp-dia-high').value, 80)
        },
        hr: {
            low: parseAmount(document.getElementById('m-hr-low').value, 60),
            high: parseAmount(document.getElementById('m-hr-high').value, 100)
        },
        weight: {
            low: document.getElementById('m-weight-low').value === '' ? '' : parseAmount(document.getElementById('m-weight-low').value, NaN),
            high: document.getElementById('m-weight-high').value === '' ? '' : parseAmount(document.getElementById('m-weight-high').value, NaN),
            unit: document.getElementById('m-weight-unit').value || 'lb'
        }
    };
    if (goals.glucose.high <= goals.glucose.low) {
        alert("Glucose high goal must be greater than glucose low goal.");
        return null;
    }
    if (goals.bp.systolicHigh <= goals.bp.systolicLow || goals.bp.diastolicHigh <= goals.bp.diastolicLow) {
        alert("BP high goals must be greater than BP low goals.");
        return null;
    }
    if (goals.hr.high <= goals.hr.low) {
        alert("Heart rate high goal must be greater than heart rate low goal.");
        return null;
    }
    if (Number.isFinite(goals.weight.low) && Number.isFinite(goals.weight.high) && goals.weight.high <= goals.weight.low) {
        alert("Weight high goal must be greater than weight low goal.");
        return null;
    }
    return goals;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function getComponentUnit(component, med) {
    return component.unit || med.units || 'mg';
}

function formatComponentStrength(component, med, includeName = false) {
    const name = includeName && component.name ? `${component.name} ` : '';
    const rawStrength = Number.isFinite(parseAmount(component.strengthAmount, NaN))
        ? parseAmount(component.strengthAmount)
        : parseAmount(component.strength);
    const perAmount = parseAmount(component.perAmount, NaN);
    const denominator = component.perUnit && Number.isFinite(perAmount) && perAmount > 0
        ? `/${perAmount === 1 ? '' : formatAmount(perAmount)}${component.perUnit}`
        : '';
    return `${name}${formatAmount(rawStrength)}${getComponentUnit(component, med)}${denominator}`;
}

function sharedComponentDenominator(components) {
    if (!Array.isArray(components) || components.length === 0) return null;
    const firstAmount = parseAmount(components[0].perAmount, NaN);
    const firstUnit = components[0].perUnit || '';
    if (!firstUnit || !Number.isFinite(firstAmount) || firstAmount <= 0) return null;
    const isShared = components.every(component =>
        component.perUnit === firstUnit &&
        parseAmount(component.perAmount, NaN) === firstAmount
    );
    return isShared ? { amount: firstAmount, unit: firstUnit } : null;
}

function formatCombinationStrength(med, includeNames = false, includeSolidDenominator = true) {
    const components = med?.components || [];
    const sharedDenominator = sharedComponentDenominator(components);
    if (!sharedDenominator) {
        return components.map(component => formatComponentStrength(component, med, includeNames)).join('/');
    }
    const numerators = components.map(component => {
        const name = includeNames && component.name ? `${component.name} ` : '';
        const rawStrength = Number.isFinite(parseAmount(component.strengthAmount, NaN))
            ? parseAmount(component.strengthAmount)
            : parseAmount(component.strength) * sharedDenominator.amount;
        return `${name}${formatAmount(rawStrength)}${getComponentUnit(component, med)}`;
    });
    const isLiquidDenominator = ['mL', 'L'].includes(sharedDenominator.unit);
    const denominator = includeSolidDenominator || isLiquidDenominator
        ? `/${sharedDenominator.amount === 1 ? '' : formatAmount(sharedDenominator.amount)}${sharedDenominator.unit}`
        : '';
    return `${numerators.join('/')}${denominator}`;
}

function formatInventoryUnits(med) {
    if (!med?.isCombination || !Array.isArray(med.components) || med.components.length === 0) {
        return med?.units || '';
    }
    const units = Array.from(new Set(med.components.map(component => getComponentUnit(component, med)).filter(Boolean)));
    const sharedDenominator = sharedComponentDenominator(med.components);
    return `${units.join('/')}${sharedDenominator ? `/${formatAmount(sharedDenominator.amount)}${sharedDenominator.unit}` : ''}`;
}

function compactRepeatedDenominatorText(value) {
    const text = String(value || '').trim().replace(/\s*\n+\s*/g, ' / ').replace(/\s{2,}/g, ' ');
    if (!text) return '';
    const parts = text.split(/\s+\/\s+/).map(part => part.trim()).filter(Boolean);
    if (parts.length < 2) return text;
    const matches = parts.map(part => part.match(/^(.+?)\/([A-Za-z%µ]+)$/));
    if (!matches.every(Boolean)) return text;
    const denominator = matches[0][2];
    if (!matches.every(match => match[2] === denominator)) return text;
    return `${matches.map(match => match[1]).join('/')}/${denominator}`;
}

function combineStrengthAndUnits(strength, units) {
    const strengthText = compactRepeatedDenominatorText(strength);
    const unitText = String(units || '').trim();
    if (!strengthText) return unitText;
    if (!unitText) return strengthText;
    const normalizedStrength = strengthText.replace(/\s+/g, '');
    const normalizedUnit = unitText.replace(/\s+/g, '');
    return normalizedStrength.endsWith(normalizedUnit) ? strengthText : `${strengthText}${unitText}`;
}

function compoundRecipeStrengthText(recipe) {
    const calculatedComponents = Array.isArray(recipe?.calculatedComponents)
        ? recipe.calculatedComponents
            .map(component => ({
                ...component,
                strength: parseAmount(component.strength, parseAmount(component.strengthAmount, NaN)),
                strengthAmount: parseAmount(component.strengthAmount, parseAmount(component.strength, NaN)),
                perAmount: parseAmount(component.perAmount, 1),
                perUnit: component.perUnit || recipe.yieldUnit || ''
            }))
            .filter(component =>
                Number.isFinite(parseAmount(component.strength, NaN)) ||
                Number.isFinite(parseAmount(component.strengthAmount, NaN))
            )
        : [];
    if (calculatedComponents.length > 1) {
        return formatCombinationStrength({ isCombination: true, components: calculatedComponents }, false, true);
    }
    return combineStrengthAndUnits(recipe?.finalStrength, recipe?.finalUnits);
}

function componentPerUnitOptionsHtml(selected = '') {
    return componentPerUnitOptions
        .map(unit => `<option value="${unit}" ${unit === selected ? 'selected' : ''}>${unit || 'unit'}</option>`)
        .join('');
}

function comboEditorConfig(prefix = 'med') {
    const modal = prefix === 'modal';
    const receive = prefix === 'receive';
    return {
        rowSelector: receive ? '#receive-ingredient-list .receive-combo-row' : (modal ? '#modal-ingredient-list .modal-combo-row' : '#ingredient-list .combo-row'),
        rowListId: receive ? 'receive-ingredient-list' : (modal ? 'modal-ingredient-list' : 'ingredient-list'),
        sharedCheckId: receive ? 'receive-combo-use-shared-per' : (modal ? 'modal-combo-use-shared-per' : 'combo-use-shared-per'),
        sharedAmountId: receive ? 'receive-combo-shared-per-amount' : (modal ? 'modal-combo-shared-per-amount' : 'combo-shared-per-amount'),
        sharedUnitId: receive ? 'receive-combo-shared-per-unit' : (modal ? 'modal-combo-shared-per-unit' : 'combo-shared-per-unit'),
        previewId: receive ? 'receive-combination-preview' : (modal ? 'modal-combination-preview' : 'combination-preview'),
        formulationId: receive ? 'receive-new-formulation' : (modal ? 'modal-formulation' : 'med-formulation'),
        nameClass: receive ? '.receive-ing-name' : (modal ? '.modal-ing-name' : '.ing-name'),
        strengthClass: receive ? '.receive-ing-strength' : (modal ? '.modal-ing-strength' : '.ing-strength'),
        unitClass: receive ? '.receive-ing-unit' : (modal ? '.modal-ing-unit' : '.ing-unit'),
        perAmountClass: receive ? '.receive-ing-per-amount' : (modal ? '.modal-ing-per-amount' : '.ing-per-amount'),
        perUnitClass: receive ? '.receive-ing-per-unit' : (modal ? '.modal-ing-per-unit' : '.ing-per-unit')
    };
}

function getComboSharedBasis(prefix = 'med') {
    const config = comboEditorConfig(prefix);
    const useShared = document.getElementById(config.sharedCheckId)?.checked !== false;
    const formulation = document.getElementById(config.formulationId)?.value || 'Other';
    const amountInput = document.getElementById(config.sharedAmountId);
    const unitInput = document.getElementById(config.sharedUnitId);
    const defaultUnit = defaultPerUnitForFormulation(formulation);
    if (unitInput && !unitInput.value && defaultUnit) unitInput.value = defaultUnit;
    return {
        useShared,
        amount: parseAmount(amountInput?.value, NaN),
        unit: unitInput?.value || ''
    };
}

function collectCombinationComponents(prefix = 'med') {
    const config = comboEditorConfig(prefix);
    const shared = getComboSharedBasis(prefix);
    const rows = Array.from(document.querySelectorAll(config.rowSelector));
    let invalidDenominator = false;
    const components = rows.map(row => {
        const name = row.querySelector(config.nameClass)?.value.trim() || '';
        const strengthAmount = parseAmount(row.querySelector(config.strengthClass)?.value, NaN);
        const unit = row.querySelector(config.unitClass)?.value || 'mg';
        const rowPerAmount = parseAmount(row.querySelector(config.perAmountClass)?.value, NaN);
        const rowPerUnit = row.querySelector(config.perUnitClass)?.value || '';
        const perAmount = shared.useShared ? shared.amount : rowPerAmount;
        const perUnit = shared.useShared ? shared.unit : rowPerUnit;
        if (perUnit && (!Number.isFinite(perAmount) || perAmount <= 0)) invalidDenominator = true;
        const hasDenominator = perUnit && Number.isFinite(perAmount) && perAmount > 0;
        return {
            name,
            strength: hasDenominator ? strengthAmount / perAmount : strengthAmount,
            strengthAmount,
            unit,
            perAmount: hasDenominator ? perAmount : null,
            perUnit: hasDenominator ? perUnit : ''
        };
    }).filter(component => component.name && Number.isFinite(component.strengthAmount) && component.strengthAmount > 0);
    return { components, invalidDenominator, shared };
}

function setCombinationSharedBasis(prefix = 'med', components = []) {
    const config = comboEditorConfig(prefix);
    const shared = sharedComponentDenominator(components);
    const formulation = document.getElementById(config.formulationId)?.value || 'Other';
    const defaultUnit = defaultPerUnitForFormulation(formulation);
    const sharedCheck = document.getElementById(config.sharedCheckId);
    const sharedAmount = document.getElementById(config.sharedAmountId);
    const sharedUnit = document.getElementById(config.sharedUnitId);
    if (sharedCheck) sharedCheck.checked = !!shared || components.length === 0;
    if (sharedAmount) sharedAmount.value = shared ? formatAmount(shared.amount) : '1';
    if (sharedUnit) sharedUnit.value = shared?.unit || defaultUnit || '';
}

window.updateCombinationPreview = function(prefix = 'med') {
    const config = comboEditorConfig(prefix);
    const list = document.getElementById(config.rowListId);
    const preview = document.getElementById(config.previewId);
    const { components, invalidDenominator, shared } = collectCombinationComponents(prefix);
    if (list) list.classList.toggle('use-shared-basis', shared.useShared);
    if (!preview) return;
    if (invalidDenominator) {
        preview.className = 'combo-strength-preview error';
        preview.textContent = 'Enter a valid package basis greater than 0.';
        return;
    }
    if (!components.length) {
        preview.className = 'combo-strength-preview';
        preview.textContent = 'Add ingredients to preview the combined strength.';
        return;
    }
    const comboMed = { isCombination: true, components };
    preview.className = 'combo-strength-preview ok';
    preview.textContent = `Package strength: ${formatCombinationStrength(comboMed, true)}`;
};

function formatMedStrength(med, includeNames = false, includeSolidDenominator = true) {
    if (!med) return '';
    if (med.isCombination && med.components && med.components.length > 0) {
        return formatCombinationStrength(med, includeNames, includeSolidDenominator);
    }
    if (Number.isFinite(parseAmount(med.strengthAmount, NaN)) && med.activeUnit) {
        if (med.perUnit && Number.isFinite(parseAmount(med.perAmount, NaN))) {
            const isLiquidDenominator = ['ml', 'l'].includes(String(med.perUnit).toLowerCase());
            const denominator = includeSolidDenominator || isLiquidDenominator
                ? `/${parseAmount(med.perAmount) === 1 ? '' : formatAmount(parseAmount(med.perAmount))}${med.perUnit}`
                : '';
            return `${formatAmount(parseAmount(med.strengthAmount))}${med.activeUnit}${denominator}`;
        }
        return `${formatAmount(parseAmount(med.strengthAmount))}${med.activeUnit}`;
    }
    if (Number.isFinite(parseAmount(med.strength, NaN)) && med.units && !String(med.units).includes('/')) {
        return `${formatAmount(parseAmount(med.strength))}${med.units}`;
    }
    if (med.displayStrength) return med.displayStrength;
    return `${med.strength}${med.units}`;
}

function formatLabelMedStrength(med, includeNames = false) {
    return formatMedStrength(med, includeNames, false);
}

function formatPrescribedDose(med, doseQty) {
    const qty = parseAmount(doseQty);
    if (!med) return '';

    if (isTopicalMedication(med)) {
        return `${formatAmount(qty)} ${med.administrationUnit || 'application'}`;
    }

    if (med.isCombination && med.components && med.components.length > 0) {
        return med.components.map(component => {
            const total = parseAmount(component.strength) * qty;
            return `${formatAmount(total)}${getComponentUnit(component, med)}`;
        }).join('/');
    }

    const medUnits = String(med.units || '');
    const doseUnit = medUnits.includes('/') ? medUnits.split('/')[0] : medUnits;
    return `${formatAmount(parseAmount(med.strength) * qty)}${doseUnit}`;
}

function formatQtyForSchedule(schedule, med) {
    const numericQty = parseAmount(schedule.doseQty);
    const qty = formatAmount(numericQty);
    const rawUnit = med.administrationUnit || med.formulation || 'unit';
    const pluralUnits = {
        tablet: 'tablets',
        capsule: 'capsules',
        packet: 'packets',
        spray: 'sprays',
        drop: 'drops',
        inhalation: 'inhalations',
        patch: 'patches',
        suppository: 'suppositories',
        application: 'applications',
        bottle: 'bottles',
        container: 'containers',
        tube: 'tubes',
        jar: 'jars',
        unit: 'units'
    };
    const unitKey = String(rawUnit).toLowerCase();
    const unit = numericQty === 1 ? rawUnit : (pluralUnits[unitKey] || rawUnit);
    return `${qty} ${unit}`;
}

function formatCurrency(value) {
    const amount = typeof value === 'number' ? value : parseMoney(value, NaN);
    if (!Number.isFinite(amount)) return '$0.00';
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatMultiMedLabelName(schedule, med) {
    if (!med || !schedule) return 'Unknown medication';
    const actualDose = formatPrescribedDose(med, schedule.doseQty);
    return `${med.name}${actualDose ? ` ${actualDose}` : ''}`;
}

function prnLimitText(schedule) {
    const maxDoses = parseInt(schedule?.prnMaxDoses, 10);
    if (schedule?.freq !== 'PRN' || !Number.isInteger(maxDoses) || maxDoses < 1) return '';
    const windowHours = parseInt(schedule.prnWindowHours, 10) || 24;
    return ` | Max ${maxDoses}/${windowHours}h`;
}

function imageSrc(pathOrDataUrl) {
    if (!pathOrDataUrl) return '';
    if (/^(data:|https?:|blob:)/i.test(pathOrDataUrl)) return pathOrDataUrl;
    return `file://${pathOrDataUrl}`;
}

function getNextScheduledDose(schedule, fromDate = new Date()) {
    const times = getScheduleTimes(schedule).sort();
    const currentDateKey = localDateKey(fromDate);
    const currentTime = `${fromDate.getHours().toString().padStart(2, '0')}:${fromDate.getMinutes().toString().padStart(2, '0')}`;

    if (schedule.freq === 'PRN') {
        return { date: currentDateKey, time: 'PRN' };
    }

    for (let i = 0; i < 366; i++) {
        const candidate = new Date(fromDate);
        candidate.setHours(0, 0, 0, 0);
        candidate.setDate(candidate.getDate() + i);
        const dateKey = localDateKey(candidate);
        if (!isScheduleDueOnDate(schedule, dateKey)) continue;

        const nextTime = i === 0 ? times.find(time => time >= currentTime) : times[0];
        if (nextTime) return { date: dateKey, time: nextTime };
    }

    return { date: schedule.startDate || currentDateKey, time: times[0] || 'PRN' };
}

function formatDoseDateTime(schedule) {
    const nextDose = getNextScheduledDose(schedule);
    const date = parseLocal(nextDose.date);
    const displayDate = date ? date.toLocaleDateString() : nextDose.date;
    const times = getScheduleTimes(schedule);
    return `${displayDate} | ${times.length > 0 ? times.join(', ') : nextDose.time}`;
}

function scheduleInstanceKey(scheduleId, date, time) {
    return `${scheduleId}|${date}|${time || 'PRN'}`;
}

function isScheduleInstanceDocumented(scheduleId, date, time) {
    const key = scheduleInstanceKey(scheduleId, date, time);
    const schedule = db.schedules.find(item => item.id === scheduleId);
    if (schedule && findHistoryForScheduleInstance(schedule, { date, time, key })) return true;
    return db.history.some(entry => entry.scheduleInstanceKey === key);
}

function getScheduleInstancesForDate(schedule, dateStr) {
    if (!schedule || !isScheduleDueOnDate(schedule, dateStr)) return [];
    if (schedule.freq === 'QXH') {
        const dayStart = parseLocal(dateStr);
        const dayEnd = parseLocal(dateStr);
        if (!dayStart || !dayEnd) return [];
        dayStart.setHours(0, 0, 0, 0);
        dayEnd.setHours(23, 59, 59, 999);
        const scheduleStart = dateTimeFromParts(schedule.startDate, schedule.startTime || schedule.times?.[0]);
        const from = scheduleStart && scheduleStart > dayStart ? scheduleStart : dayStart;
        return rollingIntervalInstancesBetween(schedule, from, dayEnd)
            .map(dateTimeParts)
            .filter(instance => instance.date === dateStr && isScheduleDueOnDate(schedule, instance.date))
            .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))
            .map(instance => ({
                date: instance.date,
                time: instance.time,
                key: scheduleInstanceKey(schedule.id, instance.date, instance.time)
            }))
            .filter(instance => !(schedule.excludedInstances || []).includes(instance.key));
    }
    const times = getScheduleTimes(schedule);
    if (times.length === 0) {
        return [{ date: dateStr, time: 'PRN', key: scheduleInstanceKey(schedule.id, dateStr, 'PRN') }];
    }
    return times
        .slice()
        .sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
        .map(time => ({ date: dateStr, time, key: scheduleInstanceKey(schedule.id, dateStr, time) }))
        .filter(instance => !(schedule.excludedInstances || []).includes(instance.key));
}

function getAvailableScheduleInstancesForDate(schedule, dateStr) {
    return getScheduleInstancesForDate(schedule, dateStr)
        .filter(instance => !isScheduleInstanceDocumented(schedule.id, instance.date, instance.time));
}

function getScheduleInstancesInRange(schedule, startDate, endDate) {
    const start = parseLocal(startDate);
    const end = parseLocal(endDate);
    if (!schedule || !start || !end || end < start) return [];

    const instances = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        instances.push(...getScheduleInstancesForDate(schedule, localDateKey(cursor)));
        cursor.setDate(cursor.getDate() + 1);
    }
    return instances;
}

function collectMemberScheduleDoseRows(memberId, startDate, endDate) {
    const start = parseLocal(startDate);
    const end = parseLocal(endDate);
    if (!memberId || !start || !end || end < start) return [];

    const memberSchedules = db.schedules.filter(schedule => schedule.memberId === memberId && !isScheduleArchived(schedule));
    const rows = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        const dateKey = localDateKey(cursor);
        memberSchedules.forEach(schedule => {
            const med = db.inventory.find(item => item.id === schedule.medId);
            if (!med) return;
            getScheduleInstancesForDate(schedule, dateKey).forEach(instance => {
                rows.push({ schedule, med, instance });
            });
        });
        cursor.setDate(cursor.getDate() + 1);
    }

    return rows.sort((a, b) => {
        if (a.instance.date !== b.instance.date) return a.instance.date.localeCompare(b.instance.date);
        const byTime = timeToMinutes(a.instance.time) - timeToMinutes(b.instance.time);
        if (byTime !== 0) return byTime;
        return (a.med.name || '').localeCompare(b.med.name || '', undefined, { sensitivity: 'base' });
    });
}

function getInstanceSelectionRange(schedule) {
    const today = localDateKey();
    const lookback = new Date();
    lookback.setDate(lookback.getDate() - 30);
    const lookbackKey = localDateKey(lookback);
    const start = schedule.startDate && schedule.startDate > lookbackKey ? schedule.startDate : lookbackKey;
    if (schedule.endDate && schedule.endDate !== 'Ongoing') return { start, end: schedule.endDate };
    const end = new Date();
    end.setDate(end.getDate() + 30);
    return { start, end: localDateKey(end) };
}

function getNextAvailableScheduleInstance(schedule, fromDate = new Date()) {
    const currentDateKey = localDateKey(fromDate);
    const currentTime = `${fromDate.getHours().toString().padStart(2, '0')}:${fromDate.getMinutes().toString().padStart(2, '0')}`;

    for (let i = 0; i < 366; i++) {
        const candidate = new Date(fromDate);
        candidate.setHours(0, 0, 0, 0);
        candidate.setDate(candidate.getDate() + i);
        const dateKey = localDateKey(candidate);
        const instances = getAvailableScheduleInstancesForDate(schedule, dateKey);
        const next = i === 0
            ? instances.find(instance => instance.time === 'PRN' || instance.time >= currentTime)
            : instances[0];
        if (next) return next;
    }
    return null;
}

function doseStatusLabel(status) {
    return {
        given: 'Given as scheduled',
        late: 'Given late',
        early: 'Given early',
        skipped: 'Skipped',
        missed: 'Missed / forgotten'
    }[status] || 'Given as scheduled';
}

function getLabelClass(parts, lineCount = 0) {
    const length = parts.filter(Boolean).join(' ').length;
    if (length > 170 || lineCount > 6) return 'label-page label-dense';
    if (length > 120 || lineCount > 4) return 'label-page label-compact';
    return 'label-page';
}

function printPreparedArea() {
    const printArea = document.getElementById('print-area');
    document.body.appendChild(printArea);
    printArea.style.display = 'block';
    setTimeout(() => window.print(), 50);
}

let pendingLabelHtml = '';
let pendingPrepackDefinition = null;

function fitLabelPages(container) {
    const densityClasses = ['label-compact', 'label-dense', 'label-ultra-dense', 'label-micro'];
    container.querySelectorAll('.label-page').forEach(page => {
        const textElements = page.querySelectorAll('.label-date, .label-title, .label-small, .label-med-row, .compound-label-strength');
        textElements.forEach(element => {
            element.style.removeProperty('font-size');
            element.style.removeProperty('line-height');
        });
        page.classList.remove(...densityClasses);
        for (const densityClass of densityClasses) {
            if (page.scrollHeight <= page.clientHeight + 1 && page.scrollWidth <= page.clientWidth + 1) break;
            page.classList.add(densityClass);
        }
        for (let attempt = 0; attempt < 3 && (page.scrollHeight > page.clientHeight + 1 || page.scrollWidth > page.clientWidth + 1); attempt++) {
            const heightRatio = page.clientHeight / page.scrollHeight;
            const widthRatio = page.clientWidth / page.scrollWidth;
            const fitRatio = Math.max(Math.min(heightRatio, widthRatio, 1) * 0.96, 0.7);
            textElements.forEach(element => {
                const styles = getComputedStyle(element);
                element.style.fontSize = `${parseFloat(styles.fontSize) * fitRatio}px`;
                element.style.lineHeight = '0.82';
            });
        }
    });
    pendingLabelHtml = container.innerHTML;
}

function previewLabelHtml(labelHtml, prepackDefinition = null) {
    pendingLabelHtml = labelHtml;
    pendingPrepackDefinition = prepackDefinition;
    const modal = document.getElementById('label-preview-modal');
    const content = document.getElementById('label-preview-content');
    if (!modal || !content) {
        const printArea = document.getElementById('print-area');
        printArea.innerHTML = labelHtml;
        printPreparedArea();
        return;
    }
    content.innerHTML = labelHtml;
    modal.style.display = 'flex';
    const scheduleButton = document.getElementById('schedule-prepack-button');
    if (scheduleButton) scheduleButton.style.display = prepackDefinition && !prepackDefinition.existingQueueId ? 'inline-block' : 'none';
    fitLabelPages(content);
    requestAnimationFrame(() => {
        fitLabelPages(content);
        if (document.fonts?.ready) {
            document.fonts.ready.then(() => fitLabelPages(content));
        }
    });
}

window.closeLabelPreview = function() {
    pendingLabelHtml = '';
    pendingPrepackDefinition = null;
    const modal = document.getElementById('label-preview-modal');
    if (modal) modal.style.display = 'none';
    const scheduleButton = document.getElementById('schedule-prepack-button');
    if (scheduleButton) scheduleButton.style.display = 'none';
};

window.schedulePendingPrepack = async function() {
    if (!pendingPrepackDefinition || pendingPrepackDefinition.existingQueueId) return;
    const definition = pendingPrepackDefinition;
    const defaults = defaultActualDateTime();
    const result = await showActionModal('Schedule Prepack', `
        <div class="field-row">
            <label>Prepack date:</label><input name="prepackDate" type="date" value="${defaults.date}">
            <label>Time:</label><input name="prepackTime" type="time" value="${defaults.time}">
        </div>
    `, 'Add to Queue');
    if (!result) return;
    if (!result.prepackDate || !result.prepackTime) {
        await appAlert('Choose the date and time when this prepack should be prepared.');
        return;
    }
    await createPrepackQueue(definition, {
        labelsPrinted: false,
        scheduledFor: `${result.prepackDate}T${result.prepackTime}`
    });
    window.closeLabelPreview();
    switchTab('prepackage');
};

window.printPreviewedLabel = async function() {
    if (!pendingLabelHtml) return;
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = pendingLabelHtml;
    const prepackDefinition = pendingPrepackDefinition;
    window.closeLabelPreview();
    if (prepackDefinition?.existingQueueId) await commitPrepackPrint(prepackDefinition);
    printPreparedArea();
};

function ensureActionModal() {
    let modal = document.getElementById('action-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'action-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="window action-modal-window">
            <div class="title-bar">
                <div class="title-bar-text" id="action-modal-title">Action</div>
                <div class="title-bar-controls">
                    <button aria-label="Minimize" id="action-modal-min"></button>
                    <button aria-label="Close" id="action-modal-x"></button>
                </div>
            </div>
            <div class="window-body">
                <div id="action-modal-body"></div>
                <div class="field-row" style="justify-content:flex-end; margin-top:10px;">
                    <button id="action-modal-ok">OK</button>
                    <button id="action-modal-cancel">Cancel</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    return modal;
}

const workspaceTasks = new Map();
let activeMemberTaskId = '';

function updateWorkspaceTaskbar() {
    const taskbar = document.getElementById('workspace-taskbar');
    if (!taskbar) return;
    const tasks = Array.from(workspaceTasks.values());
    taskbar.classList.toggle('has-tasks', tasks.length > 0);
    taskbar.innerHTML = tasks.map(task => `
        <div class="taskbar-task ${task.active ? 'is-active' : ''} ${task.type ? `taskbar-${escapeHtml(task.type)}` : ''} ${task.sex ? `taskbar-sex-${escapeHtml(task.sex)}` : ''}" style="${task.color ? `--patient-color:${escapeHtml(task.color)};` : ''}" title="${escapeHtml(task.label)}">
            <button type="button" class="taskbar-button" onclick="restoreWorkspaceTask('${escapeHtml(task.id)}')">
                ${task.iconHtml || '<span class="win98-icon icon-view"></span>'}
                <span class="taskbar-label">${escapeHtml(task.label)}</span>
            </button>
            <button type="button" class="taskbar-close" onclick="event.stopPropagation(); closeWorkspaceTask('${escapeHtml(task.id)}')" title="Close">X</button>
        </div>
    `).join('');
}

function registerWorkspaceTask(id, label, restoreFn, options = {}) {
    workspaceTasks.forEach(task => { task.active = false; });
    workspaceTasks.set(id, {
        id,
        label,
        restoreFn,
        active: true,
        type: options.type || 'window',
        iconHtml: options.iconHtml || '',
        color: options.color || '',
        sex: options.sex || ''
    });
    updateWorkspaceTaskbar();
}

window.restoreWorkspaceTask = function(id) {
    const task = workspaceTasks.get(id);
    if (!task) return;
    if (id !== 'action-modal') {
        const actionModal = document.getElementById('action-modal');
        if (actionModal) actionModal.style.display = 'none';
    }
    if (!id.startsWith('member-modal-')) {
        const memberModal = document.getElementById('member-modal');
        if (memberModal) memberModal.style.display = 'none';
    }
    workspaceTasks.forEach(item => { item.active = item.id === id; });
    updateWorkspaceTaskbar();
    task.restoreFn?.();
};

function setWorkspaceTaskActive(id, active) {
    const task = workspaceTasks.get(id);
    if (!task) return;
    task.active = active;
    updateWorkspaceTaskbar();
}

function removeWorkspaceTask(id) {
    workspaceTasks.delete(id);
    if (activeMemberTaskId === id) activeMemberTaskId = '';
    updateWorkspaceTaskbar();
}

window.closeWorkspaceTask = async function(id) {
    if (id === 'action-modal') {
        document.getElementById('action-modal-x')?.click();
        return;
    }
    if (id.startsWith('member-modal-')) {
        const modal = document.getElementById('member-modal');
        if (activeMemberTaskId === id && modal) {
            await saveMemberFromProfile({ closeAfter: true });
            return;
        }
        removeWorkspaceTask(id);
    }
};

function iconClassForButtonText(text) {
    const value = String(text || '').toLowerCase();
    if (!value) return '';
    if (value.includes('label') || value.includes('print')) return 'icon-label';
    if (value.includes('schedule') || value.includes('calendar') || value.includes('today') || value.includes('day')) return 'icon-calendar';
    if (value.includes('prepack')) return 'icon-box';
    if (value.includes('recipe') || value.includes('compound') || value.includes('prep')) return 'icon-recipe';
    if (value.includes('regimen')) return 'icon-regimen';
    if (value.includes('monitor') || value.includes('vital') || value.includes('reading')) return 'icon-monitor';
    if (value.includes('inventory') || value.includes('stock') || value.includes('restock')) return 'icon-inventory';
    if (value.includes('formulary')) return 'icon-formulary';
    if (value.includes('order') || value.includes('receive')) return value.includes('receive') ? 'icon-receive' : 'icon-order';
    if (value.includes('profile') || value.includes('person') || value.includes('member') || value.includes('provider')) return 'icon-family';
    if (value.includes('view') || value.includes('open') || value.includes('pdf') || value.includes('report')) return 'icon-view';
    if (value.includes('clear') || value.includes('remove') || value.includes('delete') || value.includes('cancel')) return 'icon-clear';
    if (value.includes('add') || value.includes('save') || value.includes('generate')) return 'icon-view';
    return '';
}

function enhanceButtonIcons(root = document) {
    root.querySelectorAll('button').forEach(button => {
        if (
            button.dataset.iconEnhanced === 'true' ||
            button.querySelector('.win98-icon') ||
            button.closest('.title-bar-controls') ||
            button.classList.contains('taskbar-button') ||
            button.classList.contains('taskbar-close') ||
            button.classList.contains('inventory-builder-remove') ||
            button.classList.contains('recipe-row-remove') ||
            button.classList.contains('combo-row-remove')
        ) return;
        const iconClass = iconClassForButtonText(button.textContent);
        if (!iconClass) return;
        const icon = document.createElement('span');
        icon.className = `win98-icon ${iconClass}`;
        button.prepend(icon);
        button.dataset.iconEnhanced = 'true';
    });
}

function collectNamedInputs(container) {
    const result = {};
    container.querySelectorAll('input[name], select[name], textarea[name]').forEach(input => {
        if (input.type === 'checkbox') {
            if (!result[input.name]) result[input.name] = [];
            if (input.checked) result[input.name].push(input.value);
        } else if (input.type === 'radio') {
            if (input.checked) result[input.name] = input.value;
        } else {
            if (Object.prototype.hasOwnProperty.call(result, input.name)) {
                result[input.name] = Array.isArray(result[input.name])
                    ? [...result[input.name], input.value]
                    : [result[input.name], input.value];
            } else {
                result[input.name] = input.value;
            }
        }
    });
    return result;
}

function showActionModal(title, bodyHtml, confirmText = 'OK', collectFn = null) {
    const modal = ensureActionModal();
    const windowEl = modal.querySelector('.action-modal-window');
    const body = modal.querySelector('#action-modal-body');
    const ok = modal.querySelector('#action-modal-ok');
    const cancel = modal.querySelector('#action-modal-cancel');
    const close = modal.querySelector('#action-modal-x');
    const minimize = modal.querySelector('#action-modal-min');
    const isTaskbarWindow = bodyHtml.includes('data-action-modal-size="wide"');
    const taskId = 'action-modal';

    modal.querySelector('#action-modal-title').innerText = title;
    body.innerHTML = bodyHtml;
    windowEl?.classList.toggle('action-modal-window-wide', isTaskbarWindow);
    ok.innerText = confirmText;
    enhanceButtonIcons(body);
    if (minimize) minimize.style.display = isTaskbarWindow ? '' : 'none';
    modal.style.display = 'flex';
    if (isTaskbarWindow) {
        registerWorkspaceTask(taskId, title, () => {
            modal.style.display = 'flex';
            setWorkspaceTaskActive(taskId, true);
        }, {
            type: 'function',
            iconHtml: title.toLowerCase().includes('order')
                ? '<span class="win98-icon icon-order"></span>'
                : '<span class="win98-icon icon-formulary"></span>'
        });
    } else {
        removeWorkspaceTask(taskId);
    }

    return new Promise(resolve => {
        const cleanup = value => {
            ok.onclick = null;
            cancel.onclick = null;
            close.onclick = null;
            if (minimize) minimize.onclick = null;
            windowEl?.classList.remove('action-modal-window-wide');
            removeWorkspaceTask(taskId);
            modal.style.display = 'none';
            resolve(value);
        };
        ok.onclick = () => cleanup(collectFn ? collectFn(body) : collectNamedInputs(body));
        cancel.onclick = () => cleanup(null);
        close.onclick = () => cleanup(null);
        if (minimize) {
            minimize.onclick = () => {
                modal.style.display = 'none';
                setWorkspaceTaskActive(taskId, false);
            };
        }
    });
}

function showChildActionModal(title, bodyHtml, confirmText = 'OK', collectFn = null) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay child-action-modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="window action-modal-window">
            <div class="title-bar">
                <div class="title-bar-text">${escapeHtml(title)}</div>
                <div class="title-bar-controls">
                    <button aria-label="Close" data-child-modal-close></button>
                </div>
            </div>
            <div class="window-body">
                <div class="child-action-modal-body">${bodyHtml}</div>
                <div class="field-row" style="justify-content:flex-end; margin-top:10px;">
                    <button data-child-modal-ok>${escapeHtml(confirmText)}</button>
                    <button data-child-modal-cancel>Cancel</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    enhanceButtonIcons(modal);
    const body = modal.querySelector('.child-action-modal-body');
    const ok = modal.querySelector('[data-child-modal-ok]');
    const cancel = modal.querySelector('[data-child-modal-cancel]');
    const close = modal.querySelector('[data-child-modal-close]');
    return new Promise(resolve => {
        const cleanup = value => {
            ok.onclick = null;
            cancel.onclick = null;
            close.onclick = null;
            modal.remove();
            resolve(value);
        };
        ok.onclick = () => cleanup(collectFn ? collectFn(body) : collectNamedInputs(body));
        cancel.onclick = () => cleanup(null);
        close.onclick = () => cleanup(null);
    });
}

async function appAlert(message, title = 'PharmAtlas') {
    await showActionModal(title, `<div style="font-size:11px; padding:4px 0;">${escapeHtml(message)}</div>`, 'OK');
}

async function appConfirm(message, title = 'Confirm') {
    const result = await showActionModal(title, `<div style="font-size:11px; padding:4px 0;">${escapeHtml(message)}</div>`, 'OK');
    return result !== null;
}

// Keep legacy validation calls inside the application so native Electron dialogs
// never block focus after a message is dismissed.
window.alert = message => { void appAlert(String(message)); };

function dosageFormDefinition(formulation = 'Other') {
    return dosageFormDefinitions[formulation] || dosageFormDefinitions.Other;
}

function isTopicalFormulation(formulation = '') {
    return ['Cream', 'Ointment', 'Gel', 'Topical Packet', 'Topical Solution'].includes(formulation);
}

function dosageFormUsesContainerTracking(formulation = '') {
    return dosageFormDefinition(formulation).containerTracking === true;
}

function defaultInventoryBehaviorForFormulation(formulation = 'Other') {
    return dosageFormUsesContainerTracking(formulation) ? 'container-finish' : 'per-dose';
}

function defaultInventoryUnitForFormulation(formulation = 'Other', behavior = '') {
    const def = dosageFormDefinition(formulation);
    if ((behavior || defaultInventoryBehaviorForFormulation(formulation)) === 'container-finish') {
        return def.containerUnit || def.stockUnit || 'container';
    }
    return def.stockUnit || formulationDoseUnits[formulation] || 'unit';
}

function defaultAdministrationUnitForFormulation(formulation = 'Other') {
    const def = dosageFormDefinition(formulation);
    return def.adminUnit || formulationDoseUnits[formulation] || 'unit';
}

function defaultPerUnitForFormulation(formulation = 'Other') {
    const def = dosageFormDefinition(formulation);
    return def.perUnit || '';
}

function isConcentrationFormulation(formulation = 'Other') {
    return dosageFormDefinition(formulation).strengthStyle === 'concentration';
}

function isTopicalMedication(med) {
    return isTopicalFormulation(med?.formulation || '');
}

function usesContainerTracking(med) {
    return med?.inventoryBehavior === 'container-finish' || dosageFormUsesContainerTracking(med?.formulation || '');
}

function finishedContainerButtonText(med) {
    const unit = String(inventoryUnitFor(med) || '').toLowerCase();
    return unit.includes('bottle') ? 'Finished Bottle' : 'Finished Container';
}

function inventoryUnitFor(med) {
    return med?.inventoryUnit || defaultInventoryUnitForFormulation(med?.formulation || 'Other', med?.inventoryBehavior);
}

function ensureMedKits() {
    db.medKits = Array.isArray(db.medKits) ? db.medKits : [];
}

function medKitName(kit) {
    return String(kit?.name || '').trim() || 'Unnamed Kit';
}

function medKitItemId() {
    return `kit_item_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function kitItemMed(item) {
    return db.inventory.find(med => med.id === item.medId) || null;
}

function isExpiringWithinDays(dateValue, days = 10) {
    const date = parseLocal(dateValue);
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + days);
    return date <= cutoff;
}

function medKitHasExpiringSoon(kit) {
    return (kit?.items || []).some(item => isExpiringWithinDays(item.expiry, 10));
}

function kitSourceOptionsForMed(medId) {
    ensureMedKits();
    const sources = [];
    db.medKits.forEach(kit => {
        (kit.items || []).forEach(item => {
            if (item.medId === medId && parseAmount(item.qty, 0) > 0) {
                sources.push({ kit, item });
            }
        });
    });
    return sources;
}

function kitSourceSelectHtml(medId) {
    const sources = kitSourceOptionsForMed(medId);
    if (sources.length === 0) return '';
    const options = sources.map(({ kit, item }) => {
        const med = kitItemMed(item);
        const unit = med ? inventoryUnitFor(med) : item.unit || 'unit';
        return `<option value="${escapeHtml(`${kit.id}|${item.id}`)}">${escapeHtml(`${medKitName(kit)} - ${formatAmount(parseAmount(item.qty))} ${unit} available`)}</option>`;
    }).join('');
    return `<div class="field-row" style="margin-top:8px;">
        <label>Inventory source:</label>
        <select name="inventorySource" style="width:260px;">
            <option value="main">Main inventory</option>
            ${options}
        </select>
    </div>`;
}

function consumeFromKitSource(sourceValue, med, qty) {
    if (!sourceValue || sourceValue === 'main') return { sourceLabel: 'Main inventory', kitItem: null };
    const [kitId, itemId] = String(sourceValue).split('|');
    const kit = db.medKits.find(candidate => candidate.id === kitId);
    const item = kit?.items?.find(candidate => candidate.id === itemId && candidate.medId === med.id);
    if (!kit || !item) return { error: 'The selected med kit item could not be found.' };
    if (parseAmount(item.qty, 0) < qty) {
        return { error: `Insufficient kit quantity. ${medKitName(kit)} has ${formatAmount(parseAmount(item.qty))} ${inventoryUnitFor(med)}.` };
    }
    item.qty = parseAmount(item.qty, 0) - qty;
    if (item.qty <= 0) kit.items = kit.items.filter(candidate => candidate.id !== item.id);
    kit.updatedAt = new Date().toISOString();
    return { sourceLabel: `Med Kit (${medKitName(kit)})`, kitItem: item };
}

function returnKitItemToInventory(kit, item) {
    const med = kitItemMed(item);
    if (!med) return false;
    med.stock = parseAmount(med.stock, 0) + parseAmount(item.qty, 0);
    if (parseAmount(med.maxCapacity, 0) < parseAmount(med.stock, 0)) med.maxCapacity = med.stock;
    kit.items = (kit.items || []).filter(candidate => candidate.id !== item.id);
    kit.updatedAt = new Date().toISOString();
    return true;
}

function removeKitItemFromKit(kit, item) {
    if (!kit || !item) return;
    kit.items = (kit.items || []).filter(candidate => candidate.id !== item.id);
    kit.updatedAt = new Date().toISOString();
}

function defaultActualDateTime() {
    const now = new Date();
    return {
        date: localDateKey(now),
        time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
    };
}

async function requestActualAdministration(title, extraHtml = '', confirmText = 'Administer') {
    const defaults = defaultActualDateTime();
    const result = await showActionModal(title, `
        <div class="field-row">
            <label>Date Taken:</label><input name="actualDate" type="date" value="${defaults.date}">
            <label>Time:</label><input name="actualTime" type="time" value="${defaults.time}">
        </div>
        ${extraHtml}
    `, confirmText);
    if (!result) return null;
    if (!result.actualDate || !result.actualTime) {
        await appAlert("Actual date and time are required.");
        return null;
    }
    return result;
}

async function requestScheduledDoseDocumentation(schedule, title) {
    const med = db.inventory.find(item => item.id === schedule.medId);
    const defaults = defaultActualDateTime();
    const range = getInstanceSelectionRange(schedule);
    const instances = getScheduleInstancesInRange(schedule, range.start, range.end);
    const availableInstances = instances.filter(instance => !isScheduleInstanceDocumented(schedule.id, instance.date, instance.time));
    if (instances.length === 0) {
        await appAlert("No scheduled dose instances were found for this medication.");
        return null;
    }
    if (availableInstances.length === 0) {
        await appAlert("All scheduled dose instances in the selectable range have already been documented.");
        return null;
    }
    const nextInstance = getNextAvailableScheduleInstance(schedule);
    const options = instances.map(instance => {
        const documented = isScheduleInstanceDocumented(schedule.id, instance.date, instance.time);
        const selected = nextInstance && nextInstance.date === instance.date && nextInstance.time === instance.time ? 'selected' : '';
        return `<option value="${escapeHtml(`${instance.date}|${instance.time}`)}" ${selected} ${documented ? 'disabled' : ''}>${escapeHtml(instance.date)} ${escapeHtml(instance.time)}${documented ? ' - already documented' : ''}</option>`;
    }).join('');

    const result = await showActionModal(title, `
        <div class="field-row">
            <label>Scheduled dose:</label>
            <select name="scheduledInstance" style="width:220px;">${options || '<option value="">No scheduled doses</option>'}</select>
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Status:</label>
            <select name="doseStatus">
                <option value="given">Given as scheduled</option>
                <option value="late">Given late</option>
                <option value="early">Given early</option>
                <option value="skipped">Skipped</option>
                <option value="missed">Missed / forgotten</option>
            </select>
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Date documented/taken:</label><input name="actualDate" type="date" value="${defaults.date}">
            <label>Time:</label><input name="actualTime" type="time" value="${defaults.time}">
        </div>
        ${med ? kitSourceSelectHtml(med.id) : ''}
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Note:</label>
            <textarea name="doseNote" rows="2" style="width:100%; resize:none;" placeholder="Optional note"></textarea>
        </div>
    `, 'Save');
    if (!result) return null;
    const [scheduledDate, scheduledTime] = String(result.scheduledInstance || '').split('|');
    result.scheduledDate = scheduledDate;
    result.scheduledTime = scheduledTime;
    if (!result.scheduledDate || !result.scheduledTime || !result.actualDate || !result.actualTime) {
        await appAlert("Scheduled date/time and documented date/time are required.");
        return null;
    }
    if (!isScheduleDueOnDate(schedule, result.scheduledDate) || !getScheduleInstancesForDate(schedule, result.scheduledDate).some(instance => instance.time === result.scheduledTime)) {
        await appAlert("That medication is not scheduled for the selected date and time.");
        return null;
    }
    if (isScheduleInstanceDocumented(schedule.id, result.scheduledDate, result.scheduledTime)) {
        await appAlert("That scheduled dose instance has already been documented.");
        return null;
    }
    normalizeScheduledDoseActualTime(result);
    return result;
}

function normalizeScheduledDoseActualTime(actual) {
    const status = actual?.doseStatus || 'given';
    if (['given', 'skipped', 'missed'].includes(status) && actual.scheduledDate && actual.scheduledTime) {
        actual.actualDate = actual.scheduledDate;
        actual.actualTime = actual.scheduledTime;
    }
    return actual;
}

function formatActualTimestamp(actual) {
    return `${actual.actualDate} ${actual.actualTime}`;
}

function memberDisplayName(member) {
    return member ? `${member.lastName}, ${member.firstName}` : 'Unknown member';
}

function memberOptionsHtml(selected = '') {
    return db.family
        .slice()
        .sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b), undefined, { sensitivity: 'base' }))
        .map(member => `<option value="${member.id}" ${member.id === selected ? 'selected' : ''}>${escapeHtml(memberDisplayName(member))}</option>`)
        .join('');
}

function assignedMemberIds(med) {
    return Array.isArray(med?.assignedMemberIds) ? med.assignedMemberIds.filter(Boolean) : [];
}

function medicationAssignedToMember(med, memberId) {
    const assigned = assignedMemberIds(med);
    return assigned.length === 0 || assigned.includes(memberId);
}

function medicationAssignmentText(med) {
    const assigned = assignedMemberIds(med);
    if (assigned.length === 0) return 'All members';
    const names = assigned
        .map(id => db.family.find(member => member.id === id))
        .filter(Boolean)
        .map(memberDisplayName);
    return names.length ? names.join(', ') : 'Selected members';
}

function renderMedicationAssignmentControls(prefix, selectedIds = null) {
    const mode = document.getElementById(`${prefix}-assignment-mode`);
    const container = document.getElementById(`${prefix}-assigned-members`);
    if (!mode || !container) return;
    const currentSelected = selectedIds || Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value);
    if (selectedIds) mode.value = selectedIds.length ? 'selected' : 'all';
    container.innerHTML = db.family.length
        ? db.family
            .slice()
            .sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b), undefined, { sensitivity: 'base' }))
            .map(member => {
                const inputId = `${prefix}-assigned-${member.id}`;
                return `<span class="member-assignment-option">
                    <input id="${escapeHtml(inputId)}" type="checkbox" value="${escapeHtml(member.id)}" ${currentSelected.includes(member.id) ? 'checked' : ''}>
                    <label for="${escapeHtml(inputId)}">${escapeHtml(memberDisplayName(member))}</label>
                </span>`;
            }).join('')
        : '<span class="form-help">Add members before assigning inventory.</span>';
    container.style.display = mode.value === 'selected' ? 'flex' : 'none';
}

window.updateMedicationAssignmentMode = function(prefix) {
    renderMedicationAssignmentControls(prefix);
};

function collectMedicationAssignment(prefix) {
    const mode = document.getElementById(`${prefix}-assignment-mode`)?.value || 'all';
    if (mode !== 'selected') return [];
    return Array.from(document.querySelectorAll(`#${prefix}-assigned-members input[type="checkbox"]:checked`))
        .map(input => input.value)
        .filter(Boolean);
}

function prescriberDisplayName(prescriber) {
    if (!prescriber) return '';
    return [prescriber.name, prescriber.specialty].filter(Boolean).join(' - ');
}

function prescriberIdentityKey(prescriber) {
    return [
        prescriber?.name,
        prescriber?.specialty,
        prescriber?.phone,
        prescriber?.fax,
        prescriber?.email,
        prescriber?.address
    ].map(value => String(value || '').trim().toLowerCase()).join('|');
}

function normalizeMemberDiagnoses(member) {
    if (Array.isArray(member?.diagnosesList)) return member.diagnosesList.filter(Boolean);
    if (Array.isArray(member?.diagnoses)) return member.diagnoses.filter(Boolean);
    return String(member?.diagnoses || '')
        .split(/[\n,;]+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function memberPrescriberIds(member) {
    return Array.isArray(member?.prescriberIds) ? member.prescriberIds.filter(Boolean) : [];
}

function memberPrescriberRecords(member) {
    const ids = new Set(memberPrescriberIds(member));
    return db.prescribers.filter(prescriber => ids.has(prescriber.id));
}

function getMemberDiagnoses(member) {
    return normalizeMemberDiagnoses(member);
}

function getMemberAllergies(member) {
    return normalizeMemberAllergies(member);
}

function memberMonitoringProfiles(member) {
    return Array.isArray(member?.monitoringProfiles) ? member.monitoringProfiles.filter(Boolean) : [];
}

function normalizeMemberAllergies(member) {
    return Array.isArray(member?.allergies)
        ? member.allergies
            .map(item => ({
                id: item.id || `allergy_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                type: item.type === 'intolerance' ? 'intolerance' : 'allergy',
                medId: item.medId || '',
                name: String(item.name || '').trim(),
                reaction: String(item.reaction || '').trim()
            }))
            .filter(item => item.medId || item.name)
        : [];
}

function allergyTypeLabel(type) {
    return type === 'intolerance' ? 'Intolerance' : 'Allergy';
}

function allergyDisplayName(record) {
    const med = record?.medId ? db.inventory.find(item => item.id === record.medId) : null;
    return med ? `${med.name} ${formatMedStrength(med)}` : (record?.name || 'Unnamed');
}

function medicationAllergySearchText(med) {
    return [
        med?.name,
        formatMedStrength(med || {}),
        ...(med?.components || []).flatMap(component => [component.name, component.unit])
    ].filter(Boolean).join(' ').toLowerCase();
}

function allergyMatchesMedication(record, med) {
    if (!record || !med) return false;
    if (record.medId && record.medId === med.id) return true;
    const allergyName = String(record.name || '').trim().toLowerCase();
    if (!allergyName) return false;
    return medicationAllergySearchText(med).includes(allergyName) ||
        allergyName.includes(String(med.name || '').trim().toLowerCase());
}

function medicationAllergyMatches(member, med) {
    return normalizeMemberAllergies(member).filter(record => allergyMatchesMedication(record, med));
}

function prescriberOptionsHtml(selected = '', memberId = '', includeAll = true) {
    const member = db.family.find(item => item.id === memberId);
    const allowedIds = member ? new Set(memberPrescriberIds(member)) : null;
    const seen = new Set();
    const prescribers = db.prescribers
        .slice()
        .filter(prescriber => includeAll || !allowedIds || allowedIds.has(prescriber.id) || prescriber.id === selected)
        .filter(prescriber => {
            const key = prescriberIdentityKey(prescriber) || prescriber.id;
            if (prescriber.id !== selected && seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => prescriberDisplayName(a).localeCompare(prescriberDisplayName(b), undefined, { sensitivity: 'base' }));
    return `<option value="">Optional</option>` + prescribers
        .map(prescriber => `<option value="${prescriber.id}" ${prescriber.id === selected ? 'selected' : ''}>${escapeHtml(prescriberDisplayName(prescriber))}</option>`)
        .join('');
}

function prescriberNameById(id) {
    const prescriber = db.prescribers.find(item => item.id === id);
    return prescriber ? prescriberDisplayName(prescriber) : '';
}

function getHiddenJson(id, fallback = []) {
    const input = document.getElementById(id);
    if (!input?.value) return fallback;
    try {
        const parsed = JSON.parse(input.value);
        return Array.isArray(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
}

function setHiddenJson(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = JSON.stringify(value || []);
}

function renderMemberCareLists() {
    const prescriberIds = getHiddenJson('m-prescriber-ids-data');
    const diagnoses = getHiddenJson('m-diagnoses-data');
    const allergies = document.getElementById('m-allergies-data')
        ? getHiddenJson('m-allergies-data')
        : [];
    const prescriberList = document.getElementById('m-prescriber-list');
    const diagnosisList = document.getElementById('m-diagnosis-list');
    const allergyList = document.getElementById('m-allergy-list');

    if (prescriberList) {
        prescriberList.innerHTML = prescriberIds.length
            ? prescriberIds.map(id => {
                const prescriber = db.prescribers.find(item => item.id === id);
                return `<div class="med-item-row" style="font-size:11px;">
                    <span>${escapeHtml(prescriber ? prescriberDisplayName(prescriber) : 'Unknown prescriber')}</span>
                    ${prescriber ? `<button type="button" onclick="editPrescriberProfile('${escapeHtml(id)}')">Edit</button>` : ''}
                    <button type="button" onclick="deleteMemberPrescriber('${escapeHtml(id)}')">Delete</button>
                </div>`;
            }).join('')
            : '<div style="font-size:11px; padding:4px;">No providers added.</div>';
    }

    if (diagnosisList) {
        diagnosisList.innerHTML = diagnoses.length
            ? diagnoses.map((diagnosis, index) => `<div class="med-item-row" style="font-size:11px;">
                <span>${escapeHtml(diagnosis)}</span>
                <button type="button" onclick="removeMemberDiagnosis(${index})">Remove</button>
            </div>`).join('')
            : '<div style="font-size:11px; padding:4px;">No diagnoses added.</div>';
    }

    if (allergyList) {
        allergyList.innerHTML = allergies.length
            ? allergies.map((record, index) => `<div class="med-item-row allergy-list-row" style="font-size:11px;">
                <span>
                    <strong>${escapeHtml(allergyTypeLabel(record.type))}:</strong> ${escapeHtml(allergyDisplayName(record))}
                    ${record.reaction ? `<br><small>Reaction: ${escapeHtml(record.reaction)}</small>` : ''}
                </span>
                <button type="button" onclick="removeMemberAllergy(${index})">Remove</button>
            </div>`).join('')
            : '<div style="font-size:11px; padding:4px;">No allergies or intolerances added.</div>';
    }
}

function renderMemberMonitoringProfiles(memberId = currentEditingMemberId) {
    const list = document.getElementById('member-monitoring-list');
    if (!list) return;
    const member = db.family.find(item => item.id === memberId);
    const profiles = memberMonitoringProfiles(member);
    if (!member) {
        list.innerHTML = '<div style="font-size:11px; padding:5px;">Save the member before adding medication or lab monitoring.</div>';
        return;
    }
    if (profiles.length === 0) {
        list.innerHTML = '<div style="font-size:11px; padding:5px;">No therapeutic medication or lab monitoring configured.</div>';
        return;
    }
    list.innerHTML = profiles.map(profile => {
        const linkedMed = db.inventory.find(item => item.id === profile.medId);
        return `<div class="med-item-row" style="font-size:11px;">
            <span>
                <strong>${escapeHtml(profile.labName)}</strong> - ${escapeHtml(profile.medicationName)}
                <br><small>Goal ${escapeHtml(formatAmount(parseAmount(profile.goalLow)))}-${escapeHtml(formatAmount(parseAmount(profile.goalHigh)))} ${escapeHtml(profile.unit || 'value')}${linkedMed ? ` | Linked to ${escapeHtml(linkedMed.name)} administrations` : ''}</small>
            </span>
            <span>
                <button type="button" onclick="editMemberMonitoringProfile('${escapeHtml(profile.id)}')">Edit</button>
                <button type="button" onclick="deleteMemberMonitoringProfile('${escapeHtml(profile.id)}')">Delete</button>
            </span>
        </div>`;
    }).join('');
}

async function openMemberMonitoringEditor(profile = null) {
    const inventoryOptions = db.inventory
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
        .map(med => `<option value="${escapeHtml(med.id)}" ${med.id === profile?.medId ? 'selected' : ''}>${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))}</option>`)
        .join('');
    const result = await showActionModal(profile ? 'Edit Medication Monitoring' : 'Add Medication or Lab Value Monitoring', `
        <div class="field-row-stacked">
            <label>Medication or Lab Value Name:</label>
            <input name="medicationName" type="text" style="width:100%;" placeholder="e.g. Warfarin" value="${escapeHtml(profile?.medicationName || '')}">
        </div>
        <div class="field-row-stacked" style="margin-top:6px;">
            <label>Link to inventory medication for adherence:</label>
            <select name="medId" style="width:100%;">
                <option value="">No inventory link</option>
                ${inventoryOptions}
            </select>
        </div>
        <div class="field-row" style="margin-top:6px;">
            <label>Lab / level:</label>
            <input name="labName" type="text" style="width:130px;" placeholder="e.g. INR" value="${escapeHtml(profile?.labName || '')}">
            <label>Unit:</label>
            <input name="unit" type="text" style="width:90px;" placeholder="e.g. ng/mL" value="${escapeHtml(profile?.unit || '')}">
        </div>
        <div class="field-row" style="margin-top:6px;">
            <label>Goal low:</label><input name="goalLow" type="number" step="any" style="width:70px;" value="${escapeHtml(profile?.goalLow ?? '')}">
            <label>Goal high:</label><input name="goalHigh" type="number" step="any" style="width:70px;" value="${escapeHtml(profile?.goalHigh ?? '')}">
        </div>
        <div class="field-row-stacked" style="margin-top:6px;">
            <label>Monitoring notes:</label>
            <textarea name="notes" rows="2" style="width:100%; resize:none;" placeholder="Optional monitoring instructions">${escapeHtml(profile?.notes || '')}</textarea>
        </div>
    `, profile ? 'Save' : 'Add');
    if (!result) return null;

    const linkedMed = db.inventory.find(item => item.id === result.medId);
    const medicationName = String(result.medicationName || linkedMed?.name || '').trim();
    const labName = String(result.labName || '').trim();
    const goalLow = parseAmount(result.goalLow, NaN);
    const goalHigh = parseAmount(result.goalHigh, NaN);
    if (!medicationName || !labName) {
        await appAlert('Medication name and lab/level name are required.');
        return null;
    }
    if (!Number.isFinite(goalLow) || !Number.isFinite(goalHigh) || goalHigh <= goalLow) {
        await appAlert('Enter a valid goal range with the high value greater than the low value.');
        return null;
    }
    return {
        ...(profile || {}),
        id: profile?.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        medicationName,
        medId: result.medId || '',
        labName,
        unit: String(result.unit || '').trim() || 'value',
        goalLow,
        goalHigh,
        notes: String(result.notes || '').trim()
    };
}

window.addMemberMonitoringProfile = async function() {
    const member = db.family.find(item => item.id === currentEditingMemberId);
    if (!member) {
        await appAlert('Save the member before adding medication or lab monitoring.');
        return;
    }
    const profile = await openMemberMonitoringEditor();
    if (!profile) return;
    member.monitoringProfiles = [...memberMonitoringProfiles(member), profile];
    await sync();
    renderMemberMonitoringProfiles(member.id);
};

window.editMemberMonitoringProfile = async function(profileId) {
    const member = db.family.find(item => item.id === currentEditingMemberId);
    const index = memberMonitoringProfiles(member).findIndex(profile => profile.id === profileId);
    if (!member || index < 0) return;
    const updated = await openMemberMonitoringEditor(member.monitoringProfiles[index]);
    if (!updated) return;
    member.monitoringProfiles[index] = updated;
    await sync();
    renderMemberMonitoringProfiles(member.id);
};

window.deleteMemberMonitoringProfile = async function(profileId) {
    const member = db.family.find(item => item.id === currentEditingMemberId);
    if (!member) return;
    if (!await appConfirm('Delete this monitoring profile and its saved lab/level readings?', 'Delete Monitoring')) return;
    member.monitoringProfiles = memberMonitoringProfiles(member).filter(profile => profile.id !== profileId);
    db.vitals = db.vitals.filter(reading => reading.monitoringId !== profileId);
    await sync();
    renderMemberMonitoringProfiles(member.id);
};

async function openPrescriberProfileEditor(prescriber = null) {
    const result = await showActionModal(prescriber ? 'Edit Provider' : 'Add Provider', `
        <div class="field-row-stacked"><label>Name:</label><input name="name" type="text" style="width:100%;" value="${escapeHtml(prescriber?.name || '')}"></div>
        <div class="field-row" style="margin-top:6px;">
            <label>Specialty:</label><input name="specialty" type="text" style="width:130px;" value="${escapeHtml(prescriber?.specialty || '')}">
            <label>Phone:</label><input name="phone" type="text" style="width:110px;" value="${escapeHtml(prescriber?.phone || '')}">
        </div>
        <div class="field-row" style="margin-top:6px;">
            <label>Fax:</label><input name="fax" type="text" style="width:120px;" value="${escapeHtml(prescriber?.fax || '')}">
            <label>Email:</label><input name="email" type="email" style="width:190px;" value="${escapeHtml(prescriber?.email || '')}">
        </div>
        <div class="field-row-stacked" style="margin-top:6px;"><label>Address:</label><input name="address" type="text" style="width:100%;" value="${escapeHtml(prescriber?.address || '')}"></div>
        <div class="field-row-stacked" style="margin-top:6px;"><label>Notes:</label><textarea name="notes" rows="2" style="width:100%; resize:none;">${escapeHtml(prescriber?.notes || '')}</textarea></div>
    `, prescriber ? 'Save' : 'Add');
    if (!result) return;
    const name = String(result.name || '').trim();
    if (!name) {
        await appAlert('Provider name is required.');
        return null;
    }
    return {
        ...(prescriber || {}),
        id: prescriber?.id || Date.now().toString(),
        name,
        specialty: String(result.specialty || '').trim(),
        phone: String(result.phone || '').trim(),
        fax: String(result.fax || '').trim(),
        email: String(result.email || '').trim(),
        address: String(result.address || '').trim(),
        notes: String(result.notes || '').trim()
    };
}

window.addMemberPrescriber = async function() {
    const prescriber = await openPrescriberProfileEditor();
    if (!prescriber) return;
    const existing = db.prescribers.find(item => prescriberIdentityKey(item) === prescriberIdentityKey(prescriber));
    if (existing) {
        prescriber.id = existing.id;
    } else {
        db.prescribers.push(prescriber);
    }
    const ids = getHiddenJson('m-prescriber-ids-data');
    setHiddenJson('m-prescriber-ids-data', Array.from(new Set([...ids, prescriber.id])));
    renderMemberCareLists();
    renderSchedulePrescriberOptions();
    await sync();
    renderMemberCareLists();
};

window.editPrescriberProfile = async function(id) {
    const index = db.prescribers.findIndex(item => item.id === id);
    if (index < 0) {
        await appAlert('Provider profile was not found.');
        return;
    }
    const updated = await openPrescriberProfileEditor(db.prescribers[index]);
    if (!updated) return;
    db.prescribers[index] = updated;
    renderMemberCareLists();
    renderSchedulePrescriberOptions();
    await sync();
    renderMemberCareLists();
};

function clearPrescriberReferences(id) {
    db.family.forEach(member => {
        member.prescriberIds = memberPrescriberIds(member).filter(item => item !== id);
    });
    db.inventory.forEach(med => {
        if (med.prescriberId === id) med.prescriberId = '';
    });
    db.schedules.forEach(schedule => {
        if (schedule.prescriberId === id) schedule.prescriberId = '';
    });
    db.orderSets.forEach(set => {
        if (Array.isArray(set.items)) {
            set.items.forEach(item => {
                if (item.prescriberId === id) item.prescriberId = '';
            });
        }
    });
}

window.deleteMemberPrescriber = async function(id) {
    if (!await appConfirm('Delete this provider profile and remove it from medication/provider dropdowns?', 'Delete Provider')) return;
    clearPrescriberReferences(id);
    db.prescribers = db.prescribers.filter(item => item.id !== id);
    setHiddenJson('m-prescriber-ids-data', getHiddenJson('m-prescriber-ids-data').filter(item => item !== id));
    renderMemberCareLists();
    renderSchedulePrescriberOptions();
    await sync();
    renderMemberCareLists();
};

window.removeMemberPrescriber = function(id) {
    setHiddenJson('m-prescriber-ids-data', getHiddenJson('m-prescriber-ids-data').filter(item => item !== id));
    renderMemberCareLists();
};

window.addMemberDiagnosis = async function() {
    const result = await showActionModal('Add Diagnosis', `
        <div class="field-row-stacked"><label>Diagnosis:</label><input name="diagnosis" type="text" style="width:100%;"></div>
    `, 'Add');
    if (!result) return;
    const diagnosis = String(result.diagnosis || '').trim();
    if (!diagnosis) {
        await appAlert('Diagnosis is required.');
        return;
    }
    setHiddenJson('m-diagnoses-data', Array.from(new Set([...getHiddenJson('m-diagnoses-data'), diagnosis])));
    renderMemberCareLists();
};

window.removeMemberDiagnosis = function(index) {
    const diagnoses = getHiddenJson('m-diagnoses-data');
    diagnoses.splice(index, 1);
    setHiddenJson('m-diagnoses-data', diagnoses);
    renderMemberCareLists();
};

window.updateAllergyInventorySelection = function() {
    const body = document.getElementById('action-modal-body');
    if (!body) return;
    const select = body.querySelector('[name="medId"]');
    const nameInput = body.querySelector('[name="name"]');
    if (!select || !nameInput) return;
    const med = db.inventory.find(item => item.id === select.value);
    if (med) nameInput.value = med.name;
};

window.addMemberAllergy = async function() {
    const inventoryOptions = db.inventory
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
        .map(med => `<option value="${escapeHtml(med.id)}">${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))}</option>`)
        .join('');
    const result = await showActionModal('Add Allergy / Intolerance', `
        <div class="field-row">
            <label>Type:</label>
            <select name="type">
                <option value="allergy">Allergy</option>
                <option value="intolerance">Intolerance</option>
            </select>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Inventory product, if listed:</label>
            <select name="medId" onchange="updateAllergyInventorySelection()" style="width:100%;">
                <option value="">Not in inventory / free text</option>
                ${inventoryOptions}
            </select>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Medication, ingredient, or product name:</label>
            <input name="name" type="text" style="width:100%;" placeholder="e.g. Penicillin, lactose, acetaminophen">
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Reaction / notes:</label>
            <textarea name="reaction" rows="2" style="width:100%; resize:none;"></textarea>
        </div>
    `, 'Add');
    if (!result) return;
    const med = db.inventory.find(item => item.id === result.medId);
    const record = {
        id: `allergy_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        type: result.type === 'intolerance' ? 'intolerance' : 'allergy',
        medId: result.medId || '',
        name: String(result.name || med?.name || '').trim(),
        reaction: String(result.reaction || '').trim()
    };
    if (!record.medId && !record.name) {
        await appAlert('Select an inventory product or enter an allergy/intolerance name.');
        return;
    }
    setHiddenJson('m-allergies-data', [...getHiddenJson('m-allergies-data'), record]);
    renderMemberCareLists();
};

window.removeMemberAllergy = function(index) {
    const allergies = getHiddenJson('m-allergies-data');
    allergies.splice(index, 1);
    setHiddenJson('m-allergies-data', allergies);
    renderMemberCareLists();
};

window.renderSchedulePrescriberOptions = function(selected = '') {
    const memberId = document.getElementById('select-member')?.value || '';
    const select = document.getElementById('sched-prescriber');
    if (select) select.innerHTML = prescriberOptionsHtml(selected || select.value, memberId, false);
};

function scheduleMedicationLabel(schedule) {
    const med = db.inventory.find(item => item.id === schedule?.medId);
    if (!schedule || !med) return 'Unknown medication';
    const times = getScheduleTimes(schedule).join(', ') || 'PRN';
    return `${med.name} ${formatMedStrength(med)} (${formatFrequency(schedule)} ${times})`;
}

function linkGroupFromTarget(targetId) {
    return targetId ? `link-${targetId}` : '';
}

function selectedOptionValues(select) {
    if (!select) return [];
    if (select.dataset?.values !== undefined) {
        return uniqueValues(select.dataset.values.split(',').map(value => value.trim()));
    }
    if (select.tagName?.toLowerCase() === 'select' && select.multiple) {
        return Array.from(select.selectedOptions).map(option => option.value).filter(Boolean);
    }
    if (select.tagName?.toLowerCase() === 'select') {
        return select.value ? [select.value] : [];
    }
    return Array.from(select.querySelectorAll('input[type="checkbox"]:checked'))
        .map(input => input.value)
        .filter(Boolean);
}

function uniqueValues(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
}

function linkRulesFromTargets(targetIds, mode) {
    return mode
        ? uniqueValues(targetIds).map(targetId => ({ targetId, mode }))
        : [];
}

function scheduleLinkRules(schedule) {
    const rules = [];
    if (Array.isArray(schedule?.linkRules)) {
        schedule.linkRules.forEach(rule => {
            if (!rule) return;
            if (rule.targetId || rule.targetRowId) {
                rules.push({
                    targetId: rule.targetId || '',
                    targetRowId: rule.targetRowId || '',
                    mode: rule.mode || schedule.linkMode || ''
                });
            }
        });
    }
    if (Array.isArray(schedule?.linkTargetIds)) {
        schedule.linkTargetIds.forEach(targetId => {
            if (targetId) rules.push({ targetId, targetRowId: '', mode: schedule.linkMode || '' });
        });
    }
    if (schedule?.linkTargetId) {
        rules.push({ targetId: schedule.linkTargetId, targetRowId: '', mode: schedule.linkMode || '' });
    }
    if (Array.isArray(schedule?.linkTargetRowIds)) {
        schedule.linkTargetRowIds.forEach(targetRowId => {
            if (targetRowId) rules.push({ targetId: '', targetRowId, mode: schedule.linkMode || '' });
        });
    }
    if (schedule?.linkTargetRowId) {
        rules.push({ targetId: '', targetRowId: schedule.linkTargetRowId, mode: schedule.linkMode || '' });
    }
    const seen = new Set();
    return rules.filter(rule => {
        const key = `${rule.targetId || ''}|${rule.targetRowId || ''}|${rule.mode || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function scheduleHasTargetedLinks(schedule) {
    return scheduleLinkRules(schedule).length > 0;
}

function scheduleRuleTargets(rule, target) {
    return (rule.targetId && rule.targetId === target?.id) || (rule.targetRowId && rule.targetRowId === target?.rowId);
}

function scheduleHasPairLink(source, target, mode = '') {
    return scheduleLinkRules(source).some(rule => scheduleRuleTargets(rule, target) && (!mode || rule.mode === mode));
}

function scheduleLinkModeBetween(a, b) {
    const pairRule = scheduleLinkRules(a).find(rule => scheduleRuleTargets(rule, b))
        || scheduleLinkRules(b).find(rule => scheduleRuleTargets(rule, a));
    if (pairRule?.mode) return pairRule.mode;
    if (!scheduleHasTargetedLinks(a) && !scheduleHasTargetedLinks(b) && a?.linkGroup && a.linkGroup === b?.linkGroup) {
        return a.linkMode || b.linkMode || 'together';
    }
    return '';
}

function schedulesLinkedByMode(a, b, mode) {
    const pairMode = scheduleLinkModeBetween(a, b);
    return pairMode === mode;
}

function normalizedScheduleEndDate(schedule) {
    if (!schedule) return '';
    if (schedule.freq === 'ONCE') return schedule.startDate || '';
    return schedule.endDate || 'Ongoing';
}

function scheduleTimingSignature(schedule) {
    if (!schedule) return '';
    return JSON.stringify({
        startDate: schedule.startDate || '',
        endDate: normalizedScheduleEndDate(schedule),
        freq: schedule.freq || '',
        times: getScheduleTimes(schedule).slice().sort(),
        intervalHours: schedule.intervalHours || null,
        intervalWeeks: schedule.intervalWeeks || null,
        monthlyAnchor: schedule.freq === 'Monthly' ? (schedule.monthlyAnchor || schedule.startDate || '') : '',
        timesPerWeek: schedule.timesPerWeek || null,
        weekdays: Array.isArray(schedule.weekdays) ? schedule.weekdays.map(Number).sort() : [],
        qodStart: schedule.freq === 'QOD' ? (schedule.qodStart || schedule.startDate || '') : ''
    });
}

function schedulesHaveAlignedTiming(a, b) {
    return scheduleTimingSignature(a) === scheduleTimingSignature(b);
}

function timingMismatchLabel(schedule) {
    return `${formatFrequency(schedule)} ${getScheduleTimes(schedule).join(', ') || 'PRN'} | ${schedule.startDate || 'No start'} - ${normalizedScheduleEndDate(schedule)}`;
}

function scheduleLinkChoices(memberId, excludeId = '') {
    const committed = db.schedules
        .filter(schedule => schedule.memberId === memberId && schedule.id !== excludeId && !isScheduleArchived(schedule))
        .map(schedule => ({
            id: schedule.id,
            group: schedule.linkGroup || linkGroupFromTarget(schedule.id),
            mode: schedule.linkMode || '',
            label: scheduleMedicationLabel(schedule),
            isPending: false
        }));
    const pending = pendingScheduleOrders
        .filter(schedule => schedule.memberId === memberId && schedule.id !== excludeId)
        .map(schedule => ({
            id: schedule.id,
            group: schedule.linkGroup || linkGroupFromTarget(schedule.id),
            mode: schedule.linkMode || '',
            label: `${scheduleMedicationLabel(schedule)} [pending]`,
            isPending: true
        }));
    return [...committed, ...pending];
}

function scheduleLinkChoicesForModifier(schedule) {
    if (!schedule) return [];
    const activeChoices = scheduleLinkChoices(schedule.memberId, schedule.id);
    const activeIds = new Set(activeChoices.map(choice => choice.id));
    const linkedArchivedChoices = linkedSchedulesFor(
        schedule,
        db.schedules.filter(candidate => candidate.memberId === schedule.memberId && candidate.id !== schedule.id)
    )
        .filter(linked => !activeIds.has(linked.id))
        .map(linked => ({
            id: linked.id,
            group: linked.linkGroup || linkGroupFromTarget(linked.id),
            mode: linked.linkMode || '',
            label: `${scheduleMedicationLabel(linked)} [completed]`,
            isPending: false,
            isArchived: true
        }));
    return [...activeChoices, ...linkedArchivedChoices];
}

function renderLinkChoicePanel(panel, choices, selected = [], pickerAction = '') {
    if (!panel) return;
    const choiceIds = new Set(choices.map(choice => choice.id));
    const selectedValues = uniqueValues(Array.isArray(selected) ? selected : (selected ? [selected] : []))
        .filter(value => choiceIds.has(value));
    panel.dataset.values = selectedValues.join(',');
    const selectedChoices = choices.filter(choice => selectedValues.includes(choice.id));
    const summary = selectedChoices.length
        ? selectedChoices.map(choice => `<span class="link-choice-chip ${choice.isPending ? 'pending-link-choice' : ''}">${escapeHtml(choice.label)}</span>`).join('')
        : '<span class="link-choice-empty">No linked medication</span>';
    const disabled = choices.length === 0 ? 'disabled' : '';
    panel.innerHTML = `
        <div class="link-choice-summary">${summary}</div>
        <button type="button" class="link-choice-button" ${disabled} onclick="event.stopPropagation(); ${pickerAction}">Choose...</button>
    `;
}

async function chooseLinkedMedications(title, choices, selectedValues) {
    if (choices.length === 0) {
        await appAlert('There are no other medications available to link.');
        return null;
    }
    const selected = new Set(uniqueValues(selectedValues));
    const result = await showActionModal(title, `
        <div class="form-help" style="margin-bottom:6px;">Check each medication that should be linked.</div>
        <div class="sunken-panel link-picker-list">
            ${choices.map((choice, index) => {
                const inputId = `link-picker-${index}`;
                return `<div class="link-picker-item ${choice.isPending ? 'pending-link-choice' : ''}" onclick="toggleLinkPickerCheckbox('${inputId}')">
                    <input id="${inputId}" name="linkIds" type="checkbox" value="${escapeHtml(choice.id)}" ${selected.has(choice.id) ? 'checked' : ''} onclick="event.stopPropagation(); updateLinkPickerRow(this);">
                    <span class="link-picker-check" aria-hidden="true"></span>
                    <label for="${inputId}" onclick="event.stopPropagation();">${escapeHtml(choice.label)}</label>
                </div>`;
            }).join('')}
        </div>
    `, 'Apply');
    if (!result) return null;
    return result.linkIds || [];
}

window.updateLinkPickerRow = function(input) {
    input?.closest('.link-picker-item')?.classList.toggle('checked', !!input.checked);
};

window.toggleLinkPickerCheckbox = function(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.checked = !input.checked;
    updateLinkPickerRow(input);
};

window.renderScheduleLinkOptions = function(selected = '') {
    const panel = document.getElementById('sched-link-target');
    if (!panel) return;
    const memberId = document.getElementById('select-member')?.value || '';
    const selectedValues = Array.isArray(selected) ? selected : (selected ? [selected] : selectedOptionValues(panel));
    const choices = scheduleLinkChoices(memberId);
    renderLinkChoicePanel(panel, choices, selectedValues, 'openScheduleLinkPicker()');
};

window.openScheduleLinkPicker = async function() {
    const panel = document.getElementById('sched-link-target');
    if (!panel) return;
    const memberId = document.getElementById('select-member')?.value || '';
    const choices = scheduleLinkChoices(memberId);
    const selected = await chooseLinkedMedications('Choose Linked Medications', choices, selectedOptionValues(panel));
    if (selected === null) return;
    renderScheduleLinkOptions(selected);
};

window.openModifierLinkPicker = async function() {
    const panel = document.getElementById('mod-link-target');
    if (!panel) return;
    const schedule = db.schedules.find(item => item.id === (panel.dataset.excludeId || ''));
    const choices = schedule ? scheduleLinkChoicesForModifier(schedule) : scheduleLinkChoices(panel.dataset.memberId || '', panel.dataset.excludeId || '');
    const selected = await chooseLinkedMedications('Choose Linked Medications', choices, selectedOptionValues(panel));
    if (selected === null) return;
    renderLinkChoicePanel(panel, choices, selected, 'openModifierLinkPicker()');
};

function linkedSchedulesFor(schedule, candidates = null) {
    const pool = candidates || db.schedules.filter(item => item.memberId === schedule.memberId && !isScheduleArchived(item));
    return pool.filter(item => item.id !== schedule.id && !!scheduleLinkModeBetween(schedule, item));
}

function linkModeLabel(mode) {
    return mode === 'choose-one' ? 'choose one' : 'together';
}

function linkedBadgeHtml(schedule, candidates = null) {
    const linked = linkedSchedulesFor(schedule, candidates);
    if (linked.length === 0) return '';
    return `<span class="linked-med-badge" title="Linked medications">&#128279; ${linked.length}</span>`;
}

function linkedDetailsHtml(schedule, candidates = null) {
    const linked = linkedSchedulesFor(schedule, candidates);
    if (linked.length === 0) return '';
    return `<details class="linked-med-details" onclick="event.stopPropagation()">
        <summary>${linkedBadgeHtml(schedule, candidates)} Linked medication${linked.length === 1 ? '' : 's'}</summary>
        <div class="linked-med-list">
            ${linked.map(item => `<div><strong>${escapeHtml(linkModeLabel(scheduleLinkModeBetween(schedule, item)))}</strong>: ${escapeHtml(scheduleMedicationLabel(item))}</div>`).join('')}
        </div>
    </details>`;
}

function applyLinkedScheduleTiming(source, target) {
    const timingFields = [
        'startDate',
        'endDate',
        'freq',
        'times',
        'intervalHours',
        'intervalWeeks',
        'monthlyAnchor',
        'timesPerWeek',
        'weekdays',
        'qodStart',
        'startTime',
        'rollingAnchorDate',
        'rollingAnchorTime',
        'isOneTime'
    ];
    timingFields.forEach(field => {
        const value = source[field];
        target[field] = Array.isArray(value) ? [...value] : value;
    });
    target.status = '';
    target.completedAt = '';
}

function removeScheduleLinkReferences(scheduleIds) {
    const removed = new Set(Array.isArray(scheduleIds) ? scheduleIds : [scheduleIds]);
    db.schedules.forEach(schedule => {
        const previousRules = scheduleLinkRules(schedule);
        const hadRemovedTarget = previousRules.some(rule => rule.targetId && removed.has(rule.targetId));
        const nextTargetIds = uniqueValues(schedule.linkTargetIds || (schedule.linkTargetId ? [schedule.linkTargetId] : []))
            .filter(targetId => !removed.has(targetId));
        schedule.linkTargetIds = nextTargetIds;
        schedule.linkTargetId = nextTargetIds[0] || '';
        schedule.linkRules = previousRules
            .filter(rule => !rule.targetId || !removed.has(rule.targetId));
        if (hadRemovedTarget && schedule.linkMode && nextTargetIds.length === 0 && schedule.linkRules.length === 0) {
            schedule.linkMode = '';
            schedule.linkGroup = '';
        }
    });
}

let activeAdminOrderSetSchedules = [];

function chooseOneAlternatives(schedule, schedules = activeAdminOrderSetSchedules) {
    return schedules.filter(other => other.id !== schedule.id && schedulesLinkedByMode(schedule, other, 'choose-one'));
}

function directTogetherSchedules(schedule, schedules = activeAdminOrderSetSchedules) {
    return schedules.filter(other => other.id !== schedule.id && schedulesLinkedByMode(schedule, other, 'together'));
}

function requiredTogetherSchedules(schedule, schedules = activeAdminOrderSetSchedules) {
    const required = new Map();
    directTogetherSchedules(schedule, schedules).forEach(other => required.set(other.id, other));
    chooseOneAlternatives(schedule, schedules).forEach(alternative => {
        directTogetherSchedules(alternative, schedules).forEach(other => {
            if (other.id !== schedule.id) required.set(other.id, other);
        });
    });
    return Array.from(required.values());
}

function selectedSetHasChooseOneConflict(scheduleId, selectedIds, schedules = activeAdminOrderSetSchedules) {
    const schedule = schedules.find(item => item.id === scheduleId);
    if (!schedule) return false;
    return schedules.some(other => other.id !== schedule.id && selectedIds.has(other.id) && schedulesLinkedByMode(schedule, other, 'choose-one'));
}

function normalizeAdminOrderSetSelection(inputs, changedSchedule = null, changedChecked = true) {
    const schedules = activeAdminOrderSetSchedules;
    const selectedIds = new Set(inputs.filter(input => input.checked).map(input => input.value));
    if (changedSchedule && changedChecked) {
        chooseOneAlternatives(changedSchedule, schedules).forEach(other => selectedIds.delete(other.id));
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (const schedule of schedules) {
            if (!selectedIds.has(schedule.id)) continue;
            for (const required of requiredTogetherSchedules(schedule, schedules)) {
                if (selectedSetHasChooseOneConflict(required.id, selectedIds, schedules)) continue;
                if (!selectedIds.has(required.id)) {
                    selectedIds.add(required.id);
                    changed = true;
                }
            }
        }
    }

    inputs.forEach(input => {
        input.checked = selectedIds.has(input.value);
    });
}

window.adminOrderSetSubmitAll = function() {
    const modal = document.getElementById('action-modal');
    if (!modal) return;
    const inputs = Array.from(modal.querySelectorAll('.admin-os-med'));
    inputs.forEach(input => { input.checked = false; });
    inputs.forEach(input => {
        const schedule = activeAdminOrderSetSchedules.find(item => item.id === input.value);
        if (!schedule) return;
        const hasSelectedChooseOneConflict = activeAdminOrderSetSchedules.some(other => {
            const otherInput = inputs.find(candidate => candidate.value === other.id);
            return otherInput?.checked && schedulesLinkedByMode(schedule, other, 'choose-one');
        });
        if (!hasSelectedChooseOneConflict) {
            input.checked = true;
            normalizeAdminOrderSetSelection(inputs, schedule, true);
        }
    });
    modal.querySelector('#action-modal-ok')?.click();
};

window.adminOrderSetToggleLinked = function(input) {
    const modal = document.getElementById('action-modal');
    if (!modal || !input) return;
    const current = activeAdminOrderSetSchedules.find(schedule => schedule.id === input.value);
    if (!current) return;
    const inputs = Array.from(modal.querySelectorAll('.admin-os-med'));
    if (input.checked) {
        chooseOneAlternatives(current).forEach(other => {
            const otherInput = inputs.find(candidate => candidate.value === other.id);
            if (otherInput) otherInput.checked = false;
        });
    }
    normalizeAdminOrderSetSelection(inputs, current, input.checked);
};

window.switchTab = function(tabName) {
    const tabs = ['dashboard', 'schedules', 'prepackage', 'order-sets', 'vitals', 'inventory', 'recipes', 'family', 'drug-info', 'help'];
    tabs.forEach(t => {
        const tabElement = document.getElementById(`tab-${t}`);
        const panelElement = document.getElementById(`panel-${t}`);
        if (t === tabName) {
            if (tabElement) tabElement.classList.add('active');
            if (panelElement) panelElement.style.display = t === 'schedules' ? 'grid' : 'block';
        } else {
            if (tabElement) tabElement.classList.remove('active');
            if (panelElement) panelElement.style.display = 'none';
        }
    });
};

async function sync() {
    updateScheduleCompletionStates();
    const saveResult = await window.api.save(db);
    if (saveResult?.conflictBackup && saveResult.conflictBackup !== lastDataConflictBackup) {
        lastDataConflictBackup = saveResult.conflictBackup;
        addAudit('Sync conflict backup', 'Desktop Sync Folder', `Existing synced data changed before save. Backup preserved at ${saveResult.conflictBackup}`);
        setTimeout(() => appAlert(`PharmAtlas detected that the synced data file changed before this save. A conflict backup was preserved:\n${saveResult.conflictBackup}`, 'Sync Conflict Backup'), 100);
    }
    renderAll();
    const memberModal = document.getElementById('member-modal');
    if (currentEditingMemberId && memberModal?.style.display === 'flex') {
        renderMemberAdministrationLog(currentEditingMemberId);
        renderMemberVitalProfile(currentEditingMemberId);
        renderMemberAdherenceProfile(currentEditingMemberId);
        renderMemberMonitoringProfiles(currentEditingMemberId);
        renderMemberPrnMedicationOrders(currentEditingMemberId);
        renderMemberMedicationReview(currentEditingMemberId);
        renderMemberMedicationTimelines();
        renderMemberCalendar(currentEditingMemberId);
    }
}

// --- FAMILY ---
window.removeMember = async function(id) {
    if (await appConfirm("Are you sure you want to remove this person?", "Remove Member")) {
        const member = db.family.find(m => m.id === id);
        db.family = db.family.filter(m => m.id !== id);
        db.schedules = db.schedules.filter(s => s.memberId !== id);
        db.orderSets = db.orderSets.filter(set => set.memberId !== id);
        db.vitals = db.vitals.filter(reading => reading.memberId !== id);
        addAudit('Member removed', member ? memberDisplayName(member) : id, 'Member profile and related schedules were removed.');
        await sync();
    }
};

function renderMemberPrnMedicationOrders(memberId) {
    const container = document.getElementById('member-prn-meds-list');
    if (!container) return;
    const schedules = db.schedules.filter(schedule => schedule.memberId === memberId && schedule.freq === 'PRN' && !isScheduleArchived(schedule));
    if (schedules.length === 0) {
        container.innerHTML = '<div style="font-size:11px; padding:5px;">No PRN medications.</div>';
        return;
    }
    const candidates = db.schedules.filter(schedule => schedule.memberId === memberId && !isScheduleArchived(schedule));
    container.innerHTML = schedules.map(schedule => {
        const med = db.inventory.find(item => item.id === schedule.medId);
        const set = schedule.orderSetId ? db.orderSets.find(item => item.id === schedule.orderSetId) : null;
        if (!med) return '';
        return `<div class="sunken-panel" style="padding:5px; margin-bottom:5px; background:white; border:1px inset gray;">
            <strong>${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))}</strong>
            ${set ? `<span class="form-help"> | Regimen: ${escapeHtml(set.name)}</span>` : ''}
            <br><small>Dose: ${escapeHtml(formatPrescribedDose(med, schedule.doseQty))} | Qty: ${escapeHtml(formatQtyForSchedule(schedule, med))}${escapeHtml(prnLimitText(schedule))}</small>
            ${linkedDetailsHtml(schedule, candidates)}
            <div class="member-med-timeline" data-schedule-id="${escapeHtml(schedule.id)}"></div>
            <div style="text-align:right; margin-top:5px;">
                <button onclick="event.stopPropagation(); printSingleLabel('${escapeHtml(schedule.id)}')">Label</button>
                <button onclick="event.stopPropagation(); administerDose('${escapeHtml(schedule.medId)}','${escapeHtml(schedule.id)}')">Administer</button>
                ${usesContainerTracking(med) ? `<button onclick="event.stopPropagation(); finishTopicalContainer('${escapeHtml(schedule.id)}')">${escapeHtml(finishedContainerButtonText(med))}</button>` : ''}
                ${set
                    ? `<button onclick="event.stopPropagation(); editOrderSet('${escapeHtml(set.id)}')">Edit Regimen</button>`
                    : `<button onclick="event.stopPropagation(); openOrderModifier('${escapeHtml(schedule.id)}')">Modify</button>
                       <button onclick="event.stopPropagation(); deleteSchedule('${escapeHtml(schedule.id)}')">Discontinue</button>`}
            </div>
        </div>`;
    }).join('');
}

function completedScheduleSummaryHtml(schedule, candidates = null) {
    const med = db.inventory.find(item => item.id === schedule.medId);
    const statusText = schedule.status === 'discontinued' ? 'Discontinued' : 'Completed';
    const linked = linkedSchedulesFor(schedule, candidates || db.schedules.filter(item => item.memberId === schedule.memberId));
    const modifyAction = linked.length > 0
        ? `<button type="button" onclick="event.stopPropagation(); openOrderModifier('${escapeHtml(schedule.id)}')">Modify / Extend Linked</button>`
        : `<button type="button" onclick="event.stopPropagation(); openOrderModifier('${escapeHtml(schedule.id)}')">Modify / Extend</button>`;
    const linkedRemoveAction = linked.length > 0
        ? `<button type="button" onclick="event.stopPropagation(); removeCompletedLinkedSchedules('${escapeHtml(schedule.id)}')">Remove All Linked Meds</button>`
        : '';
    return `<div class="completed-med-row">
        <div class="completed-med-header">
            <div class="completed-med-main">
                <strong>${escapeHtml(med?.name || 'Unknown medication')} ${escapeHtml(med ? formatMedStrength(med) : '')}</strong><br>
                <small class="completed-med-summary">${escapeHtml(statusText)} | ${escapeHtml(schedule.startDate || '')} - ${escapeHtml(schedule.endDate || 'Ongoing')} | Dose: ${med ? escapeHtml(formatPrescribedDose(med, schedule.doseQty)) : escapeHtml(schedule.doseQty || '')} | ${escapeHtml(formatFrequency(schedule))} ${escapeHtml(getScheduleTimes(schedule).join(', ') || 'PRN')}</small>
                ${linkedDetailsHtml(schedule, candidates || db.schedules.filter(item => item.memberId === schedule.memberId))}
            </div>
            <div class="completed-med-actions">
                ${modifyAction}
                ${linkedRemoveAction}
                <button type="button" onclick="event.stopPropagation(); removeCompletedSchedule('${escapeHtml(schedule.id)}')">Remove</button>
                ${med ? `<button type="button" onclick="event.stopPropagation(); printSingleLabel('${escapeHtml(schedule.id)}')">Label</button>` : ''}
            </div>
        </div>
        <div class="member-med-timeline" data-schedule-id="${escapeHtml(schedule.id)}"></div>
    </div>`;
}

function renderCompletedMedicationOrders(memberId) {
    const container = document.getElementById('member-completed-meds-list');
    if (!container) return;
    const completedSets = db.orderSets
        .filter(set => set.memberId === memberId && set.status === 'completed')
        .sort((a, b) => String(b.completedAt || b.endDate || '').localeCompare(String(a.completedAt || a.endDate || '')));
    const completedSingles = db.schedules
        .filter(schedule => schedule.memberId === memberId && !schedule.orderSetId && isScheduleArchived(schedule))
        .sort((a, b) => String(b.completedAt || b.endDate || '').localeCompare(String(a.completedAt || a.endDate || '')));
    const completedCandidates = db.schedules.filter(schedule => schedule.memberId === memberId);

    const setHtml = completedSets.map(set => {
        const setSchedules = db.schedules.filter(schedule => schedule.orderSetId === set.id);
        return `<div class="completed-med-row completed-order-set">
            <div class="completed-med-header">
                <div class="completed-med-main">
                    <strong>${escapeHtml(set.name)}</strong><br>
                    <small class="completed-med-summary">Completed | ${escapeHtml(set.startDate || '')} - ${escapeHtml(set.endDate || 'Ongoing')}</small>
                </div>
                <div class="completed-med-actions">
                    <button type="button" onclick="event.stopPropagation(); editOrderSet('${escapeHtml(set.id)}')">Edit / Extend Regimen</button>
                    <button type="button" onclick="event.stopPropagation(); removeCompletedOrderSet('${escapeHtml(set.id)}')">Remove</button>
                    <button type="button" onclick="event.stopPropagation(); printOrderSetLabel('${escapeHtml(set.id)}')">Regimen Label</button>
                </div>
            </div>
            <div class="completed-regimen-items">${setSchedules.map(schedule => completedScheduleSummaryHtml(schedule, setSchedules)).join('')}</div>
        </div>`;
    }).join('');

    const singlesHtml = completedSingles.map(schedule => completedScheduleSummaryHtml(schedule, completedCandidates)).join('');
    container.innerHTML = setHtml || singlesHtml
        ? `${setHtml}${singlesHtml}`
        : '<div class="empty-state">No completed medications.</div>';
}

window.removeCompletedSchedule = async function(scheduleId) {
    const schedule = db.schedules.find(item => item.id === scheduleId);
    if (!schedule || !isScheduleArchived(schedule)) return;
    if (!await appConfirm('Remove this completed medication from the profile list? Administration history will remain.', 'Remove Completed Medication')) return;
    removeScheduleLinkReferences(scheduleId);
    db.schedules = db.schedules.filter(item => item.id !== scheduleId);
    await sync();
    if (currentEditingMemberId) openMemberModal(currentEditingMemberId);
};

window.removeCompletedLinkedSchedules = async function(scheduleId) {
    const schedule = db.schedules.find(item => item.id === scheduleId);
    if (!schedule || !isScheduleArchived(schedule)) return;
    const candidates = db.schedules.filter(item => item.memberId === schedule.memberId);
    const linked = linkedSchedulesFor(schedule, candidates).filter(isScheduleArchived);
    const toRemove = [schedule, ...linked];
    if (!await appConfirm(`Remove ${toRemove.length} linked completed medication${toRemove.length === 1 ? '' : 's'} from the profile list? Administration history will remain.`, 'Remove Linked Completed Medications')) return;
    const removeIds = new Set(toRemove.map(item => item.id));
    removeScheduleLinkReferences([...removeIds]);
    db.schedules = db.schedules.filter(item => !removeIds.has(item.id));
    await sync();
    if (currentEditingMemberId) openMemberModal(currentEditingMemberId);
};

window.removeCompletedOrderSet = async function(orderSetId) {
    const set = db.orderSets.find(item => item.id === orderSetId);
    if (!set || set.status !== 'completed') return;
    if (!await appConfirm('Remove this completed regimen from the profile list? Administration history will remain.', 'Remove Completed Regimen')) return;
    db.orderSets = db.orderSets.filter(item => item.id !== orderSetId);
    const removeIds = db.schedules.filter(item => item.orderSetId === orderSetId).map(item => item.id);
    removeScheduleLinkReferences(removeIds);
    db.schedules = db.schedules.filter(item => item.orderSetId !== orderSetId);
    await sync();
    if (currentEditingMemberId) openMemberModal(currentEditingMemberId);
};

function memberTaskIdFor(memberId) {
    return `member-modal-${memberId || 'new'}`;
}

function memberTaskLabel(member) {
    if (!member) return 'New Member Profile';
    const relation = member.middleName ? ` ${member.middleName}` : '';
    return `${member.firstName || ''}${relation} ${member.lastName || ''}`.trim() || 'Member Profile';
}

function memberTaskIconHtml(member) {
    const sex = String(member?.sex || '').toLowerCase();
    const sexClass = sex === 'female' ? 'female' : 'male';
    const color = member?.calendarColor || (sexClass === 'female' ? '#c04682' : '#1f66b5');
    return `<span class="taskbar-patient-icon ${sexClass}" style="--patient-color:${escapeHtml(color)}"><span></span></span>`;
}

function memberFormHasAnyInput() {
    return ['m-first', 'm-middle', 'm-last', 'm-age', 'm-dob', 'm-addr', 'm-phone', 'm-email']
        .some(fieldId => String(document.getElementById(fieldId)?.value || '').trim());
}

function collectMemberFormData() {
    const vitalGoals = collectMemberGoals();
    if (!vitalGoals) return null;
    const typedDiagnoses = String(document.getElementById('m-diag').value || '')
        .split(/[\n,;]+/)
        .map(item => item.trim())
        .filter(Boolean);
    const diagnosesList = Array.from(new Set([...getHiddenJson('m-diagnoses-data'), ...typedDiagnoses]));
    const prescriberIds = getHiddenJson('m-prescriber-ids-data');
    const allergies = normalizeMemberAllergies({ allergies: getHiddenJson('m-allergies-data') });
    const firstName = document.getElementById('m-first').value.trim();
    const lastName = document.getElementById('m-last').value.trim();
    if (!firstName || !lastName) {
        alert("First and Last Name required.");
        return null;
    }
    return {
        firstName,
        middleName: document.getElementById('m-middle').value,
        lastName,
        sex: document.getElementById('m-sex').value,
        age: document.getElementById('m-age').value,
        dob: document.getElementById('m-dob').value,
        providers: document.getElementById('m-providers').value,
        diagnoses: diagnosesList.join(', '),
        diagnosesList,
        allergies,
        address: document.getElementById('m-addr').value,
        phone: document.getElementById('m-phone').value,
        email: document.getElementById('m-email').value,
        prescriberIds,
        notificationPrefs: {
            medicationReminders: document.getElementById('m-notify-enabled')?.checked !== false,
            emailReminders: document.getElementById('m-email-reminders')?.checked === true
        },
        calendarColor: document.getElementById('m-calendar-color').value || '#000080',
        vitalGoals,
        name: `${firstName} ${lastName}`
    };
}

function registerMemberTask(member, active = true) {
    if (!member?.id) return;
    const taskId = memberTaskIdFor(member.id);
    activeMemberTaskId = taskId;
    registerWorkspaceTask(taskId, memberTaskLabel(member), () => {
        openMemberModal(member.id);
        setWorkspaceTaskActive(taskId, true);
    }, {
        type: 'patient',
        iconHtml: memberTaskIconHtml(member),
        color: member.calendarColor || '',
        sex: String(member.sex || '').toLowerCase()
    });
    if (!active) setWorkspaceTaskActive(taskId, false);
}

async function saveMemberFromProfile({ closeAfter = true } = {}) {
    const data = collectMemberFormData();
    if (!data) return false;
    let savedMember = null;
    const wasEditingMember = !!currentEditingMemberId;
    if (currentEditingMemberId) {
        const index = db.family.findIndex(m => m.id === currentEditingMemberId);
        if (index >= 0) {
            db.family[index] = { ...db.family[index], ...data };
            savedMember = db.family[index];
        } else {
            savedMember = { id: currentEditingMemberId, ...data };
            db.family.push(savedMember);
        }
    } else {
        savedMember = { id: Date.now().toString(), ...data };
        db.family.push(savedMember);
        currentEditingMemberId = savedMember.id;
    }
    addAudit(wasEditingMember ? 'Member profile saved' : 'Member profile created', memberDisplayName(savedMember), 'Profile demographics, goals, providers, diagnoses, or allergies may have changed.');
    await sync();
    registerMemberTask(savedMember, !closeAfter);
    if (closeAfter) closeMemberModal();
    return true;
}

async function autosaveVisibleMemberBeforeSwitch(nextTaskId) {
    const modal = document.getElementById('member-modal');
    if (modal?.style.display !== 'flex' || !activeMemberTaskId || activeMemberTaskId === nextTaskId) return true;
    if (!currentEditingMemberId && !memberFormHasAnyInput()) return true;
    const saved = await saveMemberFromProfile({ closeAfter: false });
    if (saved && activeMemberTaskId) setWorkspaceTaskActive(activeMemberTaskId, false);
    return saved;
}

window.openMemberModal = async function(id = null) {
    const modal = document.getElementById('member-modal');
    const title = document.getElementById('member-modal-title');
    const requestedTaskId = memberTaskIdFor(id);
    if (!await autosaveVisibleMemberBeforeSwitch(requestedTaskId)) return;
    currentEditingMemberId = id;


    // Helper function to set value only if element exists
    const safeSet = (elId, value) => {
        const el = document.getElementById(elId);
        if (el) {
            el.value = value || '';
        } else {
            console.warn(`Missing HTML ID: ${elId}`);
        }
    };

    // 1. Clear all fields safely
    const fields = ['m-first', 'm-middle', 'm-last', 'm-age', 'm-dob', 'm-providers', 'm-diag', 'm-addr', 'm-phone', 'm-email', 'm-meds'];
    fields.forEach(f => safeSet(f, ''));
    setHiddenJson('m-prescriber-ids-data', []);
    setHiddenJson('m-diagnoses-data', []);
    setHiddenJson('m-allergies-data', []);
    const notifyEnabled = document.getElementById('m-notify-enabled');
    const emailReminders = document.getElementById('m-email-reminders');
    if (notifyEnabled) notifyEnabled.checked = true;
    if (emailReminders) emailReminders.checked = false;
    renderMemberCareLists();
    renderMemberMonitoringProfiles(null);

    const activeMedsContainer = document.getElementById('member-active-meds-list');
    if (activeMedsContainer) activeMedsContainer.innerHTML = '';
    const completedMedsContainer = document.getElementById('member-completed-meds-list');
    if (completedMedsContainer) completedMedsContainer.innerHTML = '';
    const prnMedsContainer = document.getElementById('member-prn-meds-list');
    if (prnMedsContainer) prnMedsContainer.innerHTML = '';
    safeSet('m-calendar-color', '#000080');
    setMemberGoalFields(null);

    if (id) {
        const m = db.family.find(member => member.id === id);
        if (m) {
            if (title) {
                title.innerHTML = `${memberTaskIconHtml(m)} <span>${escapeHtml(`${m.firstName} ${m.lastName}`)}</span>`;
            }
            // 2. Fill fields safely
            safeSet('m-first', m.firstName);
            safeSet('m-middle', m.middleName);
            safeSet('m-last', m.lastName);
            safeSet('m-sex', m.sex || 'Male');
            safeSet('m-age', m.age);
            safeSet('m-dob', m.dob);
            safeSet('m-providers', m.providers);
            safeSet('m-diag', '');
            safeSet('m-addr', m.address);
            safeSet('m-phone', m.phone);
            safeSet('m-email', m.email);
            safeSet('m-meds', m.prescribedMeds);
            safeSet('m-calendar-color', m.calendarColor || (m.sex === 'Female' ? '#8b1558' : '#000080'));
            const notifications = m.notificationPrefs || {};
            if (notifyEnabled) notifyEnabled.checked = notifications.medicationReminders !== false;
            if (emailReminders) emailReminders.checked = notifications.emailReminders === true;
            setHiddenJson('m-prescriber-ids-data', memberPrescriberIds(m));
            setHiddenJson('m-diagnoses-data', normalizeMemberDiagnoses(m));
            setHiddenJson('m-allergies-data', normalizeMemberAllergies(m));
            renderMemberCareLists();
            renderMemberMonitoringProfiles(m.id);
            setMemberGoalFields(m);

            // 3. Populate Active Meds
            if (activeMedsContainer) {
                const printControls = document.createElement('div');
                printControls.className = 'field-row member-active-toolbar';
                printControls.style.cssText = "justify-content:flex-end; margin-bottom:5px;";
                const startLabel = document.createElement('label');
                startLabel.innerText = 'From:';
                const startInput = document.createElement('input');
                startInput.type = 'date';
                startInput.value = localDateKey();
                const endLabel = document.createElement('label');
                endLabel.innerText = 'To:';
                const endInput = document.createElement('input');
                endInput.type = 'date';
                const defaultEnd = new Date();
                defaultEnd.setDate(defaultEnd.getDate() + 6);
                endInput.value = localDateKey(defaultEnd);
                const printButton = document.createElement('button');
                printButton.type = 'button';
                printButton.innerText = 'Print Labels for Date Range';
                printButton.addEventListener('click', event => {
                    event.stopPropagation();
                    window.printDateRangeLabels(m.id, startInput.value, endInput.value);
                });
                const schedulePdfButton = document.createElement('button');
                schedulePdfButton.type = 'button';
                schedulePdfButton.innerText = 'Schedule PDF';
                schedulePdfButton.addEventListener('click', event => {
                    event.stopPropagation();
                    window.generateMemberSchedulePdfReport(m.id, startInput.value, endInput.value);
                });
                const emailSchedulePdfButton = document.createElement('button');
                emailSchedulePdfButton.type = 'button';
                emailSchedulePdfButton.innerText = 'Email Schedule PDF';
                emailSchedulePdfButton.addEventListener('click', event => {
                    event.stopPropagation();
                    window.emailMemberSchedulePdfReport(m.id, startInput.value, endInput.value);
                });
                printControls.appendChild(startLabel);
                printControls.appendChild(startInput);
                printControls.appendChild(endLabel);
                printControls.appendChild(endInput);
                printControls.appendChild(printButton);
                printControls.appendChild(schedulePdfButton);
                printControls.appendChild(emailSchedulePdfButton);
                const timelineControls = document.createElement('div');
                timelineControls.className = 'timeline-controls';
                timelineControls.innerHTML = `
                    <button type="button" onclick="shiftMemberTimeline(-7)">Previous 7 Days</button>
                    <strong id="member-timeline-range"></strong>
                    <button type="button" onclick="shiftMemberTimeline(7)">Next 7 Days</button>`;
                printControls.appendChild(timelineControls);
                activeMedsContainer.appendChild(printControls);
            }
            const memberOrderSets = db.orderSets.filter(set =>
                set.memberId === id && set.status !== 'completed' && db.schedules.some(schedule => schedule.orderSetId === set.id && !isScheduleArchived(schedule))
            );
            memberOrderSets.forEach(set => {
                const div = document.createElement('details');
                div.className = 'sunken-panel member-regimen-card';
                div.open = true;
                const setSchedules = db.schedules.filter(candidate => candidate.orderSetId === set.id && !isScheduleArchived(candidate));
                const itemRows = setSchedules.map(schedule => {
                    if (schedule.freq === 'PRN') return '';
                    const med = db.inventory.find(inv => inv.id === schedule.medId);
                    return `<div style="font-size:11px; border-bottom:1px dotted #c0c0c0; padding-bottom:4px;">${med ? `${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))}` : 'Unknown'} | Dose: ${med ? escapeHtml(formatPrescribedDose(med, schedule.doseQty)) : 'Unknown'} | Qty: ${escapeHtml(formatQtyForSchedule(schedule, med || {}))} | ${escapeHtml(formatFrequency(schedule))} ${escapeHtml(getScheduleTimes(schedule).join(', ') || 'PRN')}${escapeHtml(prnLimitText(schedule))}${escapeHtml(scheduleExceptionText(schedule))}
                        ${linkedDetailsHtml(schedule, setSchedules)}
                        <div class="member-med-timeline" data-schedule-id="${schedule.id}"></div>
                        <div style="text-align:right; margin-top:3px;">
                            <button onclick="event.stopPropagation(); printSingleLabel('${schedule.id}')">Individual Labels</button>
                            ${med && usesContainerTracking(med) ? `<button onclick="event.stopPropagation(); finishTopicalContainer('${schedule.id}')">${escapeHtml(finishedContainerButtonText(med))}</button>` : ''}
                        </div>
                    </div>`;
                }).join('');
                div.innerHTML = `
                    <summary class="member-regimen-summary">
                        <span><strong>${escapeHtml(set.name)}</strong><br><small>${escapeHtml(set.startDate)} - ${escapeHtml(set.endDate)}</small></span>
                        <span class="form-help">${setSchedules.length} medication${setSchedules.length === 1 ? '' : 's'}</span>
                    </summary>
                    <div class="member-regimen-items">${itemRows}</div>
                    <div class="member-regimen-actions">
                        <button onclick="event.stopPropagation(); printOrderSetLabel('${set.id}')">Regimen Label</button>
                        <button onclick="event.stopPropagation(); printOrderSetMedicationLabel('${set.id}')">Individual Labels</button>
                        <button onclick="event.stopPropagation(); administerOrderSet('${set.id}')">Administer</button>
                        <button onclick="event.stopPropagation(); editOrderSet('${set.id}')">Edit Regimen</button>
                        <button onclick="event.stopPropagation(); deleteOrderSet('${set.id}')">Delete Regimen</button>
                    </div>
                `;
                if (activeMedsContainer) activeMedsContainer.appendChild(div);
            });

            const memberSchedules = db.schedules.filter(s => s.memberId === id && !s.orderSetId && s.freq !== 'PRN' && !isScheduleArchived(s));
            const memberActiveCandidates = db.schedules.filter(s => s.memberId === id && s.freq !== 'PRN' && !isScheduleArchived(s));
            memberSchedules.forEach(s => {
                const med = db.inventory.find(inv => inv.id === s.medId);
                const div = document.createElement('div');
                div.className = 'sunken-panel';
                div.style.cssText = "padding:5px; margin-bottom:5px; cursor:pointer; background:white; border:1px inset gray;";
                div.innerHTML = `
                    <strong>${med ? med.name : 'Unknown'} ${med ? formatMedStrength(med) : ''}</strong><br>
                    <small>Dose: ${med ? escapeHtml(formatPrescribedDose(med, s.doseQty)) : 'Unknown'} | Qty: ${med ? escapeHtml(formatQtyForSchedule(s, med)) : escapeHtml(s.doseQty)} | ${escapeHtml(formatFrequency(s))} ${escapeHtml(getScheduleTimes(s).join(', ') || 'PRN')}${escapeHtml(prnLimitText(s))}${escapeHtml(scheduleExceptionText(s))}</small>
                    ${linkedDetailsHtml(s, memberActiveCandidates)}
                    <div class="member-med-timeline" data-schedule-id="${s.id}"></div>
                    <div style="text-align:right; margin-top:5px;">
                        <button onclick="event.stopPropagation(); printSingleLabel('${s.id}')">Label</button>
                        <button onclick="event.stopPropagation(); administerDose('${s.medId}','${s.id}')">Administer</button>
                        ${med && usesContainerTracking(med) ? `<button onclick="event.stopPropagation(); finishTopicalContainer('${s.id}')">${escapeHtml(finishedContainerButtonText(med))}</button>` : ''}
                        <button onclick="event.stopPropagation(); deleteSchedule('${s.id}')">Discontinue</button>
                    </div>
                `;
                div.onclick = () => window.openOrderModifier(s.id);
                if (activeMedsContainer) activeMedsContainer.appendChild(div);
            });
            if (activeMedsContainer && activeMedsContainer.children.length <= 2) {
                const empty = document.createElement('div');
                empty.className = 'empty-state';
                empty.textContent = 'No active scheduled medications.';
                activeMedsContainer.appendChild(empty);
            }
            renderCompletedMedicationOrders(m.id);
            renderMemberPrnMedicationOrders(m.id);
            renderMemberVitalProfile(m.id);
            renderMemberAdherenceProfile(m.id);
            renderMemberMedicationReview(m.id);
            renderMemberAdministrationLog(m.id);
            renderMemberMedicationTimelines();
            renderMemberCalendar(m.id);
        }
    } else {
        if (title) title.innerHTML = `${memberTaskIconHtml(null)} <span>Add New Member</span>`;
        const profileVitals = document.getElementById('member-vitals-trends');
        if (profileVitals) profileVitals.innerHTML = '<div style="font-size:11px;">Save member before logging vitals.</div>';
        const adherence = document.getElementById('member-adherence-chart');
        if (adherence) adherence.innerHTML = '<div style="font-size:11px;">Save member before tracking adherence.</div>';
        const medReview = document.getElementById('member-med-review');
        if (medReview) medReview.innerHTML = '<div style="font-size:11px; padding:5px;">Save member before viewing medication/supplement summary.</div>';
        const adminLog = document.getElementById('member-admin-log');
        if (adminLog) adminLog.innerHTML = '<div style="font-size:11px; padding:5px;">Save member before recording administrations.</div>';
        const memberCalendar = document.getElementById('member-calendar-grid');
        if (memberCalendar) memberCalendar.innerHTML = '<div style="font-size:11px; padding:5px;">Save member before viewing their calendar.</div>';
        if (prnMedsContainer) prnMedsContainer.innerHTML = '<div style="font-size:11px; padding:5px;">Save member before adding PRN medications.</div>';
    }

    if (modal) {
        modal.style.display = 'flex';
        const taskMember = id ? db.family.find(member => member.id === id) : null;
        if (taskMember) registerMemberTask(taskMember);
        else registerWorkspaceTask(requestedTaskId, 'New Member Profile', () => openMemberModal(null), {
            type: 'patient',
            iconHtml: memberTaskIconHtml(null),
            color: '',
            sex: ''
        });
        activeMemberTaskId = requestedTaskId;
        enhanceButtonIcons(modal);
    }
};


window.openOrderModifier = function(scheduleId) {
    const sched = db.schedules.find(s => s.id === scheduleId);
    if (!sched) return alert("Schedule not found.");
    const med = db.inventory.find(m => m.id === sched.medId);

    document.getElementById('mod-sched-id').value = scheduleId;
    document.getElementById('mod-title').innerText = `Modify Order: ${med ? med.name : 'Unknown medication'}`;
    document.getElementById('mod-start').value = sched.startDate;
    document.getElementById('mod-end').value = sched.endDate === "Ongoing" ? '' : sched.endDate;
    document.getElementById('mod-dose-qty').value = sched.doseQty || '';
    const modPrescriber = document.getElementById('mod-prescriber');
    if (modPrescriber) modPrescriber.innerHTML = prescriberOptionsHtml(sched.prescriberId || med?.prescriberId || '', sched.memberId, false);
    document.getElementById('mod-freq').value = sched.freq || 'QD';
    document.getElementById('mod-qod-start-date').value = sched.qodStart || sched.startDate || '';
    document.getElementById('mod-interval-hours').value = sched.intervalHours || 8;
    document.getElementById('mod-interval-weeks').value = sched.intervalWeeks || 2;
    document.getElementById('mod-monthly-anchor').value = sched.monthlyAnchor || sched.startDate || '';
    document.getElementById('mod-times-per-week').value = sched.timesPerWeek || Math.max(sched.weekdays?.length || 0, 1);
    document.getElementById('mod-prn-max-doses').value = sched.prnMaxDoses || '';
    document.getElementById('mod-prn-window-hours').value = sched.prnWindowHours || 24;
    const modLinkTarget = document.getElementById('mod-link-target');
    if (modLinkTarget) {
        const choices = scheduleLinkChoicesForModifier(sched);
        const currentLinkedSchedules = linkedSchedulesFor(
            sched,
            db.schedules.filter(candidate => candidate.memberId === sched.memberId && candidate.id !== sched.id)
        );
        const selectedLinks = new Set(uniqueValues([
            ...(sched.linkTargetIds || []),
            sched.linkTargetId || '',
            ...scheduleLinkRules(sched).map(rule => rule.targetId),
            ...currentLinkedSchedules.map(linked => linked.id)
        ]));
        const selected = choices
            .filter(choice => selectedLinks.has(choice.id) || (sched.linkGroup && choice.group === sched.linkGroup && selectedLinks.size === 0))
            .map(choice => choice.id);
        modLinkTarget.dataset.memberId = sched.memberId;
        modLinkTarget.dataset.excludeId = sched.id;
        renderLinkChoicePanel(modLinkTarget, choices, selected, 'openModifierLinkPicker()');
    }
    const currentLinkedMode = linkedSchedulesFor(
        sched,
        db.schedules.filter(candidate => candidate.memberId === sched.memberId && candidate.id !== sched.id)
    )
        .map(linked => scheduleLinkModeBetween(sched, linked))
        .find(Boolean);
    document.getElementById('mod-link-mode').value = sched.linkMode || currentLinkedMode || '';
    renderFrequencyControls('mod', sched.freq === 'QXH' ? [sched.startTime || getScheduleTimes(sched)[0]] : getScheduleTimes(sched));
    setWeekdaySelections('mod-weekday-container', sched.weekdays || []);
    document.getElementById('mod-instr').value = sched.instructions || "";

    document.getElementById('order-modifier-modal').style.display = 'flex';
};

window.saveOrderModification = async function() {
    const id = document.getElementById('mod-sched-id').value;
    const sched = db.schedules.find(s => s.id === id);
    if (sched) {
        const previousStartDate = sched.startDate;
        const previousEndDate = sched.endDate;
        const previousIntervalTiming = JSON.stringify({
            freq: sched.freq,
            startDate: sched.startDate,
            endDate: sched.endDate,
            times: sched.times || [],
            intervalHours: sched.intervalHours,
            startTime: sched.startTime
        });
        const frequencyDetails = collectFrequencyDetails('mod');
        if (!frequencyDetails) return;

        const requestedStartDate = frequencyDetails.freq === 'QOD'
            ? (document.getElementById('mod-qod-start-date')?.value || document.getElementById('mod-start').value)
            : document.getElementById('mod-start').value;
        const today = localDateKey();
        const shouldApplyQxhForward = frequencyDetails.freq === 'QXH' &&
            previousStartDate &&
            previousStartDate < today &&
            (!previousEndDate || previousEndDate === 'Ongoing' || previousEndDate >= today) &&
            requestedStartDate <= today;
        sched.startDate = shouldApplyQxhForward ? today : requestedStartDate;
        sched.doseQty = document.getElementById('mod-dose-qty').value;
        sched.prescriberId = document.getElementById('mod-prescriber')?.value || '';
        sched.freq = frequencyDetails.freq;
        sched.endDate = frequencyDetails.freq === 'ONCE' ? sched.startDate : (document.getElementById('mod-end').value || "Ongoing");
        sched.times = frequencyDetails.times;
        sched.intervalHours = frequencyDetails.intervalHours;
        sched.intervalWeeks = frequencyDetails.intervalWeeks || null;
        sched.monthlyAnchor = frequencyDetails.monthlyAnchor || '';
        sched.timesPerWeek = frequencyDetails.timesPerWeek || null;
        sched.weekdays = frequencyDetails.weekdays || [];
        sched.prnMaxDoses = frequencyDetails.prnMaxDoses || null;
        sched.prnWindowHours = frequencyDetails.prnWindowHours || 24;
        sched.startTime = frequencyDetails.startTime || frequencyDetails.times[0] || "";
        const nextIntervalTiming = JSON.stringify({
            freq: sched.freq,
            startDate: sched.startDate,
            endDate: sched.endDate,
            times: sched.times || [],
            intervalHours: sched.intervalHours,
            startTime: sched.startTime
        });
        if (sched.freq !== 'QXH' || previousIntervalTiming !== nextIntervalTiming) {
            sched.rollingAnchorDate = '';
            sched.rollingAnchorTime = '';
        }
        if (sched.freq === 'QXH') recalculateIntervalAnchorFromHistory(sched);
        sched.instructions = document.getElementById('mod-instr').value;
        const linkTargetIds = selectedOptionValues(document.getElementById('mod-link-target'));
        const linkMode = document.getElementById('mod-link-mode')?.value || '';
        const targetChoice = scheduleLinkChoicesForModifier(sched).find(choice => choice.id === linkTargetIds[0]);
        if (linkTargetIds.length > 0 && !linkMode) {
            await appAlert('Choose what the medication link means: must take together or choose only one.');
            return;
        }
        sched.linkMode = linkMode;
        sched.linkTargetIds = linkMode ? linkTargetIds : [];
        sched.linkTargetId = linkMode ? (linkTargetIds[0] || '') : '';
        sched.linkRules = linkRulesFromTargets(linkTargetIds, linkMode);
        sched.linkGroup = linkMode && targetChoice ? linkGroupFromTarget(targetChoice.id) : '';
        if (linkMode && linkTargetIds.length === 0) {
            await appAlert('Select the medication this one is linked to.');
            return;
        }
        sched.qodStart = sched.freq === 'QOD' ? (document.getElementById('mod-qod-start-date').value || sched.startDate) : "";
        sched.isOneTime = sched.freq === 'ONCE' || (sched.startDate === sched.endDate && sched.endDate !== "Ongoing");
        sched.status = '';
        sched.completedAt = '';
        const linkedModificationCandidates = db.schedules.filter(candidate => candidate.memberId === sched.memberId);
        linkedSchedulesFor(sched, linkedModificationCandidates).forEach(linkedSchedule => {
            if (linkedSchedule.id !== sched.id) {
                applyLinkedScheduleTiming(sched, linkedSchedule);
            }
        });
        const med = db.inventory.find(item => item.id === sched.medId);
        const member = db.family.find(item => item.id === sched.memberId);
        addAudit('Medication modified', med?.name || 'Medication', `${member ? memberDisplayName(member) : 'Unknown member'} | ${formatFrequency(sched)} ${getScheduleTimes(sched).join(', ') || 'PRN'}`);
        await sync();
        document.getElementById('order-modifier-modal').style.display = 'none';
        openMemberModal(sched.memberId); // Refresh member profile
    }
};

window.saveMember = async function() {
    await saveMemberFromProfile({ closeAfter: true });
};

window.minimizeMemberModal = async function() {
    const modal = document.getElementById('member-modal');
    if (!modal) return;
    if (!currentEditingMemberId && !memberFormHasAnyInput()) {
        modal.style.display = 'none';
        if (activeMemberTaskId) removeWorkspaceTask(activeMemberTaskId);
        return;
    }
    if (currentEditingMemberId || memberFormHasAnyInput()) {
        const saved = await saveMemberFromProfile({ closeAfter: false });
        if (!saved) return;
    }
    modal.style.display = 'none';
    if (activeMemberTaskId) setWorkspaceTaskActive(activeMemberTaskId, false);
};

window.closeMemberModal = () => {
    document.getElementById('member-modal').style.display = 'none';
    if (activeMemberTaskId) removeWorkspaceTask(activeMemberTaskId);
};

// --- INVENTORY ---
window.addInventory = async function() {
    const name = document.getElementById('med-name').value.trim();
    const strengthAmount = parseAmount(document.getElementById('med-strength').value, NaN);
    const selectedUnit = document.getElementById('med-units').value;
    const selectedUnitParts = selectedUnit.split('/');
    const activeUnit = selectedUnitParts[0] || selectedUnit;
    const selectedPerUnit = selectedUnitParts[1] || '';
    const perAmount = parseAmount(document.getElementById('med-per-amount')?.value, 1);
    const perUnit = document.getElementById('med-per-unit')?.value || selectedPerUnit;
    const qty = parseAmount(document.getElementById('med-qty').value, NaN);
    const formulation = document.getElementById('med-formulation').value;
    const prescriberId = document.getElementById('med-prescriber')?.value || '';
    const inventoryBehavior = dosageFormUsesContainerTracking(formulation)
        ? 'container-finish'
        : (document.getElementById('med-inventory-behavior')?.value || defaultInventoryBehaviorForFormulation(formulation));
    const inventoryUnit = document.getElementById('med-inventory-unit')?.value.trim()
        || defaultInventoryUnitForFormulation(formulation, inventoryBehavior);
    const administrationUnit = document.getElementById('med-administration-unit')?.value.trim()
        || defaultAdministrationUnitForFormulation(formulation);
    const imageInput = document.getElementById('med-image-input');
    const expiry = document.getElementById('med-expiry').value;
    const barcodeCode = normalizeMedicationCode(document.getElementById('med-barcode-code')?.value) || createMedicationCode();
    const inventoryAssignedMemberIds = collectMedicationAssignment('med');
    if (!name || isNaN(qty)) return alert("Name and Qty required.");
    if (document.getElementById('med-assignment-mode')?.value === 'selected' && inventoryAssignedMemberIds.length === 0) {
        return alert("Select at least one member or change assignment to all members.");
    }
    if (barcodeCode.length > 100) {
        return alert("Enter a QR code containing no more than 100 characters.");
    }
    if (await warnBarcodeConflict(barcodeCode)) {
        return;
    }

    // --- NEW COMBINATION LOGIC ---
    const isCombo = document.getElementById('is-combination').checked;
    let components = [];
    let finalStrength = strengthAmount;
    let finalUnits = activeUnit;
    let displayStrength = '';

    if (isCombo) {
        const combo = collectCombinationComponents('med');
        components = combo.components;
        const invalidComponentDenominator = combo.invalidDenominator;
        if (invalidComponentDenominator) return alert("Each ingredient with a per-unit needs a volume or quantity greater than 0.");
        if (components.length === 0) return alert("Add at least one valid active ingredient.");
        const combinationMed = { isCombination: true, components, units: activeUnit };
        finalStrength = formatCombinationStrength(combinationMed);
        finalUnits = formatInventoryUnits(combinationMed);
        displayStrength = finalStrength;
    } else if (!Number.isFinite(strengthAmount) || strengthAmount <= 0) {
        return alert("Strength required.");
    } else if (perUnit && Number.isFinite(perAmount) && perAmount > 0) {
        finalStrength = strengthAmount / perAmount;
        finalUnits = `${activeUnit}/${perUnit}`;
        displayStrength = perAmount === 1
            ? `${formatAmount(strengthAmount)}${activeUnit}/${perUnit}`
            : `${formatAmount(strengthAmount)}${activeUnit}/${formatAmount(perAmount)}${perUnit}`;
    } else {
        displayStrength = `${formatAmount(strengthAmount)}${activeUnit}`;
    }

    let imagePath = null;
    if (pendingNewMedImage) {
        try {
            imagePath = await savePendingMedicationImage(pendingNewMedImage);
        } catch (e) { console.error(e); }
    } else if (imageInput.files[0]) {
        try {
            const base64 = await toBase64(imageInput.files[0]);
            const fileName = `img_${Date.now()}_${imageInput.files[0].name.replace(/\s/g, '_')}`;
            imagePath = await window.api.saveImage(fileName, base64);
        } catch (e) { console.error(e); }
    }

    const newMed = {
        id: Date.now().toString(),
        name,
        strength: finalStrength,
        units: finalUnits,
        displayStrength,
        strengthAmount: isCombo ? null : strengthAmount,
        activeUnit: isCombo ? null : activeUnit,
        perAmount: isCombo ? null : (perUnit ? perAmount : null),
        perUnit: isCombo ? null : perUnit,
        formulation, // 'Tablets', 'mL', 'Capsules', etc.
        inventoryUnit,
        administrationUnit,
        inventoryBehavior,
        stock: qty,
        maxCapacity: qty,
        expiry: expiry,
        isLiquid: finalUnits.includes('/') || document.getElementById('med-formulation').value === 'mL',
        isCombination: isCombo,
        components: components, // Only for combinations
        minThreshold: parseAmount(document.getElementById('med-threshold').value, 5),
        prescriberId,
        assignedMemberIds: inventoryAssignedMemberIds,
        barcodeCode,
        barcodeCodes: [barcodeCode],
        imagePath: imagePath
    };
    db.inventory.push(newMed);
    addAudit('Inventory item added', newMed.name, `${formatAmount(qty)} ${inventoryUnit} on hand.`);
    document.getElementById('med-name').value = '';
    document.getElementById('med-strength').value = '';
    document.getElementById('med-per-amount').value = '1';
    document.getElementById('med-per-unit').value = '';
    document.getElementById('med-qty').value = '';
    document.getElementById('med-inventory-unit').value = '';
    document.getElementById('med-administration-unit').value = '';
    document.getElementById('med-barcode-code').value = '';
    document.getElementById('ingredient-list').innerHTML = '';
    document.getElementById('is-combination').checked = false;
    const sharedCombo = document.getElementById('combo-use-shared-per');
    const sharedComboAmount = document.getElementById('combo-shared-per-amount');
    if (sharedCombo) sharedCombo.checked = true;
    if (sharedComboAmount) sharedComboAmount.value = '1';
    const medPrescriber = document.getElementById('med-prescriber');
    if (medPrescriber) medPrescriber.value = '';
    const assignmentMode = document.getElementById('med-assignment-mode');
    if (assignmentMode) assignmentMode.value = 'all';
    renderMedicationAssignmentControls('med', []);
    const behaviorInput = document.getElementById('med-inventory-behavior');
    if (behaviorInput) behaviorInput.dataset.formulation = '';
    updateInventoryEntryMode();
    imageInput.value = '';
    pendingNewMedImage = null;
    updateImageDropzone('med-image-dropzone', null);
    await sync();
};

window.takeDose = async function(medId) {
    const med = db.inventory.find(m => m.id === medId);
    if (!med) return;
    if (db.family.length === 0) {
        await appAlert("Add a member before recording a manual dose.");
        return;
    }

    const formulation = med.formulation || 'unit(s)';
    const administrationUnit = med.administrationUnit || formulation;
    const result = await requestActualAdministration(`Take: ${med.name}`, `
        <div class="field-row" style="margin-top:8px;">
            <label>Member:</label>
            <select name="memberId" style="width:220px;">${memberOptionsHtml(currentEditingMemberId || '')}</select>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Amount taken (${escapeHtml(administrationUnit)}):</label>
            <input name="amountTaken" type="number" min="0" step="any" value="1">
        </div>
        ${kitSourceSelectHtml(med.id)}
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Note / reason given:</label>
            <textarea name="adminNote" rows="2" style="width:100%; resize:none;"></textarea>
        </div>
    `, 'Record Dose');
    if (!result) return;
    const member = db.family.find(m => m.id === result.memberId);
    if (!member) {
        await appAlert("Select the member who took this dose.");
        return;
    }
    const amountTaken = parseAmount(result.amountTaken, NaN);
    if (isNaN(amountTaken) || amountTaken <= 0) {
        await appAlert("Enter an amount taken greater than 0.");
        return;
    }
    let stockSourceLabel = 'Main inventory';
    if (!usesContainerTracking(med)) {
        if (result.inventorySource && result.inventorySource !== 'main') {
            const kitResult = consumeFromKitSource(result.inventorySource, med, amountTaken);
            if (kitResult.error) {
                await appAlert(kitResult.error);
                return;
            }
            stockSourceLabel = kitResult.sourceLabel;
        } else {
            if (parseAmount(med.stock) < amountTaken) {
                await appAlert("Insufficient stock.");
                return;
            }
            med.stock = parseAmount(med.stock) - amountTaken;
        }
    }
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: formatActualTimestamp(result),
        memberId: member.id,
        memberName: memberDisplayName(member),
        medId: med.id,
        medName: med.name,
        details: `Manual/supplemental ${isTopicalMedication(med) ? 'application' : 'dose'} - ${formatAmount(amountTaken)} ${med.administrationUnit || formulation}; Source: ${stockSourceLabel}${usesContainerTracking(med) ? `; ${inventoryUnitFor(med)} inventory unchanged until a container is marked finished` : ''}${result.adminNote ? ` | Note: ${result.adminNote}` : ''}`
    });
    addAudit('Manual dose documented', med.name, `${memberDisplayName(member)} | ${formatAmount(amountTaken)} ${med.administrationUnit || formulation}`);
    await sync();
};

window.restockMed = async function(medId) {
    const med = db.inventory.find(m => m.id === medId);
    if (med) {
        const result = await showActionModal(`Restock: ${med.name}`, `
            <div class="field-row-stacked">
                <label>Amount received (${escapeHtml(inventoryUnitFor(med))}):</label>
                <input name="amount" type="number" min="0" step="0.1" value="30">
            </div>
        `, 'Restock');
        if (!result) return;
        const receivedAmount = parseAmount(result.amount, NaN);
        if (isNaN(receivedAmount) || receivedAmount <= 0) {
            await appAlert("Enter a restock amount greater than 0.");
            return;
        }

        med.stock = parseAmount(med.stock) + receivedAmount;
        if (parseAmount(med.stock) > parseAmount(med.maxCapacity)) med.maxCapacity = med.stock;
        db.history.unshift({ id: Date.now().toString(), timestamp: new Date().toLocaleString(), medName: med.name, details: `Restocked +${formatAmount(receivedAmount)}` });
        addAudit('Inventory restocked', med.name, `+${formatAmount(receivedAmount)} ${inventoryUnitFor(med)}.`);
        await sync();
        await appAlert(`${med.name} restocked. New quantity on hand: ${formatAmount(parseAmount(med.stock))}`);
    }
};
window.refillMed = window.restockMed;

function medKitInventoryOptionsHtml() {
    return sortByName(db.inventory, inventoryDisplayName).map(med =>
        `<option value="${escapeHtml(med.id)}">${escapeHtml(inventoryDisplayName(med))} - ${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))} on hand</option>`
    ).join('');
}

function medKitInventoryDatalistHtml() {
    return sortByName(db.inventory, inventoryDisplayName).map(med =>
        `<option value="${escapeHtml(inventoryDisplayName(med))}" data-id="${escapeHtml(med.id)}">${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))} on hand</option>`
    ).join('');
}

function selectedMedKitInventoryMedication() {
    const search = document.getElementById('med-kit-add-med-search');
    const hidden = document.getElementById('med-kit-add-med-id');
    const medId = hidden?.value || '';
    const byId = medId ? db.inventory.find(med => med.id === medId) : null;
    if (byId) return byId;
    const query = String(search?.value || '').trim().toLowerCase();
    return db.inventory.find(med => inventoryDisplayName(med).toLowerCase() === query)
        || db.inventory.find(med => inventorySearchText(med).includes(query))
        || null;
}

function setMedKitMessage(message, tone = '') {
    const target = document.getElementById('med-kit-message');
    if (!target) return;
    target.className = `med-kit-message ${tone}`;
    target.textContent = message || '';
}

function renderMedKitsWorkspace() {
    ensureMedKits();
    const target = document.getElementById('med-kit-workspace');
    if (!target) return;
    if (!activeMedKitId && db.medKits.length) activeMedKitId = db.medKits[0].id;
    const activeKit = db.medKits.find(kit => kit.id === activeMedKitId) || null;
    const kitButtons = db.medKits.map(kit => {
        const expiring = medKitHasExpiringSoon(kit);
        return `<button type="button" class="med-kit-tab ${kit.id === activeMedKitId ? 'active' : ''} ${expiring ? 'expiring' : ''}" onclick="selectMedKit('${escapeHtml(kit.id)}')">
            <span class="win98-icon icon-box"></span>${escapeHtml(medKitName(kit))}
        </button>`;
    }).join('');
    const itemRows = activeKit
        ? (activeKit.items || []).map(item => {
            const med = kitItemMed(item);
            const expiring = isExpiringWithinDays(item.expiry, 10);
            const unit = med ? inventoryUnitFor(med) : item.unit || 'unit';
            return `<tr class="${expiring ? 'kit-expiring-row' : ''}">
                <td class="${expiring ? 'kit-expiring-text' : ''}">${escapeHtml(med ? inventoryDisplayName(med) : item.name || 'Unknown item')}</td>
                <td>${escapeHtml(formatAmount(parseAmount(item.qty)))} ${escapeHtml(unit)}</td>
                <td class="${expiring ? 'kit-expiring-text' : ''}">${escapeHtml(item.expiry || med?.expiry || 'N/A')}</td>
                <td class="med-kit-action-cell">
                    <div class="med-kit-row-actions">
                        <button type="button" onclick="restockMedKitItem('${escapeHtml(activeKit.id)}','${escapeHtml(item.id)}')">Restock</button>
                        <button type="button" onclick="adjustMedKitItemQuantity('${escapeHtml(activeKit.id)}','${escapeHtml(item.id)}')">Adjust Quantity</button>
                        <button type="button" onclick="returnOrDiscardMedKitItem('${escapeHtml(activeKit.id)}','${escapeHtml(item.id)}')">Return/Discard</button>
                    </div>
                </td>
            </tr>`;
        }).join('')
        : '';
    target.innerHTML = `
        <div class="med-kit-shell">
            <aside class="med-kit-left">
                <div class="med-kit-toolbar"><button type="button" onclick="createMedKit()">+ New Kit</button></div>
                <div class="med-kit-tabs">${kitButtons || '<div class="empty-state">No kits yet.</div>'}</div>
            </aside>
            <section class="med-kit-right">
                ${activeKit ? `
                    <div class="med-kit-header">
                        <div class="field-row">
                            <label>Kit name:</label>
                            <input id="med-kit-name-input" type="text" value="${escapeHtml(medKitName(activeKit))}" style="width:260px;">
                            <button type="button" onclick="saveMedKitName('${escapeHtml(activeKit.id)}')">Save Name</button>
                            <button type="button" onclick="deleteMedKit('${escapeHtml(activeKit.id)}')">Delete Kit</button>
                        </div>
                    </div>
                    <fieldset>
                        <legend>Add From Inventory</legend>
                        <div class="med-kit-add-row">
                            <input id="med-kit-add-med-search" type="search" list="med-kit-inventory-options" placeholder="Search inventory medication..." oninput="updateMedKitSelectedMed()" onchange="updateMedKitSelectedMed()">
                            <input id="med-kit-add-med-id" type="hidden">
                            <datalist id="med-kit-inventory-options">${medKitInventoryDatalistHtml()}</datalist>
                            <input id="med-kit-add-qty" type="number" min="0" step="any" placeholder="Quantity" title="Quantity to move into this kit">
                            <input id="med-kit-add-expiry" type="date" title="Kit item expiration date">
                            <button type="button" onclick="addMedKitItem('${escapeHtml(activeKit.id)}')">Add to Kit</button>
                        </div>
                    </fieldset>
                    <div id="med-kit-message" class="med-kit-message"></div>
                    <div class="sunken-panel med-kit-table-wrap">
                        <table class="interactive med-kit-table">
                            <thead><tr><th>Medication</th><th>Kit Qty</th><th>Expiry</th><th>Actions</th></tr></thead>
                            <tbody>${itemRows || '<tr><td colspan="4">No medications in this kit.</td></tr>'}</tbody>
                        </table>
                    </div>
                    <div class="form-help">Adding or restocking into a kit subtracts that quantity from main inventory. Adjust Quantity corrects the kit count only. Return/Discard removes the item from the kit and lets you choose whether it goes back to main inventory.</div>
                ` : '<div class="empty-state">Create a med kit to begin.</div>'}
            </section>
        </div>`;
    enhanceButtonIcons(target);
}

window.openMedKits = async function() {
    ensureMedKits();
    if (!activeMedKitId && db.medKits.length) activeMedKitId = db.medKits[0].id;
    const promise = showActionModal('Med Kits', `
        <div data-action-modal-size="wide" id="med-kit-workspace"></div>
    `, 'Close');
    renderMedKitsWorkspace();
    await promise;
};

window.selectMedKit = function(kitId) {
    activeMedKitId = kitId;
    renderMedKitsWorkspace();
};

window.updateMedKitSelectedMed = function() {
    const search = document.getElementById('med-kit-add-med-search');
    const hidden = document.getElementById('med-kit-add-med-id');
    const expiry = document.getElementById('med-kit-add-expiry');
    if (!search || !hidden) return;
    const value = search.value.trim().toLowerCase();
    const med = db.inventory.find(item => inventoryDisplayName(item).toLowerCase() === value)
        || db.inventory.find(item => inventorySearchText(item).includes(value));
    hidden.value = med?.id || '';
    if (expiry && med?.expiry) expiry.value = med.expiry;
};

window.createMedKit = async function() {
    ensureMedKits();
    const kit = {
        id: `kit_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: `Med Kit ${db.medKits.length + 1}`,
        items: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    db.medKits.push(kit);
    activeMedKitId = kit.id;
    await sync();
    renderMedKitsWorkspace();
};

window.saveMedKitName = async function(kitId) {
    const kit = db.medKits.find(candidate => candidate.id === kitId);
    const input = document.getElementById('med-kit-name-input');
    if (!kit || !input) return;
    const name = input.value.trim();
    if (!name) {
        setMedKitMessage('Enter a kit name before saving.', 'error');
        return;
    }
    kit.name = name;
    kit.updatedAt = new Date().toISOString();
    await sync();
    renderMedKitsWorkspace();
    setMedKitMessage('Kit name saved.', 'ok');
};

window.addMedKitItem = async function(kitId) {
    const kit = db.medKits.find(candidate => candidate.id === kitId);
    const med = selectedMedKitInventoryMedication();
    const qty = parseAmount(document.getElementById('med-kit-add-qty')?.value, NaN);
    const expiryInput = document.getElementById('med-kit-add-expiry')?.value || '';
    if (!kit) return;
    if (!med) {
        setMedKitMessage('Search for and select an inventory medication before adding it to the kit.', 'error');
        return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
        setMedKitMessage('Enter a quantity greater than 0.', 'error');
        return;
    }
    if (parseAmount(med.stock, 0) < qty) {
        setMedKitMessage(`Insufficient main inventory. ${med.name} has ${formatAmount(parseAmount(med.stock))} ${inventoryUnitFor(med)}.`, 'error');
        return;
    }
    const expiry = expiryInput || med.expiry || '';
    med.stock = parseAmount(med.stock, 0) - qty;
    kit.items = kit.items || [];
    const existing = kit.items.find(item => item.medId === med.id && (item.expiry || '') === expiry);
    if (existing) {
        existing.qty = parseAmount(existing.qty, 0) + qty;
    } else {
        kit.items.push({
            id: medKitItemId(),
            medId: med.id,
            name: inventoryDisplayName(med),
            qty,
            unit: inventoryUnitFor(med),
            expiry,
            addedAt: new Date().toISOString()
        });
    }
    kit.updatedAt = new Date().toISOString();
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medName: med.name,
        details: `Moved ${formatAmount(qty)} ${inventoryUnitFor(med)} from main inventory to ${medKitName(kit)}.`
    });
    await sync();
    renderMedKitsWorkspace();
    setMedKitMessage(`${med.name} added to ${medKitName(kit)}.`, 'ok');
};

window.restockMedKitItem = async function(kitId, itemId) {
    const kit = db.medKits.find(candidate => candidate.id === kitId);
    const item = kit?.items?.find(candidate => candidate.id === itemId);
    if (!kit || !item) return;
    const med = kitItemMed(item);
    const unit = med ? inventoryUnitFor(med) : item.unit || 'unit';
    if (!med) {
        setMedKitMessage('This kit item is not linked to an inventory medication anymore.', 'error');
        return;
    }
    const result = await showChildActionModal('Restock Med Kit Item', `
        <div style="font-size:11px; margin-bottom:8px;">
            Add more <strong>${escapeHtml(inventoryDisplayName(med))}</strong> to <strong>${escapeHtml(medKitName(kit))}</strong>.
        </div>
        <div class="field-row">
            <label>Amount to add:</label>
            <input name="qty" type="number" min="0" step="any" placeholder="Quantity" style="width:120px;">
            <span>${escapeHtml(unit)}</span>
        </div>
        <div class="form-help">This subtracts the amount from main inventory.</div>
    `, 'Restock');
    if (!result) return;
    const qty = parseAmount(result.qty, NaN);
    if (!Number.isFinite(qty) || qty <= 0) {
        setMedKitMessage('Enter a quantity greater than 0.', 'error');
        return;
    }
    if (parseAmount(med.stock, 0) < qty) {
        setMedKitMessage(`Insufficient main inventory. ${med.name} has ${formatAmount(parseAmount(med.stock))} ${unit}.`, 'error');
        return;
    }
    med.stock = parseAmount(med.stock, 0) - qty;
    item.qty = parseAmount(item.qty, 0) + qty;
    item.unit = unit;
    kit.updatedAt = new Date().toISOString();
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medName: med.name,
        details: `Restocked ${formatAmount(qty)} ${unit} into ${medKitName(kit)} from main inventory.`
    });
    await sync();
    renderMedKitsWorkspace();
    setMedKitMessage(`${med.name} kit quantity increased by ${formatAmount(qty)} ${unit}.`, 'ok');
};

window.adjustMedKitItemQuantity = async function(kitId, itemId) {
    const kit = db.medKits.find(candidate => candidate.id === kitId);
    const item = kit?.items?.find(candidate => candidate.id === itemId);
    if (!kit || !item) return;
    const med = kitItemMed(item);
    const unit = med ? inventoryUnitFor(med) : item.unit || 'unit';
    const currentQty = parseAmount(item.qty, 0);
    const result = await showChildActionModal('Adjust Med Kit Quantity', `
        <div style="font-size:11px; margin-bottom:8px;">
            Correct the kit count for <strong>${escapeHtml(med ? inventoryDisplayName(med) : item.name || 'this item')}</strong>.
        </div>
        <div class="field-row">
            <label>Exact kit quantity:</label>
            <input name="qty" type="number" min="0" step="any" value="${escapeHtml(String(currentQty))}" style="width:120px;">
            <span>${escapeHtml(unit)}</span>
        </div>
        <div class="form-help">This fixes the kit count only and does not move anything in or out of main inventory.</div>
    `, 'Adjust Quantity');
    if (!result) return;
    const qty = parseAmount(result.qty, NaN);
    if (!Number.isFinite(qty) || qty < 0) {
        setMedKitMessage('Enter a valid quantity of 0 or greater.', 'error');
        return;
    }
    if (qty === 0) {
        removeKitItemFromKit(kit, item);
    } else {
        item.qty = qty;
        item.unit = unit;
        kit.updatedAt = new Date().toISOString();
    }
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medName: med?.name || item.name || 'Medication',
        details: `Adjusted ${medKitName(kit)} kit count from ${formatAmount(currentQty)} ${unit} to ${formatAmount(qty)} ${unit}. Main inventory unchanged.`
    });
    await sync();
    renderMedKitsWorkspace();
    setMedKitMessage('Kit quantity adjusted.', 'ok');
};

window.returnOrDiscardMedKitItem = async function(kitId, itemId) {
    const kit = db.medKits.find(candidate => candidate.id === kitId);
    const item = kit?.items?.find(candidate => candidate.id === itemId);
    if (!kit || !item) return;
    const med = kitItemMed(item);
    const qty = parseAmount(item.qty, 0);
    const unit = med ? inventoryUnitFor(med) : item.unit || 'unit';
    const result = await showChildActionModal('Return/Discard Kit Item', `
        <div style="font-size:11px; margin-bottom:8px;">
            Remove <strong>${escapeHtml(formatAmount(qty))} ${escapeHtml(unit)}</strong> of
            <strong>${escapeHtml(med ? inventoryDisplayName(med) : item.name || 'this item')}</strong>
            from <strong>${escapeHtml(medKitName(kit))}</strong>.
        </div>
        <label class="choice-row">
            <input type="radio" name="handling" value="return" ${med ? 'checked' : 'disabled'}>
            Return to main inventory
        </label>
        <label class="choice-row">
            <input type="radio" name="handling" value="discard" ${med ? '' : 'checked'}>
            Discard / remove without returning to inventory
        </label>
        ${med ? '' : '<div class="form-help error-text">This kit item is no longer linked to inventory, so it can only be discarded from the kit.</div>'}
    `, 'Continue');
    if (!result) return;
    if (result.handling === 'return') {
        if (!returnKitItemToInventory(kit, item)) {
            setMedKitMessage('This kit item is not linked to an inventory medication anymore.', 'error');
            return;
        }
    } else {
        removeKitItemFromKit(kit, item);
    }
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medName: med?.name || item.name || 'Medication',
        details: `${result.handling === 'return' ? 'Returned' : 'Discarded'} ${formatAmount(qty)} ${unit} from ${medKitName(kit)}${result.handling === 'return' ? ' to main inventory' : ''}.`
    });
    await sync();
    renderMedKitsWorkspace();
    setMedKitMessage(result.handling === 'return' ? 'Item returned to main inventory.' : 'Item discarded from med kit.', 'ok');
};

window.returnMedKitItem = async function(kitId, itemId) {
    const kit = db.medKits.find(candidate => candidate.id === kitId);
    const item = kit?.items?.find(candidate => candidate.id === itemId);
    if (!kit || !item) return;
    const med = kitItemMed(item);
    const qty = parseAmount(item.qty, 0);
    if (!returnKitItemToInventory(kit, item)) {
        setMedKitMessage('This kit item is not linked to an inventory medication anymore.', 'error');
        return;
    }
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medName: med?.name || item.name || 'Medication',
        details: `Returned ${formatAmount(qty)} ${med ? inventoryUnitFor(med) : item.unit || 'unit'} from ${medKitName(kit)} to main inventory.`
    });
    await sync();
    renderMedKitsWorkspace();
    setMedKitMessage('Item returned to main inventory.', 'ok');
};

window.deleteMedKit = async function(kitId) {
    const kit = db.medKits.find(candidate => candidate.id === kitId);
    if (!kit) return;
    (kit.items || []).slice().forEach(item => returnKitItemToInventory(kit, item));
    db.medKits = db.medKits.filter(candidate => candidate.id !== kitId);
    activeMedKitId = db.medKits[0]?.id || null;
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medName: medKitName(kit),
        details: 'Deleted med kit and returned contents to main inventory.'
    });
    await sync();
    renderMedKitsWorkspace();
};

window.deleteMed = async function(id) {
    const scheduleCount = db.schedules.filter(s => s.medId === id).length;
    const message = scheduleCount > 0
        ? `Delete this medication and ${scheduleCount} related schedule(s)?`
        : "Delete this medication?";
    if(await appConfirm(message, 'Delete Medication')) {
        db.inventory = db.inventory.filter(m => m.id !== id);
        db.schedules = db.schedules.filter(s => s.medId !== id);
        await sync();
    }
};

function addSelectOptionIfMissing(select, value) {
    if (!select || !value || Array.from(select.options).some(option => option.value === value)) return;
    select.add(new Option(value, value));
}

window.addModalIngredientRow = function(component = null) {
    const container = document.getElementById('modal-ingredient-list');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'modal-combo-row combo-row';
    const selectedUnit = component?.unit || 'mg';
    const unitOptions = componentUnitOptions
        .map(unit => `<option value="${unit}" ${unit === selectedUnit ? 'selected' : ''}>${unit}</option>`)
        .join('');
    const selectedPerUnit = component?.perUnit || defaultPerUnitForFormulation(document.getElementById('modal-formulation')?.value || 'Other');
    row.innerHTML = `
        <label>Ingredient<input class="modal-ing-name" type="text" placeholder="Ingredient" value="${escapeHtml(component?.name || '')}" oninput="updateCombinationPreview('modal')"></label>
        <label>Amount<input class="modal-ing-strength" type="number" min="0" step="any" placeholder="Strength" value="${escapeHtml(component?.strengthAmount ?? component?.strength ?? '')}" oninput="updateCombinationPreview('modal')"></label>
        <label>Unit<select class="modal-ing-unit" onchange="updateCombinationPreview('modal')">${unitOptions}</select></label>
        <div class="component-per-controls">
            <label>per amount<input class="modal-ing-per-amount" type="number" min="0.001" step="any" value="${escapeHtml(component?.perAmount ?? '1')}" oninput="updateCombinationPreview('modal')"></label>
            <label>per unit<select class="modal-ing-per-unit" onchange="updateCombinationPreview('modal')">${componentPerUnitOptionsHtml(selectedPerUnit)}</select></label>
        </div>
        <button type="button" class="combo-row-remove modal-ing-remove">Remove</button>`;
    row.querySelector('.modal-ing-remove').onclick = () => {
        row.remove();
        updateCombinationPreview('modal');
    };
    container.appendChild(row);
    updateCombinationPreview('modal');
};

window.updateMedProfileMode = function() {
    const formulationSelect = document.getElementById('modal-formulation');
    const formulation = formulationSelect?.value || '';
    const isCombo = document.getElementById('modal-is-combination')?.checked;
    const isContainerDefault = dosageFormUsesContainerTracking(formulation);
    const behavior = document.getElementById('modal-inventory-behavior');
    const inventoryUnit = document.getElementById('modal-inventory-unit');
    const administrationUnit = document.getElementById('modal-administration-unit');
    const guidance = document.getElementById('modal-inventory-guidance');
    const formulationChanged = behavior?.dataset.formulation !== formulation;

    document.getElementById('modal-single-strength-fields').style.display = isCombo ? 'none' : 'flex';
    document.getElementById('modal-combination-fields').style.display = isCombo ? 'block' : 'none';
    if (isCombo && document.getElementById('modal-ingredient-list').children.length === 0) addModalIngredientRow();

    if (formulationChanged) {
        if (administrationUnit) administrationUnit.value = defaultAdministrationUnitForFormulation(formulation);
        if (behavior) behavior.value = defaultInventoryBehaviorForFormulation(formulation);
        if (inventoryUnit) inventoryUnit.value = defaultInventoryUnitForFormulation(formulation, behavior?.value);
        if (behavior) behavior.dataset.formulation = formulation;
        const sharedUnit = document.getElementById('modal-combo-shared-per-unit');
        const sharedAmount = document.getElementById('modal-combo-shared-per-amount');
        const defaultPerUnit = defaultPerUnitForFormulation(formulation);
        if (sharedUnit && defaultPerUnit) sharedUnit.value = defaultPerUnit;
        if (sharedAmount && !sharedAmount.value) sharedAmount.value = '1';
        if (isConcentrationFormulation(formulation)) {
            document.querySelectorAll('#modal-ingredient-list .modal-ing-per-unit').forEach(select => {
                if (!select.value) select.value = defaultPerUnitForFormulation(formulation);
            });
        }
    }
    if (isContainerDefault && behavior) behavior.value = 'container-finish';
    if (behavior) behavior.disabled = isContainerDefault;
    const behaviorChanged = behavior?.dataset.behavior !== behavior?.value;
    if (!formulationChanged && behaviorChanged && inventoryUnit) {
        inventoryUnit.value = defaultInventoryUnitForFormulation(formulation, behavior.value);
    }
    if (behavior) behavior.dataset.behavior = behavior.value;
    if (guidance) {
        guidance.innerText = behavior?.value === 'container-finish'
            ? 'Administrations are logged without reducing stock. Mark the container finished when it is empty.'
            : `Each administered ${administrationUnit?.value || 'dose unit'} reduces stock by the quantity given.`;
    }
    updateCombinationPreview('modal');
};

window.openMedProfile = function(id) {
    currentEditingMedId = id;
    pendingModalMedImage = null;
    updateImageDropzone('modal-image-dropzone', null);
    const med = db.inventory.find(m => m.id === id);
    if (!med) return alert("Medication not found.");
    document.getElementById('modal-med-name').value = med.name;
    document.getElementById('modal-expiry').value = med.expiry;
    document.getElementById('modal-title').innerText = `${med.name} Profile`;
    document.getElementById('modal-stock').value = med.stock;
    document.getElementById('modal-notes').value = med.notes || "";
    document.getElementById('modal-storage').value = med.storage || "";
    document.getElementById('modal-control-level').value = med.controlLevel || "N/A";
    modalBarcodeCodes = medicationCodes(med);
    if (modalBarcodeCodes.length === 0) modalBarcodeCodes = [createMedicationCode()];
    document.getElementById('modal-barcode-code').value = '';
    renderModalBarcodeCodes();
    const formulationSelect = document.getElementById('modal-formulation');
    addSelectOptionIfMissing(formulationSelect, med.formulation || 'Other');
    formulationSelect.value = med.formulation || 'Other';
    const behaviorSelect = document.getElementById('modal-inventory-behavior');
    behaviorSelect.dataset.formulation = med.formulation || 'Other';
    behaviorSelect.value = med.inventoryBehavior || defaultInventoryBehaviorForFormulation(med.formulation || 'Other');
    behaviorSelect.dataset.behavior = behaviorSelect.value;
    document.getElementById('modal-is-combination').checked = !!med.isCombination;
    document.getElementById('modal-strength').value = med.strengthAmount ?? med.strength ?? '';
    document.getElementById('modal-units').value = med.activeUnit || String(med.units || '').split('/')[0] || '';
    document.getElementById('modal-per-amount').value = med.perAmount ?? '';
    document.getElementById('modal-per-unit').value = med.perUnit || String(med.units || '').split('/')[1] || '';
    document.getElementById('modal-threshold').value = med.minThreshold ?? 0;
    document.getElementById('modal-inventory-unit').value = inventoryUnitFor(med);
    document.getElementById('modal-administration-unit').value = med.administrationUnit || defaultAdministrationUnitForFormulation(med.formulation || 'Other');
    const ingredientList = document.getElementById('modal-ingredient-list');
    ingredientList.innerHTML = '';
    setCombinationSharedBasis('modal', med.components || []);
    (med.components || []).forEach(component => addModalIngredientRow(component));
    updateMedProfileMode();
    const prescriberSelect = document.getElementById('modal-prescriber');
    if (prescriberSelect) prescriberSelect.innerHTML = prescriberOptionsHtml(med.prescriberId || '', '', true);
    renderMedicationAssignmentControls('modal', assignedMemberIds(med));
    const imgContainer = document.getElementById('modal-image-container');
    imgContainer.innerHTML = med.imagePath ? `<img src="${imageSrc(med.imagePath)}" style="max-width:100%; max-height:100%;">` : "No Photo";
    document.getElementById('med-modal').style.display = 'flex';
};

window.saveMedProfile = async function() {
    const med = db.inventory.find(m => m.id === currentEditingMedId);
    if (med) {
        // 1. Update text fields
        const updatedName = document.getElementById('modal-med-name').value.trim();
        let barcodeCodes = collectProfileBarcodeCodes(true);
        if (barcodeCodes.length === 0) barcodeCodes = [createMedicationCode()];
        if (!updatedName) {
            await appAlert('Medication name is required.');
            return;
        }
        if (barcodeCodes.some(code => code.length > 100)) {
            await appAlert('Enter QR/barcode codes containing no more than 100 characters.');
            return;
        }
        for (const code of barcodeCodes) {
            if (await warnBarcodeConflict(code, med.id)) {
                return;
            }
        }
        const profileAssignedMemberIds = collectMedicationAssignment('modal');
        if (document.getElementById('modal-assignment-mode')?.value === 'selected' && profileAssignedMemberIds.length === 0) {
            await appAlert('Select at least one member or change assignment to all members.');
            return;
        }
        const formulation = document.getElementById('modal-formulation').value;
        const isCombination = document.getElementById('modal-is-combination').checked;
        let components = [];
        let strengthAmount = null;
        let activeUnit = '';
        let perAmount = null;
        let perUnit = '';

        if (isCombination) {
            const combo = collectCombinationComponents('modal');
            components = combo.components;
            const invalidComponentDenominator = combo.invalidDenominator;
            if (invalidComponentDenominator) {
                await appAlert('Each ingredient with a per-unit needs a volume or quantity greater than 0.');
                return;
            }
            if (components.length === 0) {
                await appAlert('Add at least one valid active ingredient.');
                return;
            }
            const combinationMed = { ...med, isCombination: true, components };
            med.strength = formatCombinationStrength(combinationMed);
            med.units = formatInventoryUnits(combinationMed);
            med.displayStrength = med.strength;
        } else {
            strengthAmount = parseAmount(document.getElementById('modal-strength').value, NaN);
            activeUnit = document.getElementById('modal-units').value.trim();
            perAmount = parseAmount(document.getElementById('modal-per-amount').value, NaN);
            perUnit = document.getElementById('modal-per-unit').value.trim();
            if (!Number.isFinite(strengthAmount) || strengthAmount <= 0 || !activeUnit) {
                await appAlert('Enter a valid strength and unit.');
                return;
            }
            const hasConcentrationDenominator = Number.isFinite(perAmount) && perAmount > 0 && perUnit;
            med.strength = hasConcentrationDenominator ? strengthAmount / perAmount : strengthAmount;
            med.units = hasConcentrationDenominator ? `${activeUnit}/${perUnit}` : activeUnit;
            med.displayStrength = hasConcentrationDenominator
                ? `${formatAmount(strengthAmount)}${activeUnit}/${formatAmount(perAmount)}${perUnit}`
                : `${formatAmount(strengthAmount)}${activeUnit}`;
        }
        med.name = updatedName;
        med.stock = parseAmount(document.getElementById('modal-stock').value, med.stock);
        med.notes = document.getElementById('modal-notes').value;
        med.storage = document.getElementById('modal-storage').value;
        med.controlLevel = document.getElementById('modal-control-level').value;
        med.expiry = document.getElementById('modal-expiry').value;
        med.prescriberId = document.getElementById('modal-prescriber')?.value || '';
        med.assignedMemberIds = profileAssignedMemberIds;
        med.barcodeCode = barcodeCodes[0];
        med.barcodeCodes = barcodeCodes;
        med.formulation = formulation;
        med.isCombination = isCombination;
        med.components = components;
        med.strengthAmount = isCombination ? null : strengthAmount;
        med.activeUnit = isCombination ? null : activeUnit;
        med.perAmount = isCombination || !perUnit ? null : perAmount;
        med.perUnit = isCombination ? '' : perUnit;
        med.minThreshold = parseAmount(document.getElementById('modal-threshold').value, 0);
        med.inventoryBehavior = dosageFormUsesContainerTracking(formulation)
            ? 'container-finish'
            : (document.getElementById('modal-inventory-behavior').value || defaultInventoryBehaviorForFormulation(formulation));
        med.inventoryUnit = document.getElementById('modal-inventory-unit').value.trim()
            || defaultInventoryUnitForFormulation(formulation, med.inventoryBehavior);
        med.administrationUnit = document.getElementById('modal-administration-unit').value.trim()
            || defaultAdministrationUnitForFormulation(formulation);
        med.isLiquid = formulation === 'mL' || (!isCombination && med.units.includes('/'));
        if (parseAmount(med.stock) > parseAmount(med.maxCapacity)) med.maxCapacity = med.stock;

        // 2. Handle Image Upload
        const imageInput = document.getElementById('modal-image-input');
        if (pendingModalMedImage) {
            try {
                med.imagePath = await savePendingMedicationImage(pendingModalMedImage);
            } catch (e) {
                console.error("Error saving pasted/dropped image:", e);
                alert("Failed to save image.");
            }
        } else if (imageInput && imageInput.files[0]) {
            try {
                const base64 = await toBase64(imageInput.files[0]);
                const fileName = `img_${Date.now()}_${imageInput.files[0].name.replace(/\s/g, '_')}`;
                // Save the image to the PharmAtlasData folder
                const newImagePath = await window.api.saveImage(fileName, base64);
                med.imagePath = newImagePath; // Update the DB with the new path
            } catch (e) {
                console.error("Error saving updated image:", e);
                alert("Failed to save image.");
            }
        }

        // 3. Sync and Close
        await sync();

        // Clear the file input for next time
        if (imageInput) imageInput.value = '';
        pendingModalMedImage = null;
        modalBarcodeCodes = [];
        updateImageDropzone('modal-image-dropzone', null);

        closeMedModal();
    }
};


window.closeMedModal = () => {
    modalBarcodeCodes = [];
    const input = document.getElementById('modal-barcode-code');
    if (input) input.value = '';
    renderModalBarcodeCodes();
    document.getElementById('med-modal').style.display = 'none';
};

// --- ORDER SETS ---
function frequencyOptionsHtml(selected = 'QD') {
    const options = [
        ['ONCE', 'One Time'],
        ['QD', 'QD'],
        ['BID', 'BID'],
        ['TID', 'TID'],
        ['QID', 'QID'],
        ['Nightly', 'Nightly'],
        ['QOD', 'QOD'],
        ['QW', 'Once Weekly'],
        ['QXW', 'Every X Weeks'],
        ['XPW', 'X Times Per Week'],
        ['QXH', 'Every X Hours'],
        ['PRN', 'PRN'],
        ['Monthly', 'Once Monthly']
    ];
    return options.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

let weekdayPickerId = 0;

function weekdayCheckboxesHtml(className, selectedDays = []) {
    const selected = new Set((selectedDays || []).map(Number));
    const pickerId = ++weekdayPickerId;
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        .map((day, index) => {
            const inputId = `${className}-${pickerId}-${index}`;
            return `<span class="weekday-option"><input id="${inputId}" class="${className}" type="checkbox" value="${index}" ${selected.has(index) ? 'checked' : ''}><label for="${inputId}">${day}</label></span>`;
        })
        .join('');
}

function medicationOptionsHtml(selected = '') {
    return db.inventory
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
        .map(med => `<option value="${med.id}" ${med.id === selected ? 'selected' : ''}>${med.name} ${formatMedStrength(med)}</option>`)
        .join('');
}

function getOrderSetRowMed(row) {
    return db.inventory.find(m => m.id === row.querySelector('.os-med-strength')?.value);
}

function updateOrderSetRowDose(row) {
    const med = getOrderSetRowMed(row);
    const doseQty = parseAmount(row.querySelector('.os-dose')?.value, NaN);
    const units = row.querySelector('.os-units');
    const calculated = row.querySelector('.os-calculated-dose');

    if (units) units.innerText = med ? (med.administrationUnit || med.formulation || 'unit(s)') : 'unit(s)';
    if (!calculated) return;
    calculated.value = med && Number.isFinite(doseQty) && doseQty > 0
        ? formatPrescribedDose(med, doseQty)
        : '';
}

function updateOrderSetStrengthOptions(row, selectedMedId = '') {
    const input = row.querySelector('.os-med-search');
    const strengthSelect = row.querySelector('.os-med-strength');
    if (!input || !strengthSelect) return;

    const matches = db.inventory.filter(med => med.name === input.value);
    strengthSelect.innerHTML = '';
    matches.forEach(med => {
        const opt = document.createElement('option');
        opt.value = med.id;
        opt.innerText = formatMedStrength(med);
        if (med.id === selectedMedId) opt.selected = true;
        strengthSelect.appendChild(opt);
    });
    input.style.backgroundColor = matches.length > 0 ? '#e0ffe0' : '';
    updateOrderSetRowDose(row);
}

window.addOrderSetMedicationRow = function(item = null) {
    const container = document.getElementById('order-set-med-list');
    if (!container) return;
    const selectedMed = item?.medId ? db.inventory.find(med => med.id === item.medId) : null;
    const row = document.createElement('div');
    row.className = 'sunken-panel order-set-med-row';
    row.dataset.rowId = item?.rowId || `osrow_${++orderSetRowCounter}`;
    row.dataset.linkTargetRowId = item?.linkTargetRowId || '';
    row.dataset.linkTargetRowIds = uniqueValues(item?.linkTargetRowIds?.length ? item.linkTargetRowIds : (item?.linkTargetRowId ? [item.linkTargetRowId] : [])).join(',');
    row.style.cssText = 'background:white; padding:6px; margin-bottom:6px;';
    row.innerHTML = `
        <div class="field-row">
            <label>Med:</label><input class="os-med-search" list="med-options" style="width:150px;" placeholder="Search..." value="${escapeHtml(selectedMed?.name || '')}">
            <label>Strength:</label><select class="os-med-strength" style="width:110px;"></select>
            <label>Dose Qty:</label><input class="os-dose" type="number" step="0.1" style="width:55px;" value="${item?.doseQty || ''}">
            <span class="os-units" style="min-width:58px;"></span>
            <label>Freq:</label><select class="os-freq">${frequencyOptionsHtml(item?.freq || 'QD')}</select>
            <button type="button" class="os-remove">Remove</button>
        </div>
        <div class="field-row" style="margin-top:5px;">
            <label>Calculated Dose:</label>
            <input class="os-calculated-dose" type="text" disabled style="width:150px; background:#c0c0c0; font-weight:bold;">
        </div>
        <div class="field-row" style="margin-top:5px;">
            <label>Link to:</label><div class="os-link-target link-choice-panel"></div>
            <label>Meaning:</label>
            <select class="os-link-mode">
                <option value="" ${!item?.linkMode ? 'selected' : ''}>None</option>
                <option value="together" ${item?.linkMode === 'together' ? 'selected' : ''}>Must take together</option>
                <option value="choose-one" ${item?.linkMode === 'choose-one' ? 'selected' : ''}>Choose only one</option>
            </select>
        </div>
        <div class="field-row os-qod" style="display:none; margin-top:5px;"><label>QOD Start:</label><input class="os-qod-start" type="date" value="${item?.qodStart || ''}"></div>
        <div class="field-row os-anchor" style="display:none; margin-top:5px;"><label>First dose date:</label><input class="os-anchor-date" type="date" value="${item?.anchorDate || ''}"><span class="form-help">Sets the weekly/monthly dates within the regimen window.</span></div>
        <div class="field-row os-interval" style="display:none; margin-top:5px;"><label>Every:</label><input class="os-interval-hours" type="number" min="1" max="24" step="1" value="${item?.intervalHours || 8}" style="width:45px;"><span>hrs</span></div>
        <div class="field-row os-week-interval" style="display:none; margin-top:5px;"><label>Every:</label><input class="os-interval-weeks" type="number" min="1" max="52" step="1" value="${item?.intervalWeeks || 2}" style="width:45px;"><span>weeks</span></div>
        <div class="field-row os-weekly-count" style="display:none; margin-top:5px;"><label>Times per week:</label><input class="os-times-per-week" type="number" min="1" max="7" step="1" value="${item?.timesPerWeek || Math.max(item?.weekdays?.length || 0, 1)}" style="width:45px;"></div>
        <div class="weekday-picker os-weekdays" style="display:none; margin-top:5px;"><span>Days:</span>${weekdayCheckboxesHtml('os-weekday-input', item?.weekdays || [])}</div>
        <div class="field-row os-prn-limit" style="display:none; margin-top:5px;"><label>PRN Max:</label><input class="os-prn-max-doses" type="number" min="1" step="1" style="width:45px;" value="${item?.prnMaxDoses || ''}"><span>doses per</span><input class="os-prn-window-hours" type="number" min="1" max="168" step="1" value="${item?.prnWindowHours || 24}" style="width:45px;"><span>hrs</span></div>
        <div class="field-row-stacked" style="margin-top:5px;"><label>Administration Time(s)</label><div class="os-time-fields"></div></div>
        <div class="field-row-stacked" style="margin-top:5px;"><label>Instructions</label><textarea class="os-instructions" rows="2" style="width:100%; resize:none;">${escapeHtml(item?.instructions || '')}</textarea></div>
    `;
    row.querySelector('.os-freq').addEventListener('change', () => renderOrderSetRowControls(row));
    row.querySelector('.os-med-search').addEventListener('input', () => { updateOrderSetStrengthOptions(row); renderOrderSetLinkOptions(); });
    row.querySelector('.os-med-strength').addEventListener('change', () => { updateOrderSetRowDose(row); renderOrderSetLinkOptions(); });
    row.querySelector('.os-dose').addEventListener('input', () => updateOrderSetRowDose(row));
    row.querySelector('.os-remove').addEventListener('click', () => { row.remove(); renderOrderSetLinkOptions(); });
    container.appendChild(row);
    updateOrderSetStrengthOptions(row, item?.medId || '');
    renderOrderSetRowControls(row, item?.freq === 'QXH' ? [item?.startTime || item?.times?.[0]] : item?.times);
    renderOrderSetLinkOptions();
};

function orderSetRowLabel(row) {
    const med = getOrderSetRowMed(row);
    const dose = row.querySelector('.os-dose')?.value || '';
    const freq = row.querySelector('.os-freq')?.value || '';
    const intervalHours = parseInt(row.querySelector('.os-interval-hours')?.value, 10);
    const freqLabel = freq === 'QXH' && Number.isInteger(intervalHours) ? `Q${intervalHours}H` : freq;
    return med ? `${med.name} ${formatMedStrength(med)}${dose ? ` - Qty ${dose}` : ''}${freqLabel ? ` (${freqLabel})` : ''}` : 'Select medication first';
}

function renderOrderSetLinkOptions() {
    const rows = Array.from(document.querySelectorAll('#order-set-med-list .order-set-med-row'));
    rows.forEach(row => {
        const panel = row.querySelector('.os-link-target');
        if (!panel) return;
        const selected = uniqueValues((row.dataset.linkTargetRowIds || row.dataset.linkTargetRowId || '').split(','));
        const choices = rows
            .filter(candidate => candidate !== row)
            .map(candidate => ({ id: candidate.dataset.rowId, label: orderSetRowLabel(candidate) }));
        renderLinkChoicePanel(panel, choices, selected, `openOrderSetLinkPicker('${row.dataset.rowId}')`);
    });
}

window.openOrderSetLinkPicker = async function(rowId) {
    const row = Array.from(document.querySelectorAll('#order-set-med-list .order-set-med-row'))
        .find(candidate => candidate.dataset.rowId === rowId);
    if (!row) return;
    const rows = Array.from(document.querySelectorAll('#order-set-med-list .order-set-med-row'));
    const choices = rows
        .filter(candidate => candidate !== row)
        .map(candidate => ({ id: candidate.dataset.rowId, label: orderSetRowLabel(candidate) }));
    const selected = await chooseLinkedMedications('Choose Linked Regimen Medications', choices, selectedOptionValues(row.querySelector('.os-link-target')));
    if (selected === null) return;
    row.dataset.linkTargetRowIds = selected.join(',');
    row.dataset.linkTargetRowId = selected[0] || '';
    renderOrderSetLinkOptions();
};

function renderOrderSetRowControls(row, existingTimes = null) {
    const freq = row.querySelector('.os-freq').value;
    row.querySelector('.os-qod').style.display = freq === 'QOD' ? 'flex' : 'none';
    row.querySelector('.os-anchor').style.display = ['QW', 'Monthly'].includes(freq) ? 'flex' : 'none';
    const anchorInput = row.querySelector('.os-anchor-date');
    if (['QW', 'Monthly'].includes(freq) && anchorInput && !anchorInput.value) {
        anchorInput.value = document.getElementById('order-set-start')?.value || localDateKey();
    }
    row.querySelector('.os-interval').style.display = freq === 'QXH' ? 'flex' : 'none';
    row.querySelector('.os-week-interval').style.display = freq === 'QXW' ? 'flex' : 'none';
    row.querySelector('.os-weekly-count').style.display = freq === 'XPW' ? 'flex' : 'none';
    row.querySelector('.os-weekdays').style.display = ['QXW', 'XPW'].includes(freq) ? 'flex' : 'none';
    row.querySelector('.os-prn-limit').style.display = freq === 'PRN' ? 'flex' : 'none';
    if (['QXW', 'XPW'].includes(freq) && !row.querySelector('.os-weekday-input:checked')) {
        const startDate = document.getElementById('order-set-start')?.value || localDateKey();
        const weekday = parseLocal(startDate)?.getDay() ?? new Date().getDay();
        const checkbox = row.querySelector(`.os-weekday-input[value="${weekday}"]`);
        if (checkbox) checkbox.checked = true;
    }
    const timeContainer = row.querySelector('.os-time-fields');
    timeContainer.innerHTML = '';
    if (freq === 'PRN') {
        timeContainer.innerHTML = '<span style="font-size:11px;">No scheduled administration times for PRN orders.</span>';
        return;
    }

    const times = Array.isArray(existingTimes) ? existingTimes : [];
    const count = freq === 'QXH' ? 1 : getExpectedTimeCount(freq);
    for (let i = 0; i < count; i++) {
        const timeRow = document.createElement('div');
        timeRow.className = 'field-row';
        timeRow.style.marginBottom = '4px';
        const label = freq === 'QXH' ? 'Start time:' : `Dose ${i + 1}:`;
        timeRow.innerHTML = `<label>${label}</label><input class="os-time-input" type="time" value="${times[i] || defaultTimeForIndex(i, freq)}">`;
        timeContainer.appendChild(timeRow);
    }
    if (freq === 'QXH') {
        const preview = document.createElement('div');
        preview.className = 'interval-preview sunken-panel os-interval-preview';
        timeContainer.appendChild(preview);
        const update = () => renderOrderSetIntervalPreview(row);
        row.querySelector('.os-time-input')?.addEventListener('input', update);
        row.querySelector('.os-interval-hours')?.addEventListener('input', update);
        document.getElementById('order-set-start')?.addEventListener('input', update);
        document.getElementById('order-set-end')?.addEventListener('input', update);
        renderOrderSetIntervalPreview(row);
    }
}

function renderOrderSetIntervalPreview(row) {
    const preview = row.querySelector('.os-interval-preview');
    if (!preview) return;
    const startDate = document.getElementById('order-set-start')?.value || localDateKey();
    const endValue = document.getElementById('order-set-end')?.value || '';
    const startTime = row.querySelector('.os-time-input')?.value || '';
    const intervalHours = parseInt(row.querySelector('.os-interval-hours')?.value, 10);
    if (!startDate || !startTime || !Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 24) {
        preview.innerHTML = '<div class="interval-preview-empty">Enter regimen start, start time, and interval to preview doses.</div>';
        return;
    }

    const previewEnd = parseLocal(startDate);
    previewEnd.setDate(previewEnd.getDate() + 2);
    const endDate = endValue ? parseLocal(endValue) : null;
    const through = endDate && endDate < previewEnd ? endDate : previewEnd;
    through.setHours(23, 59, 59, 999);
    const schedule = {
        id: 'preview',
        freq: 'QXH',
        startDate,
        endDate: endValue || 'Ongoing',
        startTime,
        times: [startTime],
        intervalHours
    };
    const from = dateTimeFromParts(startDate, startTime);
    const grouped = rollingIntervalInstancesBetween(schedule, from, through)
        .map(dateTimeParts)
        .filter(item => isScheduleDueOnDate(schedule, item.date))
        .reduce((map, item) => {
            if (!map.has(item.date)) map.set(item.date, []);
            map.get(item.date).push(item.time);
            return map;
        }, new Map());
    preview.innerHTML = grouped.size
        ? `<table class="interval-preview-table"><thead><tr><th>Date</th><th>Administration times</th></tr></thead><tbody>${Array.from(grouped.entries()).map(([date, times]) => `<tr><td>${escapeHtml(date)}</td><td>${times.map(escapeHtml).join(', ')}</td></tr>`).join('')}</tbody></table>`
        : '<div class="interval-preview-empty">No doses fall inside the regimen window.</div>';
}

function collectOrderSetItem(row) {
    const medId = row.querySelector('.os-med-strength').value;
    const doseQty = row.querySelector('.os-dose').value;
    const freq = row.querySelector('.os-freq').value;
    const rawTimes = Array.from(row.querySelectorAll('.os-time-input')).map(input => input.value).filter(Boolean);
    const intervalHours = freq === 'QXH' ? parseInt(row.querySelector('.os-interval-hours').value, 10) : null;
    const intervalWeeks = freq === 'QXW' ? parseInt(row.querySelector('.os-interval-weeks').value, 10) : null;
    const timesPerWeek = freq === 'XPW' ? parseInt(row.querySelector('.os-times-per-week').value, 10) : null;
    const weekdays = ['QXW', 'XPW'].includes(freq)
        ? Array.from(row.querySelectorAll('.os-weekday-input:checked')).map(input => parseInt(input.value, 10)).sort()
        : [];
    const prnMaxDoses = freq === 'PRN' ? parseInt(row.querySelector('.os-prn-max-doses')?.value, 10) : null;
    const prnWindowHours = freq === 'PRN' ? parseInt(row.querySelector('.os-prn-window-hours')?.value, 10) : null;
    if (!medId || !doseQty) {
        return { error: "Each regimen medication needs a medication, strength, and dose quantity." };
    }
    const selectedLinkTargetRowIds = selectedOptionValues(row.querySelector('.os-link-target'));
    const linkMode = row.querySelector('.os-link-mode')?.value || '';
    const linkTargetRowIds = linkMode ? selectedLinkTargetRowIds : [];
    if (selectedLinkTargetRowIds.length > 0 && !linkMode) {
        return { error: "Choose what the regimen medication link means: must take together or choose only one." };
    }
    if (linkMode && linkTargetRowIds.length === 0) {
        return { error: "Linked regimen medications need another medication selected." };
    }
    if (freq === 'QXH') {
        if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 24 || !rawTimes[0]) {
            return { error: "Every X Hours rows need a valid interval and start time." };
        }
        return {
            medId,
            doseQty,
            freq,
            times: generateIntervalTimes(rawTimes[0], intervalHours),
            intervalHours,
            startTime: rawTimes[0],
            qodStart: '',
            rowId: row.dataset.rowId,
            linkTargetRowIds,
            linkTargetRowId: linkTargetRowIds[0] || '',
            linkGroup: '',
            linkMode: row.querySelector('.os-link-mode')?.value || '',
            linkRules: linkTargetRowIds.map(targetRowId => ({ targetRowId, mode: linkMode })),
            instructions: row.querySelector('.os-instructions').value
        };
    }
    if (freq === 'PRN') {
        if (row.querySelector('.os-prn-max-doses')?.value && (!Number.isInteger(prnMaxDoses) || prnMaxDoses < 1)) {
            return { error: "PRN maximum doses must be 1 or higher." };
        }
        if (row.querySelector('.os-prn-window-hours')?.value && (!Number.isInteger(prnWindowHours) || prnWindowHours < 1 || prnWindowHours > 168)) {
            return { error: "PRN maximum window must be between 1 and 168 hours." };
        }
    }
    if (freq === 'QXW') {
        if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 52) {
            return { error: "Every X Weeks rows need an interval between 1 and 52 weeks." };
        }
        if (weekdays.length === 0) return { error: "Every X Weeks rows need at least one selected weekday." };
    }
    if (freq === 'XPW') {
        if (!Number.isInteger(timesPerWeek) || timesPerWeek < 1 || timesPerWeek > 7) {
            return { error: "Times per week must be between 1 and 7." };
        }
        if (weekdays.length !== timesPerWeek) {
            return { error: `Select exactly ${timesPerWeek} weekday${timesPerWeek === 1 ? '' : 's'} for the X Times Per Week row.` };
        }
    }
    if (freq !== 'PRN') {
        const expected = getExpectedTimeCount(freq);
        if (rawTimes.length !== expected) {
            return { error: `Each ${freq} order needs ${expected} administration time${expected === 1 ? '' : 's'}.` };
        }
    }
    return {
        medId,
        doseQty,
        freq,
        times: Array.from(new Set(rawTimes)).sort(),
        intervalHours: null,
        intervalWeeks,
        timesPerWeek,
        weekdays,
        prnMaxDoses: prnMaxDoses || null,
        prnWindowHours: prnWindowHours || 24,
        startTime: rawTimes[0] || '',
        qodStart: freq === 'QOD' ? row.querySelector('.os-qod-start').value : '',
        anchorDate: ['QW', 'Monthly'].includes(freq) ? row.querySelector('.os-anchor-date').value : '',
        rowId: row.dataset.rowId,
        linkTargetRowIds,
        linkTargetRowId: linkTargetRowIds[0] || '',
        linkGroup: '',
        linkMode: row.querySelector('.os-link-mode')?.value || '',
        linkRules: linkTargetRowIds.map(targetRowId => ({ targetRowId, mode: linkMode })),
        instructions: row.querySelector('.os-instructions').value
    };
}

function orderSetItemToSchedule(orderSet, item, index, existingSchedule = null) {
    const med = db.inventory.find(inv => inv.id === item.medId);
    const itemStartDate = item.anchorDate || orderSet.startDate;
    const itemEndDate = item.freq === 'ONCE' ? itemStartDate : orderSet.endDate;
    return {
        id: existingSchedule?.id || `${orderSet.id}_${Date.now()}_${index}`,
        memberId: orderSet.memberId,
        medId: item.medId,
        doseQty: item.doseQty,
        prescriberId: item.prescriberId || med?.prescriberId || '',
        freq: item.freq,
        startDate: itemStartDate,
        endDate: itemEndDate,
        instructions: item.instructions,
        qodStart: item.freq === 'QOD' ? (item.qodStart || orderSet.startDate) : '',
        times: item.times,
        intervalHours: item.intervalHours,
        intervalWeeks: item.intervalWeeks || null,
        timesPerWeek: item.timesPerWeek || null,
        weekdays: item.weekdays || [],
        prnMaxDoses: item.prnMaxDoses || null,
        prnWindowHours: item.prnWindowHours || 24,
        startTime: item.startTime || item.times[0] || '',
        isOneTime: item.freq === 'ONCE' || (itemStartDate === itemEndDate && itemEndDate !== 'Ongoing'),
        orderSetId: orderSet.id,
        orderSetName: orderSet.name,
        rowId: item.rowId || '',
        linkGroup: item.linkGroup || '',
        linkMode: item.linkMode || '',
        linkTargetRowIds: item.linkTargetRowIds || (item.linkTargetRowId ? [item.linkTargetRowId] : []),
        linkTargetRowId: item.linkTargetRowId || '',
        linkRules: item.linkRules || [],
        rollingAnchorDate: existingSchedule?.rollingAnchorDate || '',
        rollingAnchorTime: existingSchedule?.rollingAnchorTime || ''
    };
}

function orderSetItemTimingProxy(item, startDate, endDate) {
    const itemStartDate = item.anchorDate || startDate;
    return {
        ...item,
        id: item.rowId,
        startDate: itemStartDate,
        endDate: item.freq === 'ONCE' ? itemStartDate : endDate,
        monthlyAnchor: item.freq === 'Monthly' ? (item.anchorDate || itemStartDate) : '',
        qodStart: item.freq === 'QOD' ? (item.qodStart || itemStartDate) : ''
    };
}

function resolveOrderSetItemLinks(items) {
    const byRowId = new Map(items.map(item => [item.rowId, item]));
    items.forEach(item => {
        if (!item.linkMode) {
            item.linkTargetRowId = '';
            item.linkTargetRowIds = [];
            item.linkGroup = '';
            item.linkRules = [];
            return;
        }
        item.linkTargetRowIds = uniqueValues(item.linkTargetRowIds?.length ? item.linkTargetRowIds : (item.linkTargetRowId ? [item.linkTargetRowId] : []))
            .filter(targetRowId => byRowId.has(targetRowId));
        item.linkTargetRowId = item.linkTargetRowIds[0] || '';
        if (!item.linkTargetRowId) return;
        const target = byRowId.get(item.linkTargetRowId);
        const group = `regimen-link-${target.rowId}`;
        item.linkGroup = group;
        item.linkRules = item.linkTargetRowIds.map(targetRowId => ({ targetRowId, mode: item.linkMode }));
    });
    return items;
}

window.clearOrderSetBuilder = function() {
    document.getElementById('order-set-edit-id').value = '';
    document.getElementById('order-set-name').value = '';
    document.getElementById('order-set-start').value = localDateKey();
    document.getElementById('order-set-end').value = '';
    document.getElementById('order-set-med-list').innerHTML = '';
    addOrderSetMedicationRow();
};

window.saveOrderSet = async function() {
    const editId = document.getElementById('order-set-edit-id').value;
    const memberId = document.getElementById('order-set-member').value;
    const name = document.getElementById('order-set-name').value.trim();
    const startDate = document.getElementById('order-set-start').value || localDateKey();
    const endDate = document.getElementById('order-set-end').value || 'Ongoing';
    if (!name) {
        await appAlert("Order set name is required.");
        document.getElementById('order-set-name').focus();
        return;
    }

    const items = [];
    for (const row of Array.from(document.querySelectorAll('#order-set-med-list .order-set-med-row'))) {
        const item = collectOrderSetItem(row);
        if (!item || item.error) {
            await appAlert(item?.error || "Check the regimen medication rows.");
            return;
        }
        if (['QW', 'Monthly'].includes(item.freq)) {
            item.anchorDate = item.anchorDate || startDate;
            if (item.anchorDate < startDate || (endDate !== 'Ongoing' && item.anchorDate > endDate)) {
                await appAlert(`The first ${item.freq === 'QW' ? 'weekly' : 'monthly'} dose date must be inside the regimen start/end window.`);
                return;
            }
        }
        items.push(item);
    }
    if (items.length === 0) {
        await appAlert("Add at least one medication to the regimen.");
        return;
    }
    resolveOrderSetItemLinks(items);
    const itemTimingProxies = items.map(item => orderSetItemTimingProxy(item, startDate, endDate));
    for (const currentTiming of itemTimingProxies) {
        const mismatch = requiredTogetherSchedules(currentTiming, itemTimingProxies)
            .find(target => !schedulesHaveAlignedTiming(currentTiming, target));
        if (mismatch) {
            const currentMed = db.inventory.find(med => med.id === currentTiming.medId);
            const mismatchMed = db.inventory.find(med => med.id === mismatch.medId);
            await appAlert(`Regimen medications marked must-take-together need the same date, frequency, and administration time.\n\n${currentMed?.name || 'This medication'}: ${timingMismatchLabel(currentTiming)}\n${mismatchMed?.name || 'Linked medication'}: ${timingMismatchLabel(orderSetItemTimingProxy(mismatch, startDate, endDate))}`);
            return;
        }
    }

    const orderSet = { id: editId || Date.now().toString(), memberId, name, startDate, endDate, items, status: '', completedAt: '' };
    const existingIndex = db.orderSets.findIndex(set => set.id === orderSet.id);
    if (existingIndex >= 0) db.orderSets[existingIndex] = orderSet;
    else db.orderSets.push(orderSet);

    const existingSchedules = db.schedules.filter(schedule => schedule.orderSetId === orderSet.id);
    const existingByRowId = new Map(existingSchedules.filter(schedule => schedule.rowId).map(schedule => [schedule.rowId, schedule]));
    const claimedScheduleIds = new Set();
    const matchExistingSchedule = item => {
        const byRow = item.rowId ? existingByRowId.get(item.rowId) : null;
        if (byRow && !claimedScheduleIds.has(byRow.id)) {
            claimedScheduleIds.add(byRow.id);
            return byRow;
        }
        const fallback = existingSchedules.find(schedule =>
            !claimedScheduleIds.has(schedule.id) &&
            schedule.medId === item.medId &&
            schedule.freq === item.freq
        );
        if (fallback) claimedScheduleIds.add(fallback.id);
        return fallback || null;
    };

    db.schedules = db.schedules.filter(schedule => schedule.orderSetId !== orderSet.id);
    if (memberId) {
        db.schedules.push(...items.map((item, index) => orderSetItemToSchedule(orderSet, item, index, matchExistingSchedule(item))));
    }

    await sync();
    clearOrderSetBuilder();
};

window.editOrderSet = function(id) {
    const set = db.orderSets.find(orderSet => orderSet.id === id);
    if (!set) return;
    const memberModal = document.getElementById('member-modal');
    if (memberModal?.style.display === 'flex') {
        minimizeMemberModal();
    }
    document.getElementById('order-set-edit-id').value = set.id;
    document.getElementById('order-set-member').value = set.memberId;
    document.getElementById('order-set-name').value = set.name;
    document.getElementById('order-set-start').value = set.startDate;
    document.getElementById('order-set-end').value = set.endDate === 'Ongoing' ? '' : set.endDate;
    document.getElementById('order-set-med-list').innerHTML = '';
    set.items.forEach(item => addOrderSetMedicationRow(item));
    switchTab('order-sets');
};

window.assignOrderSet = async function(id) {
    const source = db.orderSets.find(orderSet => orderSet.id === id);
    if (!source) return;
    if (db.family.length === 0) {
        await appAlert("Add a member before assigning a regimen.");
        return;
    }

    const result = await showActionModal(`Assign Regimen: ${source.name}`, `
        <div class="field-row">
            <label>Member:</label>
            <select name="memberId">${memberOptionsHtml(source.memberId || '')}</select>
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Start:</label><input name="startDate" type="date" value="${escapeHtml(source.startDate || localDateKey())}">
            <label>End:</label><input name="endDate" type="date" value="${source.endDate === 'Ongoing' ? '' : escapeHtml(source.endDate || '')}">
        </div>
    `, 'Assign');
    if (!result) return;
    if (!result.memberId || !result.startDate) {
        await appAlert("Member and start date are required to assign a regimen.");
        return;
    }

    const assignedSet = {
        ...source,
        id: Date.now().toString(),
        templateId: source.templateId || source.id,
        memberId: result.memberId,
        startDate: result.startDate,
        endDate: result.endDate || 'Ongoing',
        items: source.items.map(item => {
            if (!['QW', 'Monthly'].includes(item.freq) || !item.anchorDate || !source.startDate) return { ...item };
            const offset = Math.max(daysBetween(item.anchorDate, source.startDate), 0);
            const rebasedAnchor = parseLocal(result.startDate);
            rebasedAnchor.setDate(rebasedAnchor.getDate() + offset);
            return { ...item, anchorDate: localDateKey(rebasedAnchor) };
        })
    };
    const invalidAnchor = assignedSet.items.find(item =>
        ['QW', 'Monthly'].includes(item.freq) &&
        item.anchorDate &&
        (item.anchorDate < assignedSet.startDate || (assignedSet.endDate !== 'Ongoing' && item.anchorDate > assignedSet.endDate))
    );
    if (invalidAnchor) {
        await appAlert('The assigned date range is too short for one of the weekly/monthly first-dose dates. Extend the end date or edit the regimen.');
        return;
    }

    db.orderSets.push(assignedSet);
    db.schedules.push(...assignedSet.items.map((item, index) => orderSetItemToSchedule(assignedSet, item, index)));
    await sync();
};

window.deleteOrderSet = async function(id) {
    if (!await appConfirm("Delete this regimen and its related schedules?", "Delete Regimen")) return;
    db.orderSets = db.orderSets.filter(set => set.id !== id);
    db.schedules = db.schedules.filter(schedule => schedule.orderSetId !== id);
    await sync();
    const memberModal = document.getElementById('member-modal');
    if (currentEditingMemberId && memberModal?.style.display === 'flex') {
        openMemberModal(currentEditingMemberId);
    }
};

window.printOrderSetLabel = function(id) {
    const set = db.orderSets.find(orderSet => orderSet.id === id);
    if (!set) return;
    const member = db.family.find(m => m.id === set.memberId);
    const sourceItems = set.memberId
        ? db.schedules.filter(schedule => schedule.orderSetId === set.id)
        : set.items.map(item => ({ ...item, startDate: set.startDate, endDate: set.endDate }));
    const entries = sourceItems.map(schedule => {
        const med = db.inventory.find(item => item.id === schedule.medId);
        if (!med) return null;
        const timing = schedule.freq === 'PRN'
            ? 'As needed'
            : `${formatFrequency(schedule)} at ${getScheduleTimes(schedule).join(', ')}`;
        const detail = `Qty ${formatQtyForSchedule(schedule, med)} | Dose ${formatPrescribedDose(med, schedule.doseQty)} | ${timing}`;
        const displayName = formatMultiMedLabelName(schedule, med);
        return {
            med,
            schedule,
            displayName,
            detail,
            instructions: schedule.instructions || '',
            size: displayName.length + detail.length + String(schedule.instructions || '').length
        };
    }).filter(Boolean);
    if (entries.length === 0) {
        void appAlert(set.memberId
            ? 'This assigned regimen has no active medications to print.'
            : 'This reusable regimen has no medications to print.');
        return;
    }

    const pages = [];
    let page = [];
    let pageSize = 0;
    entries.forEach(entry => {
        if (page.length > 0 && (page.length >= 4 || pageSize + entry.size > 285)) {
            pages.push(page);
            page = [];
            pageSize = 0;
        }
        page.push(entry);
        pageSize += entry.size;
    });
    if (page.length) pages.push(page);

    const labels = pages.map((pageEntries, pageIndex) => {
        const rows = pageEntries.map(entry => `
            <div class="label-med-row order-set-label-row">
                <span class="order-set-label-med">${escapeHtml(entry.displayName)}</span><br>
                ${escapeHtml(entry.detail)}
                ${entry.instructions ? `<br>Note: ${escapeHtml(entry.instructions)}` : ''}
            </div>`).join('');
        const memberLine = member
            ? `${member.firstName} ${member.lastName} | ${set.startDate}-${set.endDate}`
            : 'Reusable regimen';
        const continuation = pages.length > 1 ? ` | ${pageIndex + 1}/${pages.length}` : '';
        return `
            <div class="${getLabelClass([set.name, memberLine, rows], pageEntries.length * 2 + 2)}">
                <div class="label-title">${escapeHtml(set.name)}${escapeHtml(continuation)}</div>
                <div class="label-small">${escapeHtml(memberLine)}</div>
                ${rows}
            </div>`;
    });
    previewLabelHtml(labels.join(''));
};

window.printOrderSetMedicationLabel = async function(id) {
    const set = db.orderSets.find(orderSet => orderSet.id === id);
    if (!set) return;
    const schedules = db.schedules.filter(schedule => schedule.orderSetId === set.id);
    if (!set.memberId || schedules.length === 0) {
        await appAlert('Assign this regimen to a member before printing individual medication labels.');
        return;
    }

    const options = schedules.map(schedule => {
        const med = db.inventory.find(item => item.id === schedule.medId);
        if (!med) return '';
        return `<option value="${escapeHtml(schedule.id)}">${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))} - ${escapeHtml(formatFrequency(schedule))}</option>`;
    }).join('');
    const result = await showActionModal(`Individual Labels: ${set.name}`, `
        <div class="field-row-stacked">
            <label>Medication:</label>
            <select name="scheduleId" style="width:100%;">${options}</select>
        </div>
    `, 'Choose Dates');
    if (result?.scheduleId) await window.printSingleLabel(result.scheduleId);
};

window.toggleRegimenFavorite = async function(id, event = null) {
    event?.stopPropagation?.();
    const set = db.orderSets.find(orderSet => orderSet.id === id && !orderSet.memberId);
    if (!set) return;
    set.favorite = !set.favorite;
    addAudit('Regimen favorite changed', set.name || 'Reusable regimen', set.favorite ? 'Marked favorite' : 'Removed favorite');
    await sync();
};

window.toggleRegimenFavoriteAtIndex = async function(index, event = null) {
    event?.stopPropagation?.();
    const set = db.orderSets[index];
    if (!set || set.memberId) return;
    set.favorite = !set.favorite;
    addAudit('Regimen favorite changed', set.name || 'Reusable regimen', set.favorite ? 'Marked favorite' : 'Removed favorite');
    await sync();
};

function renderOrderSets() {
    const memberSelect = document.getElementById('order-set-member');
    const selectedBuilderMember = memberSelect?.value || '';
    if (memberSelect) {
        memberSelect.innerHTML = `<option value="">Reusable template</option>` + db.family
            .slice()
            .sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b), undefined, { sensitivity: 'base' }))
            .map(m => `<option value="${m.id}">${escapeHtml(memberDisplayName(m))}</option>`)
            .join('');
        memberSelect.value = selectedBuilderMember;
    }

    const startInput = document.getElementById('order-set-start');
    if (startInput && !startInput.value) startInput.value = localDateKey();

    const medList = document.getElementById('order-set-med-list');
    if (medList && medList.children.length === 0 && db.inventory.length > 0) {
        addOrderSetMedicationRow();
    }

    const filter = document.getElementById('order-set-member-filter');
    const selectedFilter = filter?.value || '';
    if (filter) {
        filter.innerHTML = '<option value="">All members</option>' + db.family
            .slice()
            .sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b), undefined, { sensitivity: 'base' }))
            .map(member => `<option value="${escapeHtml(member.id)}">${escapeHtml(memberDisplayName(member))}</option>`)
            .join('');
        filter.value = db.family.some(member => member.id === selectedFilter) ? selectedFilter : '';
    }

    const templateList = document.getElementById('order-set-template-list');
    const assignedList = document.getElementById('order-set-assigned-list');
    if (!templateList || !assignedList) return;

    const orderSetRowHtml = (set, isTemplate) => {
        const setIndex = db.orderSets.indexOf(set);
        const member = db.family.find(m => m.id === set.memberId);
        const itemSummary = set.items.map(item => {
            const med = db.inventory.find(m => m.id === item.medId);
            return med ? med.name : 'Unknown';
        }).join(', ');
        const activeSchedules = db.schedules.filter(schedule => schedule.orderSetId === set.id && !isScheduleArchived(schedule));
        const containerActions = activeSchedules.map(schedule => {
            const med = db.inventory.find(item => item.id === schedule.medId);
            if (!med || !usesContainerTracking(med)) return '';
            return `<button onclick="finishTopicalContainer('${escapeHtml(schedule.id)}')" title="${escapeHtml(med.name)}">${escapeHtml(finishedContainerButtonText(med))}: ${escapeHtml(med.name)}</button>`;
        }).join('');
        const statusText = isTemplate
            ? `${set.items.length} medication${set.items.length === 1 ? '' : 's'}`
            : `${escapeHtml(memberDisplayName(member))} | ${activeSchedules.length} active medication${activeSchedules.length === 1 ? '' : 's'}`;
        const favoriteStar = isTemplate && set.favorite ? '<span class="win98-star" title="Favorite regimen">&#9733;</span>' : '';
        return `<div class="med-item-row" style="border-bottom:1px solid #808080;">
            <div style="flex-grow:1;">
                ${favoriteStar}<strong>${escapeHtml(set.name)}</strong> - <small>${statusText}</small><br>
                <small>${escapeHtml(itemSummary)}</small>
            </div>
            ${isTemplate ? `<button type="button" class="favorite-regimen-button ${set.favorite ? 'favorited' : ''}" onclick="toggleRegimenFavoriteAtIndex(${setIndex}, event)" title="${set.favorite ? 'Remove favorite' : 'Mark as favorite'}">${set.favorite ? '&#9733;' : '&#9734;'} Favorite</button>` : ''}
            ${isTemplate ? `<button onclick="assignOrderSet('${escapeHtml(set.id)}')">Assign</button>` : ''}
            <button onclick="printOrderSetLabel('${escapeHtml(set.id)}')">Regimen Label</button>
            ${!isTemplate && activeSchedules.length ? `<button onclick="printOrderSetMedicationLabel('${escapeHtml(set.id)}')">Individual Labels</button>` : ''}
            ${!isTemplate && activeSchedules.length ? `<button onclick="administerOrderSet('${escapeHtml(set.id)}')">Administer</button>` : ''}
            ${!isTemplate ? containerActions : ''}
            <button onclick="editOrderSet('${escapeHtml(set.id)}')">Edit</button>
            <button onclick="deleteOrderSet('${escapeHtml(set.id)}')">Delete</button>
        </div>`;
    };

    const templates = db.orderSets
        .filter(set => !set.memberId)
        .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    const assigned = db.orderSets.filter(set => set.memberId && set.status !== 'completed' && (!filter?.value || set.memberId === filter.value));
    templateList.innerHTML = templates.length
        ? templates.map(set => orderSetRowHtml(set, true)).join('')
        : '<div style="padding:6px; font-size:11px;">No reusable regimens saved.</div>';
    assignedList.innerHTML = assigned.length
        ? assigned.map(set => orderSetRowHtml(set, false)).join('')
        : `<div style="padding:6px; font-size:11px;">${filter?.value ? 'No regimens assigned to this member.' : 'No assigned regimens saved.'}</div>`;
}

function prepackItemId() {
    return `prep_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isInventoryUnitDoseQueue(queue) {
    return queue?.selection?.kind === 'inventory-unit-dose';
}

function inventoryUnitDoseDefinition(med, values = {}) {
    const prepDate = values.prepDate || localDateKey();
    const prepTime = values.prepTime || '08:00';
    const qtyPerContainer = parseAmount(values.qtyPerContainer, 0);
    const containerCount = Math.max(1, parseInt(values.containerCount, 10) || 1);
    const containerType = values.containerType || 'container';
    const labelName = String(values.labelName || '').trim();
    const instructions = String(values.instructions || '').trim();
    const expirationDate = values.expirationDate || '';
    const prepackedBarcodeCode = values.prepackedBarcodeCode || createMedicationCode();
    const stockUnit = inventoryUnitFor(med);
    const giveUnit = med.administrationUnit || med.formulation || stockUnit || 'unit';
    const strength = formatLabelMedStrength(med);
    const dose = formatPrescribedDose(med, qtyPerContainer);
    const sourceLabel = `${labelName || med.name} | ${containerCount} ${containerType}${containerCount === 1 ? '' : 's'} | ${formatAmount(qtyPerContainer)} ${giveUnit} each${expirationDate ? ` | exp ${expirationDate}` : ''}`;
    const prepUnitName = String(containerType || 'container').replace(/^prefilled\s+/i, '');
    const items = Array.from({ length: containerCount }, (_, index) => ({
        id: prepackItemId(),
        medId: med.id,
        medName: med.name,
        strength,
        quantity: `${formatAmount(qtyPerContainer)} ${giveUnit}`,
        dose,
        instructions,
        time: `${prepUnitName} ${index + 1}`,
        barcodeCode: medicationCodes(med)[0] || '',
        status: 'pending',
        inventoryUnitDose: true,
        containerType,
        expirationDate,
        prepackedBarcodeCode
    }));
    return {
        memberId: '',
        memberName: 'Inventory Unit Dose',
        title: labelName || `${med.name} ${strength}`.trim(),
        sourceLabel,
        selection: {
            kind: 'inventory-unit-dose',
            batchId: `unitdose_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            medId: med.id,
            startDate: prepDate,
            endDate: prepDate,
            prepDate,
            prepTime,
            qtyPerContainer,
            containerCount,
            containerType,
            expirationDate,
            prepackedBarcodeCode,
            labelName,
            instructions
        },
        days: [{
            date: prepDate,
            status: 'pending',
            needsReprint: false,
            items
        }]
    };
}

function preparedUnitDoseInventoryName(sourceMed, queue) {
    const labelName = String(queue.selection?.labelName || '').trim();
    const containerType = queue.selection?.containerType || 'container';
    return labelName || `${sourceMed.name} ${containerType}`;
}

function buildPreparedUnitDoseInventoryItem(sourceMed, queue, totalQty) {
    const qtyPerContainer = parseAmount(queue.selection.qtyPerContainer, 0);
    const preparedCount = preparedInventoryUnitDoseCount(queue);
    const containerCount = Math.max(1, preparedCount || parseInt(queue.selection.containerCount, 10) || 1);
    const containerType = queue.selection.containerType || 'container';
    const expirationDate = queue.selection.expirationDate || '';
    const prepDate = queue.selection.prepDate || queue.days?.[0]?.date || localDateKey();
    const prepTime = queue.selection.prepTime || (queue.scheduledFor || '').slice(11, 16) || '';
    const sourceUnit = sourceMed.administrationUnit || sourceMed.formulation || inventoryUnitFor(sourceMed) || 'unit';
    const barcodeCode = normalizeMedicationCode(queue.selection.prepackedBarcodeCode) || createMedicationCode();
    const isCombo = sourceMed.isCombination && Array.isArray(sourceMed.components) && sourceMed.components.length > 0;
    const calculatedDose = formatPrescribedDose(sourceMed, qtyPerContainer);
    const doseUnit = String(calculatedDose || '').match(/[a-zA-Z%/]+/)?.[0] || String(sourceMed.units || '').split('/')[0] || sourceMed.activeUnit || sourceMed.units || '';
    const doseAmount = parseAmount(calculatedDose, NaN);
    const components = isCombo
        ? sourceMed.components.map(component => ({
            ...component,
            strength: parseAmount(component.strength, 0) * qtyPerContainer,
            strengthAmount: parseAmount(component.strength, 0) * qtyPerContainer,
            perAmount: 1,
            perUnit: containerType
        }))
        : [];
    const name = preparedUnitDoseInventoryName(sourceMed, queue);
    const displayStrength = isCombo
        ? formatCombinationStrength({ ...sourceMed, components }, false, false)
        : (Number.isFinite(doseAmount) && doseUnit ? `${formatAmount(doseAmount)}${doseUnit}` : formatLabelMedStrength(sourceMed));
    return {
        id: `unitdose_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name,
        strength: Number.isFinite(doseAmount) ? doseAmount : sourceMed.strength,
        units: isCombo ? sourceMed.units : (doseUnit || sourceMed.units || ''),
        displayStrength,
        strengthAmount: isCombo ? null : (Number.isFinite(doseAmount) ? doseAmount : sourceMed.strengthAmount),
        activeUnit: isCombo ? null : (doseUnit || sourceMed.activeUnit || sourceMed.units || ''),
        perAmount: isCombo ? null : 1,
        perUnit: isCombo ? null : containerType,
        formulation: 'Other',
        inventoryUnit: containerType,
        administrationUnit: containerType,
        inventoryBehavior: 'per-dose',
        stock: containerCount,
        maxCapacity: containerCount,
        expiry: expirationDate,
        storage: sourceMed.storage || 'N/A',
        controlLevel: sourceMed.controlLevel || 'N/A',
        isLiquid: false,
        isCombination: isCombo,
        components,
        minThreshold: 1,
        prescriberId: sourceMed.prescriberId || '',
        assignedMemberIds: Array.isArray(sourceMed.assignedMemberIds) ? [...sourceMed.assignedMemberIds] : [],
        barcodeCode,
        barcodeCodes: [barcodeCode],
        imagePath: sourceMed.imagePath || '',
        sourceInventoryId: sourceMed.id,
        prepackedFrom: sourceMed.name,
        prepackQueueId: queue.id,
        notes: [
            `Prepacked from inventory: ${sourceMed.name} ${formatLabelMedStrength(sourceMed)}`,
            `Each ${containerType} contains ${formatAmount(qtyPerContainer)} ${sourceUnit}.`,
            `Calculated dose per ${containerType}: ${calculatedDose || displayStrength}.`,
            `Prepared: ${prepDate}${prepTime ? ` ${prepTime}` : ''}.`,
            `Source stock used: ${formatAmount(totalQty)} ${sourceUnit}.`,
            queue.selection.instructions ? `Instructions: ${queue.selection.instructions}` : ''
        ].filter(Boolean).join('\n')
    };
}

function preparedInventoryUnitDoseCount(queue) {
    return (queue.days || []).reduce((sum, day) =>
        sum + (day.items || []).filter(item => item.inventoryDeducted === true).length,
    0);
}

function ensurePreparedInventoryForUnitDose(queue, sourceMed) {
    const existing = queue.prepackedInventoryId
        ? db.inventory.find(item => item.id === queue.prepackedInventoryId)
        : null;
    if (existing) return existing;
    const preparedItem = buildPreparedUnitDoseInventoryItem(sourceMed, queue, 0);
    preparedItem.stock = 0;
    preparedItem.maxCapacity = Math.max(0, parseInt(queue.selection.containerCount, 10) || 0);
    db.inventory.push(preparedItem);
    queue.prepackedInventoryId = preparedItem.id;
    return preparedItem;
}

function applyInventoryUnitDoseItemStock(queue, item, method = 'scan') {
    if (!isInventoryUnitDoseQueue(queue) || !item || item.inventoryDeducted === true) return true;
    const sourceMed = db.inventory.find(candidate => candidate.id === queue.selection.medId);
    if (!sourceMed) return false;
    const qtyPerContainer = parseAmount(queue.selection.qtyPerContainer, 0);
    if (!Number.isFinite(qtyPerContainer) || qtyPerContainer <= 0) return false;
    if (parseAmount(sourceMed.stock, 0) < qtyPerContainer) return false;
    const preparedItem = ensurePreparedInventoryForUnitDose(queue, sourceMed);
    sourceMed.stock = Math.max(0, parseAmount(sourceMed.stock, 0) - qtyPerContainer);
    preparedItem.stock = parseAmount(preparedItem.stock, 0) + 1;
    if (parseAmount(preparedItem.stock, 0) > parseAmount(preparedItem.maxCapacity, 0)) preparedItem.maxCapacity = preparedItem.stock;
    preparedItem.notes = buildPreparedUnitDoseInventoryItem(sourceMed, queue, qtyPerContainer * parseAmount(preparedItem.stock, 0)).notes;
    item.inventoryDeducted = true;
    item.preparedInventoryId = preparedItem.id;
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medId: sourceMed.id,
        medName: sourceMed.name,
        details: `${item.time} verified by ${method}; -${formatAmount(qtyPerContainer)} ${sourceMed.administrationUnit || inventoryUnitFor(sourceMed)} source stock; +1 ${inventoryUnitFor(preparedItem)} prepared inventory.`
    });
    addAudit('Inventory unit-dose container prepped', sourceMed.name, `${item.time} | -${formatAmount(qtyPerContainer)} ${sourceMed.administrationUnit || inventoryUnitFor(sourceMed)} | +1 ${inventoryUnitFor(preparedItem)}.`);
    return true;
}

function reverseInventoryUnitDoseItemStock(queue, item) {
    if (!isInventoryUnitDoseQueue(queue) || !item?.inventoryDeducted) return;
    const sourceMed = db.inventory.find(candidate => candidate.id === queue.selection.medId);
    const preparedItem = db.inventory.find(candidate => candidate.id === (item.preparedInventoryId || queue.prepackedInventoryId));
    const qtyPerContainer = parseAmount(queue.selection.qtyPerContainer, 0);
    if (sourceMed && Number.isFinite(qtyPerContainer) && qtyPerContainer > 0) {
        sourceMed.stock = parseAmount(sourceMed.stock, 0) + qtyPerContainer;
    }
    if (preparedItem) {
        preparedItem.stock = Math.max(0, parseAmount(preparedItem.stock, 0) - 1);
        if (sourceMed) preparedItem.notes = buildPreparedUnitDoseInventoryItem(sourceMed, queue, qtyPerContainer * parseAmount(preparedItem.stock, 0)).notes;
    }
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medId: sourceMed?.id || item.medId,
        medName: sourceMed?.name || item.medName,
        details: `${item.time} removed from unit-dose prepack; returned ${formatAmount(qtyPerContainer)} ${sourceMed?.administrationUnit || (sourceMed ? inventoryUnitFor(sourceMed) : 'units')} to source stock.`
    });
}

function selectedInventoryUnitDoseMedication(body = document.getElementById('action-modal-body')) {
    const query = String(body?.querySelector('[name="medSearch"]')?.value || '').trim();
    if (!query) return null;
    const inventory = sortByName(db.inventory, inventoryDisplayName);
    const lowered = query.toLowerCase();
    const partialMatches = inventory.filter(item => inventoryDisplayName(item).toLowerCase().includes(lowered) || String(item.name || '').toLowerCase().includes(lowered));
    return inventory.find(item => inventoryDisplayName(item) === query)
        || inventory.find(item => item.name.toLowerCase() === lowered)
        || (partialMatches.length === 1 ? partialMatches[0] : null)
        || null;
}

function inventoryUnitDoseExpirationFromForm(body = document.getElementById('action-modal-body')) {
    const mode = body?.querySelector('[name="expirationMode"]')?.value || 'date';
    const prepDate = body?.querySelector('[name="prepDate"]')?.value || localDateKey();
    if (mode === 'days') {
        const days = parseInt(body?.querySelector('[name="expirationDays"]')?.value, 10);
        return Number.isFinite(days) && days >= 0 ? addDaysKey(prepDate, days) : '';
    }
    return body?.querySelector('[name="expirationDate"]')?.value || '';
}

window.updateInventoryUnitDosePrepackPreview = function() {
    const body = document.getElementById('action-modal-body');
    if (!body) return;
    const med = selectedInventoryUnitDoseMedication(body);
    const qty = parseAmount(body.querySelector('[name="qtyPerContainer"]')?.value, NaN);
    const count = parseInt(body.querySelector('[name="containerCount"]')?.value, 10);
    const mode = body.querySelector('[name="expirationMode"]')?.value || 'date';
    const dateWrap = body.querySelector('#unit-dose-expiry-date-wrap');
    const daysWrap = body.querySelector('#unit-dose-expiry-days-wrap');
    if (dateWrap) dateWrap.style.display = mode === 'date' ? 'inline-flex' : 'none';
    if (daysWrap) daysWrap.style.display = mode === 'days' ? 'inline-flex' : 'none';
    const preview = body.querySelector('#unit-dose-calculated-preview');
    if (!preview) return;
    if (!med) {
        preview.innerHTML = 'Select an inventory item to preview the calculated dose and stock needed.';
        return;
    }
    const expirationDateInput = body.querySelector('[name="expirationDate"]');
    if (mode === 'date' && expirationDateInput && !expirationDateInput.value && med.expiry) {
        expirationDateInput.value = med.expiry;
    }
    const giveUnit = med.administrationUnit || med.formulation || inventoryUnitFor(med) || 'unit';
    const totalNeeded = Number.isFinite(qty) && Number.isFinite(count) ? qty * count : NaN;
    const expirationDate = inventoryUnitDoseExpirationFromForm(body);
    preview.innerHTML = `
        <strong>${escapeHtml(med.name)} ${escapeHtml(formatLabelMedStrength(med))}</strong><br>
        Amount per container: ${Number.isFinite(qty) ? `${escapeHtml(formatAmount(qty))} ${escapeHtml(giveUnit)}` : 'Enter amount'}<br>
        Calculated dose per container: ${Number.isFinite(qty) && qty > 0 ? escapeHtml(formatPrescribedDose(med, qty)) : 'Enter amount'}<br>
        Total stock needed: ${Number.isFinite(totalNeeded) ? `${escapeHtml(formatAmount(totalNeeded))} ${escapeHtml(giveUnit)}` : 'Enter amount and container count'} | On hand: ${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))}<br>
        Expiration for prepared container(s): ${escapeHtml(expirationDate || 'Not selected')}
    `;
};

function deductInventoryUnitDoseStock(queue) {
    if (!isInventoryUnitDoseQueue(queue) || queue.inventoryDeducted) return;
    const med = db.inventory.find(item => item.id === queue.selection.medId);
    if (!med) return;
    const preparedCount = preparedInventoryUnitDoseCount(queue);
    const totalQty = parseAmount(queue.selection.qtyPerContainer, 0) * preparedCount;
    if (!Number.isFinite(totalQty) || totalQty <= 0) return;
    queue.inventoryDeducted = true;
    const preparedItem = queue.prepackedInventoryId ? db.inventory.find(item => item.id === queue.prepackedInventoryId) : null;
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medId: med.id,
        medName: med.name,
        details: `Inventory unit-dose prepack completed; ${preparedCount} prepared ${queue.selection.containerType}${preparedCount === 1 ? '' : 's'} in inventory.`
    });
    addAudit('Inventory unit-dose prepack completed', med.name, `${preparedCount} prepared ${preparedItem ? inventoryUnitFor(preparedItem) : queue.selection.containerType}.`);
}

function inventoryUnitDoseLabelHtml(queue, item, index = 0) {
    const med = db.inventory.find(candidate => candidate.id === item.medId);
    const code = normalizeMedicationCode(queue.selection?.prepackedBarcodeCode || item.prepackedBarcodeCode) || (med ? medicationCodes(med)[0] : normalizeMedicationCode(item.barcodeCode));
    const qrDataUrl = medicationQrDataUrl(code);
    const title = `${item.medName} ${item.strength || ''}`.trim();
    const prepDate = queue.selection?.prepDate || queue.days?.[0]?.date || '';
    const lines = [
        title,
        item.quantity,
        item.dose,
        item.expirationDate,
        prepDate,
        item.instructions
    ];
    return `<div class="${getLabelClass(lines, item.instructions ? 6 : 5)} compound-bottle-label inventory-unit-dose-label">
        <div class="compound-label-copy">
            <div class="label-title">${escapeHtml(title)}</div>
            <div class="label-small"><strong>Qty:</strong> ${escapeHtml(item.quantity)}</div>
            <div class="label-small"><strong>Dose:</strong> ${escapeHtml(item.dose || item.strength || '')}</div>
            ${item.expirationDate ? `<div class="label-small"><strong>Exp:</strong> ${escapeHtml(item.expirationDate)}</div>` : ''}
            ${prepDate ? `<div class="label-small"><strong>Prepped:</strong> ${escapeHtml(prepDate)}</div>` : ''}
            ${item.instructions ? `<div class="label-small"><strong>Directions:</strong> ${escapeHtml(item.instructions)}</div>` : ''}
        </div>
        ${qrDataUrl ? `<img class="compound-label-qr" src="${qrDataUrl}" alt="Medication QR code">` : ''}
    </div>`;
}

function prepackShiftForTime(time) {
    const minutes = timeToMinutes(time);
    if (!Number.isFinite(minutes)) return '';
    if (minutes >= 17 * 60) return 'evening';
    if (minutes <= 16 * 60) return 'day';
    return '';
}

function prepackIconForShift(shift) {
    return shift === 'day' ? '☀' : (shift === 'evening' ? '☾' : '');
}

function labelShiftIconHtml(shift) {
    const icon = prepackIconForShift(shift);
    return icon ? `<span class="label-shift-icon">${escapeHtml(icon)}</span>` : '';
}

function prepackShiftChoiceHtml(current = 'all') {
    const selected = current || 'all';
    const choices = [
        { value: 'all', title: 'All times', detail: 'Keep every scheduled dose together' },
        { value: 'day', title: '☀ Daytime', detail: '12:00 AM through 4:00 PM' },
        { value: 'evening', title: '☾ Evening', detail: '5:00 PM through 11:59 PM' }
    ];
    return `<div class="prepack-choice-grid">
        ${choices.map(choice => `
            <label class="prepack-choice" for="prepack-shift-${choice.value}">
                <input id="prepack-shift-${choice.value}" type="radio" name="prepackShift" value="${choice.value}" ${selected === choice.value ? 'checked' : ''}>
                <strong>${escapeHtml(choice.title)}</strong>
                <span>${escapeHtml(choice.detail)}</span>
            </label>
        `).join('')}
    </div>`;
}

function filterRowsByPrepackShift(rows, shift) {
    if (!shift || shift === 'all') return rows;
    return rows.filter(row => prepackShiftForTime(row.instance?.time) === shift);
}

function buildPrepackDefinition(memberId, sourceLabel, rows, selection = null) {
    const member = db.family.find(item => item.id === memberId);
    const byDate = new Map();
    const addedScheduleIds = new Set(selection?.addedScheduleIds || []);
    rows.forEach(row => {
        if (!row?.instance?.date || !row.med || !row.schedule) return;
        if (!byDate.has(row.instance.date)) byDate.set(row.instance.date, []);
        byDate.get(row.instance.date).push({
            id: prepackItemId(),
            instanceKey: row.instance.key || scheduleInstanceKey(row.schedule.id, row.instance.date, row.instance.time),
            scheduleId: row.schedule.id,
            medId: row.med.id,
            medName: row.med.name,
            strength: formatLabelMedStrength(row.med),
            quantity: formatQtyForSchedule(row.schedule, row.med),
            dose: formatPrescribedDose(row.med, row.schedule.doseQty),
            time: row.instance.time,
            instructions: row.schedule.instructions || '',
            orderSetId: row.schedule.orderSetId || '',
            orderSetName: row.schedule.orderSetName || '',
            isPrepackAdded: row.schedule.prepackAdded === true || addedScheduleIds.has(row.schedule.id),
            barcodeCode: medicationCodes(row.med)[0] || '',
            status: 'pending',
            scannedCode: ''
        });
    });
    let days = Array.from(byDate.entries())
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([date, items]) => ({
            date,
            status: 'pending',
            needsReprint: false,
            items: items.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time) || a.medName.localeCompare(b.medName))
        }));
    if (selection?.singleMedication && selection.labelLayout === 'range' && rows.length > 0) {
        const firstRow = rows[0];
        const totalQuantity = rows.reduce((sum, row) => sum + parseAmount(row.schedule.doseQty, 0), 0);
        const aggregateItem = {
            id: prepackItemId(),
            instanceKey: `range|${firstRow.schedule.id}|${selection.startDate}|${selection.endDate}|${selection.specificTime || 'all'}`,
            scheduleId: firstRow.schedule.id,
            medId: firstRow.med.id,
            medName: firstRow.med.name,
            strength: formatLabelMedStrength(firstRow.med),
            quantity: formatQtyForSchedule({ ...firstRow.schedule, doseQty: totalQuantity }, firstRow.med),
            dose: formatPrescribedDose(firstRow.med, firstRow.schedule.doseQty),
            time: selection.startDate === selection.endDate
                ? selection.startDate
                : `${selection.startDate} - ${selection.endDate}`,
            instructions: firstRow.schedule.instructions || '',
            orderSetId: firstRow.schedule.orderSetId || '',
            orderSetName: firstRow.schedule.orderSetName || '',
            isPrepackAdded: firstRow.schedule.prepackAdded === true || addedScheduleIds.has(firstRow.schedule.id),
            barcodeCode: medicationCodes(firstRow.med)[0] || '',
            status: 'pending',
            scannedCode: ''
        };
        days = [{
            date: aggregateItem.time,
            status: 'pending',
            needsReprint: false,
            items: [aggregateItem]
        }];
    }
    return {
        memberId,
        memberName: memberDisplayName(member),
        sourceLabel,
        title: `${memberDisplayName(member)} | ${days[0]?.date || selection?.startDate || ''}${days.length > 1 ? ` - ${days[days.length - 1].date}` : (!days.length && selection?.endDate && selection.endDate !== selection.startDate ? ` - ${selection.endDate}` : '')}`,
        selection: selection || {
            kind: 'schedule-list',
            scheduleIds: Array.from(new Set(rows.map(row => row.schedule?.id).filter(Boolean))),
            startDate: days[0]?.date || '',
            endDate: days[days.length - 1]?.date || ''
        },
        days
    };
}

function prepackRowsForSelection(selection) {
    if (selection?.kind === 'inventory-unit-dose') return [];
    if (!selection?.startDate || !selection?.endDate) return [];
    let schedules = [];
    if (selection.kind === 'member-range') {
        const excluded = new Set(selection.excludedScheduleIds || []);
        schedules = db.schedules.filter(schedule =>
            schedule.memberId === selection.memberId && !excluded.has(schedule.id) && !isScheduleArchived(schedule)
        );
    } else {
        const scheduleIds = new Set(selection.scheduleIds || []);
        schedules = db.schedules.filter(schedule => scheduleIds.has(schedule.id) && !isScheduleArchived(schedule));
    }
    const excludedInstances = new Set(selection.excludedInstanceKeys || []);
    const rows = [];
    schedules.forEach(schedule => {
        const med = db.inventory.find(item => item.id === schedule.medId);
        if (!med) return;
        getScheduleInstancesInRange(schedule, selection.startDate, selection.endDate)
            .filter(instance => !selection.specificTime || instance.time === selection.specificTime)
            .filter(instance => !excludedInstances.has(instance.key))
            .forEach(instance => rows.push({ schedule, med, instance }));
    });
    return filterRowsByPrepackShift(rows, selection.prepackShift).sort((a, b) =>
        a.instance.date.localeCompare(b.instance.date) ||
        timeToMinutes(a.instance.time) - timeToMinutes(b.instance.time) ||
        a.med.name.localeCompare(b.med.name, undefined, { sensitivity: 'base' })
    );
}

function prepackItemFingerprint(item) {
    return [
        item.instanceKey,
        item.medId,
        item.strength,
        item.quantity,
        item.dose,
        item.time,
        item.instructions,
        item.isPrepackAdded ? 'added' : ''
    ].join('|');
}

function reconcilePrepackQueue(queue) {
    if (!queue?.selection) return false;
    if (isInventoryUnitDoseQueue(queue)) return false;
    if (queue.status === 'completed') return false;
    const rows = prepackRowsForSelection(queue.selection);
    const fresh = buildPrepackDefinition(queue.memberId, queue.sourceLabel, rows, queue.selection);
    const previousItems = new Map();
    queue.days.forEach(day => day.items.forEach(item => {
        if (item.instanceKey) previousItems.set(item.instanceKey, item);
    }));
    const previousDays = new Map(queue.days.map(day => [day.date, day]));
    let changed = false;
    fresh.days.forEach(day => {
        day.items.forEach(item => {
            const previous = previousItems.get(item.instanceKey);
            if (previous && prepackItemFingerprint(previous) === prepackItemFingerprint(item)) {
                item.id = previous.id;
                item.status = previous.status;
                item.scannedCode = previous.scannedCode;
                item.scannedAt = previous.scannedAt;
                item.verificationMethod = previous.verificationMethod;
            } else {
                changed = true;
            }
        });
        const previousDay = previousDays.get(day.date);
        const oldFingerprints = (previousDay?.items || []).map(prepackItemFingerprint).sort().join('||');
        const newFingerprints = day.items.map(prepackItemFingerprint).sort().join('||');
        const dayChanged = oldFingerprints !== newFingerprints;
        if (dayChanged) changed = true;
        day.needsReprint = queue.labelsPrinted
            ? (dayChanged || !!previousDay?.needsReprint)
            : false;
    });
    queue.days.forEach(day => {
        if (!fresh.days.some(candidate => candidate.date === day.date) && day.items.length > 0) changed = true;
    });
    queue.days = fresh.days;
    queue.memberName = fresh.memberName;
    queue.title = fresh.title;
    updatePrepackQueueStatus(queue);
    return changed;
}

function prepackSelectionFingerprint(selection) {
    if (!selection) return '';
    return JSON.stringify({
        kind: selection.kind || '',
        memberId: selection.memberId || '',
        scheduleIds: (selection.scheduleIds || []).slice().sort(),
        excludedScheduleIds: (selection.excludedScheduleIds || []).slice().sort(),
        excludedInstanceKeys: (selection.excludedInstanceKeys || []).slice().sort(),
        startDate: selection.startDate || '',
        endDate: selection.endDate || '',
        specificTime: selection.specificTime || '',
        labelLayout: selection.labelLayout || '',
        singleMedication: selection.singleMedication === true,
        prepackShift: selection.prepackShift || 'all',
        batchId: selection.batchId || '',
        medId: selection.medId || '',
        prepDate: selection.prepDate || '',
        prepTime: selection.prepTime || '',
        qtyPerContainer: selection.qtyPerContainer || '',
        containerCount: selection.containerCount || '',
        containerType: selection.containerType || '',
        expirationDate: selection.expirationDate || '',
        labelName: selection.labelName || ''
    });
}

function nextActivePrepackQueueId(excludedQueueId = '') {
    const next = (db.prepackQueues || []).find(queue => queue.id !== excludedQueueId && queue.status !== 'completed');
    return next?.id || null;
}

async function createPrepackQueue(definition, options = {}) {
    if (!definition.days?.some(day => day.items.length > 0)) return null;
    const fingerprint = prepackSelectionFingerprint(definition.selection);
    const existing = (db.prepackQueues || []).find(queue =>
        queue.status !== 'completed' &&
        prepackSelectionFingerprint(queue.selection) === fingerprint
    );
    if (existing) {
        existing.memberName = definition.memberName;
        existing.sourceLabel = definition.sourceLabel;
        existing.title = definition.title;
        existing.selection = definition.selection;
        existing.scheduledFor = options.scheduledFor || existing.scheduledFor || '';
        existing.labelsPrinted = existing.labelsPrinted || options.labelsPrinted === true;
        existing.days = definition.days;
        existing.currentDayIndex = 0;
        updatePrepackQueueStatus(existing);
        activePrepackQueueId = existing.id;
        await sync();
        return existing;
    }
    const queue = {
        id: `queue_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        memberId: definition.memberId,
        memberName: definition.memberName,
        sourceLabel: definition.sourceLabel,
        title: definition.title,
        selection: definition.selection,
        scheduledFor: options.scheduledFor || '',
        labelsPrinted: options.labelsPrinted === true,
        createdAt: new Date().toISOString(),
        lastPrintedAt: options.labelsPrinted ? new Date().toISOString() : '',
        currentDayIndex: 0,
        status: 'pending',
        completedAt: '',
        days: definition.days
    };
    db.prepackQueues.unshift(queue);
    activePrepackQueueId = queue.id;
    await sync();
    return queue;
}

async function commitPrepackPrint(definition) {
    if (definition.existingQueueId) {
        const queue = db.prepackQueues.find(item => item.id === definition.existingQueueId);
        if (!queue) return;
        const dates = new Set(definition.reprintedDates || []);
        queue.days.forEach(day => {
            if (dates.has(day.date)) day.needsReprint = false;
        });
        queue.labelsPrinted = true;
        queue.lastPrintedAt = new Date().toISOString();
        updatePrepackQueueStatus(queue);
        await sync();
        return;
    }
    await createPrepackQueue(definition, { labelsPrinted: true });
}

function updatePrepackQueueStatus(queue) {
    queue.days.forEach(day => {
        day.status = isPrepackDayComplete(day)
            ? 'completed'
            : 'pending';
    });
    const complete = queue.days.length > 0 && queue.days.every(day => day.status === 'completed');
    queue.status = complete ? 'completed' : 'pending';
    if (complete && !queue.completedAt) queue.completedAt = new Date().toISOString();
    if (!complete) queue.completedAt = '';
    if (complete) deductInventoryUnitDoseStock(queue);
}

function isPrepackDayComplete(day) {
    return !!day && day.items.length > 0 && day.items.every(item => item.status === 'correct');
}

function prepackStatusMark(item) {
    if (item.status === 'correct') return '<span class="prepack-mark">&#10003;</span>';
    if (item.status === 'wrong') return '<span class="prepack-mark">&#10007;</span>';
    return '<span class="prepack-mark">[ ]</span>';
}

function prepackScannerInputHtml(queueId) {
    const escapedId = escapeHtml(queueId);
    return `<input id="prepack-scan-input" type="text" autocomplete="off"
        oninput="schedulePrepackScan('${escapedId}')"
        onkeydown="if(event.key==='Enter'){event.preventDefault();scanPrepackCode('${escapedId}')}">`;
}

function prepackWorkspaceHtml(queue) {
    const inventoryUnitDose = isInventoryUnitDoseQueue(queue);
    const dayIndex = Math.max(0, Math.min(parseInt(queue.currentDayIndex, 10) || 0, queue.days.length - 1));
    queue.currentDayIndex = dayIndex;
    const day = queue.days[dayIndex];
    if (!day) {
        return `<div class="prepack-workspace-header">
            <div><strong>${escapeHtml(queue.memberName || queue.title)}</strong><br><small>${escapeHtml(queue.sourceLabel || '')}</small></div>
            <div>
                ${queue.selection?.singleMedication || inventoryUnitDose ? '' : `<button type="button" onclick="addProfileMedicationToPrepack('${escapeHtml(queue.id)}')">Add From Profile</button>
                <button type="button" onclick="addLastMinutePrepackItem('${escapeHtml(queue.id)}')">Add New Medication</button>`}
                <button type="button" onclick="deletePrepackQueue('${escapeHtml(queue.id)}')">Delete Queue</button>
            </div>
        </div><div class="empty-state">This queue has no medications to prepare.</div>`;
    }
    const nextItem = day.items.find(item => item.status !== 'correct');
    const itemRows = day.items.map(item => {
        const statusClass = item.status === 'correct'
            ? 'prepack-item-correct'
            : (item.status === 'wrong' ? 'prepack-item-wrong' : '');
        const addedClass = item.isPrepackAdded ? 'prepack-item-added' : '';
        const orderSetText = item.orderSetName ? ` | ${item.orderSetName}` : '';
        const removeButton = queue.selection?.singleMedication
            ? ''
            : `<button type="button" onclick="removePrepackItem('${escapeHtml(queue.id)}','${escapeHtml(day.date)}','${escapeHtml(item.id)}')">Remove</button>`;
        return `<div class="prepack-item ${statusClass} ${addedClass}">
            ${prepackStatusMark(item)}
            <div class="prepack-item-copy">
                <strong>${escapeHtml(item.time)} - ${escapeHtml(item.medName)} ${escapeHtml(item.strength || '')}</strong>${item.isPrepackAdded ? ' <span class="prepack-added-badge">Added</span>' : ''}<br>
                <small>Qty: ${escapeHtml(item.quantity)} | Dose: ${escapeHtml(item.dose)}${item.expirationDate ? ` | Exp: ${escapeHtml(item.expirationDate)}` : ''}${escapeHtml(orderSetText)}</small>
                ${item.status === 'wrong' ? `<div class="prepack-scan-error">Wrong scan: ${escapeHtml(item.scannedCode || 'Unknown code')}</div>` : ''}
            </div>
            ${removeButton}
        </div>`;
    }).join('');
    const dayButtons = queue.days.map((entry, index) => {
        const completed = entry.status === 'completed' || isPrepackDayComplete(entry);
        const classes = [
            'prepack-day-button',
            index === dayIndex ? 'active' : '',
            completed ? 'completed' : '',
            entry.needsReprint && !completed ? 'needs-reprint' : ''
        ].filter(Boolean).join(' ');
        const dayLabel = entry.date.includes(' - ') ? entry.date : entry.date.slice(5);
        return `<button type="button" class="${classes}" onclick="selectPrepackDay('${escapeHtml(queue.id)}',${index})">${escapeHtml(dayLabel)}${completed ? ' &#10003;' : ''}</button>`;
    }).join('');
    const scanner = queue.status === 'completed'
        ? '<div class="prepack-complete-banner">&#10003; Prepackage complete</div>'
        : `<div class="prepack-scanner">
            <label for="prepack-scan-input">Scan medication QR code:</label>
            ${prepackScannerInputHtml(queue.id)}
            <button type="button" onclick="markPrepackDayManual('${escapeHtml(queue.id)}')">Prepacked Manually</button>
            <span>${nextItem ? `Next: ${escapeHtml(nextItem.medName)} at ${escapeHtml(nextItem.time)}` : 'Day complete'}</span>
        </div>`;
    const scheduledText = queue.scheduledFor
        ? `Scheduled: ${queue.scheduledFor.replace('T', ' ')}`
        : 'Ready when needed';
    const printButtonText = queue.labelsPrinted ? 'Print Updated Labels' : 'Print Labels';
    const medicationActions = queue.selection?.singleMedication || inventoryUnitDose
        ? ''
        : `<button type="button" onclick="addProfileMedicationToPrepack('${escapeHtml(queue.id)}')">Add From Profile</button>
           <button type="button" onclick="addLastMinutePrepackItem('${escapeHtml(queue.id)}')">Add New Medication</button>`;
    const labelGroupButton = inventoryUnitDose
        ? ''
        : `<button type="button" onclick="editPrepackLabelGroup('${escapeHtml(queue.id)}')">Label Group</button>`;
    return `
        <div class="prepack-workspace-header">
            <div><strong>${escapeHtml(queue.memberName || queue.title)}</strong><br><small>${escapeHtml(queue.sourceLabel || '')} | ${escapeHtml(scheduledText)}</small></div>
            <div>
                ${medicationActions}
                ${labelGroupButton}
                <button type="button" onclick="editPrepackDateRange('${escapeHtml(queue.id)}')">Edit Date Range</button>
                <button type="button" onclick="printUpdatedPrepackLabels('${escapeHtml(queue.id)}')">${printButtonText}</button>
                <button type="button" onclick="deletePrepackQueue('${escapeHtml(queue.id)}')">Delete Queue</button>
            </div>
        </div>
        <div class="prepack-day-strip">${dayButtons}</div>
        ${day.needsReprint && !isPrepackDayComplete(day) ? '<div class="prepack-reprint-warning">Labels for this day need to be reprinted.</div>' : ''}
        ${scanner}
        <div class="prepack-items">${itemRows || '<div class="empty-state">No medications queued for this day.</div>'}</div>`;
}

window.renderPrepackageQueues = function() {
    const activeList = document.getElementById('prepack-active-list');
    const completedList = document.getElementById('prepack-completed-list');
    const workspace = document.getElementById('prepack-workspace');
    if (!activeList || !completedList || !workspace) return;
    if (!Array.isArray(db.prepackQueues)) db.prepackQueues = [];
    db.prepackQueues
        .filter(queue => queue.status !== 'completed')
        .forEach(queue => reconcilePrepackQueue(queue));

    const filter = document.getElementById('prepack-member-filter');
    const selectedFilter = filter?.value || '';
    if (filter) {
        filter.innerHTML = '<option value="">All members</option>' + db.family
            .slice()
            .sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b), undefined, { sensitivity: 'base' }))
            .map(member => `<option value="${escapeHtml(member.id)}">${escapeHtml(memberDisplayName(member))}</option>`)
            .join('');
        filter.value = db.family.some(member => member.id === selectedFilter) ? selectedFilter : '';
    }
    const completedFilter = document.getElementById('prepack-completed-member-filter');
    const selectedCompletedFilter = completedFilter?.value || '';
    if (completedFilter) {
        completedFilter.innerHTML = '<option value="">All members</option>' + db.family
            .slice()
            .sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b), undefined, { sensitivity: 'base' }))
            .map(member => `<option value="${escapeHtml(member.id)}">${escapeHtml(memberDisplayName(member))}</option>`)
            .join('');
        completedFilter.value = db.family.some(member => member.id === selectedCompletedFilter) ? selectedCompletedFilter : '';
    }
    const active = db.prepackQueues
        .filter(queue => !filter?.value || queue.memberId === filter.value)
        .filter(queue => queue.status !== 'completed')
        .sort((a, b) => String(a.scheduledFor || '9999').localeCompare(String(b.scheduledFor || '9999')));
    const completed = db.prepackQueues
        .filter(queue => !completedFilter?.value || queue.memberId === completedFilter.value)
        .filter(queue => queue.status === 'completed')
        .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
    const queueRow = (queue, complete = false) => `
        <button type="button" class="prepack-queue-row ${complete ? 'completed' : ''} ${queue.id === activePrepackQueueId ? 'selected' : ''}" onclick="selectPrepackQueue('${escapeHtml(queue.id)}')">
            <strong>${complete ? '&#10003; ' : ''}${escapeHtml(queue.title)}</strong><br>
            <small>${escapeHtml(queue.sourceLabel || '')}${queue.scheduledFor ? ` | ${escapeHtml(queue.scheduledFor.replace('T', ' '))}` : ''}${!queue.labelsPrinted ? ' | LABELS NOT PRINTED' : ''}${queue.days.some(day => day.needsReprint && !isPrepackDayComplete(day)) ? ' | LABELS NEED REPRINT' : ''}</small>
        </button>`;
    activeList.innerHTML = active.length
        ? active.map(queue => queueRow(queue)).join('')
        : '<div class="empty-state">No active prepack queues.</div>';
    completedList.innerHTML = completed.length
        ? completed.map(queue => queueRow(queue, true)).join('')
        : '<div class="empty-state">No completed prepackages.</div>';

    const selected = db.prepackQueues.find(queue => queue.id === activePrepackQueueId);
    workspace.innerHTML = selected
        ? prepackWorkspaceHtml(selected)
        : '<div class="empty-state">Select a prepack queue.</div>';
    setTimeout(() => document.getElementById('prepack-scan-input')?.focus(), 0);
};

window.selectPrepackQueue = function(queueId) {
    activePrepackQueueId = queueId;
    renderPrepackageQueues();
};

window.selectPrepackDay = function(queueId, dayIndex) {
    const queue = db.prepackQueues.find(item => item.id === queueId);
    if (!queue) return;
    activePrepackQueueId = queue.id;
    queue.currentDayIndex = dayIndex;
    renderPrepackageQueues();
};

window.schedulePrepackScan = function(queueId) {
    clearTimeout(prepackScanTimer);
    prepackScanTimer = setTimeout(() => {
        const input = document.getElementById('prepack-scan-input');
        const queue = db.prepackQueues.find(item => item.id === queueId);
        const day = queue?.days?.[queue.currentDayIndex || 0];
        const nextItem = day?.items.find(candidate => candidate.status !== 'correct');
        const med = nextItem && db.inventory.find(candidate => candidate.id === nextItem.medId);
        const expectedCodes = med ? medicationCodes(med) : [normalizeMedicationCode(nextItem?.barcodeCode)].filter(Boolean);
        const expectedLength = (expectedCodes[0] || '').length;
        const typedLength = normalizeMedicationCode(input?.value).length;
        if (typedLength >= Math.min(Math.max(expectedLength, 1), 4)) window.scanPrepackCode(queueId);
    }, 180);
};

window.scanPrepackCode = async function(queueId) {
    const queue = db.prepackQueues.find(item => item.id === queueId);
    const input = document.getElementById('prepack-scan-input');
    if (!queue || !input) return;
    const day = queue.days[queue.currentDayIndex || 0];
    const item = day?.items.find(candidate => candidate.status !== 'correct');
    if (!day || !item) return;
    const scannedCode = normalizeMedicationCode(input.value);
    if (!scannedCode) return;
    const med = db.inventory.find(candidate => candidate.id === item.medId);
    const expectedCodes = med ? medicationCodes(med) : [normalizeMedicationCode(item.barcodeCode)].filter(Boolean);
    item.scannedCode = scannedCode;
    item.scannedAt = new Date().toISOString();
    const correctScan = expectedCodes.includes(scannedCode);
    if (correctScan) {
        if (!applyInventoryUnitDoseItemStock(queue, item, 'scan')) {
            input.value = '';
            await appAlert(`${med?.name || item.medName} does not have enough stock to prepack ${item.time}.`);
            return;
        }
        item.status = 'correct';
        item.verificationMethod = 'scan';
    } else {
        item.status = 'wrong';
    }
    input.value = '';
    updatePrepackQueueStatus(queue);
    if (queue.status === 'completed') {
        activePrepackQueueId = nextActivePrepackQueueId(queue.id);
    } else if (day.status === 'completed') {
        const nextIndex = queue.days.findIndex((candidate, index) => index > queue.currentDayIndex && candidate.status !== 'completed');
        if (nextIndex >= 0) queue.currentDayIndex = nextIndex;
    }
    await sync();
};

window.createInventoryUnitDosePrepack = async function() {
    if (!db.inventory.length) {
        await appAlert('Add inventory items before creating an inventory unit-dose prepack.');
        return;
    }
    const inventory = sortByName(db.inventory, inventoryDisplayName);
    const medOptions = inventory.map(med =>
        `<option value="${escapeHtml(inventoryDisplayName(med))}">${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))} on hand</option>`
    ).join('');
    const defaults = defaultActualDateTime();
    const result = await showActionModal('Inventory Unit-Dose Prepack', `
        <div class="field-row-stacked">
            <label>Medication or supplement:</label>
            <input name="medSearch" list="unit-dose-inventory-options" placeholder="Search inventory..." style="width:100%;" oninput="updateInventoryUnitDosePrepackPreview()">
            <datalist id="unit-dose-inventory-options">${medOptions}</datalist>
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Amount in each container:</label><input name="qtyPerContainer" type="number" min="0.001" step="any" value="1" style="width:90px;" oninput="updateInventoryUnitDosePrepackPreview()">
            <label>Containers:</label><input name="containerCount" type="number" min="1" step="1" value="1" style="width:70px;" oninput="updateInventoryUnitDosePrepackPreview()">
            <label>Type:</label>
            <select name="containerType" style="width:150px;">
                <option value="prefilled syringe">Prefilled syringe</option>
                <option value="cup">Cup</option>
                <option value="bottle">Bottle</option>
                <option value="packet">Packet</option>
                <option value="capsule">Capsule</option>
                <option value="container">Container</option>
            </select>
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Prep date:</label><input name="prepDate" type="date" value="${escapeHtml(defaults.date)}" onchange="updateInventoryUnitDosePrepackPreview()">
            <label>Time:</label><input name="prepTime" type="time" value="${escapeHtml(defaults.time)}">
        </div>
        <fieldset style="margin-top:8px;">
            <legend>Prepared container expiration</legend>
            <div class="field-row">
                <label>Expiration:</label>
                <select name="expirationMode" onchange="updateInventoryUnitDosePrepackPreview()">
                    <option value="date">Calendar date</option>
                    <option value="days">X days after prep</option>
                </select>
                <span id="unit-dose-expiry-date-wrap" class="field-row" style="margin:0;">
                    <label>Date:</label><input name="expirationDate" type="date" onchange="updateInventoryUnitDosePrepackPreview()">
                </span>
                <span id="unit-dose-expiry-days-wrap" class="field-row" style="margin:0; display:none;">
                    <label>Days:</label><input name="expirationDays" type="number" min="0" step="1" placeholder="14" style="width:70px;" oninput="updateInventoryUnitDosePrepackPreview()">
                </span>
            </div>
        </fieldset>
        <div id="unit-dose-calculated-preview" class="unit-dose-preview">Select an inventory item to preview the calculated dose and stock needed.</div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Label name (optional):</label><input name="labelName" type="text" placeholder="Leave blank to use medication name">
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Instructions:</label><textarea name="instructions" rows="2" style="width:100%; resize:none;"></textarea>
        </div>
        <div class="form-help" style="margin-top:8px;">Use this for non-patient-specific prefilled syringes, cups, bottles, packets, or other unit-dose containers. Source stock is removed one container at a time when each item is scanned or manually marked prepacked.</div>
    `, 'Create Queue');
    if (!result) return;
    const query = String(result.medSearch || '').trim();
    const loweredQuery = query.toLowerCase();
    const partialMatches = inventory.filter(item => inventoryDisplayName(item).toLowerCase().includes(loweredQuery) || String(item.name || '').toLowerCase().includes(loweredQuery));
    const med = inventory.find(item => inventoryDisplayName(item) === query)
        || inventory.find(item => item.name.toLowerCase() === loweredQuery)
        || (partialMatches.length === 1 ? partialMatches[0] : null);
    const qtyPerContainer = parseAmount(result.qtyPerContainer, NaN);
    const containerCount = parseInt(result.containerCount, 10);
    const expirationDays = parseInt(result.expirationDays, 10);
    const expirationDate = result.expirationMode === 'days'
        ? (Number.isFinite(expirationDays) && expirationDays >= 0 ? addDaysKey(result.prepDate || defaults.date, expirationDays) : '')
        : (result.expirationDate || '');
    if (!med || !Number.isFinite(qtyPerContainer) || qtyPerContainer <= 0 || !Number.isFinite(containerCount) || containerCount <= 0) {
        await appAlert('Select an inventory item, amount in each container, and number of containers.');
        return;
    }
    if (!expirationDate) {
        await appAlert('Select a prepared container expiration date, or enter how many days after prep the container expires.');
        return;
    }
    const totalNeeded = qtyPerContainer * containerCount;
    if (parseAmount(med.stock, 0) < totalNeeded) {
        await appAlert(`${med.name} has ${formatAmount(parseAmount(med.stock))} ${inventoryUnitFor(med)} on hand, but this prepack needs ${formatAmount(totalNeeded)} ${med.administrationUnit || inventoryUnitFor(med)}.`);
        return;
    }
    if (medicationCodes(med).length === 0) {
        med.barcodeCode = createMedicationCode();
        med.barcodeCodes = [med.barcodeCode];
    }
    const definition = inventoryUnitDoseDefinition(med, {
        prepDate: result.prepDate || defaults.date,
        prepTime: result.prepTime || defaults.time,
        qtyPerContainer,
        containerCount,
        containerType: result.containerType || 'container',
        expirationDate,
        labelName: result.labelName || '',
        instructions: result.instructions || ''
    });
    await createPrepackQueue(definition, {
        scheduledFor: `${definition.selection.prepDate}T${definition.selection.prepTime || '08:00'}`
    });
    switchTab('prepackage');
};

window.editPrepackLabelGroup = async function(queueId) {
    const queue = db.prepackQueues.find(item => item.id === queueId);
    if (!queue?.selection) return;
    const currentShift = queue.selection.prepackShift || 'all';
    const result = await showActionModal('Prepack Label Group', `
        <div style="font-size:11px;">Separate this active prepack queue by medication administration time.</div>
        ${prepackShiftChoiceHtml(currentShift)}
        <div class="form-help">Changing the group updates the active queue and marks existing labels for reprint.</div>
    `, 'Apply');
    if (!result) return;
    const nextShift = result.prepackShift || 'all';
    if (nextShift === currentShift) return;
    const matchingRows = prepackRowsForSelection({ ...queue.selection, prepackShift: nextShift });
    if (matchingRows.length === 0) {
        await appAlert('No scheduled doses match that label group for this queue.');
        return;
    }
    queue.selection.prepackShift = nextShift;
    queue.currentDayIndex = 0;
    reconcilePrepackQueue(queue);
    if (queue.labelsPrinted) {
        queue.days.forEach(day => { day.needsReprint = true; });
    }
    activePrepackQueueId = queue.id;
    await sync();
};

window.editPrepackDateRange = async function(queueId) {
    const queue = db.prepackQueues.find(item => item.id === queueId);
    if (!queue?.selection) return;
    if (isInventoryUnitDoseQueue(queue)) {
        const currentDate = queue.selection.prepDate || queue.days[0]?.date || localDateKey();
        const currentTime = queue.selection.prepTime || (queue.scheduledFor || '').slice(11, 16) || '08:00';
        const result = await showActionModal('Edit Unit-Dose Prepack Date', `
            <div class="field-row">
                <label>Prep date:</label><input name="prepDate" type="date" value="${escapeHtml(currentDate)}">
                <label>Time:</label><input name="prepTime" type="time" value="${escapeHtml(currentTime)}">
            </div>
            <div class="form-help" style="margin-top:8px;">This changes when the inventory unit-dose prepack is prepared. The queued containers stay the same.</div>
        `, 'Save Date');
        if (!result) return;
        const nextDate = result.prepDate || currentDate;
        const nextTime = result.prepTime || currentTime;
        queue.selection.prepDate = nextDate;
        queue.selection.prepTime = nextTime;
        queue.selection.startDate = nextDate;
        queue.selection.endDate = nextDate;
        queue.scheduledFor = `${nextDate}T${nextTime}`;
        queue.days.forEach(day => {
            day.date = nextDate;
            if (queue.labelsPrinted) day.needsReprint = true;
        });
        activePrepackQueueId = queue.id;
        await sync();
        return;
    }
    const currentStart = queue.selection.startDate || queue.days[0]?.date || localDateKey();
    const currentEnd = queue.selection.endDate || queue.days[queue.days.length - 1]?.date || currentStart;
    const result = await showActionModal('Edit Prepack Date Range', `
        <div class="field-row">
            <label>From:</label><input name="startDate" type="date" value="${escapeHtml(currentStart)}">
            <label>To:</label><input name="endDate" type="date" value="${escapeHtml(currentEnd)}">
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Prepack date:</label><input name="prepackDate" type="date" value="${escapeHtml((queue.scheduledFor || '').slice(0, 10))}">
            <label>Time:</label><input name="prepackTime" type="time" value="${escapeHtml((queue.scheduledFor || '').slice(11, 16))}">
        </div>
        <div class="form-help" style="margin-top:8px;">Labels will be marked for reprint if the updated range changes the queued doses.</div>
    `, 'Save Range');
    if (!result) return;
    if (!result.startDate || !result.endDate || result.endDate < result.startDate) {
        await appAlert('Enter a valid prepack date range.');
        return;
    }
    queue.selection.startDate = result.startDate;
    queue.selection.endDate = result.endDate;
    queue.scheduledFor = result.prepackDate
        ? `${result.prepackDate}T${result.prepackTime || '08:00'}`
        : '';
    queue.currentDayIndex = 0;
    reconcilePrepackQueue(queue);
    activePrepackQueueId = queue.id;
    await sync();
};

window.markPrepackDayManual = async function(queueId) {
    const queue = db.prepackQueues.find(item => item.id === queueId);
    const day = queue?.days[queue.currentDayIndex || 0];
    if (!queue || !day) return;
    if (!await appConfirm(`Confirm that every medication for ${day.date} was prepacked manually?`, 'Prepacked Manually')) return;
    if (isInventoryUnitDoseQueue(queue)) {
        const sourceMed = db.inventory.find(candidate => candidate.id === queue.selection.medId);
        const pendingCount = day.items.filter(item => item.status !== 'correct' || item.inventoryDeducted !== true).length;
        const required = parseAmount(queue.selection.qtyPerContainer, 0) * pendingCount;
        if (!sourceMed || parseAmount(sourceMed.stock, 0) < required) {
            await appAlert(`${sourceMed?.name || 'The source inventory item'} does not have enough stock to manually prepack the remaining ${pendingCount} item${pendingCount === 1 ? '' : 's'}.`);
            return;
        }
    }
    for (const item of day.items) {
        if (isInventoryUnitDoseQueue(queue) && !applyInventoryUnitDoseItemStock(queue, item, 'manual')) {
            await appAlert(`${item.medName} does not have enough stock to prepack ${item.time}.`);
            return;
        }
        item.status = 'correct';
        item.scannedCode = '';
        item.scannedAt = new Date().toISOString();
        item.verificationMethod = 'manual';
    }
    day.needsReprint = false;
    updatePrepackQueueStatus(queue);
    if (queue.status === 'completed') {
        activePrepackQueueId = nextActivePrepackQueueId(queue.id);
    } else {
        const nextIndex = queue.days.findIndex((candidate, index) => index > queue.currentDayIndex && candidate.status !== 'completed');
        if (nextIndex >= 0) queue.currentDayIndex = nextIndex;
    }
    await sync();
};

window.removePrepackItem = async function(queueId, date, itemId) {
    const queue = db.prepackQueues.find(item => item.id === queueId);
    const day = queue?.days.find(item => item.date === date);
    const item = day?.items.find(candidate => candidate.id === itemId);
    if (!queue || !day || !item) return;
    const schedule = db.schedules.find(candidate => candidate.id === item.scheduleId);
    if (!schedule || !queue.selection) {
        if (!await appConfirm(`Remove ${item.medName} from this prepack only?`, 'Change Prepack')) return;
        reverseInventoryUnitDoseItemStock(queue, item);
        day.items = day.items.filter(candidate => candidate.id !== itemId);
        day.needsReprint = queue.labelsPrinted;
        updatePrepackQueueStatus(queue);
        activePrepackQueueId = queue.id;
        await sync();
        return;
    }

    const discontinueOption = schedule.prepackAdded
        ? `<div class="prepack-remove-option prepack-remove-danger">
            <input id="prepack-remove-order" name="removeAction" type="radio" value="discontinue-order">
            <label for="prepack-remove-order">Discontinue this new medication and remove it from the member profile.</label>
        </div>`
        : '';
    const result = await showActionModal(`Remove From Prepack: ${item.medName}`, `
        <div class="prepack-remove-option">
            <input id="prepack-remove-dose" name="removeAction" type="radio" value="prepack-dose" checked>
            <label for="prepack-remove-dose">Remove only this ${escapeHtml(date)} dose from the prepack. Keep the member order unchanged.</label>
        </div>
        <div class="prepack-remove-option">
            <input id="prepack-remove-all" name="removeAction" type="radio" value="prepack-all">
            <label for="prepack-remove-all">Remove this medication from every date in this prepack. Keep the member order unchanged.</label>
        </div>
        ${discontinueOption}
    `, 'Continue');
    if (!result?.removeAction) return;

    if (result.removeAction === 'discontinue-order' && schedule.prepackAdded) {
        db.schedules = db.schedules.filter(candidate => candidate.id !== schedule.id);
        if (queue.selection.kind === 'schedule-list') {
            queue.selection.scheduleIds = (queue.selection.scheduleIds || []).filter(id => id !== schedule.id);
        }
        queue.selection.addedScheduleIds = (queue.selection.addedScheduleIds || []).filter(id => id !== schedule.id);
    } else if (result.removeAction === 'prepack-all') {
        if (queue.selection.kind === 'member-range') {
            queue.selection.excludedScheduleIds = Array.from(new Set([
                ...(queue.selection.excludedScheduleIds || []),
                schedule.id
            ]));
        } else {
            queue.selection.scheduleIds = (queue.selection.scheduleIds || []).filter(id => id !== schedule.id);
        }
        queue.selection.addedScheduleIds = (queue.selection.addedScheduleIds || []).filter(id => id !== schedule.id);
    } else if (item.instanceKey) {
        queue.selection.excludedInstanceKeys = Array.from(new Set([
            ...(queue.selection.excludedInstanceKeys || []),
            item.instanceKey
        ]));
    }
    reconcilePrepackQueue(queue);
    activePrepackQueueId = queue.id;
    await sync();
};

window.updatePrepackAddMedication = function() {
    const body = document.getElementById('action-modal-body');
    const search = body?.querySelector('[name="medSearch"]');
    const select = body?.querySelector('[name="medId"]');
    if (!search || !select) return;
    const query = search.value.trim().toLowerCase();
    const matches = db.inventory
        .filter(med => query && med.name.toLowerCase() === query)
        .sort((a, b) => formatMedStrength(a).localeCompare(formatMedStrength(b), undefined, { numeric: true, sensitivity: 'base' }));
    const previous = select.value;
    select.innerHTML = matches.map(med =>
        `<option value="${escapeHtml(med.id)}">${escapeHtml(formatMedStrength(med))}</option>`
    ).join('') || '<option value="">Select a medication first</option>';
    select.disabled = matches.length === 0;
    if (matches.some(med => med.id === previous)) select.value = previous;
    window.calculatePrepackAddDose();
};

window.calculatePrepackAddDose = function() {
    const body = document.getElementById('action-modal-body');
    const medId = body?.querySelector('[name="medId"]')?.value;
    const doseQty = parseAmount(body?.querySelector('[name="doseQty"]')?.value, 0);
    const calculated = body?.querySelector('[name="calculatedDose"]');
    const unit = body?.querySelector('#prepack-add-qty-unit');
    const med = db.inventory.find(item => item.id === medId);
    if (calculated) calculated.value = med ? formatPrescribedDose(med, doseQty) : '';
    if (unit) unit.textContent = med ? (med.administrationUnit || med.formulation || 'units') : '';
};

window.renderPrepackAddTimes = function() {
    const body = document.getElementById('action-modal-body');
    const freq = body?.querySelector('[name="freq"]')?.value || 'QD';
    const container = body?.querySelector('#prepack-add-times');
    if (!container) return;
    const previous = Array.from(container.querySelectorAll('[name="prepackTimes"]')).map(input => input.value);
    const count = getExpectedTimeCount(freq) || 1;
    container.innerHTML = Array.from({ length: count }, (_, index) => `
        <div class="field-row">
            <label>Dose ${index + 1}:</label>
            <input name="prepackTimes" type="time" value="${escapeHtml(previous[index] || defaultTimeForIndex(index, freq))}">
        </div>`).join('');
};

window.toggleAllPrepackAddDates = function(checked) {
    document.querySelectorAll('#action-modal-body input[name="prepackDates"]').forEach(input => {
        input.checked = checked;
    });
};

window.addProfileMedicationToPrepack = async function(queueId) {
    const queue = db.prepackQueues.find(item => item.id === queueId);
    if (!queue || queue.selection?.singleMedication) return;
    const represented = new Set(queue.days.flatMap(day => day.items.map(item => item.scheduleId)));
    const candidates = db.schedules
        .filter(schedule =>
            schedule.memberId === queue.memberId &&
            !isScheduleArchived(schedule) &&
            !represented.has(schedule.id) &&
            getScheduleInstancesInRange(schedule, queue.selection?.startDate, queue.selection?.endDate).length > 0
        )
        .sort((a, b) => {
            const first = db.inventory.find(item => item.id === a.medId)?.name || '';
            const second = db.inventory.find(item => item.id === b.medId)?.name || '';
            return first.localeCompare(second, undefined, { sensitivity: 'base' });
        });
    if (candidates.length === 0) {
        await appAlert('Every eligible medication from this member profile is already included in the prepack.');
        return;
    }
    const choices = candidates.map((schedule, index) => {
        const med = db.inventory.find(item => item.id === schedule.medId);
        const inputId = `prepack-profile-med-${index}`;
        return `<div class="label-selection-item">
            <input id="${inputId}" name="scheduleIds" type="checkbox" value="${escapeHtml(schedule.id)}">
            <label for="${inputId}">${escapeHtml(med?.name || 'Unknown medication')} ${escapeHtml(med ? formatMedStrength(med) : '')} - ${escapeHtml(formatFrequency(schedule))}</label>
        </div>`;
    }).join('');
    const result = await showActionModal('Add Medication From Member Profile', `
        <div class="sunken-panel label-selection-list">${choices}</div>
    `, 'Add Selected');
    if (!result) return;
    const selectedIds = result.scheduleIds || [];
    if (selectedIds.length === 0) {
        await appAlert('Select at least one medication.');
        return;
    }
    if (queue.selection?.kind === 'member-range') {
        const selected = new Set(selectedIds);
        queue.selection.excludedScheduleIds = (queue.selection.excludedScheduleIds || [])
            .filter(id => !selected.has(id));
    } else {
        queue.selection.scheduleIds = Array.from(new Set([...(queue.selection.scheduleIds || []), ...selectedIds]));
    }
    queue.selection.addedScheduleIds = Array.from(new Set([...(queue.selection.addedScheduleIds || []), ...selectedIds]));
    reconcilePrepackQueue(queue);
    activePrepackQueueId = queue.id;
    await sync();
};

window.addLastMinutePrepackItem = async function(queueId) {
    const queue = db.prepackQueues.find(item => item.id === queueId);
    if (!queue || db.inventory.length === 0) return;
    const selectableDates = dateKeysInRange(queue.selection?.startDate, queue.selection?.endDate);
    const dateChoices = (selectableDates.length ? selectableDates : queue.days.map(day => day.date)).map((date, index) => {
        const inputId = `prepack-add-date-${index}`;
        return `<span class="weekday-option"><input id="${inputId}" name="prepackDates" type="checkbox" value="${escapeHtml(date)}"><label for="${inputId}">${escapeHtml(date)}</label></span>`;
    }).join('');
    const inventory = db.inventory
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const medNames = Array.from(new Set(inventory.map(med => med.name)))
        .map(name => `<option value="${escapeHtml(name)}"></option>`)
        .join('');
    const actionWindow = ensureActionModal().querySelector('.window');
    if (actionWindow) actionWindow.style.width = 'min(720px, calc(100vw - 20px))';
    const result = await showActionModal('Add Medication to Prepack and Member Profile', `
        <div class="field-row">
            <label>Medication:</label>
            <input name="medSearch" list="prepack-med-options" value="" placeholder="Search medication..." style="width:190px;" oninput="updatePrepackAddMedication()">
            <datalist id="prepack-med-options">${medNames}</datalist>
            <label>Strength:</label>
            <select name="medId" style="width:150px;" onchange="calculatePrepackAddDose()" disabled><option value="">Select a medication first</option></select>
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Quantity:</label><input name="doseQty" type="number" min="0.01" step="any" value="1" style="width:70px;" oninput="calculatePrepackAddDose()">
            <span id="prepack-add-qty-unit"></span>
            <label>Calculated dose:</label><input name="calculatedDose" type="text" value="" disabled style="width:150px;">
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Frequency:</label>
            <select name="freq" onchange="renderPrepackAddTimes()">
                <option value="QD">Once per selected date</option>
                <option value="BID">Twice per selected date</option>
                <option value="TID">Three times per selected date</option>
                <option value="QID">Four times per selected date</option>
                <option value="Nightly">Nightly on selected dates</option>
            </select>
            <label>Prescriber:</label>
            <select name="prescriberId" style="width:180px;">${prescriberOptionsHtml('', queue.memberId, false)}</select>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;"><label>Administration time(s):</label><div id="prepack-add-times">
            <div class="field-row"><label>Dose 1:</label><input name="prepackTimes" type="time" value="08:00"></div>
        </div></div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <div class="field-row"><label>Affected date(s):</label><button type="button" onclick="toggleAllPrepackAddDates(true)">Select All</button><button type="button" onclick="toggleAllPrepackAddDates(false)">Clear</button></div>
            <div class="prepack-date-choices">${dateChoices}</div>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;"><label>Instructions:</label><textarea name="instructions" rows="2" style="width:100%; resize:none;"></textarea></div>
    `, 'Add Medication');
    if (actionWindow) actionWindow.style.width = '420px';
    if (!result) return;
    const med = db.inventory.find(item => item.id === result.medId);
    const dates = (result.prepackDates || []).slice().sort();
    const doseQty = parseAmount(result.doseQty, NaN);
    const submittedTimes = Array.isArray(result.prepackTimes)
        ? result.prepackTimes
        : [result.prepackTimes].filter(Boolean);
    const times = Array.from(new Set(submittedTimes)).filter(Boolean).sort();
    const expectedTimes = getExpectedTimeCount(result.freq);
    if (!med || dates.length === 0 || !Number.isFinite(doseQty) || doseQty <= 0 || times.length !== expectedTimes) {
        await appAlert(`Select a medication, one or more dates, a quantity, and ${expectedTimes} administration time${expectedTimes === 1 ? '' : 's'}. Times may match other medications.`);
        return;
    }
    const schedule = {
        id: `prepack_schedule_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        memberId: queue.memberId,
        medId: med.id,
        doseQty: String(doseQty),
        prescriberId: result.prescriberId || med.prescriberId || '',
        freq: result.freq,
        startDate: dates[0],
        endDate: dates[dates.length - 1],
        includedDates: dates,
        excludedInstances: [],
        times,
        instructions: result.instructions || '',
        prepackAdded: true,
        isOneTime: false
    };
    db.schedules.push(schedule);
    if (queue.selection?.kind === 'schedule-list') {
        queue.selection.scheduleIds = Array.from(new Set([...(queue.selection.scheduleIds || []), schedule.id]));
    } else if (!queue.selection) {
        queue.selection = {
            kind: 'schedule-list',
            scheduleIds: [schedule.id],
            startDate: dates[0],
            endDate: dates[dates.length - 1]
        };
    }
    reconcilePrepackQueue(queue);
    queue.currentDayIndex = Math.max(queue.days.findIndex(day => dates.includes(day.date)), 0);
    activePrepackQueueId = queue.id;
    await sync();
};

function prepackDayLabelHtml(queue, day) {
    const labelClass = getLabelClass(
        day.items.map(item => `${item.time} ${item.medName} ${item.dose || item.strength} ${item.quantity}`),
        day.items.length + 1
    );
    const rows = day.items.length
        ? day.items.map(item => `<div class="label-med-row"><b>${escapeHtml(item.time)}</b>: ${escapeHtml(item.medName)} ${escapeHtml(item.dose || item.strength || '')} (${escapeHtml(item.quantity)})</div>`).join('')
        : '<div class="label-med-row">No medications in this prepack</div>';
    return `<div class="${labelClass}">
        <div class="label-date label-date-with-icon">${escapeHtml(day.date)} - ${escapeHtml(queue.memberName || '')}${labelShiftIconHtml(queue.selection?.prepackShift)}</div>
        ${rows}
    </div>`;
}

window.printUpdatedPrepackLabels = async function(queueId) {
    const queue = db.prepackQueues.find(item => item.id === queueId);
    if (!queue) return;
    if (!isInventoryUnitDoseQueue(queue)) reconcilePrepackQueue(queue);
    const days = queue.labelsPrinted
        ? queue.days.filter(day => day.needsReprint)
        : queue.days;
    if (days.length === 0) {
        await appAlert('No prepack days currently require updated labels.');
        return;
    }
    let labelHtml = isInventoryUnitDoseQueue(queue)
        ? days.flatMap(day => day.items.map((item, index) => inventoryUnitDoseLabelHtml(queue, item, index))).join('')
        : days.map(day => prepackDayLabelHtml(queue, day)).join('');
    if (queue.selection?.singleMedication) {
        const schedule = db.schedules.find(item => item.id === queue.selection.scheduleIds?.[0]);
        const med = schedule && db.inventory.find(item => item.id === schedule.medId);
        const member = db.family.find(item => item.id === queue.memberId);
        let instances = prepackRowsForSelection(queue.selection).map(row => row.instance);
        if (queue.selection.labelLayout !== 'range') {
            const dayDates = new Set(days.map(day => day.date));
            instances = instances.filter(instance => dayDates.has(instance.date));
        }
        if (schedule && med && member && instances.length > 0 && queue.selection.labelLayout === 'range') {
            labelHtml = medicationRangeLabelHtml(
                schedule,
                med,
                member,
                queue.selection.startDate,
                queue.selection.endDate,
                instances,
                queue.selection.prepackShift || 'all'
            );
        } else if (schedule && med && member && instances.length > 0) {
            const byDate = instances.reduce((acc, instance) => {
                if (!acc[instance.date]) acc[instance.date] = [];
                acc[instance.date].push(instance.time);
                return acc;
            }, {});
            labelHtml = Object.entries(byDate).map(([date, times]) =>
                medicationLabelHtml(schedule, med, member, date, times.slice().sort((a, b) => timeToMinutes(a) - timeToMinutes(b)), queue.selection.prepackShift || 'all')
            ).join('');
        }
    }
    previewLabelHtml(
        labelHtml,
        { existingQueueId: queue.id, reprintedDates: days.map(day => day.date) }
    );
};

window.deletePrepackQueue = async function(queueId) {
    if (!await appConfirm('Delete this prepack queue?', 'Delete Prepack Queue')) return;
    db.prepackQueues = db.prepackQueues.filter(item => item.id !== queueId);
    if (activePrepackQueueId === queueId) activePrepackQueueId = null;
    await sync();
};

// --- VITALS ---
function monitoringProfileById(member, monitoringId) {
    return memberMonitoringProfiles(member).find(profile => profile.id === monitoringId);
}

function monitoringDetailsForReading(reading, member) {
    const profile = monitoringProfileById(member, reading?.monitoringId);
    return profile || {
        id: reading?.monitoringId || '',
        medicationName: reading?.medicationName || 'Medication',
        labName: reading?.monitorName || 'Therapeutic Level',
        unit: reading?.monitorUnit || 'value',
        goalLow: reading?.goalLow,
        goalHigh: reading?.goalHigh,
        medId: reading?.medId || ''
    };
}

function vitalTypeLabel(type, reading = null, member = null) {
    if (type === 'med-monitor') {
        const profile = monitoringDetailsForReading(reading, member);
        return `${profile.labName} - ${profile.medicationName}`;
    }
    return { bp: 'BP / HR', weight: 'Weight', glucose: 'Blood Glucose', temperature: 'Temperature' }[type] || type;
}

function formatVitalReading(reading) {
    if (reading.type === 'bp') {
        const hrText = reading.hr ? `, HR ${reading.hr}` : '';
        return `${reading.systolic}/${reading.diastolic} mmHg${hrText}`;
    }
    if (reading.type === 'weight') return `${reading.weight} ${reading.weightUnit || 'lb'}`;
    if (reading.type === 'glucose') return `${reading.glucose} mg/dL`;
    if (reading.type === 'temperature') return `${reading.temperature} ${reading.temperatureUnit || 'F'}`;
    if (reading.type === 'med-monitor') {
        const member = db.family.find(item => item.id === reading.memberId);
        const profile = monitoringDetailsForReading(reading, member);
        return `${formatAmount(parseAmount(reading.monitorValue))} ${profile.unit || 'value'}`;
    }
    return '';
}

function isVitalOutOfRange(reading, member) {
    const goals = getMemberGoals(member);
    if (reading.type === 'glucose') {
        const value = parseAmount(reading.glucose, NaN);
        return Number.isFinite(value) && (value < goals.glucose.low || value > goals.glucose.high);
    }
    if (reading.type === 'bp') {
        const sys = parseAmount(reading.systolic, NaN);
        const dia = parseAmount(reading.diastolic, NaN);
        const hr = parseAmount(reading.hr, NaN);
        return (Number.isFinite(sys) && (sys < goals.bp.systolicLow || sys > goals.bp.systolicHigh)) ||
            (Number.isFinite(dia) && (dia < goals.bp.diastolicLow || dia > goals.bp.diastolicHigh)) ||
            (Number.isFinite(hr) && (hr < goals.hr.low || hr > goals.hr.high));
    }
    if (reading.type === 'weight') {
        const value = readingSeriesValue(reading, 'weight');
        const low = goals.weight.unit === 'kg' && Number.isFinite(parseAmount(goals.weight.low, NaN))
            ? parseAmount(goals.weight.low) * 2.20462
            : parseAmount(goals.weight.low, NaN);
        const high = goals.weight.unit === 'kg' && Number.isFinite(parseAmount(goals.weight.high, NaN))
            ? parseAmount(goals.weight.high) * 2.20462
            : parseAmount(goals.weight.high, NaN);
        return Number.isFinite(value) && Number.isFinite(low) && Number.isFinite(high) && (value < low || value > high);
    }
    if (reading.type === 'med-monitor') {
        const profile = monitoringDetailsForReading(reading, member);
        const value = parseAmount(reading.monitorValue, NaN);
        const low = parseAmount(profile.goalLow, NaN);
        const high = parseAmount(profile.goalHigh, NaN);
        return Number.isFinite(value) && Number.isFinite(low) && Number.isFinite(high) && (value < low || value > high);
    }
    return false;
}

window.renderVitalTypeOptions = function() {
    const select = document.getElementById('vital-type');
    if (!select) return;
    const selected = select.value;
    const member = db.family.find(item => item.id === document.getElementById('vital-member-select')?.value);
    const standardOptions = [
        ['bp', 'BP / Heart Rate'],
        ['weight', 'Weight'],
        ['glucose', 'Blood Glucose'],
        ['temperature', 'Temperature']
    ].map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    const monitoringOptions = memberMonitoringProfiles(member)
        .map(profile => `<option value="monitor:${escapeHtml(profile.id)}">${escapeHtml(profile.labName)} - ${escapeHtml(profile.medicationName)}</option>`)
        .join('');
    select.innerHTML = `${standardOptions}${monitoringOptions ? `<optgroup label="Medication / Lab Monitoring">${monitoringOptions}</optgroup>` : ''}`;
    if (Array.from(select.options).some(option => option.value === selected)) select.value = selected;
    else select.value = 'bp';
    renderVitalInputs();
};

window.renderVitalInputs = function() {
    const type = document.getElementById('vital-type')?.value || 'bp';
    const container = document.getElementById('vital-input-fields');
    if (!container) return;

    if (type.startsWith('monitor:')) {
        const member = db.family.find(item => item.id === document.getElementById('vital-member-select')?.value);
        const profile = monitoringProfileById(member, type.slice('monitor:'.length));
        container.innerHTML = profile
            ? `<label>${escapeHtml(profile.labName)}:</label><input id="vital-monitor-value" type="number" step="any" style="width:90px;">
                <span>${escapeHtml(profile.unit || 'value')}</span>
                <span class="form-help">Goal: ${escapeHtml(formatAmount(parseAmount(profile.goalLow)))}-${escapeHtml(formatAmount(parseAmount(profile.goalHigh)))} ${escapeHtml(profile.unit || 'value')}</span>`
            : '<span class="form-help">Select a valid medication monitoring profile.</span>';
    } else if (type === 'bp') {
        container.innerHTML = `
            <label>Systolic:</label><input id="vital-systolic" type="number" style="width:60px;">
            <label>Diastolic:</label><input id="vital-diastolic" type="number" style="width:60px;">
            <label>Heart Rate:</label><input id="vital-hr" type="number" style="width:60px;">
        `;
    } else if (type === 'weight') {
        container.innerHTML = `<label>Weight:</label><input id="vital-weight" type="number" step="0.1" style="width:80px;">
            <select id="vital-weight-unit"><option value="lb">lb</option><option value="kg">kg</option></select>`;
    } else {
        container.innerHTML = type === 'temperature'
            ? `<label>Temperature:</label><input id="vital-temperature" type="number" step="0.1" style="width:80px;">
                <select id="vital-temperature-unit"><option value="F">Fahrenheit (F)</option><option value="C">Celsius (C)</option></select>`
            : `<label>Blood Glucose:</label><input id="vital-glucose" type="number" style="width:80px;"> <span>mg/dL</span>`;
    }
};

window.saveVitalReading = async function() {
    const memberId = document.getElementById('vital-member-select').value;
    const selectedType = document.getElementById('vital-type').value;
    const date = document.getElementById('vital-date').value;
    const time = document.getElementById('vital-time').value;
    const notes = document.getElementById('vital-notes')?.value.trim() || '';
    if (!memberId || !date || !time) return alert("Member, date, and time are required.");

    const reading = { id: Date.now().toString(), memberId, type: selectedType, date, time, notes };
    if (selectedType.startsWith('monitor:')) {
        const member = db.family.find(item => item.id === memberId);
        const monitoringId = selectedType.slice('monitor:'.length);
        const profile = monitoringProfileById(member, monitoringId);
        const monitorValue = parseAmount(document.getElementById('vital-monitor-value')?.value, NaN);
        if (!profile || !Number.isFinite(monitorValue)) return alert("A valid monitored lab or level value is required.");
        reading.type = 'med-monitor';
        reading.monitoringId = profile.id;
        reading.monitorValue = monitorValue;
        reading.monitorName = profile.labName;
        reading.medicationName = profile.medicationName;
        reading.monitorUnit = profile.unit;
        reading.goalLow = profile.goalLow;
        reading.goalHigh = profile.goalHigh;
        reading.medId = profile.medId || '';
    } else if (selectedType === 'bp') {
        reading.systolic = parseAmount(document.getElementById('vital-systolic').value, NaN);
        reading.diastolic = parseAmount(document.getElementById('vital-diastolic').value, NaN);
        reading.hr = parseAmount(document.getElementById('vital-hr').value, NaN);
        if (isNaN(reading.systolic) || isNaN(reading.diastolic)) return alert("Systolic and diastolic BP are required.");
        if (isNaN(reading.hr)) reading.hr = '';
    } else if (selectedType === 'weight') {
        reading.weight = parseAmount(document.getElementById('vital-weight').value, NaN);
        reading.weightUnit = document.getElementById('vital-weight-unit').value;
        if (isNaN(reading.weight)) return alert("Weight is required.");
    } else if (selectedType === 'temperature') {
        reading.temperature = parseAmount(document.getElementById('vital-temperature').value, NaN);
        reading.temperatureUnit = document.getElementById('vital-temperature-unit').value;
        if (isNaN(reading.temperature)) return alert("Temperature is required.");
    } else {
        reading.glucose = parseAmount(document.getElementById('vital-glucose').value, NaN);
        if (isNaN(reading.glucose)) return alert("Blood glucose is required.");
    }

    db.vitals.unshift(reading);
    await sync();
    const notesInput = document.getElementById('vital-notes');
    if (notesInput) notesInput.value = '';
    renderVitalInputs();
};

window.deleteVitalReading = async function(id) {
    if (!await appConfirm("Delete this vital reading?", 'Delete Vital Reading')) return;
    db.vitals = db.vitals.filter(v => v.id !== id);
    await sync();
};

function readingSeriesValue(reading, seriesKey) {
    if (seriesKey === 'systolic') return parseAmount(reading.systolic, NaN);
    if (seriesKey === 'diastolic') return parseAmount(reading.diastolic, NaN);
    if (seriesKey === 'hr') return parseAmount(reading.hr, NaN);
    if (seriesKey === 'weight') {
        const weight = parseAmount(reading.weight, NaN);
        return reading.weightUnit === 'kg' ? weight * 2.20462 : weight;
    }
    if (seriesKey === 'glucose') return parseAmount(reading.glucose, NaN);
    if (seriesKey === 'temperature') {
        const temperature = parseAmount(reading.temperature, NaN);
        return reading.temperatureUnit === 'C' ? (temperature * 9 / 5) + 32 : temperature;
    }
    if (seriesKey === 'monitorValue') return parseAmount(reading.monitorValue, NaN);
    return NaN;
}

function isChartPointOutOfRange(type, key, value, member, options = {}) {
    const goals = getMemberGoals(member);
    if (type === 'glucose' && key === 'glucose') {
        return value < goals.glucose.low || value > goals.glucose.high;
    }
    if (type === 'bp' && key === 'systolic') {
        return value < goals.bp.systolicLow || value > goals.bp.systolicHigh;
    }
    if (type === 'bp' && key === 'diastolic') {
        return value < goals.bp.diastolicLow || value > goals.bp.diastolicHigh;
    }
    if (type === 'bp' && key === 'hr') {
        return value < goals.hr.low || value > goals.hr.high;
    }
    if (type === 'weight' && key === 'weight') {
        const low = goals.weight.unit === 'kg' && Number.isFinite(parseAmount(goals.weight.low, NaN))
            ? parseAmount(goals.weight.low) * 2.20462
            : parseAmount(goals.weight.low, NaN);
        const high = goals.weight.unit === 'kg' && Number.isFinite(parseAmount(goals.weight.high, NaN))
            ? parseAmount(goals.weight.high) * 2.20462
            : parseAmount(goals.weight.high, NaN);
        return Number.isFinite(low) && Number.isFinite(high) && (value < low || value > high);
    }
    if (type === 'med-monitor' && key === 'monitorValue') {
        const low = parseAmount(options.goalLow, NaN);
        const high = parseAmount(options.goalHigh, NaN);
        return Number.isFinite(low) && Number.isFinite(high) && (value < low || value > high);
    }
    return false;
}

function readingDateTime(reading) {
    const value = new Date(`${reading.date}T${reading.time || '00:00'}`);
    return Number.isFinite(value.getTime()) ? value : null;
}

function drawVitalChart(canvas, readings, series, options = {}) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#808080';
    ctx.strokeRect(0, 0, width - 1, height - 1);

    const pointsBySeries = series.map(item => ({
        ...item,
        values: readings.map((reading, index) => ({ index, value: readingSeriesValue(reading, item.key) })).filter(p => Number.isFinite(p.value))
    })).filter(item => item.values.length > 0);

    const goalValues = [];
    const goals = getMemberGoals(options.member);
    if (options.type === 'glucose') goalValues.push(70, goals.glucose.low, goals.glucose.high);
    if (options.type === 'bp') goalValues.push(goals.bp.systolicLow, goals.bp.systolicHigh, goals.bp.diastolicLow, goals.bp.diastolicHigh, goals.hr.low, goals.hr.high);
    if (options.type === 'weight') {
        const weightLow = goals.weight.unit === 'kg' && Number.isFinite(parseAmount(goals.weight.low, NaN))
            ? parseAmount(goals.weight.low) * 2.20462
            : parseAmount(goals.weight.low, NaN);
        const weightHigh = goals.weight.unit === 'kg' && Number.isFinite(parseAmount(goals.weight.high, NaN))
            ? parseAmount(goals.weight.high) * 2.20462
            : parseAmount(goals.weight.high, NaN);
        goalValues.push(weightLow, weightHigh);
    }
    if (options.type === 'med-monitor') goalValues.push(parseAmount(options.goalLow, NaN), parseAmount(options.goalHigh, NaN));

    const allValues = pointsBySeries.flatMap(item => item.values.map(p => p.value)).concat(goalValues).filter(Number.isFinite);
    if (allValues.length === 0) {
        ctx.fillStyle = '#000000';
        ctx.font = '10px MS Sans Serif, Arial';
        ctx.fillText('No data', 8, 18);
        return;
    }

    const rawMin = Math.min(...allValues);
    const rawMax = Math.max(...allValues);
    const rawSpread = Math.max(rawMax - rawMin, 1);
    const min = Math.max(0, rawMin - rawSpread * 0.12);
    const max = rawMax + rawSpread * 0.12;
    const spread = Math.max(max - min, 1);
    const leftPad = options.type === 'med-monitor' ? 86 : 58;
    const rightPad = 20;
    const topPad = 24;
    const bottomPad = 34;
    const readingTimes = readings.map(reading => readingDateTime(reading)?.getTime()).filter(Number.isFinite);
    const adherenceTimes = (options.adherenceEntries || [])
        .map(entry => parseHistoryTimestamp(entry.timestamp)?.getTime())
        .filter(Number.isFinite);
    const axisTimes = [...readingTimes, ...adherenceTimes];
    const firstTime = axisTimes.length ? Math.min(...axisTimes) : 0;
    const lastTime = axisTimes.length ? Math.max(...axisTimes) : firstTime;
    const xForTime = time => lastTime === firstTime
        ? (leftPad + width - rightPad) / 2
        : leftPad + ((time - firstTime) / (lastTime - firstTime)) * (width - leftPad - rightPad);
    const xFor = index => {
        const time = readingDateTime(readings[index])?.getTime();
        return Number.isFinite(time) ? xForTime(time) : (leftPad + width - rightPad) / 2;
    };
    const yFor = value => height - bottomPad - ((value - min) / spread) * (height - topPad - bottomPad);
    const axisLabel = value => {
        if (Math.abs(value) >= 100 || Math.abs(value - Math.round(value)) < 0.05) return String(Math.round(value));
        return value.toFixed(1);
    };

    ctx.strokeStyle = '#e0e0e0';
    ctx.fillStyle = '#444444';
    ctx.font = '9px MS Sans Serif, Arial';
    ctx.textAlign = 'right';
    for (let tick = 0; tick <= 4; tick++) {
        const value = min + (spread * tick / 4);
        const y = yFor(value);
        ctx.beginPath();
        ctx.moveTo(leftPad, y);
        ctx.lineTo(width - rightPad, y);
        ctx.stroke();
        ctx.fillText(axisLabel(value), leftPad - 7, y + 3);
    }

    ctx.strokeStyle = '#707070';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(leftPad, topPad);
    ctx.lineTo(leftPad, height - bottomPad);
    ctx.lineTo(width - rightPad, height - bottomPad);
    ctx.stroke();
    ctx.lineWidth = 1;

    if (options.type === 'glucose') {
        const y70 = yFor(70);
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(leftPad, y70);
        ctx.lineTo(width - rightPad, y70);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = '#ff0000';
        ctx.font = '9px MS Sans Serif, Arial';
        ctx.textAlign = 'right';
        ctx.fillText('70', leftPad - 7, y70 - 4);
        ctx.textAlign = 'left';
    }
    if (options.type === 'med-monitor') {
        [
            [parseAmount(options.goalLow, NaN), `Low ${formatAmount(parseAmount(options.goalLow))}`],
            [parseAmount(options.goalHigh, NaN), `High ${formatAmount(parseAmount(options.goalHigh))}`]
        ].filter(([value]) => Number.isFinite(value)).forEach(([value, label]) => {
            const y = yFor(value);
            ctx.save();
            ctx.strokeStyle = '#008000';
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(leftPad, y);
            ctx.lineTo(width - rightPad, y);
            ctx.stroke();
            ctx.restore();
            ctx.fillStyle = '#008000';
            ctx.font = '8px MS Sans Serif, Arial';
            ctx.textAlign = 'right';
            ctx.fillText(label, leftPad - 5, y - 2);
            ctx.textAlign = 'left';
        });
    }

    pointsBySeries.forEach(item => {
        ctx.strokeStyle = item.color;
        ctx.fillStyle = item.color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        item.values.forEach((point, idx) => {
            const x = xFor(point.index);
            const y = yFor(point.value);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.lineWidth = 1;
        item.values.forEach(point => {
            const x = xFor(point.index);
            const y = yFor(point.value);
            ctx.fillStyle = isChartPointOutOfRange(options.type, item.key, point.value, options.member, options) ? '#ff0000' : item.color;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
        });
    });

    (options.adherenceEntries || []).forEach(entry => {
        const time = parseHistoryTimestamp(entry.timestamp)?.getTime();
        if (!Number.isFinite(time) || time < firstTime || time > lastTime) return;
        const x = xForTime(time);
        const y = height - bottomPad - 5;
        ctx.fillStyle = '#000080';
        ctx.beginPath();
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x + 4, y);
        ctx.lineTo(x, y + 4);
        ctx.lineTo(x - 4, y);
        ctx.closePath();
        ctx.fill();
    });

    ctx.fillStyle = '#000000';
    ctx.font = '9px MS Sans Serif, Arial';
    ctx.textAlign = 'left';
    ctx.fillText(options.unit || '', leftPad, 14);
    if (readings.length > 0) {
        ctx.fillText(readings[0].date.slice(5), leftPad, height - 4);
        ctx.fillText(readings[readings.length - 1].date.slice(5), Math.max(leftPad, width - 42), height - 4);
    }
}

function renderVitals() {
    const memberSelect = document.getElementById('vital-member-select');
    if (memberSelect) {
        const selectedMember = memberSelect.value;
        memberSelect.innerHTML = db.family.map(m => `<option value="${m.id}">${m.lastName}, ${m.firstName}</option>`).join('');
        if (db.family.some(member => member.id === selectedMember)) memberSelect.value = selectedMember;
    }
    const memberFilter = document.getElementById('vital-member-filter');
    if (memberFilter) {
        const selectedFilter = memberFilter.value;
        memberFilter.innerHTML = `<option value="">All members</option>${db.family
            .map(member => `<option value="${member.id}">${escapeHtml(member.lastName)}, ${escapeHtml(member.firstName)}</option>`)
            .join('')}`;
        if (!selectedFilter || db.family.some(member => member.id === selectedFilter)) memberFilter.value = selectedFilter;
    }

    const dateInput = document.getElementById('vital-date');
    const timeInput = document.getElementById('vital-time');
    if (dateInput && !dateInput.value) dateInput.value = localDateKey();
    if (timeInput && !timeInput.value) {
        const now = new Date();
        timeInput.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }
    renderVitalTypeOptions();

    const tableBody = document.getElementById('vital-table-body');
    if (tableBody) {
        const filterMemberId = memberFilter?.value || '';
        const sortedVitals = db.vitals
            .filter(reading => !filterMemberId || reading.memberId === filterMemberId)
            .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
        tableBody.innerHTML = sortedVitals.slice(0, 50).map(reading => {
            const member = db.family.find(m => m.id === reading.memberId);
            const warningStyle = isVitalOutOfRange(reading, member) ? 'color:red; font-weight:bold;' : '';
            return `<tr style="${warningStyle}">
                <td>${member ? `${member.lastName}, ${member.firstName}` : '?'}</td>
                <td>${reading.date} ${reading.time}</td>
                <td>${escapeHtml(vitalTypeLabel(reading.type, reading, member))}</td>
                <td>${formatVitalReading(reading)}</td>
                <td>${escapeHtml(reading.notes || '')}</td>
                <td><button onclick="deleteVitalReading('${reading.id}')">Delete</button></td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" style="padding:8px;">No vital readings match this member filter.</td></tr>';
    }
}

function getVitalChartConfigs(member = null) {
    const standardCharts = [
        { type: 'bp', title: 'BP / HR', unit: 'mmHg / bpm', series: [
            { key: 'systolic', label: 'Systolic', color: '#0000aa' },
            { key: 'diastolic', label: 'Diastolic', color: '#008000' },
            { key: 'hr', label: 'Heart Rate', color: '#aa00aa' }
        ] },
        { type: 'weight', title: 'Weight', unit: 'lb', series: [{ key: 'weight', label: 'Weight', color: '#0000aa' }] },
        { type: 'glucose', title: 'Blood Glucose', unit: 'mg/dL', series: [{ key: 'glucose', label: 'Glucose', color: '#070707' }] },
        { type: 'temperature', title: 'Temperature', unit: 'F', series: [{ key: 'temperature', label: 'Temperature', color: '#b34d00' }] }
    ];
    const monitoringCharts = memberMonitoringProfiles(member).map(profile => ({
        type: 'med-monitor',
        monitoringId: profile.id,
        title: `${profile.labName} - ${profile.medicationName}`,
        unit: profile.unit || 'value',
        goalLow: profile.goalLow,
        goalHigh: profile.goalHigh,
        medId: profile.medId || '',
        series: [{ key: 'monitorValue', label: profile.labName, color: '#202020' }]
    }));
    return [...standardCharts, ...monitoringCharts];
}

function readingMatchesChart(reading, chart) {
    return reading.type === chart.type && (chart.type !== 'med-monitor' || reading.monitoringId === chart.monitoringId);
}

function adherenceEntriesForChart(member, chart, readings) {
    if (!member || !chart.medId || readings.length === 0) return [];
    const med = db.inventory.find(item => item.id === chart.medId);
    const firstDate = readings[0].date;
    const lastDate = readings[readings.length - 1].date;
    return db.history
        .filter(entry => entry.memberId === member.id)
        .filter(entry => !entry.doseStatus || ['given', 'late', 'early'].includes(entry.doseStatus))
        .filter(entry => entry.medId === chart.medId || (!!med && entry.medName === med.name))
        .filter(entry => {
            const timestamp = parseHistoryTimestamp(entry.timestamp);
            if (!timestamp) return false;
            const date = localDateKey(timestamp);
            return date >= firstDate && date <= lastDate;
        })
        .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
}

function renderMemberVitalCharts(memberId, container) {
    if (!container) return;
    const member = db.family.find(m => m.id === memberId);
    container.innerHTML = '<div class="vital-chart-grid"></div>';
    const grid = container.querySelector('.vital-chart-grid');

    getVitalChartConfigs(member).forEach(chart => {
        const readings = db.vitals
            .filter(v => v.memberId === memberId && readingMatchesChart(v, chart))
            .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
        if (readings.length === 0) return;

        const first = readings[0];
        const last = readings[readings.length - 1];
        const panel = document.createElement('div');
        panel.className = 'vital-chart-panel';
        const legend = chart.series.map(s => `<span><span class="legend-swatch" style="background:${s.color};"></span>${escapeHtml(s.label)}</span>`).join(' ');
        const adherenceEntries = adherenceEntriesForChart(member, chart, readings);
        const monitoringLegend = chart.type === 'med-monitor'
            ? `<span><span class="legend-swatch goal-swatch"></span>Goal range</span>${chart.medId ? '<span><span class="legend-diamond"></span>Dose taken</span>' : ''}`
            : '';
        panel.innerHTML = `
            <div style="font-size:11px; font-weight:bold;">${escapeHtml(chart.title)}</div>
            <div class="vital-chart-meta">${first.date} to ${last.date} (${readings.length} readings${chart.medId ? `, ${adherenceEntries.length} linked doses` : ''})</div>
            <canvas width="460" height="190" class="vital-chart"></canvas>
            <div class="vital-legend">${legend}${monitoringLegend}<span><span class="legend-swatch" style="background:#ff0000;"></span>Out of goal</span></div>
        `;
        grid.appendChild(panel);
        drawVitalChart(panel.querySelector('canvas'), readings, chart.series, { ...chart, member, adherenceEntries });
    });

    if (!grid.children.length) {
        container.innerHTML = '<div style="font-size:11px;">No monitoring readings logged for this member.</div>';
    }
}

function renderMemberVitalProfile(memberId) {
    renderMemberVitalCharts(memberId, document.getElementById('member-vitals-trends'));
}

function memberAdherenceRows(memberId, days = 14) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    const now = new Date();
    const rows = [];
    const schedules = db.schedules.filter(schedule => schedule.memberId === memberId && schedule.freq !== 'PRN');

    for (let i = 0; i < days; i++) {
        const cursor = new Date(start);
        cursor.setDate(start.getDate() + i);
        const date = localDateKey(cursor);
        let due = 0;
        let given = 0;
        let exceptions = 0;

        schedules.forEach(schedule => {
            getScheduleInstancesForDate(schedule, date).forEach(instance => {
                const instanceDateTime = new Date(`${instance.date}T${instance.time === 'PRN' ? '23:59' : instance.time}`);
                if (instanceDateTime > now) return;
                due++;
                const entry = findHistoryForScheduleInstance(schedule, instance);
                if (entry && isGivenStatus(entry.doseStatus || 'given')) given++;
                else if (entry && ['skipped', 'missed'].includes(entry.doseStatus)) exceptions++;
            });
        });

        rows.push({
            date,
            due,
            given,
            exceptions,
            missed: Math.max(0, due - given - exceptions),
            percent: due > 0 ? Math.round((given / due) * 100) : null
        });
    }
    return rows;
}

function renderMemberAdherenceProfile(memberId) {
    const container = document.getElementById('member-adherence-chart');
    if (!container) return;
    const member = db.family.find(item => item.id === memberId);
    if (!member) {
        container.innerHTML = '<div class="empty-state">Save member before tracking adherence.</div>';
        return;
    }
    const rows = memberAdherenceRows(memberId, 14);
    const totalDue = rows.reduce((sum, row) => sum + row.due, 0);
    const totalGiven = rows.reduce((sum, row) => sum + row.given, 0);
    const totalExceptions = rows.reduce((sum, row) => sum + row.exceptions, 0);
    const overall = totalDue > 0 ? Math.round((totalGiven / totalDue) * 100) : null;
    if (totalDue === 0) {
        container.innerHTML = '<div class="empty-state">No scheduled non-PRN doses were due in the last 14 days.</div>';
        return;
    }
    const statusClass = overall >= 90 ? 'good' : overall >= 75 ? 'watch' : 'risk';
    const bars = rows.map(row => {
        const labelDate = parseLocal(row.date);
        const label = labelDate ? `${labelDate.getMonth() + 1}/${labelDate.getDate()}` : row.date;
        const width = row.percent === null ? 0 : Math.max(2, row.percent);
        const barClass = row.percent === null ? 'empty' : row.percent >= 90 ? 'good' : row.percent >= 75 ? 'watch' : 'risk';
        const title = row.due
            ? `${row.date}: ${row.given}/${row.due} documented, ${row.exceptions} skipped/missed`
            : `${row.date}: no doses due`;
        return `<div class="adherence-day" title="${escapeHtml(title)}">
            <div class="adherence-bar-frame"><div class="adherence-bar ${barClass}" style="height:${width}%;"></div></div>
            <div class="adherence-day-label">${escapeHtml(label)}</div>
        </div>`;
    }).join('');
    container.innerHTML = `
        <div class="adherence-summary ${statusClass}">
            <div><strong>${overall}%</strong><span>Last 14 days</span></div>
            <div>${totalGiven}/${totalDue} scheduled doses documented as given${totalExceptions ? `; ${totalExceptions} skipped/missed documented` : ''}.</div>
        </div>
        <div class="adherence-chart">${bars}</div>
        <div class="adherence-legend">
            <span><i class="good"></i>90%+</span>
            <span><i class="watch"></i>75-89%</span>
            <span><i class="risk"></i>Below 75%</span>
        </div>`;
}

function renderMemberAdministrationLog(memberId) {
    const container = document.getElementById('member-admin-log');
    if (!container) return;

    const entries = db.history
        .filter(entry => entry.memberId === memberId)
        .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));

    if (entries.length === 0) {
        container.innerHTML = '<div style="font-size:11px; padding:5px;">No administration history recorded for this member.</div>';
        return;
    }

    container.innerHTML = entries.map(entry => {
        const canEdit = entry.scheduleId && entry.doseStatus !== 'container-finished';
        return `
        <div style="font-size:11px; border-bottom:1px dotted #c0c0c0; padding:4px;">
            <b>${escapeHtml(entry.timestamp || '')}</b> - ${escapeHtml(entry.medName || 'Medication')}<br>
            ${escapeHtml(entry.details || '')}
            ${canEdit ? `<div style="text-align:right; margin-top:3px;"><button type="button" onclick="editAdministration('${entry.id}')">Edit Documentation</button></div>` : ''}
        </div>
    `;
    }).join('');
}

function getTimelineRange() {
    if (!memberTimelineStart) {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 6);
        memberTimelineStart = localDateKey(start);
    }
    const start = parseLocal(memberTimelineStart);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start: memberTimelineStart, end: localDateKey(end) };
}

function historyEntryMatchesScheduleInstance(entry, schedule, instance) {
    if (!entry || !schedule || !instance) return false;
    if (entry.scheduleInstanceKey === instance.key) return true;
    if (entry.scheduleId && entry.scheduleId !== schedule.id) return false;
    const actual = historyEntryDateTime(entry);
    const offSchedule = ['late', 'early'].includes(entry.doseStatus || '') ||
        (actual.date && entry.scheduledDate && actual.date !== entry.scheduledDate);
    if (offSchedule &&
        entry.memberId === schedule.memberId &&
        entry.medId === schedule.medId &&
        actual.date === instance.date &&
        entry.scheduledTime === instance.time) {
        return true;
    }
    return entry.memberId === schedule.memberId &&
        entry.medId === schedule.medId &&
        entry.scheduledDate === instance.date &&
        entry.scheduledTime === instance.time;
}

function historyTimeForSort(entry) {
    return entry.scheduledTime || historyEntryDateTime(entry).time || '99:99';
}

function scheduleDateHistoryEntries(schedule, date) {
    return db.history
        .filter(entry => historyEntryMatchesScheduleDate(entry, schedule, date))
        .sort((a, b) => timeToMinutes(historyTimeForSort(a)) - timeToMinutes(historyTimeForSort(b)));
}

function historyEntryMatchesScheduleDate(entry, schedule, date) {
    if (!entry || !schedule || !date) return false;
    if (entry.scheduleId && entry.scheduleId !== schedule.id) return false;
    const actual = historyEntryDateTime(entry);
    const offSchedule = ['late', 'early'].includes(entry.doseStatus || '') ||
        (actual.date && entry.scheduledDate && actual.date !== entry.scheduledDate);
    return entry.memberId === schedule.memberId &&
        entry.medId === schedule.medId &&
        (entry.scheduledDate === date || (offSchedule && actual.date === date));
}

function findHistoryForModifiedScheduleInstance(schedule, instance) {
    const historyEntries = scheduleDateHistoryEntries(schedule, instance.date);
    if (historyEntries.length === 0) return null;

    const instances = getScheduleInstancesForDate(schedule, instance.date)
        .slice()
        .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
    if (instances.length === 1 && historyEntries.length === 1) return historyEntries[0];

    const instanceIndex = instances.findIndex(candidate => candidate.time === instance.time);
    if (instanceIndex < 0) return null;
    if (instances.length === historyEntries.length) return historyEntries[instanceIndex] || null;

    return null;
}

function findHistoryForScheduleInstance(schedule, instance) {
    return db.history.find(item => item.scheduleInstanceKey === instance.key)
        || db.history.find(item => historyEntryMatchesScheduleInstance(item, schedule, instance))
        || findHistoryForModifiedScheduleInstance(schedule, instance);
}

function timelineDoseState(schedule, instance) {
    const entry = findHistoryForScheduleInstance(schedule, instance);
    if (entry) {
        const status = entry.doseStatus || 'given';
        const actual = historyEntryDateTime(entry);
        const wasOffSchedule = ['late', 'early'].includes(status) ||
            (isGivenStatus(status) && (actual.date !== instance.date || actual.time !== instance.time));
        if (['skipped', 'missed'].includes(status)) {
            return {
                className: 'timeline-not-given',
                label: instance.time,
                title: `${doseStatusLabel(status)}. Click to edit.`,
                entryId: entry.id
            };
        }
        if (wasOffSchedule) {
            return {
                className: 'timeline-offschedule',
                label: `${instance.time} (${actual.time})`,
                title: `${doseStatusLabel(status)} at ${actual.date} ${actual.time}. Click to edit.`,
                entryId: entry.id
            };
        }
        return {
            className: 'timeline-given',
            label: instance.time,
            title: `${doseStatusLabel(status)}. Click to edit.`,
            entryId: entry.id
        };
    }

    const now = new Date();
    const due = new Date(`${instance.date}T${instance.time === 'PRN' ? '00:00' : instance.time}`);
    if (due < now) return { className: 'timeline-overdue', label: instance.time, title: 'Not documented at scheduled time. Click to document status.' };
    if (instance.date === localDateKey(now)) return { className: 'timeline-upcoming', label: instance.time, title: 'Upcoming dose. Click to document status.' };
    return { className: 'timeline-future', label: instance.time, title: 'Future scheduled dose. Click to document status.' };
}

window.documentScheduleInstance = async function(scheduleId, scheduledDate, scheduledTime) {
    const schedule = db.schedules.find(item => item.id === scheduleId);
    const med = schedule && db.inventory.find(item => item.id === schedule.medId);
    if (!schedule || !med) return;
    const key = scheduleInstanceKey(schedule.id, scheduledDate, scheduledTime);
    const existing = findHistoryForScheduleInstance(schedule, { date: scheduledDate, time: scheduledTime, key });
    if (existing) {
        await window.editAdministration(existing.id);
        return;
    }
    const isValidInstance = getScheduleInstancesForDate(schedule, scheduledDate)
        .some(instance => instance.time === scheduledTime);
    if (!isValidInstance) {
        await appAlert('This dose is no longer part of the active medication schedule.');
        return;
    }

    const defaults = defaultActualDateTime();
    const result = await showActionModal(`Document Dose: ${med.name}`, `
        <div class="sunken-panel" style="padding:6px; background:white; font-size:11px;">
            Scheduled: <strong>${escapeHtml(scheduledDate)} ${escapeHtml(scheduledTime)}</strong>
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Status:</label>
            <select name="doseStatus">
                <option value="given">Given as scheduled</option>
                <option value="late">Given late</option>
                <option value="early">Given early</option>
                <option value="skipped">Skipped</option>
                <option value="missed">Missed / forgotten</option>
            </select>
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Date documented/taken:</label><input name="actualDate" type="date" value="${defaults.date}">
            <label>Time:</label><input name="actualTime" type="time" value="${defaults.time}">
        </div>
        ${kitSourceSelectHtml(med.id)}
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Note:</label>
            <textarea name="doseNote" rows="3" style="width:100%; resize:none;" placeholder="Optional note"></textarea>
        </div>
    `, 'Save Status');
    if (!result) return;
    if (!result.actualDate || !result.actualTime) {
        await appAlert('Documented date and time are required.');
        return;
    }
    result.scheduledDate = scheduledDate;
    result.scheduledTime = scheduledTime;
    normalizeScheduledDoseActualTime(result);
    const documented = await administerScheduleRecord(
        schedule,
        result,
        schedule.orderSetName ? `Regimen (${schedule.orderSetName})` : 'Schedule'
    );
    if (documented) await sync();
};

function historyEntryDateKey(entry) {
    const parsed = historyEntryDateTime(entry);
    return parsed.date;
}

function prnTimelineEntries(schedule, dateKey) {
    return db.history
        .filter(entry => entry.scheduleId === schedule.id && historyEntryDateKey(entry) === dateKey)
        .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
}

function isPrnActiveOnDate(schedule, dateKey) {
    if (!schedule?.startDate || dateKey < schedule.startDate) return false;
    return schedule.endDate === 'Ongoing' || !schedule.endDate || dateKey <= schedule.endDate;
}

function memberMedicationTimelineHtml(schedule) {
    const range = getTimelineRange();
    const start = parseLocal(range.start);
    const days = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(start);
        date.setDate(date.getDate() + i);
        const dateKey = localDateKey(date);
        let doses = '';
        if (schedule.freq === 'PRN') {
            const entries = prnTimelineEntries(schedule, dateKey);
            doses = entries.length
                ? entries.map(entry => {
                    const time = historyEntryDateTime(entry).time;
                    const given = isGivenStatus(entry.doseStatus || 'given');
                    return `<button type="button" class="timeline-dose ${given ? 'timeline-given' : 'timeline-not-given'}" title="${escapeHtml(doseStatusLabel(entry.doseStatus || 'given'))}. Click to edit." onclick="event.stopPropagation(); editAdministration('${entry.id}')">${escapeHtml(time)}</button>`;
                }).join('')
                : `<span class="timeline-dose" title="${isPrnActiveOnDate(schedule, dateKey) ? 'No PRN administrations documented' : 'PRN order not active'}">${isPrnActiveOnDate(schedule, dateKey) ? 'PRN' : '-'}</span>`;
        } else {
            const instances = getScheduleInstancesForDate(schedule, dateKey);
            doses = instances.length
                ? instances.map(instance => {
                    const state = timelineDoseState(schedule, instance);
                    const click = state.entryId
                        ? ` onclick="event.stopPropagation(); editAdministration('${state.entryId}')"`
                        : ` onclick="event.stopPropagation(); documentScheduleInstance('${schedule.id}','${instance.date}','${instance.time}')"`;
                    return `<button type="button" class="timeline-dose ${state.className}" title="${escapeHtml(state.title)}"${click}>${escapeHtml(state.label || instance.time)}</button>`;
                }).join('')
                : '<span class="timeline-dose" title="No scheduled dose">-</span>';
        }
        days.push(`<div class="timeline-day"><span class="timeline-date">${date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</span>${doses}</div>`);
    }
    return `<div class="med-timeline" aria-label="Medication administration timeline">${days.join('')}</div>`;
}

function renderMemberMedicationTimelines() {
    const rangeLabel = document.getElementById('member-timeline-range');
    const range = getTimelineRange();
    if (rangeLabel) {
        rangeLabel.textContent = `${parseLocal(range.start).toLocaleDateString()} - ${parseLocal(range.end).toLocaleDateString()}`;
    }
    document.querySelectorAll('.member-med-timeline[data-schedule-id]').forEach(container => {
        const schedule = db.schedules.find(item => item.id === container.dataset.scheduleId);
        if (schedule) container.innerHTML = memberMedicationTimelineHtml(schedule);
    });
}

window.shiftMemberTimeline = function(days) {
    const range = getTimelineRange();
    const start = parseLocal(range.start);
    start.setDate(start.getDate() + days);
    memberTimelineStart = localDateKey(start);
    renderMemberMedicationTimelines();
};

function renderVitalDashboard() {
    const container = document.getElementById('vitals-dashboard');
    if (!container) return;
    container.innerHTML = '';

    const membersWithVitals = db.family.filter(member => db.vitals.some(v => v.memberId === member.id));
    if (membersWithVitals.length === 0) {
        container.innerHTML = '<div style="font-size:11px;">No vitals logged yet.</div>';
        return;
    }

    membersWithVitals.forEach(member => {
        const memberBlock = document.createElement('div');
        memberBlock.className = 'sunken-panel';
        memberBlock.style.cssText = 'background:white; padding:6px; margin-bottom:8px;';
        memberBlock.innerHTML = `<strong>${member.lastName}, ${member.firstName}</strong><div class="member-dashboard-vitals"></div>`;
        container.appendChild(memberBlock);
        renderMemberVitalCharts(member.id, memberBlock.querySelector('.member-dashboard-vitals'));
    });
}

function todayDoseRows() {
    const now = new Date();
    const today = localDateKey(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const rows = [];
    db.schedules
        .filter(schedule => !isScheduleArchived(schedule))
        .forEach(schedule => {
            const member = db.family.find(item => item.id === schedule.memberId);
            const med = db.inventory.find(item => item.id === schedule.medId);
            if (!member || !med) return;
            if (schedule.freq === 'PRN') {
                rows.push({ type: 'prn', status: 'PRN', schedule, member, med, instance: { date: today, time: 'PRN' }, minutes: 99999 });
                return;
            }
            getScheduleInstancesForDate(schedule, today).forEach(instance => {
                const documented = !!findHistoryForScheduleInstance(schedule, instance);
                const minutes = timeToMinutes(instance.time);
                const diff = minutes === null ? 99999 : minutes - currentMinutes;
                const status = documented ? 'given' : (diff < 0 ? 'overdue' : (diff <= 60 ? 'soon' : 'later'));
                rows.push({ type: 'scheduled', status, schedule, member, med, instance, minutes: minutes ?? 99999 });
            });
        });
    return rows.sort((a, b) => {
        const order = { overdue: 0, soon: 1, later: 2, given: 3, PRN: 4 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.minutes - b.minutes;
    });
}

function renderTodayViewDashboard() {
    const container = document.getElementById('today-view-dashboard');
    if (!container) return;
    const rows = todayDoseRows();
    if (rows.length === 0) {
        container.innerHTML = '<div class="status-ok">No scheduled doses for today.</div>';
        return;
    }
    const counts = rows.reduce((acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
    }, {});
    const rowHtml = rows.slice(0, 40).map(row => {
        const statusClass = `today-status-${String(row.status).toLowerCase()}`;
        const time = row.instance.time || 'PRN';
        return `<div class="today-dose-row ${statusClass}">
            <div>
                <strong>${escapeHtml(time)}</strong> - ${escapeHtml(row.med.name)} ${escapeHtml(formatMedStrength(row.med))}
                <br><small>${escapeHtml(memberDisplayName(row.member))} | Qty ${escapeHtml(formatQtyForSchedule(row.schedule, row.med))} | Dose ${escapeHtml(formatPrescribedDose(row.med, row.schedule.doseQty))}</small>
            </div>
            <div>
                <span class="today-status-pill">${escapeHtml(row.status)}</span>
                ${row.status !== 'given' && row.status !== 'PRN' ? `<button type="button" onclick="documentScheduleInstance('${escapeHtml(row.schedule.id)}','${escapeHtml(row.instance.date)}','${escapeHtml(row.instance.time)}')">Document</button>` : ''}
                <button type="button" onclick="openMemberModal('${escapeHtml(row.member.id)}')">Profile</button>
            </div>
        </div>`;
    }).join('');
    container.innerHTML = `
        <div class="today-summary-strip">
            <span>Overdue: <b>${counts.overdue || 0}</b></span>
            <span>Due soon: <b>${counts.soon || 0}</b></span>
            <span>Later: <b>${counts.later || 0}</b></span>
            <span>Given: <b>${counts.given || 0}</b></span>
            <span>PRN: <b>${counts.PRN || 0}</b></span>
        </div>
        <div class="today-dose-list">${rowHtml}${rows.length > 40 ? `<div class="form-help">Showing 40 of ${rows.length} today items.</div>` : ''}</div>`;
}

function dataHealthIssues() {
    const issues = [];
    const inventoryIds = new Set(db.inventory.map(item => item.id));
    const memberIds = new Set(db.family.map(item => item.id));
    const scheduleIds = new Set(db.schedules.map(item => item.id));
    const barcodeMap = new Map();

    db.schedules.forEach(schedule => {
        if (!memberIds.has(schedule.memberId)) issues.push({ severity: 'high', repairable: true, type: 'orphan-schedule-member', scheduleId: schedule.id, message: `Schedule ${schedule.id} has no matching member.` });
        if (!inventoryIds.has(schedule.medId)) issues.push({ severity: 'high', repairable: true, type: 'orphan-schedule-med', scheduleId: schedule.id, message: `Schedule ${schedule.id} has no matching inventory medication.` });
        if (schedule.freq !== 'PRN' && getScheduleTimes(schedule).length === 0) issues.push({ severity: 'medium', repairable: false, type: 'missing-times', message: `Scheduled medication ${schedule.id} has no administration time.` });
        linkedSchedulesFor(schedule, db.schedules.filter(item => item.memberId === schedule.memberId)).forEach(linked => {
            if (scheduleLinkModeBetween(schedule, linked) === 'together' && !schedulesHaveAlignedTiming(schedule, linked)) {
                const med = db.inventory.find(item => item.id === schedule.medId);
                const linkedMed = db.inventory.find(item => item.id === linked.medId);
                issues.push({ severity: 'medium', repairable: false, type: 'linked-mismatch', message: `Linked meds do not align: ${med?.name || schedule.id} and ${linkedMed?.name || linked.id}.` });
            }
        });
    });

    db.history.forEach(entry => {
        if (entry.scheduleId && !scheduleIds.has(entry.scheduleId)) issues.push({ severity: 'low', repairable: false, type: 'history-orphan', message: `Administration history references a removed schedule: ${entry.medName || entry.scheduleId}.` });
    });

    db.inventory.forEach(med => {
        medicationCodes(med).forEach(code => {
            if (!barcodeMap.has(code)) barcodeMap.set(code, []);
            barcodeMap.get(code).push(med.name || med.id);
        });
        if (parseAmount(med.stock, 0) < 0) issues.push({ severity: 'medium', repairable: true, type: 'negative-stock', medId: med.id, message: `${med.name} has negative stock.` });
    });
    barcodeMap.forEach((names, code) => {
        if (names.length > 1) issues.push({ severity: 'high', repairable: false, type: 'duplicate-barcode', message: `Barcode ${code} is assigned to multiple items: ${names.join(', ')}.` });
    });

    return issues;
}

function dataHealthSummaryHtml(issues) {
    const counts = issues.reduce((acc, issue) => {
        acc[issue.severity] = (acc[issue.severity] || 0) + 1;
        return acc;
    }, {});
    return `<span class="${issues.length ? 'error-text' : 'status-ok'}">${issues.length ? `${issues.length} issue${issues.length === 1 ? '' : 's'} found` : 'No data health issues found.'}</span>
        ${issues.length ? `<span>High: ${counts.high || 0} | Medium: ${counts.medium || 0} | Low: ${counts.low || 0}</span>` : ''}`;
}

function renderDataHealthSummary() {
    const container = document.getElementById('data-health-summary');
    if (!container) return;
    container.innerHTML = dataHealthSummaryHtml(dataHealthIssues());
}

window.runDataHealthCheck = async function() {
    const issues = dataHealthIssues();
    const rows = issues.map(issue => `<tr><td>${escapeHtml(issue.severity)}</td><td>${escapeHtml(issue.message)}</td><td>${issue.repairable ? 'Yes' : 'Review manually'}</td></tr>`).join('');
    await showActionModal('Data Health Check', `
        <div style="font-size:11px; margin-bottom:6px;">This checks for broken schedule links, orphaned records, duplicate barcodes, missing times, and impossible stock counts.</div>
        <table class="win98-report-table">
            <thead><tr><th>Severity</th><th>Finding</th><th>Repair</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3">No data health issues found.</td></tr>'}</tbody>
        </table>
    `, 'Close');
};

window.repairDataHealthIssues = async function() {
    const issues = dataHealthIssues().filter(issue => issue.repairable);
    if (issues.length === 0) {
        await appAlert('No safe automatic repairs are available.');
        return;
    }
    if (!await appConfirm(`Repair ${issues.length} safe issue${issues.length === 1 ? '' : 's'}? This removes orphaned schedules and corrects negative stock to 0.`, 'Repair Data Health')) return;
    const orphanScheduleIds = new Set(issues.filter(issue => issue.type.startsWith('orphan-schedule')).map(issue => issue.scheduleId).filter(Boolean));
    db.schedules = db.schedules.filter(schedule => !orphanScheduleIds.has(schedule.id));
    issues.filter(issue => issue.type === 'negative-stock').forEach(issue => {
        const med = db.inventory.find(item => item.id === issue.medId);
        if (med) med.stock = 0;
    });
    addAudit('Data repair', 'Data Health', `Repaired ${issues.length} safe issue${issues.length === 1 ? '' : 's'}.`);
    await sync();
    await appAlert('Safe data health repairs are complete.');
};

window.viewAuditTrail = async function() {
    const rows = (db.auditTrail || []).slice(0, 200).map(entry => `<tr><td>${escapeHtml(auditDisplayTime(entry))}</td><td>${escapeHtml(entry.action || '')}</td><td>${escapeHtml(entry.subject || '')}</td><td>${escapeHtml(entry.details || '')}</td></tr>`).join('');
    await showActionModal('Audit Trail', `
        <div style="font-size:11px; margin-bottom:6px;">Recent edits and safety-relevant actions. This log is separate from the activity log.</div>
        <table class="win98-report-table">
            <thead><tr><th>Date/Time</th><th>Action</th><th>Subject</th><th>Details</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">No audit entries yet.</td></tr>'}</tbody>
        </table>
    `, 'Close');
};

function getInventoryStatusGroups() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiringCutoff = new Date(today);
    expiringCutoff.setDate(expiringCutoff.getDate() + 15);

    const sorted = [...db.inventory].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    return {
        low: sorted.filter(med => parseAmount(med.stock) <= parseAmount(med.minThreshold)),
        expired: sorted.filter(med => {
            const expiry = med.expiry ? parseLocal(med.expiry) : null;
            return expiry && expiry < today;
        }),
        expiringSoon: sorted.filter(med => {
            const expiry = med.expiry ? parseLocal(med.expiry) : null;
            return expiry && expiry >= today && expiry <= expiringCutoff;
        })
    };
}

function inventoryStatusItemHtml(med) {
    const forecast = refillForecastText(med);
    return `<li>${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))} - ${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))} on hand, exp ${escapeHtml(med.expiry || 'N/A')}${forecast ? `<br><small>${escapeHtml(forecast)}</small>` : ''}</li>`;
}

function renderInventoryStatus() {
    const container = document.getElementById('inventory-status');
    if (!container) return;

    const groups = getInventoryStatusGroups();
    const section = (title, items, className, mark) => `
        <div class="inventory-status-box ${className}">
            <div class="inventory-status-heading"><span class="inventory-status-mark">${mark}</span><strong>${title}</strong><span class="inventory-status-count">${items.length}</span></div>
            ${items.length
                ? `<ul>${items.slice(0, 8).map(inventoryStatusItemHtml).join('')}${items.length > 8 ? `<li>+${items.length - 8} more</li>` : ''}</ul>`
                : '<div class="status-ok">None</div>'}
        </div>`;

    container.innerHTML = `
        <div class="inventory-status-grid">
            ${section('Low meds (Refill Needed Soon)', groups.low, 'inventory-status-low', '!')}
            ${section('Expired meds', groups.expired, 'inventory-status-expired', 'X')}
            ${section('Expiring in 15 days', groups.expiringSoon, 'inventory-status-soon', '15')}
        </div>`;
}

window.backupAppData = async function() {
    if (!window.api?.backupData) {
        await appAlert('Backup support is not available in this build. Restart the desktop app and try again.');
        return;
    }
    const path = await window.api.backupData(db);
    if (path) await appAlert(`Backup saved:\n${path}`, 'Backup Complete');
};

window.restoreAppData = async function() {
    if (!window.api?.restoreData) {
        await appAlert('Restore support is not available in this build. Restart the desktop app and try again.');
        return;
    }
    if (!await appConfirm('Restore will replace the current PharmAtlas data with the selected backup file. Continue?', 'Restore Backup')) return;
    try {
        const restored = await window.api.restoreData();
        if (!restored) return;
        db = { ...emptyDb, ...restored };
        pendingScheduleOrders = [];
        activePrepackQueueId = null;
        renderAll();
        await appAlert('Backup restored successfully.', 'Restore Complete');
    } catch (error) {
        console.error(error);
        await appAlert('Unable to restore that backup file. Make sure it is a valid PharmAtlas JSON backup.', 'Restore Failed');
    }
};

function reportStyles() {
    return `
        body { font-family: Arial, sans-serif; font-size: 11px; color: #000; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        h2 { font-size: 15px; margin: 16px 0 6px; border-bottom: 1px solid #000; }
        h3 { font-size: 13px; margin: 12px 0 4px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
        th, td { border: 1px solid #000; padding: 4px; vertical-align: top; }
        th { background: #dcdcdc; }
        .muted { color: #555; }
        .alert { color: #b00000; font-weight: bold; }
        .chart-img { max-width: 100%; border: 1px solid #000; margin: 5px 0 10px; }
        .legend { font-size: 10px; margin-bottom: 4px; }
        .swatch { display: inline-block; width: 9px; height: 9px; border: 1px solid #000; margin: 0 3px 0 8px; vertical-align: middle; }
        .status-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .status-box { border: 1px solid #000; padding: 6px; min-height: 70px; }
        .paper-check { font-size: 16px; line-height: 1; text-align: center; }
        .comment-cell { min-width: 140px; height: 28px; }
        ul { margin: 4px 0 0 16px; padding: 0; }
    `;
}

function reportShell(title, bodyHtml) {
    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(title)}</title>
        <style>${reportStyles()}</style>
    </head>
    <body>
        <div class="muted">Generated ${escapeHtml(new Date().toLocaleString())}</div>
        ${bodyHtml}
    </body>
    </html>`;
}

function sanitizeFilenamePart(value) {
    return String(value || '').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'Report';
}

function reportPdfFileName(filenamePrefix) {
    return `${sanitizeFilenamePart(filenamePrefix)}_${localDateKey()}.pdf`;
}

function printReportBody(title, bodyHtml) {
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
        appAlert('Unable to open the print window. Check whether popup windows are blocked.');
        return;
    }
    printWindow.document.open();
    printWindow.document.write(reportShell(title, `<h1>${escapeHtml(title)}</h1>${bodyHtml}`));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 150);
}

async function saveReportPdf(title, bodyHtml, filenamePrefix) {
    if (!window.api?.savePdfReport) {
        alert("PDF report support is not available. Restart the app and try again.");
        return;
    }
    try {
        const path = await window.api.savePdfReport({
            html: reportShell(title, bodyHtml),
            fileName: reportPdfFileName(filenamePrefix)
        });
        alert(`PDF saved:\n${path}`);
    } catch (error) {
        console.error(error);
        alert("Unable to generate PDF report.");
    }
}

async function emailReportPdf(title, bodyHtml, filenamePrefix, to, message) {
    if (!window.api?.emailPdfReport) {
        await appAlert("Email PDF support is not available in this build. Restart the desktop app and try again.");
        return false;
    }

    try {
        const result = await window.api.emailPdfReport({
            html: reportShell(title, bodyHtml),
            fileName: reportPdfFileName(filenamePrefix),
            to,
            subject: title,
            body: message || title
        });
        if (result?.success) {
            await appAlert(`PDF report sent to ${to}.`);
            return true;
        }
        await appAlert(`Unable to send PDF report${result?.error ? `: ${result.error}` : '.'}`);
        return false;
    } catch (error) {
        console.error(error);
        await appAlert("Unable to send PDF report.");
        return false;
    }
}

window.generateInventoryPdfReport = async function() {
    const groups = getInventoryStatusGroups();
    const statusSection = (title, items) => `
        <div class="status-box">
            <strong>${escapeHtml(title)}: ${items.length}</strong>
            ${items.length ? `<ul>${items.map(inventoryStatusItemHtml).join('')}</ul>` : '<div>None</div>'}
        </div>`;
    const rows = [...db.inventory]
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
        .map(med => `
            <tr>
                <td>${escapeHtml(med.name)}</td>
                <td>${escapeHtml(formatMedStrength(med))}</td>
                <td>${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))}</td>
                <td>${escapeHtml(formatAmount(parseAmount(med.minThreshold)))}</td>
                <td>${escapeHtml(med.expiry || 'N/A')}</td>
                <td>${escapeHtml(med.storage || 'N/A')}</td>
                <td>${escapeHtml(med.controlLevel || 'N/A')}</td>
                <td>${escapeHtml(med.notes || '')}</td>
            </tr>`).join('');

    const body = `
        <h2>Inventory Status</h2>
        <div class="status-grid">
            ${statusSection('Low meds', groups.low)}
            ${statusSection('Expired meds', groups.expired)}
            ${statusSection('Expiring in 15 days', groups.expiringSoon)}
        </div>
        <h2>Current Inventory</h2>
        <table>
            <thead><tr><th>Name</th><th>Strength</th><th>Qty On Hand</th><th>Alert At</th><th>Expiry</th><th>Storage</th><th>Control</th><th>Notes</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="8">No inventory entered.</td></tr>'}</tbody>
        </table>`;
    await saveReportPdf('Current Inventory Report', body, 'Current_Inventory');
};

function memberMedicationReviewHtml(member, forPdf = false) {
    if (!member) return '<div class="empty-state">Save member before viewing medication/supplement summary.</div>';
    const activeSchedules = db.schedules.filter(schedule => schedule.memberId === member.id && !isScheduleArchived(schedule));
    const rows = activeSchedules
        .slice()
        .sort((a, b) => {
            const aPrn = a.freq === 'PRN' ? 1 : 0;
            const bPrn = b.freq === 'PRN' ? 1 : 0;
            if (aPrn !== bPrn) return aPrn - bPrn;
            const aTime = getScheduleTimes(a)[0] || '99:99';
            const bTime = getScheduleTimes(b)[0] || '99:99';
            return aTime.localeCompare(bTime);
        })
        .map(schedule => {
        const med = db.inventory.find(item => item.id === schedule.medId);
        if (!med) return '';
        const forecast = refillForecastText(med);
        const lastGiven = db.history
            .filter(entry => entry.scheduleId === schedule.id && isGivenStatus(entry.doseStatus || 'given'))
            .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
        const times = getScheduleTimes(schedule);
        const scheduleText = schedule.freq === 'PRN'
            ? `PRN${prnLimitText(schedule)}`
            : `${formatFrequency(schedule)} ${times.join(', ') || ''}`.trim();
        return `<tr>
            <td>${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))}</td>
            <td>${escapeHtml(formatPrescribedDose(med, schedule.doseQty))}<br><small>${escapeHtml(formatQtyForSchedule(schedule, med))}</small></td>
            <td>${escapeHtml(scheduleText)}${schedule.instructions ? `<br><small>${escapeHtml(schedule.instructions)}</small>` : ''}</td>
            <td>${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))}${forecast ? `<br><small>${escapeHtml(forecast)}</small>` : ''}</td>
            <td>${escapeHtml(lastGiven?.timestamp || 'Not documented')}</td>
        </tr>`;
    }).join('');
    return `
        <table class="win98-report-table medication-summary-table">
            <thead><tr><th>Medication</th><th>Dose / Qty</th><th>Frequency / Times</th><th>Inventory Forecast</th><th>Last Given</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5">No active medications or supplements.</td></tr>'}</tbody>
        </table>`;
}

function memberMedicationSummaryReportBody(member) {
    return `
        <h2>${escapeHtml(member.lastName)}, ${escapeHtml(member.firstName)}</h2>
        <div class="muted">Includes active scheduled medications, supplements, and PRN medications.</div>
        <h2>Medications/Supplements Summary</h2>
        ${memberMedicationReviewHtml(member, true)}`;
}

function renderMemberMedicationReview(memberId) {
    const container = document.getElementById('member-med-review');
    if (!container) return;
    const member = db.family.find(item => item.id === memberId);
    container.innerHTML = memberMedicationReviewHtml(member, false);
}

window.generateMemberMedicationSummaryPdfReport = async function(memberId = currentEditingMemberId) {
    const member = db.family.find(m => m.id === memberId);
    if (!member) return appAlert('Open a saved member profile before generating a medications/supplements summary PDF.');
    await saveReportPdf(
        `Medications/Supplements Summary - ${member.firstName} ${member.lastName}`,
        memberMedicationSummaryReportBody(member),
        `Medications_Supplements_Summary_${member.lastName}_${member.firstName}`
    );
};

window.printMemberMedicationSummaryReport = function(memberId = currentEditingMemberId) {
    const member = db.family.find(m => m.id === memberId);
    if (!member) {
        appAlert('Open a saved member profile before printing a medications/supplements summary.');
        return;
    }
    printReportBody(
        `Medications/Supplements Summary - ${member.firstName} ${member.lastName}`,
        memberMedicationSummaryReportBody(member)
    );
};

window.fillMedicationSummaryProviderEmail = function(providerId) {
    const emailInput = document.querySelector('#action-modal-body input[name="email"]');
    const provider = db.prescribers.find(item => item.id === providerId);
    if (emailInput) emailInput.value = provider?.email || '';
};

window.emailMemberMedicationSummaryReport = async function(memberId = currentEditingMemberId) {
    const member = db.family.find(item => item.id === memberId);
    if (!member) return appAlert('Open a saved member profile before emailing a medications/supplements summary.');
    const providers = memberPrescriberIds(member)
        .map(id => db.prescribers.find(item => item.id === id))
        .filter(Boolean)
        .sort((a, b) => prescriberDisplayName(a).localeCompare(prescriberDisplayName(b), undefined, { sensitivity: 'base' }));
    const defaultProvider = providers.find(provider => provider.email) || providers[0];
    const providerOptions = providers
        .map(provider => `<option value="${escapeHtml(provider.id)}" ${provider.id === defaultProvider?.id ? 'selected' : ''}>${escapeHtml(prescriberDisplayName(provider))}${provider.email ? ` - ${escapeHtml(provider.email)}` : ' - no email saved'}</option>`)
        .join('');
    const title = `Medications/Supplements Summary - ${member.firstName} ${member.lastName}`;
    const defaultMessage = `Attached is the medications and supplements summary for ${member.firstName} ${member.lastName}.`;
    const result = await showActionModal('Send Medication Summary to Provider', `
        <div class="field-row-stacked">
            <label>Provider profile:</label>
            <select name="providerId" onchange="fillMedicationSummaryProviderEmail(this.value)" style="width:100%;">
                <option value="">Enter an email manually</option>
                ${providerOptions}
            </select>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Provider email:</label>
            <input name="email" type="email" value="${escapeHtml(defaultProvider?.email || '')}" style="width:100%;" placeholder="provider@example.com">
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Message:</label>
            <textarea name="message" rows="4" style="width:100%; resize:none;">${escapeHtml(defaultMessage)}</textarea>
        </div>
    `, 'Send Email');
    if (!result) return;

    const email = String(result.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        await appAlert('Select a provider with an email address or enter a valid email manually.');
        return;
    }
    await emailReportPdf(
        title,
        memberMedicationSummaryReportBody(member),
        `Medications_Supplements_Summary_${member.lastName}_${member.firstName}`,
        email,
        result.message
    );
};

function memberScheduleReportBody(member, startDate, endDate) {
    const doseRows = collectMemberScheduleDoseRows(member.id, startDate, endDate);
    if (doseRows.length === 0) {
        return `
            <h2>${escapeHtml(member.lastName)}, ${escapeHtml(member.firstName)}</h2>
            <div class="muted">Date range: ${escapeHtml(startDate)} to ${escapeHtml(endDate)}</div>
            <h2>Medication Schedule</h2>
            <div>No scheduled medication doses found for this date range.</div>`;
    }

    let currentDate = '';
    const sections = [];
    let rows = [];
    const flush = () => {
        if (!currentDate) return;
        sections.push(`
            <h2>${escapeHtml(currentDate)}</h2>
            <table>
                <thead>
                    <tr>
                        <th style="width:42px;">Given</th>
                        <th style="width:60px;">Time</th>
                        <th>Medication</th>
                        <th>Strength</th>
                        <th>Dose</th>
                        <th>Qty</th>
                        <th>Instructions</th>
                        <th>Comments</th>
                    </tr>
                </thead>
                <tbody>${rows.join('')}</tbody>
            </table>`);
        rows = [];
    };

    doseRows.forEach(({ schedule, med, instance }) => {
        if (instance.date !== currentDate) {
            flush();
            currentDate = instance.date;
        }
        rows.push(`
            <tr>
                <td class="paper-check">&#9744;</td>
                <td>${escapeHtml(instance.time)}</td>
                <td>${escapeHtml(med.name)}</td>
                <td>${escapeHtml(formatMedStrength(med))}</td>
                <td>${escapeHtml(formatPrescribedDose(med, schedule.doseQty))}</td>
                <td>${escapeHtml(formatQtyForSchedule(schedule, med))}</td>
                <td>${escapeHtml(schedule.instructions || '')}</td>
                <td class="comment-cell"></td>
            </tr>`);
    });
    flush();

    return `
        <h2>${escapeHtml(member.lastName)}, ${escapeHtml(member.firstName)}</h2>
        <div class="muted">Date range: ${escapeHtml(startDate)} to ${escapeHtml(endDate)}</div>
        <div class="muted">Use the checkbox to mark administered doses and write late, early, skipped, missed, or other details in Comments.</div>
        ${sections.join('')}`;
}

window.generateMemberSchedulePdfReport = async function(memberId = currentEditingMemberId, startDate = localDateKey(), endDate = localDateKey()) {
    const member = db.family.find(m => m.id === memberId);
    if (!member) return alert("Open a saved member profile before generating a schedule PDF.");
    if (!startDate || !endDate || endDate < startDate) return alert("Enter a valid schedule date range.");

    await saveReportPdf(
        `Medication Schedule - ${member.firstName} ${member.lastName}`,
        memberScheduleReportBody(member, startDate, endDate),
        `Medication_Schedule_${member.lastName}_${member.firstName}`
    );
};

window.emailMemberSchedulePdfReport = async function(memberId = currentEditingMemberId, startDate = localDateKey(), endDate = localDateKey()) {
    const member = db.family.find(m => m.id === memberId);
    if (!member) return appAlert("Open a saved member profile before emailing a schedule PDF.");
    if (!startDate || !endDate || endDate < startDate) return appAlert("Enter a valid schedule date range.");

    const title = `Medication Schedule - ${member.firstName} ${member.lastName}`;
    const defaultMessage = `Attached is the medication schedule for ${member.firstName} ${member.lastName} from ${startDate} to ${endDate}.`;
    const result = await showActionModal('Email Schedule PDF', `
        <div class="field-row-stacked">
            <label>Email address:</label>
            <input name="email" type="email" value="${escapeHtml(member.email || '')}" style="width:100%;">
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Message:</label>
            <textarea name="message" rows="4" style="width:100%; resize:none;">${escapeHtml(defaultMessage)}</textarea>
        </div>
    `, 'Send Email');
    if (!result) return;

    const email = String(result.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        await appAlert("Enter a valid email address.");
        return;
    }

    await emailReportPdf(
        title,
        memberScheduleReportBody(member, startDate, endDate),
        `Medication_Schedule_${member.lastName}_${member.firstName}`,
        email,
        result.message
    );
};

function vitalChartReportHtml(member, chart, readings) {
    if (readings.length === 0) return '';
    const canvas = document.createElement('canvas');
    canvas.width = 680;
    canvas.height = 260;
    const adherenceEntries = adherenceEntriesForChart(member, chart, readings);
    drawVitalChart(canvas, readings, chart.series, { ...chart, member, adherenceEntries });
    const imageUrl = canvas.toDataURL('image/png');
    const legend = chart.series
        .map(series => `<span><span class="swatch" style="background:${series.color};"></span>${escapeHtml(series.label)}</span>`)
        .join('');
    const monitoringLegend = chart.type === 'med-monitor'
        ? `<span><span class="swatch" style="background:#008000;"></span>Goal range</span>${chart.medId ? '<span><span class="swatch" style="background:#000080;"></span>Dose taken</span>' : ''}`
        : '';
    return `
        <h3>${escapeHtml(chart.title)}</h3>
        <div class="legend">${legend}${monitoringLegend}<span><span class="swatch" style="background:#ff0000;"></span>Out of goal</span></div>
        ${chart.type === 'med-monitor' ? `<div class="muted">Goal: ${escapeHtml(formatAmount(parseAmount(chart.goalLow)))}-${escapeHtml(formatAmount(parseAmount(chart.goalHigh)))} ${escapeHtml(chart.unit)}${chart.medId ? ` | Linked administrations shown: ${adherenceEntries.length}` : ''}</div>` : ''}
        <img class="chart-img" src="${imageUrl}" alt="${escapeHtml(chart.title)} chart">`;
}

function memberVitalsReportBody(member) {
    const goals = getMemberGoals(member);
    const memberReadings = db.vitals
        .filter(reading => reading.memberId === member.id)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

    const charts = getVitalChartConfigs(member);
    const chartsWithReadings = charts
        .map(chart => ({
            chart,
            readings: memberReadings.filter(reading => readingMatchesChart(reading, chart))
        }))
        .filter(entry => entry.readings.length > 0);
    const chartsHtml = chartsWithReadings.map(({ chart, readings }) => {
        return vitalChartReportHtml(member, chart, readings);
    }).join('');

    const logSections = chartsWithReadings.map(({ chart, readings }) => {
        const rows = readings
            .map(reading => {
                const alertClass = isVitalOutOfRange(reading, member) ? ' class="alert"' : '';
                return `<tr${alertClass}>
                    <td>${escapeHtml(reading.date)} ${escapeHtml(reading.time)}</td>
                    <td>${escapeHtml(formatVitalReading(reading))}</td>
                    <td>${escapeHtml(reading.notes || '')}</td>
                </tr>`;
            }).join('');
        return `
            <h3>${escapeHtml(chart.title)} Log</h3>
            <table>
                <thead><tr><th>Date/Time</th><th>Reading</th><th>Notes</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="3">No readings logged.</td></tr>'}</tbody>
            </table>`;
    }).join('');

    return `
        <h2>${escapeHtml(member.lastName)}, ${escapeHtml(member.firstName)}</h2>
        <div class="muted">Glucose goal: ${escapeHtml(goals.glucose.low)}-${escapeHtml(goals.glucose.high)} mg/dL | BP goal: ${escapeHtml(goals.bp.systolicLow)}-${escapeHtml(goals.bp.systolicHigh)}/${escapeHtml(goals.bp.diastolicLow)}-${escapeHtml(goals.bp.diastolicHigh)} mmHg | HR goal: ${escapeHtml(goals.hr.low)}-${escapeHtml(goals.hr.high)} bpm${goals.weight.low !== '' && goals.weight.high !== '' ? ` | Weight goal: ${escapeHtml(goals.weight.low)}-${escapeHtml(goals.weight.high)} ${escapeHtml(goals.weight.unit || 'lb')}` : ''}</div>
        ${chartsHtml || '<h3>No graphable monitoring readings yet.</h3>'}
        <h2>Reading Log</h2>
        ${logSections}`;
}

window.generateMemberVitalsPdfReport = async function(memberId = currentEditingMemberId) {
    const member = db.family.find(m => m.id === memberId);
    if (!member) return alert("Open a saved member profile before generating a vitals PDF.");
    if (!db.vitals.some(reading => reading.memberId === member.id)) {
        return alert("No monitored vitals have been logged for this member.");
    }

    await saveReportPdf(
        `Monitoring Report - ${member.firstName} ${member.lastName}`,
        memberVitalsReportBody(member),
        `Monitoring_${member.lastName}_${member.firstName}`
    );
};

window.fillVitalsProviderEmail = function(providerId) {
    const emailInput = document.querySelector('#action-modal-body input[name="email"]');
    const provider = db.prescribers.find(item => item.id === providerId);
    if (emailInput) emailInput.value = provider?.email || '';
};

window.emailMemberVitalsPdfReport = async function(memberId = currentEditingMemberId) {
    const member = db.family.find(item => item.id === memberId);
    if (!member) return appAlert('Open a saved member profile before emailing a monitoring report.');
    if (!db.vitals.some(reading => reading.memberId === member.id)) {
        return appAlert('No monitoring readings have been logged for this member.');
    }

    const providers = memberPrescriberIds(member)
        .map(id => db.prescribers.find(item => item.id === id))
        .filter(Boolean)
        .sort((a, b) => prescriberDisplayName(a).localeCompare(prescriberDisplayName(b), undefined, { sensitivity: 'base' }));
    const defaultProvider = providers.find(provider => provider.email) || providers[0];
    const providerOptions = providers
        .map(provider => `<option value="${escapeHtml(provider.id)}" ${provider.id === defaultProvider?.id ? 'selected' : ''}>${escapeHtml(prescriberDisplayName(provider))}${provider.email ? ` - ${escapeHtml(provider.email)}` : ' - no email saved'}</option>`)
        .join('');
    const title = `Monitoring Report - ${member.firstName} ${member.lastName}`;
    const defaultMessage = `Attached is the monitored vital signs and therapeutic lab report for ${member.firstName} ${member.lastName}.`;
    const result = await showActionModal('Send Monitoring Report to Provider', `
        <div class="field-row-stacked">
            <label>Provider profile:</label>
            <select name="providerId" onchange="fillVitalsProviderEmail(this.value)" style="width:100%;">
                <option value="">Enter an email manually</option>
                ${providerOptions}
            </select>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Provider email:</label>
            <input name="email" type="email" value="${escapeHtml(defaultProvider?.email || '')}" style="width:100%;" placeholder="provider@example.com">
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Message:</label>
            <textarea name="message" rows="4" style="width:100%; resize:none;">${escapeHtml(defaultMessage)}</textarea>
        </div>
    `, 'Send Email');
    if (!result) return;

    const email = String(result.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        await appAlert('Select a provider with an email address or enter a valid email manually.');
        return;
    }
    await emailReportPdf(
        title,
        memberVitalsReportBody(member),
        `Monitoring_${member.lastName}_${member.firstName}`,
        email,
        result.message
    );
};

// --- SCHEDULING ---
window.updateSchedStrength = function() {
    const input = document.getElementById('med-search-input');
    const name = input.value;
    const memberId = document.getElementById('select-member')?.value || '';

    // Find all inventory items that have this exact name
    const matches = db.inventory.filter(m => m.name === name && medicationAssignedToMember(m, memberId));
    const blockedMatches = db.inventory.filter(m => m.name === name && !medicationAssignedToMember(m, memberId));

    const strengthSelect = document.getElementById('sched-strength-display');
    const unitsDisp = document.getElementById('sched-units-display');

    // Clear the dropdown first
    strengthSelect.innerHTML = '';

    if (matches.length > 0) {
        matches.forEach(med => {
            const opt = document.createElement('option');
            opt.value = med.id; // Store the ID so we know exactly which one was picked
            opt.innerText = formatMedStrength(med);
            strengthSelect.appendChild(opt);
        });

        // Update units display based on the first match
        if (unitsDisp) unitsDisp.innerText = matches[0].units;
        const prescriberSelect = document.getElementById('sched-prescriber');
        if (prescriberSelect && !prescriberSelect.value && matches[0].prescriberId) prescriberSelect.value = matches[0].prescriberId;
        input.style.backgroundColor = "#e0ffe0";
        calculateLiveDose();
    } else {
        if (unitsDisp) unitsDisp.innerText = 'units';
        input.style.backgroundColor = blockedMatches.length ? "#ffe0e0" : "";
    }
    updateScheduleMedicationPreview();
};

window.updateScheduleMedicationPreview = function() {
    const preview = document.getElementById('sched-med-preview');
    if (!preview) return;
    const medId = document.getElementById('sched-strength-display')?.value || '';
    const med = db.inventory.find(item => item.id === medId);
    if (!med) {
        preview.innerHTML = '<div class="empty-state">Select a medication.</div>';
        return;
    }
    const image = med.imagePath
        ? `<img src="${imageSrc(med.imagePath)}" alt="${escapeHtml(med.name)}">`
        : '<div class="schedule-med-no-photo">No Photo</div>';
    preview.innerHTML = `
        <div class="schedule-med-photo">${image}</div>
        <div class="schedule-med-details">
            <div><b>${escapeHtml(med.name)}</b></div>
            <div>${escapeHtml(formatMedStrength(med))}</div>
            <div>On hand: ${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))}</div>
            <div>Expires: ${escapeHtml(med.expiry || 'N/A')}</div>
            ${med.notes ? `<div>${escapeHtml(med.notes)}</div>` : ''}
        </div>`;
};

//Scheduler checks every minute to see if any meds are due and sends a notification
function reminderWasSent(key) {
    return notifiedDoseKeys.has(key) || (Array.isArray(db.reminderLog) && db.reminderLog.includes(key));
}

function recordReminderSent(key) {
    notifiedDoseKeys.add(key);
    if (!Array.isArray(db.reminderLog)) db.reminderLog = [];
    if (!db.reminderLog.includes(key)) db.reminderLog.push(key);
}

function pruneReminderLog(todayKey) {
    if (!Array.isArray(db.reminderLog)) db.reminderLog = [];
    const cutoff = parseLocal(todayKey);
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffKey = localDateKey(cutoff);
    db.reminderLog = db.reminderLog.filter(key => String(key).slice(0, 10) >= cutoffKey);
    notifiedDoseKeys.clear();
    db.reminderLog.forEach(key => notifiedDoseKeys.add(key));
}

async function checkSchedules() {
    const now = new Date();
    const todayKey = localDateKey(now);
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    pruneReminderLog(todayKey);
    let reminderLogChanged = false;

    for (const s of db.schedules) {
        if (!isScheduleDueOnDate(s, todayKey) ||
            !getScheduleTimes(s).includes(currentTime) ||
            isScheduleInstanceDocumented(s.id, todayKey, currentTime)) continue;

        const med = db.inventory.find(m => m.id === s.medId);
        const member = db.family.find(f => f.id === s.memberId);
        if (!med || !member) continue;

        const notificationPrefs = member.notificationPrefs || {};
        const reminderBaseKey = `${todayKey}|${member.id}|${med.id}|${currentTime}`;
        const desktopKey = `${reminderBaseKey}|desktop`;
        const emailKey = `${reminderBaseKey}|email`;

        if (notificationPrefs.medicationReminders !== false && !reminderWasSent(desktopKey)) {
            await Promise.resolve(window.api.notify("Medication Due!", `${member.firstName} needs ${med.name} at ${currentTime}`));
            recordReminderSent(desktopKey);
            reminderLogChanged = true;
        }

        if (member.email && notificationPrefs.emailReminders === true && !reminderWasSent(emailKey)) {
            await Promise.resolve(window.api.sendEmail({
                to: member.email,
                subject: `PharmAtlas: Medication Reminder for ${member.firstName}`,
                body: `Hello, this is a reminder to take ${formatQtyForSchedule(s, med)} of ${med.name} (${formatMedStrength(med, true)}) at ${currentTime}.\nInstructions: ${s.instructions || 'None'}`
            }));
            recordReminderSent(emailKey);
            reminderLogChanged = true;
        }
    }

    if (reminderLogChanged) await window.api.save(db);
}

setInterval(checkSchedules, 60 * 1000); // Check every minute

window.toggleQODDate = function() {
    renderFrequencyControls('sched');
};

function buildScheduleFromEntry(id = `pending-${Date.now()}-${Math.random().toString(16).slice(2)}`) {
    const memberId = document.getElementById('select-member').value;
    const medId = document.getElementById('sched-strength-display').value;
    const med = db.inventory.find(m => m.id === medId);
    const member = db.family.find(m => m.id === memberId);

    const selectedFreq = document.getElementById('sched-freq')?.value || '';
    const startDate = selectedFreq === 'QOD'
        ? (document.getElementById('qod-start-date')?.value || document.getElementById('sched-start').value)
        : document.getElementById('sched-start').value;
    const rawEndDate = document.getElementById('sched-end').value || "Ongoing";

    const instructions = document.getElementById('sched-instructions').value;

    if (!member) return alert("Select a family member first.");
    if (!med || !startDate) return alert("Select medication name, strength, and start date!");
    if (!medicationAssignedToMember(med, memberId)) {
        return alert(`${med.name} is not assigned to ${memberDisplayName(member)}. Open the medication profile in Inventory to assign it first.`);
    }

    const frequencyDetails = collectFrequencyDetails('sched');
    if (!frequencyDetails) return;
    const endDate = frequencyDetails.freq === 'ONCE' ? startDate : rawEndDate;
    if (endDate !== "Ongoing" && endDate < startDate) return alert("End date cannot be before the start date.");
    const selectedLinkTargetIds = selectedOptionValues(document.getElementById('sched-link-target'));
    const linkMode = document.getElementById('sched-link-mode')?.value || '';
    const linkTargetIds = linkMode ? selectedLinkTargetIds : [];
    const targetChoice = scheduleLinkChoices(memberId).find(choice => choice.id === linkTargetIds[0]);
    const linkGroup = linkMode && targetChoice ? linkGroupFromTarget(targetChoice.id) : '';
    if (selectedLinkTargetIds.length > 0 && !linkMode) return alert("Choose what the medication link means: must take together or choose only one.");
    if (linkMode && linkTargetIds.length === 0) return alert("Select the medication this one is linked to.");

    const schedule = {
        id,
        memberId,
        medId: med.id,
        doseQty: document.getElementById('sched-dose-qty').value,
        prescriberId: document.getElementById('sched-prescriber')?.value || med.prescriberId || '',
        freq: frequencyDetails.freq,
        startDate,
        endDate,
        instructions: instructions,
        linkGroup,
        linkMode,
        linkTargetIds,
        linkTargetId: linkTargetIds[0] || '',
        linkRules: linkRulesFromTargets(linkTargetIds, linkMode),
        qodStart: frequencyDetails.freq === 'QOD' ? (document.getElementById('qod-start-date').value || startDate) : "",
        times: frequencyDetails.times,
        intervalHours: frequencyDetails.intervalHours,
        intervalWeeks: frequencyDetails.intervalWeeks || null,
        monthlyAnchor: frequencyDetails.monthlyAnchor || '',
        timesPerWeek: frequencyDetails.timesPerWeek || null,
        weekdays: frequencyDetails.weekdays || [],
        prnMaxDoses: frequencyDetails.prnMaxDoses || null,
        prnWindowHours: frequencyDetails.prnWindowHours || 24,
        startTime: frequencyDetails.startTime || frequencyDetails.times[0] || "",
        isOneTime: frequencyDetails.freq === 'ONCE' || (startDate === endDate && endDate !== "Ongoing")
    };
    if (linkMode === 'together') {
        const allChoices = [...db.schedules, ...pendingScheduleOrders];
        const mismatchedTarget = linkTargetIds
            .map(targetId => allChoices.find(choice => choice.id === targetId))
            .find(target => target && !schedulesHaveAlignedTiming(schedule, target));
        if (mismatchedTarget) {
            return alert(`Must-take-together medications need the same date, frequency, and administration time.\n\nThis order: ${timingMismatchLabel(schedule)}\nLinked order: ${timingMismatchLabel(mismatchedTarget)}`);
        }
    }
    return schedule;
}

function clearScheduleEntryFields() {
    document.getElementById('med-search-input').value = '';
    document.getElementById('sched-freq').value = 'QD';
    document.getElementById('sched-start').value = '';
    document.getElementById('sched-end').value = '';
    document.getElementById('sched-dose-qty').value = '';
    document.getElementById('sched-calculated-dose').value = '';
    document.getElementById('sched-instructions').value = '';
    const linkTarget = document.getElementById('sched-link-target');
    if (linkTarget) {
        linkTarget.dataset.values = '';
        linkTarget.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
    }
    const linkMode = document.getElementById('sched-link-mode');
    if (linkMode) linkMode.value = '';
    document.getElementById('sched-strength-display').innerHTML = '';
    document.getElementById('sched-units-display').innerText = '';
    const schedPrescriber = document.getElementById('sched-prescriber');
    if (schedPrescriber) schedPrescriber.value = '';
    const intervalHours = document.getElementById('sched-interval-hours');
    if (intervalHours) intervalHours.value = '8';
    const intervalWeeks = document.getElementById('sched-interval-weeks');
    if (intervalWeeks) intervalWeeks.value = '2';
    const timesPerWeek = document.getElementById('sched-times-per-week');
    if (timesPerWeek) timesPerWeek.value = '3';
    const prnMax = document.getElementById('sched-prn-max-doses');
    if (prnMax) prnMax.value = '';
    const prnWindow = document.getElementById('sched-prn-window-hours');
    if (prnWindow) prnWindow.value = '24';
    const monthlyAnchor = document.getElementById('sched-monthly-anchor');
    if (monthlyAnchor) monthlyAnchor.value = '';
    const qodStart = document.getElementById('qod-start-date');
    if (qodStart) qodStart.value = '';
    setWeekdaySelections('sched-weekday-container', []);
    renderFrequencyControls('sched');
    document.querySelectorAll('#sched-time-fields input[type="time"]').forEach(input => { input.value = ''; });
    updateScheduleMedicationPreview();
    renderScheduleLinkOptions();
}

function scheduleSummaryLine(schedule) {
    const med = db.inventory.find(item => item.id === schedule.medId);
    const member = db.family.find(item => item.id === schedule.memberId);
    const dates = schedule.endDate && schedule.endDate !== 'Ongoing'
        ? `${schedule.startDate} - ${schedule.endDate}`
        : `${schedule.startDate} - Ongoing`;
    const times = getScheduleTimes(schedule).join(', ') || 'PRN';
    const qty = med ? formatQtyForSchedule(schedule, med) : `${schedule.doseQty || ''}`;
    const dose = med ? formatPrescribedDose(med, schedule.doseQty) : '';
    const linked = linkedSchedulesFor(schedule, [...db.schedules, ...pendingScheduleOrders]);
    const linkText = linked.length > 0
        ? `Linked ${linkedBadgeHtml(schedule, [...db.schedules, ...pendingScheduleOrders])}`
        : '';
    return {
        med,
        member,
        html: `<span class="pending-order-title">${escapeHtml(med?.name || 'Unknown medication')} <em>${escapeHtml(med ? formatMedStrength(med) : '')}</em></span>
            <span class="pending-order-chips">
                <span>${escapeHtml(qty)}</span>
                ${dose ? `<span>Dose ${escapeHtml(dose)}</span>` : ''}
                <span>${escapeHtml(formatFrequency(schedule))}</span>
                <span>${escapeHtml(times)}</span>
                ${linkText ? `<span class="pending-link-chip">${linkText}</span>` : ''}
                ${schedule.allergyOverride ? '<span class="pending-allergy-chip">Allergy override</span>' : ''}
            </span>
            <span class="pending-order-meta">${escapeHtml(member ? memberDisplayName(member) : 'No member')} | ${escapeHtml(dates)}</span>
            ${linkedDetailsHtml(schedule, [...db.schedules, ...pendingScheduleOrders])}
            ${schedule.instructions ? `<span class="pending-order-note">${escapeHtml(schedule.instructions)}</span>` : ''}`
    };
}

async function confirmAllergyOverrideForSchedule(schedule) {
    const member = db.family.find(item => item.id === schedule?.memberId);
    const med = db.inventory.find(item => item.id === schedule?.medId);
    if (!member || !med) return true;
    const matches = medicationAllergyMatches(member, med);
    if (matches.length === 0) return true;
    if (schedule.allergyOverride?.comment) return true;
    const matchRows = matches.map(record => `<li><strong>${escapeHtml(allergyTypeLabel(record.type))}:</strong> ${escapeHtml(allergyDisplayName(record))}${record.reaction ? ` - ${escapeHtml(record.reaction)}` : ''}</li>`).join('');
    const result = await showActionModal('ALLERGY / INTOLERANCE WARNING', `
        <div class="allergy-warning-modal">
            <strong>${escapeHtml(memberDisplayName(member))}</strong> has the following allergy/intolerance record(s) that match <strong>${escapeHtml(med.name)}</strong>:
            <ul>${matchRows}</ul>
            <label>Override reason / comment required:</label>
            <textarea name="overrideComment" rows="3" style="width:100%; resize:none;" placeholder="Explain why this medication is still being scheduled."></textarea>
        </div>
    `, 'Accept Override');
    if (!result) return false;
    const comment = String(result.overrideComment || '').trim();
    if (!comment) {
        await appAlert('An override comment is required before this medication can be scheduled.', 'Override Required');
        return false;
    }
    schedule.allergyOverride = {
        comment,
        date: new Date().toISOString(),
        matches: matches.map(record => ({
            type: record.type,
            medId: record.medId || '',
            name: allergyDisplayName(record),
            reaction: record.reaction || ''
        }))
    };
    return true;
}

function scheduleSafetyWarnings(schedule) {
    const warnings = [];
    const member = db.family.find(item => item.id === schedule?.memberId);
    const med = db.inventory.find(item => item.id === schedule?.medId);
    if (!schedule || !member || !med) return warnings;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = med.expiry ? parseLocal(med.expiry) : null;
    if (expiry && expiry < today) warnings.push(`${med.name} is expired (${med.expiry}).`);
    if (parseAmount(med.stock, 0) <= parseAmount(med.minThreshold, 0)) warnings.push(`${med.name} is at or below the low-stock alert quantity.`);
    if (!medicationAssignedToMember(med, member.id)) warnings.push(`${med.name} is not assigned to ${memberDisplayName(member)}.`);
    if (schedule.freq !== 'PRN') {
        const totalNeeded = getScheduleInstancesInRange(schedule, schedule.startDate, schedule.endDate === 'Ongoing' ? addDaysKey(localDateKey(), 30) : schedule.endDate)
            .length * parseAmount(schedule.doseQty, 0);
        if (!usesContainerTracking(med) && totalNeeded > parseAmount(med.stock, 0)) warnings.push(`The selected schedule may require ${formatAmount(totalNeeded)} ${inventoryUnitFor(med)}, more than current stock.`);
    }
    if (schedule.linkMode === 'together') {
        const allChoices = [...db.schedules, ...pendingScheduleOrders];
        const mismatch = uniqueValues(schedule.linkTargetIds?.length ? schedule.linkTargetIds : (schedule.linkTargetId ? [schedule.linkTargetId] : []))
            .map(targetId => allChoices.find(choice => choice.id === targetId))
            .find(target => target && !schedulesHaveAlignedTiming(schedule, target));
        if (mismatch) warnings.push('A must-take-together linked medication does not have matching dates, frequency, or administration times.');
    }
    return warnings;
}

async function confirmScheduleSafetyWarnings(schedule) {
    const warnings = scheduleSafetyWarnings(schedule);
    if (warnings.length === 0 || schedule.safetyOverride?.comment) return true;
    const result = await showActionModal('Medication Scheduling Warning', `
        <div class="safety-warning-modal">
            <div class="safety-warning-title">Review before scheduling</div>
            <ul>${warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>
            <label>Override/comment:</label>
            <textarea name="safetyComment" rows="3" style="width:100%; resize:none;" placeholder="Reason for continuing, stock plan, or correction made."></textarea>
        </div>
    `, 'Continue');
    if (!result) return false;
    const comment = String(result.safetyComment || '').trim();
    if (!comment) {
        await appAlert('Enter a comment to continue after a scheduling warning.');
        return false;
    }
    schedule.safetyOverride = {
        comment,
        warnings,
        date: new Date().toISOString()
    };
    addAudit('Safety override', db.inventory.find(item => item.id === schedule.medId)?.name || 'Medication', warnings.join(' '));
    return true;
}

window.renderPendingScheduleOrders = function() {
    const container = document.getElementById('pending-schedule-list');
    if (!container) return;
    const memberId = document.getElementById('select-member')?.value || '';
    const visibleOrders = pendingScheduleOrders.filter(order => !memberId || order.memberId === memberId);
    if (visibleOrders.length === 0) {
        container.innerHTML = '<div class="empty-state">No pending scheduled medications.</div>';
        return;
    }
    container.innerHTML = visibleOrders.map(order => {
        const originalIndex = pendingScheduleOrders.findIndex(item => item.id === order.id);
        const summary = scheduleSummaryLine(order);
        return `<div class="pending-order-row">
            <input class="pending-order-check" type="checkbox" name="pendingScheduleIds" value="${escapeHtml(order.id)}" checked aria-label="Sign this pending order">
            <div class="pending-order-copy">${summary.html}</div>
            <div class="pending-order-actions">
                <button type="button" onclick="editPendingScheduleOrder(${originalIndex})">Modify</button>
                <button type="button" onclick="removePendingScheduleOrder(${originalIndex})">Remove</button>
            </div>
        </div>`;
    }).join('');
};

window.clearPendingScheduleOrders = async function() {
    const memberId = document.getElementById('select-member')?.value || '';
    const targetCount = pendingScheduleOrders.filter(order => !memberId || order.memberId === memberId).length;
    if (targetCount === 0) return;
    if (!await appConfirm('Remove all pending scheduled medications for the selected member?', 'Remove Pending')) return;
    pendingScheduleOrders = pendingScheduleOrders.filter(order => memberId && order.memberId !== memberId);
    renderPendingScheduleOrders();
};

window.removePendingScheduleOrder = function(index) {
    if (index < 0 || index >= pendingScheduleOrders.length) return;
    pendingScheduleOrders.splice(index, 1);
    renderPendingScheduleOrders();
};

window.editPendingScheduleOrder = function(index) {
    const order = pendingScheduleOrders[index];
    if (!order) return;
    const med = db.inventory.find(item => item.id === order.medId);
    pendingScheduleOrders.splice(index, 1);
    if (document.getElementById('select-member')) document.getElementById('select-member').value = order.memberId;
    renderSchedulePrescriberOptions();
    document.getElementById('med-search-input').value = med?.name || '';
    updateSchedStrength();
    document.getElementById('sched-strength-display').value = order.medId;
    document.getElementById('sched-dose-qty').value = order.doseQty || '';
    document.getElementById('sched-prescriber').value = order.prescriberId || med?.prescriberId || '';
    document.getElementById('sched-freq').value = order.freq || 'QD';
    document.getElementById('sched-start').value = order.startDate || '';
    document.getElementById('sched-end').value = order.endDate === 'Ongoing' ? '' : (order.endDate || '');
    document.getElementById('sched-instructions').value = order.instructions || '';
    renderScheduleLinkOptions(order.linkTargetIds?.length ? order.linkTargetIds : (order.linkTargetId || ''));
    document.getElementById('sched-link-mode').value = order.linkMode || '';
    document.getElementById('qod-start-date').value = order.qodStart || order.startDate || '';
    document.getElementById('sched-interval-hours').value = order.intervalHours || 8;
    document.getElementById('sched-interval-weeks').value = order.intervalWeeks || 2;
    document.getElementById('sched-monthly-anchor').value = order.monthlyAnchor || order.startDate || '';
    document.getElementById('sched-times-per-week').value = order.timesPerWeek || Math.max(order.weekdays?.length || 0, 1);
    document.getElementById('sched-prn-max-doses').value = order.prnMaxDoses || '';
    document.getElementById('sched-prn-window-hours').value = order.prnWindowHours || 24;
    renderFrequencyControls('sched', order.freq === 'QXH' ? [order.startTime || getScheduleTimes(order)[0]] : getScheduleTimes(order));
    setWeekdaySelections('sched-weekday-container', order.weekdays || []);
    calculateLiveDose();
    updateScheduleMedicationPreview();
    renderPendingScheduleOrders();
};

window.finalizePendingScheduleOrders = async function() {
    const container = document.getElementById('pending-schedule-list');
    const selectedIds = Array.from(container?.querySelectorAll('input[name="pendingScheduleIds"]:checked') || []).map(input => input.value);
    if (selectedIds.length === 0) {
        await appAlert('Check at least one pending order to sign.');
        return;
    }
    const selected = pendingScheduleOrders.filter(order => selectedIds.includes(order.id));
    for (const order of selected) {
        const allowed = await confirmAllergyOverrideForSchedule(order);
        if (!allowed) return;
        const safetyAllowed = await confirmScheduleSafetyWarnings(order);
        if (!safetyAllowed) return;
    }
    const idMap = new Map(selected.map(order => [order.id, Date.now().toString() + Math.random().toString(16).slice(2)]));
    selected.forEach(order => {
        const mappedTargets = uniqueValues(order.linkTargetIds?.length ? order.linkTargetIds : (order.linkTargetId ? [order.linkTargetId] : []))
            .map(targetId => idMap.get(targetId) || targetId);
        db.schedules.push({
            ...order,
            id: idMap.get(order.id),
            linkTargetIds: mappedTargets,
            linkTargetId: mappedTargets[0] || '',
            linkRules: linkRulesFromTargets(mappedTargets, order.linkMode || ''),
            linkGroup: order.linkMode && mappedTargets[0] ? linkGroupFromTarget(mappedTargets[0]) : ''
        });
        const med = db.inventory.find(item => item.id === order.medId);
        const member = db.family.find(item => item.id === order.memberId);
        addAudit('Medication scheduled', med?.name || 'Medication', `${member ? memberDisplayName(member) : 'Unknown member'} | ${formatFrequency(order)} ${getScheduleTimes(order).join(', ') || 'PRN'}`);
    });
    pendingScheduleOrders = pendingScheduleOrders.filter(order => !selectedIds.includes(order.id));
    await sync();
    renderPendingScheduleOrders();
    await appAlert(`${selected.length} medication${selected.length === 1 ? '' : 's'} added to the member profile.`, 'Medications Scheduled');
};

window.addSchedule = async function() {
    const schedule = buildScheduleFromEntry();
    if (!schedule) return;
    if (!await confirmAllergyOverrideForSchedule(schedule)) return;
    if (!await confirmScheduleSafetyWarnings(schedule)) return;
    pendingScheduleOrders.push(schedule);
    clearScheduleEntryFields();
    renderPendingScheduleOrders();
};


async function getAdministrationStockPlan(med, sched, actual = {}) {
    const doseUnit = med.administrationUnit || med.formulation || 'unit(s)';
    if (usesContainerTracking(med)) {
        return {
            qtyToSubtract: 0,
            logDetail: `${formatAmount(parseAmount(sched.doseQty, 0))} ${doseUnit}; ${inventoryUnitFor(med)} inventory is reduced only when a container is marked finished`
        };
    }

    const qtyToSubtract = parseAmount(sched.doseQty, 0);
    if (actual.inventorySource && actual.inventorySource !== 'main') {
        const kitResult = consumeFromKitSource(actual.inventorySource, med, qtyToSubtract);
        if (kitResult.error) {
            await appAlert(kitResult.error);
            return null;
        }
        return {
            qtyToSubtract: 0,
            logDetail: `${formatAmount(qtyToSubtract)} ${doseUnit} from ${kitResult.sourceLabel}`
        };
    }
    if (parseAmount(med.stock) < qtyToSubtract) {
        await appAlert(`Insufficient stock. You need ${formatAmount(qtyToSubtract)}, but only have ${formatAmount(parseAmount(med.stock))} left.`);
        return null;
    }
    return {
        qtyToSubtract,
        logDetail: `${formatAmount(qtyToSubtract)} ${doseUnit} from Main inventory`
    };
}

function parseHistoryTimestamp(timestamp) {
    const match = String(timestamp || '').match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
    if (!match) return null;
    const [year, month, day] = match[1].split('-').map(Number);
    const [hour, minute] = match[2].split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute);
}

function prnDoseLimitInfo(schedule, actual, excludeEntryId = '') {
    const maxDoses = parseInt(schedule.prnMaxDoses, 10);
    if (schedule.freq !== 'PRN' || !Number.isInteger(maxDoses) || maxDoses < 1) return null;
    const windowHours = parseInt(schedule.prnWindowHours, 10) || 24;
    const actualDate = actual?.actualDate;
    const actualTime = actual?.actualTime;
    const med = db.inventory.find(item => item.id === schedule.medId);
    const target = parseHistoryTimestamp(`${actualDate} ${actualTime}`);
    if (!actualDate || !actualTime || !target) return null;
    const windowMs = windowHours * 60 * 60 * 1000;
    const rangeStart = new Date(target.getTime() - windowMs);
    const rangeEnd = new Date(target.getTime() + windowMs);
    const matchingEntries = db.history.filter(entry => {
        if (entry.id === excludeEntryId || !isGivenStatus(entry.doseStatus || 'given')) return false;
        const sameOrder = entry.scheduleId === schedule.id;
        const sameMemberMedication = entry.memberId === schedule.memberId && med && entry.medName === med.name;
        if (!sameOrder && !sameMemberMedication) return false;
        const timestamp = parseHistoryTimestamp(entry.timestamp);
        return timestamp && timestamp >= rangeStart && timestamp <= rangeEnd;
    });
    return { maxDoses, windowHours, count: matchingEntries.length, targetDoseCount: matchingEntries.length + 1 };
}

async function confirmPrnDoseLimitOverride(schedule, med, actual, excludeEntryId = '') {
    const info = prnDoseLimitInfo(schedule, actual, excludeEntryId);
    if (!info || info.targetDoseCount <= info.maxDoses) return true;
    const result = await showActionModal('PRN Maximum Dose Warning', `
        <div style="color:#b00000; font-weight:bold; font-size:12px; margin-bottom:8px;">
            Documenting this dose would make ${info.targetDoseCount} dose${info.targetDoseCount === 1 ? '' : 's'} within the ${info.windowHours} hour PRN safety window.
        </div>
        <div style="font-size:11px; margin-bottom:8px;">
            Maximum allowed: ${info.maxDoses} dose${info.maxDoses === 1 ? '' : 's'} per ${info.windowHours} hour${info.windowHours === 1 ? '' : 's'} for ${escapeHtml(med.name)}.
        </div>
        <div style="font-size:11px; margin-bottom:8px;">
            PharmAtlas counts each documented administration as 1 dose of the ordered quantity: ${escapeHtml(formatQtyForSchedule(schedule, med))}.
        </div>
        <div class="field-row">
            <input id="prn-override-confirm" name="overrideConfirmed" type="checkbox" value="yes">
            <label for="prn-override-confirm" style="font-size:11px;">Confirm override and document the reason in the note.</label>
        </div>
    `, 'Override', body => ({ overrideConfirmed: body.querySelector('input[name="overrideConfirmed"]')?.checked ? 'yes' : '' }));
    if (!result) return false;
    if (result.overrideConfirmed !== 'yes') {
        await appAlert('Check the override confirmation box to continue.');
        return false;
    }
    actual.prnLimitOverride = true;
    return true;
}

async function administerScheduleRecord(sched, actual, sourceLabel = 'Schedule') {
    const med = db.inventory.find(m => m.id === sched.medId);
    if (!med || !sched) return false;
    const status = actual.doseStatus || 'given';
    const isGivenDose = !['skipped', 'missed'].includes(status);
    const instanceDate = actual.scheduledDate || (sched.freq === 'PRN' ? actual.actualDate : '');
    const instanceTime = actual.scheduledTime || (sched.freq === 'PRN' ? actual.actualTime : '');
    const instanceKey = instanceDate && instanceTime
        ? scheduleInstanceKey(sched.id, instanceDate, instanceTime)
        : '';

    if (instanceKey && db.history.some(entry => entry.scheduleInstanceKey === instanceKey)) {
        await appAlert(sched.freq === 'PRN'
            ? "A PRN administration is already documented for that exact date and time."
            : "That scheduled dose instance has already been documented.");
        return false;
    }

    if (isGivenDose && sched.freq === 'PRN') {
        const allowed = await confirmPrnDoseLimitOverride(sched, med, actual);
        if (!allowed) return false;
    }

    const stockPlan = isGivenDose
        ? await getAdministrationStockPlan(med, sched, actual)
        : { qtyToSubtract: 0, logDetail: 'No dose administered' };
    if (!stockPlan) return false;

    med.stock = parseAmount(med.stock) - stockPlan.qtyToSubtract;
    const scheduledText = actual.scheduledDate && actual.scheduledTime
        ? `scheduled ${actual.scheduledDate} ${actual.scheduledTime}; `
        : '';
    const noteText = actual.doseNote ? `; Note: ${actual.doseNote}` : '';
    const overrideText = actual.prnLimitOverride ? '; PRN maximum override confirmed' : '';
    const historyEntry = {
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        timestamp: formatActualTimestamp(actual),
        memberId: sched.memberId,
        memberName: memberDisplayName(db.family.find(member => member.id === sched.memberId)),
        medId: med.id,
        medName: med.name,
        scheduleId: sched.id,
        scheduledDate: instanceDate,
        scheduledTime: instanceTime,
        scheduleInstanceKey: instanceKey,
        isPrnAdministration: sched.freq === 'PRN',
        doseStatus: status,
        doseNote: actual.doseNote || '',
        prnLimitOverride: !!actual.prnLimitOverride,
        sourceLabel,
        stockDelta: isGivenDose ? stockPlan.qtyToSubtract : (usesContainerTracking(med) ? 0 : parseAmount(sched.doseQty, 0)),
        stockLogDetail: stockPlan.logDetail,
        details: `${doseStatusLabel(status)}; ${scheduledText}${stockPlan.logDetail} via ${sourceLabel}${overrideText}${noteText}`
    };
    db.history.unshift(historyEntry);
    addAudit('Dose documented', med.name, `${memberDisplayName(db.family.find(member => member.id === sched.memberId))} | ${doseStatusLabel(status)} | ${formatActualTimestamp(actual)}`);

    if (sched.isOneTime) markScheduleCompleted(sched);
    updateSchedulePatternAfterAdministration(sched, actual, historyEntry);
    return true;
}

function shiftedWeekdays(weekdays, dayDelta) {
    const days = Array.isArray(weekdays) ? weekdays.map(Number).filter(Number.isFinite) : [];
    return Array.from(new Set(days.map(day => ((day + dayDelta) % 7 + 7) % 7))).sort((a, b) => a - b);
}

function updateSchedulePatternAfterAdministration(schedule, actual, historyEntry = null) {
    if (!schedule || !['late', 'early'].includes(actual?.doseStatus || 'given')) return;
    if (!actual.actualDate || !actual.actualTime) return;
    if (schedule.freq === 'QXH') {
        schedule.rollingAnchorDate = actual.actualDate;
        schedule.rollingAnchorTime = actual.actualTime;
        return;
    }
    const dayDelta = daysBetween(actual.actualDate, actual.scheduledDate);
    if (!Number.isFinite(dayDelta) || dayDelta === 0) return;
    if (schedule.freq === 'QOD') {
        schedule.qodStart = actual.actualDate;
        if (historyEntry) historyEntry.scheduleShiftDeltaDays = dayDelta;
        return;
    }
    if (schedule.freq === 'QW') {
        schedule.startDate = actual.actualDate;
        if (historyEntry) historyEntry.scheduleShiftDeltaDays = dayDelta;
        return;
    }
    if (schedule.freq === 'QXW' || schedule.freq === 'XPW') {
        schedule.weekdays = shiftedWeekdays(schedule.weekdays, dayDelta);
        if (schedule.startDate) schedule.startDate = dateKeyPlusDays(schedule.startDate, dayDelta) || schedule.startDate;
        if (schedule.monthlyAnchor) schedule.monthlyAnchor = dateKeyPlusDays(schedule.monthlyAnchor, dayDelta) || schedule.monthlyAnchor;
        if (historyEntry) historyEntry.scheduleShiftDeltaDays = dayDelta;
    }
}

function recalculateIntervalAnchorFromHistory(schedule) {
    if (!schedule || schedule.freq !== 'QXH') return;
    const anchor = latestIntervalAnchorFromHistory(schedule);
    if (anchor) {
        schedule.rollingAnchorDate = anchor.date;
        schedule.rollingAnchorTime = anchor.time;
    } else {
        schedule.rollingAnchorDate = '';
        schedule.rollingAnchorTime = '';
    }
}

function actualForLinkedSchedule(linkedSchedule, actual) {
    const linkedActual = { ...actual };
    if (!actual?.scheduledDate || !actual?.scheduledTime) return linkedActual;

    const sameTimeInstance = getScheduleInstancesForDate(linkedSchedule, actual.scheduledDate)
        .find(instance => instance.time === actual.scheduledTime);
    if (sameTimeInstance) {
        linkedActual.scheduledDate = sameTimeInstance.date;
        linkedActual.scheduledTime = sameTimeInstance.time;
        return linkedActual;
    }

    const actualTimeInstance = getScheduleInstancesForDate(linkedSchedule, actual.actualDate)
        .find(instance => instance.time === actual.actualTime);
    if (actualTimeInstance) {
        linkedActual.scheduledDate = actualTimeInstance.date;
        linkedActual.scheduledTime = actualTimeInstance.time;
    }
    return linkedActual;
}

function historyEntryNote(entry) {
    if (entry.doseNote) return entry.doseNote;
    const match = String(entry.details || '').match(/; Note:\s*(.*)$/);
    return match ? match[1] : '';
}

function historyEntryDateTime(entry) {
    const match = String(entry.timestamp || '').match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
    return match ? { date: match[1], time: match[2] } : defaultActualDateTime();
}

function isGivenStatus(status) {
    return !['skipped', 'missed'].includes(status);
}

function administrationStockDelta(entry, med, schedule) {
    const saved = parseAmount(entry.stockDelta, NaN);
    if (Number.isFinite(saved) && (saved > 0 || isGivenStatus(entry.doseStatus) || usesContainerTracking(med))) return saved;
    if (!med || usesContainerTracking(med)) return 0;
    const containerMatch = String(entry.details || '').match(/([0-9]+(?:\.[0-9]+)?)\s+[^;]*container removed/i);
    if (containerMatch) return parseAmount(containerMatch[1], 0);
    return schedule ? parseAmount(schedule.doseQty, 0) : 0;
}

function administrationSourceLabel(entry) {
    if (entry.sourceLabel) return entry.sourceLabel;
    const match = String(entry.details || '').match(/ via ([^;]+)/);
    return match ? match[1] : 'Schedule';
}

window.editAdministration = async function(entryId) {
    const entry = db.history.find(item => item.id === entryId);
    if (!entry?.scheduleId) return;

    const current = historyEntryDateTime(entry);
    const note = historyEntryNote(entry);
    const result = await showActionModal(`Edit Administration: ${entry.medName || 'Medication'}`, `
        <div class="field-row">
            <label>Date taken:</label><input name="actualDate" type="date" value="${current.date}">
            <label>Time:</label><input name="actualTime" type="time" value="${current.time}">
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Status:</label>
            <select name="doseStatus">
                <option value="given" ${entry.doseStatus === 'given' ? 'selected' : ''}>Given as scheduled</option>
                <option value="late" ${entry.doseStatus === 'late' ? 'selected' : ''}>Given late</option>
                <option value="early" ${entry.doseStatus === 'early' ? 'selected' : ''}>Given early</option>
                <option value="skipped" ${entry.doseStatus === 'skipped' ? 'selected' : ''}>Skipped</option>
                <option value="missed" ${entry.doseStatus === 'missed' ? 'selected' : ''}>Missed / forgotten</option>
            </select>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Note:</label><textarea name="doseNote" rows="3" style="width:100%; resize:none;">${escapeHtml(note)}</textarea>
        </div>
    `, 'Save Changes');
    if (!result) return;
    if (!result.actualDate || !result.actualTime) {
        await appAlert('Actual date and time are required.');
        return;
    }

    const nextStatus = result.doseStatus || 'given';
    const wasGiven = isGivenStatus(entry.doseStatus);
    const willBeGiven = isGivenStatus(nextStatus);
    const schedule = db.schedules.find(item => item.id === entry.scheduleId);
    const med = schedule
        ? db.inventory.find(item => item.id === schedule.medId)
        : db.inventory.find(item => item.name === entry.medName);
    const stockDelta = administrationStockDelta(entry, med, schedule);
    const nextPrnInstanceKey = schedule?.freq === 'PRN'
        ? scheduleInstanceKey(schedule.id, result.actualDate, result.actualTime)
        : '';
    if (nextPrnInstanceKey && db.history.some(item => item.id !== entry.id && item.scheduleInstanceKey === nextPrnInstanceKey)) {
        await appAlert("A PRN administration is already documented for that exact date and time.");
        return;
    }

    if (schedule?.freq !== 'PRN' && entry.scheduledDate && entry.scheduledTime) {
        result.scheduledDate = entry.scheduledDate;
        result.scheduledTime = entry.scheduledTime;
        normalizeScheduledDoseActualTime(result);
    }

    const adminTimeChanged = current.date !== result.actualDate || current.time !== result.actualTime;
    if (willBeGiven && schedule?.freq === 'PRN' && med && (!wasGiven || adminTimeChanged || !entry.prnLimitOverride)) {
        const allowed = await confirmPrnDoseLimitOverride(schedule, med, result, entry.id);
        if (!allowed) return;
        entry.prnLimitOverride = !!result.prnLimitOverride;
    } else if (!willBeGiven) {
        entry.prnLimitOverride = false;
    }

    if (wasGiven !== willBeGiven && stockDelta > 0) {
        if (!med) {
            await appAlert('The inventory medication for this administration could not be found. Stock was not changed.');
            return;
        }
        if (willBeGiven && parseAmount(med.stock) < stockDelta) {
            await appAlert(`Insufficient stock. You need ${formatAmount(stockDelta)}, but only have ${formatAmount(parseAmount(med.stock))} left.`);
            return;
        }
        med.stock = parseAmount(med.stock) + (willBeGiven ? -stockDelta : stockDelta);
    }

    const noteText = result.doseNote ? `; Note: ${result.doseNote}` : '';
    entry.timestamp = `${result.actualDate} ${result.actualTime}`;
    if (schedule?.freq === 'PRN') {
        entry.scheduledDate = result.actualDate;
        entry.scheduledTime = result.actualTime;
        entry.scheduleInstanceKey = nextPrnInstanceKey;
        entry.isPrnAdministration = true;
    }
    entry.doseStatus = nextStatus;
    entry.doseNote = result.doseNote || '';
    entry.stockDelta = stockDelta;
    const scheduledText = entry.scheduledDate && entry.scheduledTime && !entry.isPrnAdministration
        ? `scheduled ${entry.scheduledDate} ${entry.scheduledTime}; `
        : '';
    const stockDetail = willBeGiven
        ? (entry.stockLogDetail || (stockDelta > 0 ? `${formatAmount(stockDelta)} ${med?.formulation || 'unit(s)'}` : 'Dose documented'))
        : 'No dose administered';
    const overrideText = entry.prnLimitOverride ? '; PRN maximum override confirmed' : '';
    entry.details = `${doseStatusLabel(entry.doseStatus)}; ${scheduledText}${stockDetail} via ${administrationSourceLabel(entry)}${overrideText}${noteText}`;
    if (schedule?.freq === 'QXH') recalculateIntervalAnchorFromHistory(schedule);
    await sync();
};

window.administerDose = async function(medId, scheduleId) {
    const med = db.inventory.find(m => m.id === medId);
    const sched = db.schedules.find(s => s.id === scheduleId);
    if (!med || !sched) return;
    if (isScheduleArchived(sched)) {
        await appAlert('This medication is completed or discontinued. Modify or extend it before documenting new administrations.');
        return;
    }

    const actual = sched.freq === 'PRN'
        ? await requestActualAdministration(`Administer: ${med.name}`, `
            <div class="field-row" style="margin-top:8px;">
                <label>Status:</label>
                <select name="doseStatus">
                    <option value="given">Given</option>
                    <option value="late">Given late</option>
                    <option value="early">Given early</option>
                    <option value="skipped">Skipped</option>
                    <option value="missed">Missed / forgotten</option>
                </select>
            </div>
            ${kitSourceSelectHtml(med.id)}
            <div class="field-row-stacked" style="margin-top:8px;">
                <label>Note:</label><textarea name="doseNote" rows="2" style="width:100%; resize:none;"></textarea>
            </div>
        `)
        : await requestScheduledDoseDocumentation(sched, `Document Dose: ${med.name}`);
    if (!actual) return;

    const activeScheduleCandidates = db.schedules.filter(item => item.memberId === sched.memberId && item.id !== sched.id && !isScheduleArchived(item));
    const activeLinkedSchedules = linkedSchedulesFor(sched, activeScheduleCandidates)
        .filter(item => !isScheduleArchived(item));
    if (activeLinkedSchedules.some(item => schedulesLinkedByMode(sched, item, 'choose-one'))) {
        const linkedIds = activeLinkedSchedules
            .filter(item => schedulesLinkedByMode(sched, item, 'choose-one'))
            .map(item => item.id);
        const alreadyDocumented = db.history.some(entry =>
            linkedIds.includes(entry.scheduleId) &&
            String(entry.timestamp || '').startsWith(`${actual.actualDate} ${actual.actualTime}`)
        );
        if (alreadyDocumented && !await appConfirm('Another linked medication in this choose-one group is already documented for that date/time. Override and document this one too?', 'Linked Medication Warning')) {
            return;
        }
    }

    const administered = await administerScheduleRecord(sched, actual, sched.orderSetName ? `Regimen (${sched.orderSetName})` : 'Schedule');
    if (administered) {
        const linkedSchedules = requiredTogetherSchedules(sched, [sched, ...activeScheduleCandidates]);
        if (linkedSchedules.length > 0 && await appConfirm(`Also document ${linkedSchedules.length} linked medication${linkedSchedules.length === 1 ? '' : 's'} with the same administration date/time?`, 'Linked Medications')) {
            for (const linkedSchedule of linkedSchedules) {
                await administerScheduleRecord(linkedSchedule, actualForLinkedSchedule(linkedSchedule, actual), linkedSchedule.orderSetName ? `Regimen (${linkedSchedule.orderSetName})` : 'Linked Schedule');
            }
        }
    }
    if (administered) await sync();
};

window.finishTopicalContainer = async function(scheduleId) {
    const schedule = db.schedules.find(item => item.id === scheduleId);
    const med = schedule && db.inventory.find(item => item.id === schedule.medId);
    if (!schedule || !med || !usesContainerTracking(med)) return;

    const defaults = defaultActualDateTime();
    const result = await showActionModal(`${finishedContainerButtonText(med)}: ${med.name}`, `
        <div style="font-size:11px; margin-bottom:8px;">Mark the bottle or container as finished. Inventory will be reduced and this medication will be discontinued automatically.</div>
        <div class="field-row">
            <label>Date:</label><input name="actualDate" type="date" value="${defaults.date}">
            <label>Time:</label><input name="actualTime" type="time" value="${defaults.time}">
        </div>
        <div class="field-row" style="margin-top:8px;">
            <label>Containers finished (${escapeHtml(inventoryUnitFor(med))}):</label>
            <input name="containers" type="number" min="0.1" step="0.1" value="1" style="width:65px;">
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Note:</label><textarea name="note" rows="2" style="width:100%; resize:none;"></textarea>
        </div>
    `, 'Mark Finished');
    if (!result) return;

    const containers = parseAmount(result.containers, NaN);
    if (!result.actualDate || !result.actualTime || !Number.isFinite(containers) || containers <= 0) {
        await appAlert('Enter the completion date, time, and at least one container.');
        return;
    }
    if (parseAmount(med.stock) < containers) {
        await appAlert(`Insufficient inventory. Only ${formatAmount(parseAmount(med.stock))} ${inventoryUnitFor(med)} remain.`);
        return;
    }

    med.stock = parseAmount(med.stock) - containers;
    db.history.unshift({
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        timestamp: `${result.actualDate} ${result.actualTime}`,
        memberId: schedule.memberId,
        memberName: memberDisplayName(db.family.find(member => member.id === schedule.memberId)),
        medId: med.id,
        medName: med.name,
        scheduleId: schedule.id,
        doseStatus: 'container-finished',
        sourceLabel: schedule.orderSetName ? `Regimen (${schedule.orderSetName})` : 'Schedule',
        stockDelta: containers,
        stockLogDetail: `${formatAmount(containers)} ${inventoryUnitFor(med)} marked finished`,
        details: `${formatAmount(containers)} ${inventoryUnitFor(med)} marked finished; container inventory reduced${result.note ? `; Note: ${result.note}` : ''}`
    });
    addAudit('Container finished', med.name, `${formatAmount(containers)} ${inventoryUnitFor(med)} removed and order completed.`);
    markScheduleCompleted(schedule);
    await sync();
    const memberModal = document.getElementById('member-modal');
    if (currentEditingMemberId === schedule.memberId && memberModal?.style.display === 'flex') {
        openMemberModal(schedule.memberId);
    }
};

window.administerOrderSet = async function(orderSetId) {
    const set = db.orderSets.find(orderSet => orderSet.id === orderSetId);
    if (!set) return;

    const schedules = db.schedules.filter(schedule => schedule.orderSetId === orderSetId && !isScheduleArchived(schedule));
    activeAdminOrderSetSchedules = schedules;
    if (schedules.length === 0) {
        await appAlert("No active schedules were found for this regimen.");
        return;
    }

    const medicationChoices = schedules.map((schedule, index) => {
        const med = db.inventory.find(m => m.id === schedule.medId);
        const linked = linkedSchedulesFor(schedule, schedules);
        const linkText = linked.length > 0
            ? ` (${linked.length} linked)`
            : '';
        const label = med
            ? `${med.name} ${formatMedStrength(med)} - ${formatQtyForSchedule(schedule, med)}${linkText}`
            : 'Unknown medication';
        const inputId = `admin-os-med-${index}`;
        return `<div class="field-row" style="margin-top:5px;">
            <input id="${inputId}" class="admin-os-med" name="scheduleIds" type="checkbox" value="${escapeHtml(schedule.id)}"
                onchange="adminOrderSetToggleLinked(this)">
            <label for="${inputId}">${escapeHtml(label)}</label>
            ${linked.length ? linkedDetailsHtml(schedule, schedules) : ''}
        </div>`;
    }).join('');

    const selection = await showActionModal(`Administer Regimen: ${set.name}`, `
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Medication(s) given:</label>
            <div class="sunken-panel" style="background:white; padding:6px; max-height:160px; overflow-y:auto;">
                <button type="button" onclick="adminOrderSetSubmitAll()">Administer all</button>
                <hr>
                ${medicationChoices}
            </div>
        </div>
        <div class="form-help" style="margin-top:6px;">Linked "together" medications toggle as a group. Linked "choose one" medications allow only one selection per group.</div>
    `, 'Administer Selected');
    if (!selection) return;

    const selectedIds = selection.scheduleIds || [];
    if (selectedIds.length === 0) {
        await appAlert("Select at least one medication that was given.");
        return;
    }
    const selectedSchedules = schedules.filter(schedule => selectedIds.includes(schedule.id));
    for (let i = 0; i < selectedSchedules.length; i++) {
        for (let j = i + 1; j < selectedSchedules.length; j++) {
            if (schedulesLinkedByMode(selectedSchedules[i], selectedSchedules[j], 'choose-one')) {
                await appAlert('Only one medication can be selected from each choose-one linked regimen pair.');
                return;
            }
        }
    }
    for (const schedule of selectedSchedules) {
        const requiredTogether = requiredTogetherSchedules(schedule, schedules);
        const missing = requiredTogether.filter(other => !selectedIds.includes(other.id));
        if (missing.length > 0) {
            await appAlert('All medications marked must-take-together must be selected together.');
            return;
        }
    }

    let administeredCount = 0;
    for (const scheduleId of selectedIds) {
        const schedule = db.schedules.find(s => s.id === scheduleId);
        const med = schedule ? db.inventory.find(m => m.id === schedule.medId) : null;
        if (!schedule || !med) continue;
        const actual = schedule.freq === 'PRN'
            ? await requestActualAdministration(`Document Dose: ${med.name}`, `
                <div class="field-row" style="margin-top:8px;">
                    <label>Status:</label>
                    <select name="doseStatus">
                        <option value="given">Given</option>
                        <option value="late">Given late</option>
                        <option value="early">Given early</option>
                        <option value="skipped">Skipped</option>
                        <option value="missed">Missed / forgotten</option>
                    </select>
                </div>
                <div class="field-row-stacked" style="margin-top:8px;">
                    <label>Note:</label><textarea name="doseNote" rows="2" style="width:100%; resize:none;"></textarea>
                </div>
            `)
            : await requestScheduledDoseDocumentation(schedule, `Document Dose: ${med.name}`);
        if (!actual) continue;
        if (await administerScheduleRecord(schedule, actual, `Regimen (${set.name})`)) {
            administeredCount++;
        }
    }

    if (administeredCount > 0) {
        await sync();
        await appAlert(`Administered ${administeredCount} medication${administeredCount === 1 ? '' : 's'} from ${set.name}.`);
    }
};




window.deleteSchedule = async function(id) {
    const schedule = db.schedules.find(s => s.id === id);
    if (!schedule) return;
    const med = db.inventory.find(m => m.id === schedule.medId);
    const medLabel = med ? `${med.name} ${formatMedStrength(med)}` : 'this order';
    const activeCandidates = db.schedules.filter(item => item.memberId === schedule.memberId && !isScheduleArchived(item));
    const linked = linkedSchedulesFor(schedule, activeCandidates);
    let scope = 'single';
    if (linked.length > 0) {
        const linkedNames = linked.map(item => {
            const linkedMed = db.inventory.find(inv => inv.id === item.medId);
            return escapeHtml(linkedMed ? `${linkedMed.name} ${formatMedStrength(linkedMed)}` : 'Unknown medication');
        }).join('<br>');
        const result = await showActionModal('Discontinue Linked Medication', `
            <div style="font-size:11px; margin-bottom:8px;">${escapeHtml(medLabel)} is linked to:</div>
            <div class="sunken-panel" style="background:white; padding:5px; max-height:100px; overflow:auto;">${linkedNames}</div>
            <div class="field-row-stacked" style="margin-top:8px;">
                <label>Discontinue:</label>
                <select name="scope" style="width:100%;">
                    <option value="single">Only this medication</option>
                    <option value="linked">This medication and all linked medications</option>
                </select>
            </div>
        `, 'Discontinue');
        if (!result) return;
        scope = result.scope || 'single';
    } else if (!await appConfirm(`Discontinue ${medLabel}?`, 'Discontinue Order')) {
        return;
    }

    const schedulesToDiscontinue = scope === 'linked' ? [schedule, ...linked] : [schedule];
    schedulesToDiscontinue.forEach(item => {
        item.status = 'discontinued';
        item.completedAt = new Date().toISOString();
        if (!item.endDate || item.endDate === 'Ongoing') item.endDate = localDateKey();
        const itemMed = db.inventory.find(inv => inv.id === item.medId);
        addAudit('Medication discontinued', itemMed?.name || 'Medication', `${scope === 'linked' ? 'Linked group' : 'Single order'} | ${localDateKey()}`);
    });
    await sync();

    const memberModal = document.getElementById('member-modal');
    if (currentEditingMemberId === schedule.memberId && memberModal?.style.display === 'flex') {
        openMemberModal(schedule.memberId);
    }
};

function recipeId() {
    return `recipe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function compoundPrepId() {
    return `compound_prep_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function recipeInventoryLabel(med) {
    if (!med) return '';
    return `${med.name} ${formatMedStrength(med)} | ${formatAmount(parseAmount(med.stock))} ${inventoryUnitFor(med)} | ${med.id}`;
}

function resolveRecipeInventory(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const id = raw.split('|').pop()?.trim();
    return db.inventory.find(med => med.id === id)
        || db.inventory.find(med => recipeInventoryLabel(med).toLowerCase() === raw.toLowerCase())
        || null;
}

function recipeUnitOptions(selected = '') {
    const ingredientUnits = componentUnitOptions.filter(unit => !String(unit).includes('/'));
    const units = Array.from(new Set([...ingredientUnits, 'mL', 'bottle', 'tube', 'jar', 'container', 'application', 'tablet', 'capsule', 'spray', 'drop', 'inhalation', 'packet', 'unit']));
    if (selected && !units.includes(selected)) units.push(selected);
    return units.map(unit => `<option value="${escapeHtml(unit)}" ${unit === selected ? 'selected' : ''}>${escapeHtml(unit)}</option>`).join('');
}

function recipeRoleOptions(selected = 'active') {
    const roles = [
        ['active', 'Active ingredient'],
        ['vehicle', 'Vehicle / base'],
        ['diluent', 'Diluent'],
        ['preservative', 'Preservative'],
        ['flavor', 'Flavor / auxiliary'],
        ['packaging', 'Packaging']
    ];
    return roles.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function baseUnitFromMedication(med) {
    if (!med) return '';
    if (med.isCombination && med.components?.length) return getComponentUnit(med.components[0], med);
    if (med.units && String(med.units).includes('/')) return String(med.units).split('/')[0];
    return med.activeUnit || med.units || '';
}

function activeContributionsForIngredient(ingredient) {
    if (!ingredient || ingredient.role !== 'active') return [];
    const qty = parseAmount(ingredient.qty, NaN);
    if (!Number.isFinite(qty) || qty <= 0) return [];
    const med = ingredient.medId ? db.inventory.find(item => item.id === ingredient.medId) : null;
    if (med?.isCombination && med.components?.length) {
        return med.components.map(component => ({
            name: component.name || med.name,
            amount: parseAmount(component.strength) * qty,
            unit: getComponentUnit(component, med)
        })).filter(item => Number.isFinite(item.amount) && item.amount > 0 && item.unit);
    }
    if (med) {
        const strength = parseAmount(med.strength, NaN);
        const unit = baseUnitFromMedication(med);
        if (Number.isFinite(strength) && strength > 0 && unit) {
            return [{ name: med.name, amount: strength * qty, unit }];
        }
    }
    return [{ name: ingredient.name, amount: qty, unit: ingredient.unit || '' }].filter(item => item.name && item.unit);
}

function calculateRecipeConcentration(ingredients, yieldQty, yieldUnit) {
    const finalQty = parseAmount(yieldQty, NaN);
    const finalUnit = String(yieldUnit || '').trim();
    const rawContributions = (ingredients || []).flatMap(activeContributionsForIngredient);
    if (!rawContributions.length) return { canCalculate: false, message: 'Mark at least one ingredient as Active ingredient to calculate strength.' };
    if (!Number.isFinite(finalQty) || finalQty <= 0 || !finalUnit) return { canCalculate: false, message: 'Enter a batch yield and yield unit to calculate final concentration.' };
    const grouped = new Map();
    rawContributions.forEach(item => {
        const key = `${item.name}|${item.unit}`;
        const existing = grouped.get(key) || { name: item.name, amount: 0, unit: item.unit };
        existing.amount += item.amount;
        grouped.set(key, existing);
    });
    const contributions = Array.from(grouped.values());
    const units = Array.from(new Set(contributions.map(item => item.unit).filter(Boolean)));
    const components = contributions.map(item => ({
        name: item.name,
        strength: item.amount / finalQty,
        strengthAmount: item.amount / finalQty,
        unit: item.unit,
        perAmount: 1,
        perUnit: finalUnit
    }));
    const sameUnit = units.length === 1;
    const finalUnits = sameUnit ? `${units[0]}/${finalUnit}` : '';
    const finalStrength = sameUnit
        ? components.map(component => formatAmount(component.strengthAmount)).join('/')
        : components.map(component => `${formatAmount(component.strengthAmount)}${component.unit}/${finalUnit}`).join(' / ');
    const totalLine = contributions
        .map(item => `${item.name}: ${formatAmount(item.amount)}${item.unit}`)
        .join(' | ');
    const display = formatCombinationStrength({ isCombination: true, components }, false, true);
    return {
        canCalculate: true,
        finalStrength,
        finalUnits,
        display,
        components,
        message: `${totalLine} in ${formatAmount(finalQty)} ${finalUnit} = ${display}`
    };
}

function currentRecipeCalculationFromBuilder() {
    const ingredients = collectRecipeIngredients();
    return calculateRecipeConcentration(
        ingredients,
        document.getElementById('recipe-yield-qty')?.value,
        document.getElementById('recipe-yield-unit')?.value
    );
}

window.updateRecipeCalculation = function() {
    const auto = document.getElementById('recipe-auto-calc')?.checked !== false;
    const preview = document.getElementById('recipe-calculation-preview');
    const strength = document.getElementById('recipe-final-strength');
    const units = document.getElementById('recipe-final-units');
    const calc = currentRecipeCalculationFromBuilder();
    if (preview) {
        preview.textContent = calc.message || 'Enter an active ingredient quantity and batch yield to calculate final strength.';
        preview.className = calc.canCalculate ? 'recipe-calculation-preview ok' : 'recipe-calculation-preview';
    }
    if (strength) strength.readOnly = auto && calc.canCalculate;
    if (units) units.readOnly = auto && calc.canCalculate;
    if (auto && calc.canCalculate) {
        if (strength) strength.value = calc.finalStrength;
        if (units) units.value = calc.finalUnits;
    }
};

window.updateRecipeDosageDefaults = function() {
    const formulation = document.getElementById('recipe-formulation')?.value || 'mL';
    const yieldUnit = document.getElementById('recipe-yield-unit');
    if (yieldUnit) {
        const definition = dosageFormDefinition(formulation);
        const defaultYieldUnit = definition.perUnit || definition.stockUnit || 'unit';
        const changed = yieldUnit.dataset.formulation !== formulation;
        if (changed || !yieldUnit.value) yieldUnit.value = defaultYieldUnit;
        yieldUnit.dataset.formulation = formulation;
    }
    window.updateRecipeCalculation();
};

function normalizeCompoundRecipe(recipe) {
    if (!recipe || typeof recipe !== 'object') return recipe;
    const ingredients = (recipe.ingredients || []).map(ingredient => ({
        medId: ingredient.medId || ingredient.id || '',
        name: ingredient.name || '',
        strength: ingredient.strength || '',
        qty: ingredient.qty ?? ingredient.amount ?? '',
        unit: ingredient.unit || 'mL',
        role: ingredient.role || (ingredient.medId || ingredient.id ? 'active' : 'vehicle'),
        subtractStock: ingredient.subtractStock !== false
    }));
    return {
        ...recipe,
        name: recipe.name || recipe.finalName || 'Unnamed recipe',
        finalName: recipe.finalName || recipe.name || 'Compounded preparation',
        finalStrength: recipe.finalStrength || recipe.targetConc || recipe.strength || '',
        finalUnits: recipe.finalUnits || recipe.units || 'mg/mL',
        autoCalculate: recipe.autoCalculate !== false,
        calculatedComponents: Array.isArray(recipe.calculatedComponents) ? recipe.calculatedComponents : [],
        calculationSummary: recipe.calculationSummary || '',
        formulation: recipe.formulation || 'mL',
        yieldQty: recipe.yieldQty ?? recipe.totalVol ?? '',
        yieldUnit: recipe.yieldUnit || 'mL',
        budDays: recipe.budDays ?? '',
        storage: recipe.storage || 'Room Temp',
        controlLevel: recipe.controlLevel || 'N/A',
        minThreshold: recipe.minThreshold ?? 1,
        instructions: recipe.instructions || '',
        notes: recipe.notes || '',
        ingredients
    };
}

function updateRecipeInventoryOptions() {
    const list = document.getElementById('recipe-inventory-options');
    if (!list) return;
    list.innerHTML = db.inventory
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }))
        .map(med => `<option value="${escapeHtml(recipeInventoryLabel(med))}"></option>`)
        .join('');
}

function recipeIngredientRowHtml(item = {}, index = Date.now()) {
    const med = item.medId ? db.inventory.find(inv => inv.id === item.medId) : null;
    const searchValue = med ? recipeInventoryLabel(med) : (item.name || '');
    const unit = item.unit || (med ? inventoryUnitFor(med) : 'mL');
    const subtractChecked = item.subtractStock !== false ? 'checked' : '';
    return `<div class="recipe-ingredient-row" data-row-id="${escapeHtml(index)}">
        <input type="hidden" class="recipe-ingredient-med-id" value="${escapeHtml(item.medId || '')}">
        <label class="recipe-ingredient-search-wrap">Ingredient
            <input class="recipe-ingredient-search" list="recipe-inventory-options" value="${escapeHtml(searchValue)}" placeholder="Search inventory or type custom item" oninput="updateRecipeIngredientFromSelection(this)">
        </label>
        <label>Need<input class="recipe-ingredient-qty" type="number" step="any" value="${escapeHtml(item.qty || '')}" placeholder="Qty" oninput="updateRecipeCalculation()"></label>
        <label>Unit<select class="recipe-ingredient-unit" onchange="this.dataset.userChanged='true'; updateRecipeCalculation();">${recipeUnitOptions(unit)}</select></label>
        <label>Role<select class="recipe-ingredient-role" onchange="updateRecipeCalculation()">${recipeRoleOptions(item.role || 'active')}</select></label>
        <label class="recipe-subtract-check"><input class="recipe-ingredient-subtract" type="checkbox" ${subtractChecked}> Use inventory stock</label>
        <button type="button" class="recipe-row-remove" onclick="removeRecipeIngredientRow(this)">Remove</button>
        <div class="recipe-ingredient-match">${med ? `Inventory match: ${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))} on hand` : 'Custom/non-inventory ingredient'}</div>
    </div>`;
}

window.addRecipeIngredientRow = function(item = {}) {
    const list = document.getElementById('recipe-ingredient-list');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', recipeIngredientRowHtml(item, `row_${Date.now()}_${Math.random().toString(16).slice(2)}`));
    enhanceButtonIcons(list);
    window.updateRecipeCalculation?.();
};

window.removeRecipeIngredientRow = function(button) {
    button.closest('.recipe-ingredient-row')?.remove();
    window.updateRecipeCalculation?.();
};

window.updateRecipeIngredientFromSelection = function(input) {
    const row = input.closest('.recipe-ingredient-row');
    const med = resolveRecipeInventory(input.value);
    if (!row) return;
    row.querySelector('.recipe-ingredient-med-id').value = med?.id || '';
    if (med) {
        const unit = row.querySelector('.recipe-ingredient-unit');
        if (unit && !unit.dataset.userChanged) {
            const nextUnit = inventoryUnitFor(med);
            if (!Array.from(unit.options).some(option => option.value === nextUnit)) {
                unit.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(nextUnit)}">${escapeHtml(nextUnit)}</option>`);
            }
            unit.value = nextUnit;
        }
        const match = row.querySelector('.recipe-ingredient-match');
        if (match) match.textContent = `Inventory match: ${formatAmount(parseAmount(med.stock))} ${inventoryUnitFor(med)} on hand`;
    } else {
        const match = row.querySelector('.recipe-ingredient-match');
        if (match) match.textContent = 'Custom/non-inventory ingredient';
    }
    window.updateRecipeCalculation?.();
};

function collectRecipeIngredients() {
    const rows = Array.from(document.querySelectorAll('#recipe-ingredient-list .recipe-ingredient-row'));
    return rows.map(row => {
        const searchValue = row.querySelector('.recipe-ingredient-search')?.value || '';
        const med = resolveRecipeInventory(searchValue);
        return {
            medId: med?.id || '',
            name: med?.name || searchValue.trim(),
            strength: med ? formatMedStrength(med) : '',
            qty: parseAmount(row.querySelector('.recipe-ingredient-qty')?.value, NaN),
            unit: row.querySelector('.recipe-ingredient-unit')?.value || '',
            role: row.querySelector('.recipe-ingredient-role')?.value || 'active',
            subtractStock: row.querySelector('.recipe-ingredient-subtract')?.checked === true
        };
    }).filter(item => item.name || Number.isFinite(item.qty));
}

function resetCompoundRecipeBuilder(keepOneRow = true) {
    const fields = ['recipe-edit-id', 'recipe-name', 'recipe-final-name', 'recipe-final-strength', 'recipe-final-units', 'recipe-yield-qty', 'recipe-yield-unit', 'recipe-bud-days', 'recipe-package-size', 'recipe-min-threshold', 'recipe-instructions', 'recipe-notes'];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const storage = document.getElementById('recipe-storage');
    if (storage) storage.value = 'Room Temp';
    const control = document.getElementById('recipe-control-level');
    if (control) control.value = 'N/A';
    const formulation = document.getElementById('recipe-formulation');
    if (formulation) formulation.value = 'mL';
    const autoCalc = document.getElementById('recipe-auto-calc');
    if (autoCalc) autoCalc.checked = true;
    const list = document.getElementById('recipe-ingredient-list');
    if (list) list.innerHTML = '';
    if (keepOneRow) addRecipeIngredientRow();
    window.updateRecipeDosageDefaults?.();
    window.updateRecipeCalculation?.();
}

window.clearCompoundRecipeBuilder = function() {
    resetCompoundRecipeBuilder(true);
};

function collectCompoundRecipeFromBuilder() {
    const autoCalculate = document.getElementById('recipe-auto-calc')?.checked !== false;
    const calc = currentRecipeCalculationFromBuilder();
    const recipe = {
        id: document.getElementById('recipe-edit-id')?.value || recipeId(),
        name: document.getElementById('recipe-name')?.value.trim() || '',
        finalName: document.getElementById('recipe-final-name')?.value.trim() || '',
        finalStrength: autoCalculate && calc.canCalculate ? calc.finalStrength : (document.getElementById('recipe-final-strength')?.value.trim() || ''),
        finalUnits: autoCalculate && calc.canCalculate ? calc.finalUnits : (document.getElementById('recipe-final-units')?.value.trim() || ''),
        autoCalculate,
        calculatedComponents: autoCalculate && calc.canCalculate ? calc.components : [],
        calculationSummary: autoCalculate && calc.canCalculate ? calc.message : '',
        formulation: document.getElementById('recipe-formulation')?.value || 'mL',
        yieldQty: parseAmount(document.getElementById('recipe-yield-qty')?.value, NaN),
        yieldUnit: document.getElementById('recipe-yield-unit')?.value.trim() || '',
        budDays: parseAmount(document.getElementById('recipe-bud-days')?.value, 0),
        storage: document.getElementById('recipe-storage')?.value || 'Room Temp',
        packageSize: document.getElementById('recipe-package-size')?.value.trim() || '',
        controlLevel: document.getElementById('recipe-control-level')?.value || 'N/A',
        minThreshold: parseAmount(document.getElementById('recipe-min-threshold')?.value, 1),
        instructions: document.getElementById('recipe-instructions')?.value.trim() || '',
        notes: document.getElementById('recipe-notes')?.value.trim() || '',
        ingredients: collectRecipeIngredients(),
        updatedAt: new Date().toISOString()
    };
    if (!recipe.finalName) recipe.finalName = recipe.name;
    if (!recipe.yieldUnit) recipe.yieldUnit = defaultInventoryUnitForFormulation(recipe.formulation, 'per-dose');
    return recipe;
}

window.saveCompoundRecipe = async function() {
    const recipe = collectCompoundRecipeFromBuilder();
    if (!recipe.name || !recipe.finalName) return appAlert('Recipe name and final product name are required.');
    if (!recipe.finalStrength || (!recipe.finalUnits && !(recipe.autoCalculate && recipe.calculatedComponents?.length))) {
        return appAlert('Final strength and units are required unless the calculated strength already includes units.');
    }
    if (!Number.isFinite(recipe.yieldQty) || recipe.yieldQty <= 0) return appAlert('Batch yield must be greater than 0.');
    if (!recipe.ingredients.length) return appAlert('Add at least one ingredient.');
    const badIngredient = recipe.ingredients.find(item => !item.name || !Number.isFinite(item.qty) || item.qty <= 0 || !item.unit);
    if (badIngredient) return appAlert('Each ingredient needs a name, quantity, and unit.');
    const existingIndex = db.recipes.findIndex(item => item.id === recipe.id);
    if (existingIndex >= 0) {
        recipe.createdAt = db.recipes[existingIndex].createdAt || new Date().toISOString();
        db.recipes[existingIndex] = recipe;
    } else {
        recipe.createdAt = new Date().toISOString();
        db.recipes.unshift(recipe);
    }
    activeCompoundRecipeId = recipe.id;
    addAudit('Compounding recipe saved', recipe.name, `${recipe.finalName} ${recipe.finalStrength}${recipe.finalUnits}`);
    resetCompoundRecipeBuilder(true);
    await sync();
};

window.editCompoundRecipe = function(id) {
    const recipe = db.recipes.find(item => item.id === id);
    if (!recipe) return;
    document.getElementById('recipe-edit-id').value = recipe.id;
    document.getElementById('recipe-name').value = recipe.name || '';
    document.getElementById('recipe-final-name').value = recipe.finalName || recipe.name || '';
    document.getElementById('recipe-final-strength').value = recipe.finalStrength || '';
    document.getElementById('recipe-final-units').value = recipe.finalUnits || '';
    document.getElementById('recipe-formulation').value = recipe.formulation || 'mL';
    document.getElementById('recipe-yield-qty').value = recipe.yieldQty || '';
    document.getElementById('recipe-yield-unit').value = recipe.yieldUnit || '';
    document.getElementById('recipe-bud-days').value = recipe.budDays || '';
    document.getElementById('recipe-storage').value = recipe.storage || 'Room Temp';
    document.getElementById('recipe-package-size').value = recipe.packageSize || '';
    document.getElementById('recipe-control-level').value = recipe.controlLevel || 'N/A';
    document.getElementById('recipe-min-threshold').value = recipe.minThreshold || '';
    document.getElementById('recipe-instructions').value = recipe.instructions || '';
    document.getElementById('recipe-notes').value = recipe.notes || '';
    const autoCalc = document.getElementById('recipe-auto-calc');
    if (autoCalc) autoCalc.checked = recipe.autoCalculate !== false;
    const list = document.getElementById('recipe-ingredient-list');
    if (list) {
        list.innerHTML = '';
        (recipe.ingredients || []).forEach(item => addRecipeIngredientRow(item));
    }
    window.updateRecipeCalculation?.();
};

window.deleteCompoundRecipe = async function(id) {
    const recipe = db.recipes.find(item => item.id === id);
    if (!recipe) return;
    if (!await appConfirm(`Delete recipe "${recipe.name}"? Completed prep history and compounded inventory items will remain.`, 'Delete Recipe')) return;
    db.recipes = db.recipes.filter(item => item.id !== id);
    if (activeCompoundRecipeId === id) activeCompoundRecipeId = db.recipes[0]?.id || '';
    addAudit('Compounding recipe deleted', recipe.name, '');
    await sync();
};

window.selectCompoundRecipe = function(id) {
    activeCompoundRecipeId = id;
    renderRecipes();
};

function recipePrepDefaults(recipe) {
    const defaults = defaultActualDateTime();
    const budDate = recipe.budDays ? addDaysKey(defaults.date, parseAmount(recipe.budDays, 0)) : '';
    return {
        preparedDate: defaults.date,
        preparedTime: defaults.time,
        lot: '',
        budDate,
        qty: recipe.yieldQty || '',
        barcodeCode: createMedicationCode()
    };
}

function scaledIngredientQty(recipe, ingredient, batchQty) {
    const baseQty = parseAmount(recipe.yieldQty, NaN);
    const actualQty = parseAmount(batchQty, baseQty);
    const scale = Number.isFinite(baseQty) && baseQty > 0 && Number.isFinite(actualQty) && actualQty > 0 ? actualQty / baseQty : 1;
    return parseAmount(ingredient.qty, 0) * scale;
}

function compoundPrepIngredientRows(recipe, batchQty = recipe.yieldQty) {
    return (recipe.ingredients || []).map((ingredient, index) => {
        const med = ingredient.medId ? db.inventory.find(item => item.id === ingredient.medId) : null;
        const need = scaledIngredientQty(recipe, ingredient, batchQty);
        const stock = med ? parseAmount(med.stock, 0) : null;
        const enough = !med || !ingredient.subtractStock || stock >= need;
        const codes = med ? medicationCodes(med).join(', ') : '';
        return `<div class="compound-prep-ingredient ${enough ? '' : 'compound-prep-short'}" data-med-id="${escapeHtml(ingredient.medId || '')}" data-index="${index}">
            <label><input class="compound-prep-check" type="checkbox"> <strong>${escapeHtml(ingredient.name)}</strong></label>
            <span>${escapeHtml(formatAmount(need))} ${escapeHtml(ingredient.unit)} needed</span>
            <span>${med ? `${escapeHtml(formatAmount(stock))} ${escapeHtml(inventoryUnitFor(med))} on hand` : 'Manual/non-inventory item'}</span>
            ${codes ? `<small>Codes: ${escapeHtml(codes)}</small>` : '<small>Manual verification</small>'}
        </div>`;
    }).join('');
}

function compoundBottleLabelHtml(recipe, prep = {}) {
    const preparedDate = prep.preparedDate || localDateKey();
    const budDate = prep.budDate || (recipe.budDays ? addDaysKey(preparedDate, parseAmount(recipe.budDays, 0)) : '');
    const lot = prep.lot || '';
    const qty = prep.qty || recipe.yieldQty || '';
    const barcodeCode = normalizeMedicationCode(prep.barcodeCode) || createMedicationCode();
    const qrDataUrl = medicationQrDataUrl(barcodeCode);
    const strengthText = compoundRecipeStrengthText(recipe);
    const title = [recipe.finalName || recipe.name, strengthText].filter(Boolean).join(' ');
    const lotBudLine = lot
        ? `<strong>Lot:</strong> ${escapeHtml(lot)} | <strong>BUD:</strong> ${escapeHtml(budDate || 'N/A')}`
        : `<strong>BUD:</strong> ${escapeHtml(budDate || 'N/A')}`;
    const lines = [
        title,
        `Qty: ${formatAmount(parseAmount(qty, qty))} ${recipe.yieldUnit || ''}`,
        recipe.packageSize ? `Package: ${recipe.packageSize}` : '',
        lot ? `Lot: ${lot}` : '',
        `BUD: ${budDate || 'N/A'}`,
        `Storage: ${recipe.storage || 'N/A'}`,
        recipe.instructions || ''
    ];
    return `<div class="${getLabelClass(lines, 7)} compound-bottle-label">
        <div class="compound-label-copy">
            <div class="label-title">${escapeHtml(title)}</div>
            <div class="label-small"><strong>Qty:</strong> ${escapeHtml(formatAmount(parseAmount(qty, qty)))} ${escapeHtml(recipe.yieldUnit || '')}${recipe.packageSize ? ` | <strong>Pkg:</strong> ${escapeHtml(recipe.packageSize)}` : ''}</div>
            <div class="label-small">${lotBudLine}</div>
            <div class="label-small"><strong>Storage:</strong> ${escapeHtml(recipe.storage || 'N/A')}</div>
            ${recipe.instructions ? `<div class="label-small compound-label-directions"><strong>Directions:</strong> ${escapeHtml(recipe.instructions)}</div>` : ''}
        </div>
        ${qrDataUrl ? `<img class="compound-label-qr" src="${qrDataUrl}" alt="Compound QR code">` : ''}
    </div>`;
}

function compoundPrepHistoryHtml(recipe) {
    const history = (db.compoundPreps || []).filter(prep => prep.recipeId === recipe.id).slice(0, 6);
    if (!history.length) return '<div class="empty-state">No completed batches yet.</div>';
    return history.map(prep => `<div class="compound-history-row">
        <strong>${escapeHtml(prep.lot || 'No lot')}</strong>
        <span>${escapeHtml(prep.preparedAt ? new Date(prep.preparedAt).toLocaleString() : '')}</span>
        <span>${escapeHtml(formatAmount(parseAmount(prep.qty)))} ${escapeHtml(prep.unit || recipe.yieldUnit || '')}</span>
        <span>BUD ${escapeHtml(prep.budDate || 'N/A')}</span>
    </div>`).join('');
}

function compoundPrepPanelHtml(recipe) {
    const defaults = recipePrepDefaults(recipe);
    const strengthText = compoundRecipeStrengthText(recipe);
    return `<div class="compound-prep-grid" data-recipe-id="${escapeHtml(recipe.id)}">
        <div class="compound-prep-main">
            <div class="compound-prep-banner">
                <strong>${escapeHtml(recipe.finalName || recipe.name)}</strong>
                <span>${escapeHtml(strengthText)} | Yield ${escapeHtml(formatAmount(parseAmount(recipe.yieldQty)))} ${escapeHtml(recipe.yieldUnit || '')}${recipe.packageSize ? ` | ${escapeHtml(recipe.packageSize)}` : ''}</span>
                ${recipe.calculationSummary ? `<small>${escapeHtml(recipe.calculationSummary)}</small>` : ''}
            </div>
            <fieldset>
                <legend>Batch Options</legend>
                <div class="recipe-form-grid compact">
                    <label>Prepared date<input id="compound-prep-date" type="date" value="${escapeHtml(defaults.preparedDate)}" onchange="updateCompoundPrepCalculations('${escapeHtml(recipe.id)}')"></label>
                    <label>Time<input id="compound-prep-time" type="time" value="${escapeHtml(defaults.preparedTime)}" onchange="updateCompoundPrepCalculations('${escapeHtml(recipe.id)}')"></label>
                    <label>Lot / batch (optional)<input id="compound-prep-lot" type="text" value="${escapeHtml(defaults.lot)}" placeholder="Optional" oninput="updateCompoundPrepCalculations('${escapeHtml(recipe.id)}')"></label>
                    <label>Beyond-use date<input id="compound-prep-bud" type="date" value="${escapeHtml(defaults.budDate)}" onchange="updateCompoundPrepCalculations('${escapeHtml(recipe.id)}')"></label>
                    <label>Qty prepared<input id="compound-prep-qty" type="number" step="any" value="${escapeHtml(defaults.qty)}" oninput="updateCompoundPrepCalculations('${escapeHtml(recipe.id)}')"></label>
                    <label>QR / barcode<input id="compound-prep-code" type="text" value="${escapeHtml(defaults.barcodeCode)}" placeholder="Generated automatically" oninput="updateCompoundPrepCalculations('${escapeHtml(recipe.id)}')"></label>
                </div>
            </fieldset>
            <fieldset>
                <legend>Scan / Verify Ingredients</legend>
                <div class="field-row">
                    <label>Scan code:</label><input id="compound-scan-code" type="text" style="width:220px;" onkeydown="if(event.key==='Enter'){event.preventDefault(); scanCompoundIngredient('${escapeHtml(recipe.id)}');}">
                    <button type="button" onclick="scanCompoundIngredient('${escapeHtml(recipe.id)}')">Scan Ingredient</button>
                    <button type="button" onclick="markAllCompoundIngredientsReady('${escapeHtml(recipe.id)}')">Manual Check All</button>
                </div>
                <div id="compound-scan-message" class="compound-scan-message"></div>
                <div class="compound-prep-ingredients">${compoundPrepIngredientRows(recipe, defaults.qty)}</div>
            </fieldset>
            <fieldset>
                <legend>Procedure Notes</legend>
                <div class="compound-procedure">${escapeHtml(recipe.notes || 'No procedure notes saved.')}</div>
            </fieldset>
            <div class="compound-prep-actions">
                <button type="button" onclick="previewCompoundBottleLabel('${escapeHtml(recipe.id)}')">Preview Bottle Label</button>
                <button type="button" onclick="completeCompoundPreparation('${escapeHtml(recipe.id)}')">Complete Prep + Add to Inventory</button>
                <button type="button" onclick="editCompoundRecipe('${escapeHtml(recipe.id)}')">Edit Recipe</button>
                <button type="button" onclick="deleteCompoundRecipe('${escapeHtml(recipe.id)}')">Delete Recipe</button>
            </div>
        </div>
        <div class="compound-preview-column">
            <div class="compound-label-preview-card">${compoundBottleLabelHtml(recipe, defaults)}</div>
            <fieldset>
                <legend>Recent Batches</legend>
                ${compoundPrepHistoryHtml(recipe)}
            </fieldset>
        </div>
    </div>`;
}

function currentCompoundPrepValues(recipe) {
    const defaults = recipePrepDefaults(recipe);
    const codeInput = document.getElementById('compound-prep-code');
    let barcodeCode = normalizeMedicationCode(codeInput?.value || '');
    if (!barcodeCode && codeInput) {
        barcodeCode = createMedicationCode();
        codeInput.value = barcodeCode;
    }
    return {
        preparedDate: document.getElementById('compound-prep-date')?.value || defaults.preparedDate,
        preparedTime: document.getElementById('compound-prep-time')?.value || defaults.preparedTime,
        lot: document.getElementById('compound-prep-lot')?.value.trim() || '',
        budDate: document.getElementById('compound-prep-bud')?.value || defaults.budDate,
        qty: parseAmount(document.getElementById('compound-prep-qty')?.value, recipe.yieldQty),
        barcodeCode
    };
}

window.scanCompoundIngredient = function(recipeId) {
    const input = document.getElementById('compound-scan-code');
    const message = document.getElementById('compound-scan-message');
    const code = normalizeMedicationCode(input?.value || '');
    if (!code) return;
    const med = findInventoryByBarcode(code);
    const row = med
        ? Array.from(document.querySelectorAll('.compound-prep-ingredient')).find(item => item.dataset.medId === med.id)
        : null;
    if (row) {
        row.querySelector('.compound-prep-check').checked = true;
        row.classList.add('compound-prep-ready');
        if (message) {
            message.textContent = `Correct scan: ${med.name}`;
            message.className = 'compound-scan-message ok';
        }
        if (input) input.value = '';
        return;
    }
    if (message) {
        message.textContent = med ? `${med.name} is not part of this recipe.` : 'Scanned code does not match any inventory item.';
        message.className = 'compound-scan-message error';
    }
};

window.markAllCompoundIngredientsReady = function() {
    document.querySelectorAll('.compound-prep-ingredient').forEach(row => {
        row.querySelector('.compound-prep-check').checked = true;
        row.classList.add('compound-prep-ready');
    });
};

window.updateCompoundPrepCalculations = function(recipeId) {
    const recipe = db.recipes.find(item => item.id === recipeId);
    if (!recipe) return;
    const prep = currentCompoundPrepValues(recipe);
    const ingredientPanel = document.querySelector('.compound-prep-ingredients');
    if (ingredientPanel) ingredientPanel.innerHTML = compoundPrepIngredientRows(recipe, prep.qty);
    const labelCard = document.querySelector('.compound-label-preview-card');
    if (labelCard) labelCard.innerHTML = compoundBottleLabelHtml(recipe, prep);
};

window.previewCompoundBottleLabel = function(recipeId) {
    const recipe = db.recipes.find(item => item.id === recipeId);
    if (!recipe) return;
    previewLabelHtml(compoundBottleLabelHtml(recipe, currentCompoundPrepValues(recipe)));
};

window.completeCompoundPreparation = async function(recipeId) {
    const recipe = db.recipes.find(item => item.id === recipeId);
    if (!recipe) return;
    const prep = currentCompoundPrepValues(recipe);
    if (!prep.preparedDate || !prep.preparedTime || !prep.budDate) return appAlert('Prepared date, time, and beyond-use date are required.');
    if (!Number.isFinite(prep.qty) || prep.qty <= 0) return appAlert('Quantity prepared must be greater than 0.');
    const unchecked = Array.from(document.querySelectorAll('.compound-prep-ingredient .compound-prep-check')).filter(input => !input.checked);
    if (unchecked.length && !await appConfirm('Some ingredients are not checked. Continue with preparation anyway?', 'Ingredient Verification')) return;
    const barcodeCode = prep.barcodeCode || createMedicationCode();
    if (await warnBarcodeConflict(barcodeCode)) return;

    for (const ingredient of recipe.ingredients || []) {
        if (!ingredient.medId || ingredient.subtractStock === false) continue;
        const med = db.inventory.find(item => item.id === ingredient.medId);
        if (!med) continue;
        const needed = scaledIngredientQty(recipe, ingredient, prep.qty);
        if (parseAmount(med.stock, 0) < needed) {
            return appAlert(`${med.name} has ${formatAmount(parseAmount(med.stock))} ${inventoryUnitFor(med)} on hand, but this batch needs ${formatAmount(needed)} ${ingredient.unit}.`);
        }
    }

    for (const ingredient of recipe.ingredients || []) {
        if (!ingredient.medId || ingredient.subtractStock === false) continue;
        const med = db.inventory.find(item => item.id === ingredient.medId);
        if (!med) continue;
        med.stock = Math.max(0, parseAmount(med.stock, 0) - scaledIngredientQty(recipe, ingredient, prep.qty));
    }

    const numericStrength = parseAmount(recipe.finalStrength, NaN);
    const formulation = recipe.formulation || 'mL';
    const containerBased = dosageFormUsesContainerTracking(formulation);
    const calculatedComponents = Array.isArray(recipe.calculatedComponents) ? recipe.calculatedComponents.filter(component => Number.isFinite(parseAmount(component.strength, NaN)) || Number.isFinite(parseAmount(component.strengthAmount, NaN))) : [];
    const singleCalculatedComponent = calculatedComponents.length === 1 ? calculatedComponents[0] : null;
    const componentUnit = singleCalculatedComponent?.unit || (recipe.finalUnits && String(recipe.finalUnits).includes('/') ? String(recipe.finalUnits).split('/')[0] : recipe.finalUnits);
    const componentPerUnit = singleCalculatedComponent?.perUnit || (recipe.finalUnits && String(recipe.finalUnits).includes('/') ? String(recipe.finalUnits).split('/')[1] : '');
    const normalizedComponents = calculatedComponents.map(component => ({
        ...component,
        strength: parseAmount(component.strength, parseAmount(component.strengthAmount, 0)),
        strengthAmount: parseAmount(component.strengthAmount, parseAmount(component.strength, 0)),
        perAmount: parseAmount(component.perAmount, 1),
        perUnit: component.perUnit || recipe.yieldUnit || ''
    }));
    const compoundedMed = {
        id: `comp_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: recipe.finalName || recipe.name,
        strength: singleCalculatedComponent ? parseAmount(singleCalculatedComponent.strength, parseAmount(singleCalculatedComponent.strengthAmount, numericStrength)) : (Number.isFinite(numericStrength) ? numericStrength : recipe.finalStrength),
        units: singleCalculatedComponent ? `${componentUnit}${componentPerUnit ? `/${componentPerUnit}` : ''}` : (recipe.finalUnits || ''),
        displayStrength: compoundRecipeStrengthText(recipe),
        strengthAmount: singleCalculatedComponent ? parseAmount(singleCalculatedComponent.strengthAmount, parseAmount(singleCalculatedComponent.strength, NaN)) : (Number.isFinite(numericStrength) ? numericStrength : null),
        activeUnit: singleCalculatedComponent ? componentUnit : (Number.isFinite(numericStrength) && recipe.finalUnits && !String(recipe.finalUnits).includes('/') ? recipe.finalUnits : null),
        perAmount: singleCalculatedComponent && componentPerUnit ? 1 : null,
        perUnit: singleCalculatedComponent ? componentPerUnit : '',
        formulation,
        inventoryUnit: recipe.yieldUnit || defaultInventoryUnitForFormulation(formulation, containerBased ? 'container-finish' : 'per-dose'),
        administrationUnit: recipe.yieldUnit || defaultAdministrationUnitForFormulation(formulation),
        inventoryBehavior: containerBased ? 'container-finish' : 'per-dose',
        stock: prep.qty,
        maxCapacity: prep.qty,
        expiry: prep.budDate,
        storage: recipe.storage || 'Room Temp',
        controlLevel: recipe.controlLevel || 'N/A',
        isLiquid: String(recipe.finalUnits || '').includes('/') || formulation === 'mL',
        isCombination: normalizedComponents.length > 1,
        components: normalizedComponents.length > 1 ? normalizedComponents : [],
        minThreshold: Number.isFinite(parseAmount(recipe.minThreshold, NaN)) ? parseAmount(recipe.minThreshold) : 1,
        prescriberId: '',
        assignedMemberIds: [],
        barcodeCode,
        barcodeCodes: [barcodeCode],
        recipeId: recipe.id,
        compoundLot: prep.lot,
        notes: [
            `Compounded from recipe: ${recipe.name}`,
            prep.lot ? `Lot: ${prep.lot}` : '',
            `Prepared: ${prep.preparedDate} ${prep.preparedTime}`,
            recipe.packageSize ? `Package: ${recipe.packageSize}` : '',
            recipe.instructions ? `Instructions: ${recipe.instructions}` : ''
        ].filter(Boolean).join('\n')
    };
    db.inventory.push(compoundedMed);
    db.compoundPreps = Array.isArray(db.compoundPreps) ? db.compoundPreps : [];
    db.compoundPreps.unshift({
        id: compoundPrepId(),
        recipeId: recipe.id,
        recipeName: recipe.name,
        inventoryId: compoundedMed.id,
        lot: prep.lot,
        preparedAt: `${prep.preparedDate}T${prep.preparedTime}`,
        budDate: prep.budDate,
        qty: prep.qty,
        unit: recipe.yieldUnit || '',
        barcodeCode
    });
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medName: compoundedMed.name,
        details: `Prepared compounded product${prep.lot ? ` lot ${prep.lot}` : ''}; added ${formatAmount(prep.qty)} ${compoundedMed.inventoryUnit} to inventory.`
    });
    addAudit('Compounded preparation completed', compoundedMed.name, `${prep.lot ? `Lot ${prep.lot} | ` : ''}${formatAmount(prep.qty)} ${compoundedMed.inventoryUnit} added to inventory.`);
    await sync();
    await appAlert(`${compoundedMed.name} was added to inventory.`);
};

function renderRecipes() {
    updateRecipeInventoryOptions();
    const ingredientList = document.getElementById('recipe-ingredient-list');
    if (ingredientList && ingredientList.children.length === 0) addRecipeIngredientRow();
    window.updateRecipeDosageDefaults?.();
    const list = document.getElementById('compound-recipe-list');
    const panel = document.getElementById('compound-prep-panel');
    if (!list || !panel) return;
    db.recipes = Array.isArray(db.recipes) ? db.recipes.map(normalizeCompoundRecipe) : [];
    if (!activeCompoundRecipeId || !db.recipes.some(recipe => recipe.id === activeCompoundRecipeId)) {
        activeCompoundRecipeId = db.recipes[0]?.id || '';
    }
    list.innerHTML = db.recipes.length
        ? db.recipes.map(recipe => {
            const ingredientCount = (recipe.ingredients || []).length;
            const strengthText = compoundRecipeStrengthText(recipe);
            return `<button type="button" class="compound-recipe-row ${recipe.id === activeCompoundRecipeId ? 'selected' : ''}" onclick="selectCompoundRecipe('${escapeHtml(recipe.id)}')">
                <span class="win98-icon icon-recipe"></span>
                <span><strong>${escapeHtml(recipe.name || 'Unnamed recipe')}</strong><br><small>${escapeHtml(recipe.finalName || '')} ${escapeHtml(strengthText)} | ${ingredientCount} ingredient${ingredientCount === 1 ? '' : 's'}</small></span>
            </button>`;
        }).join('')
        : '<div class="empty-state">No recipes saved yet.</div>';
    const recipe = db.recipes.find(item => item.id === activeCompoundRecipeId);
    panel.innerHTML = recipe ? compoundPrepPanelHtml(recipe) : '<div class="empty-state">Select or save a recipe to prepare a compounded product.</div>';
    enhanceButtonIcons(document.getElementById('panel-recipes') || document);
};


// --- RENDERING ---
function formatCalendarRange(startDate) {
    const start = parseLocal(startDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
}

function calendarMedicationColor(schedule, dateStr, time) {
    const instances = getScheduleInstancesForDate(schedule, dateStr);
    const documented = instances.map(instance => db.history.find(entry => entry.scheduleInstanceKey === instance.key));
    const allGiven = instances.length > 0 && documented.every(entry => entry && !['skipped', 'missed'].includes(entry.doseStatus));
    if (allGiven) return '#008000';

    const currentEntry = db.history.find(entry => entry.scheduleInstanceKey === scheduleInstanceKey(schedule.id, dateStr, time));
    if (currentEntry && ['skipped', 'missed'].includes(currentEntry.doseStatus)) return '#b00000';
    if (currentEntry) return '#000000';

    const due = new Date(`${dateStr}T${time}`);
    const now = new Date();
    if (due < now) return '#cc0000';
    const minutesUntilDue = (due.getTime() - now.getTime()) / 60000;
    return minutesUntilDue <= 60 ? '#d26a00' : '#000000';
}

function renderCalendar(gridId = 'calendar-grid', startDate = dashboardCalendarStart, memberId = null, rangeLabelId = 'dashboard-calendar-range') {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const start = parseLocal(startDate) || parseLocal(localDateKey());
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    grid.innerHTML = '';
    const rangeLabel = document.getElementById(rangeLabelId);
    if (rangeLabel) rangeLabel.textContent = formatCalendarRange(localDateKey(start));

    for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        grid.innerHTML += `
            <div class="calendar-header">
                ${days[d.getDay()]}<br>${d.getMonth() + 1}/${d.getDate()}
            </div>`;
    }

    for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const dateStr = localDateKey(d);
        const cell = document.createElement('div');
        cell.className = 'calendar-day';

        const todaysMeds = [];
        db.schedules.forEach(schedule => {
            if (!isScheduleArchived(schedule) && (!memberId || schedule.memberId === memberId) && isScheduleDueOnDate(schedule, dateStr)) {
                getScheduleTimes(schedule).forEach(time => todaysMeds.push({ ...schedule, specificTime: time }));
            }
        });
        todaysMeds.sort((a, b) => a.specificTime.localeCompare(b.specificTime));

        todaysMeds.forEach(schedule => {
            const med = db.inventory.find(m => m.id === schedule.medId);
            const member = db.family.find(f => f.id === schedule.memberId);
            if (!med || !member) return;
            const memberColor = member.calendarColor || (member.sex === 'Female' ? '#8b1558' : '#000080');
            const medicationColor = calendarMedicationColor(schedule, dateStr, schedule.specificTime);
            const memberText = memberId ? '' : ` - <b style="color:${escapeHtml(memberColor)};">${escapeHtml(member.firstName)}</b>`;
            cell.innerHTML += `
                <div class="calendar-dose" onclick="openOrderModifier('${schedule.id}')">
                    <i>${escapeHtml(schedule.specificTime)}</i>${memberText}<span style="color:${medicationColor};">: ${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))} ${escapeHtml(formatQtyForSchedule(schedule, med))}</span>
                </div>`;
        });
        grid.appendChild(cell);
    }
}

function renderMemberCalendar(memberId) {
    renderCalendar('member-calendar-grid', memberCalendarStart, memberId, 'member-calendar-range');
}

window.shiftDashboardCalendar = function(days) {
    const start = parseLocal(dashboardCalendarStart);
    start.setDate(start.getDate() + days);
    dashboardCalendarStart = localDateKey(start);
    renderCalendar();
};

window.resetDashboardCalendar = function() {
    dashboardCalendarStart = localDateKey();
    renderCalendar();
};

window.shiftMemberCalendar = function(days) {
    const start = parseLocal(memberCalendarStart);
    start.setDate(start.getDate() + days);
    memberCalendarStart = localDateKey(start);
    if (currentEditingMemberId) renderMemberCalendar(currentEditingMemberId);
};

window.resetMemberCalendar = function() {
    memberCalendarStart = localDateKey();
    if (currentEditingMemberId) renderMemberCalendar(currentEditingMemberId);
};

window.updateInventoryEntryMode = function() {
    const isCombo = document.getElementById('is-combination').checked;
    const formulation = document.getElementById('med-formulation')?.value || '';
    const units = document.getElementById('med-units')?.value || '';
    const unitParts = units.split('/');
    const strengthInput = document.getElementById('med-strength');
    const unitsSelect = document.getElementById('med-units');
    const perContainer = document.getElementById('med-per-container');
    const perAmountInput = document.getElementById('med-per-amount');
    const perUnitSelect = document.getElementById('med-per-unit');
    const stockUnitLabel = document.getElementById('med-stock-unit-label');
    const topicalStockUnit = document.getElementById('med-topical-stock-unit');
    const topicalAdminUnitWrap = document.getElementById('med-topical-admin-unit-wrap');
    const combinationFields = document.getElementById('combination-fields');
    const inventoryBehavior = document.getElementById('med-inventory-behavior');
    const inventoryUnitInput = document.getElementById('med-inventory-unit');
    const administrationUnitInput = document.getElementById('med-administration-unit');
    const inventoryGuidance = document.getElementById('med-inventory-guidance');

    const isContainerDefault = dosageFormUsesContainerTracking(formulation);
    const defaultPerUnit = defaultPerUnitForFormulation(formulation);
    const isConcentration = isConcentrationFormulation(formulation) || units.includes('/');
    const formulationChanged = inventoryBehavior?.dataset.formulation !== formulation;

    if (formulationChanged) {
        if (administrationUnitInput) administrationUnitInput.value = defaultAdministrationUnitForFormulation(formulation);
        if (inventoryBehavior) inventoryBehavior.value = defaultInventoryBehaviorForFormulation(formulation);
        if (inventoryUnitInput) inventoryUnitInput.value = defaultInventoryUnitForFormulation(formulation, inventoryBehavior?.value);
        if (inventoryBehavior) inventoryBehavior.dataset.formulation = formulation;
        const sharedUnit = document.getElementById('combo-shared-per-unit');
        const sharedAmount = document.getElementById('combo-shared-per-amount');
        if (sharedUnit && defaultPerUnit) sharedUnit.value = defaultPerUnit;
        if (sharedAmount && !sharedAmount.value) sharedAmount.value = '1';
        if (isConcentration || defaultPerUnit) {
            document.querySelectorAll('#ingredient-list .ing-per-unit').forEach(select => {
                if (!select.value) select.value = defaultPerUnit;
            });
        }
    }
    if (isContainerDefault && inventoryBehavior) inventoryBehavior.value = 'container-finish';
    if (inventoryBehavior) inventoryBehavior.disabled = isContainerDefault;
    const behaviorChanged = inventoryBehavior?.dataset.behavior !== inventoryBehavior?.value;
    if (!formulationChanged && behaviorChanged && inventoryUnitInput) {
        inventoryUnitInput.value = defaultInventoryUnitForFormulation(formulation, inventoryBehavior.value);
    }
    if (inventoryBehavior) inventoryBehavior.dataset.behavior = inventoryBehavior.value;

    if (combinationFields) combinationFields.style.display = isCombo ? 'block' : 'none';
    if (strengthInput) {
        strengthInput.disabled = isCombo;
        strengthInput.title = isCombo ? 'Strength is built from active ingredients.' : '';
        if (isCombo) strengthInput.value = '';
    }
    if (unitsSelect) {
        unitsSelect.disabled = isCombo;
        unitsSelect.title = isCombo ? 'Units are set per active ingredient.' : '';
    }
    if (perContainer) perContainer.style.display = isCombo ? 'none' : 'inline-block';
    if (perAmountInput) {
        perAmountInput.disabled = isCombo || !isConcentration;
        if (!isConcentration) perAmountInput.value = '1';
    }
    if (perUnitSelect) {
        perUnitSelect.disabled = isCombo || !isConcentration;
        if (!isConcentration) perUnitSelect.value = '';
        else if (unitParts[1]) perUnitSelect.value = unitParts[1];
        else if (!perUnitSelect.value && defaultPerUnit) perUnitSelect.value = defaultPerUnit;
    }
    const tracksContainers = inventoryBehavior?.value === 'container-finish';
    if (stockUnitLabel) stockUnitLabel.innerText = inventoryUnitInput?.value || defaultInventoryUnitForFormulation(formulation, inventoryBehavior?.value);
    if (topicalStockUnit) topicalStockUnit.style.display = 'none';
    if (topicalAdminUnitWrap) topicalAdminUnitWrap.style.display = 'none';
    if (inventoryGuidance) {
        inventoryGuidance.innerText = tracksContainers
            ? 'Doses do not reduce stock. Use Finished Container when one is empty.'
            : `Each administered ${administrationUnitInput?.value || 'dose unit'} reduces stock by the quantity given.`;
    }
    updateCombinationPreview('med');
};

window.toggleComboFields = function() {
    const isCombo = document.getElementById('is-combination').checked;
    updateInventoryEntryMode();
    if (isCombo && document.getElementById('ingredient-list').children.length === 0) {
        addIngredientRow(); // Add first row by default
    }
};

window.addIngredientRow = function() {
    const container = document.getElementById('ingredient-list');
    const div = document.createElement('div');
    div.className = 'combo-row';
    const unitOptions = componentUnitOptions.map(unit => `<option value="${unit}">${unit}</option>`).join('');
    const defaultPerUnit = defaultPerUnitForFormulation(document.getElementById('med-formulation')?.value || 'Other');
    div.innerHTML = `
        <label>Ingredient<input class="ing-name" type="text" placeholder="e.g. Acetaminophen" oninput="updateCombinationPreview('med')"></label>
        <label>Amount<input class="ing-strength" type="number" min="0" step="any" placeholder="325" oninput="updateCombinationPreview('med')"></label>
        <label>Unit<select class="ing-unit" onchange="updateCombinationPreview('med')">${unitOptions}</select></label>
        <div class="component-per-controls">
            <label>per amount<input class="ing-per-amount" type="number" min="0.001" step="any" value="1" oninput="updateCombinationPreview('med')"></label>
            <label>per unit<select class="ing-per-unit" onchange="updateCombinationPreview('med')">${componentPerUnitOptionsHtml(defaultPerUnit)}</select></label>
        </div>
        <button type="button" class="combo-row-remove" onclick="this.closest('.combo-row').remove(); updateCombinationPreview('med')">Remove</button>
    `;
    container.appendChild(div);
    updateCombinationPreview('med');
};

function inventorySearchText(med) {
    return [
        med.name,
        formatLabelMedStrength(med),
        formatInventoryUnits(med),
        inventoryUnitFor(med),
        med.expiry,
        med.storage,
        med.controlLevel,
        med.notes,
        ...(med.components || []).flatMap(component => [component.name, component.unit])
    ].filter(Boolean).join(' ').toLowerCase();
}

function asArray(value) {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
}

function inventoryDisplayName(med) {
    return med ? `${med.name} ${formatMedStrength(med)}`.trim() : 'Unknown item';
}

function formularyItemName(item) {
    const med = item.medId ? db.inventory.find(candidate => candidate.id === item.medId) : null;
    return med ? inventoryDisplayName(med) : `${item.name || 'Unnamed item'} ${item.strength || ''}`.trim();
}

function formularyBarcodeCodes(item) {
    const med = item.medId ? db.inventory.find(candidate => candidate.id === item.medId) : null;
    return med ? medicationCodes(med) : asArray(item.barcodeCodes).map(normalizeMedicationCode).filter(Boolean);
}

function sortByName(list, getName = item => item.name || '') {
    return list.slice().sort((a, b) => getName(a).localeCompare(getName(b), undefined, { sensitivity: 'base' }));
}

function inventoryOrderName(order) {
    return String(order?.name || '').trim() || `Inventory Order - ${order?.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'unsaved'}`;
}

function inventoryOrderLabel(order) {
    const created = order?.createdAt ? new Date(order.createdAt).toLocaleString() : 'No date';
    const actual = orderActualTotal(order);
    const totalText = actual > 0 ? ` - Actual ${formatCurrency(actual)}` : '';
    return `${inventoryOrderName(order)} - ${created} - ${order?.status || 'open'} - ${order?.lines?.length || 0} item(s)${totalText}`;
}

function orderLineEstimatedTotal(line) {
    return parseMoney(line?.estimatedUnitPrice || line?.estimatedPrice, 0);
}

function orderLineActualTotal(line) {
    const enteredTotal = parseMoney(line?.actualTotal, 0);
    if (enteredTotal > 0) return enteredTotal;
    return parseMoney(line?.actualUnitPrice || line?.actualPrice, 0);
}

function isOrderLineNewNonInventory(line) {
    return line?.sourceType === 'new' || line?.sourceType === 'formulary' || !line?.medId;
}

function orderEstimatedTotal(order) {
    return (order?.lines || []).reduce((sum, line) => sum + orderLineEstimatedTotal(line), 0);
}

function orderActualTotal(order) {
    return (order?.lines || []).reduce((sum, line) => sum + orderLineActualTotal(line), 0);
}

function modalNamedValue(body, name) {
    const escapedName = cssEscape(name);
    return body?.querySelector(`[name="${escapedName}"]`)?.value || '';
}

function cssEscape(value) {
    return typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(String(value))
        : String(value).replace(/["\\]/g, '\\$&');
}

function filterInventoryBuilder(inputId, itemSelector) {
    const body = document.getElementById('action-modal-body');
    const query = String(body?.querySelector(`#${inputId}`)?.value || '').trim().toLowerCase();
    body?.querySelectorAll(itemSelector).forEach(item => {
        item.classList.toggle('is-hidden', query && !String(item.dataset.search || '').includes(query));
    });
}

function renderBuilderPreview(targetId, items, emptyText = 'Nothing selected yet.') {
    const target = document.getElementById(targetId);
    if (!target) return;
    const hasCostData = items.some(item => String(item.unitPrice || '').trim() || (Number.isFinite(item.lineTotal) && item.lineTotal > 0));
    const estimatedTotal = items.reduce((sum, item) => sum + (Number.isFinite(item.lineTotal) ? item.lineTotal : 0), 0);
    target.innerHTML = items.length
        ? items.map(item => `
            <div class="inventory-builder-preview-item ${item.isNewNonInventory ? 'order-new-noninventory' : ''}">
                <div class="inventory-builder-preview-text">
                    <strong>${escapeHtml(item.name)}</strong>${item.isNewNonInventory ? '<span class="order-new-badge">New non-inventory</span>' : ''}
                    <div>${escapeHtml([item.strength, item.units].filter(Boolean).join(' | ') || 'No strength/units entered')}</div>
                    ${item.qty ? `<div>Qty: ${escapeHtml(item.qty)}</div>` : ''}
                    ${item.unitPrice ? `<div>Estimated price: ${escapeHtml(formatCurrency(item.unitPrice))}</div>` : ''}
                    ${Number.isFinite(item.lineTotal) && item.lineTotal > 0 ? `<div class="order-line-estimate">Line estimate: ${escapeHtml(formatCurrency(item.lineTotal))}</div>` : ''}
                    ${item.purchaseLink ? `<div class="form-help">Purchase link: ${escapeHtml(item.purchaseLink)}</div>` : ''}
                    ${item.notes ? `<div class="form-help">${escapeHtml(item.notes)}</div>` : ''}
                </div>
                <button type="button" class="inventory-builder-remove"
                    data-builder-name="${escapeHtml(item.removeName || '')}"
                    data-builder-value="${escapeHtml(item.removeValue || '')}"
                    data-builder-row="${escapeHtml(item.removeRow || '')}"
                    data-builder-render="${escapeHtml(item.removeRender || '')}"
                    onclick="removePendingBuilderSelection(this)">X</button>
            </div>`).join('') + (hasCostData ? `<div class="order-estimated-total">Estimated total: ${escapeHtml(formatCurrency(estimatedTotal))}</div>` : '')
        : `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
}

window.removePendingBuilderSelection = function(button) {
    const body = document.getElementById('action-modal-body');
    const rowId = button?.dataset.builderRow || '';
    const inputName = button?.dataset.builderName || '';
    const inputValue = button?.dataset.builderValue || '';
    const renderName = button?.dataset.builderRender || '';
    if (rowId) {
        document.getElementById(rowId)?.remove();
    } else if (body && inputName && inputValue) {
        body.querySelectorAll(`input[name="${cssEscape(inputName)}"]`).forEach(input => {
            if (input.value === inputValue) input.checked = false;
        });
    }
    if (renderName && typeof window[renderName] === 'function') window[renderName]();
};

window.filterFormularyBuilder = function() {
    filterInventoryBuilder('formulary-builder-search', '.formulary-builder-source-item');
};

window.renderFormularyBuilderPreview = function() {
    const body = document.getElementById('action-modal-body');
    if (!body) return;
    const items = [];
    body.querySelectorAll('input[name="formularyInventoryIds"]:checked').forEach(input => {
        const med = db.inventory.find(item => item.id === input.value);
        if (!med) return;
        items.push({
            name: inventoryDisplayName(med),
            strength: formatMedStrength(med),
            units: formatInventoryUnits(med),
            qty: modalNamedValue(body, `targetQty-${med.id}`),
            notes: modalNamedValue(body, `notes-${med.id}`),
            removeName: 'formularyInventoryIds',
            removeValue: med.id,
            removeRender: 'renderFormularyBuilderPreview'
        });
    });
    body.querySelectorAll('.formulary-custom-row').forEach(row => {
        const name = row.querySelector('[name="customName"]')?.value.trim() || '';
        if (!name) return;
        items.push({
            name,
            strength: row.querySelector('[name="customStrength"]')?.value.trim() || '',
            units: row.querySelector('[name="customUnits"]')?.value.trim() || '',
            qty: row.querySelector('[name="customTargetQty"]')?.value.trim() || '',
            notes: row.querySelector('[name="customNotes"]')?.value.trim() || '',
            removeRow: row.id,
            removeRender: 'renderFormularyBuilderPreview'
        });
    });
    renderBuilderPreview('formulary-builder-preview', items, 'Select or add items to build your formulary.');
};

window.filterOrderBuilder = function() {
    filterInventoryBuilder('order-builder-search', '.order-builder-source-item');
};

window.orderBuilderSelectionChanged = function(input) {
    if (input?.checked && input.dataset.medId) {
        const body = document.getElementById('action-modal-body');
        body?.querySelectorAll('input[data-order-source="true"]').forEach(other => {
            if (other !== input && other.dataset.medId === input.dataset.medId) other.checked = false;
        });
    }
    window.renderOrderBuilderPreview();
};

window.renderOrderBuilderPreview = function() {
    const body = document.getElementById('action-modal-body');
    if (!body) return;
    const items = [];
    const selectedMedIds = new Set();
    body.querySelectorAll('input[name="candidateMedIds"]:checked, input[name="otherInventoryIds"]:checked').forEach(input => {
        const med = db.inventory.find(item => item.id === input.value);
        if (!med) return;
        if (selectedMedIds.has(med.id)) return;
        selectedMedIds.add(med.id);
        const qtyName = input.name === 'candidateMedIds' ? `candidateQty-${med.id}` : `otherInventoryQty-${med.id}`;
        const priceName = input.name === 'candidateMedIds' ? `candidatePrice-${med.id}` : `otherInventoryPrice-${med.id}`;
        const linkName = input.name === 'candidateMedIds' ? `candidateLink-${med.id}` : `otherInventoryLink-${med.id}`;
        const qty = modalNamedValue(body, qtyName);
        const unitPrice = modalNamedValue(body, priceName);
        items.push({
            name: inventoryDisplayName(med),
            strength: formatMedStrength(med),
            units: formatInventoryUnits(med),
            qty,
            unitPrice,
            purchaseLink: modalNamedValue(body, linkName),
            lineTotal: parseMoney(unitPrice, 0),
            notes: input.name === 'candidateMedIds' ? 'Low/expired stock' : 'Current inventory',
            removeName: input.name,
            removeValue: med.id,
            removeRender: 'renderOrderBuilderPreview'
        });
    });
    body.querySelectorAll('input[name="formularyOrderIds"]:checked').forEach(input => {
        const item = db.formularyItems.find(candidate => candidate.id === input.value);
        if (!item) return;
        const med = item.medId ? db.inventory.find(candidate => candidate.id === item.medId) : null;
        if (med && selectedMedIds.has(med.id)) return;
        if (med) selectedMedIds.add(med.id);
        const qty = modalNamedValue(body, `formularyQty-${item.id}`);
        const unitPrice = modalNamedValue(body, `formularyPrice-${item.id}`);
        items.push({
            name: formularyItemName(item),
            strength: item.strength || '',
            units: item.units || '',
            qty,
            unitPrice,
            purchaseLink: modalNamedValue(body, `formularyLink-${item.id}`),
            lineTotal: parseMoney(unitPrice, 0),
            notes: item.notes || 'Formulary item',
            isNewNonInventory: !med,
            removeName: 'formularyOrderIds',
            removeValue: item.id,
            removeRender: 'renderOrderBuilderPreview'
        });
    });
    body.querySelectorAll('.formulary-custom-row').forEach(row => {
        const name = row.querySelector('[name="orderCustomName"]')?.value.trim() || '';
        if (!name) return;
        const isCombination = row.querySelector('[name="orderCustomIsCombination"]')?.checked;
        const combo = isCombination ? collectOrderCustomComponents(row) : { components: [], invalidDenominator: false };
        const comboMed = { isCombination: true, components: combo.components };
        const strength = isCombination && combo.components.length
            ? formatCombinationStrength(comboMed)
            : row.querySelector('[name="orderCustomStrength"]')?.value.trim() || '';
        const units = isCombination && combo.components.length
            ? formatInventoryUnits(comboMed)
            : [
                row.querySelector('[name="orderCustomUnits"]')?.value.trim() || '',
                row.querySelector('[name="orderCustomPerUnit"]')?.value.trim() || ''
            ].filter(Boolean).join('/');
        items.push({
            name,
            strength,
            units,
            formulation: row.querySelector('[name="orderCustomFormulation"]')?.value.trim() || '',
            qty: row.querySelector('[name="orderCustomQty"]')?.value.trim() || '',
            unitPrice: row.querySelector('[name="orderCustomPrice"]')?.value.trim() || '',
            purchaseLink: row.querySelector('[name="orderCustomLink"]')?.value.trim() || '',
            lineTotal: parseMoney(row.querySelector('[name="orderCustomPrice"]')?.value, 0),
            notes: [
                isCombination ? `${combo.components.length || 0} active ingredients${combo.invalidDenominator ? ' - check package basis' : ''}` : '',
                row.querySelector('[name="orderCustomFormulation"]')?.value.trim() || '',
                row.querySelector('[name="orderCustomInventoryUnit"]')?.value.trim() ? `Stock unit: ${row.querySelector('[name="orderCustomInventoryUnit"]')?.value.trim()}` : '',
                row.querySelector('[name="orderCustomNotes"]')?.value.trim() || ''
            ].filter(Boolean).join(' | '),
            isNewNonInventory: true,
            removeRow: row.id,
            removeRender: 'renderOrderBuilderPreview'
        });
    });
    renderBuilderPreview('order-builder-preview', items, 'Select or add items to stage this order.');
};

function formularyPdfBody() {
    const rows = sortByName(db.formularyItems || [], formularyItemName).map(item => {
        const med = item.medId ? db.inventory.find(candidate => candidate.id === item.medId) : null;
        return `<tr>
            <td>${escapeHtml(formularyItemName(item))}</td>
            <td>${escapeHtml(med ? formatMedStrength(med) : (item.strength || ''))}</td>
            <td>${escapeHtml(med ? formatInventoryUnits(med) : (item.units || ''))}</td>
            <td>${escapeHtml(item.targetQty || '')}</td>
            <td>${escapeHtml(med ? `${formatAmount(parseAmount(med.stock))} ${inventoryUnitFor(med)}` : 'Not in inventory')}</td>
            <td>${escapeHtml(item.notes || '')}</td>
        </tr>`;
    }).join('');
    return `<h2>Formulary</h2>
        <table>
            <thead><tr><th>Item</th><th>Strength</th><th>Units</th><th>Target Qty</th><th>Current Stock</th><th>Notes</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6">No formulary items saved.</td></tr>'}</tbody>
        </table>`;
}

function renderInventoryWorkflowSummary() {
    const container = document.getElementById('inventory-workflow-summary');
    if (!container) return;
    const formularyCount = (db.formularyItems || []).length;
    const openOrders = (db.inventoryOrders || []).filter(order => order.status !== 'received');
    const latestOrder = sortByName(db.inventoryOrders || [], order => order.createdAt || '').reverse()[0];
    container.innerHTML = `
        <div class="inventory-workflow-card"><strong>Formulary</strong>${formularyCount} reorder item${formularyCount === 1 ? '' : 's'} saved.</div>
        <div class="inventory-workflow-card"><strong>Open Orders</strong>${openOrders.length} order${openOrders.length === 1 ? '' : 's'} waiting to be received.</div>
        <div class="inventory-workflow-card"><strong>Latest Order</strong>${latestOrder ? `${escapeHtml(inventoryOrderName(latestOrder))}<br>${escapeHtml(new Date(latestOrder.createdAt).toLocaleString())} - ${escapeHtml(latestOrder.status || 'open')}<br><span class="order-total-line">Est: ${escapeHtml(formatCurrency(orderEstimatedTotal(latestOrder)))}${orderActualTotal(latestOrder) > 0 ? ` | Actual: ${escapeHtml(formatCurrency(orderActualTotal(latestOrder)))}` : ''}</span>` : 'No orders created yet.'}</div>`;
}

window.addFormularyCustomRow = function(values = {}) {
    const container = document.getElementById('formulary-custom-list');
    if (!container) return;
    const rowId = `formulary-custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const div = document.createElement('div');
    div.className = 'formulary-custom-row';
    div.innerHTML = `
        <input name="customName" type="text" placeholder="Medication or supplement" value="${escapeHtml(values.name || '')}" oninput="renderFormularyBuilderPreview()">
        <input name="customStrength" type="text" placeholder="Strength" value="${escapeHtml(values.strength || '')}" oninput="renderFormularyBuilderPreview()">
        <input name="customUnits" type="text" placeholder="Units" value="${escapeHtml(values.units || '')}" oninput="renderFormularyBuilderPreview()">
        <input name="customTargetQty" type="text" placeholder="Target qty" value="${escapeHtml(values.targetQty || '')}" oninput="renderFormularyBuilderPreview()">
        <input name="customNotes" type="text" placeholder="Notes" value="${escapeHtml(values.notes || '')}" oninput="renderFormularyBuilderPreview()">
        <button type="button" onclick="document.getElementById('${rowId}').remove(); renderFormularyBuilderPreview();">Remove</button>`;
    div.id = rowId;
    container.appendChild(div);
    window.renderFormularyBuilderPreview?.();
};

window.toggleAllFormularyChoices = function(checked) {
    document.querySelectorAll('#action-modal-body input[name="formularyInventoryIds"]').forEach(input => { input.checked = checked; });
    window.renderFormularyBuilderPreview?.();
};

window.filterFormularyView = function() {
    const body = document.getElementById('action-modal-body');
    const query = String(body?.querySelector('#formulary-view-search')?.value || '').trim().toLowerCase();
    body?.querySelectorAll('.formulary-view-card').forEach(card => {
        card.classList.toggle('is-hidden', query && !String(card.dataset.search || '').includes(query));
    });
};

window.createEditFormulary = async function() {
    db.formularyItems = db.formularyItems || [];
    const byMedId = new Map(db.formularyItems.filter(item => item.medId).map(item => [item.medId, item]));
    const customItems = db.formularyItems.filter(item => !item.medId);
    const inventoryChoices = sortByName(db.inventory, inventoryDisplayName).map((med, index) => {
        const existing = byMedId.get(med.id);
        const inputId = `formulary-med-${index}`;
        const searchText = inventorySearchText(med);
        return `<div class="formulary-item inventory-builder-source-item formulary-builder-source-item" data-search="${escapeHtml(searchText)}">
            <input id="${inputId}" name="formularyInventoryIds" type="checkbox" value="${escapeHtml(med.id)}" ${existing ? 'checked' : ''} onchange="renderFormularyBuilderPreview()">
            <label for="${inputId}"><strong>${escapeHtml(inventoryDisplayName(med))}</strong><br><span class="form-help">${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))} on hand</span></label>
            <input name="targetQty-${escapeHtml(med.id)}" type="text" placeholder="Target qty" value="${escapeHtml(existing?.targetQty || '')}" style="width:80px;" oninput="renderFormularyBuilderPreview()">
            <input name="notes-${escapeHtml(med.id)}" type="text" placeholder="Notes" value="${escapeHtml(existing?.notes || '')}" style="width:150px;" oninput="renderFormularyBuilderPreview()">
        </div>`;
    }).join('');

    const formularyPromise = showActionModal('Create/edit Formulary', `
        <div data-action-modal-size="wide" class="inventory-builder-layout">
            <div class="inventory-builder-source">
                <div style="font-size:11px; margin-bottom:6px;">Select inventory items to keep on your reorder formulary. Add free-text items for products not currently in inventory.</div>
                <div class="field-row" style="margin-bottom:6px;">
                    <label>Search:</label><input id="formulary-builder-search" class="inventory-builder-search" type="text" placeholder="Find inventory item..." oninput="filterFormularyBuilder()">
                </div>
                <div class="field-row" style="margin-bottom:6px;">
                    <button type="button" onclick="toggleAllFormularyChoices(true)">Select All Inventory</button>
                    <button type="button" onclick="toggleAllFormularyChoices(false)">Deselect All Inventory</button>
                    <button type="button" onclick="addFormularyCustomRow()">Add Non-inventory Item</button>
                </div>
                <div class="formulary-grid">${inventoryChoices || '<div class="empty-state">No inventory items yet.</div>'}</div>
                <div style="font-size:11px; margin:8px 0 4px;"><strong>Non-inventory formulary items</strong></div>
                <div id="formulary-custom-list"></div>
            </div>
            <div class="inventory-builder-selected">
                <div class="inventory-builder-panel-title">Pending formulary</div>
                <div id="formulary-builder-preview" class="inventory-builder-panel"></div>
            </div>
        </div>
    `, 'Save Formulary', body => {
        const base = collectNamedInputs(body);
        base.customRows = Array.from(body.querySelectorAll('.formulary-custom-row')).map(row => ({
            name: row.querySelector('[name="customName"]')?.value.trim() || '',
            strength: row.querySelector('[name="customStrength"]')?.value.trim() || '',
            units: row.querySelector('[name="customUnits"]')?.value.trim() || '',
            targetQty: row.querySelector('[name="customTargetQty"]')?.value.trim() || '',
            notes: row.querySelector('[name="customNotes"]')?.value.trim() || ''
        })).filter(item => item.name);
        return base;
    });
    customItems.forEach(item => window.addFormularyCustomRow(item));
    window.renderFormularyBuilderPreview?.();
    const result = await formularyPromise;
    if (!result) return;

    const selectedIds = new Set(asArray(result.formularyInventoryIds));
    const nextItems = [];
    db.inventory.forEach(med => {
        if (!selectedIds.has(med.id)) return;
        const existing = byMedId.get(med.id);
        nextItems.push({
            id: existing?.id || `formulary_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            medId: med.id,
            name: med.name,
            strength: formatMedStrength(med),
            units: formatInventoryUnits(med),
            targetQty: result[`targetQty-${med.id}`] || existing?.targetQty || '',
            notes: result[`notes-${med.id}`] || ''
        });
    });
    result.customRows.forEach(item => {
        const existing = customItems.find(candidate =>
            candidate.name.toLowerCase() === item.name.toLowerCase() &&
            String(candidate.strength || '').toLowerCase() === String(item.strength || '').toLowerCase()
        );
        nextItems.push({
            id: existing?.id || `formulary_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            ...item,
            barcodeCodes: existing?.barcodeCodes || []
        });
    });
    db.formularyItems = sortByName(nextItems, formularyItemName);
    await sync();
};

window.viewFormulary = async function() {
    window.editFormularyAfterView = false;
    const items = sortByName(db.formularyItems || [], formularyItemName);
    const cards = items.map(item => {
        const med = item.medId ? db.inventory.find(candidate => candidate.id === item.medId) : null;
        const searchText = [
            formularyItemName(item),
            med ? formatMedStrength(med) : item.strength,
            med ? formatInventoryUnits(med) : item.units,
            item.targetQty,
            item.notes
        ].filter(Boolean).join(' ').toLowerCase();
        return `<div class="formulary-view-card" data-search="${escapeHtml(searchText)}">
            <div class="formulary-view-main">
                <strong>${escapeHtml(formularyItemName(item))}</strong>
                <span>${escapeHtml(med ? 'Inventory item' : 'Non-inventory item')}</span>
            </div>
            <div class="formulary-view-meta">
                <div><small>Current</small><b>${escapeHtml(med ? `${formatAmount(parseAmount(med.stock))} ${inventoryUnitFor(med)}` : 'Not in inventory')}</b></div>
                <div><small>Target</small><b>${escapeHtml(item.targetQty || '-')}</b></div>
                <div><small>Strength</small><b>${escapeHtml(med ? formatMedStrength(med) : (item.strength || '-'))}</b></div>
                <div><small>Units</small><b>${escapeHtml(med ? formatInventoryUnits(med) : (item.units || '-'))}</b></div>
            </div>
            ${item.notes ? `<div class="formulary-view-notes">${escapeHtml(item.notes)}</div>` : ''}
        </div>`;
    }).join('');
    const result = await showActionModal('View Formulary', `
        <div data-action-modal-size="wide" class="formulary-view">
            <div class="formulary-view-toolbar">
                <div>
                    <strong>Master Formulary</strong>
                    <div class="form-help">${items.length} item${items.length === 1 ? '' : 's'} saved. Editing updates this same list.</div>
                </div>
                <div class="field-row">
                    <label>Search:</label><input id="formulary-view-search" type="text" placeholder="Find formulary item..." oninput="filterFormularyView()">
                    <button type="button" onclick="window.editFormularyAfterView = true; document.getElementById('action-modal-cancel')?.click();">Edit Formulary</button>
                </div>
            </div>
            <div id="formulary-view-list" class="formulary-view-list">${cards || '<div class="empty-state">No formulary items saved.</div>'}</div>
        </div>
    `, 'Generate PDF');
    if (window.editFormularyAfterView) {
        window.editFormularyAfterView = false;
        await createEditFormulary();
        return;
    }
    if (result) await saveReportPdf('Formulary', formularyPdfBody(), 'Formulary');
};

function orderLineFromInventory(med, reason = '') {
    return {
        id: `line_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        sourceType: 'inventory',
        medId: med.id,
        name: med.name,
        strength: formatMedStrength(med),
        units: formatInventoryUnits(med),
        inventoryUnit: inventoryUnitFor(med),
        requestedQty: '',
        receivedQty: 0,
        estimatedUnitPrice: med.lastUnitPrice || '',
        actualUnitPrice: '',
        actualTotal: '',
        purchaseLink: med.purchaseLink || '',
        barcodeCodes: medicationCodes(med),
        notes: reason,
        status: 'open'
    };
}

function orderLineFromFormulary(item) {
    const med = item.medId ? db.inventory.find(candidate => candidate.id === item.medId) : null;
    return {
        id: `line_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        sourceType: med ? 'inventory' : 'formulary',
        medId: med?.id || '',
        formularyId: item.id,
        name: med?.name || item.name,
        strength: med ? formatMedStrength(med) : (item.strength || ''),
        units: med ? formatInventoryUnits(med) : (item.units || ''),
        formulation: med?.formulation || item.formulation || 'Other',
        strengthAmount: item.strengthAmount || item.strength || '',
        activeUnit: item.activeUnit || item.units || '',
        perAmount: item.perAmount || '',
        perUnit: item.perUnit || '',
        inventoryUnit: med ? inventoryUnitFor(med) : (item.units || 'unit'),
        expiry: item.expiry || '',
        storage: item.storage || '',
        requestedQty: item.targetQty || '',
        receivedQty: 0,
        estimatedUnitPrice: item.lastUnitPrice || med?.lastUnitPrice || '',
        actualUnitPrice: '',
        actualTotal: '',
        purchaseLink: item.purchaseLink || med?.purchaseLink || '',
        barcodeCodes: formularyBarcodeCodes(item),
        notes: item.notes || '',
        status: 'open'
    };
}

window.addOrderCustomRow = function(values = {}) {
    const container = document.getElementById('order-custom-list');
    if (!container) return;
    const rowId = `order-custom-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const div = document.createElement('div');
    div.id = rowId;
    div.className = 'formulary-custom-row order-custom-card';
    const isCombination = !!values.isCombination || (Array.isArray(values.components) && values.components.length > 0);
    const sharedBasis = sharedComponentDenominator(values.components || []);
    const selectedFormulation = values.formulation || 'Other';
    const selectedUnit = String(values.activeUnit || values.units || '').split('/')[0] || 'mg';
    const selectedPerUnit = values.perUnit || String(values.units || '').split('/')[1] || defaultPerUnitForFormulation(selectedFormulation) || '';
    div.innerHTML = `
        <input name="orderCustomLineId" type="hidden" value="${escapeHtml(values.id || '')}">
        <div class="order-custom-head">
            <strong>New non-inventory item</strong>
            <button type="button" onclick="document.getElementById('${rowId}').remove(); renderOrderBuilderPreview();">Remove</button>
        </div>
        <label>Name<input name="orderCustomName" type="text" placeholder="Medication or supplement name" value="${escapeHtml(values.name || '')}" oninput="renderOrderBuilderPreview()"></label>
        <label>Formulation<select name="orderCustomFormulation" onchange="updateOrderCustomCombination('${rowId}')">${formulationOptionsHtml(selectedFormulation)}</select></label>
        <div class="order-custom-combo-select">
            <input id="${rowId}-is-combination" name="orderCustomIsCombination" type="checkbox" ${isCombination ? 'checked' : ''} onchange="updateOrderCustomCombination('${rowId}')">
            <label for="${rowId}-is-combination">Combination Product?</label>
        </div>
        <span class="order-custom-simple-strength">
            <label>Strength amount<input name="orderCustomStrength" type="text" placeholder="e.g. 0.63, 150" value="${escapeHtml(values.strengthAmount || values.strength || '')}" oninput="renderOrderBuilderPreview()"></label>
            <label>Strength unit<select name="orderCustomUnits" onchange="renderOrderBuilderPreview()">${strengthUnitOptionsHtml(selectedUnit)}</select></label>
            <label>Per amount<input name="orderCustomPerAmount" type="number" min="0.001" step="any" placeholder="1" value="${escapeHtml(values.perAmount || '1')}" oninput="renderOrderBuilderPreview()"></label>
            <label>Per unit<select name="orderCustomPerUnit" onchange="renderOrderBuilderPreview()">${perUnitOptionsHtml(selectedPerUnit)}</select></label>
        </span>
        <div class="order-custom-combo-fields order-custom-wide" style="display:none;">
            <div class="order-custom-combo-title">Combination product active ingredients</div>
            <div class="combo-basis-panel">
                <label><input name="orderCustomUseSharedPer" type="checkbox" ${sharedBasis || !values.components?.length ? 'checked' : ''} onchange="updateOrderCustomCombination('${rowId}')"> Use one package/concentration basis</label>
                <span>per</span>
                <input name="orderCustomSharedPerAmount" type="number" min="0.001" step="any" value="${escapeHtml(sharedBasis ? formatAmount(sharedBasis.amount) : (values.perAmount || '1'))}" oninput="updateOrderCustomCombination('${rowId}')">
                <select name="orderCustomSharedPerUnit" onchange="updateOrderCustomCombination('${rowId}')">${perUnitOptionsHtml(sharedBasis?.unit || selectedPerUnit)}</select>
                <button type="button" onclick="addOrderCustomComponentRow('${rowId}')">Add Ingredient</button>
            </div>
            <div class="order-custom-component-list"></div>
            <div class="order-custom-combo-preview combo-strength-preview">Add ingredients to preview the combined strength.</div>
        </div>
        <label>Order quantity<input name="orderCustomQty" type="text" placeholder="Amount to order" value="${escapeHtml(values.requestedQty || '')}" oninput="renderOrderBuilderPreview()"></label>
        <label>Stock unit<input name="orderCustomInventoryUnit" type="text" placeholder="bottle, tablet, mL" value="${escapeHtml(values.inventoryUnit || '')}" oninput="renderOrderBuilderPreview()"></label>
        <label>Estimated price<input name="orderCustomPrice" type="text" placeholder="Line price" value="${escapeHtml(values.estimatedUnitPrice || '')}" oninput="renderOrderBuilderPreview()"></label>
        <label>Purchase link<input name="orderCustomLink" type="url" placeholder="https://..." value="${escapeHtml(values.purchaseLink || '')}" oninput="renderOrderBuilderPreview()"></label>
        <label>Expiry if known<input name="orderCustomExpiry" type="date" value="${escapeHtml(values.expiry || '')}" oninput="renderOrderBuilderPreview()"></label>
        <label>Storage<select name="orderCustomStorage" onchange="renderOrderBuilderPreview()">
            <option value="" ${!values.storage ? 'selected' : ''}>Unknown</option>
            <option value="Room Temp" ${values.storage === 'Room Temp' ? 'selected' : ''}>Room Temp</option>
            <option value="Refrigerated" ${values.storage === 'Refrigerated' ? 'selected' : ''}>Refrigerated</option>
            <option value="Frozen" ${values.storage === 'Frozen' ? 'selected' : ''}>Frozen</option>
        </select></label>
        <label>Barcode if known<input name="orderCustomBarcode" type="text" placeholder="Scan or type code" value="${escapeHtml(asArray(values.barcodeCodes)[0] || values.barcodeCode || '')}" oninput="renderOrderBuilderPreview()"></label>
        <label class="order-custom-wide">Notes<input name="orderCustomNotes" type="text" placeholder="Notes, package size, preferred brand, etc." value="${escapeHtml(values.notes || '')}" oninput="renderOrderBuilderPreview()"></label>`;
    container.appendChild(div);
    (values.components || []).forEach(component => window.addOrderCustomComponentRow(rowId, component));
    window.updateOrderCustomCombination(rowId);
    window.renderOrderBuilderPreview?.();
};

function inventoryReorderCandidates() {
    const groups = getInventoryStatusGroups();
    const ids = new Set([...groups.low, ...groups.expired].map(med => med.id));
    return db.inventory.filter(med => ids.has(med.id));
}

function preserveOrderLineState(nextLine, previousLine) {
    if (!previousLine) return nextLine;
    return {
        ...nextLine,
        id: previousLine.id || nextLine.id,
        receivedQty: previousLine.receivedQty || 0,
        actualUnitPrice: previousLine.actualUnitPrice || '',
        actualTotal: previousLine.actualTotal || '',
        status: previousLine.status === 'received' ? 'received' : nextLine.status,
        barcodeCodes: Array.from(new Set([...asArray(previousLine.barcodeCodes), ...asArray(nextLine.barcodeCodes)]))
    };
}

function buildInventoryOrderLinesFromResult(result, existingOrder = null) {
    const existingLines = existingOrder?.lines || [];
    const findExistingInventoryLine = id => existingLines.find(line => line.medId === id && !line.formularyId && line.status !== 'received');
    const findExistingFormularyLine = id => existingLines.find(line => line.formularyId === id && line.status !== 'received');
    const lines = [];

    asArray(result.candidateMedIds).forEach(id => {
        const med = db.inventory.find(item => item.id === id);
        if (!med) return;
        const line = orderLineFromInventory(med, 'Auto-added from low/expired stock');
        line.requestedQty = result[`candidateQty-${id}`] || '';
        line.estimatedUnitPrice = result[`candidatePrice-${id}`] || line.estimatedUnitPrice || '';
        line.purchaseLink = result[`candidateLink-${id}`] || line.purchaseLink || '';
        lines.push(preserveOrderLineState(line, findExistingInventoryLine(id)));
    });
    asArray(result.otherInventoryIds).forEach(id => {
        const med = db.inventory.find(item => item.id === id);
        if (!med) return;
        const line = orderLineFromInventory(med, 'Added from current inventory');
        line.requestedQty = result[`otherInventoryQty-${id}`] || '';
        line.estimatedUnitPrice = result[`otherInventoryPrice-${id}`] || line.estimatedUnitPrice || '';
        line.purchaseLink = result[`otherInventoryLink-${id}`] || line.purchaseLink || '';
        if (!lines.some(existing => existing.medId && existing.medId === line.medId)) {
            lines.push(preserveOrderLineState(line, findExistingInventoryLine(id)));
        }
    });
    asArray(result.formularyOrderIds).forEach(id => {
        const item = db.formularyItems.find(candidate => candidate.id === id);
        if (!item) return;
        const line = orderLineFromFormulary(item);
        line.requestedQty = result[`formularyQty-${id}`] || line.requestedQty || '';
        line.estimatedUnitPrice = result[`formularyPrice-${id}`] || line.estimatedUnitPrice || '';
        line.purchaseLink = result[`formularyLink-${id}`] || line.purchaseLink || '';
        if (!lines.some(existing => (line.medId && existing.medId === line.medId) || (existing.formularyId && existing.formularyId === line.formularyId))) {
            lines.push(preserveOrderLineState(line, findExistingFormularyLine(id)));
        }
    });
    result.customRows.forEach(item => {
        const previous = item.lineId ? existingLines.find(line => line.id === item.lineId) : null;
        const comboMed = { isCombination: true, components: item.components || [] };
        const isCombination = !!item.isCombination && item.components?.length > 0;
        const strength = isCombination ? formatCombinationStrength(comboMed) : item.strength;
        const units = isCombination ? formatInventoryUnits(comboMed) : item.units;
        lines.push(preserveOrderLineState({
            id: item.lineId || `line_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            sourceType: 'new',
            medId: '',
            formularyId: '',
            name: item.name,
            strength,
            units,
            formulation: item.formulation || 'Other',
            strengthAmount: isCombination ? null : item.strength,
            activeUnit: isCombination ? null : (item.units || 'mg'),
            perAmount: item.perAmount || '1',
            perUnit: item.perUnit || '',
            isCombination,
            components: isCombination ? item.components : [],
            inventoryUnit: item.inventoryUnit || defaultInventoryUnitForFormulation(item.formulation || 'Other', defaultInventoryBehaviorForFormulation(item.formulation || 'Other')),
            expiry: item.expiry || '',
            storage: item.storage || '',
            requestedQty: item.requestedQty,
            receivedQty: 0,
            estimatedUnitPrice: item.estimatedUnitPrice || '',
            actualUnitPrice: '',
            actualTotal: '',
            purchaseLink: item.purchaseLink || '',
            barcodeCode: item.barcodeCode || '',
            barcodeCodes: normalizeMedicationCode(item.barcodeCode) ? [normalizeMedicationCode(item.barcodeCode)] : [],
            notes: item.notes,
            status: 'open'
        }, previous));
    });
    return lines;
}

window.createInventoryOrder = async function(editOrderId = '') {
    const editOrder = editOrderId ? db.inventoryOrders?.find(order => order.id === editOrderId) : null;
    const isEdit = !!editOrder;
    const existingLines = editOrder?.lines || [];
    const existingInventoryLine = medId => existingLines.find(line => line.medId === medId && !line.formularyId && line.status !== 'received');
    const existingFormularyLine = formularyId => existingLines.find(line => line.formularyId === formularyId && line.status !== 'received');
    const customExistingLines = existingLines.filter(line => !line.medId && !line.formularyId && line.status !== 'received');
    const candidates = inventoryReorderCandidates();
    const candidateIds = new Set(candidates.map(med => med.id));
    const defaultOrderName = `Inventory Order ${new Date().toLocaleDateString()}`;
    const candidateChoices = sortByName(candidates, inventoryDisplayName).map((med, index) => {
        const inputId = `order-candidate-${index}`;
        const expired = getInventoryStatusGroups().expired.some(item => item.id === med.id);
        const reason = expired ? 'Expired' : 'Low stock';
        const existing = existingInventoryLine(med.id);
        const checked = isEdit ? !!existing : true;
        const price = existing?.estimatedUnitPrice || med.lastUnitPrice || '';
        const link = existing?.purchaseLink || med.purchaseLink || '';
        return `<div class="formulary-item inventory-builder-source-item order-builder-source-item" data-search="${escapeHtml(inventorySearchText(med))}">
            <input id="${inputId}" name="candidateMedIds" data-order-source="true" data-med-id="${escapeHtml(med.id)}" type="checkbox" value="${escapeHtml(med.id)}" ${checked ? 'checked' : ''} onchange="orderBuilderSelectionChanged(this)">
            <label for="${inputId}"><strong>${escapeHtml(inventoryDisplayName(med))}</strong><br><span class="form-help">${escapeHtml(reason)} - ${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))} on hand</span></label>
            <input name="candidateQty-${escapeHtml(med.id)}" type="text" placeholder="Order qty" value="${escapeHtml(existing?.requestedQty || med.maxCapacity || med.minThreshold || '')}" style="width:90px;" oninput="renderOrderBuilderPreview()">
            <input name="candidatePrice-${escapeHtml(med.id)}" type="text" placeholder="Price" value="${escapeHtml(price)}" style="width:78px;" oninput="renderOrderBuilderPreview()">
            <input name="candidateLink-${escapeHtml(med.id)}" type="url" placeholder="Purchase link" value="${escapeHtml(link)}" style="width:150px;" oninput="renderOrderBuilderPreview()">
        </div>`;
    }).join('');
    const otherInventoryChoices = sortByName(db.inventory.filter(med => !candidateIds.has(med.id)), inventoryDisplayName).map((med, index) => {
        const inputId = `order-other-inventory-${index}`;
        const existing = existingInventoryLine(med.id);
        const price = existing?.estimatedUnitPrice || med.lastUnitPrice || '';
        const link = existing?.purchaseLink || med.purchaseLink || '';
        return `<div class="formulary-item inventory-builder-source-item order-builder-source-item" data-search="${escapeHtml(inventorySearchText(med))}">
            <input id="${inputId}" name="otherInventoryIds" data-order-source="true" data-med-id="${escapeHtml(med.id)}" type="checkbox" value="${escapeHtml(med.id)}" ${existing ? 'checked' : ''} onchange="orderBuilderSelectionChanged(this)">
            <label for="${inputId}"><strong>${escapeHtml(inventoryDisplayName(med))}</strong><br><span class="form-help">${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))} on hand</span></label>
            <input name="otherInventoryQty-${escapeHtml(med.id)}" type="text" placeholder="Order qty" value="${escapeHtml(existing?.requestedQty || med.maxCapacity || '')}" style="width:90px;" oninput="renderOrderBuilderPreview()">
            <input name="otherInventoryPrice-${escapeHtml(med.id)}" type="text" placeholder="Price" value="${escapeHtml(price)}" style="width:78px;" oninput="renderOrderBuilderPreview()">
            <input name="otherInventoryLink-${escapeHtml(med.id)}" type="url" placeholder="Purchase link" value="${escapeHtml(link)}" style="width:150px;" oninput="renderOrderBuilderPreview()">
        </div>`;
    }).join('');
    const formularyChoices = sortByName(db.formularyItems || [], formularyItemName).map((item, index) => {
        const inputId = `order-formulary-${index}`;
        const med = item.medId ? db.inventory.find(candidate => candidate.id === item.medId) : null;
        const existing = existingFormularyLine(item.id);
        const price = existing?.estimatedUnitPrice || item.lastUnitPrice || med?.lastUnitPrice || '';
        const link = existing?.purchaseLink || item.purchaseLink || med?.purchaseLink || '';
        return `<div class="formulary-item inventory-builder-source-item order-builder-source-item" data-search="${escapeHtml(formularyItemName(item).toLowerCase())} ${escapeHtml(String(item.notes || '').toLowerCase())}">
            <input id="${inputId}" name="formularyOrderIds" data-order-source="true" data-med-id="${escapeHtml(med?.id || '')}" type="checkbox" value="${escapeHtml(item.id)}" ${existing ? 'checked' : ''} onchange="orderBuilderSelectionChanged(this)">
            <label for="${inputId}"><strong>${escapeHtml(formularyItemName(item))}</strong><br><span class="form-help">${escapeHtml(item.notes || 'Formulary item')}</span></label>
            <input name="formularyQty-${escapeHtml(item.id)}" type="text" placeholder="Order qty" value="${escapeHtml(existing?.requestedQty || item.targetQty || '')}" style="width:90px;" oninput="renderOrderBuilderPreview()">
            <input name="formularyPrice-${escapeHtml(item.id)}" type="text" placeholder="Price" value="${escapeHtml(price)}" style="width:78px;" oninput="renderOrderBuilderPreview()">
            <input name="formularyLink-${escapeHtml(item.id)}" type="url" placeholder="Purchase link" value="${escapeHtml(link)}" style="width:150px;" oninput="renderOrderBuilderPreview()">
        </div>`;
    }).join('');
    const modalTitle = isEdit ? `Edit Order: ${inventoryOrderName(editOrder)}` : 'Create Inventory Order';
    const confirmText = isEdit ? 'Save Order' : 'Create Order';
    const orderPromise = showActionModal(modalTitle, `
        <div data-action-modal-size="wide" class="inventory-builder-layout">
            <div class="inventory-builder-source">
                <div style="font-size:11px; margin-bottom:6px;">${isEdit ? 'Edit this order with the same tools used to create it. Use the pending order panel to remove items quickly.' : 'Low-stock and expired medications are selected automatically. Remove anything you do not want, then add formulary, current inventory, or new items as needed.'}</div>
                <div class="field-row" style="margin-bottom:6px;">
                    <label>Order name:</label><input name="orderName" type="text" value="${escapeHtml(isEdit ? inventoryOrderName(editOrder) : defaultOrderName)}" style="width:260px;">
                </div>
                <div class="field-row" style="margin-bottom:6px;">
                    <label>Search:</label><input id="order-builder-search" class="inventory-builder-search" type="text" placeholder="Find inventory or formulary item..." oninput="filterOrderBuilder()">
                </div>
                <div style="font-size:11px; margin:4px 0;"><strong>Low or expired inventory</strong></div>
                <div class="formulary-grid">${candidateChoices || '<div class="empty-state">No low-stock or expired inventory items.</div>'}</div>
                <div style="font-size:11px; margin:8px 0 4px;"><strong>Add other current inventory</strong></div>
                <div class="formulary-grid">${otherInventoryChoices || '<div class="empty-state">No other inventory items available.</div>'}</div>
                <div style="font-size:11px; margin:8px 0 4px;"><strong>Add from formulary</strong></div>
                <div class="formulary-grid">${formularyChoices || '<div class="empty-state">No formulary items saved.</div>'}</div>
                <div class="field-row" style="margin-top:8px;"><button type="button" onclick="addOrderCustomRow()">Add New Non-formulary Item</button></div>
                <div id="order-custom-list"></div>
                <div class="field-row-stacked" style="margin-top:8px;">
                    <label>Order note:</label><textarea name="orderNote" rows="2" style="width:100%; resize:none;">${escapeHtml(isEdit ? editOrder.note || '' : '')}</textarea>
                </div>
            </div>
            <div class="inventory-builder-selected">
                <div class="inventory-builder-panel-title">${isEdit ? 'Edited order' : 'Pending order'}</div>
                <div id="order-builder-preview" class="inventory-builder-panel"></div>
            </div>
        </div>
    `, confirmText, body => {
        const base = collectNamedInputs(body);
        base.customRows = Array.from(body.querySelectorAll('.formulary-custom-row')).map(row => {
            const isCombination = row.querySelector('[name="orderCustomIsCombination"]')?.checked;
            const combo = isCombination ? collectOrderCustomComponents(row) : { components: [], invalidDenominator: false };
            return {
                lineId: row.querySelector('[name="orderCustomLineId"]')?.value || '',
                name: row.querySelector('[name="orderCustomName"]')?.value.trim() || '',
                strength: row.querySelector('[name="orderCustomStrength"]')?.value.trim() || '',
                units: row.querySelector('[name="orderCustomUnits"]')?.value.trim() || '',
                formulation: row.querySelector('[name="orderCustomFormulation"]')?.value.trim() || '',
                perAmount: row.querySelector('[name="orderCustomPerAmount"]')?.value.trim() || '',
                perUnit: row.querySelector('[name="orderCustomPerUnit"]')?.value.trim() || '',
                inventoryUnit: row.querySelector('[name="orderCustomInventoryUnit"]')?.value.trim() || '',
                expiry: row.querySelector('[name="orderCustomExpiry"]')?.value.trim() || '',
                storage: row.querySelector('[name="orderCustomStorage"]')?.value.trim() || '',
                barcodeCode: row.querySelector('[name="orderCustomBarcode"]')?.value.trim() || '',
                requestedQty: row.querySelector('[name="orderCustomQty"]')?.value.trim() || '',
                estimatedUnitPrice: row.querySelector('[name="orderCustomPrice"]')?.value.trim() || '',
                purchaseLink: row.querySelector('[name="orderCustomLink"]')?.value.trim() || '',
                notes: row.querySelector('[name="orderCustomNotes"]')?.value.trim() || '',
                isCombination,
                components: combo.components,
                invalidCombinationDenominator: combo.invalidDenominator
            };
        }).filter(item => item.name);
        return base;
    });
    if (isEdit) customExistingLines.forEach(line => window.addOrderCustomRow(line));
    window.renderOrderBuilderPreview?.();
    const result = await orderPromise;
    if (!result) {
        if (isEdit) await viewInventoryOrderLog();
        return;
    }
    const invalidCustomCombo = (result.customRows || []).find(item =>
        item.isCombination && (item.invalidCombinationDenominator || !item.components?.length)
    );
    if (invalidCustomCombo) {
        await appAlert(`Complete the active ingredients and package basis for ${invalidCustomCombo.name}.`);
        if (isEdit) await viewInventoryOrderLog();
        return;
    }

    const lines = buildInventoryOrderLinesFromResult(result, editOrder);
    if (lines.length === 0) {
        await appAlert(`Add at least one item to ${isEdit ? 'save' : 'create'} an order.`);
        if (isEdit) await viewInventoryOrderLog();
        return;
    }
    db.inventoryOrders = db.inventoryOrders || [];
    const orderName = String(result.orderName || '').trim() || defaultOrderName;
    if (isEdit) {
        editOrder.name = orderName;
        editOrder.note = result.orderNote || '';
        editOrder.lines = lines;
        editOrder.status = editOrder.lines.every(line => line.status === 'received') ? 'received'
            : editOrder.lines.some(line => line.status === 'received') ? 'partial'
            : 'open';
        editOrder.estimatedTotal = orderEstimatedTotal(editOrder);
        editOrder.actualTotal = orderActualTotal(editOrder);
        db.history.unshift({
            id: Date.now().toString(),
            timestamp: new Date().toLocaleString(),
            medName: orderName,
            details: `Edited inventory order with ${lines.length} item${lines.length === 1 ? '' : 's'}.`
        });
        await sync();
        await viewInventoryOrderLog();
        return;
    }
    db.inventoryOrders.unshift({
        id: `order_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: orderName,
        createdAt: new Date().toISOString(),
        status: 'open',
        note: result.orderNote || '',
        estimatedTotal: lines.reduce((sum, line) => sum + orderLineEstimatedTotal(line), 0),
        actualTotal: 0,
        lines
    });
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medName: orderName,
        details: `Created reorder with ${lines.length} item${lines.length === 1 ? '' : 's'}.`
    });
    await sync();
};

window.markReceiveLineScanned = function() {
    const body = document.getElementById('action-modal-body');
    const codeInput = body?.querySelector('#receive-scan-code');
    const lineSelect = body?.querySelector('#receive-scan-line');
    const code = normalizeMedicationCode(codeInput?.value);
    if (!body || !code) return;
    let lineId = lineSelect?.value || '';
    if (!lineId) {
        const matchedMed = findInventoryByBarcode(code);
        const matchedRow = matchedMed && body.querySelector(`.order-line-item[data-med-id="${cssEscape(matchedMed.id)}"]`);
        lineId = matchedRow?.dataset.lineId || '';
    }
    if (!lineId) {
        void appAlert('Select the order line this new barcode belongs to.');
        return;
    }
    const row = body.querySelector(`.order-line-item[data-line-id="${cssEscape(lineId)}"]`);
    if (!row) return;
    row.querySelector('[name="receiveLine"]').checked = true;
    row.querySelector('[name="receiveBarcode"]').value = code;
    row.classList.add('receive-line-received');
    if (codeInput) codeInput.value = '';
};

function orderCustomComponentRowHtml(rowId, component = {}) {
    const selectedUnit = component.unit || 'mg';
    const selectedPerUnit = component.perUnit || '';
    return `<div class="order-custom-component combo-row">
        <label>Ingredient<input name="orderCustomComponentName" type="text" placeholder="e.g. Dextromethorphan" value="${escapeHtml(component.name || '')}" oninput="updateOrderCustomCombination('${escapeHtml(rowId)}')"></label>
        <label>Amount<input name="orderCustomComponentStrength" type="number" min="0" step="any" placeholder="10" value="${escapeHtml(component.strengthAmount ?? component.strength ?? '')}" oninput="updateOrderCustomCombination('${escapeHtml(rowId)}')"></label>
        <label>Unit<select name="orderCustomComponentUnit" onchange="updateOrderCustomCombination('${escapeHtml(rowId)}')">${strengthUnitOptionsHtml(selectedUnit)}</select></label>
        <div class="component-per-controls">
            <label>per amount<input name="orderCustomComponentPerAmount" type="number" min="0.001" step="any" value="${escapeHtml(component.perAmount || '1')}" oninput="updateOrderCustomCombination('${escapeHtml(rowId)}')"></label>
            <label>per unit<select name="orderCustomComponentPerUnit" onchange="updateOrderCustomCombination('${escapeHtml(rowId)}')">${perUnitOptionsHtml(selectedPerUnit)}</select></label>
        </div>
        <button type="button" class="combo-row-remove" onclick="this.closest('.order-custom-component').remove(); updateOrderCustomCombination('${escapeHtml(rowId)}')">Remove</button>
    </div>`;
}

function collectOrderCustomComponents(row) {
    const useShared = row.querySelector('[name="orderCustomUseSharedPer"]')?.checked !== false;
    const sharedAmount = parseAmount(row.querySelector('[name="orderCustomSharedPerAmount"]')?.value, NaN);
    const sharedUnit = row.querySelector('[name="orderCustomSharedPerUnit"]')?.value || '';
    let invalidDenominator = false;
    const components = Array.from(row.querySelectorAll('.order-custom-component')).map(componentRow => {
        const name = componentRow.querySelector('[name="orderCustomComponentName"]')?.value.trim() || '';
        const strengthAmount = parseAmount(componentRow.querySelector('[name="orderCustomComponentStrength"]')?.value, NaN);
        const unit = componentRow.querySelector('[name="orderCustomComponentUnit"]')?.value || 'mg';
        const rowPerAmount = parseAmount(componentRow.querySelector('[name="orderCustomComponentPerAmount"]')?.value, NaN);
        const rowPerUnit = componentRow.querySelector('[name="orderCustomComponentPerUnit"]')?.value || '';
        const perAmount = useShared ? sharedAmount : rowPerAmount;
        const perUnit = useShared ? sharedUnit : rowPerUnit;
        if (perUnit && (!Number.isFinite(perAmount) || perAmount <= 0)) invalidDenominator = true;
        const hasDenominator = perUnit && Number.isFinite(perAmount) && perAmount > 0;
        return {
            name,
            strength: hasDenominator ? strengthAmount / perAmount : strengthAmount,
            strengthAmount,
            unit,
            perAmount: hasDenominator ? perAmount : null,
            perUnit: hasDenominator ? perUnit : ''
        };
    }).filter(component => component.name && Number.isFinite(component.strengthAmount) && component.strengthAmount > 0);
    return { components, invalidDenominator, useShared };
}

window.updateOrderCustomCombination = function(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const isCombo = row.querySelector('[name="orderCustomIsCombination"]')?.checked;
    const useShared = row.querySelector('[name="orderCustomUseSharedPer"]')?.checked !== false;
    const simpleFields = row.querySelector('.order-custom-simple-strength');
    const comboFields = row.querySelector('.order-custom-combo-fields');
    if (simpleFields) simpleFields.style.display = isCombo ? 'none' : 'contents';
    if (comboFields) comboFields.style.display = isCombo ? 'grid' : 'none';
    const componentList = row.querySelector('.order-custom-component-list');
    if (componentList) componentList.classList.toggle('use-shared-basis', !!isCombo && useShared);
    if (isCombo && componentList && componentList.children.length === 0) {
        componentList.insertAdjacentHTML('beforeend', orderCustomComponentRowHtml(rowId));
    }
    const preview = row.querySelector('.order-custom-combo-preview');
    if (preview) {
        const { components, invalidDenominator } = collectOrderCustomComponents(row);
        if (!isCombo) {
            preview.className = 'combo-strength-preview';
            preview.textContent = 'Turn on combination product to add active ingredients.';
        } else if (invalidDenominator) {
            preview.className = 'combo-strength-preview error';
            preview.textContent = 'Enter a valid shared package basis greater than 0.';
        } else if (!components.length) {
            preview.className = 'combo-strength-preview';
            preview.textContent = 'Add ingredients to preview the combined strength.';
        } else {
            preview.className = 'combo-strength-preview ok';
            preview.textContent = `Package strength: ${formatCombinationStrength({ isCombination: true, components }, true)}`;
        }
    }
    window.renderOrderBuilderPreview?.();
};

window.addOrderCustomComponentRow = function(rowId, component = {}) {
    const row = document.getElementById(rowId);
    const list = row?.querySelector('.order-custom-component-list');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', orderCustomComponentRowHtml(rowId, component));
    updateOrderCustomCombination(rowId);
};

function formulationOptionsHtml(selected = 'Other') {
    return Object.entries(dosageFormDefinitions).map(([value, definition]) =>
        `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(definition.label || value)}</option>`
    ).join('');
}

function strengthUnitOptionsHtml(selected = '') {
    return componentUnitOptions.map(value =>
        `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value)}</option>`
    ).join('');
}

function perUnitOptionsHtml(selected = '') {
    return componentPerUnitOptions.map(value =>
        `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(value || 'unit')}</option>`
    ).join('');
}

window.updateReceiveIntakeDefaults = function() {
    const formulation = document.getElementById('receive-new-formulation')?.value || 'Other';
    const behaviorSelect = document.getElementById('receive-new-inventory-behavior');
    if (behaviorSelect && dosageFormUsesContainerTracking(formulation)) {
        behaviorSelect.value = 'container-finish';
        behaviorSelect.disabled = true;
    } else if (behaviorSelect) {
        behaviorSelect.disabled = false;
        if (!behaviorSelect.value) behaviorSelect.value = defaultInventoryBehaviorForFormulation(formulation);
    }
    const behavior = behaviorSelect?.value || defaultInventoryBehaviorForFormulation(formulation);
    const stockUnit = document.getElementById('receive-new-inventory-unit');
    const adminUnit = document.getElementById('receive-new-administration-unit');
    const suggestedUnit = defaultInventoryUnitForFormulation(formulation, behavior);
    if (stockUnit && !stockUnit.value) stockUnit.value = suggestedUnit;
    if (adminUnit && !adminUnit.value) adminUnit.value = defaultAdministrationUnitForFormulation(formulation);
    const sharedUnit = document.getElementById('receive-combo-shared-per-unit');
    if (sharedUnit && !sharedUnit.value) sharedUnit.value = defaultPerUnitForFormulation(formulation);
    updateReceiveCombinationMode();
};

window.addReceiveIngredientRow = function(component = {}) {
    const list = document.getElementById('receive-ingredient-list');
    if (!list) return;
    const selectedUnit = component.unit || 'mg';
    const selectedPerUnit = component.perUnit || defaultPerUnitForFormulation(document.getElementById('receive-new-formulation')?.value || 'Other');
    const row = document.createElement('div');
    row.className = 'receive-combo-row combo-row';
    row.innerHTML = `
        <label>Ingredient<input class="receive-ing-name" type="text" placeholder="Ingredient" value="${escapeHtml(component.name || '')}" oninput="updateCombinationPreview('receive')"></label>
        <label>Amount<input class="receive-ing-strength" type="number" min="0" step="any" placeholder="Strength" value="${escapeHtml(component.strengthAmount ?? component.strength ?? '')}" oninput="updateCombinationPreview('receive')"></label>
        <label>Unit<select class="receive-ing-unit" onchange="updateCombinationPreview('receive')">${strengthUnitOptionsHtml(selectedUnit)}</select></label>
        <div class="component-per-controls">
            <label>per amount<input class="receive-ing-per-amount" type="number" min="0.001" step="any" value="${escapeHtml(component.perAmount || '1')}" oninput="updateCombinationPreview('receive')"></label>
            <label>per unit<select class="receive-ing-per-unit" onchange="updateCombinationPreview('receive')">${perUnitOptionsHtml(selectedPerUnit)}</select></label>
        </div>
        <button type="button" class="combo-row-remove" onclick="this.closest('.receive-combo-row').remove(); updateCombinationPreview('receive')">Remove</button>`;
    list.appendChild(row);
    updateCombinationPreview('receive');
};

window.updateReceiveCombinationMode = function() {
    const isCombo = document.getElementById('receive-new-is-combination')?.checked;
    const single = document.getElementById('receive-single-strength-fields');
    const combo = document.getElementById('receive-combination-fields');
    if (single) single.style.display = isCombo ? 'none' : 'flex';
    if (combo) combo.style.display = isCombo ? 'block' : 'none';
    const list = document.getElementById('receive-ingredient-list');
    if (isCombo && list && list.children.length === 0) addReceiveIngredientRow();
    updateCombinationPreview('receive');
};

window.updateReceiveAssignmentMode = function() {
    const mode = document.getElementById('receive-new-assignment-mode')?.value || 'all';
    const list = document.getElementById('receive-new-assigned-members');
    if (list) list.style.display = mode === 'selected' ? 'grid' : 'none';
};

async function promptNewInventoryFromOrderLine(line, barcode, qty) {
    const unitParts = String(line.units || '').split('/');
    const selectedUnit = line.activeUnit || unitParts[0] || 'mg';
    const selectedPerUnit = line.perUnit || unitParts[1] || '';
    const parsedLineStrength = parseAmount(line.strength, NaN);
    const lineStrengthAmount = line.strengthAmount || (Number.isFinite(parsedLineStrength) ? String(parsedLineStrength) : '');
    const receivedBarcode = normalizeMedicationCode(barcode) || normalizeMedicationCode(line.barcodeCode) || asArray(line.barcodeCodes).map(normalizeMedicationCode).filter(Boolean)[0] || createMedicationCode();
    const selectedFormulation = line.formulation || 'Other';
    const selectedStorage = line.storage || 'Room Temp';
    const lineIsCombination = !!line.isCombination && Array.isArray(line.components) && line.components.length > 0;
    const sharedBasis = sharedComponentDenominator(line.components || []);
    const assignmentChoices = db.family.map(member => `
        <label class="receive-intake-member">
            <input name="receiveAssignedMemberIds" type="checkbox" value="${escapeHtml(member.id)}">
            ${escapeHtml(memberDisplayName(member))}
        </label>`).join('');
    const intakePromise = showActionModal(`New Inventory Intake: ${line.name}`, `
        <div data-action-modal-size="wide" class="receive-intake">
            <div class="receive-intake-banner">
                <strong>This item is not in inventory yet.</strong>
                <span>Enter the product details from the package being received. The scanned/generated QR code will be saved to this medication.</span>
            </div>
            <div class="receive-intake-grid">
                <fieldset>
                    <legend>Product Identity</legend>
                    <div class="field-row-stacked"><label>Name</label><input name="name" type="text" value="${escapeHtml(line.name || '')}"></div>
                    <div class="field-row" style="margin-top:6px;">
                        <label>QR / barcode:</label><input id="receive-new-barcode" name="barcodeCode" type="text" value="${escapeHtml(receivedBarcode)}" style="width:220px;">
                        <button type="button" onclick="generateMedicationCode('receive-new-barcode')">Generate</button>
                    </div>
                    <div class="field-row" style="margin-top:6px;">
                        <label>Formulation:</label>
                        <select id="receive-new-formulation" name="formulation" onchange="updateReceiveIntakeDefaults()">${formulationOptionsHtml(selectedFormulation)}</select>
                        <label>Control:</label>
                        <select name="controlLevel">
                            <option value="N/A">N/A</option><option value="C-II">C-II</option><option value="C-III">C-III</option><option value="C-IV">C-IV</option><option value="C-V">C-V</option>
                        </select>
                    </div>
                </fieldset>
                <fieldset>
                    <legend>Strength & Stock</legend>
                    <div class="order-custom-combo-select">
                        <input id="receive-new-is-combination" name="isCombination" type="checkbox" ${lineIsCombination ? 'checked' : ''} onchange="updateReceiveCombinationMode()">
                        <label for="receive-new-is-combination">Combination Product?</label>
                    </div>
                    <div id="receive-single-strength-fields" class="field-row">
                        <label>Strength:</label><input name="strength" type="number" min="0" step="any" value="${escapeHtml(lineStrengthAmount)}" style="width:80px;">
                        <select name="units" style="width:90px;">${strengthUnitOptionsHtml(selectedUnit)}</select>
                        <label>per</label><input name="perAmount" type="number" min="0.001" step="any" value="${escapeHtml(line.perAmount || '1')}" style="width:55px;">
                        <select name="perUnit" style="width:90px;">${perUnitOptionsHtml(selectedPerUnit)}</select>
                    </div>
                    <div id="receive-combination-fields" style="display:none; margin-top:6px;">
                        <div class="order-custom-combo-title">Combination product active ingredients</div>
                        <div class="combo-basis-panel">
                            <label><input id="receive-combo-use-shared-per" type="checkbox" ${sharedBasis || !line.components?.length ? 'checked' : ''} onchange="updateCombinationPreview('receive')"> Use one package/concentration basis</label>
                            <span>per</span>
                            <input id="receive-combo-shared-per-amount" type="number" min="0.001" step="any" value="${escapeHtml(sharedBasis ? formatAmount(sharedBasis.amount) : (line.perAmount || '1'))}" oninput="updateCombinationPreview('receive')">
                            <select id="receive-combo-shared-per-unit" onchange="updateCombinationPreview('receive')">${perUnitOptionsHtml(sharedBasis?.unit || selectedPerUnit)}</select>
                            <button type="button" onclick="addReceiveIngredientRow()">Add Ingredient</button>
                        </div>
                        <div id="receive-ingredient-list"></div>
                        <div id="receive-combination-preview" class="combo-strength-preview">Add ingredients to preview the combined strength.</div>
                    </div>
                    <div class="field-row" style="margin-top:6px;">
                        <label>Qty received:</label><input name="qtyReceived" type="number" step="any" value="${escapeHtml(qty || line.requestedQty || 1)}" style="width:70px;">
                        <label>Alert at:</label><input name="minThreshold" type="number" step="any" value="5" style="width:60px;">
                    </div>
                    <div class="field-row" style="margin-top:6px;">
                        <label>Track as:</label>
                        <select id="receive-new-inventory-behavior" name="inventoryBehavior" onchange="updateReceiveIntakeDefaults()">
                            <option value="per-dose">Individual dose units</option>
                            <option value="container-finish">Whole containers</option>
                        </select>
                    </div>
                    <div class="field-row" style="margin-top:6px;">
                        <label>Stock unit:</label><input id="receive-new-inventory-unit" name="inventoryUnit" type="text" value="${escapeHtml(line.inventoryUnit || '')}" style="width:90px;">
                        <label>Give/apply as:</label><input id="receive-new-administration-unit" name="administrationUnit" type="text" value="${escapeHtml(line.administrationUnit || '')}" style="width:100px;">
                    </div>
                </fieldset>
                <fieldset>
                    <legend>Safety & Assignment</legend>
                    <div class="field-row">
                        <label>Expiry:</label><input name="expiry" type="date" value="${escapeHtml(line.expiry || '')}">
                        <label>Storage:</label>
                        <select name="storage"><option value="Room Temp" ${selectedStorage === 'Room Temp' ? 'selected' : ''}>Room Temp</option><option value="Refrigerated" ${selectedStorage === 'Refrigerated' ? 'selected' : ''}>Refrigerated</option><option value="Frozen" ${selectedStorage === 'Frozen' ? 'selected' : ''}>Frozen</option></select>
                    </div>
                    <div class="field-row" style="margin-top:6px;">
                        <label>Assign to:</label>
                        <select id="receive-new-assignment-mode" name="assignmentMode" onchange="updateReceiveAssignmentMode()">
                            <option value="all">All members</option>
                            <option value="selected">Selected members</option>
                        </select>
                    </div>
                    <div id="receive-new-assigned-members" class="receive-intake-members">${assignmentChoices || '<span class="form-help">No members saved yet.</span>'}</div>
                </fieldset>
                <fieldset>
                    <legend>Notes</legend>
                    <textarea name="notes" rows="7" style="width:100%; resize:none;">${escapeHtml(line.notes || '')}</textarea>
                </fieldset>
            </div>
        </div>
    `, 'Add to Inventory', body => {
        const values = collectNamedInputs(body);
        values.assignedMemberIds = asArray(values.receiveAssignedMemberIds);
        values.isCombination = body.querySelector('#receive-new-is-combination')?.checked || false;
        const combo = values.isCombination ? collectCombinationComponents('receive') : { components: [], invalidDenominator: false };
        values.components = combo.components;
        values.invalidCombinationDenominator = combo.invalidDenominator;
        return values;
    });
    window.updateReceiveIntakeDefaults?.();
    window.updateReceiveAssignmentMode?.();
    if ((line.components || []).length) {
        const receiveList = document.getElementById('receive-ingredient-list');
        if (receiveList) receiveList.innerHTML = '';
    }
    (line.components || []).forEach(component => window.addReceiveIngredientRow?.(component));
    window.updateReceiveCombinationMode?.();
    const result = await intakePromise;
    if (!result) return null;
    if (!result.name?.trim()) {
        await appAlert('Medication name is required.');
        return null;
    }
    if (result.assignmentMode === 'selected' && asArray(result.assignedMemberIds).length === 0) {
        await appAlert('Select at least one member or assign the item to all members.');
        return null;
    }
    const finalBarcode = normalizeMedicationCode(result.barcodeCode) || createMedicationCode();
    if (finalBarcode.length > 100 || await warnBarcodeConflict(finalBarcode)) return null;
    const isCombination = !!result.isCombination;
    const components = isCombination ? (result.components || []) : [];
    if (isCombination && (result.invalidCombinationDenominator || components.length === 0)) {
        await appAlert('Add at least one valid active ingredient and package basis for this combination product.');
        return null;
    }
    const strengthAmount = isCombination ? null : parseAmount(result.strength, NaN);
    if (!isCombination && (!Number.isFinite(strengthAmount) || strengthAmount <= 0)) {
        await appAlert('Strength must be greater than 0.');
        return null;
    }
    const perAmount = parseAmount(result.perAmount, 1);
    const perUnit = result.perUnit || '';
    const activeUnit = result.units || selectedUnit || 'mg';
    const hasDenominator = !isCombination && perUnit && Number.isFinite(perAmount) && perAmount > 0;
    const comboMed = { isCombination: true, components };
    const finalStrength = isCombination ? formatCombinationStrength(comboMed) : (hasDenominator ? strengthAmount / perAmount : strengthAmount);
    const finalUnits = isCombination ? formatInventoryUnits(comboMed) : (hasDenominator ? `${activeUnit}/${perUnit}` : activeUnit);
    const displayStrength = isCombination
        ? finalStrength
        : (hasDenominator
            ? (perAmount === 1 ? `${formatAmount(strengthAmount)}${activeUnit}/${perUnit}` : `${formatAmount(strengthAmount)}${activeUnit}/${formatAmount(perAmount)}${perUnit}`)
            : `${formatAmount(strengthAmount)}${activeUnit}`);
    const formulation = result.formulation || line.formulation || 'Other';
    const inventoryBehavior = dosageFormUsesContainerTracking(formulation)
        ? 'container-finish'
        : (result.inventoryBehavior || defaultInventoryBehaviorForFormulation(formulation));
    const inventoryUnit = result.inventoryUnit || defaultInventoryUnitForFormulation(formulation, inventoryBehavior);
    const med = {
        id: Date.now().toString(),
        name: result.name.trim(),
        strength: finalStrength,
        units: finalUnits,
        displayStrength,
        strengthAmount,
        activeUnit: isCombination ? null : activeUnit,
        perAmount: isCombination ? null : (hasDenominator ? perAmount : null),
        perUnit: isCombination ? '' : (hasDenominator ? perUnit : ''),
        formulation,
        inventoryUnit,
        administrationUnit: result.administrationUnit || defaultAdministrationUnitForFormulation(formulation) || inventoryUnit,
        inventoryBehavior,
        stock: 0,
        maxCapacity: 0,
        expiry: result.expiry || '',
        storage: result.storage || 'Room Temp',
        controlLevel: result.controlLevel || 'N/A',
        isLiquid: String(finalUnits).includes('/') || formulation === 'mL',
        isCombination,
        components,
        minThreshold: parseAmount(result.minThreshold, 5),
        prescriberId: '',
        assignedMemberIds: result.assignmentMode === 'selected' ? asArray(result.assignedMemberIds) : [],
        barcodeCode: finalBarcode,
        barcodeCodes: [finalBarcode],
        notes: result.notes || '',
        _intakeReceivedQty: parseAmount(result.qtyReceived, qty)
    };
    db.inventory.push(med);
    line.barcodeCodes = Array.from(new Set([...asArray(line.barcodeCodes), finalBarcode]));
    return med;
}

async function receiveOrderLine(line, receivedQty, barcode, cost = {}) {
    const normalizedBarcode = normalizeMedicationCode(barcode);
    let med = line.medId ? db.inventory.find(item => item.id === line.medId) : null;
    const barcodeMatch = normalizedBarcode ? findInventoryByBarcode(normalizedBarcode) : null;
    if (normalizedBarcode && med && barcodeMatch && barcodeMatch.id !== med.id) {
        await warnBarcodeConflict(normalizedBarcode, med.id);
        return false;
    }
    if (!med && barcodeMatch) med = barcodeMatch;
    if (!med) {
        const lineName = String(line.name || '').trim().toLowerCase();
        const lineStrength = String(line.strength || '').trim().toLowerCase();
        med = db.inventory.find(item =>
            String(item.name || '').trim().toLowerCase() === lineName &&
            (!lineStrength || String(formatMedStrength(item) || '').trim().toLowerCase() === lineStrength)
        ) || null;
    }
    if (normalizedBarcode && !med && await warnBarcodeConflict(normalizedBarcode)) return false;
    if (!med) {
        med = await promptNewInventoryFromOrderLine(line, normalizedBarcode, receivedQty);
        if (med && Number.isFinite(parseAmount(med._intakeReceivedQty, NaN))) {
            receivedQty = parseAmount(med._intakeReceivedQty, receivedQty);
            delete med._intakeReceivedQty;
        }
    }
    if (!med) return false;
    if (normalizedBarcode) addMedicationBarcode(med, normalizedBarcode);
    med.stock = parseAmount(med.stock, 0) + parseAmount(receivedQty, 0);
    if (parseAmount(med.maxCapacity, 0) < parseAmount(med.stock, 0)) med.maxCapacity = med.stock;
    const actualUnitPrice = String(cost.actualUnitPrice || '').trim();
    const actualTotal = String(cost.actualTotal || '').trim();
    if (actualUnitPrice) med.lastUnitPrice = actualUnitPrice;
    if (line.purchaseLink) med.purchaseLink = line.purchaseLink;
    line.medId = med.id;
    line.receivedQty = parseAmount(line.receivedQty, 0) + parseAmount(receivedQty, 0);
    line.actualUnitPrice = actualUnitPrice || line.actualUnitPrice || line.estimatedUnitPrice || '';
    line.actualTotal = actualTotal || line.actualUnitPrice || line.actualTotal || '';
    line.status = 'received';
    if (normalizedBarcode) {
        line.barcodeCodes = Array.from(new Set([...asArray(line.barcodeCodes), normalizedBarcode]));
        const formulary = line.formularyId ? db.formularyItems.find(item => item.id === line.formularyId) : null;
        if (formulary) {
            formulary.medId = formulary.medId || med.id;
            if (line.actualUnitPrice) formulary.lastUnitPrice = line.actualUnitPrice;
            if (line.purchaseLink) formulary.purchaseLink = line.purchaseLink;
            formulary.barcodeCodes = Array.from(new Set([...asArray(formulary.barcodeCodes), normalizedBarcode]));
        }
    }
    return true;
}

window.receiveInventoryOrder = async function() {
    const orders = (db.inventoryOrders || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (orders.length === 0) {
        await appAlert('No inventory orders have been created yet.');
        return;
    }
    const orderOptions = orders.map(order => `<option value="${escapeHtml(order.id)}">${escapeHtml(inventoryOrderLabel(order))}</option>`).join('');
    const selectResult = await showActionModal('Receive Order', `
        <div class="field-row"><label>Order:</label><select name="orderId" style="width:360px;">${orderOptions}</select></div>
        <div class="field-row" style="margin-top:8px;">
            <label>Mode:</label>
            <select name="receiveMode">
                <option value="manual">Receive all/manual entry</option>
                <option value="scan">Scan products by line</option>
            </select>
        </div>
    `, 'Continue');
    if (!selectResult) return;
    const order = db.inventoryOrders.find(item => item.id === selectResult.orderId);
    if (!order) return;
    const lineOptions = order.lines.map(line => `<option value="${escapeHtml(line.id)}">${escapeHtml(`${line.name} ${line.strength || ''}`)}</option>`).join('');
    const lineRows = order.lines.map(line => {
        const isNewNonInventory = isOrderLineNewNonInventory(line);
        return `
        <div class="order-line-item ${line.status === 'received' ? 'receive-line-received' : ''} ${isNewNonInventory ? 'order-new-noninventory' : ''}" data-line-id="${escapeHtml(line.id)}" data-med-id="${escapeHtml(line.medId || '')}">
            <input name="receiveLine" type="checkbox" value="${escapeHtml(line.id)}" ${selectResult.receiveMode === 'manual' && line.status !== 'received' ? 'checked' : ''}>
            <div><strong>${escapeHtml(line.name)} ${escapeHtml(line.strength || '')}${isNewNonInventory ? '<span class="order-new-badge">New non-inventory</span>' : ''}</strong><br><span class="form-help">Requested: ${escapeHtml(line.requestedQty || 'not specified')} ${escapeHtml(line.inventoryUnit || '')}${line.estimatedUnitPrice ? ` - est. ${escapeHtml(formatCurrency(line.estimatedUnitPrice))}` : ''}${line.status === 'received' ? ` - received${orderLineActualTotal(line) > 0 ? ` (${escapeHtml(formatCurrency(orderLineActualTotal(line)))})` : ''}` : ''}</span>${line.purchaseLink ? `<br><span class="form-help">Link: ${escapeHtml(line.purchaseLink)}</span>` : ''}</div>
            <input name="receiveQty" data-line-id="${escapeHtml(line.id)}" type="number" step="any" value="${escapeHtml(line.requestedQty || '1')}" style="width:80px;">
            <input name="receiveActualUnitPrice" data-line-id="${escapeHtml(line.id)}" type="text" placeholder="Actual price" value="${escapeHtml(line.actualUnitPrice || line.estimatedUnitPrice || '')}" style="width:92px;">
            <input name="receiveBarcode" data-line-id="${escapeHtml(line.id)}" type="text" placeholder="Barcode / QR code" value="" style="width:170px;">
        </div>`;
    }).join('');
    const scanPanel = selectResult.receiveMode === 'scan'
        ? `<div class="receive-scan-panel">
            <div class="field-row">
                <label>Scan code:</label><input id="receive-scan-code" type="text" style="width:220px;">
                <label>Apply to:</label><select id="receive-scan-line" style="width:240px;"><option value="">Auto match known barcode</option>${lineOptions}</select>
                <button type="button" onclick="markReceiveLineScanned()">Mark scanned</button>
            </div>
        </div>`
        : '';
    const result = await showActionModal(`Receive Order: ${inventoryOrderName(order)}`, `
        ${scanPanel}
        <div class="order-line-list">${lineRows}</div>
    `, 'Receive Selected', body => ({
        lines: Array.from(body.querySelectorAll('.order-line-item')).map(row => ({
            lineId: row.dataset.lineId,
            selected: row.querySelector('[name="receiveLine"]')?.checked === true,
            qty: row.querySelector('[name="receiveQty"]')?.value || '',
            actualUnitPrice: row.querySelector('[name="receiveActualUnitPrice"]')?.value || '',
            actualTotal: '',
            barcode: row.querySelector('[name="receiveBarcode"]')?.value || ''
        }))
    }));
    if (!result) return;
    let receivedCount = 0;
    for (const received of result.lines.filter(item => item.selected)) {
        const line = order.lines.find(item => item.id === received.lineId);
        const qty = parseAmount(received.qty, NaN);
        if (!line || !Number.isFinite(qty) || qty <= 0) continue;
        if (await receiveOrderLine(line, qty, received.barcode, received)) receivedCount++;
    }
    if (receivedCount === 0) {
        await appAlert('No order lines were received.');
        return;
    }
    order.status = order.lines.every(line => line.status === 'received') ? 'received' : 'partial';
    order.receivedAt = order.status === 'received' ? new Date().toISOString() : '';
    order.estimatedTotal = orderEstimatedTotal(order);
    order.actualTotal = orderActualTotal(order);
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medName: inventoryOrderName(order),
        details: `Received ${receivedCount} item${receivedCount === 1 ? '' : 's'} from order created ${new Date(order.createdAt).toLocaleString()}.${order.actualTotal > 0 ? ` Actual total: ${formatCurrency(order.actualTotal)}.` : ''}`
    });
    await sync();
};

function inventoryOrderPdfBody(order) {
    const estimated = orderEstimatedTotal(order);
    const actual = orderActualTotal(order);
    const rows = (order.lines || []).map(line => `
        <tr>
            <td>${escapeHtml(line.name || '')}</td>
            <td>${escapeHtml(line.strength || '')}</td>
            <td>${escapeHtml(line.units || '')}</td>
            <td>${escapeHtml(line.requestedQty || '')}</td>
            <td>${escapeHtml(line.receivedQty ? `${formatAmount(parseAmount(line.receivedQty))} ${line.inventoryUnit || ''}` : '')}</td>
            <td>${escapeHtml(line.estimatedUnitPrice ? formatCurrency(line.estimatedUnitPrice) : '')}</td>
            <td>${escapeHtml(orderLineActualTotal(line) > 0 ? formatCurrency(orderLineActualTotal(line)) : '')}</td>
            <td>${escapeHtml(line.status || 'open')}</td>
            <td>${line.purchaseLink ? `<a href="${escapeHtml(line.purchaseLink)}">${escapeHtml(line.purchaseLink)}</a>` : ''}</td>
            <td>${escapeHtml(line.notes || '')}</td>
        </tr>`).join('');
    return `<h2>${escapeHtml(inventoryOrderName(order))}</h2>
        <p>
            Created: ${escapeHtml(order.createdAt ? new Date(order.createdAt).toLocaleString() : '')}<br>
            Status: ${escapeHtml(order.status || 'open')}${order.receivedAt ? `<br>Received: ${escapeHtml(new Date(order.receivedAt).toLocaleString())}` : ''}<br>
            Estimated Total: <strong>${escapeHtml(formatCurrency(estimated))}</strong>${actual > 0 ? `<br>Actual Total: <strong>${escapeHtml(formatCurrency(actual))}</strong>` : ''}
        </p>
        ${order.note ? `<p><strong>Order note:</strong> ${escapeHtml(order.note)}</p>` : ''}
        <table>
            <thead>
                <tr><th>Item</th><th>Strength</th><th>Units</th><th>Requested</th><th>Received</th><th>Estimated Price</th><th>Actual Price</th><th>Status</th><th>Purchase Link</th><th>Notes</th></tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="10">No order lines saved.</td></tr>'}</tbody>
        </table>`;
}

function closeActionModalForFollowup() {
    document.getElementById('action-modal-cancel')?.click();
}

function orderLineLogHtml(line) {
    const med = line.medId ? db.inventory.find(item => item.id === line.medId) : null;
    const stockText = med ? `Stock now: ${formatAmount(parseAmount(med.stock))} ${inventoryUnitFor(med)}` : 'Not linked to inventory';
    const isNewNonInventory = isOrderLineNewNonInventory(line);
    return `<div class="order-log-line ${isNewNonInventory ? 'order-new-noninventory' : ''}">
        <strong>${escapeHtml(line.name || '')} ${escapeHtml(line.strength || '')}${isNewNonInventory ? '<span class="order-new-badge">New non-inventory</span>' : ''}</strong>
        <span>Requested: ${escapeHtml(line.requestedQty || 'N/A')} ${escapeHtml(line.inventoryUnit || '')}</span>
        <span>Received: ${escapeHtml(line.receivedQty ? `${formatAmount(parseAmount(line.receivedQty))} ${line.inventoryUnit || ''}` : 'None yet')}</span>
        <span>Est: ${escapeHtml(orderLineEstimatedTotal(line) > 0 ? formatCurrency(orderLineEstimatedTotal(line)) : 'N/A')}</span>
        <span>Actual: ${escapeHtml(orderLineActualTotal(line) > 0 ? formatCurrency(orderLineActualTotal(line)) : 'N/A')}</span>
        <span>${escapeHtml(stockText)}</span>
        ${line.purchaseLink ? `<span class="form-help">Link: ${escapeHtml(line.purchaseLink)}</span>` : ''}
    </div>`;
}

function inventoryOrderLogCard(order, receivedSection = false) {
    const estimated = orderEstimatedTotal(order);
    const actual = orderActualTotal(order);
    const canEditReceived = (order.lines || []).some(line => parseAmount(line.receivedQty, 0) > 0 || line.status === 'received');
    const canEditActive = !receivedSection && order.status !== 'received';
    return `<div class="inventory-order-card">
        <div class="inventory-order-card-head">
            <div>
                <strong>${escapeHtml(inventoryOrderName(order))}</strong>
                <div class="form-help">Created ${escapeHtml(order.createdAt ? new Date(order.createdAt).toLocaleString() : 'Unknown')} | ${escapeHtml(order.status || 'open')}${order.receivedAt ? ` | Received ${escapeHtml(new Date(order.receivedAt).toLocaleString())}` : ''}</div>
                <div class="order-total-line">Estimated ${escapeHtml(formatCurrency(estimated))}${actual > 0 ? ` | Actual ${escapeHtml(formatCurrency(actual))}` : ''}</div>
            </div>
            <div class="inventory-order-card-actions">
                ${canEditActive ? `<button type="button" onclick="editActiveInventoryOrder('${escapeHtml(order.id)}')">Edit Order</button>` : ''}
                ${receivedSection && canEditReceived ? `<button type="button" onclick="editReceivedInventoryOrder('${escapeHtml(order.id)}')">Modify Received</button>` : ''}
                <button type="button" onclick="printInventoryOrderPdf('${escapeHtml(order.id)}')">PDF</button>
                <button type="button" onclick="deleteInventoryOrder('${escapeHtml(order.id)}')">Delete</button>
            </div>
        </div>
        <div class="inventory-order-lines">${(order.lines || []).map(orderLineLogHtml).join('') || '<div class="empty-state">No order lines saved.</div>'}</div>
    </div>`;
}

function inventoryOrderLogHtml() {
    const orders = (db.inventoryOrders || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const openOrders = orders.filter(order => order.status !== 'received' && order.status !== 'partial');
    const receivedOrders = orders.filter(order => order.status === 'received' || order.status === 'partial');
    return `<div data-action-modal-size="wide" class="inventory-order-log">
        <div class="form-help">Created orders can be deleted here. Received orders stay in this log and can be corrected after receiving.</div>
        <fieldset>
            <legend>Created Orders</legend>
            ${openOrders.length ? openOrders.map(order => inventoryOrderLogCard(order, false)).join('') : '<div class="empty-state">No open created orders.</div>'}
        </fieldset>
        <fieldset style="margin-top:8px;">
            <legend>Received Order Log</legend>
            ${receivedOrders.length ? receivedOrders.map(order => inventoryOrderLogCard(order, true)).join('') : '<div class="empty-state">No received orders logged yet.</div>'}
        </fieldset>
    </div>`;
}

window.viewInventoryOrderLog = async function() {
    if (!db.inventoryOrders?.length) {
        await appAlert('No inventory orders have been created yet.');
        return;
    }
    await showActionModal('Inventory Order Log', inventoryOrderLogHtml(), 'Close');
};

window.deleteInventoryOrder = async function(orderId) {
    const order = db.inventoryOrders?.find(item => item.id === orderId);
    if (!order) return;
    closeActionModalForFollowup();
    const hasReceivedStock = (order.lines || []).some(line => parseAmount(line.receivedQty, 0) > 0);
    const message = hasReceivedStock
        ? 'Delete this order record from the log? Inventory quantities that were already received will remain unchanged.'
        : 'Delete this created order?';
    if (!await appConfirm(message, 'Delete Inventory Order')) {
        await viewInventoryOrderLog();
        return;
    }
    db.inventoryOrders = (db.inventoryOrders || []).filter(item => item.id !== orderId);
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medName: inventoryOrderName(order),
        details: 'Deleted inventory order record.'
    });
    await sync();
    if (db.inventoryOrders.length) await viewInventoryOrderLog();
};

window.editActiveInventoryOrder = async function(orderId) {
    const order = db.inventoryOrders?.find(item => item.id === orderId);
    if (!order) return;
    closeActionModalForFollowup();
    if (order.status === 'received') {
        await appAlert('This order has already been fully received. Use Modify Received instead.');
        await viewInventoryOrderLog();
        return;
    }
    await createInventoryOrder(orderId);
};

window.editReceivedInventoryOrder = async function(orderId) {
    const order = db.inventoryOrders?.find(item => item.id === orderId);
    if (!order) return;
    closeActionModalForFollowup();
    const receivedLines = (order.lines || []).filter(line => parseAmount(line.receivedQty, 0) > 0 || line.status === 'received');
    if (receivedLines.length === 0) {
        await appAlert('No received items are available to modify for this order.');
        await viewInventoryOrderLog();
        return;
    }
    const rows = receivedLines.map(line => `
        <div class="order-edit-line" data-line-id="${escapeHtml(line.id)}">
            <div>
                <strong>${escapeHtml(line.name || '')} ${escapeHtml(line.strength || '')}</strong>
                <div class="form-help">Requested: ${escapeHtml(line.requestedQty || 'N/A')} ${escapeHtml(line.inventoryUnit || '')}</div>
            </div>
            <label>Received qty:<input name="editReceivedQty" type="number" step="any" value="${escapeHtml(line.receivedQty || '')}"></label>
            <label>Actual price:<input name="editActualPrice" type="text" value="${escapeHtml(line.actualUnitPrice || line.actualTotal || '')}"></label>
            <label>Barcode:<input name="editBarcode" type="text" value=""></label>
            <label>Purchase link:<input name="editPurchaseLink" type="url" value="${escapeHtml(line.purchaseLink || '')}"></label>
            <label>Notes:<input name="editLineNotes" type="text" value="${escapeHtml(line.notes || '')}"></label>
        </div>`).join('');
    const result = await showActionModal(`Modify Received Order: ${inventoryOrderName(order)}`, `
        <div data-action-modal-size="wide">
            <div class="form-help">Changing received quantity adjusts the linked inventory stock by the difference.</div>
            <div class="order-edit-list">${rows}</div>
        </div>
    `, 'Save Changes', body => ({
        lines: Array.from(body.querySelectorAll('.order-edit-line')).map(row => ({
            lineId: row.dataset.lineId,
            receivedQty: row.querySelector('[name="editReceivedQty"]')?.value || '',
            actualPrice: row.querySelector('[name="editActualPrice"]')?.value || '',
            barcode: row.querySelector('[name="editBarcode"]')?.value || '',
            purchaseLink: row.querySelector('[name="editPurchaseLink"]')?.value || '',
            notes: row.querySelector('[name="editLineNotes"]')?.value || ''
        }))
    }));
    if (!result) {
        await viewInventoryOrderLog();
        return;
    }
    let changed = 0;
    for (const edit of result.lines) {
        const line = order.lines.find(item => item.id === edit.lineId);
        if (!line) continue;
        const nextQty = parseAmount(edit.receivedQty, NaN);
        if (!Number.isFinite(nextQty) || nextQty < 0) {
            await appAlert(`Received quantity for ${line.name || 'an item'} must be zero or greater.`);
            await viewInventoryOrderLog();
            return;
        }
        const med = line.medId ? db.inventory.find(item => item.id === line.medId) : null;
        const previousQty = parseAmount(line.receivedQty, 0);
        const delta = nextQty - previousQty;
        if (delta !== 0 && med) {
            if (parseAmount(med.stock, 0) + delta < 0) {
                await appAlert(`Cannot reduce ${med.name} below zero stock.`);
                await viewInventoryOrderLog();
                return;
            }
            med.stock = parseAmount(med.stock, 0) + delta;
            if (parseAmount(med.maxCapacity, 0) < parseAmount(med.stock, 0)) med.maxCapacity = med.stock;
        }
        const normalizedBarcode = normalizeMedicationCode(edit.barcode);
        if (normalizedBarcode) {
            const conflict = await warnBarcodeConflict(normalizedBarcode, med?.id || line.medId || '');
            if (conflict) {
                await viewInventoryOrderLog();
                return;
            }
            if (med) addMedicationBarcode(med, normalizedBarcode);
            line.barcodeCodes = Array.from(new Set([...asArray(line.barcodeCodes), normalizedBarcode]));
        }
        line.receivedQty = nextQty;
        line.actualUnitPrice = String(edit.actualPrice || '').trim();
        line.actualTotal = line.actualUnitPrice;
        line.purchaseLink = String(edit.purchaseLink || '').trim();
        line.notes = edit.notes || '';
        line.status = nextQty > 0 ? 'received' : 'open';
        if (med) {
            if (line.actualUnitPrice) med.lastUnitPrice = line.actualUnitPrice;
            if (line.purchaseLink) med.purchaseLink = line.purchaseLink;
        }
        changed++;
    }
    order.status = order.lines.every(line => line.status === 'received') ? 'received'
        : order.lines.some(line => line.status === 'received') ? 'partial'
        : 'open';
    order.receivedAt = order.status === 'received' ? (order.receivedAt || new Date().toISOString()) : '';
    order.actualTotal = orderActualTotal(order);
    order.estimatedTotal = orderEstimatedTotal(order);
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        medName: inventoryOrderName(order),
        details: `Modified received order log for ${changed} item${changed === 1 ? '' : 's'}.`
    });
    await sync();
    await viewInventoryOrderLog();
};

window.printInventoryOrderPdf = async function(orderId = '') {
    const orders = (db.inventoryOrders || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (orders.length === 0) {
        await appAlert('No inventory orders have been created yet.');
        return;
    }
    if (orderId) {
        const selected = orders.find(item => item.id === orderId);
        if (!selected) return;
        closeActionModalForFollowup();
        await saveReportPdf(`Inventory Order - ${inventoryOrderName(selected)}`, inventoryOrderPdfBody(selected), `Inventory_Order_${inventoryOrderName(selected)}`);
        return;
    }
    const options = orders.map(order => `<option value="${escapeHtml(order.id)}">${escapeHtml(inventoryOrderLabel(order))}</option>`).join('');
    const result = await showActionModal('Inventory Order PDF', `
        <div class="field-row"><label>Order:</label><select name="orderId" style="width:420px;">${options}</select></div>
    `, 'Generate PDF');
    if (!result) return;
    const order = orders.find(item => item.id === result.orderId);
    if (!order) return;
    await saveReportPdf(`Inventory Order - ${inventoryOrderName(order)}`, inventoryOrderPdfBody(order), `Inventory_Order_${inventoryOrderName(order)}`);
};

window.clearInventorySearch = function() {
    const search = document.getElementById('inventory-search');
    if (search) search.value = '';
    renderAll();
};


function renderAll() {
    const sortedInventory = [...db.inventory].sort((a, b) => {
        const byName = (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        if (byName !== 0) return byName;
        return formatMedStrength(a).localeCompare(formatMedStrength(b), undefined, { sensitivity: 'base' });
    });

    const familyList = document.getElementById('family-list');
    const memberSelect = document.getElementById('select-member');
    if (familyList && memberSelect) {
        familyList.innerHTML = ''; memberSelect.innerHTML = '';
        db.family.forEach(m => {
            const color = m.sex === "Female" ? "pink" : "lightblue";
            familyList.innerHTML += `<li class="med-item-row" style="background:${color}; margin-bottom:2px; border:1px inset white;">
                <span style="cursor:pointer; font-weight:bold;" onclick="openMemberModal('${m.id}')">👤 ${m.lastName}, ${m.firstName}</span>
                <button onclick="removeMember('${m.id}')">Remove</button></li>`;
            memberSelect.innerHTML += `<option value="${m.id}">${m.lastName}, ${m.firstName}</option>`;
        });
    }

    const tableBody = document.getElementById('inventory-table-body');
    const medDataList = document.getElementById('med-options');
    const medPrescriberSelect = document.getElementById('med-prescriber');
    if (tableBody) tableBody.innerHTML = '';
    if (medDataList) medDataList.innerHTML = '';
    if (medPrescriberSelect) medPrescriberSelect.innerHTML = prescriberOptionsHtml(medPrescriberSelect.value, '', true);
    renderMedicationAssignmentControls('med');
    renderSchedulePrescriberOptions();
    const inventoryQuery = (document.getElementById('inventory-search')?.value || '').trim().toLowerCase();
    const filteredInventory = inventoryQuery
        ? sortedInventory.filter(med => inventorySearchText(med).includes(inventoryQuery))
        : sortedInventory;
filteredInventory.forEach(med => {
    let displayStrength = formatMedStrength(med);
    if (tableBody) {
        const row = document.createElement('tr');

        // --- EXPIRATION LOGIC ---
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const fifteenDaysFromNow = new Date();
        fifteenDaysFromNow.setDate(today.getDate() + 15);

        // Parse the med's expiry date
        const expiryDate = med.expiry ? parseLocal(med.expiry) : null;

        const isLowStock = med.stock <= med.minThreshold;
        const isExpiringSoon = expiryDate && expiryDate <= fifteenDaysFromNow;
        const isExpired = expiryDate && expiryDate < today;

        // Turn row red if low stock OR expiring within 15 days
        if (isLowStock || isExpiringSoon || isExpired) {
            row.style.color = "red";
            row.style.fontWeight = "bold";
        }


        row.innerHTML = `
            <td style="display:flex; align-items:center; gap:5px;">
                ${med.imagePath ? `<img src="${imageSrc(med.imagePath)}" style="width:20px; height:20px; object-fit:cover;">` : '💊'}
                <span style="cursor:pointer; text-decoration:underline;" onclick="openMedProfile('${med.id}')">${med.name}</span>
            </td>
            <td>${displayStrength}</td>
            <td>${escapeHtml(formatInventoryUnits(med))}</td>
            <td>${formatAmount(parseAmount(med.stock))} ${escapeHtml(inventoryUnitFor(med))}${refillForecastText(med) ? `<br><small class="forecast-text">${escapeHtml(refillForecastText(med))}</small>` : ''}</td>
            <td>${med.minThreshold}</td>
            <td>${med.expiry || 'N/A'}</td> <!-- NEW EXPIRATION COLUMN -->
            <td>${escapeHtml(medicationAssignmentText(med))}</td>
            <td>
                <button onclick="takeDose('${med.id}')">Take</button>
                <button onclick="restockMed('${med.id}')">Restock</button>
                <button onclick="printInventoryLabel('${med.id}')">Label</button>
                <button onclick="deleteMed('${med.id}')">Delete</button>
            </td>`;
        tableBody.appendChild(row);
    }
});

if (tableBody && filteredInventory.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="8" style="padding:8px;">No inventory items match the search.</td></tr>';
}

sortedInventory.forEach(med => {

    if (medDataList) {
        const opt = document.createElement('option');
        opt.value = med.name;
        opt.innerText = formatMedStrength(med);
        medDataList.appendChild(opt);
    }
});


    const historyDiv = document.getElementById('history-log');
    if (historyDiv) {
        historyDiv.innerHTML = db.history.map(e => `<div style="font-size:11px; border-bottom:1px dotted #ccc;">[${e.timestamp}] ${e.medName}: ${e.details}</div>`).join('');
    }

    const schedList = document.getElementById('schedule-list');
    if (schedList) {
        schedList.innerHTML = '';
        db.schedules.filter(schedule => !isScheduleArchived(schedule)).forEach(s => {
            const p = db.family.find(f => f.id === s.memberId);
            const m = db.inventory.find(i => i.id === s.medId);
            schedList.innerHTML += `<div class="med-item-row" style="padding:5px; border-bottom:1px solid #808080;">
                <div style="flex-grow:1;"><b>${p?p.firstName:'?'}</b> - ${m?m.name:'?'} ${m?formatMedStrength(m):'?'} (${getScheduleTimes(s).join(', ') || 'PRN'})</div>
                <button onclick="openOrderModifier('${s.id}')">Edit</button>
                <button onclick="administerDose('${s.medId}','${s.id}')">💊 Admin</button>
                <button onclick="deleteSchedule('${s.id}')">Discontinue</button></div>`;
        });
    }
    renderCalendar();
    renderOrderSets();
    renderPrepackageQueues();
    renderRecipes();
    renderPendingScheduleOrders();
    renderScheduleLinkOptions();
    renderVitals();
    renderTodayViewDashboard();
    renderInventoryStatus();
    renderInventoryWorkflowSummary();
    renderVitalDashboard();
    renderDataHealthSummary();
    enhanceButtonIcons();
}
window.calculateLiveDose = function() {
    const medId = document.getElementById('sched-strength-display').value;
    const qty = parseAmount(document.getElementById('sched-dose-qty').value);
    const calcDisplay = document.getElementById('sched-calculated-dose');
    const unitsLabel = document.getElementById('sched-units-display');

    const med = db.inventory.find(m => m.id === medId);
    if (!med) {
        calcDisplay.value = '';
        return;
    }

    unitsLabel.innerText = med.administrationUnit || med.formulation;

    if (isTopicalMedication(med)) {
        calcDisplay.value = `${formatAmount(qty)} ${med.administrationUnit || 'application'}`;
        return;
    }

    let totalDose = 0;
    let doseUnit = med.units.includes('/') ? med.units.split('/')[0] : med.units;

    if (med.isCombination && med.components && med.components.length > 0) {
        const results = med.components.map(c => {
            const total = parseAmount(c.strength) * qty;
            return `${formatAmount(total)}${getComponentUnit(c, med)}`;
        });
        calcDisplay.value = results.join('/');
        return; // Exit early as we've handled the display
    }
    if (med.isLiquid) {
        // Example: 100mg/5mL -> concentration is 20mg per 1mL
        // User enters 10 in "Give Qty" (mL)
        // Dose = 10 * 20 = 200mg
        const parts = med.units.split('/'); // ["mg", "mL"]
        const conc = parseAmount(med.strength); // We assume user entered the concentration (e.g. 20)
        totalDose = qty * conc;
        doseUnit = parts[0];
    } else {
        // Example: 500mg Tablet. User enters 2 in "Give Qty".
        // Dose = 2 * 500 = 1000mg
        totalDose = qty * parseAmount(med.strength);
        doseUnit = med.units;
    }

    calcDisplay.value = `${formatAmount(totalDose)} ${doseUnit}`;
};


window.clearHistory = async function() {
    if (await appConfirm("Clear history?", "Clear Log")) {
        db.history = [];
        await sync();
    }
};

function getLabelSelectionRange(schedule) {
    const today = localDateKey();
    const start = schedule.startDate && schedule.startDate > today ? schedule.startDate : today;
    if (schedule.endDate && schedule.endDate !== 'Ongoing') {
        return schedule.endDate < start
            ? { start: schedule.startDate, end: schedule.endDate }
            : { start, end: schedule.endDate };
    }
    const end = new Date();
    end.setDate(end.getDate() + 30);
    return { start, end: localDateKey(end) };
}

function dateKeyPlusDays(dateKey, days) {
    const date = parseLocal(dateKey);
    if (!date) return '';
    date.setDate(date.getDate() + days);
    return localDateKey(date);
}

window.updateIndividualLabelOptions = function() {
    const body = document.getElementById('action-modal-body');
    if (!body) return;
    const rangeMode = body.querySelector('[name="labelRangeMode"]')?.value || 'single';
    const doseMode = body.querySelector('[name="labelDoseMode"]')?.value || 'all';
    const singleRow = body.querySelector('#individual-label-single-row');
    const customRow = body.querySelector('#individual-label-custom-row');
    const timeRow = body.querySelector('#individual-label-time-row');
    if (singleRow) singleRow.style.display = rangeMode === 'single' ? 'flex' : 'none';
    if (customRow) customRow.style.display = rangeMode === 'custom' ? 'flex' : 'none';
    if (timeRow) timeRow.style.display = doseMode === 'specific' ? 'flex' : 'none';
};

function medicationLabelHtml(schedule, med, member, doseDate, doseTimes, prepackShift = 'all') {
    const times = doseTimes.length > 0 ? doseTimes.join(', ') : 'As Needed';
    const header = schedule.freq === 'PRN' ? 'As Needed' : `${doseDate} | ${times}`;
    const instructionLine = schedule.instructions
        ? `<div class="label-small"><b>Instructions:</b> ${escapeHtml(schedule.instructions)}</div>`
        : '';
    const labelClass = getLabelClass([
        med.name,
        formatLabelMedStrength(med),
        formatPrescribedDose(med, schedule.doseQty),
        formatQtyForSchedule(schedule, med),
        `${member.firstName} ${member.lastName}`,
        schedule.instructions
    ], schedule.instructions ? 6 : 5);

    return `
        <div class="${labelClass}">
            <div class="label-date label-date-with-icon">${escapeHtml(header)}${labelShiftIconHtml(prepackShift)}</div>
            <div class="label-title">${escapeHtml(med.name)} ${escapeHtml(formatLabelMedStrength(med))}</div>
            <div class="label-small">Dose: ${escapeHtml(formatPrescribedDose(med, schedule.doseQty))}</div>
            <div class="label-small"><b>Qty: ${escapeHtml(formatQtyForSchedule(schedule, med))}</b></div>
            <div class="label-small">Member: ${escapeHtml(`${member.firstName} ${member.lastName}`)}</div>
            ${instructionLine}
        </div>`;
}

function medicationRangeLabelHtml(schedule, med, member, startDate, endDate, instances, prepackShift = 'all') {
    const totalQuantity = instances.reduce((sum) => sum + parseAmount(schedule.doseQty, 0), 0);
    const scheduledTimes = Array.from(new Set(instances.map(instance => instance.time)))
        .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    const instructionLine = schedule.instructions
        ? `<div class="label-small"><b>Instructions:</b> ${escapeHtml(schedule.instructions)}</div>`
        : '';
    const totalQtyText = formatQtyForSchedule({ ...schedule, doseQty: totalQuantity }, med);
    const scheduleText = schedule.freq === 'PRN'
        ? 'As needed'
        : `${formatFrequency(schedule)}${scheduledTimes.length ? ` at ${scheduledTimes.join(', ')}` : ''}`;
    const labelClass = getLabelClass([
        med.name,
        formatLabelMedStrength(med),
        formatPrescribedDose(med, schedule.doseQty),
        totalQtyText,
        scheduleText,
        memberDisplayName(member),
        schedule.instructions
    ], schedule.instructions ? 7 : 6);
    return `<div class="${labelClass}">
        <div class="label-date label-date-with-icon">${escapeHtml(startDate === endDate ? startDate : `${startDate} - ${endDate}`)}${labelShiftIconHtml(prepackShift)}</div>
        <div class="label-title">${escapeHtml(med.name)} ${escapeHtml(formatLabelMedStrength(med))}</div>
        <div class="label-small">Dose each time: ${escapeHtml(formatPrescribedDose(med, schedule.doseQty))}</div>
        <div class="label-small"><b>Total Qty: ${escapeHtml(totalQtyText)}</b></div>
        <div class="label-small">${escapeHtml(scheduleText)}</div>
        <div class="label-small">Member: ${escapeHtml(memberDisplayName(member))}</div>
        ${instructionLine}
    </div>`;
}

function linkedMedicationLabelLine(schedule, med, date, requestedTimes = [], prefix = '') {
    const dueInstances = date ? getScheduleInstancesForDate(schedule, date) : [];
    const requested = new Set(requestedTimes);
    const matchingInstances = requested.size
        ? dueInstances.filter(instance => requested.has(instance.time))
        : dueInstances;
    const times = matchingInstances.length
        ? matchingInstances.map(instance => instance.time).sort((a, b) => timeToMinutes(a) - timeToMinutes(b)).join(', ')
        : (date ? 'not scheduled this date' : formatFrequency(schedule));
    return `${prefix}${med.name} ${formatLabelMedStrength(med)} Dose ${formatPrescribedDose(med, schedule.doseQty)} Qty ${formatQtyForSchedule(schedule, med)} ${times}`;
}

function linkedMedicationInstructionLines(schedules) {
    return schedules
        .map(item => {
            if (!item.instructions) return '';
            const itemMed = db.inventory.find(medItem => medItem.id === item.medId);
            return `${itemMed?.name || 'Med'}: ${item.instructions}`;
        })
        .filter(Boolean)
        .slice(0, 3);
}

function linkedMedicationGroupNote(schedule, linkedSchedules) {
    const modes = linkedSchedules.map(linked => scheduleLinkModeBetween(schedule, linked)).filter(Boolean);
    if (modes.includes('together')) return 'Take together';
    if (modes.includes('choose-one')) return 'Choose one linked medication';
    return 'Linked medications';
}

function linkedMedicationGroupLabelHtml(schedule, med, member, date, doseTimes, linkedSchedules, prepackShift = 'all') {
    const primaryLine = `${med.name} ${formatLabelMedStrength(med)}`;
    const primaryDetails = `Dose ${formatPrescribedDose(med, schedule.doseQty)} | Qty ${formatQtyForSchedule(schedule, med)}`;
    const linkedLines = linkedSchedules.map(linked => {
        const linkedMed = db.inventory.find(item => item.id === linked.medId);
        if (!linkedMed) return '';
        const mode = scheduleLinkModeBetween(schedule, linked);
        const prefix = mode === 'choose-one' ? 'Option: ' : '';
        return linkedMedicationLabelLine(linked, linkedMed, date, doseTimes, prefix);
    }).filter(Boolean);
    const instructionLines = linkedMedicationInstructionLines([schedule, ...linkedSchedules]);
    const header = date ? `${date} | ${doseTimes.length ? doseTimes.join(', ') : 'As Needed'}` : 'Linked medications';
    const groupNote = linkedMedicationGroupNote(schedule, linkedSchedules);
    const labelClass = getLabelClass([
        header,
        primaryLine,
        primaryDetails,
        memberDisplayName(member),
        groupNote,
        ...linkedLines,
        ...instructionLines
    ], 4 + linkedLines.length + instructionLines.length);
    return `<div class="${labelClass}">
        <div class="label-date label-date-with-icon">${escapeHtml(header)}${labelShiftIconHtml(prepackShift)}</div>
        <div class="label-title">${escapeHtml(primaryLine)}</div>
        <div class="label-small">${escapeHtml(primaryDetails)}</div>
        <div class="label-small">Member: ${escapeHtml(memberDisplayName(member))}</div>
        <div class="label-small"><b>${escapeHtml(groupNote)}</b></div>
        ${linkedLines.map(line => `<div class="label-small">${escapeHtml(line)}</div>`).join('')}
        ${instructionLines.map(line => `<div class="label-small"><b>Instructions:</b> ${escapeHtml(line)}</div>`).join('')}
    </div>`;
}

function linkedMedicationRangeLabelHtml(schedule, med, member, startDate, endDate, instances, linkedSchedules, prepackShift = 'all') {
    const selectedTimes = Array.from(new Set(instances.map(instance => instance.time))).sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    const primaryLine = `${med.name} ${formatLabelMedStrength(med)}`;
    const primaryDetails = `Dose ${formatPrescribedDose(med, schedule.doseQty)} | ${formatFrequency(schedule)}${selectedTimes.length ? ` ${selectedTimes.join(', ')}` : ''}`;
    const linkedLines = linkedSchedules.map(linked => {
        const linkedMed = db.inventory.find(item => item.id === linked.medId);
        if (!linkedMed) return '';
        const mode = scheduleLinkModeBetween(schedule, linked);
        const prefix = mode === 'choose-one' ? 'Option: ' : '';
        return `${prefix}${linkedMed.name} ${formatLabelMedStrength(linkedMed)} Dose ${formatPrescribedDose(linkedMed, linked.doseQty)} ${formatFrequency(linked)}`;
    }).filter(Boolean);
    const instructionLines = linkedMedicationInstructionLines([schedule, ...linkedSchedules]);
    const groupNote = linkedMedicationGroupNote(schedule, linkedSchedules);
    const labelClass = getLabelClass([
        `${startDate} - ${endDate}`,
        primaryLine,
        primaryDetails,
        memberDisplayName(member),
        groupNote,
        ...linkedLines,
        ...instructionLines
    ], 4 + linkedLines.length + instructionLines.length);
    return `<div class="${labelClass}">
        <div class="label-date label-date-with-icon">${escapeHtml(startDate === endDate ? startDate : `${startDate} - ${endDate}`)}${labelShiftIconHtml(prepackShift)}</div>
        <div class="label-title">${escapeHtml(primaryLine)}</div>
        <div class="label-small">${escapeHtml(primaryDetails)}</div>
        <div class="label-small">Member: ${escapeHtml(memberDisplayName(member))}</div>
        <div class="label-small"><b>${escapeHtml(groupNote)}</b></div>
        ${linkedLines.map(line => `<div class="label-small">${escapeHtml(line)}</div>`).join('')}
        ${instructionLines.map(line => `<div class="label-small"><b>Instructions:</b> ${escapeHtml(line)}</div>`).join('')}
    </div>`;
}

window.printSingleLabel = async function(scheduleId) {
    const s = db.schedules.find(x => x.id === scheduleId);
    if (!s) return;
    const med = db.inventory.find(m => m.id === s.medId);
    const mem = db.family.find(f => f.id === s.memberId);
    if (!med || !mem) return;
    const linkedForLabel = linkedSchedulesFor(s, db.schedules.filter(item => item.memberId === s.memberId && !isScheduleArchived(item)));
    if (s.freq === 'PRN') {
        if (linkedForLabel.length > 0) {
            const result = await showActionModal(`Print Label: ${med.name}`, `
                <div class="field-row-stacked">
                    <label>Linked medications:</label>
                    <select name="includeLinkedMedications" style="width:280px;">
                        <option value="no">Print only this medication</option>
                        <option value="yes">Print linked medications on the same label</option>
                    </select>
                </div>
                <div class="form-help">Linked medications will be listed under the selected medication.</div>
            `, 'Preview Label');
            if (!result) return;
            previewLabelHtml(result.includeLinkedMedications === 'yes'
                ? linkedMedicationGroupLabelHtml(s, med, mem, '', [], linkedForLabel)
                : medicationLabelHtml(s, med, mem, '', []));
            return;
        }
        previewLabelHtml(medicationLabelHtml(s, med, mem, '', []));
        return;
    }

    const remainingRange = getLabelSelectionRange(s);
    const nextDose = getNextScheduledDose(s);
    const defaultDate = nextDose?.date >= remainingRange.start && nextDose?.date <= remainingRange.end
        ? nextDose.date
        : remainingRange.start;
    const defaultCustomEnd = dateKeyPlusDays(remainingRange.start, 6);
    const customEnd = defaultCustomEnd && defaultCustomEnd < remainingRange.end ? defaultCustomEnd : remainingRange.end;
    const orderHasEndDate = s.endDate && s.endDate !== 'Ongoing';
    const minDate = s.startDate || '';
    const maxDate = orderHasEndDate ? s.endDate : '';
    const dateBounds = `${minDate ? ` min="${escapeHtml(minDate)}"` : ''}${maxDate ? ` max="${escapeHtml(maxDate)}"` : ''}`;
    const scheduledTimes = getScheduleTimes(s).slice().sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    const timeOptions = scheduledTimes
        .map(time => `<option value="${escapeHtml(time)}">${escapeHtml(time)}</option>`)
        .join('');
    const doseModeOptions = scheduledTimes.length > 1
        ? `
            <option value="all">All scheduled times on one label per date</option>
            <option value="specific">One selected time per date</option>
            <option value="separate">Separate label for each scheduled time</option>`
        : '<option value="all">Scheduled time on one label per date</option>';
    const fullRangeOption = orderHasEndDate
        ? '<option value="full">Full order range (start through end)</option>'
        : '';

    const result = await showActionModal(`Print Label: ${med.name}`, `
        <div class="field-row-stacked">
            <label>Print period:</label>
            <select name="labelRangeMode" onchange="updateIndividualLabelOptions()" style="width:280px;">
                <option value="single">Specific date</option>
                <option value="custom">Custom date range</option>
                ${fullRangeOption}
            </select>
        </div>
        <div id="individual-label-single-row" class="field-row" style="margin-top:8px;">
            <label>Date:</label>
            <input name="labelSingleDate" type="date" value="${escapeHtml(defaultDate)}"${dateBounds}>
        </div>
        <div id="individual-label-custom-row" class="field-row" style="display:none; margin-top:8px;">
            <label>Start:</label><input name="labelStartDate" type="date" value="${escapeHtml(remainingRange.start)}"${dateBounds}>
            <label>End:</label><input name="labelEndDate" type="date" value="${escapeHtml(customEnd)}"${dateBounds}>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Dose times:</label>
            <select name="labelDoseMode" onchange="updateIndividualLabelOptions()" style="width:280px;">
                ${doseModeOptions}
            </select>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Container label layout:</label>
            <select name="labelLayout" style="width:280px;">
                <option value="daily">One label for each date</option>
                <option value="range">One label for the entire selected date range</option>
            </select>
        </div>
        <div id="individual-label-time-row" class="field-row" style="display:none; margin-top:8px;">
            <label>Scheduled time:</label>
            <select name="labelSpecificTime">${timeOptions}</select>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Prepack icon/group:</label>
            ${prepackShiftChoiceHtml(prepackShiftForTime(scheduledTimes[0]) || 'all')}
        </div>
        ${linkedForLabel.length ? `<div class="field-row-stacked" style="margin-top:8px;">
            <label>Linked medications:</label>
            <select name="includeLinkedMedications" style="width:280px;">
                <option value="no">Print only this medication</option>
                <option value="yes">Put linked medications on the same label</option>
            </select>
        </div>
        <div class="form-help">${escapeHtml(linkedForLabel.length)} linked medication${linkedForLabel.length === 1 ? '' : 's'} will be listed under this medication.</div>` : ''}
        ${!orderHasEndDate ? '<div class="form-help" style="margin-top:8px;">This order is ongoing, so use a specific date or custom date range.</div>' : ''}
    `, 'Preview Labels');
    if (!result) return;

    let startDate = '';
    let endDate = '';
    if (result.labelRangeMode === 'single') {
        startDate = result.labelSingleDate;
        endDate = result.labelSingleDate;
    } else if (result.labelRangeMode === 'full') {
        startDate = s.startDate;
        endDate = s.endDate;
    } else {
        startDate = result.labelStartDate;
        endDate = result.labelEndDate;
    }
    if (!startDate || !endDate || endDate < startDate) {
        await appAlert('Enter a valid label date or date range.');
        return;
    }

    let instances = getScheduleInstancesInRange(s, startDate, endDate);
    if (result.labelDoseMode === 'specific') {
        instances = instances.filter(instance => instance.time === result.labelSpecificTime);
    }
    const prepackShift = result.prepackShift || 'all';
    instances = filterRowsByPrepackShift(instances.map(instance => ({ instance })), prepackShift).map(row => row.instance);
    if (instances.length === 0) {
        await appAlert('This medication has no scheduled doses in the selected date range.');
        return;
    }

    let labels = [];
    const includeLinkedMedications = linkedForLabel.length > 0 && result.includeLinkedMedications === 'yes';
    if (result.labelLayout === 'range') {
        labels = [includeLinkedMedications
            ? linkedMedicationRangeLabelHtml(s, med, mem, startDate, endDate, instances, linkedForLabel, prepackShift)
            : medicationRangeLabelHtml(s, med, mem, startDate, endDate, instances, prepackShift)];
    } else if (result.labelDoseMode === 'all') {
        const byDate = instances.reduce((acc, instance) => {
            if (!acc[instance.date]) acc[instance.date] = [];
            acc[instance.date].push(instance.time);
            return acc;
        }, {});
        labels = Object.entries(byDate).map(([date, times]) =>
            includeLinkedMedications
                ? linkedMedicationGroupLabelHtml(s, med, mem, date, times.slice().sort((a, b) => timeToMinutes(a) - timeToMinutes(b)), linkedForLabel, prepackShift)
                : medicationLabelHtml(s, med, mem, date, times.slice().sort((a, b) => timeToMinutes(a) - timeToMinutes(b)), prepackShift)
        );
    } else {
        labels = instances.map(instance => includeLinkedMedications
            ? linkedMedicationGroupLabelHtml(s, med, mem, instance.date, [instance.time], linkedForLabel, prepackShift)
            : medicationLabelHtml(s, med, mem, instance.date, [instance.time], prepackShift));
    }

    if (labels.length > 100 && !await appConfirm(`This will create ${labels.length} labels. Continue?`, 'Large Label Print Job')) {
        return;
    }
    const prepackRows = instances.flatMap(instance => {
        const rows = [{ schedule: s, med, instance }];
        if (includeLinkedMedications) {
            linkedForLabel.forEach(linked => {
                const linkedMed = db.inventory.find(item => item.id === linked.medId);
                if (!linkedMed) return;
                const linkedInstance = getScheduleInstancesForDate(linked, instance.date).find(candidate => candidate.time === instance.time);
                if (!linkedInstance) return;
                rows.push({ schedule: linked, med: linkedMed, instance: linkedInstance });
            });
        }
        return rows;
    });
    previewLabelHtml(
        labels.join(''),
        buildPrepackDefinition(
            s.memberId,
            `Individual medication labels: ${med.name}`,
            prepackRows,
            {
                kind: 'schedule-list',
                scheduleIds: [s.id],
                startDate,
                endDate,
                specificTime: result.labelDoseMode === 'specific' ? result.labelSpecificTime : '',
                labelLayout: result.labelLayout || 'daily',
                singleMedication: true,
                prepackShift
            }
        )
    );
};

function inventoryLabelHtml(med) {
    const qrDataUrl = medicationQrDataUrl(med.barcodeCode);

    const notesLine = med.notes ? `<div class="label-small"><b>Notes:</b> ${escapeHtml(med.notes)}</div>` : '';
    const labelClass = getLabelClass([
        med.name,
        formatLabelMedStrength(med),
        med.stock,
        inventoryUnitFor(med),
        med.storage,
        med.expiry,
        med.controlLevel,
        med.notes
    ], med.notes ? 6 : 5);

    return `
        <div class="${labelClass} inventory-qr-label">
            <div class="inventory-qr-copy">
                <div class="label-title">${escapeHtml(med.name)} ${escapeHtml(formatLabelMedStrength(med))}</div>
                <div class="label-small">On hand: ${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))}</div>
                <div class="label-small">Storage: ${escapeHtml(med.storage || 'N/A')}</div>
                <div class="label-small">Exp: ${escapeHtml(med.expiry || 'N/A')} | Ctrl: ${escapeHtml(med.controlLevel || 'N/A')}</div>
                ${notesLine}
                <div class="label-small label-code">${escapeHtml(med.barcodeCode)}</div>
            </div>
            ${qrDataUrl ? `<img class="inventory-label-qr" src="${qrDataUrl}" alt="Medication QR code">` : ''}
        </div>`;
}

window.printInventoryLabel = async function(medId) {
    const med = db.inventory.find(m => m.id === medId);
    if (!med) return;
    if (!med.barcodeCode) {
        med.barcodeCode = createMedicationCode();
        med.barcodeCodes = medicationCodes(med);
        await window.api.save(db);
    }
    previewLabelHtml(inventoryLabelHtml(med));
};

window.toggleAllInventoryLabelChoices = function(checked) {
    const body = document.getElementById('action-modal-body');
    if (!body) return;
    body.querySelectorAll('input[name="inventoryMedIds"]').forEach(input => {
        input.checked = checked;
    });
};

window.printAllInventoryLabels = async function() {
    const inventory = db.inventory
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (inventory.length === 0) {
        await appAlert('There are no inventory items to print.');
        return;
    }

    const choices = inventory.map((med, index) => {
        const inputId = `inventory-label-choice-${index}`;
        return `<div class="label-selection-item">
            <input id="${inputId}" name="inventoryMedIds" type="checkbox" value="${escapeHtml(med.id)}" checked>
            <label for="${inputId}">${escapeHtml(med.name)} ${escapeHtml(formatLabelMedStrength(med))} - ${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))}</label>
        </div>`;
    }).join('');

    const result = await showActionModal('Print Inventory Labels', `
        <div style="font-size:11px; margin-bottom:6px;">Deselect any inventory items that should not be printed.</div>
        <div class="field-row" style="margin-bottom:6px;">
            <button type="button" onclick="toggleAllInventoryLabelChoices(true)">Select All</button>
            <button type="button" onclick="toggleAllInventoryLabelChoices(false)">Deselect All</button>
        </div>
        <div class="sunken-panel label-selection-list">${choices}</div>
    `, 'Preview Labels');
    if (!result) return;

    const selectedIds = new Set(result.inventoryMedIds || []);
    const selectedMeds = inventory.filter(med => selectedIds.has(med.id));
    if (selectedMeds.length === 0) {
        await appAlert('Select at least one inventory item to print.');
        return;
    }

    let codesAdded = false;
    selectedMeds.forEach(med => {
        if (med.barcodeCode) return;
        med.barcodeCode = createMedicationCode();
        med.barcodeCodes = medicationCodes(med);
        codesAdded = true;
    });
    if (codesAdded) await window.api.save(db);

    previewLabelHtml(selectedMeds.map(inventoryLabelHtml).join(''));
};





window.toggleLabelOrderSetGroup = function(groupKey, checked) {
    const body = document.getElementById('action-modal-body');
    if (!body) return;
    body.querySelectorAll(`input[data-label-group="${groupKey}"]`).forEach(input => {
        input.checked = checked;
    });
};

window.syncLabelOrderSetGroup = function(groupKey) {
    const body = document.getElementById('action-modal-body');
    if (!body) return;
    const parent = body.querySelector(`#label-order-set-${groupKey}`);
    const children = Array.from(body.querySelectorAll(`input[data-label-group="${groupKey}"]`));
    if (!parent || children.length === 0) return;
    parent.checked = children.every(input => input.checked);
    parent.indeterminate = children.some(input => input.checked) && !parent.checked;
};

function labelScheduleChoiceHtml(schedule, inputId, groupKey = '') {
    const med = db.inventory.find(item => item.id === schedule.medId);
    if (!med) return '';
    const groupAttributes = groupKey
        ? ` data-label-group="${groupKey}" onchange="syncLabelOrderSetGroup('${groupKey}')"`
        : '';
    return `<div class="label-selection-item">
        <input id="${inputId}" name="scheduleIds" type="checkbox" value="${escapeHtml(schedule.id)}" checked${groupAttributes}>
        <label for="${inputId}">${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))} - ${escapeHtml(formatFrequency(schedule))}</label>
    </div>`;
}

async function chooseDateRangeLabelSchedules(memberId, startDate, endDate) {
    const schedules = db.schedules
        .filter(schedule => schedule.memberId === memberId && !isScheduleArchived(schedule) && getScheduleInstancesInRange(schedule, startDate, endDate).length > 0)
        .sort((a, b) => {
            const first = db.inventory.find(item => item.id === a.medId)?.name || '';
            const second = db.inventory.find(item => item.id === b.medId)?.name || '';
            return first.localeCompare(second, undefined, { sensitivity: 'base' });
        });
    if (schedules.length === 0) {
        await appAlert('No scheduled medications were found in this date range.');
        return null;
    }

    const grouped = new Map();
    const standalone = [];
    schedules.forEach(schedule => {
        if (!schedule.orderSetId) {
            standalone.push(schedule);
            return;
        }
        if (!grouped.has(schedule.orderSetId)) grouped.set(schedule.orderSetId, []);
        grouped.get(schedule.orderSetId).push(schedule);
    });

    const orderSetGroups = Array.from(grouped.entries()).map(([orderSetId, setSchedules], groupIndex) => {
        const set = db.orderSets.find(item => item.id === orderSetId);
        const groupKey = String(groupIndex);
        const children = setSchedules
            .map((schedule, itemIndex) => labelScheduleChoiceHtml(schedule, `label-set-${groupIndex}-med-${itemIndex}`, groupKey))
            .join('');
        return `<div class="label-selection-group">
            <div class="label-selection-heading">
                <input id="label-order-set-${groupKey}" type="checkbox" checked onchange="toggleLabelOrderSetGroup('${groupKey}', this.checked)">
                <label for="label-order-set-${groupKey}"><strong>Regimen: ${escapeHtml(set?.name || setSchedules[0]?.orderSetName || 'Unnamed')}</strong></label>
            </div>
            <div class="label-selection-children">${children}</div>
        </div>`;
    }).join('');
    const standaloneRows = standalone
        .map((schedule, index) => labelScheduleChoiceHtml(schedule, `label-standalone-${index}`))
        .join('');
    const result = await showActionModal('Choose Medications for Date-Range Labels', `
        <div style="font-size:11px; margin-bottom:6px;">Uncheck any medication or complete regimen that should be excluded from the daily labels.</div>
        <div class="sunken-panel label-selection-list">
            ${orderSetGroups}
            ${standaloneRows ? `<div class="label-selection-group"><strong>Individual Medications</strong>${standaloneRows}</div>` : ''}
        </div>
    `, 'Preview Labels');
    if (!result) return null;
    const selectedIds = result.scheduleIds || [];
    if (selectedIds.length === 0) {
        await appAlert('Select at least one medication to include on the labels.');
        return null;
    }
    return new Set(selectedIds);
}

window.printDateRangeLabels = async function(memberId, startDate, endDate) {
    const mem = db.family.find(f => f.id === memberId);
    if (!mem) return;

    const start = parseLocal(startDate);
    const end = parseLocal(endDate);
    if (!start || !end || end < start) return alert("Enter a valid date range.");
    const includedScheduleIds = await chooseDateRangeLabelSchedules(memberId, startDate, endDate);
    if (!includedScheduleIds) return;
    const packageChoice = await showActionModal('Prepack Label Group', `
        <div style="font-size:11px; margin-bottom:6px;">Choose which medication times should be included on this label run.</div>
        ${prepackShiftChoiceHtml('all')}
        <div class="form-help">Daytime includes scheduled times through 4:00 PM. Evening includes times after 5:00 PM.</div>
    `, 'Continue');
    if (!packageChoice) return;
    const prepackShift = packageChoice.prepackShift || 'all';
    const excludedScheduleIds = db.schedules
        .filter(schedule =>
            schedule.memberId === memberId &&
            getScheduleInstancesInRange(schedule, startDate, endDate).length > 0 &&
            !includedScheduleIds.has(schedule.id)
        )
        .map(schedule => schedule.id);

    let labelCount = 0;
    let labelsHtml = '';
    const prepackRows = [];
    const cursor = new Date(start);

    while (cursor <= end) {
        const yyyymmdd = localDateKey(cursor);

        const doseRows = collectMemberScheduleDoseRows(memberId, yyyymmdd, yyyymmdd)
            .filter(row => includedScheduleIds.has(row.schedule.id))
            .filter(row => !prepackShift || prepackShift === 'all' || prepackShiftForTime(row.instance.time) === prepackShift);
        prepackRows.push(...doseRows);

        labelCount++;
        const labelClass = getLabelClass(
            doseRows.map(row => `${row.instance.time} ${formatMultiMedLabelName(row.schedule, row.med)} ${formatQtyForSchedule(row.schedule, row.med)}`),
            doseRows.length + 1
        );
        const medRowsHtml = doseRows.length > 0
            ? doseRows.map(row => {
                return `<div class="label-med-row">
                <b>${escapeHtml(row.instance.time)}</b>: ${escapeHtml(formatMultiMedLabelName(row.schedule, row.med))} (${escapeHtml(formatQtyForSchedule(row.schedule, row.med))})</div>`;
            }).join('')
            : '<div class="label-med-row">No included medications scheduled</div>';

        labelsHtml += `
            <div class="${labelClass}">
                <div class="label-date label-date-with-icon">${cursor.toLocaleDateString()} - ${mem.firstName}${labelShiftIconHtml(prepackShift)}</div>
                ${medRowsHtml}
            </div>`;
        cursor.setDate(cursor.getDate() + 1);
    }

    if (labelCount > 0) {
        previewLabelHtml(
            labelsHtml,
            buildPrepackDefinition(
                memberId,
                `Daily labels: ${localDateKey(start)} - ${localDateKey(end)}`,
                prepackRows,
                {
                    kind: 'member-range',
                    memberId,
                    startDate: localDateKey(start),
                    endDate: localDateKey(end),
                    excludedScheduleIds,
                    prepackShift
                }
            )
        );
    } else {
        alert("No scheduled medications found for that date range.");
    }
};

window.printWeeklyLabels = function(memberId, daysOverride = 7) {
    const start = new Date();
    const end = new Date();
    end.setDate(start.getDate() + Math.max(parseInt(daysOverride, 10) || 7, 1) - 1);
    window.printDateRangeLabels(memberId, localDateKey(start), localDateKey(end));
};
