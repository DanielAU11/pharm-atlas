const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageSwiftPath = path.join(root, 'ios', 'App', 'CapApp-SPM', 'Package.swift');
const packageSwift = fs.readFileSync(packageSwiftPath, 'utf8');
const expected = packageJson.dependencies['@capacitor/ios'];
const swiftVersion = packageSwift.match(/capacitor-swift-pm\.git", exact: "([^"]+)"/)?.[1];
const packageNames = [
  '@capacitor/core',
  '@capacitor/ios',
  '@capacitor/cli',
  '@capacitor/local-notifications',
  '@capacitor/barcode-scanner'
];

const nativeBundleChecks = [
  {
    file: path.join(root, 'ios', 'App', 'App', 'public', 'vendor', 'capacitor.js'),
    message: 'Missing the Capacitor browser bridge in the native bundle. Run npm run cap:sync.'
  },
  {
    file: path.join(root, 'ios', 'App', 'App', 'PrivacyInfo.xcprivacy'),
    message: 'Missing the app privacy manifest from the iOS target.'
  }
];

let failed = false;
for (const packageName of packageNames) {
  const manifestVersion = packageJson.dependencies[packageName] || packageJson.devDependencies[packageName];
  const installedManifest = path.join(root, 'node_modules', packageName, 'package.json');
  if (!fs.existsSync(installedManifest)) {
    console.error(`Missing ${packageName}. Run npm ci.`);
    failed = true;
    continue;
  }
  const installedVersion = JSON.parse(fs.readFileSync(installedManifest, 'utf8')).version;
  if (manifestVersion !== installedVersion) {
    console.error(`${packageName}: package.json=${manifestVersion}, installed=${installedVersion}`);
    failed = true;
  } else {
    console.log(`${packageName}: ${installedVersion}`);
  }
}

if (swiftVersion !== expected) {
  console.error(`capacitor-swift-pm: Package.swift=${swiftVersion || 'missing'}, expected=${expected}`);
  failed = true;
} else {
  console.log(`capacitor-swift-pm: ${swiftVersion}`);
}

for (const check of nativeBundleChecks) {
  if (!fs.existsSync(check.file)) {
    console.error(check.message);
    failed = true;
  }
}

const nativeIndexPath = path.join(root, 'ios', 'App', 'App', 'public', 'index.html');
const nativeIndex = fs.existsSync(nativeIndexPath) ? fs.readFileSync(nativeIndexPath, 'utf8') : '';
const bridgePosition = nativeIndex.indexOf('vendor/capacitor.js');
const pluginPosition = nativeIndex.indexOf('mobile-native-plugins.js');
if (bridgePosition < 0 || pluginPosition < 0 || bridgePosition > pluginPosition) {
  console.error('The native bundle must load vendor/capacitor.js before mobile-native-plugins.js. Run npm run cap:sync.');
  failed = true;
}

const infoPlistPath = path.join(root, 'ios', 'App', 'App', 'Info.plist');
const infoPlist = fs.existsSync(infoPlistPath) ? fs.readFileSync(infoPlistPath, 'utf8') : '';
if (!infoPlist.includes('<key>NSCameraUsageDescription</key>')) {
  console.error('Info.plist is missing NSCameraUsageDescription, so iOS cannot grant scanner access.');
  failed = true;
}

if (!packageSwift.includes('CapacitorBarcodeScanner')) {
  console.error('The iOS Swift package does not include CapacitorBarcodeScanner. Run npm run cap:sync.');
  failed = true;
}

if (process.platform === 'darwin') {
  try {
    const output = execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' });
    const version = output.match(/^Xcode\s+(\d+(?:\.\d+)?)/m)?.[1];
    if (!version || Number(version.split('.')[0]) < 26) {
      console.error(`Xcode ${version || 'unknown'} is installed; Capacitor 8 requires Xcode 26.0 or newer.`);
      failed = true;
    } else {
      console.log(`Xcode: ${version}`);
    }
  } catch (error) {
    console.error(`Unable to run xcodebuild: ${error.message}`);
    failed = true;
  }
}

if (failed) {
  console.error('iOS dependencies are not synchronized. Run npm ci && npm run cap:sync.');
  process.exit(1);
}

console.log('iOS dependency versions, scanner bridge, camera permission, and privacy manifest are synchronized.');
