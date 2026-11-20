(function preparePharmAtlasNativePlugins() {
    window.PharmAtlasNativePlugins = window.PharmAtlasNativePlugins || {};

    window.getPharmAtlasNativePlugin = function(name) {
        if (window.PharmAtlasNativePlugins[name]) return window.PharmAtlasNativePlugins[name];
        if (window.Capacitor?.Plugins?.[name]) {
            window.PharmAtlasNativePlugins[name] = window.Capacitor.Plugins[name];
            return window.PharmAtlasNativePlugins[name];
        }
        const registerPlugin = window.Capacitor?.registerPlugin;
        if (typeof registerPlugin !== 'function') return null;
        window.PharmAtlasNativePlugins[name] = registerPlugin(name);
        return window.PharmAtlasNativePlugins[name];
    };

    window.getPharmAtlasNativePlugin('CapacitorBarcodeScanner');
    window.getPharmAtlasNativePlugin('LocalNotifications');
})();
