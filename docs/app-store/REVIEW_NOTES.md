# App Review Notes

PharmAtlas is a local-first personal medication organizer and caregiver documentation tool. It is not a prescribing system, pharmacy dispensing system, diagnostic product, or emergency service.

No account or demo credentials are required. The app opens with local sample-free storage; reviewers can add a member and synthetic medication data directly in the app.

Suggested review path:

1. Open **Members**, add a member, and open the member profile.
2. Open **Scheduled Medications**, add a medication order, and approve the staged change.
3. Tap a dose to document it or retime only that dose. Recurring orders also offer an explicit future-dose reschedule option.
4. Open **Inventory** to add and review stock.
5. Open **Monitoring** and **Regimens** to review reminders and grouped schedules.
6. On the Dashboard, tap **Enable Reminders** to grant notification permission. Reminders are created with the native iOS local-notification API and do not use email.
7. Optional desktop pairing can be reviewed with **Scan Desktop QR**. Camera access is used only to scan a QR code displayed by PharmAtlas Desktop; manual pairing text is also supported. Initial pairing and direct sync use the same local network. A user-configured encrypted relay may subsequently hold ciphertext while the desktop is offline.

The iOS companion intentionally omits the desktop Prepack and Recipe Builder workspaces. Medication and health information stays on the device unless the user deliberately exports, prints, shares, emails, backs up, stores it in synchronized storage, enables direct companion sync, or configures a remote relay. Direct sync is encrypted and authenticated. Remote sync encrypts the database before sending it to the user-selected relay. The submitted build contains no developer-operated analytics, advertising, account service, email service, or hosted sync service.

Before submission, confirm the final binary still matches these statements and provide App Review with any feature-specific notes requested in App Store Connect.
