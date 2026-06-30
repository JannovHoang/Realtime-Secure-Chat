# Current State

## Runtime Setup

The normal public-domain setup uses two terminals from the project root:

```powershell
npm start
```

```powershell
cloudflared tunnel run realtime-secure-chat
```

Open:

```text
https://chat.securechat.id.vn
```

## Account And Vault Model

- Firebase Google Sign-In identifies the product account when configured.
- The Firebase-owned account id is `firebase:<uid>`.
- The server must derive Firebase ownership from a verified Firebase ID token.
- Google Sign-In does not unlock E2EE data.
- The vault password unlocks the local encrypted vault and decrypts encrypted
  cloud backups.
- Display name is a profile/chat label and legacy vault label.
- Browser-local default vault pointer maps a Firebase uid to a local vault label
  and active identity id. It stores metadata only.

## Active Identity Enforcement

- A Firebase account has one server-enforced active encrypted identity.
- Local identity must match server active identity before normal Firebase chat.
- WebSocket `identity_bind`, certificate submit, send, and Firebase-owned backup
  save paths are aligned with active identity.
- Inactive local identities are blocked from normal Firebase chat and backup.
- Start over explicitly creates/promotes a new active identity.
- Recovery key restore keeps the identity from the backup/wrapper.

## Backup And Restore

- Backup to Cloud uploads encrypted identity/vault state only.
- Latest active backup is the normal Firebase restore path.
- Older backups are advanced/recovery material, not normal continuation.
- Manual Backup to Cloud is currently the supported way to carry latest
  encrypted chat state to another device.
- Freshness guard warns when cloud backup metadata appears newer than local
  state.
- If local encrypted chat state changes after the last backup, users should
  save a fresh Backup to Cloud before switching devices.
- The UI shows backup-needed guidance after send/receive changes local
  encrypted chat state, and clears that guidance after Backup to Cloud.
- Same-identity restore from the latest active backup is presented as a refresh
  from latest backup; different-identity restore remains an explicit local
  identity replacement.
- After recovery key use, unlock with the new vault password and save a fresh
  Backup to Cloud.
- After Start over, save a fresh Backup to Cloud before switching devices.
- The app does not implement full automatic multi-device Double Ratchet state
  synchronization.

## Chat UI State

- Signed-out entry is Google-first. Legacy/local mode remains available as a
  secondary compatibility path.
- Before vault unlock, the UI shows Account/Vault entry screens and hides the
  main chat workspace, conversation list, and composer.
- After vault unlock, the UI switches to a compact chat workspace with Backup
  to Cloud, Settings, and Sign out as the top-level actions.
- Settings groups secondary and advanced actions: change vault password, create
  recovery key, restore latest backup, technical details, and Start over.
- Backup-needed guidance appears as a compact banner near the chat/composer and
  clears after Backup to Cloud succeeds.
- Desktop/laptop keeps the sidebar plus chat pane layout.
- Mobile uses separate Account/Vault, Conversations, and Chat detail views.
- Existing conversations are tappable/clickable. Starting a new conversation
  still requires entering the peer display name manually.

## Legacy Compatibility

- Legacy signed-out display-name flow still exists for migration/demo use.
- Some local vault storage and routes still use display/vault labels.
- A browser can retain multiple local vaults by display/vault label even after
  different Google accounts sign in and out.
- Signed-out local vault unlock is not Firebase account ownership proof.
- Do not remove legacy flow unless a dedicated migration cleanup phase is active.

## Known Limitations

- No full automatic multi-device Double Ratchet synchronization.
- Duplicate display names across Google accounts are not fully disambiguated.
- Contact discovery and peer search suggestions are not implemented yet.
- Restore APIs still route partly by `/api/backups/:username`.
- Users must still manage backup discipline before switching devices.
- Firebase Admin SDK migration is not complete; token verification is handled by
  the current verifier boundary.
