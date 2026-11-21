const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
    await win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
    await new Promise(resolve => setTimeout(resolve, 400));
    const result = await win.webContents.executeJavaScript(`(() => {
        const now = new Date(2026, 10, 19, 19, 45, 0, 0);
        const base = { id:'test', memberId:'m', medId:'x', freq:'BID', startDate:'2026-11-17', endDate:'Ongoing', times:['09:00','21:00'] };
        const remaining = normalizeNewScheduleStart(structuredClone(base), 'remaining', now);
        const includeNow = normalizeNewScheduleStart({ ...structuredClone(base), includeTodayTime:'20:15' }, 'include-now', now);
        const tomorrow = normalizeNewScheduleStart(structuredClone(base), 'next-day', now);
        const startPreview = scheduleStartCalendarPreviewHtml({ ...base, startDate:'2026-11-19' }, 'remaining', now);
        const onceHidden = !scheduleStartBehaviorIsRelevant({ ...base, freq:'ONCE' }, now);
        const prnHidden = !scheduleStartBehaviorIsRelevant({ ...base, freq:'PRN', prnScheduleFreq:'BID' }, now);
        const regimenDoseEnd = regimenEndDateForDoseCount({
            id: 'regimen-test',
            name: 'Regimen duration test',
            items: [{ medId:'x', doseQty:1, freq:'BID', times:['09:00','21:00'], startTime:'09:00', cycleStartDay:1 }]
        }, 'm', '2026-11-19', 3);
        const sizes = calculateClinicalBodySizes(70, 'in', 220, 'lb', 'Male');
        const finiteHold = {
            ...structuredClone(base),
            manualHold: { active:true, untilAt:new Date(2026, 10, 19, 20, 0, 0, 0).toISOString() }
        };
        const indefiniteHold = { ...structuredClone(base), manualHold: { active:true, untilAt:'' } };
        return {
            remaining,
            includeNow,
            tomorrow,
            startPreview,
            onceHidden,
            prnHidden,
            regimenDoseEnd,
            sizes,
            finiteHoldBeforeEnd: medicationReminderIsHeld(finiteHold, new Date(2026, 10, 19, 19, 59, 0, 0)),
            finiteHoldAfterEnd: medicationReminderIsHeld(finiteHold, new Date(2026, 10, 19, 20, 1, 0, 0)),
            indefiniteHoldActive: medicationReminderIsHeld(indefiniteHold, new Date(2027, 0, 1, 0, 0, 0, 0)),
            remainingInstances: getBaseScheduleInstancesForDate(remaining, '2026-11-19').map(item => item.time)
        };
    })()`);
    console.log(JSON.stringify(result, null, 2));
    const failed = result.remaining.startDate !== '2026-11-19'
        || JSON.stringify(result.remaining.firstDayTimes) !== JSON.stringify(['21:00'])
        || JSON.stringify(result.remainingInstances) !== JSON.stringify(['21:00'])
        || result.includeNow.includeTodayTime !== '20:15'
        || result.includeNow.firstDayTimes[0] !== '20:15'
        || result.includeNow.firstDayTimes.length !== 2
        || result.includeNow.firstDayTimes[1] !== '21:00'
        || result.tomorrow.startDate !== '2026-11-20'
        || !result.startPreview.includes('21:00')
        || !result.onceHidden
        || !result.prnHidden
        || result.regimenDoseEnd !== '2026-11-20'
        || !result.finiteHoldBeforeEnd
        || result.finiteHoldAfterEnd
        || !result.indefiniteHoldActive
        || !result.sizes.ibw || !result.sizes.adjustedWeight || !result.sizes.bsa;
    win.destroy();
    if (failed) process.exitCode = 1;
    app.quit();
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
});
