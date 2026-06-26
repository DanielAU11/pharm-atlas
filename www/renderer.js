const emptyDb = { family: [], inventory: [], schedules: [], history: [], recipes: [], vitals: [], orderSets: [], prescribers: [] };
let db = { ...emptyDb };
let currentEditingMedId = null;
let currentEditingMemberId = null;
const notifiedDoseKeys = new Set();
const componentUnitOptions = ['mg', 'mL', 'mg/mL', 'mg/g', 'mEq', 'IU', 'mcg', 'g', 'g/g', '%', 'units', 'U/mL', 'CFU'];
const glucoseGoalPresets = {
    diabetic: { low: 70, high: 180 },
    nondiabetic: { low: 70, high: 140 },
    custom: { low: 70, high: 180 }
};
const defaultBpGoals = { systolicLow: 90, systolicHigh: 130, diastolicLow: 60, diastolicHigh: 80 };
let memberTimelineStart = null;
let dashboardCalendarStart = localDateKey();
let memberCalendarStart = localDateKey();

window.addEventListener('DOMContentLoaded', async () => {
    const loadedData = await window.api.load();
    db = { ...emptyDb, ...loadedData };
    renderAll();
    renderFrequencyControls('sched');
    updateInventoryEntryMode();
    checkSchedules();
});

// Helper: Convert file to Base64 for saving
const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
});

function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Helper to parse "YYYY-MM-DD" as a local date (avoiding UTC shift)
function parseLocal(dateStr) {
    if (!dateStr || dateStr === "Ongoing") return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function daysBetween(dateA, dateB) {
    const oneDayMs = 1000 * 60 * 60 * 24;
    return Math.floor((parseLocal(dateA) - parseLocal(dateB)) / oneDayMs);
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

function isScheduleDueOnDate(schedule, dateStr) {
    if (!schedule || schedule.freq === 'PRN') return false;
    if (!schedule.startDate || dateStr < schedule.startDate) return false;
    if (schedule.endDate !== "Ongoing" && schedule.endDate && dateStr > schedule.endDate) return false;

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

    if (schedule.freq === 'Monthly') {
        const current = parseLocal(dateStr);
        const start = parseLocal(schedule.startDate);
        return current && start && current.getDate() === start.getDate();
    }

    return true;
}

function getScheduleTimes(schedule) {
    const times = Array.isArray(schedule.times) ? schedule.times.filter(Boolean) : [];
    if (schedule && schedule.freq === 'QXH' && times[0] && schedule.intervalHours) {
        return generateIntervalTimes(times[0], schedule.intervalHours);
    }
    return times;
}

function getExpectedTimeCount(freq) {
    return { ONCE: 1, QD: 1, QOD: 1, QW: 1, Monthly: 1, BID: 2, TID: 3, QID: 4 }[freq] || 0;
}

function defaultTimeForIndex(index) {
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

    const qodContainer = document.getElementById(ids.qodContainer);
    const intervalContainer = document.getElementById(ids.intervalContainer);
    const prnContainer = document.getElementById(ids.prnContainer);
    if (qodContainer) qodContainer.style.display = freq === 'QOD' ? 'block' : 'none';
    if (intervalContainer) intervalContainer.style.display = freq === 'QXH' ? 'flex' : 'none';
    if (prnContainer) prnContainer.style.display = freq === 'PRN' ? 'flex' : 'none';

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
        row.innerHTML = `<label>${label}</label><input class="${prefix}-time-input" type="time" value="${times[i] || defaultTimeForIndex(i)}">`;
        container.appendChild(row);
    }
};

function collectFrequencyDetails(prefix) {
    const ids = getFieldIds(prefix);
    const freq = document.getElementById(ids.freq).value;
    const intervalInput = document.getElementById(ids.intervalHours);
    const intervalHours = freq === 'QXH' ? parseInt(intervalInput.value, 10) : null;
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

    return { freq, times: uniqueTimes, intervalHours: null };
}

function parseAmount(value, fallback = 0) {
    const amount = parseFloat(value);
    return Number.isFinite(amount) ? amount : fallback;
}

function formatAmount(value) {
    if (!Number.isFinite(value)) return '0';
    return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/\.?0+$/, '');
}

function getMemberGoals(member) {
    return {
        glucose: { preset: 'diabetic', ...glucoseGoalPresets.diabetic, ...(member?.vitalGoals?.glucose || {}) },
        bp: { ...defaultBpGoals, ...(member?.vitalGoals?.bp || {}) }
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

function formatMedStrength(med, includeNames = false) {
    if (!med) return '';
    if (med.isCombination && med.components && med.components.length > 0) {
        return med.components.map(component => {
            const name = includeNames && component.name ? `${component.name} ` : '';
            return `${name}${formatAmount(parseAmount(component.strength))}${getComponentUnit(component, med)}`;
        }).join(' / ');
    }
    if (med.displayStrength) return med.displayStrength;
    return `${med.strength}${med.units}`;
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
        }).join(' / ');
    }

    const doseUnit = med.units.includes('/') ? med.units.split('/')[0] : med.units;
    return `${formatAmount(parseAmount(med.strength) * qty)}${doseUnit}`;
}

