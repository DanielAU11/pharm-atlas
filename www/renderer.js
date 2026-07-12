const emptyDb = { family: [], inventory: [], schedules: [], history: [], recipes: [], vitals: [], orderSets: [], prescribers: [], reminderLog: [], prepackQueues: [] };
let db = { ...emptyDb };
let currentEditingMedId = null;
let currentEditingMemberId = null;
const notifiedDoseKeys = new Set();
const componentUnitOptions = ['mg', 'mL', 'mg/mL', 'mg/g', 'mEq', 'IU', 'mcg', 'g', 'g/g', '%', 'units', 'U/mL', 'CFU'];
const componentPerUnitOptions = ['', 'mL', 'tablet', 'capsule', 'packet', 'spray', 'drop', 'inhalation', 'patch', 'suppository'];
const formulationDoseUnits = {
    Tablets: 'tablet',
    Capsules: 'capsule',
    mL: 'mL',
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
let prepackScanTimer = null;
let pendingScheduleOrders = [];
let pendingNewMedImage = null;
let pendingModalMedImage = null;
let orderSetRowCounter = 0;

window.addEventListener('DOMContentLoaded', async () => {
    const loadedData = await window.api.load();
    db = { ...emptyDb, ...loadedData };
    const medicationCodesAdded = ensureMedicationCodes();
    const completionStatesAdded = updateScheduleCompletionStates();
    renderAll();
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

function createMedicationCode() {
    let code = '';
    do {
        code = `PA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    } while (db.inventory.some(med => normalizeMedicationCode(med.barcodeCode) === code));
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
        used.add(code);
    });
    return changed;
}

window.generateMedicationCode = function(inputId) {
    const input = document.getElementById(inputId);
    if (input) input.value = createMedicationCode();
};

function medicationCodeIsAvailable(code, excludedMedId = '') {
    const normalized = normalizeMedicationCode(code);
    return normalized && !db.inventory.some(med =>
        med.id !== excludedMedId && normalizeMedicationCode(med.barcodeCode) === normalized
    );
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

window.renderFrequencyControls = function(prefix, existingTimes = null) {
    const ids = getFieldIds(prefix);
    const freq = document.getElementById(ids.freq).value;
    const container = document.getElementById(ids.timeFields);
    if (!container) return;
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
        ? `/${formatAmount(perAmount)}${component.perUnit}`
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
        ? `/${formatAmount(sharedDenominator.amount)}${sharedDenominator.unit}`
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

function formatMedStrength(med, includeNames = false, includeSolidDenominator = true) {
    if (!med) return '';
    if (med.isCombination && med.components && med.components.length > 0) {
        return formatCombinationStrength(med, includeNames, includeSolidDenominator);
    }
    if (Number.isFinite(parseAmount(med.strengthAmount, NaN)) && med.activeUnit) {
        if (med.perUnit && Number.isFinite(parseAmount(med.perAmount, NaN))) {
            const isLiquidDenominator = ['ml', 'l'].includes(String(med.perUnit).toLowerCase());
            const denominator = includeSolidDenominator || isLiquidDenominator
                ? `/${formatAmount(parseAmount(med.perAmount))}${med.perUnit}`
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

    const doseUnit = med.units.includes('/') ? med.units.split('/')[0] : med.units;
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
    return db.history.some(entry => entry.scheduleInstanceKey === key);
}

function getScheduleInstancesForDate(schedule, dateStr) {
    if (!schedule || !isScheduleDueOnDate(schedule, dateStr)) return [];
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
        const textElements = page.querySelectorAll('.label-date, .label-title, .label-small, .label-med-row');
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
    if (prepackDefinition) await commitPrepackPrint(prepackDefinition);
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
        <div class="window" style="width:420px;">
            <div class="title-bar">
                <div class="title-bar-text" id="action-modal-title">Action</div>
                <div class="title-bar-controls"><button aria-label="Close" id="action-modal-x"></button></div>
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
    const body = modal.querySelector('#action-modal-body');
    const ok = modal.querySelector('#action-modal-ok');
    const cancel = modal.querySelector('#action-modal-cancel');
    const close = modal.querySelector('#action-modal-x');

    modal.querySelector('#action-modal-title').innerText = title;
    body.innerHTML = bodyHtml;
    ok.innerText = confirmText;
    modal.style.display = 'flex';

    return new Promise(resolve => {
        const cleanup = value => {
            ok.onclick = null;
            cancel.onclick = null;
            close.onclick = null;
            modal.style.display = 'none';
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

function isTopicalMedication(med) {
    const formulation = String(med?.formulation || '').toLowerCase();
    return ['cream', 'ointment', 'gel', 'topical packet', 'topical solution'].some(type => formulation.includes(type));
}

function usesContainerTracking(med) {
    return med?.inventoryBehavior === 'container-finish' || isTopicalMedication(med);
}

function finishedContainerButtonText(med) {
    const unit = String(inventoryUnitFor(med) || '').toLowerCase();
    return unit.includes('bottle') ? 'Finished Bottle' : 'Finished Container';
}

function inventoryUnitFor(med) {
    return med?.inventoryUnit || (usesContainerTracking(med) ? 'container' : (med?.administrationUnit || med?.formulation || 'unit(s)'));
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
    return result;
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

function memberMonitoringProfiles(member) {
    return Array.isArray(member?.monitoringProfiles) ? member.monitoringProfiles.filter(Boolean) : [];
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
    const prescriberList = document.getElementById('m-prescriber-list');
    const diagnosisList = document.getElementById('m-diagnosis-list');

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
    const choices = scheduleLinkChoices(panel.dataset.memberId || '', panel.dataset.excludeId || '');
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
        'isOneTime'
    ];
    timingFields.forEach(field => {
        const value = source[field];
        target[field] = Array.isArray(value) ? [...value] : value;
    });
    target.status = '';
    target.completedAt = '';
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
    const tabs = ['dashboard', 'schedules', 'prepackage', 'order-sets', 'vitals', 'inventory', 'drug-info', 'family'];
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
    await window.api.save(db);
    renderAll();
    const memberModal = document.getElementById('member-modal');
    if (currentEditingMemberId && memberModal?.style.display === 'flex') {
        renderMemberAdministrationLog(currentEditingMemberId);
        renderMemberVitalProfile(currentEditingMemberId);
        renderMemberMonitoringProfiles(currentEditingMemberId);
        renderMemberPrnMedicationOrders(currentEditingMemberId);
        renderMemberMedicationTimelines();
        renderMemberCalendar(currentEditingMemberId);
    }
}

// --- FAMILY ---
window.removeMember = async function(id) {
    if (await appConfirm("Are you sure you want to remove this person?", "Remove Member")) {
        db.family = db.family.filter(m => m.id !== id);
        db.schedules = db.schedules.filter(s => s.memberId !== id);
        db.orderSets = db.orderSets.filter(set => set.memberId !== id);
        db.vitals = db.vitals.filter(reading => reading.memberId !== id);
        await sync();
    }
};

function renderMemberPrnMedicationOrders(memberId) {
    const container = document.getElementById('member-prn-meds-list');
    if (!container) return;
    const schedules = db.schedules.filter(schedule => schedule.memberId === memberId && schedule.freq === 'PRN' && !isScheduleArchived(schedule));
    if (schedules.length === 0) {
        container.innerHTML = '<div style="font-size:11px; padding:5px;">No PRN medication orders.</div>';
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

function completedScheduleSummaryHtml(schedule) {
    const med = db.inventory.find(item => item.id === schedule.medId);
    const statusText = schedule.status === 'discontinued' ? 'Discontinued' : 'Completed';
    return `<div class="completed-med-row">
        <div>
            <strong>${escapeHtml(med?.name || 'Unknown medication')} ${escapeHtml(med ? formatMedStrength(med) : '')}</strong><br>
            <small>${escapeHtml(statusText)} | ${escapeHtml(schedule.startDate || '')} - ${escapeHtml(schedule.endDate || 'Ongoing')} | Dose: ${med ? escapeHtml(formatPrescribedDose(med, schedule.doseQty)) : escapeHtml(schedule.doseQty || '')} | ${escapeHtml(formatFrequency(schedule))} ${escapeHtml(getScheduleTimes(schedule).join(', ') || 'PRN')}</small>
            <div class="member-med-timeline" data-schedule-id="${escapeHtml(schedule.id)}"></div>
        </div>
        <div class="completed-med-actions">
            <button type="button" onclick="event.stopPropagation(); openOrderModifier('${escapeHtml(schedule.id)}')">Modify / Extend</button>
            <button type="button" onclick="event.stopPropagation(); removeCompletedSchedule('${escapeHtml(schedule.id)}')">Remove</button>
            ${med ? `<button type="button" onclick="event.stopPropagation(); printSingleLabel('${escapeHtml(schedule.id)}')">Label</button>` : ''}
        </div>
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

    const setHtml = completedSets.map(set => {
        const setSchedules = db.schedules.filter(schedule => schedule.orderSetId === set.id);
        return `<div class="completed-med-row completed-order-set">
            <div>
                <strong>${escapeHtml(set.name)}</strong><br>
                <small>Completed | ${escapeHtml(set.startDate || '')} - ${escapeHtml(set.endDate || 'Ongoing')}</small>
                <div style="margin-top:4px;">${setSchedules.map(completedScheduleSummaryHtml).join('')}</div>
            </div>
            <div class="completed-med-actions">
                <button type="button" onclick="event.stopPropagation(); editOrderSet('${escapeHtml(set.id)}')">Edit / Extend Regimen</button>
                <button type="button" onclick="event.stopPropagation(); removeCompletedOrderSet('${escapeHtml(set.id)}')">Remove</button>
                <button type="button" onclick="event.stopPropagation(); printOrderSetLabel('${escapeHtml(set.id)}')">Regimen Label</button>
            </div>
        </div>`;
    }).join('');

    const singlesHtml = completedSingles.map(completedScheduleSummaryHtml).join('');
    container.innerHTML = setHtml || singlesHtml
        ? `${setHtml}${singlesHtml}`
        : '<div class="empty-state">No completed medication orders.</div>';
}

window.removeCompletedSchedule = async function(scheduleId) {
    const schedule = db.schedules.find(item => item.id === scheduleId);
    if (!schedule || !isScheduleArchived(schedule)) return;
    if (!await appConfirm('Remove this completed medication order from the profile list? Administration history will remain.', 'Remove Completed Order')) return;
    db.schedules = db.schedules.filter(item => item.id !== scheduleId);
    await sync();
    if (currentEditingMemberId) openMemberModal(currentEditingMemberId);
};

window.removeCompletedOrderSet = async function(orderSetId) {
    const set = db.orderSets.find(item => item.id === orderSetId);
    if (!set || set.status !== 'completed') return;
    if (!await appConfirm('Remove this completed regimen from the profile list? Administration history will remain.', 'Remove Completed Regimen')) return;
    db.orderSets = db.orderSets.filter(item => item.id !== orderSetId);
    db.schedules = db.schedules.filter(item => item.orderSetId !== orderSetId);
    await sync();
    if (currentEditingMemberId) openMemberModal(currentEditingMemberId);
};

window.openMemberModal = function(id = null) {
    currentEditingMemberId = id;
    const modal = document.getElementById('member-modal');
    const title = document.getElementById('member-modal-title');


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
                title.innerText = `${m.firstName} ${m.lastName}`;
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
                activeMedsContainer.appendChild(printControls);
                const timelineControls = document.createElement('div');
                timelineControls.className = 'timeline-controls';
                timelineControls.innerHTML = `
                    <button type="button" onclick="shiftMemberTimeline(-7)">Previous 7 Days</button>
                    <strong id="member-timeline-range"></strong>
                    <button type="button" onclick="shiftMemberTimeline(7)">Next 7 Days</button>`;
                activeMedsContainer.appendChild(timelineControls);
            }
            const memberOrderSets = db.orderSets.filter(set =>
                set.memberId === id && set.status !== 'completed' && db.schedules.some(schedule => schedule.orderSetId === set.id && !isScheduleArchived(schedule))
            );
            memberOrderSets.forEach(set => {
                const div = document.createElement('div');
                div.className = 'sunken-panel';
                div.style.cssText = "padding:5px; margin-bottom:5px; background:white; border:1px inset gray;";
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
                    <strong>${set.name}</strong><br>
                    <small>${set.startDate} - ${set.endDate}</small>
                    <div style="margin-top:4px;">${itemRows}</div>
                    <div style="text-align:right; margin-top:5px;">
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
                empty.textContent = 'No active scheduled medication orders.';
                activeMedsContainer.appendChild(empty);
            }
            renderCompletedMedicationOrders(m.id);
            renderMemberPrnMedicationOrders(m.id);
            renderMemberVitalProfile(m.id);
            renderMemberAdministrationLog(m.id);
            renderMemberMedicationTimelines();
            renderMemberCalendar(m.id);
        }
    } else {
        if (title) title.innerText = "Add New Member";
        const profileVitals = document.getElementById('member-vitals-trends');
        if (profileVitals) profileVitals.innerHTML = '<div style="font-size:11px;">Save member before logging vitals.</div>';
        const adminLog = document.getElementById('member-admin-log');
        if (adminLog) adminLog.innerHTML = '<div style="font-size:11px; padding:5px;">Save member before recording administrations.</div>';
        const memberCalendar = document.getElementById('member-calendar-grid');
        if (memberCalendar) memberCalendar.innerHTML = '<div style="font-size:11px; padding:5px;">Save member before viewing their calendar.</div>';
        if (prnMedsContainer) prnMedsContainer.innerHTML = '<div style="font-size:11px; padding:5px;">Save member before adding PRN medication orders.</div>';
    }
    
    if (modal) modal.style.display = 'flex';
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
        const choices = scheduleLinkChoices(sched.memberId, sched.id);
        const selectedLinks = new Set(uniqueValues([
            ...(sched.linkTargetIds || []),
            sched.linkTargetId || '',
            ...scheduleLinkRules(sched).map(rule => rule.targetId)
        ]));
        const selected = choices
            .filter(choice => selectedLinks.has(choice.id) || (sched.linkGroup && choice.group === sched.linkGroup && selectedLinks.size === 0))
            .map(choice => choice.id);
        modLinkTarget.dataset.memberId = sched.memberId;
        modLinkTarget.dataset.excludeId = sched.id;
        renderLinkChoicePanel(modLinkTarget, choices, selected, 'openModifierLinkPicker()');
    }
    document.getElementById('mod-link-mode').value = sched.linkMode || '';
    renderFrequencyControls('mod', sched.freq === 'QXH' ? [sched.startTime || getScheduleTimes(sched)[0]] : getScheduleTimes(sched));
    setWeekdaySelections('mod-weekday-container', sched.weekdays || []);
    document.getElementById('mod-instr').value = sched.instructions || "";
    
    document.getElementById('order-modifier-modal').style.display = 'flex';
};

window.saveOrderModification = async function() {
    const id = document.getElementById('mod-sched-id').value;
    const sched = db.schedules.find(s => s.id === id);
    if (sched) {
        const frequencyDetails = collectFrequencyDetails('mod');
        if (!frequencyDetails) return;

        sched.startDate = document.getElementById('mod-start').value;
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
        sched.instructions = document.getElementById('mod-instr').value;
        const linkTargetIds = selectedOptionValues(document.getElementById('mod-link-target'));
        const linkMode = document.getElementById('mod-link-mode')?.value || '';
        const targetChoice = scheduleLinkChoices(sched.memberId, sched.id).find(choice => choice.id === linkTargetIds[0]);
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
        linkedSchedulesFor(sched).forEach(linkedSchedule => {
            if (linkedSchedule.id !== sched.id && !isScheduleArchived(linkedSchedule)) {
                applyLinkedScheduleTiming(sched, linkedSchedule);
            }
        });
        await sync();
        document.getElementById('order-modifier-modal').style.display = 'none';
        openMemberModal(sched.memberId); // Refresh member profile
    }
};

window.saveMember = async function() {
    const vitalGoals = collectMemberGoals();
    if (!vitalGoals) return;
    const typedDiagnoses = String(document.getElementById('m-diag').value || '')
        .split(/[\n,;]+/)
        .map(item => item.trim())
        .filter(Boolean);
    const diagnosesList = Array.from(new Set([...getHiddenJson('m-diagnoses-data'), ...typedDiagnoses]));
    const prescriberIds = getHiddenJson('m-prescriber-ids-data');

    const data = {
        firstName: document.getElementById('m-first').value,
        middleName: document.getElementById('m-middle').value,
        lastName: document.getElementById('m-last').value,
        sex: document.getElementById('m-sex').value,
        age: document.getElementById('m-age').value,
        dob: document.getElementById('m-dob').value,
        providers: document.getElementById('m-providers').value,
        diagnoses: diagnosesList.join(', '),
        diagnosesList,
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
        //prescribedMeds: document.getElementById('m-meds').value,
        name: `${document.getElementById('m-first').value} ${document.getElementById('m-last').value}`
    };
    if (!data.firstName || !data.lastName) return alert("First and Last Name required.");
    if (currentEditingMemberId) {
        const index = db.family.findIndex(m => m.id === currentEditingMemberId);
        db.family[index] = { ...db.family[index], ...data };
    } else {
        db.family.push({ id: Date.now().toString(), ...data });
    }
    await sync();
    closeMemberModal();
};

window.closeMemberModal = () => document.getElementById('member-modal').style.display = 'none';

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
    const topical = ['cream', 'ointment', 'gel', 'topical packet', 'topical solution'].some(type => formulation.toLowerCase().includes(type));
    const inventoryBehavior = topical
        ? 'container-finish'
        : (document.getElementById('med-inventory-behavior')?.value || 'per-dose');
    const inventoryUnit = document.getElementById('med-inventory-unit')?.value.trim()
        || (inventoryBehavior === 'container-finish' ? 'bottle' : (formulationDoseUnits[formulation] || formulation));
    const administrationUnit = document.getElementById('med-administration-unit')?.value.trim()
        || (formulationDoseUnits[formulation] || formulation);
    const imageInput = document.getElementById('med-image-input');
    const expiry = document.getElementById('med-expiry').value;
    const barcodeCode = normalizeMedicationCode(document.getElementById('med-barcode-code')?.value) || createMedicationCode();
    if (!name || isNaN(qty)) return alert("Name and Qty required.");
    if (barcodeCode.length > 100 || !medicationCodeIsAvailable(barcodeCode)) {
        return alert("Enter a unique QR code containing no more than 100 characters.");
    }
    
    // --- NEW COMBINATION LOGIC ---
    const isCombo = document.getElementById('is-combination').checked;
    let components = [];
    let finalStrength = strengthAmount;
    let finalUnits = activeUnit;
    let displayStrength = '';

    if (isCombo) {
        const rows = document.querySelectorAll('#ingredient-list .combo-row');
        let invalidComponentDenominator = false;
        rows.forEach(row => {
            const componentName = row.querySelector('.ing-name').value.trim();
            const componentStrengthAmount = parseAmount(row.querySelector('.ing-strength').value, NaN);
            const componentUnit = row.querySelector('.ing-unit').value;
            const componentPerAmount = parseAmount(row.querySelector('.ing-per-amount')?.value, NaN);
            const componentPerUnit = row.querySelector('.ing-per-unit')?.value || '';
            if (componentPerUnit && (!Number.isFinite(componentPerAmount) || componentPerAmount <= 0)) {
                invalidComponentDenominator = true;
            }
            if (componentName && Number.isFinite(componentStrengthAmount)) {
                const hasDenominator = componentPerUnit && Number.isFinite(componentPerAmount) && componentPerAmount > 0;
                components.push({
                    name: componentName,
                    strength: hasDenominator ? componentStrengthAmount / componentPerAmount : componentStrengthAmount,
                    strengthAmount: componentStrengthAmount,
                    unit: componentUnit,
                    perAmount: hasDenominator ? componentPerAmount : null,
                    perUnit: hasDenominator ? componentPerUnit : ''
                });
            }
        });
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

    db.inventory.push({ 
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
        barcodeCode,
        imagePath: imagePath 
    });
    
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
    const medPrescriber = document.getElementById('med-prescriber');
    if (medPrescriber) medPrescriber.value = '';
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
    if (!usesContainerTracking(med) && parseAmount(med.stock) < amountTaken) {
        await appAlert("Insufficient stock.");
        return;
    }

    if (!usesContainerTracking(med)) med.stock = parseAmount(med.stock) - amountTaken;
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: formatActualTimestamp(result),
        memberId: member.id,
        memberName: memberDisplayName(member),
        medId: med.id,
        medName: med.name,
        details: `Manual/supplemental ${isTopicalMedication(med) ? 'application' : 'dose'} - ${formatAmount(amountTaken)} ${med.administrationUnit || formulation}${usesContainerTracking(med) ? `; ${inventoryUnitFor(med)} inventory unchanged until a container is marked finished` : ''}${result.adminNote ? ` | Note: ${result.adminNote}` : ''}`
    });
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
        await sync();
        await appAlert(`${med.name} restocked. New quantity on hand: ${formatAmount(parseAmount(med.stock))}`);
    }
};
window.refillMed = window.restockMed;

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
    row.className = 'field-row modal-combo-row';
    row.style.marginBottom = '5px';
    const selectedUnit = component?.unit || 'mg';
    const unitOptions = componentUnitOptions
        .map(unit => `<option value="${unit}" ${unit === selectedUnit ? 'selected' : ''}>${unit}</option>`)
        .join('');
    const selectedPerUnit = component?.perUnit || (document.getElementById('modal-formulation')?.value === 'mL' ? 'mL' : '');
    const perUnitOptions = componentPerUnitOptions
        .map(unit => `<option value="${unit}" ${unit === selectedPerUnit ? 'selected' : ''}>${unit || 'unit'}</option>`)
        .join('');
    row.innerHTML = `
        <input class="modal-ing-name" type="text" placeholder="Ingredient" style="width:130px;" value="${escapeHtml(component?.name || '')}">
        <input class="modal-ing-strength" type="number" min="0" step="any" placeholder="Strength" style="width:75px;" value="${escapeHtml(component?.strengthAmount ?? component?.strength ?? '')}">
        <select class="modal-ing-unit" style="width:80px;">${unitOptions}</select>
        <span>per</span>
        <input class="modal-ing-per-amount" type="number" min="0.001" step="any" style="width:58px;" value="${escapeHtml(component?.perAmount ?? '1')}">
        <select class="modal-ing-per-unit" style="width:80px;">${perUnitOptions}</select>
        <button type="button" class="modal-ing-remove">Remove</button>`;
    row.querySelector('.modal-ing-remove').onclick = () => row.remove();
    container.appendChild(row);
};

