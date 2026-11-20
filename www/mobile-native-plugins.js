(function registerPharmAtlasNativePlugins() {
    const registerPlugin = window.Capacitor?.registerPlugin;
    if (typeof registerPlugin !== 'function') return;

    window.PharmAtlasNativePlugins = {
        CapacitorBarcodeScanner: registerPlugin('CapacitorBarcodeScanner'),
        LocalNotifications: registerPlugin('LocalNotifications')
    };
})();
