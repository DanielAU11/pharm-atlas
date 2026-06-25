# PharmAtlas iOS Migration

This project now has a Capacitor path beside the Electron desktop app.

## What Changed

- `mobile-api.js` provides a browser/mobile replacement for Electron's `window.api`.
- `capacitor.config.json` points Capacitor at the generated `www` mobile bundle.
- `scripts/build-mobile.js` copies the web app files into `www`.
- `ios/` is the generated Xcode project.

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

The first mobile adapter uses browser storage so the UI can run in Capacitor quickly.
Before App Store submission, replace or improve:

- PDF generation/export with native share/print behavior.
- Local notifications with Capacitor Local Notifications.
- Image storage with Capacitor Filesystem or SQLite/blob storage.
- Privacy policy, medical disclaimer, and data deletion/export screens.
- Responsive mobile polish for iPhone-sized screens.

The Electron desktop app still uses `main.js` and `preload.js`.
