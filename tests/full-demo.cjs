const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valueAfter = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : '';
};
const device = valueAfter('--device') || 'desktop';
const captureDir = valueAfter('--capture-dir');
const deviceConfig = device === 'iphone'
    ? { width: 393, height: 852, scale: 3 }
    : (device === 'ipad' ? { width: 1032, height: 1376, scale: 2 } : { width: 1280, height: 900, scale: 1 });

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

async function capture(win, name) {
    if (!captureDir) return null;
    if (!win.isVisible()) {
        win.setOpacity(0);
        win.showInactive();
    }
    win.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 260));
    const captured = await win.webContents.capturePage();
    const image = deviceConfig.scale === 1 ? captured : captured.resize({
        width: deviceConfig.width * deviceConfig.scale,
        height: deviceConfig.height * deviceConfig.scale,
        quality: 'best'
    });
    fs.mkdirSync(captureDir, { recursive: true });
    const output = path.join(captureDir, `${device}-${name}.png`);
    fs.writeFileSync(output, image.toPNG());
    return { output, size: image.getSize() };
}

app.whenReady().then(async () => {
    const errors = [];
    const win = new BrowserWindow({
        show: false,
        frame: false,
        width: deviceConfig.width,
        height: deviceConfig.height,
        enableLargerThanScreen: true,
        webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false }
    });
    win.webContents.on('console-message', details => {
        const text = String(details.message || '');
        const level = typeof details.level === 'number' ? details.level : ({ error: 3, warning: 2 }[details.level] || 0);
        if (level >= 2 && !text.includes('Electron Security Warning') && !text.includes('using deprecated parameters for the initialization function')) errors.push(text);
    });
    await win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
    await new Promise(resolve => setTimeout(resolve, 450));
    const fixtureSource = fs.readFileSync(path.join(__dirname, 'demo-fixture.js'), 'utf8');
    await win.webContents.executeJavaScript(`${fixtureSource}\nwindow.installPharmAtlasDemoFixture()`);

    const logic = await win.webContents.executeJavaScript(`(async () => {
        const qod = db.schedules.find(item => item.id === 'sched-qod');
        const originalDates = [];
        for (let offset = 0; offset < 12; offset += 1) {
            const date = addDaysKey(qod.startDate, offset);
            getScheduleInstancesForDate(qod, date).forEach(instance => originalDates.push(instance));
        }
        const selected = originalDates[1];
        const movedDate = addDaysKey(selected.date, 1);
        upsertFutureDoseShift(qod, selected.date, selected.time, movedDate, '11:30', 'Demo future retime');
        const afterDates = [];
        for (let offset = 0; offset < 14; offset += 1) {
            const date = addDaysKey(qod.startDate, offset);
            getScheduleInstancesForDate(qod, date).forEach(instance => afterDates.push(instance));
        }
        const pastPreserved = afterDates.some(instance => instance.date === originalDates[0].date && instance.time === originalDates[0].time);
        const qodFutureMoved = afterDates.some(instance => instance.date === movedDate && instance.time === '11:30') &&
            afterDates.some(instance => instance.date === addDaysKey(movedDate, 2) && instance.time === '11:30');

        pendingScheduleOrders = [];
        const primary = scheduleDraftFromExisting(db.schedules.find(item => item.id === 'sched-lisinopril'), 'modify');
        primary.times = ['09:15']; primary.startTime = '09:15'; pendingScheduleOrders.push(primary);
        const linkedDrafts = stageLinkedTimingDrafts(primary);

        const tabs = ['dashboard','schedules','prepackage','order-sets','vitals','inventory','recipes','family','drug-info','help'];
        const panels = {};
        tabs.forEach(tab => {
            switchTab(tab);
            const panel = document.getElementById('panel-' + tab);
            panels[tab] = !!panel && panel.textContent.trim().length > 0;
        });
        switchTab('dashboard');
        const inlineCalls = new Set();
        document.querySelectorAll('[onclick]').forEach(element => {
            const source = element.getAttribute('onclick') || '';
            for (const match of source.matchAll(/(?<![\\w.])([A-Za-z_$][\\w$]*)\\s*\\(/g)) {
                if (!['if','for','while','switch'].includes(match[1])) inlineCalls.add(match[1]);
            }
        });
        const unresolvedButtons = [...inlineCalls].filter(name => typeof window[name] !== 'function');
        const returnTestDay = db.prepackQueues[0]?.days?.[0];
        const returnTestItem = returnTestDay?.items?.find(item => item.scheduleId !== 'sched-lisinopril');
        if (returnTestItem) {
            returnTestItem.status = 'correct';
            returnTestItem.inventoryDeducted = true;
            returnTestItem.stockDelta = prepackItemDoseQty(db.prepackQueues[0], returnTestItem);
        }
        const saved = await window.api.save(db);
        const loaded = await window.api.load();
        const qr = medicationQrDataUrl('PA-DEMO-QR-CHECK');
        const scheduleCountBeforeCheckboxAudit = db.schedules.length;
        const checkboxTemplate = db.schedules.find(item => item.id === 'sched-lisinopril') || db.schedules[0];
        for (let index = 0; index < 16; index += 1) {
            db.schedules.push({
                ...JSON.parse(JSON.stringify(checkboxTemplate)),
                id: 'checkbox-layout-audit-' + index,
                orderSetId: '',
                orderSetName: '',
                startDate: qod.startDate,
                endDate: addDaysKey(qod.startDate, 30)
            });
        }
        const checkboxPickerPromise = chooseDateRangeLabelSchedules(
            checkboxTemplate.memberId,
            qod.startDate,
            addDaysKey(qod.startDate, 14)
        );
        await new Promise(resolve => setTimeout(resolve, 30));
        const checkboxList = document.querySelector('#action-modal-body .label-selection-list');
        const checkboxInputs = [...(checkboxList?.querySelectorAll('input[type="checkbox"]') || [])];
        const visibleFixedCheckboxes = checkboxInputs.filter(input => {
            const style = getComputedStyle(input);
            return Number(style.opacity || 0) > 0.01 && style.visibility !== 'hidden' && style.position === 'fixed';
        });
        const checkboxLayout = {
            rendered: checkboxInputs.length >= 16,
            scrollable: !!checkboxList && checkboxList.scrollHeight > checkboxList.clientHeight,
            visibleFixedCount: visibleFixedCheckboxes.length,
            contained: getComputedStyle(checkboxList).contain.includes('paint')
        };
        document.getElementById('action-modal-cancel')?.click();
        await checkboxPickerPromise;
        db.schedules.splice(scheduleCountBeforeCheckboxAudit);
        return {
            qodOriginalDates: originalDates.slice(0, 4).map(item => item.date + ' ' + item.time),
            qodAfterDates: afterDates.slice(0, 5).map(item => item.date + ' ' + item.time),
            pastPreserved, qodFutureMoved,
            linkedDraftCount: linkedDrafts.length,
            linkedTimeAligned: linkedDrafts.every(item => item.times[0] === '09:15'),
            panels,
            unresolvedButtons,
            inventoryRows: document.querySelectorAll('#inventory-table-body tr').length,
            scheduleRows: db.schedules.length,
            prepackReturnable: returnablePrepackItems().length,
            barcodeRendered: typeof qr === 'string' && qr.startsWith('data:image/'),
            persistence: saved === true && loaded.family?.[0]?.id === 'demo-member',
            checkboxLayout,
            mobileRuntime: document.documentElement.classList.contains('mobile-runtime'),
            mobileCompanionPanel: !!document.getElementById('mobile-companion-panel'),
            simplifiedMobileNavigation: document.getElementById('tab-prepackage')?.hidden === true && document.getElementById('tab-recipes')?.hidden === true,
            mobileUiState: {
                classes: document.documentElement.className,
                title: document.querySelector('.app-window > .title-bar .title-bar-text')?.textContent,
                companionDisplay: getComputedStyle(document.getElementById('mobile-companion-panel')).display,
                desktopSyncDisplay: getComputedStyle(document.getElementById('desktop-device-sync-button')).display
            },
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            renderErrors: [...document.querySelectorAll('.render-error')].map(item => item.textContent.trim())
        };
    })()`);

    const screenshots = [];
    if (captureDir) {
        if (fs.existsSync(captureDir)) fs.rmSync(captureDir, { recursive: true, force: true });
        const states = [
            ['dashboard', `switchTab('dashboard'); window.scrollTo(0,0);`],
            ['schedule', `switchTab('schedules'); window.scrollTo(0,0);`],
            ['monitoring', `switchTab('vitals'); window.scrollTo(0,0);`],
            ['inventory', `switchTab('inventory'); window.scrollTo(0,0);`],
            ['members', `switchTab('family'); window.scrollTo(0,0);`]
        ];
        for (const [name, command] of states) {
            await win.webContents.executeJavaScript(command);
            screenshots.push(await capture(win, name));
        }
    }

    const failed = !logic.pastPreserved || !logic.qodFutureMoved || !logic.linkedTimeAligned ||
        Object.values(logic.panels).some(value => !value) || logic.unresolvedButtons.length > 0 ||
        logic.inventoryRows < 5 || logic.scheduleRows < 6 || logic.prepackReturnable < 1 ||
        !logic.barcodeRendered || !logic.persistence || !logic.mobileCompanionPanel || !logic.simplifiedMobileNavigation ||
        !logic.checkboxLayout?.rendered || !logic.checkboxLayout?.scrollable || !logic.checkboxLayout?.contained || logic.checkboxLayout?.visibleFixedCount > 0 ||
        logic.overflow > 0 || logic.renderErrors.length > 0 || errors.length > 0;
    process.stdout.write(JSON.stringify({ device, logic, screenshots, consoleErrors: errors }, null, 2));
    win.destroy();
    app.exit(failed ? 1 : 0);
}).catch(error => {
    console.error(error);
    app.exit(1);
});
