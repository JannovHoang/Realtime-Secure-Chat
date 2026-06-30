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
- Signed-out legacy unlock is treated as migration/demo compatibility, not
  Firebase account ownership proof.
- A browser that previously used multiple Google accounts may still hold
  multiple local vaults by display/vault label.

## UI Polish / Action Visibility

- Signed-out state prioritizes Sign in with Google.
- Legacy/local mode remains available but is visually secondary.
- Signed-out or locked state does not show normal unlocked-only actions such as
  Backup to Cloud, Change vault password, Create recovery key, or normal
  top-level Start over.
- Signed out state does not render conversation list, chat pane, or composer.
- Signed-in account without a local vault/default pointer shows restore/create
  identity/legacy/sign-out entry actions only.
- Signed-in vault-locked state shows the intended account/vault context and
  asks only for vault password when a default vault pointer exists.
- Vault-locked state does not render the main conversation list, chat pane, or
  composer.
- Vault-unlocked state keeps Backup now, Settings, and Sign out available.
- Vault-unlocked desktop/laptop state uses the compact chat workspace instead
  of the large Account/Vault entry UI.
- Mobile vault-unlocked state has separate Conversations and Chat detail views.
- Mobile conversation items are tappable and open Chat detail without requiring
  the user to type an existing peer name.
- Mobile Chat detail has a visible back control and peer header while messages
  scroll.
- Composer renders only in Chat detail when vault is unlocked, a peer is
  selected, and the peer certificate is ready.
- Start over is presented as recovery/danger, not as a normal top-level action.
- Change vault password, Create recovery key, Restore latest backup, technical
  details, and Start over are grouped under Settings after unlock.
- Account/vault status is compact enough that conversations remain the sidebar
  priority.
- Backup-needed warning appears as an actionable banner near chat/composer and
  clears after Backup to Cloud.
- Primary, secondary, warning, success, and danger colors match action meaning.
- User-facing status text does not show dev-only labels such as React Shell
  Only.
- The outer page does not become the primary chat scrollbar; conversations and
  messages scroll in their own regions.

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
- Same-identity latest active restore shows latest-backup refresh copy.
- Freshness guard warns if cloud metadata is newer than local state.
- Restore does not silently overwrite a newer local vault without warning.
- Local-newer state after chat shows backup-needed guidance before device
  switching.
- Backup to Cloud clears backup-needed guidance after local send/receive.
- Older/inactive backups are not normal default restore targets.
- Older backups remain advanced/recovery material, not the normal continuation
  path.
- Recovery key restore is followed by unlock with the new password and a fresh
  Backup to Cloud.
- Start over is followed by a fresh Backup to Cloud before switching devices.

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

## Demo User Smoke Path

- AliceDemo and BebeDemo can sign in/unlock in separate browsers and exchange
  realtime messages both directions.
- Existing conversations can be opened by clicking/tapping conversation items.
- A new conversation still requires entering the peer display name manually;
  contact discovery and peer suggestions are future work.
- Giang Hoang can restore latest backup after signing in with the intended
  Google account.
- Mobile demo path can switch from Conversations to Chat detail, send a
  message, and return with the back control.
- If Firefox or another reused browser still has an older local vault for Giang
  Hoang, local-newer restore warning is expected; cancel and Backup to Cloud
  from the newest working local state unless intentionally testing rollback.
- Do not choose older backup identities during the normal demo path.