window.updateMedProfileMode = function() {
    const formulationSelect = document.getElementById('modal-formulation');
    const formulation = formulationSelect?.value || '';
    const isCombo = document.getElementById('modal-is-combination')?.checked;
    const isTopical = ['cream', 'ointment', 'gel', 'topical packet', 'topical solution']
        .some(type => formulation.toLowerCase().includes(type));
    const behavior = document.getElementById('modal-inventory-behavior');
    const inventoryUnit = document.getElementById('modal-inventory-unit');
    const administrationUnit = document.getElementById('modal-administration-unit');
    const guidance = document.getElementById('modal-inventory-guidance');
    const formulationChanged = behavior?.dataset.formulation !== formulation;

    document.getElementById('modal-single-strength-fields').style.display = isCombo ? 'none' : 'flex';
    document.getElementById('modal-combination-fields').style.display = isCombo ? 'block' : 'none';
    if (isCombo && document.getElementById('modal-ingredient-list').children.length === 0) addModalIngredientRow();

    if (formulationChanged) {
        if (administrationUnit) administrationUnit.value = formulationDoseUnits[formulation] || formulation || 'unit';
        if (behavior) behavior.value = isTopical ? 'container-finish' : 'per-dose';
        if (inventoryUnit) {
            inventoryUnit.value = isTopical
                ? (formulation === 'Topical Packet' ? 'packet' : (formulation === 'Topical Solution' ? 'bottle' : 'tube'))
                : (formulationDoseUnits[formulation] || formulation || 'unit');
        }
        if (behavior) behavior.dataset.formulation = formulation;
        if (formulation === 'mL') {
            document.querySelectorAll('#modal-ingredient-list .modal-ing-per-unit').forEach(select => {
                if (!select.value) select.value = 'mL';
            });
        }
    }
    if (isTopical && behavior) behavior.value = 'container-finish';
    if (behavior) behavior.disabled = isTopical;
    const behaviorChanged = behavior?.dataset.behavior !== behavior?.value;
    if (!formulationChanged && behaviorChanged && inventoryUnit) {
        inventoryUnit.value = behavior.value === 'container-finish'
            ? 'bottle'
            : (formulationDoseUnits[formulation] || formulation || 'unit');
    }
    if (behavior) behavior.dataset.behavior = behavior.value;
    if (guidance) {
        guidance.innerText = behavior?.value === 'container-finish'
            ? 'Administrations are logged without reducing stock. Mark the container finished when it is empty.'
            : `Each administered ${administrationUnit?.value || 'dose unit'} reduces stock by the quantity given.`;
    }
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
    document.getElementById('modal-barcode-code').value = med.barcodeCode || createMedicationCode();
    const formulationSelect = document.getElementById('modal-formulation');
    addSelectOptionIfMissing(formulationSelect, med.formulation || 'Other');
    formulationSelect.value = med.formulation || 'Other';
    const behaviorSelect = document.getElementById('modal-inventory-behavior');
    behaviorSelect.dataset.formulation = med.formulation || 'Other';
    behaviorSelect.value = med.inventoryBehavior || (isTopicalMedication(med) ? 'container-finish' : 'per-dose');
    behaviorSelect.dataset.behavior = behaviorSelect.value;
    document.getElementById('modal-is-combination').checked = !!med.isCombination;
    document.getElementById('modal-strength').value = med.strengthAmount ?? med.strength ?? '';
    document.getElementById('modal-units').value = med.activeUnit || String(med.units || '').split('/')[0] || '';
    document.getElementById('modal-per-amount').value = med.perAmount ?? '';
    document.getElementById('modal-per-unit').value = med.perUnit || String(med.units || '').split('/')[1] || '';
    document.getElementById('modal-threshold').value = med.minThreshold ?? 0;
    document.getElementById('modal-inventory-unit').value = inventoryUnitFor(med);
    document.getElementById('modal-administration-unit').value = med.administrationUnit || formulationDoseUnits[med.formulation] || med.formulation || 'unit';
    const ingredientList = document.getElementById('modal-ingredient-list');
    ingredientList.innerHTML = '';
    (med.components || []).forEach(component => addModalIngredientRow(component));
    updateMedProfileMode();
    const prescriberSelect = document.getElementById('modal-prescriber');
    if (prescriberSelect) prescriberSelect.innerHTML = prescriberOptionsHtml(med.prescriberId || '', '', true);
    const imgContainer = document.getElementById('modal-image-container');
    imgContainer.innerHTML = med.imagePath ? `<img src="${imageSrc(med.imagePath)}" style="max-width:100%; max-height:100%;">` : "No Photo";
    document.getElementById('med-modal').style.display = 'flex';
};

