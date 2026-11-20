const http = require('http');
const { app, BrowserWindow } = require('electron');

require('../main.js');

function waitForWindow() {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const check = () => {
            const window = BrowserWindow.getAllWindows()[0];
            if (window && !window.webContents.isLoading()) return resolve(window);
            if (Date.now() - started > 10000) return reject(new Error('PharmAtlas window did not become ready.'));
            setTimeout(check, 50);
        };
        check();
    });
}

function requestPing(info) {
    return new Promise((resolve, reject) => {
        const request = http.get({
            hostname: info.host,
            port: info.port,
            path: '/pharmatlas-sync/ping',
            headers: { Origin: 'capacitor://localhost' },
            timeout: 5000
        }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve({
                status: response.statusCode,
                origin: response.headers['access-control-allow-origin'],
                body: JSON.parse(body)
            }));
        });
        request.on('timeout', () => request.destroy(new Error('Connectivity ping timed out.')));
        request.on('error', reject);
    });
}

app.whenReady().then(async () => {
    const window = await waitForWindow();
    const info = await window.webContents.executeJavaScript('window.api.startLocalSync()');
    if (!info?.available) throw new Error(info?.error || 'Local sync endpoint is unavailable.');
    const payloadHosts = new URL(info.pairingPayload).searchParams.getAll('host');
    if (payloadHosts[0] !== info.host || info.addresses.some(address => !payloadHosts.includes(address))) {
        throw new Error(`Pairing payload did not include every desktop address: ${JSON.stringify({ payloadHosts, addresses: info.addresses })}`);
    }
    const ping = await requestPing(info);
    if (ping.status !== 200 || ping.origin !== 'capacitor://localhost' || ping.body?.deviceId !== info.deviceId || ping.body?.protocol !== 1) {
        throw new Error(`Unexpected connectivity response: ${JSON.stringify(ping)}`);
    }
    await window.webContents.executeJavaScript('window.api.stopLocalSync()');
    process.stdout.write(JSON.stringify({ host: info.host, port: info.port, addresses: info.addresses, payloadHosts, ping }, null, 2));
    app.isQuiting = true;
    window.destroy();
    app.quit();
}).catch(error => {
    console.error(error);
    app.isQuiting = true;
    BrowserWindow.getAllWindows().forEach(window => window.destroy());
    app.exit(1);
});
