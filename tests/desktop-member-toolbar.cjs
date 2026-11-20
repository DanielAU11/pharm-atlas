const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('disable-gpu');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
    const errors = [];
    const win = new BrowserWindow({
        show: false,
        width: 1500,
        height: 900,
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
        }
    });
    win.webContents.on('console-message', details => {
        const level = typeof details.level === 'number' ? details.level : ({ error: 3, warning: 2 }[details.level] || 0);
        const message = String(details.message || '');
        if (level >= 2 && !message.includes('Electron Security Warning')
            && !message.includes('using deprecated parameters for the initialization function')
            && !message.includes("No handler registered for 'load-db'")) errors.push(message);
    });
    await win.loadFile(path.join(__dirname, '..', 'index.html'));
    await pause(350);
    const fixture = fs.readFileSync(path.join(__dirname, 'demo-fixture.js'), 'utf8');
    await win.webContents.executeJavaScript(`${fixture}\nwindow.installPharmAtlasDemoFixture()`);
    await win.webContents.executeJavaScript(`(async () => {
        await openMemberModal('demo-member');
        document.getElementById('member-modal').style.display = 'flex';
        switchMemberProfileTab('orders');
        true;
    })()`);
    await pause(120);
    const toolbar = await win.webContents.executeJavaScript(`(() => {
        const tools = document.querySelector('#member-modal .member-schedule-report-tools');
        const buttons = Array.from(tools?.querySelectorAll('button') || []);
        return {
            mobileRuntime: document.documentElement.classList.contains('mobile-runtime'),
            open: tools?.open === true,
            buttonLabels: buttons.map(button => button.textContent.trim()),
            buttonsVisible: buttons.every(button => {
                const rect = button.getBoundingClientRect();
                return getComputedStyle(button).display !== 'none' && rect.width > 0 && rect.height > 0;
            })
        };
    })()`);
    await win.webContents.executeJavaScript(`(() => {
        const createButton = Array.from(document.querySelectorAll('.member-schedule-report-actions button'))
            .find(button => /create prepack/i.test(button.textContent));
        createButton?.click();
        return !!createButton;
    })()`);
    await pause(100);
    const workflow = await win.webContents.executeJavaScript(`(() => ({
        modalVisible: document.getElementById('action-modal').style.display === 'flex',
        title: document.querySelector('#action-modal .title-bar-text')?.textContent || '',
        selectableMedications: document.querySelectorAll('#action-modal input[name="scheduleIds"]').length
    }))()`);
    await win.webContents.executeJavaScript(`document.getElementById('action-modal-ok').click(); true;`);
    await pause(100);
    const groupingTitle = await win.webContents.executeJavaScript(`document.querySelector('#action-modal .title-bar-text')?.textContent || ''`);
    await win.webContents.executeJavaScript(`document.getElementById('action-modal-ok').click(); true;`);
    await pause(100);
    const scheduling = await win.webContents.executeJavaScript(`(() => ({
        title: document.querySelector('#action-modal .title-bar-text')?.textContent || '',
        hasDate: !!document.querySelector('#action-modal input[name="prepackDate"]'),
        hasTime: !!document.querySelector('#action-modal input[name="prepackTime"]'),
        confirmLabel: document.getElementById('action-modal-ok')?.textContent || ''
    }))()`);
    const result = { toolbar, workflow, groupingTitle, scheduling, consoleErrors: errors };
    const required = ['Create Prepack', 'Print Labels for Date Range', 'Schedule PDF', 'Email Schedule PDF'];
    const failed = toolbar.mobileRuntime || !toolbar.open || !toolbar.buttonsVisible ||
        required.some(label => !toolbar.buttonLabels.includes(label)) ||
        !workflow.modalVisible || !/choose medications/i.test(workflow.title) || workflow.selectableMedications < 1 || errors.length > 0;
    if (!/prepack label group/i.test(groupingTitle) || !/schedule prepack/i.test(scheduling.title)
        || !scheduling.hasDate || !scheduling.hasTime || !/add to queue/i.test(scheduling.confirmLabel)) process.exitCode = 1;
    process.stdout.write(JSON.stringify(result, null, 2));
    win.destroy();
    app.exit(failed || process.exitCode ? 1 : 0);
}).catch(error => {
    console.error(error);
    app.exit(1);
});
