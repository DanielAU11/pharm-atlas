const fs = require('fs');
const path = require('path');

const packageFile = path.join(__dirname, '..', 'ios', 'App', 'CapApp-SPM', 'Package.swift');
if (!fs.existsSync(packageFile)) process.exit(0);

const source = fs.readFileSync(packageFile, 'utf8');
const normalized = source.replace(/(\.package\(name:\s*"[^"]+",\s*path:\s*")([^"]+)("\))/g, (_match, start, packagePath, end) => {
    return `${start}${packagePath.replace(/\\/g, '/')}${end}`;
});

if (normalized !== source) fs.writeFileSync(packageFile, normalized);
