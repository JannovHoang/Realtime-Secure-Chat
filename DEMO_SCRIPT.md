# Realtime Secure Chat - Demo Script

This document is a safe demo guide. It intentionally avoids passwords, tunnel
credentials, private keys, backup payloads, and database secrets.

## 1. Demo Goal

This project is a realtime secure chat application. The main goal is to let two
users exchange direct messages while the server only routes encrypted data. The
server stores ciphertext and routing metadata, but it does not read plaintext
messages.

The current demo focuses on:

- realtime one-to-one chat
- offline pending message delivery
- encrypted identity backup and restore
- account and identity metadata visibility
- safer device switching warnings
- Firebase Auth foundation in optional/legacy-safe mode
- fixed public domain access through Cloudflare Tunnel

## 2. How To Run The Demo

Start the app locally:

```powershell
npm start
```

Expose the app through the named Cloudflare Tunnel:

```powershell
cloudflared tunnel run realtime-secure-chat
```

Open:

```text
https://chat.securechat.id.vn
```

Fallback if the named tunnel or domain has a problem:

```powershell
cloudflared tunnel --url http://localhost:3000
```

Then open the generated `trycloudflare.com` URL.

## 3. Short Presentation Script

This is a secure realtime chat project. The frontend is built with React and
served by the Node backend. The backend also handles WebSocket connections,
static UI files, API endpoints, and MongoDB persistence.

For messaging, the project uses an end-to-end encryption design based on a
Double Ratchet style session. Each user has a long-term identity key. The
identity produces an `identityId`, which is stored in the local vault and in
backup metadata. When two users chat, the plaintext is encrypted on the client.
The server receives only encrypted message envelopes and routing metadata.

The browser stores the local identity, chat state, and local message history in
an encrypted vault. The cloud backup feature uploads an encrypted identity
backup to MongoDB. Restore from Cloud downloads that encrypted backup and imports
it back into the browser after the user enters the correct password.

The current account model is transitional. The user still enters a display name,
but the app also derives an internal `accountId` and tracks a cryptographic
`identityId`. This helps make routing and restore decisions safer, while keeping
the UI understandable for demo.

The Firebase Auth foundation has been added incrementally. In the current safe
demo configuration, Firebase can be disabled or optional, so the existing local
display-name flow still works. When Firebase is configured later, the server is
prepared to verify Firebase ID tokens and use the verified Firebase user id for
authenticated account ownership. Firebase login does not unlock the encrypted
vault and does not recover Double Ratchet keys; the user still needs the local
vault password and cloud restore flow for E2EE state.

For public access, the app runs locally on port `3000`, and Cloudflare Tunnel
exposes it through `https://chat.securechat.id.vn`. This does not turn the laptop
into a public server with an open inbound port. The local `cloudflared` process
opens an outbound connection to Cloudflare, and Cloudflare forwards requests
through that tunnel.

## 4. Demo Flow

### A. Realtime Chat

1. Open Alice in one browser.
2. Open a second clean user in another browser.
3. Start both users.
4. In Alice, type the second user's display name in `Chat with`.
5. Send a message from Alice.
6. Send a reply from the second user.
7. Show that both sides receive messages in realtime.
8. Show that the sidebar preview and conversation order update.

Expected result:

- messages appear on both sides
- the server does not display plaintext
- the UI remains connected through `https://chat.securechat.id.vn`

### B. Offline Pending Message

1. Keep Alice online.
2. Logout or close the second user.
3. Alice sends a message to the second user.
4. Start the second user again.
5. Open the conversation with Alice.

Expected result:

- the offline message is delivered once
- the message appears in the conversation
- sidebar metadata updates

### C. Backup To Cloud

1. Start a user that has a working local identity.
2. Click `Backup to Cloud`.
3. Enter the correct password.
4. Confirm that the backup succeeds.
5. Show the `Account identity` panel.

Expected result:

- the app reports backup success
- the identity panel shows the display name, shortened account id, shortened
  identity id, and backup state
