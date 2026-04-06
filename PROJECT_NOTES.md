# Project Notes

## Purpose

This repository is a real-time secure chat application built around these goals:

- End-to-end encrypted messaging between clients.
- The server and database must never decrypt message content.
- Offline delivery must survive server restarts.
- Ciphertext history must survive server restarts.
- Only one active session/device per username at a time.
- The project should be evolvable toward multi-browser or multi-device restore.

This file is the main continuity document for future context windows. If there is any conflict between this file and the code, trust the code first and then update this file.

## Current Status Summary

The project is no longer at the original local-only stage. As of now:

- WebSocket realtime chat works.
- Double Ratchet encryption/decryption works.
- Local encrypted vault persists in browser `localStorage`.
- Offline queue is persisted in MongoDB.
- Signed certificate cache is persisted in MongoDB.
- Ciphertext message history is persisted in MongoDB.
- The server still keeps a small in-memory cache and `pending.json` fallback for offline queue safety.
- Disconnect UX has been improved so the UI becomes `Disconnected` instead of silently looking active.
- Single active session per username still works for one Node server process.

What is still missing:

- No Google login or account system.
- No QR device linking.
- No cloud backup yet.
- No fetch-from-Mongo history restore flow on the client.
- WebSocket URL still needs future work before public tunnel demo.

## Repo Structure

- `client/`
  Client logic, storage, UI, browser-side crypto wiring.
- `client/chat.js`
  Main chat/session logic on the browser side.
- `client/storage.js`
  Local encrypted vault adapter, persisted in browser `localStorage`.
- `client/ui/`
  Vite UI entry and presentation layer.
- `crypto/dr/`
  Double Ratchet and supporting crypto functions.
- `crypto/pm/`
  Password manager / encrypted vault implementation.
- `server/server.js`
  HTTP + WebSocket relay server, certificate signing, pending queue flush, session behavior.
- `server/mongo.js`
  MongoDB connection layer and helpers.

## Security Model

### What the client does

The client is responsible for:

- holding private identity state
- generating and restoring key material
- receiving and verifying peer certificates
- encrypting outbound messages
- decrypting inbound messages
- storing local plaintext history after decrypt

### What the server does

The server is responsible for:

- relaying WebSocket traffic
- signing certificates
- tracking active sockets by username
- forcing logout for the previous active socket of the same username
- persisting ciphertext-only offline queue and ciphertext-only message history

### What the server must not do

- decrypt message content
- store plaintext chat history
- own the user's local identity in plaintext

## Terminology

- `Identity`
  Local private state needed to continue chatting as the same client identity. This includes private keys, Double Ratchet state, cert cache, and related local state.

- `Vault`
  The encrypted local container stored by the browser. The project currently persists this vault in `localStorage`.

- `History`
  Ciphertext + metadata stored durably on the server/database. Current UI does not rebuild from this yet.

- `Pending messages`
  Ciphertext messages waiting to be delivered to an offline recipient.

- `Cert cache`
  Signed peer certificates that clients need in order to verify and use peer identities.

- `Backup/Restore`
  Exporting and importing identity so it can be moved to another browser or machine.

## Username Rules

- Usernames are normalized with `trim()`.
- Case is preserved.
- Empty usernames are rejected.
- Because case is preserved, `Dung` and `dung` are different usernames.

## Current Data Locations

### Client local vault

The browser-side vault is still the main source of local UI history and local identity continuity.

Stored locally:

- Double Ratchet state
- local conversation list
- local plaintext message history after decrypt
- cert cache and related local messaging state

Important implication:

- If a different browser logs in with the same username but does not have the original local vault or a restored identity, the UI will not automatically show old conversations/history just because Mongo has ciphertext history.

### MongoDB

Current MongoDB collections used by the project:

- `pending_messages`
  Offline queue, ciphertext only.
- `certs`
  Persisted signed certificate cache.
- `messages`
  Durable ciphertext history for direct messages.
- `test_connection`
  Temporary test collection used during Mongo connection verification.

MongoDB is now part of the normal running system, not just a future plan.

### Runtime files still present

- `server/pending.json`
  Still used as a fallback path if Mongo queue operations fail while the server is running.
