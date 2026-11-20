# PharmAtlas Privacy Policy

Effective date: November 20, 2026

PharmAtlas is a personal medication organization application. The app stores medication schedules, member profiles, administration history, inventory, monitoring entries, notes, labels, and settings locally on the user's device.

## Data Collection

The developer does not operate an account service, analytics service, advertising service, or hosted sync relay for PharmAtlas and does not receive the information entered into the app.

## User-Initiated Sharing

Information leaves the device only when the user deliberately exports a file, prints, shares, emails, creates a backup, stores the app or its data in a third-party synchronized location, or pairs an iPhone/iPad with PharmAtlas Desktop. Those actions are governed by the privacy practices of the destination service selected by the user.

Optional companion sync transfers medication data directly between the user's devices on the same local network. Pairing uses a QR code containing a local address and a randomly generated secret. Sync messages are encrypted and authenticated. The developer does not relay, store, or receive synchronized data. The desktop app creates a local safety backup before writing incoming mobile changes.

Users may optionally configure their own HTTPS sync relay for off-network use. Before upload, PharmAtlas encrypts the database on the device with AES-256-GCM. The relay receives an encrypted envelope, random revision identifier, and a one-way hash used to validate the vault access token. The configured hosting provider still processes network metadata and stores ciphertext under its own terms. Users are responsible for selecting, configuring, securing, and deleting relay storage and for obtaining any agreements required for their use case. PharmAtlas does not provide or automatically select a relay.

PharmAtlas may request camera access solely to scan the desktop pairing QR code and local-network access solely to communicate with the paired desktop. Manual pairing text is available if the user does not grant camera access. These permissions are not used for advertising, analytics, or developer data collection.

iPhone and iPad medication and monitoring reminders are scheduled locally by iOS. They do not use the developer's email or a developer-operated notification service. Desktop email is optional and uses only the SMTP account configured by that Windows user.

## Data Retention And Deletion

Local data remains on the device until the user edits or deletes it, restores a different backup, clears the app's local data, or removes the app and its stored data. Disabling remote sync does not automatically delete ciphertext already stored by the user's relay provider. Users should delete that vault through the hosting account when retention is no longer required and retain backups before deleting the app if they want to preserve records.

## Security

Users are responsible for securing their devices, local network, pairing QR code, device accounts, backups, exported documents, email account, and synchronized storage. PharmAtlas is not a substitute for a clinical record system.

## Children

PharmAtlas is not directed to children and does not knowingly collect personal information from children through a developer-operated service.

## Contact

Privacy questions can be submitted at `https://github.com/DanielAU11/pharm-atlas/issues`.

This policy must be reviewed whenever the app adds analytics, accounts, cloud synchronization, crash reporting, or any other service that transmits data to a developer or third party.