- the backup stored on the server remains encrypted

### D. Restore From Cloud

1. Open another browser/profile or phone.
2. Enter the same display name and password.
3. Click `Restore from Cloud`.
4. If multiple backup identities exist, choose the correct identity.
5. After restore succeeds, press `Start`.
6. Open the previous conversation and send a test message.

Expected result:

- restore requires the correct password
- restore does not auto-start chat
- after pressing Start, the restored identity can continue chatting

### E. Device Switching Safety

1. Backup the user from the current browser.
2. Use another browser or phone with the same display name.
3. Try pressing `Start` directly when a cloud backup is available or newer.

Expected result:

- the app shows a backup safety warning before entering chat
- the user can choose `Restore from Cloud`, `Start anyway`, or `Cancel`
- for safe use, choose `Restore from Cloud` before chatting from a different
  device

### F. Restore Overwrite Safety

1. Use a browser that already has a local vault for the display name.
2. Click `Restore from Cloud`.
3. Confirm that the app shows `Replace Local Identity?`.
4. Choose `Cancel` once.
5. Try again and choose `Restore and Replace`.

Expected result:

- cancel does not replace the local vault
- confirm replaces the local identity with the selected cloud backup
- the flow still requires pressing `Start` after restore

### G. Stale Backup Restore Guard

1. Start a clean throwaway user.
2. Send messages successfully with Alice.
3. Click `Backup to Cloud`.
4. Send a few more messages after that backup.
5. Click `Restore from Cloud` on the same browser.
6. Confirm the first `Replace Local Identity?` modal.

Expected result:

- the app shows `Cloud Backup May Be Older`
- choosing `Cancel` leaves the local vault unchanged
- choosing `Restore Anyway` is available only as an explicit rollback/recovery
  action
- for normal use, save a fresh backup from the newest working device before
  restoring elsewhere

### H. Auth UX / Vault Clarity Smoke

Current safe demo mode can run with Firebase configured, optional, or disabled.
The important rule is that Google account login and E2EE vault unlock are two
different layers.

1. Open the app on `https://chat.securechat.id.vn`.
2. If Firebase is configured, click `Sign in with Google`.
3. Confirm that signing in does not auto-start chat, auto-unlock the vault, or
   auto-restore a cloud backup.
4. Confirm that the topbar asks for `Vault password`, not a Google password.
5. If the display-name field is empty, confirm it is suggested from the Google
   profile; if it already contains a demo name such as `AliceDemo`, confirm the
   app does not overwrite it.
6. Enter the correct vault password and click `Unlock vault`.
7. Chat normally, then click `Sign out`.
8. Confirm that `Sign out` closes the local chat session and signs out Google,
   but does not delete local vault data or cloud backups.
9. Run the auth verify smoke test if needed:

```powershell
Invoke-RestMethod -Method POST https://chat.securechat.id.vn/api/auth/firebase/verify
```

Expected result:

- Google/Firebase identifies the account, but does not unlock E2EE state
- `Vault password` still controls the encrypted browser-local identity
- `Sign out` is the only visible signed-in exit action in the main UI
- local vault data remains available if browser site data was not deleted
- if Firebase server auth is still in legacy mode, the verify endpoint returns a
  safe legacy/disabled response

### I. Firebase Account Ownership Enforcement Smoke

Use this after Firebase server auth is enabled and at least one signed-in account
has saved a new Firebase-owned backup.

1. Open `https://chat.securechat.id.vn`.
2. Sign in with Google account A.
3. Enter the intended display name and vault password.
4. Click `Unlock vault`.
5. Click `Backup to Cloud`.
6. Confirm in MongoDB, if needed, that the latest `identity_backups` record for
   that identity has `authMode: "firebase"` and a non-empty `firebaseUid`.
7. Sign out.
8. Sign in with Google account B.
9. Enter the same display name and the same vault password.
10. Click `Restore from Cloud`.

