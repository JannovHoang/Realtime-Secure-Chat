# Security Model

## Account Ownership

- Firebase account is the product account when Google Sign-In is configured.
- Firebase-owned account id is `firebase:<uid>`.
- The server must derive uid/account id from a verified Firebase ID token.
- Client-supplied uid, account id, email, or display name is not ownership proof.

## E2EE Vault

- Vault password unlocks the browser-local encrypted vault.
- Vault password decrypts encrypted backup payloads locally.
- Google Sign-In does not unlock the vault.
- The server must not receive plaintext vault password.

## Display Name

- Display name is a profile/chat label and legacy vault label.
- Display name is not a durable account owner key in Firebase mode.
- Duplicate display-name handling is a future contact identity phase.

## Active Identity

- A Firebase account has one server-enforced active encrypted identity.
- Latest active backup is the normal restore path.
- Older backups are advanced/recovery only.
- Inactive local identities must not silently chat or save latest backups as the
  account's active identity.
- Start over explicitly creates/promotes a new active identity.
- Use recovery key restores the identity from the recovery wrapper/backup.

## Server Data Boundaries

Server may store or relay:

- ciphertext messages
- signed public certificates
- encrypted backup payloads
- encrypted recovery wrappers
- active identity metadata
- delivery/pending metadata

Server must not store or log:

- plaintext messages
- plaintext vault contents
- vault password
- raw recovery key
- plaintext private keys
- plaintext ratchet state
- message keys

## Auto Backup Rule

If automatic backup/checkpointing is added later, it must upload encrypted vault
snapshots only. It must not weaken local encryption, expose plaintext, or remove
the vault password requirement.