- `server/keys.json`
  Stores stable CA/GOV keys for continuity across server restarts.

## Current MongoDB Behavior

### `pending_messages`

Purpose:

- durable offline queue

Behavior:

- when recipient is offline, ciphertext is inserted into Mongo
- if Mongo queue write fails during runtime, server falls back to `pending.json`
- when recipient logs in, server flushes pending messages
- successfully flushed pending items are deleted from Mongo

### `certs`

Purpose:

- preserve signed certificate cache across server restarts

Behavior:

- on `cert_submit`, server signs the certificate and upserts it into Mongo
- on `register`, server loads cert cache from Mongo and sends it before pending flush

### `messages`

Purpose:

- durable ciphertext message history

Behavior:

- on every `send`, server saves ciphertext history into Mongo before relay/queue handling
- this history survives restarts
- current client UI does not yet fetch and rebuild from it

## Current Session Model

The project currently supports one active socket/session per username on a single Node server process.

Behavior:

- user logs in as `Dung`
- another browser logs in as `Dung`
- server sends `force_logout` to the older socket
- the older browser is logged out
- the newer browser becomes the active session

This is currently in-memory session behavior, not a full multi-instance account session system.

What it is good for:

- local development
- demo on one server process
- enforcing one active device/session by username for the current architecture

What it is not yet:

- multi-server session coordination
- database-backed long-lived session management
- account-based auth

## Registration and Message Flow

Current intended registration order:

1. `config`
2. `registered`
3. `cert_cache`
4. `pending_flushed`

This ordering matters because pending ciphertext may not decrypt correctly if the client has not received the needed peer certificates first.

Current send flow:

1. client encrypts with Double Ratchet
2. server receives `send`
3. server writes ciphertext history to `messages`
4. if recipient is online, server relays immediately
5. if recipient is offline, server queues ciphertext to `pending_messages`

## Disconnect / Reconnect UX

The UI has been improved from the earlier behavior.

Current behavior when the server connection drops:

- existing chat/history remains visible
- status becomes `Disconnected`
- send controls are disabled
- `Logout` still works
- `Start` button changes to `Reconnect`
- username remains in the field
- password field is shown again and cleared
- focus moves to the password field

This means the user must re-enter the password and press `Reconnect` / `Start` again.

Important note:

- this is a UI reconnect flow, not a hidden automatic reconnect system

## What the Current UI Actually Uses

This is a critical detail for future work.

The current UI does not yet rebuild history from Mongo `messages`.

Instead:

- Mongo `messages` is durable ciphertext history on the server side
- the current UI mostly reads local plaintext history from the client vault

Practical consequence:

- if a user logs in from a fresh browser with the same username but without restored identity/local vault, they may be forced into the active session correctly, but they will not automatically see previous conversation history in the UI

This is expected under the current architecture.

## Known Limitations

### Same username, different identity over time

The project currently groups conversations primarily by username, not by a long-term account id or identity fingerprint.

Implication:

- if the same username appears again with a different crypto identity, local history for that username can become logically mixed on one side

There is code that resets ratchet connection state when a peer certificate/public key changes, which helps prevent incorrect decryption, but it does not solve the UX/history grouping problem completely.

### Fresh browser does not equal restored identity

If a user logs in from a different browser that does not already have the correct local vault:

- force logout still works
- the server still recognizes the username
- but local history, conversation list, and crypto continuity will not fully appear there yet

### Incognito/private windows

Private/incognito sessions are not good for persistent identity testing because:

- browser local storage is temporary
- closing the private window can remove local vault state

Good for:

- quick chat tests

Bad for:

- long-lived identity continuity tests
- restore and cross-browser identity tests

## Environment Notes

The project now uses local environment presets for MongoDB targets:

- `.env.main`
  Main environment, points to the main app database.
- `.env.backup_restore`
  Separate environment intended for the future backup/restore branch database.
- `.env`
  The active environment file actually read at runtime.

Important:

- `.env` is ignored by Git and does not switch automatically when branches change.
- To switch environments, copy the desired preset content into `.env`.

Current recommendation:

- keep using separate databases inside the same Atlas cluster for different experimental branches

