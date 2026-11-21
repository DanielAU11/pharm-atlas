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
        const medCard = modal.querySelector('.member-med-card');
        const medActions = medCard?.querySelector('.member-med-actions');
        const medCardRect = medCard?.getBoundingClientRect();
        return {
            mobileTitle: document.querySelector('.app-window > .title-bar .title-bar-text')?.textContent.trim(),
            viewMode: memberScheduleViewMode(),
            gridVisible: getComputedStyle(document.getElementById('member-schedule-grid-view')).display !== 'none',
            handleVisible: getComputedStyle(handle).display !== 'none',
            handleCount: handle.querySelector('strong')?.textContent,
            bodyVisible: getComputedStyle(body).display !== 'none',
            reportsCollapsed: !modal.querySelector('.member-schedule-report-tools')?.open,
            reportActionCount: modal.querySelectorAll('.member-schedule-report-actions button').length,
            hasCreatePrepack: Array.from(modal.querySelectorAll('.member-schedule-report-actions button')).some(button => /create prepack/i.test(button.textContent)),
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            memberSaveHidden: getComputedStyle(actions).display === 'none',
            memberActionButtons: actions.querySelectorAll('button').length,
            visibleProfileTabs: Array.from(modal.querySelectorAll('.member-profile-tab')).filter(button => getComputedStyle(button).display !== 'none').length,
            diaryTabHidden: getComputedStyle(modal.querySelector('[data-member-profile-tab="diary"]')).display === 'none',
            medicationCardFits: !!medCardRect && medCardRect.left >= 0 && medCardRect.right <= innerWidth + 1,
            medicationActionsCompact: !!medActions && getComputedStyle(medActions).flexWrap === 'nowrap' && medActions.scrollWidth >= medActions.clientWidth
        };
    })()`);

    await win.webContents.executeJavaScript(`openMemberMedicationWorkPanel('demo-member'); true;`);
    await pause(220);
    await capture(win, 'member-profile-work-open');
    const open = await win.webContents.executeJavaScript(`(() => {
        const modal = document.getElementById('member-modal');
        const dock = modal.querySelector('.member-order-work-dock');
        const body = modal.querySelector('.member-profile-body');
        const footer = dock.querySelector('.profile-orders-side-footer');
        const saveActions = modal.querySelector('.member-profile-save-actions');
        const rect = dock.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        const navRect = document.getElementById('mobile-bottom-nav').getBoundingClientRect();
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
            fitsViewport: rect.left >= 0 && rect.right <= innerWidth + 1,
            footerVisible: footerRect.top >= rect.top && footerRect.bottom <= navRect.top + 1,
            memberSaveHidden: getComputedStyle(saveActions).display === 'none'
        };
    })()`);

    await win.webContents.executeJavaScript(`closeMemberMedicationWorkPanel(); true;`);
    await pause(220);
    await capture(win, 'member-profile-work-closed-after-open');

    await win.webContents.executeJavaScript(`switchMemberProfileTab('summary'); true;`);
    await pause(120);
    await capture(win, 'member-profile-summary');
    const memberSummary = await win.webContents.executeJavaScript(`(() => {
        const modal = document.getElementById('member-modal');
        const table = modal.querySelector('.medication-summary-table');
        const firstRow = table?.querySelector('tbody tr');
        const firstCell = firstRow?.querySelector('td');
        return {
            tableOverflow: table ? table.scrollWidth - table.clientWidth : 0,
            rowOverflow: firstRow ? firstRow.scrollWidth - firstRow.clientWidth : 0,
            cards: getComputedStyle(firstRow).display === 'block',
            labels: firstCell?.dataset.label === 'Medication',
            saveHidden: getComputedStyle(modal.querySelector('.member-profile-save-actions')).display === 'none',
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
    })()`);

    await win.webContents.executeJavaScript(`switchMemberProfileTab('main'); true;`);
    await pause(100);
    await capture(win, 'member-profile-main');
    const memberMain = await win.webContents.executeJavaScript(`(() => {
        const actions = document.querySelector('#member-modal .member-profile-save-actions');
        const navRect = document.getElementById('mobile-bottom-nav').getBoundingClientRect();
        const rect = actions.getBoundingClientRect();
        return {
            saveVisible: getComputedStyle(actions).display !== 'none' && rect.top >= 0 && rect.bottom <= navRect.top + 1,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
    })()`);

    await win.webContents.executeJavaScript(`switchMemberProfileTab('orders'); true;`);

    await win.webContents.executeJavaScript(`(() => {
        setMemberScheduleViewMode('timeline');
        document.querySelector('#member-active-meds-list .member-med-card')?.scrollIntoView({ block: 'start' });
        return true;
    })()`);
    await pause(120);
    await capture(win, 'member-medication-cards');
    await win.webContents.executeJavaScript(`setMemberScheduleViewMode('grid'); true;`);

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

    await win.webContents.executeJavaScript(`
        switchTab('dashboard');
        setTodayDashboardFilter('attention');
        dashboardCalendarView = 'week';
        renderCalendar();
        document.getElementById('calendar-grid').closest('fieldset').scrollIntoView({ block: 'start' });
        true;
    `);
    await pause(120);
    await capture(win, 'calendar-week-agenda');
    const todayDashboard = await win.webContents.executeJavaScript(`(() => {
        const buttons = Array.from(document.querySelectorAll('#today-view-dashboard .today-filter-button'));
        const active = buttons.find(button => button.classList.contains('active'));
        const rows = Array.from(document.querySelectorAll('#today-view-dashboard .today-dose-row'));
        const validAttentionRows = rows.every(row => row.classList.contains('today-status-overdue') || row.classList.contains('today-status-soon') || row.classList.contains('today-status-exception'));
        setTodayDashboardFilter('all');
        return {
            buttons: buttons.length,
            actualButtons: buttons.every(button => button.tagName === 'BUTTON'),
            active: active?.textContent.includes('Attention') === true,
            validAttentionRows,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
    })()`);
    const weekCalendar = await win.webContents.executeJavaScript(`(() => {
        const grid = document.getElementById('calendar-grid');
        return {
            agenda: grid.classList.contains('calendar-mobile-agenda'),
            headers: grid.querySelectorAll(':scope > .calendar-header').length,
            days: grid.querySelectorAll(':scope > .calendar-day').length,
            dayHeadings: grid.querySelectorAll('.mobile-calendar-day-heading').length,
            overflow: grid.scrollWidth - grid.clientWidth
        };
    })()`);

    await win.webContents.executeJavaScript(`
        dashboardCalendarView = 'month';
        renderCalendar();
        document.getElementById('calendar-grid').closest('fieldset').scrollIntoView({ block: 'start' });
        true;
    `);
    await pause(120);
    await capture(win, 'calendar-month-compact');
    const monthCalendar = await win.webContents.executeJavaScript(`(() => {
        const grid = document.getElementById('calendar-grid');
        const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
        return {
            month: grid.classList.contains('calendar-month-view'),
            headers: grid.querySelectorAll(':scope > .calendar-header').length,
            days: grid.querySelectorAll(':scope > .calendar-day').length,
            columns,
            overflow: grid.scrollWidth - grid.clientWidth
        };
    })()`);

    await win.webContents.executeJavaScript(`
        switchTab('schedules');
        setMobileScheduleStep('medication');
        document.getElementById('select-member').value = 'demo-member';
        const input = document.getElementById('med-search-input');
        input.value = 'lis';
        handleScheduleMedicationSearchInput(true);
        true;
    `);
    await pause(180);
    await capture(win, 'schedule-medication-search');
    const medicationSearch = await win.webContents.executeJavaScript(`(() => {
        const input = document.getElementById('med-search-input');
        const results = document.getElementById('schedule-med-search-results');
        const first = results.querySelector('button[data-medication-name]');
        const customResultsVisible = !results.hidden;
        if (first) selectScheduleMedicationSearchResult(first.dataset.medicationName);
        return {
            customResultsVisible,
            resultCount: results.querySelectorAll('button[data-medication-name]').length,
            nativeDatalistRemoved: !input.hasAttribute('list'),
            selectedMedication: input.value,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
    })()`);

    await win.webContents.executeJavaScript(`
        switchTab('order-sets');
        ensureMobileRegimenStepper();
        setMobileRegimenStep('medications');
        if (!document.querySelector('#order-set-med-list .order-set-med-row')) addOrderSetMedicationRow();
        true;
    `);
    await pause(160);
    await capture(win, 'regimen-medications-step');
    const regimenPlanner = await win.webContents.executeJavaScript(`(() => {
        const fieldset = document.querySelector('.regimen-builder-fieldset');
        const active = Array.from(fieldset.querySelectorAll('[data-mobile-regimen-step].mobile-regimen-step-active'));
        const row = document.querySelector('.order-set-med-row');
        return {
            buttons: fieldset.querySelectorAll('[data-mobile-regimen-step-button]').length,
            selected: fieldset.querySelector('[data-mobile-regimen-step-button].active')?.dataset.mobileRegimenStepButton,
            activeGroups: active.length,
            wrongGroups: active.filter(element => element.dataset.mobileRegimenStep !== 'medications').length,
            rowOverflow: row ? row.scrollWidth - row.clientWidth : 0,
            pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
    })()`);

    await win.webContents.executeJavaScript(`setMobileRegimenStep('review'); true;`);
    await pause(120);
    await capture(win, 'regimen-review-step');
    const regimenReview = await win.webContents.executeJavaScript(`(() => {
        const preview = document.querySelector('.regimen-preview-side');
        const rect = preview.getBoundingClientRect();
        return {
            selected: document.querySelector('[data-mobile-regimen-step-button].active')?.dataset.mobileRegimenStepButton,
            visible: getComputedStyle(preview).display !== 'none',
            fitsViewport: rect.left >= 0 && rect.right <= innerWidth + 1,
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

    const result = { closed, open, memberSummary, memberMain, doseSheet, moreSheet, scheduleSteps, todayDashboard, weekCalendar, monthCalendar, medicationSearch, regimenPlanner, regimenReview, bottomNavigation, consoleErrors: errors };
    const failed = closed.mobileTitle !== 'PharmAtlas Mobile' || closed.viewMode !== 'grid' || !closed.gridVisible || !closed.handleVisible || closed.handleCount !== '1' ||
        !closed.bodyVisible || !closed.reportsCollapsed || closed.reportActionCount !== 4 || !closed.hasCreatePrepack || closed.pageOverflow > 0 || !closed.medicationCardFits || !closed.medicationActionsCompact || !open.open || !open.bodyVisible || !open.dockVisible ||
        open.dockWidth >= open.viewportWidth || !open.fitsViewport || !open.footerVisible || !open.memberSaveHidden || !doseSheet.visible || !doseSheet.compact ||
        doseSheet.actions !== 2 || !moreSheet.visible || !moreSheet.compact || moreSheet.buttons !== 4 ||
        scheduleSteps.buttons !== 3 || scheduleSteps.selected !== 'timing' || scheduleSteps.activeGroups < 1 ||
        scheduleSteps.wrongGroups > 0 || scheduleSteps.pageOverflow > 0 || !closed.memberSaveHidden || closed.memberActionButtons !== 2 || closed.visibleProfileTabs !== 4 || !closed.diaryTabHidden ||
        memberSummary.tableOverflow > 0 || memberSummary.rowOverflow > 0 || !memberSummary.cards || !memberSummary.labels || !memberSummary.saveHidden || memberSummary.pageOverflow > 0 ||
        !memberMain.saveVisible || memberMain.pageOverflow > 0 ||
        todayDashboard.buttons !== 6 || !todayDashboard.actualButtons || !todayDashboard.active || !todayDashboard.validAttentionRows || todayDashboard.pageOverflow > 0 ||
        !weekCalendar.agenda || weekCalendar.headers !== 0 || weekCalendar.days !== 7 || weekCalendar.dayHeadings !== 7 || weekCalendar.overflow > 0 ||
        !monthCalendar.month || monthCalendar.headers !== 7 || monthCalendar.days < 35 || monthCalendar.columns !== 7 || monthCalendar.overflow > 0 ||
        !medicationSearch.customResultsVisible || medicationSearch.resultCount < 1 || !medicationSearch.nativeDatalistRemoved || !medicationSearch.selectedMedication || medicationSearch.overflow > 0 ||
        regimenPlanner.buttons !== 3 || regimenPlanner.selected !== 'medications' || regimenPlanner.activeGroups < 2 || regimenPlanner.wrongGroups > 0 ||
        regimenPlanner.rowOverflow > 0 || regimenPlanner.pageOverflow > 0 ||
        regimenReview.selected !== 'review' || !regimenReview.visible || !regimenReview.fitsViewport || regimenReview.pageOverflow > 0 ||
        Object.values(bottomNavigation).some(tab => !tab.visible || !tab.active || tab.scrollTop !== 0 || tab.otherVisible !== 0) || errors.length > 0;
    process.stdout.write(JSON.stringify(result, null, 2));
    win.destroy();
    app.exit(failed ? 1 : 0);
}).catch(error => {
    console.error(error);
    app.exit(1);
});