function formatQtyForSchedule(schedule, med) {
    const qty = formatAmount(parseAmount(schedule.doseQty));
    return `${qty} ${med.administrationUnit || med.formulation || 'unit(s)'}`;
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
        .map(time => ({ date: dateStr, time, key: scheduleInstanceKey(schedule.id, dateStr, time) }));
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

    const memberSchedules = db.schedules.filter(schedule => schedule.memberId === memberId);
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

function previewLabelHtml(labelHtml) {
    pendingLabelHtml = labelHtml;
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
}

window.closeLabelPreview = function() {
    pendingLabelHtml = '';
    const modal = document.getElementById('label-preview-modal');
    if (modal) modal.style.display = 'none';
};

window.printPreviewedLabel = function() {
    if (!pendingLabelHtml) return;
    const printArea = document.getElementById('print-area');
    printArea.innerHTML = pendingLabelHtml;
    window.closeLabelPreview();
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
            result[input.name] = input.value;
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
    return med?.inventoryBehavior === 'container-finish' ||
        ['cream', 'ointment', 'gel', 'topical packet', 'topical solution'].some(type => formulation.includes(type));
}

function inventoryUnitFor(med) {
    return med?.inventoryUnit || (isTopicalMedication(med) ? 'tube' : (med?.formulation || 'unit(s)'));
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

window.adminOrderSetSubmitAll = function() {
    const modal = document.getElementById('action-modal');
    if (!modal) return;
    modal.querySelectorAll('.admin-os-med').forEach(input => {
        input.checked = true;
    });
    modal.querySelector('#action-modal-ok')?.click();
};

window.switchTab = function(tabName) {
    const tabs = ['dashboard', 'schedules', 'order-sets', 'vitals', 'inventory', 'drug-info', 'family'];
    tabs.forEach(t => {
        const tabElement = document.getElementById(`tab-${t}`);
        const panelElement = document.getElementById(`panel-${t}`);
        if (t === tabName) {
            if (tabElement) tabElement.classList.add('active');
            if (panelElement) panelElement.style.display = 'block';
        } else {
            if (tabElement) tabElement.classList.remove('active');
            if (panelElement) panelElement.style.display = 'none';
        }
    });
};

async function sync() {
    await window.api.save(db);
    renderAll();
    const memberModal = document.getElementById('member-modal');
    if (currentEditingMemberId && memberModal?.style.display === 'flex') {
        renderMemberAdministrationLog(currentEditingMemberId);
        renderMemberVitalProfile(currentEditingMemberId);
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
        await sync();
    }
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
    if (emailReminders) emailReminders.checked = true;
    renderMemberCareLists();
    
    const activeMedsContainer = document.getElementById('member-active-meds-list');
    if (activeMedsContainer) activeMedsContainer.innerHTML = '';
    safeSet('m-calendar-color', '#000080');
    setMemberGoalFields(null);
    
    if (id) {
        const m = db.family.find(member => member.id === id);
        if (m) {
            if (title) {
                title.innerText = `Edit: ${m.firstName} ${m.lastName}`;
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
            if (emailReminders) emailReminders.checked = notifications.emailReminders !== false;
            setHiddenJson('m-prescriber-ids-data', memberPrescriberIds(m));
            setHiddenJson('m-diagnoses-data', normalizeMemberDiagnoses(m));
            renderMemberCareLists();
            setMemberGoalFields(m);

            // 3. Populate Active Meds
            if (activeMedsContainer) {
                const printControls = document.createElement('div');
                printControls.className = 'field-row';
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
                printButton.innerText = 'Print Range';
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
            const memberOrderSets = db.orderSets.filter(set => set.memberId === id);
            memberOrderSets.forEach(set => {
                const div = document.createElement('div');
                div.className = 'sunken-panel';
                div.style.cssText = "padding:5px; margin-bottom:5px; background:white; border:1px inset gray;";
                const itemRows = set.items.map(item => {
                    const med = db.inventory.find(inv => inv.id === item.medId);
                    const schedule = db.schedules.find(candidate => candidate.orderSetId === set.id && candidate.medId === item.medId);
                    return `<div style="font-size:11px; border-bottom:1px dotted #c0c0c0; padding-bottom:4px;">${med ? `${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))}` : 'Unknown'} - ${escapeHtml(formatQtyForSchedule(item, med || {}))} | ${escapeHtml(item.freq)} ${escapeHtml(getScheduleTimes(item).join(', ') || 'PRN')}${escapeHtml(prnLimitText(item))}
                        ${schedule ? `<div class="member-med-timeline" data-schedule-id="${schedule.id}"></div>` : ''}
                    </div>`;
                }).join('');
                div.innerHTML = `
                    <strong>${set.name}</strong><br>
                    <small>${set.startDate} - ${set.endDate}</small>
                    <div style="margin-top:4px;">${itemRows}</div>
                    <div style="text-align:right; margin-top:5px;">
                        <button onclick="event.stopPropagation(); printOrderSetLabel('${set.id}')">Label</button>
                        <button onclick="event.stopPropagation(); administerOrderSet('${set.id}')">Administer</button>
                        <button onclick="event.stopPropagation(); editOrderSet('${set.id}')">Edit Set</button>
                        <button onclick="event.stopPropagation(); deleteOrderSet('${set.id}')">Delete Set</button>
                    </div>
                `;
                if (activeMedsContainer) activeMedsContainer.appendChild(div);
            });

            const memberSchedules = db.schedules.filter(s => s.memberId === id && !s.orderSetId);
            memberSchedules.forEach(s => {
                const med = db.inventory.find(inv => inv.id === s.medId);
                const div = document.createElement('div');
                div.className = 'sunken-panel';
                div.style.cssText = "padding:5px; margin-bottom:5px; cursor:pointer; background:white; border:1px inset gray;";
                div.innerHTML = `
                    <strong>${med ? med.name : 'Unknown'} ${med ? formatMedStrength(med) : ''}</strong> - ${med ? formatQtyForSchedule(s, med) : s.doseQty}<br>
                    <small>${s.freq} | ${getScheduleTimes(s).join(', ') || 'PRN'}${escapeHtml(prnLimitText(s))}</small>
                    <div class="member-med-timeline" data-schedule-id="${s.id}"></div>
                    <div style="text-align:right; margin-top:5px;">
                        <button onclick="event.stopPropagation(); printSingleLabel('${s.id}')">Label</button>
                        <button onclick="event.stopPropagation(); administerDose('${s.medId}','${s.id}')">Administer</button>
                        ${med && isTopicalMedication(med) ? `<button onclick="event.stopPropagation(); finishTopicalContainer('${s.id}')">Finished Container</button>` : ''}
                        <button onclick="event.stopPropagation(); deleteSchedule('${s.id}')">Discontinue</button>
                    </div>
                `;
                div.onclick = () => window.openOrderModifier(s.id);
                if (activeMedsContainer) activeMedsContainer.appendChild(div);
            });
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
    document.getElementById('mod-prn-max-doses').value = sched.prnMaxDoses || '';
    document.getElementById('mod-prn-window-hours').value = sched.prnWindowHours || 24;
    renderFrequencyControls('mod', sched.freq === 'QXH' ? [sched.startTime || getScheduleTimes(sched)[0]] : getScheduleTimes(sched));
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
        sched.endDate = document.getElementById('mod-end').value || "Ongoing";
        sched.doseQty = document.getElementById('mod-dose-qty').value;
        sched.prescriberId = document.getElementById('mod-prescriber')?.value || '';
        sched.freq = frequencyDetails.freq;
        sched.times = frequencyDetails.times;
        sched.intervalHours = frequencyDetails.intervalHours;
        sched.prnMaxDoses = frequencyDetails.prnMaxDoses || null;
        sched.prnWindowHours = frequencyDetails.prnWindowHours || 24;
        sched.startTime = frequencyDetails.startTime || frequencyDetails.times[0] || "";
        sched.instructions = document.getElementById('mod-instr').value;
        sched.qodStart = sched.freq === 'QOD' ? (document.getElementById('mod-qod-start-date').value || sched.startDate) : "";
        sched.isOneTime = sched.freq === 'ONCE' || (sched.startDate === sched.endDate && sched.endDate !== "Ongoing");
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
            emailReminders: document.getElementById('m-email-reminders')?.checked !== false
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
    const inventoryUnit = topical
        ? (document.getElementById('med-topical-stock-unit')?.value || 'tube')
        : formulation;
    const administrationUnit = topical
        ? (document.getElementById('med-topical-admin-unit')?.value || 'application')
        : formulation;
    const imageInput = document.getElementById('med-image-input');
    const expiry = document.getElementById('med-expiry').value;
    if (!name || isNaN(qty)) return alert("Name and Qty required.");
    
    // --- NEW COMBINATION LOGIC ---
    const isCombo = document.getElementById('is-combination').checked;
    let components = [];
    let finalStrength = strengthAmount;
    let finalUnits = activeUnit;
    let displayStrength = '';

    if (isCombo) {
        const rows = document.querySelectorAll('#ingredient-list .combo-row');
        rows.forEach(row => {
            const componentName = row.querySelector('.ing-name').value.trim();
            const componentStrength = parseAmount(row.querySelector('.ing-strength').value, NaN);
            const componentUnit = row.querySelector('.ing-unit').value;
            if (componentName && !isNaN(componentStrength)) {
                components.push({ name: componentName, strength: componentStrength, unit: componentUnit });
            }
        });
        if (components.length === 0) return alert("Add at least one valid active ingredient.");
        finalStrength = components.map(c => `${formatAmount(c.strength)}${c.unit}`).join('/');
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
    if (imageInput.files[0]) {
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
        inventoryBehavior: topical ? 'container-finish' : 'per-dose',
        stock: qty, 
        maxCapacity: qty,
        expiry: expiry,
        isLiquid: finalUnits.includes('/') || document.getElementById('med-formulation').value === 'mL',
        isCombination: isCombo,
        components: components, // Only for combinations    
        minThreshold: parseAmount(document.getElementById('med-threshold').value, 5),
        prescriberId,
        imagePath: imagePath 
    });
    
    document.getElementById('med-name').value = '';
    document.getElementById('med-strength').value = '';
    document.getElementById('med-per-amount').value = '1';
    document.getElementById('med-per-unit').value = '';
    document.getElementById('med-qty').value = '';
    document.getElementById('ingredient-list').innerHTML = '';
    document.getElementById('is-combination').checked = false;
    const medPrescriber = document.getElementById('med-prescriber');
    if (medPrescriber) medPrescriber.value = '';
    updateInventoryEntryMode();
    imageInput.value = '';
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
    const result = await requestActualAdministration(`Take: ${med.name}`, `
        <div class="field-row" style="margin-top:8px;">
            <label>Member:</label>
            <select name="memberId" style="width:220px;">${memberOptionsHtml(currentEditingMemberId || '')}</select>
        </div>
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Amount taken (${escapeHtml(formulation)}):</label>
            <input name="amountTaken" type="number" min="0" step="0.1" value="1">
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
    if (!isTopicalMedication(med) && parseAmount(med.stock) < amountTaken) {
        await appAlert("Insufficient stock.");
        return;
    }

    if (!isTopicalMedication(med)) med.stock = parseAmount(med.stock) - amountTaken;
    db.history.unshift({
        id: Date.now().toString(),
        timestamp: formatActualTimestamp(result),
        memberId: member.id,
        memberName: memberDisplayName(member),
        medName: med.name,
        details: `Manual/supplemental ${isTopicalMedication(med) ? 'application' : 'dose'} - ${formatAmount(amountTaken)} ${med.administrationUnit || formulation}${isTopicalMedication(med) ? `; container inventory unchanged` : ''}${result.adminNote ? ` | Note: ${result.adminNote}` : ''}`
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

window.openMedProfile = function(id) {
    currentEditingMedId = id;
    const med = db.inventory.find(m => m.id === id);
    if (!med) return alert("Medication not found.");
    document.getElementById('modal-med-name').value = med.name;
    document.getElementById('modal-expiry').value = med.expiry;
    document.getElementById('modal-title').innerText = `${med.name} Profile`;
    document.getElementById('modal-stock').value = med.stock;
    document.getElementById('modal-notes').value = med.notes || "";
    document.getElementById('modal-storage').value = med.storage || "";
    document.getElementById('modal-control-level').value = med.controlLevel || "N/A";
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
        if (!updatedName) {
            await appAlert('Medication name is required.');
            return;
        }
        med.name = updatedName;
        med.stock = parseAmount(document.getElementById('modal-stock').value, med.stock);
        med.notes = document.getElementById('modal-notes').value;
        med.storage = document.getElementById('modal-storage').value;
        med.controlLevel = document.getElementById('modal-control-level').value;
        med.expiry = document.getElementById('modal-expiry').value;
        med.prescriberId = document.getElementById('modal-prescriber')?.value || '';

        // 2. Handle Image Upload
        const imageInput = document.getElementById('modal-image-input');
        if (imageInput && imageInput.files[0]) {
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
        ['QOD', 'QOD'],
        ['QW', 'Once Weekly'],
        ['QXH', 'Every X Hours'],
        ['PRN', 'PRN'],
        ['Monthly', 'Once Monthly']
    ];
    return options.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
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
        <div class="field-row os-qod" style="display:none; margin-top:5px;"><label>QOD Start:</label><input class="os-qod-start" type="date" value="${item?.qodStart || ''}"></div>
        <div class="field-row os-interval" style="display:none; margin-top:5px;"><label>Every:</label><input class="os-interval-hours" type="number" min="1" max="24" step="1" value="${item?.intervalHours || 8}" style="width:45px;"><span>hrs</span></div>
        <div class="field-row os-prn-limit" style="display:none; margin-top:5px;"><label>PRN Max:</label><input class="os-prn-max-doses" type="number" min="1" step="1" style="width:45px;" value="${item?.prnMaxDoses || ''}"><span>doses per</span><input class="os-prn-window-hours" type="number" min="1" max="168" step="1" value="${item?.prnWindowHours || 24}" style="width:45px;"><span>hrs</span></div>
        <div class="field-row-stacked" style="margin-top:5px;"><label>Administration Time(s)</label><div class="os-time-fields"></div></div>
        <div class="field-row-stacked" style="margin-top:5px;"><label>Instructions</label><textarea class="os-instructions" rows="2" style="width:100%; resize:none;">${escapeHtml(item?.instructions || '')}</textarea></div>
    `;
    row.querySelector('.os-freq').addEventListener('change', () => renderOrderSetRowControls(row));
    row.querySelector('.os-med-search').addEventListener('input', () => updateOrderSetStrengthOptions(row));
    row.querySelector('.os-med-strength').addEventListener('change', () => updateOrderSetRowDose(row));
    row.querySelector('.os-dose').addEventListener('input', () => updateOrderSetRowDose(row));
    row.querySelector('.os-remove').addEventListener('click', () => row.remove());
    container.appendChild(row);
    updateOrderSetStrengthOptions(row, item?.medId || '');
    renderOrderSetRowControls(row, item?.freq === 'QXH' ? [item?.startTime || item?.times?.[0]] : item?.times);
};

function renderOrderSetRowControls(row, existingTimes = null) {
    const freq = row.querySelector('.os-freq').value;
    row.querySelector('.os-qod').style.display = freq === 'QOD' ? 'flex' : 'none';
    row.querySelector('.os-interval').style.display = freq === 'QXH' ? 'flex' : 'none';
    row.querySelector('.os-prn-limit').style.display = freq === 'PRN' ? 'flex' : 'none';
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
        timeRow.innerHTML = `<label>${label}</label><input class="os-time-input" type="time" value="${times[i] || defaultTimeForIndex(i)}">`;
        timeContainer.appendChild(timeRow);
    }
}

function collectOrderSetItem(row) {
    const medId = row.querySelector('.os-med-strength').value;
    const doseQty = row.querySelector('.os-dose').value;
    const freq = row.querySelector('.os-freq').value;
    const rawTimes = Array.from(row.querySelectorAll('.os-time-input')).map(input => input.value).filter(Boolean);
    const intervalHours = freq === 'QXH' ? parseInt(row.querySelector('.os-interval-hours').value, 10) : null;
    const prnMaxDoses = freq === 'PRN' ? parseInt(row.querySelector('.os-prn-max-doses')?.value, 10) : null;
    const prnWindowHours = freq === 'PRN' ? parseInt(row.querySelector('.os-prn-window-hours')?.value, 10) : null;
    if (!medId || !doseQty) {
        return { error: "Each order set medication needs a medication, strength, and dose quantity." };
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
        prnMaxDoses: prnMaxDoses || null,
        prnWindowHours: prnWindowHours || 24,
        startTime: rawTimes[0] || '',
        qodStart: freq === 'QOD' ? row.querySelector('.os-qod-start').value : '',
        instructions: row.querySelector('.os-instructions').value
    };
}

function orderSetItemToSchedule(orderSet, item, index) {
    const med = db.inventory.find(inv => inv.id === item.medId);
    return {
        id: `${orderSet.id}_${Date.now()}_${index}`,
        memberId: orderSet.memberId,
        medId: item.medId,
        doseQty: item.doseQty,
        prescriberId: item.prescriberId || med?.prescriberId || '',
        freq: item.freq,
        startDate: orderSet.startDate,
        endDate: orderSet.endDate,
        instructions: item.instructions,
        qodStart: item.freq === 'QOD' ? (item.qodStart || orderSet.startDate) : '',
        times: item.times,
        intervalHours: item.intervalHours,
        prnMaxDoses: item.prnMaxDoses || null,
        prnWindowHours: item.prnWindowHours || 24,
        startTime: item.startTime || item.times[0] || '',
        isOneTime: item.freq === 'ONCE' || (orderSet.startDate === orderSet.endDate && orderSet.endDate !== 'Ongoing'),
        orderSetId: orderSet.id,
        orderSetName: orderSet.name
    };
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
            await appAlert(item?.error || "Check the order set medication rows.");
            return;
        }
        items.push(item);
    }
    if (items.length === 0) {
        await appAlert("Add at least one medication to the order set.");
        return;
    }

    const orderSet = { id: editId || Date.now().toString(), memberId, name, startDate, endDate, items };
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
        await appAlert("Add a member before assigning an order set.");
        return;
    }

    const result = await showActionModal(`Assign Order Set: ${source.name}`, `
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
        await appAlert("Member and start date are required to assign an order set.");
        return;
    }

    const assignedSet = {
        ...source,
        id: Date.now().toString(),
        templateId: source.templateId || source.id,
        memberId: result.memberId,
        startDate: result.startDate,
        endDate: result.endDate || 'Ongoing',
        items: source.items.map(item => ({ ...item }))
    };

    db.orderSets.push(assignedSet);
    db.schedules.push(...assignedSet.items.map((item, index) => orderSetItemToSchedule(assignedSet, item, index)));
    await sync();
};

window.deleteOrderSet = async function(id) {
    if (!await appConfirm("Delete this order set and its related schedules?", "Delete Order Set")) return;
    db.orderSets = db.orderSets.filter(set => set.id !== id);
    db.schedules = db.schedules.filter(schedule => schedule.orderSetId !== id);
    await sync();
};

window.printOrderSetLabel = function(id) {
    const set = db.orderSets.find(orderSet => orderSet.id === id);
    if (!set) return;
    const member = db.family.find(m => m.id === set.memberId);
    const rows = set.items.map(item => {
        const med = db.inventory.find(m => m.id === item.medId);
        if (!med) return '';
        const schedule = { ...item, startDate: set.startDate, endDate: set.endDate };
        const instr = item.instructions ? ` - ${escapeHtml(item.instructions)}` : '';
        return `<div class="label-med-row">* ${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))}; Qty ${escapeHtml(formatQtyForSchedule(schedule, med))}; ${escapeHtml(item.freq)} ${escapeHtml(getScheduleTimes(schedule).join(', ') || 'PRN')}${instr}</div>`;
    }).join('');

    previewLabelHtml(`
        <div class="${getLabelClass([set.name, rows], set.items.length + 2)}">
            <div class="label-title">${escapeHtml(set.name)}</div>
            <div class="label-small">${escapeHtml(member ? `${member.firstName} ${member.lastName}` : '')} | ${escapeHtml(set.startDate)}-${escapeHtml(set.endDate)}</div>
            ${rows}
        </div>`);
};

function renderOrderSets() {
    const memberSelect = document.getElementById('order-set-member');
    if (memberSelect) {
        memberSelect.innerHTML = `<option value="">Reusable template</option>` + db.family
            .slice()
            .sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b), undefined, { sensitivity: 'base' }))
            .map(m => `<option value="${m.id}">${escapeHtml(memberDisplayName(m))}</option>`)
            .join('');
    }

    const startInput = document.getElementById('order-set-start');
    if (startInput && !startInput.value) startInput.value = localDateKey();

    const medList = document.getElementById('order-set-med-list');
    if (medList && medList.children.length === 0 && db.inventory.length > 0) {
        addOrderSetMedicationRow();
    }

    const list = document.getElementById('order-set-list');
    if (!list) return;
    if (db.orderSets.length === 0) {
        list.innerHTML = '<div style="padding:6px; font-size:11px;">No order sets saved.</div>';
        return;
    }

    list.innerHTML = db.orderSets.map(set => {
        const member = db.family.find(m => m.id === set.memberId);
        const assignmentLabel = member ? `${member.lastName}, ${member.firstName}` : 'Reusable template';
        const itemSummary = set.items.map(item => {
            const med = db.inventory.find(m => m.id === item.medId);
            return med ? med.name : 'Unknown';
        }).join(', ');
        return `<div class="med-item-row" style="border-bottom:1px solid #808080;">
            <div style="flex-grow:1;">
                <strong>${escapeHtml(set.name)}</strong> - ${escapeHtml(assignmentLabel)}<br>
                <small>${escapeHtml(itemSummary)}</small>
            </div>
            <button onclick="assignOrderSet('${set.id}')">Assign</button>
            <button onclick="printOrderSetLabel('${set.id}')">Label</button>
            ${member ? `<button onclick="administerOrderSet('${set.id}')">Administer</button>` : ''}
            <button onclick="editOrderSet('${set.id}')">Edit</button>
            <button onclick="deleteOrderSet('${set.id}')">Delete</button>
        </div>`;
    }).join('');
}

// --- VITALS ---
function vitalTypeLabel(type) {
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
        return (Number.isFinite(sys) && (sys < goals.bp.systolicLow || sys > goals.bp.systolicHigh)) ||
            (Number.isFinite(dia) && (dia < goals.bp.diastolicLow || dia > goals.bp.diastolicHigh));
    }
    return false;
}

window.renderVitalInputs = function() {
    const type = document.getElementById('vital-type')?.value || 'bp';
    const container = document.getElementById('vital-input-fields');
    if (!container) return;

    if (type === 'bp') {
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
    const type = document.getElementById('vital-type').value;
    const date = document.getElementById('vital-date').value;
    const time = document.getElementById('vital-time').value;
    const notes = document.getElementById('vital-notes')?.value.trim() || '';
    if (!memberId || !date || !time) return alert("Member, date, and time are required.");

    const reading = { id: Date.now().toString(), memberId, type, date, time, notes };
    if (type === 'bp') {
        reading.systolic = parseAmount(document.getElementById('vital-systolic').value, NaN);
        reading.diastolic = parseAmount(document.getElementById('vital-diastolic').value, NaN);
        reading.hr = parseAmount(document.getElementById('vital-hr').value, NaN);
        if (isNaN(reading.systolic) || isNaN(reading.diastolic)) return alert("Systolic and diastolic BP are required.");
        if (isNaN(reading.hr)) reading.hr = '';
    } else if (type === 'weight') {
        reading.weight = parseAmount(document.getElementById('vital-weight').value, NaN);
        reading.weightUnit = document.getElementById('vital-weight-unit').value;
        if (isNaN(reading.weight)) return alert("Weight is required.");
    } else if (type === 'temperature') {
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
    return NaN;
}

function isChartPointOutOfRange(type, key, value, member) {
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
    return false;
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
    if (options.type === 'bp') goalValues.push(goals.bp.systolicLow, goals.bp.systolicHigh, goals.bp.diastolicLow, goals.bp.diastolicHigh);

    const allValues = pointsBySeries.flatMap(item => item.values.map(p => p.value)).concat(goalValues);
    if (allValues.length === 0) {
        ctx.fillStyle = '#000000';
        ctx.font = '10px MS Sans Serif, Arial';
        ctx.fillText('No data', 8, 18);
        return;
    }

    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const spread = Math.max(max - min, 1);
    const leftPad = 42;
    const rightPad = 14;
    const topPad = 16;
    const bottomPad = 22;
    const xFor = index => readings.length <= 1 ? (leftPad + width - rightPad) / 2 : leftPad + (index / (readings.length - 1)) * (width - leftPad - rightPad);
    const yFor = value => height - bottomPad - ((value - min) / spread) * (height - topPad - bottomPad);

    ctx.strokeStyle = '#c0c0c0';
    ctx.beginPath();
    ctx.moveTo(leftPad, topPad);
    ctx.lineTo(leftPad, height - bottomPad);
    ctx.lineTo(width - rightPad, height - bottomPad);
    ctx.stroke();

    if (options.type === 'glucose') {
        const y70 = yFor(70);
        ctx.strokeStyle = '#ff0000';
        ctx.beginPath();
        ctx.moveTo(leftPad, y70);
        ctx.lineTo(width - rightPad, y70);
        ctx.stroke();
        ctx.fillStyle = '#ff0000';
        ctx.font = '9px MS Sans Serif, Arial';
        ctx.textAlign = 'right';
        ctx.fillText('70', leftPad - 6, y70 - 3);
        ctx.textAlign = 'left';
    }

    pointsBySeries.forEach(item => {
        ctx.strokeStyle = item.color;
        ctx.fillStyle = item.color;
        ctx.beginPath();
        item.values.forEach((point, idx) => {
            const x = xFor(point.index);
            const y = yFor(point.value);
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        item.values.forEach(point => {
            const x = xFor(point.index);
            const y = yFor(point.value);
            ctx.fillStyle = isChartPointOutOfRange(options.type, item.key, point.value, options.member) ? '#ff0000' : item.color;
            ctx.fillRect(x - 2, y - 2, 4, 4);
        });
    });

    ctx.fillStyle = '#000000';
    ctx.font = '9px MS Sans Serif, Arial';
    ctx.textAlign = 'right';
    ctx.fillText(`${formatAmount(max)}`, leftPad - 6, topPad + 3);
    ctx.fillText(`${formatAmount(min)}`, leftPad - 6, height - bottomPad);
    ctx.textAlign = 'left';
    ctx.fillText(options.unit || '', leftPad, 10);
    if (readings.length > 0) {
        ctx.fillText(readings[0].date.slice(5), leftPad, height - 4);
        ctx.fillText(readings[readings.length - 1].date.slice(5), Math.max(leftPad, width - 42), height - 4);
    }
}

function renderVitals() {
    const memberSelect = document.getElementById('vital-member-select');
    if (memberSelect) {
        memberSelect.innerHTML = db.family.map(m => `<option value="${m.id}">${m.lastName}, ${m.firstName}</option>`).join('');
    }

    const dateInput = document.getElementById('vital-date');
    const timeInput = document.getElementById('vital-time');
    if (dateInput && !dateInput.value) dateInput.value = localDateKey();
    if (timeInput && !timeInput.value) {
        const now = new Date();
        timeInput.value = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }
    renderVitalInputs();

    const tableBody = document.getElementById('vital-table-body');
    if (tableBody) {
        const sortedVitals = [...db.vitals].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
        tableBody.innerHTML = sortedVitals.slice(0, 50).map(reading => {
            const member = db.family.find(m => m.id === reading.memberId);
            const warningStyle = isVitalOutOfRange(reading, member) ? 'color:red; font-weight:bold;' : '';
            return `<tr style="${warningStyle}">
                <td>${member ? `${member.lastName}, ${member.firstName}` : '?'}</td>
                <td>${reading.date} ${reading.time}</td>
                <td>${vitalTypeLabel(reading.type)}</td>
                <td>${formatVitalReading(reading)}</td>
                <td>${escapeHtml(reading.notes || '')}</td>
                <td><button onclick="deleteVitalReading('${reading.id}')">Delete</button></td>
            </tr>`;
        }).join('');
    }
}

function getVitalChartConfigs() {
    return [
        { type: 'bp', title: 'BP / HR', unit: 'mmHg / bpm', series: [
            { key: 'systolic', label: 'Systolic', color: '#0000aa' },
            { key: 'diastolic', label: 'Diastolic', color: '#008000' },
            { key: 'hr', label: 'Heart Rate', color: '#aa00aa' }
        ] },
        { type: 'weight', title: 'Weight', unit: 'lb', series: [{ key: 'weight', label: 'Weight', color: '#0000aa' }] },
        { type: 'glucose', title: 'Blood Glucose', unit: 'mg/dL', series: [{ key: 'glucose', label: 'Glucose', color: '#070707' }] },
        { type: 'temperature', title: 'Temperature', unit: 'F', series: [{ key: 'temperature', label: 'Temperature', color: '#b34d00' }] }
    ];
}

function renderMemberVitalCharts(memberId, container) {
    if (!container) return;
    const member = db.family.find(m => m.id === memberId);
    container.innerHTML = '<div class="vital-chart-grid"></div>';
    const grid = container.querySelector('.vital-chart-grid');

    getVitalChartConfigs().forEach(chart => {
        const readings = db.vitals
            .filter(v => v.memberId === memberId && v.type === chart.type)
            .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
        if (readings.length === 0) return;

        const first = readings[0];
        const last = readings[readings.length - 1];
        const panel = document.createElement('div');
        panel.className = 'vital-chart-panel';
        const legend = chart.series.map(s => `<span><span class="legend-swatch" style="background:${s.color};"></span>${s.label}</span>`).join(' ');
        panel.innerHTML = `
            <div style="font-size:11px; font-weight:bold;">${chart.title}</div>
            <div class="vital-chart-meta">${first.date} to ${last.date} (${readings.length} readings)</div>
            <canvas width="380" height="150" class="vital-chart"></canvas>
            <div class="vital-legend">${legend}<span><span class="legend-swatch" style="background:#ff0000;"></span>Out of goal</span></div>
        `;
        grid.appendChild(panel);
        drawVitalChart(panel.querySelector('canvas'), readings, chart.series, { type: chart.type, unit: chart.unit, member });
    });

    if (!grid.children.length) {
        container.innerHTML = '<div style="font-size:11px;">No vitals logged for this member.</div>';
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
        const canEdit = entry.scheduleId;
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
    if (due < now) return { className: 'timeline-overdue', title: 'Not documented at scheduled time' };
    if (instance.date === localDateKey(now)) return { className: 'timeline-upcoming', title: 'Upcoming dose' };
    return { className: 'timeline-future', title: 'Future scheduled dose' };
}

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
                const click = state.entryId ? ` onclick="event.stopPropagation(); editAdministration('${state.entryId}')"` : '';
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
    const section = (title, items) => `
        <div class="inventory-status-box">
            <strong>${title}: ${items.length}</strong>
            ${items.length
                ? `<ul>${items.slice(0, 8).map(inventoryStatusItemHtml).join('')}${items.length > 8 ? `<li>+${items.length - 8} more</li>` : ''}</ul>`
                : '<div class="status-ok">None</div>'}
        </div>`;

    container.innerHTML = `
        <div class="inventory-status-grid">
            ${section('Low meds', groups.low)}
            ${section('Expired meds', groups.expired)}
            ${section('Expiring in 15 days', groups.expiringSoon)}
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
        <h1>${escapeHtml(title)}</h1>
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
            body: message || `${title}\n\nGenerated by PharmAtlas.`
        });
        if (result?.success) {
            await appAlert(`Schedule PDF sent to ${to}.`);
            return true;
        }
        await appAlert(`Unable to send schedule PDF${result?.error ? `: ${result.error}` : '.'}`);
        return false;
    } catch (error) {
        console.error(error);
        await appAlert("Unable to send schedule PDF.");
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
    await saveReportPdf('PharmAtlas Current Inventory Report', body, 'PharmAtlas_Inventory');
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
        `PharmAtlas Medication Schedule - ${member.firstName} ${member.lastName}`,
        memberScheduleReportBody(member, startDate, endDate),
        `PharmAtlas_Schedule_${member.lastName}_${member.firstName}`
    );
};