Example:

- `realtime_secure_chat`
- `realtime_secure_chat_backup_restore`

## Testing Status So Far

The following have already been tested and reported working:

- basic online chat
- Mongo connection and server boot
- offline queue using Mongo
- offline queue surviving server restart
- certificate cache surviving server restart
- ciphertext message history being stored in Mongo
- `force_logout` behavior across browsers
- disconnect/reconnect UX flow after stopping the server

## Recommended Next Major Feature

The next major feature under consideration is identity portability across browsers/devices.

There are two broad ways discussed so far:

1. manual file backup/restore
2. encrypted cloud backup

Current preferred strategic order discussed:

1. backup/restore identity
2. recent-message catch-up from Mongo
3. public tunnel / external demo

### Current direction being prepared

The current likely next phase is a `v1` encrypted cloud backup prototype without Google login.

Important constraints for that planned phase:

- backup whole vault dump rather than piecing state together manually
- encrypt backup on the client before upload
- store encrypted blob in Mongo only
- use one backup per username for `v1`
- restore first, then user manually presses `Start`
- do not auto-login immediately after restore

## Planned Future Work

This section reflects the current planning direction, not finished implementation.

### Phase candidate: encrypted cloud backup v1

Intended characteristics:

- no Google login yet
- save backup through existing authenticated session flow
- restore backup before chat login
- store encrypted backup blob in Mongo
- use the current vault password for v1 backup encryption/decryption
- keep exactly one active backup per username
- restore and `Start` remain separate steps
- after restore succeeds, clear the password field and require the user to type it again before `Start`

Still unresolved or prototype-grade:

- backup ownership remains username-based
- restore-before-login flow is the hardest design point

### Encrypted Cloud Backup v1 Final Plan

This is the currently approved `v1` plan for cloud backup without Google login.

#### Core Goal

Allow a user to:

- save encrypted identity backup to the server
- restore that backup in another browser
- press `Start` afterward to continue with restored local identity

#### Final Restore Flow

1. User opens the app in a new browser.
2. User enters `username`.
3. User enters `password`.
4. User clicks `Restore from Cloud`.
5. Client requests encrypted backup blob from the server by username.
6. Client uses the entered password to decrypt the blob locally.
7. Client validates the decrypted payload.
8. Client imports the restored vault payload into browser `localStorage`.
9. Client clears the password field.
10. UI shows:
    - `Backup restored. Enter password and press Start.`
11. User enters password again.
12. User clicks `Start`.
13. App opens vault and continues normal chat initialization.

Important:

- restore does not auto-login in v1
- restore and `Start` stay separate on purpose for simpler debugging and lower implementation risk

#### Start Guard Flow for v1

To reduce accidental `Start` on a browser that has no local vault yet, `v1` now includes a soft guard before `Start`.

When the user clicks `Start`, if:

- there is no persisted local vault for this username in the current browser
- the user has not already restored in the current page session
- the user has not already chosen to continue without restore for this username in the current page session

then the UI should show a soft confirmation dialog:

- `No local identity found for this username in this browser.`
- `If this is a new account, choose Continue.`
- `If you already backed up this account, choose Restore from Cloud first.`

Dialog actions:

- `Restore from Cloud`
- `Continue`
- `Cancel`

Behavior:

- `Restore from Cloud`
  - closes the dialog
  - runs the normal restore flow
- `Continue`
  - proceeds with `Start`
  - records that this username may continue without restore for the current page session so the user is not asked repeatedly
- `Cancel`
  - does nothing

Why this was chosen for `v1`:

- it prevents the most common accidental flow on a fresh browser
- it does not require adding a new backup existence API
- it avoids introducing extra enumeration-sensitive server behavior
- it still works for both truly new accounts and previously backed-up accounts

#### Final Backup Flow

1. User is already logged in.
2. User clicks `Backup to Cloud`.
3. Client exports the full current vault dump.
4. Client encrypts that backup using the current vault password.
5. Client sends encrypted blob to server.
6. Server upserts encrypted backup into Mongo.
7. UI shows:
   - `Cloud backup saved.`

Important overwrite rule:

