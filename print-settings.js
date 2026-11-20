function createLabelPrintSettings(details = {}) {
    const widthInches = Number(details.width);
    const heightInches = Number(details.height);
    if (!Number.isFinite(widthInches) || !Number.isFinite(heightInches) || widthInches < 0.5 || heightInches < 0.5 || widthInches > 20 || heightInches > 20) {
        throw new Error('Choose a label size between 0.5 and 20 inches.');
    }
    const deviceName = String(details.deviceName || '').trim();
    const copies = Math.max(1, Math.min(99, Math.trunc(Number(details.copies)) || 1));
    const dpi = Math.max(0, Math.trunc(Number(details.dpi)) || 0);
    const settings = {
        silent: !!deviceName,
        printBackground: true,
        margins: { marginType: 'none' },
        pageSize: {
            width: Math.round(widthInches * 25400),
            height: Math.round(heightInches * 25400)
        },
        // The custom page dimensions already describe the final orientation.
        // Asking a thermal driver to rotate them again reverses portrait/landscape.
        landscape: false,
        scaleFactor: 100,
        pagesPerSheet: 1,
        copies,
        collate: false,
        duplexMode: 'simplex'
    };
    if (deviceName) settings.deviceName = deviceName;
    if (details.thermal) settings.color = false;
    if (dpi) settings.dpi = { horizontal: dpi, vertical: dpi };
    return settings;
}

module.exports = { createLabelPrintSettings };
