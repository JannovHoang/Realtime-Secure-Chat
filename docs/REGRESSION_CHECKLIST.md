# Regression Checklist

## Public Domain Smoke Test

- Start server with `npm start`.
- Start tunnel with `cloudflared tunnel run realtime-secure-chat`.
- Open `https://chat.securechat.id.vn`.
- Confirm app loads without console-breaking errors.

## Auth And Vault

- Google Sign-In succeeds when Firebase config is present.
- Google Sign-Out closes the local chat session but does not delete local vault.
- Signed-in user with valid default vault pointer only needs vault password.
- Google account A does not use account B's pointer or active identity.
- Legacy signed-out Start still works for existing local demo vaults.

## Realtime Chat

- Alice/Bob style realtime chat works in both directions.
- Peer selected from conversation list opens correct local conversation.
- Mobile `Chat with` soft-keyboard submit can switch peers.
- Sending to a peer without ready cert still shows a clear warning.

## Offline Pending / Reconnect

- Offline recipient receives pending ciphertext after reconnect/unlock.
- Reconnect does not leave the active chat pane blank.
- Server identity bind does not time out during normal unlock.

## Backup / Restore

- Backup to Cloud succeeds for the active Firebase identity.
- Firebase Restore from Cloud defaults to latest active backup.
- Freshness guard warns if cloud metadata is newer than local state.
- Restore does not silently overwrite a newer local vault without warning.
- Older/inactive backups are not normal default restore targets.

## Active Identity

- Start over promotes a new active identity and increments active revision.
- New active identity publishes a cert.
- Inactive local identity shows warning/block before Firebase chat.
- WebSocket rejects inactive identity if UI warning is bypassed.
- Inactive identity cannot save a Firebase-owned latest backup.

## Recovery / Password Safety

- Create recovery key works only after vault is unlocked.
- Raw recovery key is shown once.
- Use recovery key restores the identity from the wrapper/backup; it does not
  create a new identity.
- After recovery, unlock with the new vault password and Backup to Cloud.
- Change vault password keeps the same encrypted identity.

## Logging / Secrets

- No vault passwords in logs.
- No raw recovery keys in logs.
- No plaintext private keys in logs.
- No plaintext ratchet state in logs.
- No Mongo URI, Cloudflare token, Firebase service account, or private key is
  committed.