- a new cloud backup overwrites the previous active cloud backup for the same username

#### Why Restore and Start Stay Separate

This is intentional because:

- if restore fails, the error belongs to backup fetch or decrypt
- if restore succeeds but `Start` fails, the error belongs to vault open or chat init
- this separation keeps the code simpler and the failure mode clearer

#### What Is Backed Up

The plan is to back up the entire vault dump, not individual Double Ratchet pieces.

Planned decrypted backup payload structure:

```json
{
  "version": 1,
  "username": "Dung",
  "repr": "...",
  "digest": "...",
  "exportedAt": "2026-04-07T10:00:00.000Z"
}
```

Why this choice:

- lower implementation risk
- reuses current vault structure
- avoids manually reconstructing multiple kinds of identity state

#### Password Strategy for v1

For `v1`, the same current vault password is used for:

- decrypting the cloud backup
- opening the restored local vault on `Start`

This is not the cleanest long-term architecture, but it is the chosen simplification for `v1`.

Why:

- fewer prompts
- simpler UX
- easier testing
- lower implementation complexity

#### Mongo Plan for v1

Use the separate database:

- `realtime_secure_chat_backup_restore`

Add collection:

- `identity_backups`

Planned document shape:

```json
{
  "username": "Dung",
  "version": 1,
  "ciphertextB64": "...",
  "ivB64": "...",
  "saltB64": "...",
  "kdf": {
    "name": "PBKDF2",
    "hash": "SHA-256",
    "iterations": 100000
  },
  "createdAt": "2026-04-07T10:00:00.000Z",
  "updatedAt": "2026-04-07T10:05:00.000Z"
}
```

Index:

- unique `{ username: 1 }`

Meaning:

- exactly one active backup per username
- new backup overwrites the old one

Additional backup blob safety rule:

- `backup_save` must reject encrypted blobs above a fixed maximum size

Why:

- protects the prototype from oversized or abnormal backup requests
- avoids letting unexpectedly large local state or malformed payloads stress the server

#### Server API Plan for v1

##### `backup_save`

Transport:

- WebSocket

Why:

- user is already logged in
- existing session/socket can be reused

Ownership rule:

- socket user must match payload username

Additional validation rule:

- reject backup payloads whose encrypted blob exceeds the configured maximum size

##### `backup_get`

Transport:

- HTTP `GET /api/backup/:username`

Why:

- restore happens before chat `Start`
- this avoids being blocked by the current chat socket initialization flow

Security tradeoff:

- ownership is still weak because there is no real account auth yet
- this is accepted for prototype `v1`
- the blob is still encrypted client-side, so server and downloader still cannot read plaintext identity without the correct password

This must be treated as:

- prototype-only ownership
- not strong account authentication
- acceptable only for local/prototype `v1`

#### Required Hardening for v1

These are part of the final approved plan:

1. `backup_get` must have rate limiting.
2. Restore errors shown in UI must remain generic.
3. Decrypted payload must be validated strictly before import.
4. Restore import must be all-or-nothing.

Generic UI error example:

- `Restore failed. Check your username/password or backup availability.`

Avoid overly specific UI errors like:

- `No backup found`
- `Wrong password`

#### Required Payload Validation

Decrypted payload must not be imported unless all checks pass:

- `version === 1`
- `username` exists and is a non-empty string
- `repr` exists and is a non-empty string
- `digest` exists and is a non-empty string
- payload username matches the username currently being restored

If any validation fails:

- do not write to `localStorage`
- show restore failure

#### Import Must Be All-Or-Nothing

This is a strict rule for implementation:

- decrypt first
- validate the full payload completely
- write restored local state only once after every check passes

If anything fails:

- do not partially update browser state
- do not leave half-old and half-restored local identity behind

#### UI Rules for v1

UI should include:

- username field
- password field
- `Restore from Cloud`
- `Start`
- `Backup to Cloud` while logged in

Rules:

- `Restore from Cloud` enabled only if username and password are both non-empty
- after successful restore, clear password field and focus it again
- user must type password again and press `Start`
- do not auto-login after restore
- if `Start` is pressed on a browser with no local vault yet, show the soft pre-start guard dialog described above
- if the user chooses `Continue`, do not show that same guard repeatedly for the same username during the current page session