window.saveMedProfile = async function() {
    const med = db.inventory.find(m => m.id === currentEditingMedId);
    if (med) {
        // 1. Update text fields
        const updatedName = document.getElementById('modal-med-name').value.trim();
        const barcodeCode = normalizeMedicationCode(document.getElementById('modal-barcode-code').value);
        if (!updatedName) {
            await appAlert('Medication name is required.');
            return;
        }
        if (barcodeCode.length > 100 || !medicationCodeIsAvailable(barcodeCode, med.id)) {
            await appAlert('Enter a unique QR code containing no more than 100 characters.');
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
            let invalidComponentDenominator = false;
            components = Array.from(document.querySelectorAll('#modal-ingredient-list .modal-combo-row')).map(row => {
                const strengthAmountValue = parseAmount(row.querySelector('.modal-ing-strength').value, NaN);
                const componentPerAmount = parseAmount(row.querySelector('.modal-ing-per-amount')?.value, NaN);
                const componentPerUnit = row.querySelector('.modal-ing-per-unit')?.value || '';
                if (componentPerUnit && (!Number.isFinite(componentPerAmount) || componentPerAmount <= 0)) {
                    invalidComponentDenominator = true;
                }
                const hasDenominator = componentPerUnit && Number.isFinite(componentPerAmount) && componentPerAmount > 0;
                return {
                    name: row.querySelector('.modal-ing-name').value.trim(),
                    strength: hasDenominator ? strengthAmountValue / componentPerAmount : strengthAmountValue,
                    strengthAmount: strengthAmountValue,
                    unit: row.querySelector('.modal-ing-unit').value,
                    perAmount: hasDenominator ? componentPerAmount : null,
                    perUnit: hasDenominator ? componentPerUnit : ''
                };
            }).filter(component => component.name && Number.isFinite(component.strength));
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
        med.barcodeCode = barcodeCode;
        med.formulation = formulation;
        med.isCombination = isCombination;
        med.components = components;
        med.strengthAmount = isCombination ? null : strengthAmount;
        med.activeUnit = isCombination ? null : activeUnit;
        med.perAmount = isCombination || !perUnit ? null : perAmount;
        med.perUnit = isCombination ? '' : perUnit;
        med.minThreshold = parseAmount(document.getElementById('modal-threshold').value, 0);
        med.inventoryBehavior = isTopicalMedication({ formulation })
            ? 'container-finish'
            : document.getElementById('modal-inventory-behavior').value;
        med.inventoryUnit = document.getElementById('modal-inventory-unit').value.trim()
            || (med.inventoryBehavior === 'container-finish' ? 'container' : formulationDoseUnits[formulation] || formulation);
        med.administrationUnit = document.getElementById('modal-administration-unit').value.trim()
            || formulationDoseUnits[formulation] || formulation;
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
        updateImageDropzone('modal-image-dropzone', null);
        
        closeMedModal();
    }
};


window.closeMedModal = () => document.getElementById('med-modal').style.display = 'none';

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
    return med ? `${med.name} ${formatMedStrength(med)}${dose ? ` - Qty ${dose}` : ''}${freq ? ` (${freq})` : ''}` : 'Select medication first';
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

function orderSetItemToSchedule(orderSet, item, index) {
    const med = db.inventory.find(inv => inv.id === item.medId);
    const itemStartDate = item.anchorDate || orderSet.startDate;
    const itemEndDate = item.freq === 'ONCE' ? itemStartDate : orderSet.endDate;
    return {
        id: `${orderSet.id}_${Date.now()}_${index}`,
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
        linkRules: item.linkRules || []
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

    db.schedules = db.schedules.filter(schedule => schedule.orderSetId !== orderSet.id);
    if (memberId) {
        db.schedules.push(...items.map((item, index) => orderSetItemToSchedule(orderSet, item, index)));
    }

    await sync();
    clearOrderSetBuilder();
};

window.editOrderSet = function(id) {
    const set = db.orderSets.find(orderSet => orderSet.id === id);
    if (!set) return;
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
        return {
            med,
            schedule,
            detail,
            instructions: schedule.instructions || '',
            size: med.name.length + formatLabelMedStrength(med).length + detail.length + String(schedule.instructions || '').length
        };
    }).filter(Boolean);
    if (entries.length === 0) {
        void appAlert(set.memberId
            ? 'This assigned regimen has no active medication orders to print.'
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
                <span class="order-set-label-med">${escapeHtml(entry.med.name)} ${escapeHtml(formatLabelMedStrength(entry.med))}</span><br>
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
        return `<option value="${escapeHtml(schedule.id)}">${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))} - ${escapeHtml(schedule.freq)}</option>`;
    }).join('');
    const result = await showActionModal(`Individual Labels: ${set.name}`, `
        <div class="field-row-stacked">
            <label>Medication:</label>
            <select name="scheduleId" style="width:100%;">${options}</select>
        </div>
    `, 'Choose Dates');
    if (result?.scheduleId) await window.printSingleLabel(result.scheduleId);
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
        return `<div class="med-item-row" style="border-bottom:1px solid #808080;">
            <div style="flex-grow:1;">
                <strong>${escapeHtml(set.name)}</strong> - <small>${statusText}</small><br>
                <small>${escapeHtml(itemSummary)}</small>
            </div>
            ${isTemplate ? `<button onclick="assignOrderSet('${escapeHtml(set.id)}')">Assign</button>` : ''}
            <button onclick="printOrderSetLabel('${escapeHtml(set.id)}')">Regimen Label</button>
            ${!isTemplate && activeSchedules.length ? `<button onclick="printOrderSetMedicationLabel('${escapeHtml(set.id)}')">Individual Labels</button>` : ''}
            ${!isTemplate && activeSchedules.length ? `<button onclick="administerOrderSet('${escapeHtml(set.id)}')">Administer</button>` : ''}
            ${!isTemplate ? containerActions : ''}
            <button onclick="editOrderSet('${escapeHtml(set.id)}')">Edit</button>
            <button onclick="deleteOrderSet('${escapeHtml(set.id)}')">Delete</button>
        </div>`;
    };

    const templates = db.orderSets.filter(set => !set.memberId);
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
        { value: 'evening', title: '☾ Evening', detail: 'After 5:00 PM' }
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
            barcodeCode: normalizeMedicationCode(row.med.barcodeCode),
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
            barcodeCode: normalizeMedicationCode(firstRow.med.barcodeCode),
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

