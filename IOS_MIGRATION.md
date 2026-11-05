# PharmAtlas iOS Migration

This project now has a Capacitor path beside the Electron desktop app.

## What Changed

- `mobile-api.js` provides a browser/mobile replacement for Electron's `window.api`, with IndexedDB persistence and local-storage migration/fallback.
- `capacitor.config.json` points Capacitor at the generated `www` mobile bundle.
- `scripts/build-mobile.js` copies the web app and offline Windows 98/barcode assets into `www`.
- `ios/` is the generated Xcode project.
- iPhone uses focused full-screen work sheets for medication work and progress notes; iPad and desktop retain denser layouts where space permits.

## Windows Commands

Use `.cmd` in PowerShell if `npm` or `npx` are blocked by execution policy.

```powershell
npm.cmd run mobile:build
npm.cmd run cap:sync
```

## Mac Commands

On a Mac with Xcode installed:

```bash
npm install
npm run cap:sync
npm run cap:open:ios
```

Then in Xcode:

1. Select the `App` target.
2. Set your Apple Developer Team under Signing & Capabilities.
3. Choose an iPhone simulator or connected iPhone.
4. Press Run.

## Current Mobile Limitations

The mobile adapter now stores the database in IndexedDB, migrates older local-storage data, supports JSON backup/restore, and keeps the core medication, linked-order, regimen, monitoring, inventory, prepack, and member workflows in the Capacitor bundle.

Before App Store submission, still replace or improve:

- PDF generation/export with native share/print behavior.
- Local notifications with Capacitor Local Notifications.
- Optional native Filesystem/SQLite storage if datasets outgrow IndexedDB.
- Privacy policy, medical disclaimer, and data deletion/export screens.
- App Store screenshots, accessibility review, and physical-device regression testing.

The Electron desktop app still uses `main.js` and `preload.js`.