Required warning for v1 restore UX:

- restoring may overwrite the current local identity/vault state already stored for this username in the current browser

Suggested user-facing meaning:

- `Restore will overwrite the current local identity for this username in this browser.`

#### Test Criteria for v1

Phase is considered successful if:

1. Logged-in user can save encrypted backup to Mongo.
2. Another browser can restore encrypted backup using username + password.
3. Restore does not auto-login.
4. User can press `Start` afterward and enter chat successfully.
5. Same-username active-session behavior still works and kicks the old browser.
6. Wrong password fails to restore.
7. Generic restore error does not over-expose backup existence details.
8. Oversized backup payloads are rejected during save.
9. Fresh browser `Start` without local vault shows the soft guard dialog.
10. Choosing `Continue` on that dialog allows normal `Start`.
11. Choosing `Restore from Cloud` on that dialog routes into the normal restore flow.

#### Relationship Between Backup/Restore and Catch-Up

This point is important:

- backup/restore moves local identity and local vault state across browsers
- it does not, by itself, implement server-driven history sync from Mongo

Implication:

- restored browser may see local history that existed at backup time
- restored browser will not automatically fetch later ciphertext history from Mongo until a later catch-up phase is implemented

So:

- `backup/restore` solves identity portability
- later `catch-up` solves recent history synchronization after the backup point

#### Additional v1 Clarifications

- new cloud backup overwrites the previous cloud backup for the same username
- restore may overwrite local identity/state already present in the current browser for that username
- `backup_get` ownership is prototype-only and is not equivalent to strong account authentication

#### Short Comparison: Backup/Restore vs Catch-Up vs Full Restore

| Concept | What it solves | What it does not solve | Example |
|---|---|---|---|
| `Backup/Restore` | Moves local identity and vault state from one browser/device to another | Does not automatically fetch messages created after the backup point | Chrome backup at 100 messages, Edge restore can recover the state as of message 100 |
| `Catch-Up` | Fetches a recent missing window of ciphertext history from Mongo | Does not rebuild all historical messages from the beginning | After Edge restores the state at message 100, catch-up can fetch the newer 20 messages stored later in Mongo |
| `Full restore` | Attempts to rebuild the entire conversation history from server-side data | Is much harder and riskier with Double Ratchet state | A new browser tries to reconstruct all 5,000 historical messages in a conversation |

Short memory aid:

- `Backup/Restore` = move the old identity/state
- `Catch-Up` = fetch the recent missing part
- `Full restore` = rebuild the whole past history

### Phase candidate: recent-message catch-up

Intent:

- fetch a recent window of ciphertext history from Mongo after identity restore
- do not attempt full history restore immediately

Reason:

- Double Ratchet state makes full history replay much riskier
- recent-message catch-up is more realistic and safer as an early feature

### Phase candidate: full history restore

Not recommended as the immediate next implementation.

Why it is harder:

- Double Ratchet is stateful
- replaying all history can drift state
- missing messages, identity changes, ordering issues, and duplicate merges are much harder to handle

### Phase candidate: tunnel/public demo

Still needed later:

- refactor WS URL away from localhost
- test behind `ngrok` or Cloudflare Tunnel

## Practical Guidance For Future Context Windows

If a future session needs to continue work:

1. Read this file first.
2. Assume Mongo-backed `pending_messages`, `certs`, and `messages` already exist and are working.
3. Remember that current UI history still depends heavily on local vault state.
4. Remember that `.env` is local-only and may not match the current branch unless manually switched.
5. Remember that separate Mongo databases per branch/environment are recommended.

## Files Most Likely To Matter Next

- `client/storage.js`
- `client/chat.js`
- `client/ui/app.js`
- `client/ui/index.html`
- `server/mongo.js`
- `server/server.js`
- `.env`
- `.env.main`
- `.env.backup_restore`

## Final Notes

- Keep this file updated after each major phase.
- Keep future feature scopes narrow.
- Prefer working, testable increments over ambitious all-at-once designs.
- The project is now beyond the purely local prototype stage, but still not at a full account-based multi-device architecture stage.