async function createPrepackQueue(definition, options = {}) {
    if (!definition.days?.some(day => day.items.length > 0)) return null;
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
        day.status = !day.needsReprint && day.items.every(item => item.status === 'correct')
            ? 'completed'
            : 'pending';
    });
    const complete = queue.days.length > 0 && queue.days.every(day => day.status === 'completed');
    queue.status = complete ? 'completed' : 'pending';
    if (complete && !queue.completedAt) queue.completedAt = new Date().toISOString();
    if (!complete) queue.completedAt = '';
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
    const dayIndex = Math.max(0, Math.min(parseInt(queue.currentDayIndex, 10) || 0, queue.days.length - 1));
    queue.currentDayIndex = dayIndex;
    const day = queue.days[dayIndex];
    if (!day) {
        return `<div class="prepack-workspace-header">
            <div><strong>${escapeHtml(queue.memberName || queue.title)}</strong><br><small>${escapeHtml(queue.sourceLabel || '')}</small></div>
            <div>
                ${queue.selection?.singleMedication ? '' : `<button type="button" onclick="addProfileMedicationToPrepack('${escapeHtml(queue.id)}')">Add From Profile</button>
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
                <small>Qty: ${escapeHtml(item.quantity)} | Dose: ${escapeHtml(item.dose)}${escapeHtml(orderSetText)}</small>
                ${item.status === 'wrong' ? `<div class="prepack-scan-error">Wrong scan: ${escapeHtml(item.scannedCode || 'Unknown code')}</div>` : ''}
            </div>
            ${removeButton}
        </div>`;
    }).join('');
    const dayButtons = queue.days.map((entry, index) => {
        const classes = [
            'prepack-day-button',
            index === dayIndex ? 'active' : '',
            entry.status === 'completed' ? 'completed' : '',
            entry.needsReprint ? 'needs-reprint' : ''
        ].filter(Boolean).join(' ');
        const dayLabel = entry.date.includes(' - ') ? entry.date : entry.date.slice(5);
        return `<button type="button" class="${classes}" onclick="selectPrepackDay('${escapeHtml(queue.id)}',${index})">${escapeHtml(dayLabel)}${entry.status === 'completed' ? ' &#10003;' : ''}</button>`;
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
    const medicationActions = queue.selection?.singleMedication
        ? ''
        : `<button type="button" onclick="addProfileMedicationToPrepack('${escapeHtml(queue.id)}')">Add From Profile</button>
           <button type="button" onclick="addLastMinutePrepackItem('${escapeHtml(queue.id)}')">Add New Medication</button>`;
    return `
        <div class="prepack-workspace-header">
            <div><strong>${escapeHtml(queue.memberName || queue.title)}</strong><br><small>${escapeHtml(queue.sourceLabel || '')} | ${escapeHtml(scheduledText)}</small></div>
            <div>
                ${medicationActions}
                <button type="button" onclick="editPrepackLabelGroup('${escapeHtml(queue.id)}')">Label Group</button>
                <button type="button" onclick="editPrepackDateRange('${escapeHtml(queue.id)}')">Edit Date Range</button>
                <button type="button" onclick="printUpdatedPrepackLabels('${escapeHtml(queue.id)}')">${printButtonText}</button>
                <button type="button" onclick="deletePrepackQueue('${escapeHtml(queue.id)}')">Delete Queue</button>
            </div>
        </div>
        <div class="prepack-day-strip">${dayButtons}</div>
        ${day.needsReprint ? '<div class="prepack-reprint-warning">Labels for this day need to be reprinted.</div>' : ''}
        ${scanner}
        <div class="prepack-items">${itemRows || '<div class="empty-state">No medications queued for this day.</div>'}</div>`;
}

window.renderPrepackageQueues = function() {
    const activeList = document.getElementById('prepack-active-list');
    const completedList = document.getElementById('prepack-completed-list');
    const workspace = document.getElementById('prepack-workspace');
    if (!activeList || !completedList || !workspace) return;
    if (!Array.isArray(db.prepackQueues)) db.prepackQueues = [];
    db.prepackQueues.forEach(queue => reconcilePrepackQueue(queue));

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
            <small>${escapeHtml(queue.sourceLabel || '')}${queue.scheduledFor ? ` | ${escapeHtml(queue.scheduledFor.replace('T', ' '))}` : ''}${!queue.labelsPrinted ? ' | LABELS NOT PRINTED' : ''}${queue.days.some(day => day.needsReprint) ? ' | LABELS NEED REPRINT' : ''}</small>
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
        const expectedLength = normalizeMedicationCode(med?.barcodeCode || nextItem?.barcodeCode).length;
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
    const expectedCode = normalizeMedicationCode(med?.barcodeCode || item.barcodeCode);
    item.scannedCode = scannedCode;
    item.scannedAt = new Date().toISOString();
    item.status = scannedCode === expectedCode ? 'correct' : 'wrong';
    if (item.status === 'correct') item.verificationMethod = 'scan';
    input.value = '';
    updatePrepackQueueStatus(queue);
    if (day.status === 'completed' && queue.status !== 'completed') {
        const nextIndex = queue.days.findIndex((candidate, index) => index > queue.currentDayIndex && candidate.status !== 'completed');
        if (nextIndex >= 0) queue.currentDayIndex = nextIndex;
    }
    await sync();
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
    day.items.forEach(item => {
        item.status = 'correct';
        item.scannedCode = '';
        item.scannedAt = new Date().toISOString();
        item.verificationMethod = 'manual';
    });
    day.needsReprint = false;
    updatePrepackQueueStatus(queue);
    if (queue.status !== 'completed') {
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
            <label for="prepack-remove-order">Discontinue this new medication order and remove it from the member profile.</label>
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
        await appAlert('Every eligible medication order from this member profile is already included in the prepack.');
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
        await appAlert('Select at least one medication order.');
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
        day.items.map(item => `${item.time} ${item.medName} ${item.strength} ${item.quantity}`),
        day.items.length + 1
    );
    const rows = day.items.length
        ? day.items.map(item => `<div class="label-med-row"><b>${escapeHtml(item.time)}</b>: ${escapeHtml(item.medName)} ${escapeHtml(item.strength || '')} (${escapeHtml(item.quantity)})</div>`).join('')
        : '<div class="label-med-row">No medications in this prepack</div>';
    return `<div class="${labelClass}">
        <div class="label-date label-date-with-icon">${escapeHtml(day.date)} - ${escapeHtml(queue.memberName || '')}${labelShiftIconHtml(queue.selection?.prepackShift)}</div>
        ${rows}
    </div>`;
}

window.printUpdatedPrepackLabels = async function(queueId) {
    const queue = db.prepackQueues.find(item => item.id === queueId);
    if (!queue) return;
    reconcilePrepackQueue(queue);
    const days = queue.labelsPrinted
        ? queue.days.filter(day => day.needsReprint)
        : queue.days;
    if (days.length === 0) {
        await appAlert('No prepack days currently require updated labels.');
        return;
    }
    let labelHtml = days.map(day => prepackDayLabelHtml(queue, day)).join('');
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
                instances
            );
        } else if (schedule && med && member && instances.length > 0) {
            const byDate = instances.reduce((acc, instance) => {
                if (!acc[instance.date]) acc[instance.date] = [];
                acc[instance.date].push(instance.time);
                return acc;
            }, {});
            labelHtml = Object.entries(byDate).map(([date, times]) =>
                medicationLabelHtml(schedule, med, member, date, times.slice().sort((a, b) => timeToMinutes(a) - timeToMinutes(b)))
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

function timelineDoseState(schedule, instance) {
    const entry = db.history.find(item => item.scheduleInstanceKey === instance.key);
    if (entry) {
        return ['skipped', 'missed'].includes(entry.doseStatus)
            ? { className: 'timeline-not-given', title: `${doseStatusLabel(entry.doseStatus)}. Click to edit.`, entryId: entry.id }
            : { className: 'timeline-given', title: `${doseStatusLabel(entry.doseStatus)}. Click to edit.`, entryId: entry.id };
    }

    const now = new Date();
    const due = new Date(`${instance.date}T${instance.time === 'PRN' ? '00:00' : instance.time}`);
    if (due < now) return { className: 'timeline-overdue', title: 'Not documented at scheduled time. Click to document status.' };
    if (instance.date === localDateKey(now)) return { className: 'timeline-upcoming', title: 'Upcoming dose. Click to document status.' };
    return { className: 'timeline-future', title: 'Future scheduled dose. Click to document status.' };
}

window.documentScheduleInstance = async function(scheduleId, scheduledDate, scheduledTime) {
    const schedule = db.schedules.find(item => item.id === scheduleId);
    const med = schedule && db.inventory.find(item => item.id === schedule.medId);
    if (!schedule || !med) return;
    const key = scheduleInstanceKey(schedule.id, scheduledDate, scheduledTime);
    const existing = db.history.find(item => item.scheduleInstanceKey === key);
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
                return `<button type="button" class="timeline-dose ${state.className}" title="${escapeHtml(state.title)}"${click}>${escapeHtml(instance.time)}</button>`;
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
    return `<li>${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))} - ${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))} on hand, exp ${escapeHtml(med.expiry || 'N/A')}</li>`;
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
            ${section('Low meds', groups.low, 'inventory-status-low', '!')}
            ${section('Expired meds', groups.expired, 'inventory-status-expired', 'X')}
            ${section('Expiring in 15 days', groups.expiringSoon, 'inventory-status-soon', '15')}
        </div>`;
}

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
    
    // Find all inventory items that have this exact name
    const matches = db.inventory.filter(m => m.name === name);
    
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
        input.style.backgroundColor = ""; 
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
    
    const startDate = document.getElementById('sched-start').value;
    const rawEndDate = document.getElementById('sched-end').value || "Ongoing";
    
    const instructions = document.getElementById('sched-instructions').value;

    if (!member) return alert("Select a family member first.");
    if (!med || !startDate) return alert("Select medication name, strength, and start date!");

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
            </span>
            <span class="pending-order-meta">${escapeHtml(member ? memberDisplayName(member) : 'No member')} | ${escapeHtml(dates)}</span>
            ${linkedDetailsHtml(schedule, [...db.schedules, ...pendingScheduleOrders])}
            ${schedule.instructions ? `<span class="pending-order-note">${escapeHtml(schedule.instructions)}</span>` : ''}`
    };
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
    });
    pendingScheduleOrders = pendingScheduleOrders.filter(order => !selectedIds.includes(order.id));
    await sync();
    renderPendingScheduleOrders();
    await appAlert(`${selected.length} medication${selected.length === 1 ? '' : 's'} added to the member profile.`, 'Medications Scheduled');
};

window.addSchedule = async function() {
    const schedule = buildScheduleFromEntry();
    if (!schedule) return;
    pendingScheduleOrders.push(schedule);
    clearScheduleEntryFields();
    renderPendingScheduleOrders();
};


async function getAdministrationStockPlan(med, sched) {
    const doseUnit = med.administrationUnit || med.formulation || 'unit(s)';
    if (usesContainerTracking(med)) {
        return {
            qtyToSubtract: 0,
            logDetail: `${formatAmount(parseAmount(sched.doseQty, 0))} ${doseUnit}; ${inventoryUnitFor(med)} inventory is reduced only when a container is marked finished`
        };
    }

    const qtyToSubtract = parseAmount(sched.doseQty, 0);
    if (parseAmount(med.stock) < qtyToSubtract) {
        await appAlert(`Insufficient stock. You need ${formatAmount(qtyToSubtract)}, but only have ${formatAmount(parseAmount(med.stock))} left.`);
        return null;
    }
    return {
        qtyToSubtract,
        logDetail: `${formatAmount(qtyToSubtract)} ${doseUnit}`
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
        ? await getAdministrationStockPlan(med, sched)
        : { qtyToSubtract: 0, logDetail: 'No dose administered' };
    if (!stockPlan) return false;

    med.stock = parseAmount(med.stock) - stockPlan.qtyToSubtract;
    const scheduledText = actual.scheduledDate && actual.scheduledTime
        ? `scheduled ${actual.scheduledDate} ${actual.scheduledTime}; `
        : '';
    const noteText = actual.doseNote ? `; Note: ${actual.doseNote}` : '';
    const overrideText = actual.prnLimitOverride ? '; PRN maximum override confirmed' : '';
    db.history.unshift({
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
    });

    if (sched.isOneTime) markScheduleCompleted(sched);
    return true;
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
    await sync();
};

window.administerDose = async function(medId, scheduleId) {
    const med = db.inventory.find(m => m.id === medId);
    const sched = db.schedules.find(s => s.id === scheduleId);
    if (!med || !sched) return;
    if (isScheduleArchived(sched)) {
        await appAlert('This medication order is completed or discontinued. Modify or extend it before documenting new administrations.');
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
                await administerScheduleRecord(linkedSchedule, actual, linkedSchedule.orderSetName ? `Regimen (${linkedSchedule.orderSetName})` : 'Linked Schedule');
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
        <div style="font-size:11px; margin-bottom:8px;">Mark the bottle or container as finished. Inventory will be reduced and this medication order will be discontinued automatically.</div>
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
                <label><input type="radio" name="scope" value="single" checked> Discontinue only this medication</label>
                <label><input type="radio" name="scope" value="linked"> Discontinue this medication and all linked medications</label>
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
    });
    await sync();

    const memberModal = document.getElementById('member-modal');
    if (currentEditingMemberId === schedule.memberId && memberModal?.style.display === 'flex') {
        openMemberModal(schedule.memberId);
    }
};

window.saveRecipe = async function() {
    const name = document.getElementById('recipe-name').value;
    const drugId = document.getElementById('recipe-drug-select').value;
    const targetConc = parseFloat(document.getElementById('recipe-target-conc').value);
    const totalVol = parseFloat(document.getElementById('recipe-total-vol').value);
    
    const drug = db.inventory.find(m => m.id === drugId);
    const drugVolNeeded = (targetConc * totalVol) / drug.strength;
    const diluentNeeded = totalVol - drugVolNeeded;

    const recipe = {
        id: Date.now().toString(),
        name: name,
        ingredients: [
            { id: drug.id, name: drug.name, amount: drugVolNeeded, unit: 'mL' },
            { name: 'Diluent/Water', amount: diluentNeeded, unit: 'mL' }
        ],
        totalVol: totalVol
    };

    db.recipes.push(recipe);
    
    // Add to inventory with 0 stock
    db.inventory.push({
        id: 'comp_' + recipe.id,
        name: name,
        strength: targetConc,
        units: 'mg/mL',
        formulation: 'mL',
        stock: 0,
        isLiquid: true
    });

    await sync();
    alert("Recipe saved to Master Formulary!");
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

    const formulationDefaults = {
        'mL': 'mL',
        'Drops': 'drop',
        'Sprays': 'spray',
        'Inhalations': 'inhalation',
        'Tablets': 'tablet',
        'Capsules': 'capsule',
        'Packet': 'packet',
        'Topical Packet': 'packet',
        'Topical Solution': 'mL',
        'Patch': 'patch',
        'Suppository': 'suppository',
        'Cream': 'gram',
        'Ointment': 'gram',
        'Gel': 'gram'
    };
    const isTopical = ['cream', 'ointment', 'gel', 'topical packet', 'topical solution'].some(type => formulation.toLowerCase().includes(type));
    const defaultPerUnit = formulationDefaults[formulation] || '';
    const isConcentration = formulation === 'mL' || units.includes('/') || ['Drops', 'Sprays', 'Inhalations'].includes(formulation);
    const formulationChanged = inventoryBehavior?.dataset.formulation !== formulation;

    if (formulationChanged) {
        if (administrationUnitInput) administrationUnitInput.value = formulationDoseUnits[formulation] || formulation || 'unit';
        if (inventoryBehavior) inventoryBehavior.value = isTopical ? 'container-finish' : 'per-dose';
        if (inventoryUnitInput) {
            if (isTopical) {
                inventoryUnitInput.value = formulation === 'Topical Packet' ? 'packet' : (formulation === 'Topical Solution' ? 'bottle' : 'tube');
            } else {
                inventoryUnitInput.value = formulationDoseUnits[formulation] || formulation || 'unit';
            }
        }
        if (inventoryBehavior) inventoryBehavior.dataset.formulation = formulation;
        if (formulation === 'mL') {
            document.querySelectorAll('#ingredient-list .ing-per-unit').forEach(select => {
                if (!select.value) select.value = 'mL';
            });
        }
    }
    if (isTopical && inventoryBehavior) inventoryBehavior.value = 'container-finish';
    if (inventoryBehavior) inventoryBehavior.disabled = isTopical;
    const behaviorChanged = inventoryBehavior?.dataset.behavior !== inventoryBehavior?.value;
    if (!formulationChanged && behaviorChanged && inventoryUnitInput) {
        inventoryUnitInput.value = inventoryBehavior.value === 'container-finish'
            ? 'bottle'
            : (formulationDoseUnits[formulation] || formulation || 'unit');
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
    if (stockUnitLabel) stockUnitLabel.innerText = inventoryUnitInput?.value || (tracksContainers ? 'containers' : (formulationDoseUnits[formulation] || formulation || 'unit(s)'));
    if (topicalStockUnit) topicalStockUnit.style.display = 'none';
    if (topicalAdminUnitWrap) topicalAdminUnitWrap.style.display = 'none';
    if (inventoryGuidance) {
        inventoryGuidance.innerText = tracksContainers
            ? 'Doses do not reduce stock. Use Finished Container when one is empty.'
            : `Each administered ${administrationUnitInput?.value || 'dose unit'} reduces stock by the quantity given.`;
    }
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
    div.className = 'field-row combo-row';
    div.style.marginBottom = '5px';
    const unitOptions = componentUnitOptions.map(unit => `<option value="${unit}">${unit}</option>`).join('');
    const defaultPerUnit = document.getElementById('med-formulation')?.value === 'mL' ? 'mL' : '';
    const perUnitOptions = componentPerUnitOptions
        .map(unit => `<option value="${unit}" ${unit === defaultPerUnit ? 'selected' : ''}>${unit || 'unit'}</option>`)
        .join('');
    div.innerHTML = `
        <input class="ing-name" type="text" placeholder="Name (e.g. APAP)" style="width:100px;">
        <input class="ing-strength" type="number" min="0" step="any" placeholder="Str" style="width:60px;">
        <select class="ing-unit" style="width:75px;">${unitOptions}</select>
        <span>per</span>
        <input class="ing-per-amount" type="number" min="0.001" step="any" value="1" style="width:55px;">
        <select class="ing-per-unit" style="width:80px;">${perUnitOptions}</select>
        <button onclick="this.parentElement.remove()">X</button>
    `;
    container.appendChild(div);
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

window.clearInventorySearch = function() {
    const search = document.getElementById('inventory-search');
    if (search) search.value = '';
    renderAll();
};


function renderAll() {
    const recipeSelect = document.getElementById('prepare-select');
    const drugSelect = document.getElementById('recipe-drug-select');
    const sortedInventory = [...db.inventory].sort((a, b) => {
        const byName = (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        if (byName !== 0) return byName;
        return formatMedStrength(a).localeCompare(formatMedStrength(b), undefined, { sensitivity: 'base' });
    });

    if(recipeSelect) recipeSelect.innerHTML = db.recipes.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    if(drugSelect) drugSelect.innerHTML = sortedInventory.filter(i => i.isLiquid).map(i => `<option value="${i.id}">${i.name} (${formatMedStrength(i)})</option>`).join('');

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
            <td>${formatAmount(parseAmount(med.stock))} ${escapeHtml(inventoryUnitFor(med))}</td>
            <td>${med.minThreshold}</td>
            <td>${med.expiry || 'N/A'}</td> <!-- NEW EXPIRATION COLUMN -->
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
    tableBody.innerHTML = '<tr><td colspan="7" style="padding:8px;">No inventory items match the search.</td></tr>';
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
    renderPendingScheduleOrders();
    renderScheduleLinkOptions();
    renderVitals();
    renderInventoryStatus();
    renderVitalDashboard();
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

function medicationLabelHtml(schedule, med, member, doseDate, doseTimes) {
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
            <div class="label-date">${escapeHtml(header)}</div>
            <div class="label-title">${escapeHtml(med.name)} ${escapeHtml(formatLabelMedStrength(med))}</div>
            <div class="label-small">Dose: ${escapeHtml(formatPrescribedDose(med, schedule.doseQty))}</div>
            <div class="label-small"><b>Qty: ${escapeHtml(formatQtyForSchedule(schedule, med))}</b></div>
            <div class="label-small">Member: ${escapeHtml(`${member.firstName} ${member.lastName}`)}</div>
            ${instructionLine}
        </div>`;
}

