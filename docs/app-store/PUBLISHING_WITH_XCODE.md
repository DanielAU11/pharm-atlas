# Publishing PharmAtlas With Xcode

The native iOS project must be archived and uploaded on a Mac with Xcode 26.0 or newer. Capacitor 8 cannot be built with Xcode 16.

## 1. Prepare Apple Accounts

1. Join the Apple Developer Program.
2. As the Account Holder, open **Business > Agreements**, accept the Paid Apps Agreement, and complete the requested tax and banking information.
3. In App Store Connect, create a new app named **PharmAtlas**.
4. Use bundle ID `com.pharmatlas.app` and SKU `pharmatlas-ios`.
5. Under **Monetization > Pricing and Availability**, choose the United States as the base storefront and select the `$3.99 USD` price point. Do not create an in-app purchase; this is a one-time paid download.
6. Add the privacy policy URL, categories, age rating, app privacy answers, description, keywords, support URL, and screenshots from this folder.

## 2. Move The Repository To The Mac

Clone or pull the repository, then run:

```bash
npm ci
npm run cap:sync
npm run cap:doctor
npm run cap:open:ios
```

PharmAtlas uses Capacitor's Swift Package Manager project. The native Xcode project is `ios/App/App.xcodeproj`; this repository does not use an `.xcworkspace`. You can also open it directly with `open ios/App/App.xcodeproj`.

### If Xcode Reports Missing Capacitor Members

Errors such as `PluginConfig has no member getArray` or `JSTypes has no member coerceDictionaryToJSObject` mean Xcode retained an incompatible Capacitor binary package. PharmAtlas pins the JavaScript bridge and Swift package to the same release. Do not edit the plugin's Swift source.

1. Quit the running app and close Xcode.
2. Pull the latest repository, then run `npm ci`, `npm run cap:sync`, and `npm run cap:doctor`.
3. Reopen `ios/App/App.xcodeproj`.
4. In Xcode, choose **File > Packages > Reset Package Caches**, then **File > Packages > Resolve Package Versions**.
5. Choose **Product > Clean Build Folder**, wait for package resolution to finish, and press **Run** again.

In Xcode's package list, `capacitor-swift-pm` must show `8.5.3`. If another version remains, delete the app's Derived Data from **Xcode > Settings > Locations**, reopen the project, and resolve packages again.

## 3. Configure Signing

1. Select the **App** target in Xcode.
2. In **Signing & Capabilities**, select the correct development team.
3. Keep **Automatically manage signing** enabled.
4. Confirm bundle identifier `com.pharmatlas.app`, version `1.3.4`, and build number `2` (or another number not previously uploaded).
5. Confirm iPhone and iPad are both selected as supported destinations.

## 4. Test Before Archiving

1. Run on at least one current iPhone simulator and one current iPad simulator.
2. Run on a physical device.
3. Verify persistence after force-quit and relaunch.
4. Verify schedule creation, single-dose and future-dose retiming, inventory subtraction, native local notifications, backup/restore, PDF generation, sharing, and accessibility text sizing.
5. Pair with a running Windows desktop on the same Wi-Fi network. Verify QR camera permission, manual pairing fallback, phone-to-desktop and desktop-to-phone changes, conflict merging, deletion handling, and automatic desktop safety backups.
6. If remote sync will be offered, deploy and configure the encrypted relay, re-pair with the new QR, turn off Wi-Fi on the phone, make a test change over cellular, quit/reopen the desktop, and verify the queued change merges with a safety backup.
7. Force-quit the iOS app and verify already-scheduled reminders still appear without email or a network connection.
8. In Xcode, use **Product > Analyze** and resolve release-blocking findings.
9. Choose **Product > Archive**, open the archive in Organizer, and generate the privacy report. Confirm the report matches the App Store Connect answers before uploading.

### Local Companion Sync From Xcode

The iOS Simulator and a physical iPhone can pair with PharmAtlas running on a Mac or Windows PC. Both endpoints must be awake, have PharmAtlas open, and be on the same private Wi-Fi/LAN. VPN client isolation and guest Wi-Fi commonly block local connections.

1. On the Mac, pull the latest repository and run `npm install`, `npm run cap:sync`, then `npm run cap:open:ios`.
2. Start the desktop endpoint. For an all-Mac Simulator test, open a second Terminal in the repository and run `npm start`. For a Windows-to-iPhone test, leave the installed Windows PharmAtlas app open.
3. In the desktop app, choose **Device Sync**. Allow Electron/PharmAtlas through the macOS or Windows firewall for private networks. Keep the pairing window open.
4. In Xcode, select an iPhone Simulator and press **Run**. On the PharmAtlas Dashboard, locate **iPhone Companion**.
5. The Simulator normally cannot scan the desktop QR. Expand **Simulator / manual pairing** on the desktop, choose **Copy Pairing Text**, paste it into the Simulator's pairing field, and tap **Pair Desktop**.
6. For a physical iPhone, connect it to the Mac, enable Developer Mode, select it as Xcode's destination, press **Run**, then use **Pair Desktop** to scan the QR. Approve Camera and Local Network access.
7. Create a uniquely named medication or schedule on iOS and tap **Sync Now**. Confirm it appears live on desktop. Modify it on desktop, save, then sync on iOS and confirm the change returns.
8. Delete a test record on one device and confirm the deletion remains deleted after a round trip. Also edit different records offline on both devices, reconnect, and confirm both changes merge.
9. On desktop, verify a pre-sync backup appears in the configured data folder under `sync-backups` after incoming mobile changes.

If pairing fails, verify the desktop pairing address is a private address (`10.x`, `172.16-31.x`, or `192.168.x`), both devices are on the same non-guest network, the displayed port is allowed by the firewall, and VPN/Private Relay is temporarily disabled for the test.

## 5. Archive And Upload

1. Select **Any iOS Device (arm64)** as the run destination.
2. Choose **Product > Archive**.
3. In Organizer, select the archive and choose **Distribute App**.
4. Choose **App Store Connect**, then **Upload**.
5. Leave automatic signing and symbol upload enabled unless the Apple account requires a different setup.
6. Wait for processing in App Store Connect.

## 6. TestFlight And Review

1. Add the processed build to an internal TestFlight group and complete a real-device acceptance pass.
2. In the App Store version page, select the processed build.
3. Complete export compliance, content rights, age rating, app privacy, and review contact fields.
4. Confirm Pricing and Availability shows the intended `$3.99 USD` base price and that no in-app purchase products exist.
5. Add the build for review, then submit it to App Review.

For every later upload, increment `CURRENT_PROJECT_VERSION` in Xcode. Increment `MARKETING_VERSION` only for a new public version.
