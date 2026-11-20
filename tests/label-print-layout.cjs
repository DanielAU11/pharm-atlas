const { app, BrowserWindow } = require('electron');
const path = require('path');
const { createLabelPrintSettings } = require('../print-settings');

app.commandLine.appendSwitch('disable-gpu');

function pdfMetrics(buffer) {
    const source = buffer.toString('latin1');
    const pageCount = (source.match(/\/Type\s*\/Page(?!s)\b/g) || []).length;
    const mediaBox = source.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    return {
        pageCount,
        widthPoints: mediaBox ? Number(mediaBox[1]) : 0,
        heightPoints: mediaBox ? Number(mediaBox[2]) : 0
    };
}

async function renderLabelPdf(win, width, height) {
    await win.webContents.executeJavaScript(`(() => {
        document.documentElement.style.setProperty('--print-label-width', '${width}in');
        document.documentElement.style.setProperty('--print-label-height', '${height}in');
        const printArea = document.getElementById('print-area');
        printArea.innerHTML = '<div class="label-page custom-label-page" style="--custom-label-width:${width}in;--custom-label-height:${height}in"><div class="label-title">Physical size test</div><div class="label-small">One label, one sheet</div></div>';
        printArea.style.display = 'block';
    })()`);
    const settings = createLabelPrintSettings({ width, height });
    const pdf = await win.webContents.printToPDF({
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: {
            width: settings.pageSize.width / 25400,
            height: settings.pageSize.height / 25400
        },
        landscape: settings.landscape,
        preferCSSPageSize: false
    });
    return { metrics: pdfMetrics(pdf), pdf };
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: false,
        width: 1200,
        height: 800,
        webPreferences: { contextIsolation: false, nodeIntegration: false }
    });
    await win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));
    await new Promise(resolve => setTimeout(resolve, 350));
    const landscapeResult = await renderLabelPdf(win, 6, 4);
    const portraitResult = await renderLabelPdf(win, 4, 6);
    const landscape = landscapeResult.metrics;
    const portrait = portraitResult.metrics;
    const sourceDataUrl = `data:application/pdf;base64,${portraitResult.pdf.toString('base64')}`;
    const flattened = await win.webContents.executeJavaScript(`(async () => {
        const result = await flattenCustomLabelPdf(${JSON.stringify(sourceDataUrl)});
        const image = new Image();
        image.src = result.dataUrl;
        await image.decode();
        return {
            pageCount: result.pageCount,
            type: result.dataUrl.slice(0, 22),
            width: image.naturalWidth,
            height: image.naturalHeight
        };
    })()`);
    console.log(JSON.stringify({ landscape, portrait, flattened }, null, 2));
    const closeTo = (actual, expected) => Math.abs(actual - expected) < 1;
    const failed = landscape.pageCount !== 1
        || portrait.pageCount !== 1
        || !closeTo(landscape.widthPoints, 432)
        || !closeTo(landscape.heightPoints, 288)
        || !closeTo(portrait.widthPoints, 288)
        || !closeTo(portrait.heightPoints, 432)
        || flattened.pageCount !== 1
        || flattened.type !== 'data:image/png;base64,'
        || flattened.width < 1000
        || flattened.height < 1000;
    win.destroy();
    if (failed) process.exitCode = 1;
    app.quit();
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
    app.quit();
});
