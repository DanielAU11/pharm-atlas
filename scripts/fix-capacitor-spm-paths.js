const fs = require('fs');
const path = require('path');

const packageFile = path.join(__dirname, '..', 'ios', 'App', 'CapApp-SPM', 'Package.swift');
if (!fs.existsSync(packageFile)) process.exit(0);

const source = fs.readFileSync(packageFile, 'utf8');
const normalized = source.replace(/(\.package\(name:\s*"[^"]+",\s*path:\s*")([^"]+)("\))/g, (_match, start, packagePath, end) => {
    return `${start}${packagePath.replace(/\\/g, '/')}${end}`;
});

if (normalized !== source) fs.writeFileSync(packageFile, normalized);

// Xcode 16+ diagnoses this imported-type/imported-protocol conformance unless
// the plugin explicitly acknowledges that it is retrospective. Keep the
// upstream package patch reproducible after every npm install and cap sync.
const scannerDecoderFile = path.join(
    __dirname,
    '..',
    'node_modules',
    '@capacitor',
    'barcode-scanner',
    'ios',
    'Sources',
    'CapacitorBarcodeScannerPlugin',
    'OSBARCScanParameters+Decodable.swift'
);
if (fs.existsSync(scannerDecoderFile)) {
    const scannerSource = fs.readFileSync(scannerDecoderFile, 'utf8');
    const patchedScannerSource = scannerSource.replace(
        'extension OSBARCScanParameters: Decodable {',
        'extension OSBARCScanParameters: @retroactive Decodable {'
    );
    if (patchedScannerSource !== scannerSource) fs.writeFileSync(scannerDecoderFile, patchedScannerSource);
}
