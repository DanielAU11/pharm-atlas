const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'www');
const files = [
  'index.html',
  'style.css',
  'renderer.js',
  'mobile-api.js',
  'vendor/qrcode.js'
];

function emptyDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }

  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

emptyDir(outDir);

for (const file of files) {
  const destination = path.join(outDir, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, file), destination);
}

console.log(`Mobile web build written to ${outDir}`);
