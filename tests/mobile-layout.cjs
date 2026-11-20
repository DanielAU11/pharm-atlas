const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const captureDir = process.argv.includes('--capture')
    ? path.join(__dirname, '..', '.qa', 'mobile-layout')
    : '';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function capture(win, name) {
    if (!captureDir) return;
    fs.mkdirSync(captureDir, { recursive: true });
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(captureDir, `${name}.png`), image.toPNG());
}

app.whenReady().then(async () => {
    const errors = [];
    const win = new BrowserWindow({
        show: false,
        frame: false,
        width: 393,
        height: 852,
        webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false }
    });
    win.webContents.on('console-message', details => {
        const level = typeof details.level === 'number' ? details.level : ({ error: 3, warning: 2 }[details.level] || 0);
        const message = String(details.message || '');
        if (level >= 2 && !message.includes('Electron Security Warning') && !message.includes('using deprecated parameters for the initialization function')) errors.push(message);
    });
    await win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
    await pause(350);
    const fixture = fs.readFileSync(path.join(__dirname, 'demo-fixture.js'), 'utf8');
    await win.webContents.executeJavaScript(`${fixture}\nwindow.installPharmAtlasDemoFixture()`);
    await win.webContents.executeJavaScript(`(async () => {
        localStorage.setItem('pharmAtlasMemberScheduleViewMode', 'grid');
        db.settings = { ...(db.settings || {}), memberScheduleViewMode: 'timeline' };
        await openMemberModal('demo-member');
        document.getElementById('member-modal').style.display = 'flex';
        switchMemberProfileTab('orders');
        closeMemberMedicationWorkPanel();
        const source = db.schedules.find(item => item.id === 'sched-lisinopril');
        if (source && !pendingScheduleOrders.some(item => item.modifySourceId === source.id)) {
            pendingScheduleOrders.push(scheduleDraftFromExisting(source, 'modify'));
        }
        renderMemberOrderWorklist('demo-member');
        renderMemberScheduleGrid('demo-member');
        true;
    })()`);
    await pause(180);
    await capture(win, 'member-profile-work-closed');
    const closed = await win.webContents.executeJavaScript(`(() => {
        const modal = document.getElementById('member-modal');
        const handle = modal.querySelector('.member-medication-work-handle');
        const body = modal.querySelector('.member-profile-body');
        const actions = modal.querySelector('.member-profile-save-actions');
        const actionRect = actions.getBoundingClientRect();
        const navRect = document.getElementById('mobile-bottom-nav').getBoundingClientRect();
        return {
            viewMode: memberScheduleViewMode(),
            gridVisible: getComputedStyle(document.getElementById('member-schedule-grid-view')).display !== 'none',
            handleVisible: getComputedStyle(handle).display !== 'none',
            handleCount: handle.querySelector('strong')?.textContent,
            bodyVisible: getComputedStyle(body).display !== 'none',
            reportsCollapsed: !modal.querySelector('.member-schedule-report-tools')?.open,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            memberActionsVisible: actionRect.top >= 0 && actionRect.bottom <= navRect.top + 1,
            memberActionButtons: actions.querySelectorAll('button').length
        };
    })()`);

    await win.webContents.executeJavaScript(`openMemberMedicationWorkPanel('demo-member'); true;`);
    await pause(220);
    await capture(win, 'member-profile-work-open');
    const open = await win.webContents.executeJavaScript(`(() => {
        const modal = document.getElementById('member-modal');
        const dock = modal.querySelector('.member-order-work-dock');
        const body = modal.querySelector('.member-profile-body');
        const rect = dock.getBoundingClientRect();
        return {
            open: modal.classList.contains('order-dock-open'),
            bodyVisible: getComputedStyle(body).display !== 'none',
            dockVisible: getComputedStyle(dock).visibility === 'visible',
            modalClass: modal.className,
            dockTransform: getComputedStyle(dock).transform,
            dockLeft: Math.round(rect.left),
            dockRight: Math.round(rect.right),
            dockWidth: Math.round(rect.width),
            viewportWidth: innerWidth,
            fitsViewport: rect.left >= 0 && rect.right <= innerWidth + 1
        };
    })()`);

    await win.webContents.executeJavaScript(`closeMemberMedicationWorkPanel(); true;`);
    await pause(220);
    await capture(win, 'member-profile-work-closed-after-open');

    await win.webContents.executeJavaScript(`(async () => {
        const schedule = db.schedules.find(item => item.id === 'sched-lisinopril');
        const instance = getScheduleInstancesForDate(schedule, schedule.startDate)[0];
        void openDoseInstanceActions(schedule.id, instance.date, instance.time);
        true;
    })()`);
    await pause(180);
    await capture(win, 'dose-action-sheet');
    const doseSheet = await win.webContents.executeJavaScript(`(() => {
        const modal = document.getElementById('action-modal');
        const sheet = modal.querySelector('.action-modal-window');
        const rect = sheet.getBoundingClientRect();
        return {
            visible: modal.style.display === 'flex',
            height: Math.round(rect.height),
            viewportHeight: innerHeight,
            compact: rect.height < innerHeight * 0.76,
            actions: modal.querySelectorAll('.dose-bar-action-picker button').length
        };
    })()`);
    await win.webContents.executeJavaScript(`document.getElementById('action-modal-cancel')?.click(); true;`);

    await win.webContents.executeJavaScript(`
        document.getElementById('member-modal').style.display = 'none';
        toggleMobileMore(true);
        true;
    `);
    await pause(100);
    await capture(win, 'more-sheet');
    const moreSheet = await win.webContents.executeJavaScript(`(() => {
        const sheet = document.getElementById('mobile-more-sheet');
        const rect = sheet.getBoundingClientRect();
        return {
            visible: !sheet.hidden,
            height: Math.round(rect.height),
            compact: rect.height < innerHeight * 0.58,
            buttons: sheet.querySelectorAll('.mobile-more-actions button').length
        };
    })()`);

    await win.webContents.executeJavaScript(`
        toggleMobileMore(false);
        switchTab('schedules');
        ensureMobileScheduleStepper();
        setMobileScheduleStep('timing');
        true;
    `);
    await pause(120);
    await capture(win, 'schedule-timing-step');
    const scheduleSteps = await win.webContents.executeJavaScript(`(() => {
        const panel = document.getElementById('panel-schedules');
        const stepper = panel.querySelector('.mobile-schedule-stepper');
        const active = Array.from(panel.querySelectorAll('[data-mobile-schedule-step].mobile-schedule-step-active'));
        return {
            buttons: stepper.querySelectorAll('button').length,
            selected: stepper.querySelector('button.active')?.dataset.mobileScheduleStepButton,
            activeGroups: active.length,
            wrongGroups: active.filter(element => element.dataset.mobileScheduleStep !== 'timing').length,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
    })()`);

    const bottomNavigation = await win.webContents.executeJavaScript(`(async () => {
        const scroller = document.querySelector('.app-panel-window > .window-body');
        const results = {};
        for (const tab of ['dashboard', 'schedules', 'family', 'vitals']) {
            scroller.scrollTop = 500;
            mobileSwitchTab(tab);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const panel = document.getElementById('panel-' + tab);
            results[tab] = {
                visible: getComputedStyle(panel).display !== 'none',
                active: document.querySelector('.mobile-bottom-nav button[data-mobile-tab="' + tab + '"]')?.classList.contains('active') === true,
                scrollTop: scroller.scrollTop,
                otherVisible: ['dashboard', 'schedules', 'family', 'vitals'].filter(other => other !== tab && getComputedStyle(document.getElementById('panel-' + other)).display !== 'none').length
            };
        }
        return results;
    })()`);

    const result = { closed, open, doseSheet, moreSheet, scheduleSteps, bottomNavigation, consoleErrors: errors };
    const failed = closed.viewMode !== 'grid' || !closed.gridVisible || !closed.handleVisible || closed.handleCount !== '1' ||
        !closed.bodyVisible || !closed.reportsCollapsed || closed.pageOverflow > 0 || !open.open || !open.bodyVisible || !open.dockVisible ||
        open.dockWidth >= open.viewportWidth || !open.fitsViewport || !doseSheet.visible || !doseSheet.compact ||
        doseSheet.actions !== 2 || !moreSheet.visible || !moreSheet.compact || moreSheet.buttons !== 4 ||
        scheduleSteps.buttons !== 3 || scheduleSteps.selected !== 'timing' || scheduleSteps.activeGroups < 1 ||
        scheduleSteps.wrongGroups > 0 || scheduleSteps.pageOverflow > 0 || !closed.memberActionsVisible || closed.memberActionButtons !== 2 ||
        Object.values(bottomNavigation).some(tab => !tab.visible || !tab.active || tab.scrollTop !== 0 || tab.otherVisible !== 0) || errors.length > 0;
    process.stdout.write(JSON.stringify(result, null, 2));
    win.destroy();
    app.exit(failed ? 1 : 0);
}).catch(error => {
    console.error(error);
    app.exit(1);
});
