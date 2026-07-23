# PharmAtlas

PharmAtlas is a retro Windows 98-style medication scheduler, inventory tracker, and home monitoring app for managing medication routines across family members or care recipients.

The app is designed for personal medication organization, caregiver handoffs, prepackaging workflows, inventory awareness, and trend tracking for monitored health values. PharmAtlas keeps the classic desktop look while supporting modern workflows such as printable labels, QR-assisted prepack verification, PDF reports, email-ready schedules, and backup/restore.

## Key Features

- Medication scheduling by member, including daily, one-time, PRN, weekly, monthly, every X hours, every X weeks, and X times per week frequencies.
- Regimens for grouping related medications so they can be scheduled, modified, administered, and labeled together.
- Linked medication logic for medications that must be taken together or where only one linked option should be administered.
- Administration documentation with actual date/time, skipped/missed/late/early status, editable history, and timeline views.
- PRN maximum-dose safety checks with override comments.
- Inventory tracking with strengths, formulations, quantities, expiration dates, control level, storage conditions, notes, QR codes, and medication photos.
- Support for tablets, capsules, liquids, topicals, sprays, drops, patches, packets, suppositories, containers, and other flexible unit types.
- Printable medication labels, inventory labels, daily medication labels, regimen labels, and prepack labels.
- Prepackage Meds workflow with queued prepacks, QR/barcode verification, manual prepack completion, daytime/evening label grouping, completed prepack history, and date-range editing.
- Member profiles with diagnoses, providers, allergies/intolerances, monitoring goals, active orders, PRN orders, completed schedules, administration logs, calendars, and trends.
- Allergy and intolerance warnings during scheduling with required override documentation.
- Monitoring logs for blood pressure, heart rate, blood glucose, weight, temperature, and custom therapeutic/lab monitoring.
- Trend graphs with goal ranges, high/low highlighting, and member-specific dashboards.
- PDF reports for inventory, schedules, and monitored values.
- Email-ready schedule and monitoring workflows when email is configured.
- Missed dose dashboard and inventory status dashboard for low, expired, and soon-to-expire medications.
- Backup and restore tools for local data portability.
- Drug and vaccine information links for MedlinePlus, DailyMed, PubMed, CDC vaccine schedules, and VIS resources.

## Intended Use

PharmAtlas is intended for personal organization and caregiver documentation. It can help users:

- Keep track of what medications are scheduled and when.
- Print labels for medication prep or administration.
- Document when doses were actually taken.
- Review missed doses and administration history.
- Monitor home readings over time.
- Track medication inventory and expiration dates.
- Prepare medication schedules for travel, caregivers, or paper documentation.

PharmAtlas is not a substitute for professional medical judgment, prescribing software, pharmacy dispensing systems, or emergency care. Medication decisions should be verified with a licensed clinician or pharmacist.

## Privacy and Data

PharmAtlas is built as a local desktop application. Data is stored locally on the user's device unless the user exports reports, sends emails, creates backups, or syncs files through a third-party folder such as OneDrive.

Users are responsible for securing their device, backups, exported PDFs, and email configuration.

## Desktop App

The Windows desktop build is packaged with Electron Forge.

Common commands:

```powershell
npm install
npm start
npm run make
```

Packaged builds are created under:

```text
out/
```

The Windows installer is created under:

```text
out/make/squirrel.windows/x64/
```

## iOS/Mobile Path

PharmAtlas includes Capacitor configuration for an iOS migration path. The web app can be synced into the iOS project after building the mobile assets.

Common commands:

```powershell
npm run mobile:build
npm run cap:sync
```

iOS builds require macOS and Xcode.

## Development Notes

This project is currently structured as a mostly client-side app with Electron desktop integration for local files, notifications, printing, PDFs, and email support.

Important files:

- `index.html` - main app structure
- `style.css` - retro Windows 98 styling and print styles
- `renderer.js` - main application logic
- `main.js` - Electron main process
- `preload.js` - secure Electron bridge
- `forge.config.js` - desktop packaging configuration
- `scripts/build-mobile.js` - mobile asset preparation

## Safety Notes

Medication software needs careful validation. Before using PharmAtlas for real medication routines:

- Verify every medication, strength, dose, frequency, and date range.
- Confirm PRN maximum-dose settings.
- Confirm linked-medication rules.
- Confirm inventory subtraction behavior for each formulation.
- Test label printing with the actual label printer.
- Test backup and restore.
- Keep paper or pharmacy-provided instructions available as a fallback.

## License

No license has been selected yet. Add a license before public distribution.