Expected result:

- account B must not directly restore account A's Firebase-owned backup
- the app should show the explicit `Try Legacy Restore` compatibility path if
  no Firebase-owned backup exists for account B
- cancelling `Try Legacy Restore` must leave the local vault unchanged
- choosing `Try Legacy Restore` is a deliberate legacy compatibility action,
  not proof that account B owns account A's Firebase-owned backup
- unsigned-in legacy Restore from Cloud still works through the legacy path
- realtime chat and offline pending still work after restoring the correct
  account-owned backup

### J. Vault Recovery Model Baseline

Use this before implementing vault password change or recovery key features.
The goal is to verify that current behavior is unchanged and that the recovery
story remains accurate.

1. Open `https://chat.securechat.id.vn`.
2. Sign in with Google if Firebase is configured.
3. Confirm that Google sign-in does not unlock the vault by itself.
4. Enter the intended display name and vault password.
5. Click `Unlock vault`.
6. Send a realtime message to another demo user.
7. Test one offline pending message if time allows.
8. Click `Backup to Cloud`.
9. Sign out.
10. Restore with the correct vault password.

Expected result:

- Google account identifies backup ownership only
- vault password is still required to unlock/decrypt E2EE state
- server and MongoDB still do not receive plaintext vault contents
- Backup to Cloud and Restore from Cloud behavior is unchanged
- there is not yet a `Forgot vault password` recovery flow
- if vault password is lost today, the user still needs an existing unlocked
  device or a valid encrypted backup plus the correct vault password

### K. Change Vault Password Smoke

Use this after Vault Recovery checkpoint 1. Test with a disposable demo user if
possible.

1. Open `https://chat.securechat.id.vn`.
2. Enter the demo display name and current vault password.
3. Click `Unlock vault`.
4. Confirm chat still opens and the conversation list loads.
5. Confirm `Change vault password` is now enabled.
6. Click `Change vault password`.
7. Try a wrong current password.
8. Expected: the modal stays safe, the change fails, and the active chat session
   still works.
9. Open the modal again.
10. Enter the correct current vault password.
11. Enter a new vault password and a different confirmation.
12. Expected: the change is rejected because the confirmation does not match.
13. Enter the correct current vault password.
14. Enter the same new vault password twice.
15. Click `Change Password`.
16. Expected: status/toast says the vault password changed locally.
17. Send one realtime message to another demo user.
18. Expected: chat still works after the local re-encryption.
19. Click `Sign out`.
20. Try to unlock the same display name with the old vault password.
21. Expected: unlock fails.
22. Unlock the same display name with the new vault password.
23. Expected: the same local identity, conversation list, and local history load.
24. Click `Backup to Cloud` and use the new vault password.

Expected result:

- the vault password can be rotated without changing the server schema
- the old local vault password stops working after sign out/reload
- the new vault password unlocks the same local identity
- existing cloud backups are not rewritten automatically
- save a new cloud backup with the new password before switching devices
- if restoring an older cloud backup made before the password change, that older
  backup may still require the old password

### L. Recovery Key Design Review

Use this after Vault Recovery checkpoint 2. This checkpoint is intentionally a
design/documentation checkpoint; it does not generate a recovery key yet.

1. Open `PROJECT_NOTES.md`.
2. Find `Vault Recovery And Password Safety - Checkpoint 2: Recovery Key Design`.
3. Confirm the model says Google account recovery cannot decrypt the E2EE vault.
4. Confirm the recovery key is described as a client-held secret.
5. Confirm the raw recovery key must not be stored in MongoDB, Firebase,
   localStorage, logs, or server plaintext.
6. Confirm the future format is recognizable, for example:
   `RSC-RECOVERY-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`.
7. Run the normal smoke test:
   - unlock an existing vault
   - send one realtime message
   - test one offline pending message if time allows
   - run Backup to Cloud / Restore from Cloud with a disposable identity if needed

Expected result:

