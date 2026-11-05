const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'www');
const files = [
  ['index.html', 'index.html'],
  ['style.css', 'style.css'],
  ['sync-core.js', 'sync-core.js'],
  ['renderer.js', 'renderer.js'],
  ['mobile-api.js', 'mobile-api.js'],
  ['vendor/qrcode.js', 'vendor/qrcode.js'],
  ['node_modules/bwip-js/dist/bwip-js-min.js', 'vendor/bwip-js-min.js'],
  ['node_modules/98.css/dist/98.css', 'vendor/98.css'],
  ['node_modules/98.css/dist/ms_sans_serif.woff', 'vendor/ms_sans_serif.woff'],
  ['node_modules/98.css/dist/ms_sans_serif.woff2', 'vendor/ms_sans_serif.woff2'],
  ['node_modules/98.css/dist/ms_sans_serif_bold.woff', 'vendor/ms_sans_serif_bold.woff'],
  ['node_modules/98.css/dist/ms_sans_serif_bold.woff2', 'vendor/ms_sans_serif_bold.woff2']
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

for (const [sourceFile, outputFile] of files) {
  const destination = path.join(outDir, outputFile);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, sourceFile), destination);
}

const mobileIndexPath = path.join(outDir, 'index.html');
const mobileIndex = fs.readFileSync(mobileIndexPath, 'utf8')
  .replace('https://unpkg.com/98.css', 'vendor/98.css')
  .replace('node_modules/bwip-js/dist/bwip-js-min.js', 'vendor/bwip-js-min.js');
fs.writeFileSync(mobileIndexPath, mobileIndex);

fs.cpSync(path.join(root, 'assets'), path.join(outDir, 'assets'), { recursive: true });

console.log(`Mobile web build written to ${outDir}`);
