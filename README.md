# PharmAtlas

![Status](https://img.shields.io/badge/status-active-008000)
![Platform](https://img.shields.io/badge/platform-Windows%20Desktop-0078d7)
![Style](https://img.shields.io/badge/style-Windows%2098-000080)
![Care](https://img.shields.io/badge/focus-medication%20organization-b00000)

PharmAtlas is a retro Windows 98-style medication scheduler, inventory tracker, prepackaging assistant, and home monitoring dashboard for personal and caregiver use.

It keeps the familiar classic desktop feel while supporting modern medication workflows: printable labels, QR/barcode-assisted verification, member profiles, regimens, administration timelines, inventory reordering, PDF reports, email-ready schedules, and backup/restore.

## What It Does

PharmAtlas helps users organize the practical details that make medication routines hard to manage:

- Schedule medications by member, dose, frequency, start date, end date, and administration time.
- Build reusable regimens for grouped medications such as daily supplements, hypertension routines, rescue plans, or travel packs.
- Link medications that must be taken together or where only one formulation should be selected.
- Track scheduled, late, early, skipped, missed, PRN, manual, and supplemental administrations.
- Print medication labels, inventory labels, daily labels, regimen labels, and prepack labels.
- Verify prepacks by scanning QR/barcodes or marking items prepacked manually.
- Track inventory quantities, low-stock alerts, expiration dates, storage, control level, prescriber, assignment, notes, photos, and multiple barcode aliases per item.
- Create and edit a master formulary, generate formulary PDFs, create named inventory orders, and receive orders by manual entry or scanning.
- Monitor blood pressure, heart rate, glucose, weight, temperature, INR, drug levels, and other custom therapeutic labs.
- Generate PDF reports for schedules, monitored values, inventory, missed doses, and reorder planning.
- Maintain member profiles with diagnoses, providers, allergies, intolerances, monitoring goals, calendars, active orders, PRN orders, completed schedules, and administration logs.

## Highlights

### Medication Scheduling

Supported frequencies include one-time, QD, BID, TID, QID, nightly, PRN, every other day, once weekly, every X weeks, X times per week, once monthly, and every X hours.

Every X hours orders include future time previews and can adjust future scheduled times after late or early administrations.

### Safety Features

- Allergy and intolerance warnings before scheduling.
- PRN maximum-dose checks with override comments.
- Barcode conflict prevention so one code cannot quietly belong to multiple inventory items.
- Linked-medication rules for "must take together" and "choose only one" situations.
- Missed-dose dashboard and color-coded administration timelines.

### Inventory and Formulary

PharmAtlas supports tablets, capsules, liquids, granules, packets, inhalations, sprays, drops, creams, ointments, gels, topical packets, topical solutions, patches, suppositories, containers, and flexible custom units.

Inventory items can have photos, multiple QR/barcode codes, multiple assigned members, and formulation-specific stock behavior.

### Prepackaging

Prepack queues can be created for a date range, grouped by daytime or evening labels, edited before printing, verified by scanner, or completed manually. Completed prepacks move into a finished list and can be filtered by member.

### Monitoring

Vitals and therapeutic monitoring can be tracked over time with goals, notes, graphs, and PDF reports. Monitoring can be tied to a medication when adherence context matters.

## Intended Use

PharmAtlas is intended for personal organization, caregiver documentation, home routines, and non-commercial medication tracking.

It is not a substitute for professional medical judgment, pharmacy dispensing software, prescribing software, medication reconciliation by a clinician, or emergency care. Always verify medication instructions with a licensed prescriber or pharmacist.

## Privacy

PharmAtlas stores data locally on the user's computer unless the user exports files, sends emails, creates backups, or stores the app/data folder in a third-party sync location such as OneDrive.

Users are responsible for protecting their computer, backups, exported PDFs, email settings, and any health information entered into the app.

## Desktop Build

Install dependencies:

```powershell
npm install
```

Run in development:

```powershell
npm start
```

Create a Windows desktop build:

```powershell
npm run make
```

Packaged output is created under:

```text
out/
```

The Windows installer is created under:

```text
out/make/squirrel.windows/x64/
```

## Project Files

- `index.html` - main application structure
- `style.css` - Windows 98 styling, print styling, and responsive layout rules
- `renderer.js` - application workflow and client logic
- `main.js` - Electron main process
- `preload.js` - secure Electron bridge
- `forge.config.js` - Electron Forge packaging
- `assets/` - app icon and UI icon assets

## Before Real-World Use

Carefully test and verify:

- Medication names, strengths, doses, frequencies, and date ranges.
- Regimens and linked-medication rules.
- PRN maximum-dose settings.
- Allergy and intolerance alerts.
- Inventory subtraction behavior for each formulation.
- Barcode scans and prepack verification.
- Label printer output.
- PDF reports.
- Backup and restore.

## License

No public license has been selected yet. Add a license before public distribution.
