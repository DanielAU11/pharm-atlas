# Publishing PharmAtlas With Xcode

The native iOS project must be archived and uploaded on a Mac with a current supported Xcode release.

## 1. Prepare Apple Accounts

1. Join the Apple Developer Program.
2. In App Store Connect, create a new app named **PharmAtlas**.
3. Use bundle ID `com.pharmatlas.app` and SKU `pharmatlas-ios`.
4. Add the privacy policy URL, categories, age rating, app privacy answers, description, keywords, support URL, and screenshots from this folder.

## 2. Move The Repository To The Mac

Clone or pull the repository, then run:

```bash
npm install
npm run cap:sync
open ios/App/App.xcworkspace
```

Always open the workspace, not the `.xcodeproj`, so CocoaPods dependencies are included.

## 3. Configure Signing

1. Select the **App** target in Xcode.
2. In **Signing & Capabilities**, select the correct development team.
3. Keep **Automatically manage signing** enabled.
4. Confirm bundle identifier `com.pharmatlas.app`, version `1.1.0`, and build `1`.
5. Confirm iPhone and iPad are both selected as supported destinations.

## 4. Test Before Archiving

1. Run on at least one current iPhone simulator and one current iPad simulator.
2. Run on a physical device.
3. Verify persistence after force-quit and relaunch.
4. Verify schedule creation, single-dose and future-dose retiming, inventory subtraction, prepack recognition, barcode scanning, backup/restore, PDF generation, sharing, and accessibility text sizing.
5. In Xcode, use **Product > Analyze** and resolve release-blocking findings.

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
4. Add the build for review, then submit it to App Review.

For every later upload, increment `CURRENT_PROJECT_VERSION` in Xcode. Increment `MARKETING_VERSION` only for a new public version.
