const { app, BrowserWindow } = require('electron');
const path = require('path');
const { createLabelPrintSettings } = require('../print-settings');

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
    const errors = [];
    const win = new BrowserWindow({
        show: false,
        width: 1400,
        height: 900,
        webPreferences: { contextIsolation: false, nodeIntegration: false }
    });
    win.webContents.on('console-message', details => {
        if (Number(details.level) >= 2 && !String(details.message).includes('Electron Security Warning')) errors.push(String(details.message));
    });
    await win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
    await new Promise(resolve => setTimeout(resolve, 400));
    const printSettings = {
        landscape: createLabelPrintSettings({ width: 6, height: 4 }),
        portrait: createLabelPrintSettings({ width: 4, height: 6 }),
        tapsin: createLabelPrintSettings({
            width: 6,
            height: 4,
            deviceName: 'Tapsin T42',
            dpi: 203,
            thermal: true,
            copies: 1
        })
    };
    const result = await win.webContents.executeJavaScript(`(async () => {
        const formulationValues = Array.from(document.getElementById('med-formulation').options).map(option => option.value);
        const selectorsMatch = ['modal-formulation', 'recipe-formulation'].every(id => {
            const values = Array.from(document.getElementById(id).options).map(option => option.value);
            return formulationValues.every(value => values.includes(value));
        });
        const explicitPerDose = usesContainerTracking({ formulation: 'Nasal Spray', inventoryBehavior: 'per-dose' });
        const defaultContainer = usesContainerTracking({ formulation: 'Nasal Spray' });
        const pendingBeforeBuilder = pendingLabelHtml;
        localStorage.removeItem('pharmAtlasCustomLabelPrinter');
        localStorage.removeItem('pharmAtlasCustomLabelDpi');
        const originalGetPrinters = window.api.getPrinters;
        window.api.getPrinters = async () => [{ name: 'Tapsin T42', displayName: 'Tapsin T42', isDefault: false }];
        openCustomLabelBuilder();
        await new Promise(resolve => setTimeout(resolve, 80));
        const size = document.getElementById('custom-label-size');
        size.value = 'shipping-600-400';
        updateCustomLabelPreview();
        const values = customLabelValues();
        const page = document.querySelector('#custom-label-live-preview .custom-label-page');
        const pageStyle = getComputedStyle(page);
        const modalWindow = document.querySelector('.action-modal-window');
        const resizeMode = getComputedStyle(modalWindow).resize;
        const builder = document.querySelector('.custom-label-builder');
        const printToolbar = document.querySelector('.custom-label-print-toolbar');
        const maximizeButton = document.getElementById('action-modal-max');
        maximizeButton.click();
        const maximized = modalWindow.classList.contains('in-app-maximized');
        maximizeButton.click();
        const restored = !modalWindow.classList.contains('in-app-maximized');
        const layout = {
            width: values.size.width,
            height: values.size.height,
            previewWidth: Math.round(parseFloat(pageStyle.width)),
            previewHeight: Math.round(parseFloat(pageStyle.height)),
            caption: document.getElementById('custom-label-size-caption').textContent,
            printer: values.printerName,
            printerDpi: values.printerDpi,
            thermalPrinter: values.thermalPrinter,
            rotateButton: !!Array.from(document.querySelectorAll('.custom-label-print-setup button')).find(button => button.textContent.includes('Rotate')),
            resizeMode,
            builderOverflow: Math.max(0, builder.scrollWidth - builder.clientWidth),
            toolbarOverflow: Math.max(0, printToolbar.scrollWidth - printToolbar.clientWidth),
            modalInsideViewport: modalWindow.getBoundingClientRect().right <= innerWidth && modalWindow.getBoundingClientRect().bottom <= innerHeight,
            maximized,
            restored,
            overflowingElements: Array.from(builder.querySelectorAll('*')).filter(element => element.scrollWidth > element.clientWidth + 1).slice(0, 8).map(element => ({
                id: element.id,
                className: element.className,
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth
            }))
        };
        const livePreviewDidNotStagePrint = pendingLabelHtml === pendingBeforeBuilder;
        const previewHtml = customLabelHtml(values, false);
        let directPrintDetails = null;
        const originalPrintLabel = window.api.printLabel;
        window.api.printLabel = async details => {
            directPrintDetails = details;
            return { success: true };
        };
        await printCustomBuiltLabels();
        const directPrintPageCount = document.querySelectorAll('#print-area > .label-page').length;
        window.api.printLabel = originalPrintLabel;
        const directPrintSkippedPreview = document.getElementById('label-preview-modal').style.display === 'none';
        const directPrintButtonText = document.querySelector('.custom-label-print-button').textContent.trim();
        document.getElementById('action-modal-x').click();
        window.api.getPrinters = originalGetPrinters;
        previewLabelHtml(previewHtml);
        await new Promise(resolve => setTimeout(resolve, 40));
        const stagedPrintSize = { ...pendingLabelPrintSize };
        closeLabelPreview();
        await Promise.resolve(document.fonts?.ready);
        await new Promise(resolve => setTimeout(resolve, 20));
        const stalePreviewStayedClosed = pendingLabelHtml === '';
        return {
            formulationCount: formulationValues.length,
            addedForms: ['Extended-release Tablet', 'Metered-dose Inhaler', 'Infusion Bag', 'Eye Ointment', 'Vaginal Ring'].every(value => formulationValues.includes(value)),
            selectorsMatch,
            explicitPerDose,
            defaultContainer,
            layout,
            livePreviewDidNotStagePrint,
            stagedPrintSize,
            stalePreviewStayedClosed,
            directPrintDetails,
            directPrintPageCount,
            directPrintSkippedPreview,
            directPrintButtonText
        };
    })()`);
    console.log(JSON.stringify({ result, printSettings, errors }, null, 2));
    const failed = errors.length > 0
        || !result.addedForms
        || !result.selectorsMatch
        || result.explicitPerDose
        || !result.defaultContainer
        || result.layout.width !== 6
        || result.layout.height !== 4
        || !result.layout.caption.includes('6 x 4')
        || result.layout.printer !== 'Tapsin T42'
        || result.layout.printerDpi !== 203
        || !result.layout.thermalPrinter
        || !result.layout.rotateButton
        || result.layout.resizeMode !== 'both'
        || result.layout.builderOverflow > 1
        || result.layout.toolbarOverflow > 1
        || !result.layout.modalInsideViewport
        || !result.layout.maximized
        || !result.layout.restored
        || !result.livePreviewDidNotStagePrint
        || result.stagedPrintSize.width !== 6
        || result.stagedPrintSize.height !== 4
        || !result.stalePreviewStayedClosed
        || result.directPrintDetails.width !== 6
        || result.directPrintDetails.height !== 4
        || result.directPrintDetails.deviceName !== 'Tapsin T42'
        || result.directPrintDetails.dpi !== 203
        || !result.directPrintDetails.thermal
        || result.directPrintDetails.copies !== 1
        || result.directPrintPageCount !== 1
        || !result.directPrintSkippedPreview
        || result.directPrintButtonText !== 'Print'
        || !printSettings.landscape.landscape
        || printSettings.landscape.pageSize.width !== 4 * 25400
        || printSettings.landscape.pageSize.height !== 6 * 25400
        || printSettings.portrait.landscape
        || printSettings.portrait.pageSize.width !== 4 * 25400
        || printSettings.portrait.pageSize.height !== 6 * 25400
        || !printSettings.tapsin.silent
        || printSettings.tapsin.deviceName !== 'Tapsin T42'
        || printSettings.tapsin.color !== false
        || printSettings.tapsin.copies !== 1
        || printSettings.tapsin.duplexMode !== 'simplex'
        || printSettings.tapsin.dpi.horizontal !== 203
        || printSettings.tapsin.dpi.vertical !== 203;
    win.destroy();
    app.quit();
    if (failed) process.exitCode = 1;
}).catch(error => {
    console.error(error);
    app.quit();
    process.exitCode = 1;
});