function medicationRangeLabelHtml(schedule, med, member, startDate, endDate, instances) {
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
        <div class="label-date">${escapeHtml(startDate === endDate ? startDate : `${startDate} - ${endDate}`)}</div>
        <div class="label-title">${escapeHtml(med.name)} ${escapeHtml(formatLabelMedStrength(med))}</div>
        <div class="label-small">Dose each time: ${escapeHtml(formatPrescribedDose(med, schedule.doseQty))}</div>
        <div class="label-small"><b>Total Qty: ${escapeHtml(totalQtyText)}</b></div>
        <div class="label-small">${escapeHtml(scheduleText)}</div>
        <div class="label-small">Member: ${escapeHtml(memberDisplayName(member))}</div>
        ${instructionLine}
    </div>`;
}

window.printSingleLabel = async function(scheduleId) {
    const s = db.schedules.find(x => x.id === scheduleId);
    if (!s) return;
    const med = db.inventory.find(m => m.id === s.medId);
    const mem = db.family.find(f => f.id === s.memberId);
    if (!med || !mem) return;
    if (s.freq === 'PRN') {
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
    if (instances.length === 0) {
        await appAlert('This medication has no scheduled doses in the selected date range.');
        return;
    }

    let labels = [];
    if (result.labelLayout === 'range') {
        labels = [medicationRangeLabelHtml(s, med, mem, startDate, endDate, instances)];
    } else if (result.labelDoseMode === 'all') {
        const byDate = instances.reduce((acc, instance) => {
            if (!acc[instance.date]) acc[instance.date] = [];
            acc[instance.date].push(instance.time);
            return acc;
        }, {});
        labels = Object.entries(byDate).map(([date, times]) =>
            medicationLabelHtml(s, med, mem, date, times.slice().sort((a, b) => timeToMinutes(a) - timeToMinutes(b)))
        );
    } else {
        labels = instances.map(instance => medicationLabelHtml(s, med, mem, instance.date, [instance.time]));
    }

    if (labels.length > 100 && !await appConfirm(`This will create ${labels.length} labels. Continue?`, 'Large Label Print Job')) {
        return;
    }
    const prepackRows = instances.map(instance => ({ schedule: s, med, instance }));
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
                singleMedication: true
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
            ${standaloneRows ? `<div class="label-selection-group"><strong>Individual Medication Orders</strong>${standaloneRows}</div>` : ''}
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
            doseRows.map(row => `${row.instance.time} ${row.med.name} ${formatLabelMedStrength(row.med)} ${formatQtyForSchedule(row.schedule, row.med)}`),
            doseRows.length + 1
        );
        const medRowsHtml = doseRows.length > 0
            ? doseRows.map(row => {
                return `<div class="label-med-row">
                <b>${escapeHtml(row.instance.time)}</b>: ${escapeHtml(row.med.name)} ${escapeHtml(formatLabelMedStrength(row.med))} (${escapeHtml(formatQtyForSchedule(row.schedule, row.med))})</div>`;
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