window.emailMemberSchedulePdfReport = async function(memberId = currentEditingMemberId, startDate = localDateKey(), endDate = localDateKey()) {
    const member = db.family.find(m => m.id === memberId);
    if (!member) return appAlert("Open a saved member profile before emailing a schedule PDF.");
    if (!startDate || !endDate || endDate < startDate) return appAlert("Enter a valid schedule date range.");

    const title = `PharmAtlas Medication Schedule - ${member.firstName} ${member.lastName}`;
    const defaultMessage = `Attached is the medication schedule for ${member.firstName} ${member.lastName} from ${startDate} to ${endDate}.\n\nGenerated by PharmAtlas.`;
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
        `PharmAtlas_Schedule_${member.lastName}_${member.firstName}`,
        email,
        result.message
    );
};

function vitalChartReportHtml(member, chart, readings) {
    if (readings.length === 0) return '';
    const canvas = document.createElement('canvas');
    canvas.width = 680;
    canvas.height = 260;
    drawVitalChart(canvas, readings, chart.series, { type: chart.type, unit: chart.unit, member });
    const imageUrl = canvas.toDataURL('image/png');
    const legend = chart.series
        .map(series => `<span><span class="swatch" style="background:${series.color};"></span>${escapeHtml(series.label)}</span>`)
        .join('');
    return `
        <h3>${escapeHtml(chart.title)}</h3>
        <div class="legend">${legend}<span><span class="swatch" style="background:#ff0000;"></span>Out of goal</span></div>
        <img class="chart-img" src="${imageUrl}" alt="${escapeHtml(chart.title)} chart">`;
}