- runtime behavior is unchanged from Checkpoint 1
- there is still no `Forgot vault password` flow yet
- there is still no recovery key shown in the UI yet
- the design clearly explains that recovery key support must remain client-side
  and must not give the server plaintext E2EE keys

## 5. Important Terms

`Display name`

The human-readable name typed by the user. In the current transitional version,
this is still the main visible chat label and legacy vault lookup key. After
Google sign-in, the app may suggest a display name from the Google profile, but
display name is not the security boundary.

`accountId`

An internal account identifier. In legacy mode it is still derived locally from
the display name. In Firebase-aware mode it can be namespaced from a verified
Firebase user id, for example `firebase:<uid>`. The server must derive Firebase
ownership from a verified token, not from client-supplied text.

`identityId`

A stable cryptographic identity identifier derived from the user's long-term
public key. This is more important than display name when selecting which
identity backup should be restored.

`Vault`

The encrypted browser-local storage area that holds identity state, ratchet
state, local conversation history, and metadata. If browser site data is deleted,
the local vault is deleted too, so the user must restore from cloud backup.

`Vault password`

The password used to unlock the encrypted local vault and decrypt encrypted
backup payloads. It is not the Google account password, and it is not sent to the
server as plaintext.

`Recovery key`

A client-held recovery secret for future vault-password recovery. The current
implementation can create and store an encrypted recovery wrapper, but the
`Forgot vault password` recovery flow is not implemented yet. The server never
receives the raw recovery key.

`Backup to Cloud`

Creates an encrypted identity backup and stores it on the server. The server does
not receive the plaintext vault or backup password.

`Restore from Cloud`

Downloads an encrypted backup, decrypts it locally with the user's password, and
imports the selected identity into the browser.

`Firebase Auth`

A real account authentication layer for proving account ownership when it is
configured. It does not decrypt messages, does not unlock the vault, and does not
replace Backup to Cloud / Restore from Cloud.

`Sign out`

The visible signed-in exit action. It signs out the Google/Firebase account and
closes the local encrypted chat session first. It does not delete local vault
data and does not delete cloud backups.

`Unlock vault`

The action that opens the encrypted local identity on this browser after the
correct vault password is entered. In legacy mode the older `Start` wording may
still appear.

## 6. Current Limitations

- Firebase Auth foundation is present, but the safe demo configuration may still
  run in legacy or optional mode.
- Google sign-in is available only when Firebase environment variables are
  configured correctly.
- Google sign-in does not replace the vault password and does not recover lost
  E2EE keys.
- Legacy `accountId` is still transitional and derived from display name.
- The project still works best with one active browser/device per account at a
  time.
- Switching devices should be done by backing up on the old device and restoring
  on the new device before continuing chat.
- The app does not implement full multi-device Double Ratchet synchronization.
- If a user continues chatting from an old local vault, secure chat state can
  desynchronize. The warning modals reduce this risk but do not replace real
  multi-device sync.
- Firebase Auth does not solve stale Double Ratchet state by itself. The newest
  working device still needs to save a fresh cloud backup before another device
  restores.

## 7. Safe Demo Checklist

Before demo:

- run `npm start`
- run `cloudflared tunnel run realtime-secure-chat`
- open `https://chat.securechat.id.vn`
- use clean demo users that have not already desynchronized
- if using Google sign-in, verify that the display name matches the intended
  local vault before unlocking
- backup before switching devices
- restore before chatting on a new device
- after important test messages, save a fresh backup from the newest working
  device before restoring elsewhere
- creating a recovery key does not replace this rule; it only prepares a future
  password-recovery path, while Backup to Cloud carries the latest encrypted
  chat state
- if a restore warning says the cloud backup may be older, cancel unless you are
  intentionally testing rollback

Avoid during demo:

- do not reuse users known to have desynchronized ratchet state
- do not show passwords
- do not show Cloudflare tunnel credentials
- do not show Mongo connection strings
- do not show private keys or backup payload contents
