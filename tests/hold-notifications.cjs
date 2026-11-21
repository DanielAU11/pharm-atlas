const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
    await win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
    await new Promise(resolve => setTimeout(resolve, 500));
    const result = await win.webContents.executeJavaScript(`(async () => {
        const scheduledBatches = [];
        window.__PHARMATLAS_NATIVE_TEST__ = true;
        window.PharmAtlasNativePlugins = window.PharmAtlasNativePlugins || {};
        window.PharmAtlasNativePlugins.LocalNotifications = {
            checkPermissions: async () => ({ display:'granted' }),
            requestPermissions: async () => ({ display:'granted' }),
            getPending: async () => ({ notifications:[] }),
            cancel: async () => true,
            schedule: async payload => { scheduledBatches.push(payload.notifications || []); return true; }
        };
        window.appAlert = async () => true;
        await window.enableIphoneReminders();
        scheduledBatches.length = 0;

        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowKey = localDateKey(tomorrow);
        const holdEnd = new Date(tomorrowKey + 'T12:00:00');
        const data = {
            family: [{ id:'member', firstName:'Test', lastName:'Member', notificationPrefs:{ medicationReminders:true } }],
            inventory: [
                { id:'finite-med', name:'Finite Hold Medicine', strength:'10', units:'mg' },
                { id:'indefinite-med', name:'Indefinite Hold Medicine', strength:'20', units:'mg' }
            ],
            schedules: [
                {
                    id:'finite', memberId:'member', medId:'finite-med', freq:'QD', startDate:tomorrowKey,
                    endDate:'Ongoing', times:['08:00','18:00'],
                    manualHold:{ active:true, untilAt:holdEnd.toISOString() }
                },
                {
                    id:'indefinite', memberId:'member', medId:'indefinite-med', freq:'QD', startDate:tomorrowKey,
                    endDate:'Ongoing', times:['09:00'], manualHold:{ active:true, untilAt:'' }
                }
            ],
            history:[], recipes:[], vitals:[], orderSets:[], prescribers:[], reminderLog:[], prepackQueues:[]
        };
        await window.api.save(data);
        const notifications = scheduledBatches.at(-1) || [];
        return notifications.map(item => ({
            kind:item.extra?.kind,
            scheduleId:item.extra?.scheduleId,
            at:new Date(item.schedule.at).toISOString()
        }));
    })()`);
    console.log(JSON.stringify(result, null, 2));
    const finiteResume = result.filter(item => item.kind === 'medication-resumed' && item.scheduleId === 'finite');
    const finiteDoses = result.filter(item => item.kind === 'medication' && item.scheduleId === 'finite');
    const indefiniteItems = result.filter(item => item.scheduleId === 'indefinite');
    const holdEnd = finiteResume.length ? new Date(finiteResume[0].at).getTime() : NaN;
    const failed = finiteResume.length !== 1
        || finiteDoses.length === 0
        || finiteDoses.some(item => new Date(item.at).getTime() <= holdEnd)
        || indefiniteItems.length !== 0;
    win.destroy();
    if (failed) process.exitCode = 1;
    app.quit();
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
});
