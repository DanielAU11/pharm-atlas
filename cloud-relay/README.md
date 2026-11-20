# PharmAtlas encrypted sync relay

This optional Cloudflare Worker lets an iPhone upload changes while the desktop is offline. PharmAtlas encrypts the database with AES-256-GCM before upload. The Worker stores only the encrypted envelope, a random revision, and a one-way hash of the independent vault access token.

## Deploy

1. Create a Cloudflare account appropriate for the privacy and regulatory requirements of the data you intend to synchronize.
2. From this directory, run `npx wrangler login` and then `npx wrangler deploy`.
3. Copy the resulting HTTPS Worker URL.
4. In PharmAtlas Desktop, open **Device Sync > Enable Remote Sync**, paste the URL, and verify the connection.
5. Re-open Device Sync and scan the new QR on the iPhone. Initial trust pairing remains local; later sync can use any internet connection.

The desktop creates a new vault, encryption key, and access token when pairing is reset. The relay deliberately has no password-reset or data-reading path. Losing every paired device and its pairing secret makes the encrypted vault unrecoverable.

## Operational notes

- The relay is transport/storage infrastructure, not a medical record service.
- Do not claim HIPAA or other regulatory compliance based on encryption alone. Hosting terms, access controls, logging, retention, incident response, and any required agreements still matter.
- Cloud relay storage is not a backup. Keep PharmAtlas safety backups separately.
- Disable the remote feature before decommissioning a relay. Delete its Durable Object data through the hosting account when retention is no longer required.