function memberVitalsReportBody(member) {
    const goals = getMemberGoals(member);
    const memberReadings = db.vitals
        .filter(reading => reading.memberId === member.id)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

    const chartsHtml = getVitalChartConfigs().map(chart => {
        const chartReadings = memberReadings.filter(reading => reading.type === chart.type);
        return vitalChartReportHtml(member, chart, chartReadings);
    }).join('');

    const logSections = getVitalChartConfigs().map(chart => {
        const rows = memberReadings
            .filter(reading => reading.type === chart.type)
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
        <div class="muted">Glucose goal: ${escapeHtml(goals.glucose.low)}-${escapeHtml(goals.glucose.high)} mg/dL | BP goal: ${escapeHtml(goals.bp.systolicLow)}-${escapeHtml(goals.bp.systolicHigh)}/${escapeHtml(goals.bp.diastolicLow)}-${escapeHtml(goals.bp.diastolicHigh)} mmHg</div>
        ${chartsHtml || '<h3>No graphable vitals yet.</h3>'}
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
        `PharmAtlas Monitored Vitals Report - ${member.firstName} ${member.lastName}`,
        memberVitalsReportBody(member),
        `PharmAtlas_Vitals_${member.lastName}_${member.firstName}`
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
};

//Scheduler checks every minute to see if any meds are due and sends a notification
async function checkSchedules() {
    const now = new Date();
    const todayKey = localDateKey(now);
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    db.schedules.forEach(s => {
        const reminderKey = `${todayKey}|${s.id}|${currentTime}`;
        if (isScheduleDueOnDate(s, todayKey) && getScheduleTimes(s).includes(currentTime) && !isScheduleInstanceDocumented(s.id, todayKey, currentTime) && !notifiedDoseKeys.has(reminderKey)) {
            const med = db.inventory.find(m => m.id === s.medId);
            const member = db.family.find(f => f.id === s.memberId);
            
            if (med && member) {
                notifiedDoseKeys.add(reminderKey);
                const notificationPrefs = member.notificationPrefs || {};
                if (notificationPrefs.medicationReminders !== false) {
                    window.api.notify("Medication Due!", `${member.firstName} needs ${med.name} at ${currentTime}`);
                }

                if (member.email && notificationPrefs.emailReminders !== false) {
                    window.api.sendEmail({
                        to: member.email,
                        subject: `PharmAtlas: Medication Reminder for ${member.firstName}`,
                        body: `Hello, this is a reminder to take ${formatQtyForSchedule(s, med)} of ${med.name} (${formatMedStrength(med, true)}) at ${currentTime}.\nInstructions: ${s.instructions || 'None'}`
                    });
                }
            }
        }
    });
}

setInterval(checkSchedules, 60 * 1000); // Check every minute

window.toggleQODDate = function() {
    renderFrequencyControls('sched');
};

window.addSchedule = async function() {
    const memberId = document.getElementById('select-member').value;
    const medId = document.getElementById('sched-strength-display').value;
    const med = db.inventory.find(m => m.id === medId);
    const member = db.family.find(m => m.id === memberId);
    
    const startDate = document.getElementById('sched-start').value;
    const endDate = document.getElementById('sched-end').value || "Ongoing";
    
    const instructions = document.getElementById('sched-instructions').value;

    if (!member) return alert("Select a family member first.");
    if (!med || !startDate) return alert("Select medication name, strength, and start date!");

    const frequencyDetails = collectFrequencyDetails('sched');
    if (!frequencyDetails) return;

    db.schedules.push({
        id: Date.now().toString(), 
        memberId, 
        medId: med.id,
        doseQty: document.getElementById('sched-dose-qty').value,
        prescriberId: document.getElementById('sched-prescriber')?.value || med.prescriberId || '',
        freq: frequencyDetails.freq,
        startDate,
        endDate,
        instructions: instructions,
        qodStart: frequencyDetails.freq === 'QOD' ? (document.getElementById('qod-start-date').value || startDate) : "",
        times: frequencyDetails.times,
        intervalHours: frequencyDetails.intervalHours,
        prnMaxDoses: frequencyDetails.prnMaxDoses || null,
        prnWindowHours: frequencyDetails.prnWindowHours || 24,
        startTime: frequencyDetails.startTime || frequencyDetails.times[0] || "",
        isOneTime: frequencyDetails.freq === 'ONCE' || (startDate === endDate && endDate !== "Ongoing")
    });
    
    await sync();
    
    // Clear fields
    document.getElementById('med-search-input').value = '';
    document.getElementById('sched-dose-qty').value = '';
    document.getElementById('sched-calculated-dose').value = '';
    document.getElementById('sched-instructions').value = '';
    document.getElementById('sched-strength-display').innerHTML = '';
    document.getElementById('sched-units-display').innerText = '';
    const schedPrescriber = document.getElementById('sched-prescriber');
    if (schedPrescriber) schedPrescriber.value = '';
    const prnMax = document.getElementById('sched-prn-max-doses');
    if (prnMax) prnMax.value = '';
    const prnWindow = document.getElementById('sched-prn-window-hours');
    if (prnWindow) prnWindow.value = '24';
    renderFrequencyControls('sched');
};


async function getAdministrationStockPlan(med, sched) {
    const formulation = med.formulation || 'unit(s)';
    if (isTopicalMedication(med)) {
        return {
            qtyToSubtract: 0,
            logDetail: `Topical application; ${inventoryUnitFor(med)} inventory is reduced only when a container is marked finished`
        };
    }
    const specialFormulations = ['Cream', 'Ointment', 'Gel', 'Patch', 'Drops', 'Solution', 'Spray'];
    const isSpecial = specialFormulations.some(f => formulation.includes(f));

    if (isSpecial) {
        const decision = await showActionModal(`Stock Handling: ${med.name}`, `
            <div style="font-size:11px; margin-bottom:8px;">How should stock be handled for this ${escapeHtml(formulation)} administration?</div>
            <div class="field-row-stacked">
                <label><input name="stockAction" type="radio" value="logOnly" checked> Log dose only; do not reduce stock</label>
                <label><input name="stockAction" type="radio" value="removeContainer"> Log dose and remove 1 container from stock</label>
            </div>
        `, 'Continue');
        if (!decision) return null;
        if (decision.stockAction === 'removeContainer') {
            if (parseAmount(med.stock) < 1) {
                await appAlert("Insufficient stock to remove a container.");
                return null;
            }
            return { qtyToSubtract: 1, logDetail: `Dose applied; 1 ${formulation} container removed` };
        }
        return { qtyToSubtract: 0, logDetail: `Dose applied (${formulation})` };
    }

    const qtyToSubtract = parseAmount(sched.doseQty, 0);
    if (parseAmount(med.stock) < qtyToSubtract) {
        await appAlert(`Insufficient stock. You need ${formatAmount(qtyToSubtract)}, but only have ${formatAmount(parseAmount(med.stock))} left.`);
        return null;
    }
    return {
        qtyToSubtract,
        logDetail: `${formatAmount(qtyToSubtract)} ${formulation}`
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
        <label style="font-size:11px;"><input name="overrideConfirmed" type="checkbox" value="yes"> Confirm override and document the reason in the note.</label>
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
        stockDelta: isGivenDose ? stockPlan.qtyToSubtract : (isTopicalMedication(med) ? 0 : parseAmount(sched.doseQty, 0)),
        stockLogDetail: stockPlan.logDetail,
        details: `${doseStatusLabel(status)}; ${scheduledText}${stockPlan.logDetail} via ${sourceLabel}${overrideText}${noteText}`
    });

    if (sched.isOneTime) {
        db.schedules = db.schedules.filter(s => s.id !== sched.id);
    }
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
    if (Number.isFinite(saved) && (saved > 0 || isGivenStatus(entry.doseStatus) || isTopicalMedication(med))) return saved;
    if (!med || isTopicalMedication(med)) return 0;
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

    const administered = await administerScheduleRecord(sched, actual, sched.orderSetName ? `Order Set (${sched.orderSetName})` : 'Schedule');
    if (administered) await sync();
};

window.finishTopicalContainer = async function(scheduleId) {
    const schedule = db.schedules.find(item => item.id === scheduleId);
    const med = schedule && db.inventory.find(item => item.id === schedule.medId);
    if (!schedule || !med || !isTopicalMedication(med)) return;

    const defaults = defaultActualDateTime();
    const result = await showActionModal(`Finish Container: ${med.name}`, `
        <div style="font-size:11px; margin-bottom:8px;">Mark the topical container as finished. This is the only action that reduces topical inventory.</div>
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
        medName: med.name,
        scheduleId: schedule.id,
        doseStatus: 'container-finished',
        details: `${formatAmount(containers)} ${inventoryUnitFor(med)} marked finished; topical inventory reduced${result.note ? `; Note: ${result.note}` : ''}`
    });
    await sync();
};

window.administerOrderSet = async function(orderSetId) {
    const set = db.orderSets.find(orderSet => orderSet.id === orderSetId);
    if (!set) return;

    const schedules = db.schedules.filter(schedule => schedule.orderSetId === orderSetId);
    if (schedules.length === 0) {
        await appAlert("No active schedules were found for this order set.");
        return;
    }

    const medicationChoices = schedules.map((schedule, index) => {
        const med = db.inventory.find(m => m.id === schedule.medId);
        const label = med
            ? `${med.name} ${formatMedStrength(med)} - ${formatQtyForSchedule(schedule, med)}`
            : 'Unknown medication';
        const inputId = `admin-os-med-${index}`;
        return `<div class="field-row" style="margin-top:5px;">
            <input id="${inputId}" class="admin-os-med" name="scheduleIds" type="checkbox" value="${escapeHtml(schedule.id)}">
            <label for="${inputId}">${escapeHtml(label)}</label>
        </div>`;
    }).join('');

    const selection = await showActionModal(`Administer Order Set: ${set.name}`, `
        <div class="field-row-stacked" style="margin-top:8px;">
            <label>Medication(s) given:</label>
            <div class="sunken-panel" style="background:white; padding:6px; max-height:160px; overflow-y:auto;">
                <button type="button" onclick="adminOrderSetSubmitAll()">Administer all</button>
                <hr>
                ${medicationChoices}
            </div>
        </div>
    `, 'Administer Selected');
    if (!selection) return;

    const selectedIds = selection.scheduleIds || [];
    if (selectedIds.length === 0) {
        await appAlert("Select at least one medication that was given.");
        return;
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
        if (await administerScheduleRecord(schedule, actual, `Order Set (${set.name})`)) {
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
    if (!await appConfirm(`Discontinue ${medLabel}?`, 'Discontinue Order')) return;

    db.schedules = db.schedules.filter(s => s.id !== id);
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
    if (due < new Date()) return '#cc0000';
    return '#d26a00';
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
            if ((!memberId || schedule.memberId === memberId) && isScheduleDueOnDate(schedule, dateStr)) {
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
    if (stockUnitLabel) stockUnitLabel.innerText = isTopical ? 'containers:' : (formulation || 'unit(s)');
    if (topicalStockUnit) topicalStockUnit.style.display = isTopical ? 'inline-block' : 'none';
    if (topicalStockUnit && formulation === 'Topical Solution' && topicalStockUnit.value === 'tube') topicalStockUnit.value = 'bottle';
    if (topicalAdminUnitWrap) topicalAdminUnitWrap.style.display = isTopical ? 'inline-block' : 'none';
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
    div.innerHTML = `
        <input class="ing-name" type="text" placeholder="Name (e.g. APAP)" style="width:100px;">
        <input class="ing-strength" type="number" placeholder="Str" style="width:50px;">
        <select class="ing-unit" style="width:75px;">${unitOptions}</select>
        <button onclick="this.parentElement.remove()">X</button>
    `;
    container.appendChild(div);
};

function inventorySearchText(med) {
    return [
        med.name,
        formatMedStrength(med),
        med.units,
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
            <td>${med.units}</td>
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
        db.schedules.forEach(s => {
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
        calcDisplay.value = results.join(' / ');
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
    if (schedule.endDate && schedule.endDate !== 'Ongoing') return { start, end: schedule.endDate };
    const end = new Date();
    end.setDate(end.getDate() + 30);
    return { start, end: localDateKey(end) };
}

function medicationLabelHtml(schedule, med, member, doseDate, doseTimes) {
    const times = doseTimes.length > 0 ? doseTimes.join(', ') : 'PRN';
    const instructionLine = schedule.instructions
        ? `<div class="label-small"><b>Instructions:</b> ${escapeHtml(schedule.instructions)}</div>`
        : '';
    const labelClass = getLabelClass([
        med.name,
        formatMedStrength(med),
        formatPrescribedDose(med, schedule.doseQty),
        formatQtyForSchedule(schedule, med),
        `${member.firstName} ${member.lastName}`,
        schedule.instructions
    ], schedule.instructions ? 6 : 5);

    return `
        <div class="${labelClass}">
            <div class="label-date">${escapeHtml(doseDate)} | ${escapeHtml(times)}</div>
            <div class="label-title">${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))}</div>
            <div class="label-small">Dose: ${escapeHtml(formatPrescribedDose(med, schedule.doseQty))}</div>
            <div class="label-small"><b>Qty: ${escapeHtml(formatQtyForSchedule(schedule, med))}</b></div>
            <div class="label-small">Member: ${escapeHtml(`${member.firstName} ${member.lastName}`)}</div>
            ${instructionLine}
        </div>`;
}

window.printSingleLabel = async function(scheduleId) {
    const s = db.schedules.find(x => x.id === scheduleId);
    if (!s) return;
    const med = db.inventory.find(m => m.id === s.medId);
    const mem = db.family.find(f => f.id === s.memberId);
    if (!med || !mem) return;

    const range = getLabelSelectionRange(s);
    const instances = getScheduleInstancesInRange(s, range.start, range.end);
    if (instances.length === 0) {
        await appAlert("No scheduled doses were found for this order date range.");
        return;
    }

    const byDate = instances.reduce((acc, instance) => {
        if (!acc[instance.date]) acc[instance.date] = [];
        acc[instance.date].push(instance.time);
        return acc;
    }, {});
    const options = Object.entries(byDate).map(([date, times]) => {
        const sortedTimes = times.slice().sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
        const allOption = sortedTimes.length > 1
            ? `<option value="${escapeHtml(`${date}|ALL`)}">${escapeHtml(date)} - all doses (${escapeHtml(sortedTimes.join(', '))})</option>`
            : '';
        const timeOptions = sortedTimes.map(time => `<option value="${escapeHtml(`${date}|${time}`)}">${escapeHtml(date)} ${escapeHtml(time)}</option>`).join('');
        return allOption + timeOptions;
    }).join('');

    const result = await showActionModal(`Print Label: ${med.name}`, `
        <div class="field-row">
            <label>Dose:</label>
            <select name="labelDose" style="width:260px;">${options}</select>
        </div>
    `, 'Preview Label');
    if (!result?.labelDose) return;

    const [doseDate, doseTime] = result.labelDose.split('|');
    const doseTimes = doseTime === 'ALL'
        ? byDate[doseDate].slice().sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
        : [doseTime];
    previewLabelHtml(medicationLabelHtml(s, med, mem, doseDate, doseTimes));
};

window.printInventoryLabel = function(medId) {
    const med = db.inventory.find(m => m.id === medId);
    if (!med) return;

    const notesLine = med.notes ? `<div class="label-small"><b>Notes:</b> ${escapeHtml(med.notes)}</div>` : '';
    const labelClass = getLabelClass([
        med.name,
        formatMedStrength(med),
        med.stock,
        inventoryUnitFor(med),
        med.storage,
        med.expiry,
        med.controlLevel,
        med.notes
    ], med.notes ? 6 : 5);

    previewLabelHtml(`
        <div class="${labelClass}">
            <div class="label-title">${escapeHtml(med.name)} ${escapeHtml(formatMedStrength(med))}</div>
            <div class="label-small">On hand: ${escapeHtml(formatAmount(parseAmount(med.stock)))} ${escapeHtml(inventoryUnitFor(med))}</div>
            <div class="label-small">Storage: ${escapeHtml(med.storage || 'N/A')}</div>
            <div class="label-small">Exp: ${escapeHtml(med.expiry || 'N/A')} | Ctrl: ${escapeHtml(med.controlLevel || 'N/A')}</div>
            ${notesLine}
        </div>`);
};





window.printDateRangeLabels = function(memberId, startDate, endDate) {
    const mem = db.family.find(f => f.id === memberId);
    if (!mem) return;

    const start = parseLocal(startDate);
    const end = parseLocal(endDate);
    if (!start || !end || end < start) return alert("Enter a valid date range.");

    let labelCount = 0;
    let labelsHtml = '';
    const cursor = new Date(start);

    while (cursor <= end) {
        const yyyymmdd = localDateKey(cursor);

        const doseRows = collectMemberScheduleDoseRows(memberId, yyyymmdd, yyyymmdd);

        labelCount++;
        const labelClass = getLabelClass(
            doseRows.map(row => `${row.instance.time} ${row.med.name} ${formatMedStrength(row.med)} ${formatQtyForSchedule(row.schedule, row.med)}`),
            doseRows.length + 1
        );
        const medRowsHtml = doseRows.length > 0
            ? doseRows.map(row => {
                return `<div class="label-med-row">
                <b>${escapeHtml(row.instance.time)}</b>: ${escapeHtml(row.med.name)} ${escapeHtml(formatMedStrength(row.med))} (${escapeHtml(formatQtyForSchedule(row.schedule, row.med))})</div>`;
            }).join('')
            : '<div class="label-med-row">No scheduled medications</div>';

        labelsHtml += `
            <div class="${labelClass}">
                <div class="label-date">${cursor.toLocaleDateString()} - ${mem.firstName}</div>
                ${medRowsHtml}
            </div>`;
        cursor.setDate(cursor.getDate() + 1);
    }

    if (labelCount > 0) {
        previewLabelHtml(labelsHtml);
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
