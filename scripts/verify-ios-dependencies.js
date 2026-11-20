const fs = require('fs');
const path = require('path');

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

if (failed) {
  console.error('iOS dependencies are not synchronized. Run npm ci && npm run cap:sync.');
  process.exit(1);
}

console.log('iOS dependency versions are synchronized.');
