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
- Encrypted cloud backup `v1` is implemented and working in the backup/restore branch database.
- Cloud restore is implemented and working as a separate pre-`Start` flow.
- Soft `Start` guard is implemented for fresh browsers with no local vault.
- Backup modal with hidden password + show/hide toggle is implemented.
- `v2 foundation` is partially implemented and already tested through the main identity-binding flows.
- The server still keeps a small in-memory cache and `pending.json` fallback for offline queue safety.
- Disconnect UX has been improved so the UI becomes `Disconnected` instead of silently looking active.
- Single active session per username still works for one Node server process.

What is still missing:

- No Google login or account system.
- No QR device linking.
- No fetch-from-Mongo history restore flow on the client.
- WebSocket URL still needs future work before public tunnel demo.
- Full identity-policy cleanup is not done yet; several policies still remain username-based.
- Recent-message catch-up is not started yet.

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

- `account_active_devices`
  Tracks the currently preferred/active identity for each username/account label.
- `pending_messages`
  Offline queue, ciphertext only.
- `certs`
  Persisted signed certificate cache.
- `identity_backups`
  Client-encrypted identity backup blobs, scoped by `username + identityId`.
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

### `account_active_devices`

Purpose:

- remember which identity is currently the active/preferred device for a username/account label
- let the server route and encrypt toward the correct device identity even after restart
- support the transitional model: one active device per username/account label

Typical document shape:

```js
{
  username: "Giang",
  activeIdentityId: "8x6zfkOuU2_xGslMp6JR...",
  updatedAt: ISODate("...")
}
```

Behavior:

- when a browser successfully starts and binds an identity, the server updates this collection
- there should be one document per `username`
- logging in with another identity under the same username updates the existing document, not creates many active-device documents
- when the recipient is offline, the server can consult this collection to know which identity should receive pending messages
- when building the certificate cache, the server can mark the active identity so the sender encrypts to the correct device

Important implication:

- this is not a full multi-device linked-device model yet
- it is a transitional account -> active device pointer
- it does not mean all devices receive every message

Security note:

- `activeIdentityId` is not secret
- it is derived from public identity material and is used as routing metadata
- private keys and ratchet state are not stored here

### `pending_messages`

Purpose:

- durable offline queue
- store ciphertext messages waiting for the target active identity to come online

Behavior:

- when recipient is offline, ciphertext is inserted into Mongo
- if Mongo queue write fails during runtime, server falls back to `pending.json`
- when recipient logs in, server flushes pending messages matching that recipient identity
- successfully flushed pending items are deleted from Mongo

Typical document shape:

```js
{
  from: "Minh",
  to: "Giang",
  senderIdentityId: "identity_of_Minh",
  recipientIdentityId: "active_identity_of_Giang",
  envelope: {
    header: "...",
    ciphertextB64: "..."
  },
  ts: 1710000000000
}
```

Important implication:

- new pending messages are identity-aware when the target identity can be resolved
- legacy pending messages without `recipientIdentityId` may still be flushed as fallback
- the server still cannot decrypt message content because the stored message body is ciphertext

Security note:

- this collection stores routing metadata and ciphertext
- it must not contain plaintext chat text

### `certs`

Purpose:

- preserve signed certificate cache across server restarts
- let clients fetch peer public identity material needed for encrypted messaging

Behavior:

- on `cert_submit`, server signs the certificate and upserts it into Mongo
- on `register`, server loads cert cache from Mongo and sends it before pending flush
- cert persistence is now scoped by `username + identityId`
- this avoids overwriting cert A just because cert B has the same username

Typical document shape:

```js
{
  username: "Giang",
  identityId: "8x6zfkOuU2_xGslMp6JR...",
  certificate: {
    username: "Giang",
    identityId: "8x6zfkOuU2_xGslMp6JR...",
    pub: { /* long-term public key material */ },
    signerPub: "...",
    signatureB64: "..."
  },
  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}
```

Important implication:

- one username can now have multiple cert records if it has multiple identity records
- the sender should use the active identity metadata to choose the right cert
- this is why `account_active_devices` matters for message routing

Security note:

- certificates and public keys are public metadata
- they are used to verify identity and establish encrypted sessions
- private keys are not stored in Mongo

### `identity_backups`

Purpose:

- store encrypted cloud backups of local identity state
- allow a browser to restore the same identity on another browser/machine
- support explicit restore targeting by `username + identityId`

Behavior:

- backup is encrypted on the client before upload
- server stores only encrypted backup blob plus metadata
- backup persistence is scoped by `username + identityId`
- one username can have multiple backup identities
- restore UI lists available backup identities and fetches the selected identity explicitly

Typical document shape:

```js
{
  username: "Giang",
  identityId: "8x6zfkOuU2_xGslMp6JR...",
  version: 2,
  ciphertextB64: "...",
  ivB64: "...",
  saltB64: "...",
  kdf: { /* PBKDF2 metadata */ },
  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}
```

Important implication:

- backup A and backup B under the same username no longer overwrite each other blindly
- restore-by-username alone is ambiguous once more than one backup identity exists
- the official restore path must choose a specific `identityId`

Security note:

- the backup blob is encrypted client-side
- the server cannot decrypt it without the user's backup password
- `identityId`, timestamps, and version are metadata, not encrypted secrets

### `messages`

Purpose:

- durable ciphertext message history
- future source for recent-message catch-up

Behavior:

- on every `send`, server saves ciphertext history into Mongo before relay/queue handling
- this history survives restarts
- current client UI does not yet fetch and rebuild from it

Typical document shape:

```js
{
  from: "Minh",
  to: "Giang",
  senderIdentityId: "identity_of_Minh",
  recipientIdentityId: "active_identity_of_Giang",
  envelope: {
    header: "...",
    ciphertextB64: "..."
  },
  ts: 1710000000000
}
```

Important implication:

- this is not the same as local UI history
- browser UI currently still relies mostly on local vault state for displayed history
- recent-message catch-up will later query this collection and let the client decrypt/merge recent messages

Security note:

- this collection stores ciphertext history, not plaintext messages
- if MongoDB is exposed, attackers may see metadata such as sender, recipient, time, and identity ids, but not message plaintext

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
- encrypted cloud backup save to Mongo
- encrypted cloud restore on another browser
- restore requiring `Start` afterward
- overwrite warning when restoring over an existing local identity
- soft `Start` guard on a browser with no local vault

## Implementation Status As Of 2026-04-07

This section is the short operational summary of what has actually been completed in code and manually tested.

### Completed: Encrypted Cloud Backup v1

The following are implemented in code and manually tested:

- `identity_backups` collection exists in MongoDB.
- Cloud backup save works through WebSocket `backup_save`.
- Cloud backup fetch works through `GET /api/backup/:username`.
- Backup blob is encrypted on the client before upload.
- Server stores encrypted blob only and does not decrypt it.
- Backup payload uses the local vault dump rather than piecing Double Ratchet state together manually.
- Backup save enforces a blob size limit.
- Backup import is all-or-nothing.
- Restore is a separate flow from `Start`.
- After successful restore, the password field is cleared and the user must type the password again before `Start`.
- Restore on a browser that already has local state shows an overwrite warning.
- A soft `Start` guard exists on browsers that do not yet have a local vault.
- Backup modal now uses a hidden password field with a show/hide toggle instead of a plain prompt.

### Completed: V2 Foundation

The following `v2 foundation` work is implemented in code:

- `identityId` is derived from the canonical export of the long-term identity public key using deterministic hashing.
- `identityId` is persisted in the local vault-related state and is available again after reload/restore.
- Backup payload has been upgraded to `version: 2`.
- Backup payload `version: 2` includes `identityId`.
- Legacy backup payloads without `identityId` are rejected on the `v2` path.
- Mongo `identity_backups` now stores `identityId`.
- Mongo `certs` now stores `identityId`.
- Session/runtime metadata now carries both `username` and `identityId`.
- Cert submit/save flow now binds the active session to `identityId`.
- Restore validation now reasons about both `username` and `identityId`.
- Restore UI now distinguishes between:
  - generic overwrite of current local identity
  - overwrite of a different local identity under the same username

### Manually Tested And Observed For V2 Foundation

The following have already been observed manually during testing:

- Browser A can create a new identity, `Start`, and save a cloud backup.
- Mongo `certs` contains `identityId`.
- Mongo `identity_backups` contains `identityId` and `version: 2`.
- Browser B can restore the same backup and then `Start`.
- In the clean restore case, the restored browser continues with the same identity rather than creating a new one.
- Browser C can intentionally create an accidental new identity under the same username by choosing `Continue` instead of restore.
- In that accidental-new-identity case:
  - the active cert for the username changes to the new identity
  - the cloud backup remains on the old identity until a new backup is saved
- Restoring the old backup over the accidental new identity brings the browser back to the original identity.
- After restoring back to the original identity, the cert and active identity metadata return to the original `identityId`.
- Restarting the server does not break backup retrieval or restore of the persisted identity.

### Important Transitional Limitation Still Present

Even after the current `v2 foundation` work, some policy is still username-based:

- active session is still `1 active session / username`
- active cert is still effectively `1 active cert / username`
- active backup is still effectively `1 active backup / username`

So the project now understands `identityId` in the data model, but policy cleanup is not finished yet.

### Most Likely Next Step

The recommended next phase is not `recent-message catch-up` yet.

The more appropriate next step is:

- `v2.1 identity policy cleanup`

Meaning:

- reduce the remaining username-based overwrite policies
- move cert / backup / session policy to become more identity-aware
- only after that begin recent-message catch-up

## Current Strategic Roadmap

This is the current preferred roadmap after the completed `v2 foundation` work.

Core model:

- `username` currently acts as the temporary account label
- `identityId` acts as the device identity / crypto identity of a browser or machine
- session runtime should always understand both `username` and `identityId`

Important interpretation:

- same username + different password does **not** automatically mean different accounts
- under the current model, that is still better understood as:
  - one account label
  - potentially different device identities

### Phase 0 - Lock The Current State And Keep Test Data Clean

Goal:

- avoid letting stale test data pollute later phases

Rules:

- use a dedicated branch for the next phase
- use a clean Mongo DB or fully clear the current test DB
- clear browser site data before serious testing
- do not try to preserve old payloads without `identityId` on the new path

### Phase 1 - V2 Foundation

Status:

- implemented in code
- manually tested
- should be considered complete for the intended scope

What this phase achieved:

- `identityId` is introduced consistently across vault, backup payload, cert metadata, and session metadata
- restore validation now reasons about both `username` and `identityId`
- same username but different identities are no longer treated as blindly equivalent everywhere

Important note:

- this phase fixed the identity model foundation
- it did **not** finish the policy model

### Phase 2 - V2.1 Identity Policy Cleanup

This is now the recommended next implementation phase.

Goal:

- move remaining policy from username-blind behavior toward identity-aware behavior
- do that before any message catch-up work

Main tasks:

- stop cert overwrite from being blindly username-only
- stop cloud backup overwrite from being blindly username-only
- keep session/runtime logs and replacement behavior identity-aware
- tighten UX wording so identity conflicts are described as identity conflicts, not just username conflicts

Expected direction:

- `certs` should move toward `username + identityId`
- `identity_backups` should move toward `username + identityId`
- session logic should explicitly say which identity replaced which identity

Current implementation status inside Phase 2:

- Phase 2 has started.
- Checkpoint 1 is completed at the Mongo persistence layer.
- Checkpoint 2 is completed at the server runtime layer.
- Client/runtime/UI cleanup for Phase 2 is not finished yet.

What is already done in code for Phase 2:

- Mongo `certs` persistence now stores records by `username + identityId`.
- Mongo `identity_backups` persistence now stores records by `username + identityId`.
- Mongo indexes for `certs` and `identity_backups` have been moved away from username-only uniqueness toward composite uniqueness on `username + identityId`.
- Backup lookup helper now supports reading by `username + identityId`, while still keeping a fallback path for the latest record by username during the transition.
- Server in-memory cert cache is now identity-scoped rather than username-only.
- Server session replacement logging is now identity-aware and records which identity replaced which identity.
- Server `force_logout` payload now carries replacement identity metadata.

What is intentionally still true after Phase 2 checkpoint 2:

- session semantics are still `1 active session / username`
- client/runtime wording has not been fully cleaned up for Phase 2 yet
- full runtime behavior is not yet fully policy-cleaned until the later checkpoints are done

Phase 2 completion update:

- Phase 2 has now been completed for the intended scope.
- Client/runtime/UI wording cleanup has been finished.

Additional work completed after checkpoint 2:

- client backup fetch path now supports passing `identityId`
- client `force_logout` handling now surfaces a more identity-aware message when another identity under the same account becomes active
- restore/start-guard wording now talks about account plus local identity rather than only username

What Phase 2 achieved in practice:

- cert persistence is no longer blindly username-only
- backup persistence is no longer blindly username-only
- server/runtime replacement behavior is more identity-aware
- the system now exposes account-vs-identity ambiguity instead of silently hiding it

What manual testing confirmed during Phase 2:

- identity A and identity B under the same username can both exist in Mongo persistence
- backup B does not blindly overwrite backup A
- cert B does not blindly erase all trace of cert A in persistence
- session replacement still happens by username, but logs/runtime are more identity-aware

Important discovery after Phase 2 testing:

- once multiple backups exist for the same username, restore-by-username alone becomes ambiguous
- if account `Giang` has backup `A` and backup `B`, entering password `A` does not guarantee that restore will target backup `A`
- the server may return the latest backup for that username, which may instead be `B`

Correct interpretation of that failure mode:

- this is not necessarily a crypto bug
- it is a restore-selection ambiguity that appears once backup persistence becomes identity-aware

Important testing rule after Phase 2:

- the old assumption that `username + password A` always means "restore identity A" is no longer valid once multiple backups exist under the same username
- restore-by-username should now be treated as a transitional path only

Recommended next step after Phase 2:

- add restore targeting by `identityId`

This should happen before recent-message catch-up.

## Restore Targeting By `identityId`

This is the next recommended focused phase after Phase 2.

### Why This Phase Exists

After Phase 2, backup persistence is now identity-aware:

- the same username/account can have backup `A`
- and backup `B`

That means restore-by-username alone is no longer sufficient.

This phase exists to remove that ambiguity.

### Goal

Make restore explicitly target:

- `username`
- `identityId`

so that:

- selecting backup `A` and entering password `A` restores identity `A`
- selecting backup `B` and entering password `B` restores identity `B`
- restore no longer fails just because the server returned the wrong backup for the same username

### Scope

This phase will:

- make restore target a specific `identityId`
- add the smallest necessary backup-identity selection flow in the client
- keep decrypt/validation/import all-or-nothing
- keep restore and `Start` as separate actions

This phase will not:

- implement recent-message catch-up
- implement full linked-device UI
- implement Google login
- implement backup history with many versions per identity

### Server Direction

Server may temporarily keep the old username-only fallback path so legacy code does not break immediately.

But:

- the new client/UI must not rely on that fallback
- the official path for this phase must be `username + identityId`

Recommended server behavior:

- if `identityId` is provided:
  - restore must use `username + identityId`
- if `identityId` is missing:
  - fallback may still exist temporarily
  - but should be treated as legacy/transitional only

### Metadata List Endpoint

To support explicit restore targeting, the client needs a small metadata listing step.

Recommended endpoint shape:

- `GET /api/backups/:username`

This endpoint is sensitive and must be treated carefully.

Minimum requirements:

- apply rate limiting
- return only minimal metadata
- keep errors generic enough for the current prototype level
- when public, serve only behind HTTPS/WSS

Recommended response fields per item:

- `identityId`
- `updatedAt`
- optionally `createdAt`

Do not return unnecessary data here.

### Client / UI Direction

The new UI should not have a "just restore by username anyway" branch.

Instead:

1. user enters `username`
2. user enters `password`
3. user clicks `Restore from Cloud`
4. client fetches backup metadata list for that username
5. if there is exactly one backup identity:
   - select it automatically
6. if there are multiple backup identities:
   - show a small selection UI
   - user chooses the target `identityId`
7. client fetches encrypted blob by `username + identityId`
8. client decrypts using the entered password
9. client validates payload by:
   - version
   - username
   - identityId
10. if local browser currently has a different identity:
    - show strong overwrite warning
11. if confirmed:
    - import all-or-nothing
    - clear password
    - show `Backup restored. Enter password and press Start.`

### UI Display Rule For `identityId`

Do not show the full raw `identityId` string in the selector UI unless necessary.

Preferred display:

- short identity fragment
- plus timestamp

Example:

- `ab12cd34 - updated 2026-04-09 09:42`
- `9f88e120 - updated 2026-04-09 20:15`

This keeps the selector usable without pretending the user understands full cryptographic identifiers.

### Warning Requirement

When the browser already stores a different local identity, the overwrite warning should be explicit.

It should make clear:

- the browser currently has one local identity
- the chosen backup belongs to another identity
- restore will replace the current local identity with the selected one

The warning should not remain username-generic.

### Things That Should Explicitly Wait

This phase should not try to be "smart" in ways that enlarge scope.

Do not do these yet:

- auto-guess the correct identity from local state
- auto-try multiple passwords
- auto-merge identities
- auto-login immediately after restore

This phase should do one thing cleanly:

- restore the identity explicitly selected by `identityId`

### Main Files Likely To Change

- `server/mongo.js`
  - helper for listing backup metadata by username
- `server/server.js`
  - metadata list endpoint
  - strict backup-get by `username + identityId`
- `client/chat.js`
  - fetch metadata list
  - fetch backup blob by `identityId`
- `client/ui/app.js`
  - selection flow
  - overwrite warning
- `client/ui/index.html`
  - lightweight restore selection modal if needed

### Phase Checklist

1. add backup metadata list endpoint
2. rate-limit that endpoint
3. keep response metadata minimal
4. client restore flow fetches backup identities first
5. if one identity exists, select automatically
6. if multiple identities exist, user chooses one
7. client fetches encrypted blob by `username + identityId`
8. decrypt/validate/import remains all-or-nothing
9. overwrite warning explicitly references identity conflict
10. UI no longer relies on username-only restore fallback

### Tests For This Phase

1. One backup identity only:
   - restore still works with no extra friction

2. Two identities A and B:
   - user selects A
   - enters password A
   - restore succeeds

3. Two identities A and B:
   - user selects B
   - enters password B
   - restore succeeds

4. User selects A but enters password B:
   - decrypt fails
   - no partial import occurs

5. Browser currently stores identity B:
   - user selects backup A
   - overwrite warning clearly explains that the browser currently stores a different local identity

6. After restore, user presses `Start`:
   - runtime/session must bind to the selected identity
   - restore must not silently bind back to some other identity

### Current Implementation Status For Restore Targeting

This follow-up phase has now completed the intended implementation checkpoints in code.

What is implemented:

- server exposes a minimal backup metadata list per username
- that metadata list is limited to:
  - `username`
  - `identityId`
  - `createdAt`
  - `updatedAt`
- client restore flow now fetches backup identities first
- if there is one backup identity, client selects it automatically
- if there are multiple backup identities, UI now requires explicit identity selection
- after selection, client fetches the encrypted blob by `username + identityId`
- the new restore UI path no longer relies on username-only fallback behavior

Important implication:

- once an account has both backup A and backup B, entering only `username + password` is no longer enough to know which backup should be restored
- the restore UI must therefore target the chosen `identityId` explicitly
- in the current model, this is still one account label with multiple backup identities, not yet two fully separate authenticated accounts

Current UX rule:

- when the browser already stores a different local identity, overwrite warning now says that restore will replace the current browser identity with the selected target identity

### Manual Testing Observed For Restore Targeting

The following have now been observed manually during testing:

- when the same username has multiple backup identities, `Restore from Cloud` now shows a selector instead of restoring an arbitrary latest backup silently
- the selector shows a shortened identity fragment plus `updatedAt`
- if the user chooses identity A and enters password A, restore can target identity A specifically
- if the user chooses identity B and enters password B, restore can target identity B specifically
- if the user chooses one identity but enters the wrong password for that identity, restore fails generically and does not partially import local state
- when the browser is clean, the restore selector appears because the account has multiple backup identities, not because the browser already stores a local identity
- canceling the selector leaves restore canceled and does not import anything

### Important Current Limitation After Restore Targeting

The project still does not support smooth identity switching inside the same browser by username + password alone.

Practical example:

- browser previously used local identity A
- user logs out
- user then enters the same username but password for identity B
- pressing `Start` still tries to open the existing local vault for A
- this fails with incorrect password rather than automatically switching to B

Reason:

- `Logout` ends the runtime session
- it does not replace or clear the persisted local vault already stored in that browser
- `Start` still means "open the local vault already stored in this browser for this username"
- switching that browser to another identity still requires:
  - targeted restore of the other identity
  - or clearing site data

This is currently a known UX limitation, not a cryptographic failure.

## Browser-Local Identity Switching / Start Failure Guidance

This small UX cleanup phase after restore targeting is now implemented and manually tested.

Goal:

- make it clear what happens when a browser already stores one local identity but the user tries to `Start` with a password that does not unlock it
- keep `Start` semantics narrow and predictable
- keep `Restore from Cloud` as the official way to switch the browser to another identity

### Semantics

`Start` means:

- open the local identity currently stored in this browser for the entered username

`Start` must not:

- guess another identity
- try multiple cloud backups
- auto-restore
- auto-create a new identity if the browser already has a local vault

`Restore from Cloud` means:

- restore a selected cloud identity backup
- if the browser already has a different local identity, overwrite it only after explicit confirmation

`Continue` means:

- create a new local identity when no local vault exists in this browser

It does not mean:

- recover an existing identity just because the user typed a password that was previously used elsewhere

### Implemented Start Failure Guidance

When `Start` fails because the browser already has a local vault but the entered password does not unlock it, the UI should not only say `Incorrect password`.

Current user-facing guidance:

- `The password did not unlock the local identity currently stored in this browser. To use a different identity, restore it from cloud first.`

Important:

- the UI must not claim the entered password belongs to another identity
- the app only knows that the entered password did not unlock the local identity currently stored in this browser

### Manual Testing Observed For Start Failure Guidance

The following have been manually tested:

- browser stores identity A, user enters password A, then `Start` succeeds
- browser stores identity A, user enters password B or another wrong password, then `Start` fails with the new identity-aware guidance message
- switching from A to B works by using `Restore from Cloud`, choosing backup identity B, confirming overwrite, then pressing `Start` with password B
- canceling the overwrite warning leaves the current browser identity unchanged
- after canceling overwrite, `Start` with the original identity password still succeeds

Current status:

- this phase is complete for the intended UX scope
- it does not add multiple local identity profiles inside one browser
- it does not change `Start` semantics

### Restore-As-Switch Flow

If the browser currently stores identity A and the user wants to use identity B:

1. if currently inside chat, `Logout` to return to the pre-start UI
2. enter username
3. enter password B
4. click `Restore from Cloud`
5. choose backup identity B
6. confirm the overwrite warning
7. restore completes
8. enter password B again
9. click `Start`

Important:

- switching happens because restore overwrites the local browser identity
- `Logout` is only a UI step to return to the restore-capable state

### Required Tests

1. Browser stores identity A, user starts with password A:
   - `Start` succeeds

2. Browser stores identity A, user starts with a wrong password or password B:
   - `Start` fails
   - UI explains that the password did not unlock the local identity currently stored in this browser
   - UI suggests restoring another identity from cloud first

3. Browser stores identity A, user restores identity B and confirms overwrite:
   - restore succeeds
   - `Start` with password B succeeds
   - browser now runs as identity B

4. Browser stores identity A, user starts restore of identity B but cancels overwrite:
   - no partial import occurs
   - browser still stores identity A
   - `Start` with password A still succeeds

5. Browser is clean and user chooses `Continue`:
   - app creates a new local identity
   - this is not treated as recovery of an older identity

### Phase 3 - Account To Active Device Routing

Goal:

- stop treating realtime routing as "send to username blindly"
- move toward:
  - send to account
  - route to the current active/preferred device identity

Why this comes before catch-up:

- if routing is still username-blind, later catch-up and pending behavior will inherit that ambiguity

Transitional rule recommended for this phase:

- one active/preferred device per account at a time
- no full multi-device fan-out yet

Safety notes for this phase:

- a websocket session is not considered active/routable until `identity_bind` has completed
- cert selection remains a transitional limitation; this phase does not fully solve active-device certificate selection on the client
- pending/offline delivery remains a transitional limitation; this phase does not make pending queues fully per-device yet

Checkpoint 1 implementation status:

- server runtime now has `accountSessions`
  - `username -> { activeIdentityId, ws }`
- `register` now creates only a temporary websocket session
- session becomes active/routable only after `identity_bind`
- active session replacement is now performed through `accountSessions`
- `cert_submit`, `send`, and `backup_save` now require an active identity-bound account socket
- realtime `send` lookup now uses the active account session instead of a raw username-to-socket map
- session semantics are still intentionally `1 active session / username`

Checkpoint 2 implementation status:

- cert cache items now include active identity metadata for the account when available
- server `cert_signed` broadcasts now include:
  - `identityId`
  - `activeIdentityId`
  - whether the cert is for the active identity
- client now ignores non-active certs when active identity metadata is present
- this keeps the current client `certs[username]` structure transitional, but ensures it points at the active device cert where the server can identify the active device

Remaining limitation:

- client still does not store a full multi-cert map per account
- this is still not full linked-device cert management

Manual testing observed for Account -> Active Device Routing:

- a browser logged in as `Giang` identity B becomes the active account session
- another user such as `Minh` can send to account `Giang`
- server routes the message through `accountSessions` to the active identity/socket
- server logs show the target account plus active identity and an open target socket
- after active cert selection was added, `Minh` encrypts to the active cert for `Giang`
- `Giang` active browser decrypts and displays the message
- after `Giang` identity B receives messages, saving a backup and restoring that backup in another browser preserves enough local state to see the backed-up messages and continue messaging

Current status:

- this phase is working for the intended transitional scope
- runtime routing is now account -> active identity -> socket
- active cert selection works for the current single-active-session model
- session semantics are still intentionally `1 active session / username`
- pending/offline delivery is still transitional and not yet fully per-device

### Account -> Active Device Routing Checkpoint Summary

Checkpoint 1 - server runtime structure:

- completed
- server now keeps `accountSessions`
- `register` creates a temporary websocket session
- `identity_bind` activates the session for routing
- active session replacement is now based on account plus active identity
- semantics remain `1 active session / username`

Checkpoint 2 - message routing through active account session:

- completed
- realtime `send` now looks up the recipient via `accountSessions`
- logs include recipient account and active recipient identity
- messages route to the currently active identity socket

Checkpoint 3 - minimal client/runtime compatibility:

- completed
- server cert cache and cert broadcasts include active identity metadata
- client filters certs using `activeIdentityId` when present
- this prevents senders from encrypting to an old cert when the recipient account has switched active identity

Checkpoint 4 - notes and regression:

- completed
- manual regression confirmed active account routing and active cert selection work in the tested flows
- notes now record that this is still a transitional single-active-device model

Phase conclusion:

- Account -> Active Device Routing is complete for the intended transitional scope
- the system is now closer to `account -> active device identity -> socket`
- the project still does not support full multi-device fan-out or multiple simultaneous active devices under one account
- pending/offline delivery should be the next identity-aware cleanup candidate before large catch-up work

## Pending / Offline Delivery Identity-Aware Cleanup Plan

This is the recommended next phase after Account -> Active Device Routing.

### Why This Phase Exists

Realtime routing now follows the transitional model:

- `account(username) -> activeIdentityId -> socket`

But pending/offline delivery is still transitional and mostly username-based.

That means offline messages can still be queued/flushed too broadly by username, even though the runtime now understands active device identity.

This phase should make pending delivery aware of:

- recipient account
- recipient identity

without implementing full multi-device fan-out.

### Scope

This phase should do:

- persist the last active identity for an account
- queue offline messages with `recipientIdentityId` when known
- flush pending only to the matching identity, plus legacy pending items without identity metadata

This phase should not do:

- multi-device fan-out
- pending delivery to all linked devices
- recent-message catch-up
- full history restore
- Google login/account auth
- full device management UI

### Core Semantics

Current account label:

- `username`

Current device identity:

- `identityId`

When a sender sends to account `Giang`, server should determine the intended recipient identity:

1. if `Giang` is online:
   - use `accountSessions.get("Giang").activeIdentityId`
2. if `Giang` is offline:
   - use the last persisted active identity for `Giang`
3. if no identity is known:
   - fall back to legacy username-only pending
   - log this as transitional fallback

### Recommended Mongo Addition

Add collection:

- `account_active_devices`

Document shape:

```json
{
  "username": "Giang",
  "activeIdentityId": "abc...",
  "updatedAt": "..."
}
```

Index:

```js
{ "username": 1 } unique
```

Purpose:

- remember the last active identity for an account across server restarts

### Pending Message Metadata

Pending messages should add:

```json
{
  "recipientIdentityId": "abc..."
}
```

Recommended if straightforward:

```json
{
  "senderIdentityId": "..."
}
```

Minimum required for this phase:

- `recipientIdentityId`

### Queue Rules

Online recipient:

- route realtime to the active account socket
- no pending write

Offline recipient with known active identity:

- queue pending with:
  - `to`
  - `recipientIdentityId`

Offline recipient without known active identity:

- queue legacy pending without `recipientIdentityId`
- log:
  - `pending queued without recipientIdentityId`

### Flush Rules

When account `Giang` logs in with identity B:

Flush pending messages where:

- `to = Giang`
- and either:
  - `recipientIdentityId = B`
  - or `recipientIdentityId` is missing / legacy

Do not flush messages targeted at identity A into identity B.

Reason:

- ciphertext created for identity A should not be delivered to identity B

### Files Expected To Change

`server/mongo.js`:

- add active device helpers:
  - `saveAccountActiveDevice(username, identityId)`
  - `getAccountActiveDevice(username)`
- add/update pending helpers:
  - enqueue with `recipientIdentityId`
  - fetch pending by `username + identityId`

`server/server.js`:

- persist active device when account session becomes active
- choose offline pending target identity from:
  1. live `accountSessions`
  2. Mongo `account_active_devices`
  3. legacy fallback
- flush pending by matching identity

`client/chat.js`:

- likely no required change if pending message format remains compatible
- client can ignore sender/recipient identity metadata for now

`PROJECT_NOTES.md`:

- track implementation status and test results

### Checkpoints

Checkpoint 1 - active device persistence:

- add `account_active_devices`
- add helpers and index
- persist active identity on session activation

Checkpoint 1 implementation status:

- `account_active_devices` persistence has been added
- Mongo helpers added:
  - `saveAccountActiveDevice(username, activeIdentityId)`
  - `getAccountActiveDevice(username)`
- unique index on `{ username: 1 }` has been added for `account_active_devices`
- server now persists the active identity whenever an account session is activated

Checkpoint 2 - pending metadata on enqueue:

- add `recipientIdentityId` to pending messages when known
- add `senderIdentityId` if straightforward
- keep fallback legacy path if no target identity is known

Checkpoint 2 implementation status:

- pending messages now store `recipientIdentityId` when the server can resolve the intended target identity
- pending messages also store `senderIdentityId` when available from the active sender session
- recipient identity resolution order is:
  1. live `accountSessions`
  2. Mongo `account_active_devices`
  3. legacy fallback with no `recipientIdentityId`
- pending Mongo indexes now include `{ to, recipientIdentityId, ts }`
- legacy fallback remains in place when no active identity can be resolved

Checkpoint 3 - identity-aware pending flush:

- login identity B flushes:
  - pending targeted to B
  - legacy pending without identity metadata
- login identity B does not flush pending targeted to A

Checkpoint 3 implementation status:

- Mongo pending fetch now supports `username + identityId`
- login identity B flushes:
  - pending messages with `recipientIdentityId = B`
  - legacy pending messages without `recipientIdentityId`
- login identity B does not fetch pending messages targeted to identity A
- file fallback pending flush now applies the same identity filter
- cert cache active identity selection now also consults persisted `account_active_devices`, not only currently-online sessions

Bug found during testing:

- offline pending may be tagged for identity B, but the sender can still encrypt using an old cert if the recipient is offline and cert cache only knows live `accountSessions`
- fix: cert cache now uses persisted active device metadata so senders can select the last active cert even when recipient is offline

Manual testing observed for Pending / Offline Delivery Identity-Aware Cleanup:

- `account_active_devices` is created and updated when an account identity becomes active
- logging in with a different identity under the same username updates the same active-device document rather than creating duplicate account records
- offline pending messages now store `recipientIdentityId` when the target identity can be resolved
- `senderIdentityId` is stored on new pending messages when available
- login with the matching identity flushes the targeted pending message
- after the cert-cache fix, offline messages sent to the last active identity can be decrypted and displayed when that identity logs back in
- legacy pending without `recipientIdentityId` remains supported as transitional fallback

Checkpoint 4 - docs and regression:

- completed
- manual testing confirmed active-device persistence, pending metadata, identity-aware flush, and the offline cert-cache fix

Phase conclusion:

- Pending / Offline Delivery Identity-Aware Cleanup is complete for the intended transitional scope
- pending is no longer completely username-blind for new messages
- pending delivery now aligns better with account -> active identity routing
- legacy fallback remains only for old or identity-unknown pending messages

Remaining limitations:

- still no multi-device fan-out
- still no simultaneous active devices under one account
- legacy pending fallback can still flush old username-only items
- recent-message catch-up has not started yet

Checkpoint 4 - docs and regression:

- document results
- confirm pending identity behavior manually

### Tests

Test 1 - active device persistence:

- login `Giang` identity B
- Mongo `account_active_devices` contains:
  - `username = Giang`
  - `activeIdentityId = B`

Test 2 - offline pending to known identity:

- `Giang` identity B goes offline
- `Minh` sends to `Giang`
- pending message contains:
  - `to = Giang`
  - `recipientIdentityId = B`

Test 3 - matching identity flush:

- `Giang` logs back in as identity B
- pending targeted B flushes
- `Giang` receives/decrypts it

Test 4 - do not flush wrong identity:

- create or preserve pending targeted A
- login `Giang` as identity B
- pending targeted A must not flush into B

Test 5 - legacy pending fallback:

- old pending item without `recipientIdentityId` still flushes
- this remains transitional support

Test 6 - restart server:

- active identity B is persisted
- restart server
- while `Giang` is offline, `Minh` sends to `Giang`
- pending still targets B using Mongo active device record

### Success Criteria

This phase is successful if:

- active account identity survives server restart through Mongo
- offline pending messages get `recipientIdentityId` when possible
- pending targeted to identity A is not flushed into identity B
- legacy pending still does not break
- existing realtime routing remains unchanged

### Expected Limitations After This Phase

Still not implemented:

- fan-out to multiple linked devices
- multiple simultaneous active devices per account
- full per-device message history
- recent-message catch-up

But the project becomes safer because:

- pending is no longer completely username-blind
- offline delivery aligns better with active account/device routing

### Phase 4 - Backup / Restore Per Device

Goal:

- make cloud backup clearly represent:
  - account `username`
  - device identity `identityId`

Expected direction:

- one active backup per `username + identityId`
- no blind overwrite between different device identities under the same username
- restore warnings remain strong when current browser identity differs from backup identity

### Phase 5 - Recent-Message Catch-Up

This should only begin after identity model, policy model, and routing model are all stable enough.

Goal:

- fetch a recent window of ciphertext messages from Mongo
- per conversation, only when the user opens that conversation
- decrypt what is possible as a best-effort display recovery
- merge and dedupe safely without breaking live chat state

Not in scope for that phase:

- full history rebuild
- deep pagination
- global sync of every conversation at login
- Google login / account auth
- React UI migration
- committing catch-up ratchet state into the live ratchet state

Core rules to lock before implementation:

- Mongo should query recent messages with `ts` descending for efficient `limit`.
- Server should reverse the selected window to ascending `ts` before returning `history_recent`.
- Client should still sort ascending defensively before any processing.
- Catch-up decrypt must not mutate the live Double Ratchet state.
- This phase only merges display/local history; it does not commit temporary catch-up ratchet state into live state in any case.
- Incoming messages from peer to me may be decrypted best-effort from a temporary/cloned state.
- Outgoing messages from me to peer should prefer existing local plaintext history; do not force re-decrypt outgoing messages in this phase.
- Pending flush happens after login/start and before the user-triggered recent fetch.
- Dedupe must prioritize Mongo `_id`; hash-based dedupe is only a fallback for older local history.

Recommended implementation transport:

- Use WebSocket message types instead of adding a new public HTTP endpoint.
- Client sends:

```js
{
  type: "history_fetch_recent",
  peer: "Minh",
  limit: 50,
  requestId: "..."
}
```

- Server replies:

```js
{
  type: "history_recent",
  peer: "Minh",
  requestId: "...",
  messages: [
    {
      _id: "...",
      from: "Minh",
      to: "Giang",
      senderIdentityId: "...",
      recipientIdentityId: "...",
      envelope: {
        header: "...",
        ciphertextB64: "..."
      },
      ts: 1710000000000
    }
  ]
}
```

Database direction:

- Do not add a new collection for this phase.
- Use the existing `messages` collection.
- Add or verify indexes for recent pair queries.
- Query by `(from = currentUser and to = peer) OR (from = peer and to = currentUser)` for this first phase.
- A normalized `conversationId` is a better long-term schema target, but it is not required for the first catch-up checkpoint.

Client validation rules:

- Validate each server message before decrypt/merge.
- Skip invalid items instead of failing the whole conversation.
- Required minimum fields:
  - `_id`
  - `from`
  - `to`
  - `ts`
  - `envelope.header` or equivalent header field
  - `envelope.ciphertextB64` or equivalent ciphertext field
- Prefer also validating:
  - `senderIdentityId`
  - `recipientIdentityId`

Checkpoint plan:

Checkpoint 1 - server recent history query:

- add Mongo helper for recent messages between two users
- query descending by `ts`, limit to a small window such as 50
- reverse to ascending before returning to the WebSocket layer
- add WebSocket `history_fetch_recent`
- return ciphertext + metadata + Mongo `_id`

Checkpoint 1 implementation status:

- `server/mongo.js` now has `getRecentMessagesForConversation(conversationId, limit)`.
- The helper queries `messages` by `conversationId`, sorts by `ts` descending for the recent window, limits to a safe maximum, then reverses to ascending before returning.
- `server/server.js` now accepts WebSocket `history_fetch_recent`.
- The handler requires an active identity-bound account socket.
- The server replies with `history_recent`, including `_id`, `from`, `to`, `senderIdentityId`, `recipientIdentityId`, `envelope`, and `ts`.
- New saved `messages` documents now include `senderIdentityId` and `recipientIdentityId` for catch-up metadata.
- Syntax checks passed for `server/mongo.js` and `server/server.js`.

Checkpoint 2 - client fetch / validate / dedupe skeleton:

- add `fetchRecentMessages(peer, limit)` in `client/chat.js`
- send request with `requestId`
- await `history_recent`
- validate response shape
- sort ascending defensively
- dedupe by `_id` first, fallback hash only if needed
- do not decrypt yet unless the safe temporary-state path is ready

Checkpoint 2 implementation status:

- `client/chat.js` now tracks pending recent-history requests by `requestId`.
- Added `fetchRecentMessages(peer, limit)`.
- Client sends WebSocket `history_fetch_recent`.
- Client handles `history_recent`.
- Response items are validated before being returned to callers.
- Client sorts returned items ascending defensively even though the server already returns ascending.
- Client dedupes by Mongo `_id` first.
- Hash-style dedupe fallback exists for older/non-standard local comparisons, but `_id` is the primary key.
- No decrypt or UI merge is done in this checkpoint.
- `client/chat.js` syntax check passed through Node's module parser.
- `npm run build` could not complete in the current environment because Vite/esbuild failed to spawn with `EPERM`; this appears environment-related rather than a syntax error.

Checkpoint 3 - safe catch-up decrypt path:

- decrypt recent messages only against a cloned/temporary conversation state
- never mutate live Double Ratchet state during catch-up
- merge only successfully decrypted display messages
- skip decrypt failures without resetting live state
- outgoing local messages should remain sourced from existing local plaintext history

Checkpoint 3 implementation status:

- `client/chat.js` now clones the live messenger state using the existing export/import state helpers before catch-up decrypt.
- Recent catch-up decrypt is attempted only against the cloned `MessengerClient`.
- The live `messenger` instance is not passed to catch-up decrypt and is not saved/committed after catch-up.
- Catch-up currently attempts only inbound `peer -> myUser` messages.
- Outgoing `myUser -> peer` messages remain sourced from existing local plaintext history.
- Successfully decrypted inbound recent messages are converted to local display history entries with `serverId` metadata.
- Decrypt failures are skipped without resetting peer state and without affecting live chat state.
- `mergeRecentMessagesForDisplay(peer, recentItems)` was added as the safe merge entry point for the later UI/open-conversation integration.
- `client/chat.js` syntax check passed through Node's module parser.

Checkpoint 4 - open conversation / UI integration:

- when opening a conversation, render local history first
- then fetch recent messages
- show a small loading state
- merge/dedupe and rerender
- fetch/decrypt failures should not break chat

Checkpoint 4 implementation status:

- `client/ui/app.js` now imports `fetchRecentMessages` and `mergeRecentMessagesForDisplay`.
- `loadHistory(peer)` renders local history first.
- After local render, UI shows a small `Loading recent messages...` pill.
- UI then fetches recent messages with limit `50`.
- UI calls the safe merge path and rerenders merged history.
- If recent fetch/decrypt/merge fails, the local conversation remains usable and a non-blocking info toast is shown.
- `client/ui/style.css` now includes `.history-loading`.
- `client/ui/app.js` syntax check passed through Node's module parser.
- `npm run build` still cannot complete in the current environment because Vite/esbuild fails to spawn with `EPERM`.

Checkpoint 5 - watermark / docs / regression:

- optionally store local watermark per conversation:
  - `lastSeenServerTs`
  - or `lastSeenServerMessageId`
- document limitations and manual test results
- keep watermark as an optimization, not a blocker for phase completion

Checkpoint 5 implementation status:

- No watermark code was added in this checkpoint.
- Watermark remains a future optimization because the current recent catch-up path already dedupes by Mongo `_id` and because adding persistent watermark now would expand scope.
- Documentation was updated to record manual testing observations and current limitations.
- Current phase is considered functionally complete at the first safe catch-up level:
  - server can return recent ciphertext history
  - client can fetch and validate it
  - client can attempt safe best-effort decrypt on a cloned ratchet state
  - UI fetches recent history when opening a conversation
  - live chat state is not intentionally mutated by catch-up

Manual testing observed:

- Existing browser/local vault can start normally after this phase.
- Console showed normal startup logs such as `[chat] restored DR state from vault` and `[chat] ready: Giang`.
- No browser-side `Uncaught` error was observed during the reported console check.
- WebSocket connection appears in DevTools Network as `/ws`.
- `history_fetch_recent` and `history_recent` should be verified under the `/ws` Messages/Frames panel.
- The `requestId` in `history_recent` must match the `history_fetch_recent` request.
- When the user forgot to restore from cloud first and started from an older local vault, local history did not fully match the expected cloud/latest state.
- After the user explicitly used `Restore from Cloud`, the conversation history matched better.

Important limitation discovered:

- `Start` only opens the local vault currently stored in the browser.
- `Start` does not compare local state with cloud backup metadata.
- `Start` does not warn when a newer cloud backup may exist.
- If a user forgets to restore from cloud first, the browser may continue with an older local snapshot.
- This is expected for the current model and should be treated as a UX limitation, not a recent catch-up crash.

Current catch-up limitations:

- Catch-up is recent-window only.
- Catch-up is best-effort.
- Catch-up does not guarantee decrypting every recent message.
- Catch-up currently attempts inbound `peer -> me` messages only.
- Outgoing `me -> peer` messages remain sourced from existing local plaintext history.
- Catch-up does not commit the temporary ratchet state into live state.
- Full history restore is still not implemented.
- No pagination is implemented.
- No cloud/local freshness warning is implemented yet.

Future improvements:

- Add local/cloud backup freshness comparison before or around `Start`.
- Add a non-blocking warning such as: `A cloud backup may be newer than this browser's local data. Restore first if you want the latest backed-up state.`
- Add per-conversation watermark such as `lastSeenServerTs` or `lastSeenServerMessageId`.
- Consider encrypted recent history snapshots if stronger history recovery becomes a product goal.
- Consider IndexedDB for more robust encrypted local history storage.

Regression tests:

- existing local history reload does not duplicate messages
- clean browser restores identity, starts, opens conversation, and fetches recent messages
- pending flush plus recent fetch does not duplicate messages
- wrong identity does not decrypt/merge messages targeted to another identity
- out-of-order/skipped case: sender sends several messages while recipient is offline; catch-up processes ascending and does not break live chat after that
- server restart does not remove the ability to fetch recent ciphertext history from Mongo

Branch / DB guidance:

- create a dedicated branch such as `feature/recent-message-catchup`
- a new Mongo collection is not needed
- a new Mongo database is optional
- use a clean test database if the current DB contains important regression data that should not be disturbed

### Phase 6 - Stronger Account Auth

This remains the last major phase, not the next one.

Goal:

- separate account ownership from crypto identity cleanly
- move from:
  - temporary username-as-account
  - toward a stronger `accountId`

Possible future identity for the account layer:

- Google `sub`
- or an internal account id

At that point:

- backup ownership can stop being username-based
- username can become a display/account label only
- `identityId` remains the device identity

## Phase 2 - V2.1 Identity Policy Cleanup Final Checklist

This is the next recommended implementation phase after the completed `v2 foundation`.

Goal:

- keep the `identityId` data model from Phase 1
- remove the remaining username-blind overwrite behavior
- make policy more identity-aware before any recent-message catch-up work begins

### Step 0: Lock The Starting Point

- commit the current `v2 foundation` state first
- use a clean Mongo test state before Phase 2 testing
- keep browser site data clean between policy tests

### Step 1: Cert Policy Cleanup

Current limitation:

- certs are still effectively treated as one active cert per username

Target direction:

- cert records must be keyed by `username + identityId`
- stop blindly overwriting cert state just because username matches

Practical goal for this phase:

- persist certs by both `username` and `identityId`
- lookup certs by both `username` and `identityId`, not by username alone
- if an identity changes under the same username, that becomes visible in persistence rather than silently replacing the previous cert record

### Step 2: Backup Policy Cleanup

Current limitation:

- cloud backups are still effectively treated as one active backup per username

Target direction:

- backups must be keyed by `username + identityId`

Practical goal for this phase:

- one active backup per identity
- lookup backups by both `username` and `identityId`, not by username alone where identity-specific behavior matters
- no blind overwrite between identity A and identity B under the same username

### Step 3: Session Policy Cleanup

Current limitation:

- runtime session semantics are still effectively `1 active session / username`
- replacement is still username-driven even though session metadata now knows `identityId`

Target direction for this phase:

- keep the current single-active-session semantics for controlled scope:
  - `1 active session / username`
- but make all replacement behavior explicitly identity-aware in logs, warnings, and runtime bookkeeping

Important note:

- this phase does not need to introduce full multi-device parallel delivery
- it only needs to stop the server from behaving as if username alone fully describes the active identity

### Step 4: Restore / Start UX Cleanup

The UI should now consistently describe identity conflicts as identity conflicts.

What this means:

- overwrite warnings should mention current local identity vs backup identity
- session replacement messages should make it clear that one identity replaced another under the same username when relevant
- generic username-only phrasing should be reduced where identity-specific meaning exists

### Step 5: Mongo Schema / Index Direction

Recommended direction:

- `certs`
  - move toward uniqueness by `{ username, identityId }`
- `identity_backups`
  - move toward uniqueness by `{ username, identityId }`

This is the main policy shift for this phase.

It is acceptable if the UI still only exposes a simple active path, as long as persistence is no longer blindly username-only.

### Step 6: File-Level Work

Main files expected to change:

- `server/mongo.js`
  - cert helpers and backup helpers must become identity-aware in storage and lookup
- `server/server.js`
  - runtime policy, replacement behavior, and logging must become identity-aware
- `client/chat.js`
  - runtime assumptions around active cert / active identity must align with the new policy
- `client/ui/app.js`
  - warnings and user-facing conflict messages should reflect identity-aware policy

### Step 7: Regression Tests For Phase 2

Minimum tests:

1. Same username, two different identities:
   - creating identity B after identity A does not silently destroy all record of A in persistence

2. Cert persistence:
   - certs for A and B under the same username are distinguishable by `identityId`

3. Backup persistence:
   - backup for A and backup for B under the same username are distinguishable by `identityId`
   - backup for identity B does not blindly overwrite backup for identity A just because the username matches

4. Restore from identity A while local browser currently has identity B:
   - this is only fully testable once the restore path can target a specific `identityId`
   - after Phase 2 persistence cleanup alone, restore by username is no longer sufficient if multiple backups exist under the same username

5. Session replacement visibility:
   - logs and runtime metadata make it clear which identity replaced which identity

### Step 8: Stop Scope Here

Do not start recent-message catch-up in this phase.

This phase is finished only when:

- cert policy is no longer blindly username-only
- backup policy is no longer blindly username-only
- session/runtime behavior is identity-aware enough to support later account-to-device routing work

### Important Discovery After Phase 2 Checkpoint Testing

During manual testing, an important limitation became explicit:

- after `identity_backups` started being stored by `username + identityId`
- restore-by-username became ambiguous whenever the same username has more than one backup identity

Practical consequence:

- if account `Giang` has backup `A` and backup `B`
- and the current restore UI still only requests:
  - `username`
  - `password`
- then `Restore from Cloud` cannot reliably mean "restore A"

At the current transition point, the server read path may return the latest backup for that username when no explicit `identityId` is supplied.

This means:

- entering password `A` does **not** guarantee restore of identity `A`
- restore may fail simply because the server returned backup `B`
- this is not a crypto bug; it is a restore-selection ambiguity introduced once persistence became identity-aware

Correct interpretation:

- Phase 2 made persistence and policy more correct
- but that correctness exposes that the older username-only restore flow is no longer sufficient

Implication for later phases:

- a later phase must add restore targeting by `identityId`
- or otherwise introduce an explicit backup/device selection flow

Until that is added:

- restore-by-username should be treated as a transitional path only
- and tests that assume "username + password A" always restores identity A are no longer valid once multiple backups exist for the same username

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

## V2 Foundation Roadmap

This is the approved long-term direction after `v1` cloud backup.

Important framing:

- this is not "full v2"
- this is `v2 foundation`
- the goal is to make the system understand `identityId` consistently before any recent-message catch-up work

### Why This Exists

The current architectural weakness is that `username` is still being used like all of these at once:

- account id
- cert owner
- cloud backup owner
- session owner
- crypto identity owner

That is the root cause behind:

- same username but different local identity causing confusion
- cert overwrite behavior that is too username-centric
- cloud backup overwrite ambiguity
- restore behavior that is hard to reason about across browsers

### Core Design Goal

Introduce and consistently use `identityId` as the stable identifier of the crypto identity.

Conceptual split:

1. `Account`
   - currently still represented by `username`
   - later can evolve into Google login or a stronger account id
2. `Crypto Identity`
   - represented by `identityId`
   - tied to key material, certificate, backup payload, and ratchet-related state
3. `Device / Session`
   - browser or machine currently using the identity
   - runtime session metadata should know both `username` and `identityId`

### Scope Of V2 Foundation

This phase will:

- add `identityId` to local vault state
- add `identityId` to cloud backup payloads
- add `identityId` to Mongo `identity_backups`
- add `identityId` to Mongo `certs`
- add `identityId` to client register/session metadata
- make restore validation understand both `username` and `identityId`

This phase will not:

- implement recent-message catch-up
- implement full history restore
- add Google login or stronger account auth
- build a complete compatibility layer for all old test data

### Recommended Data Strategy

For this refactor, the simplest path is:

- use a separate branch
- use either a clean Mongo DB or fully reset the existing test DB
- clear browser local state before serious testing
- do not try to preserve every old test artifact

This is intentional. A half-compatibility layer for old test state would increase risk more than value.

### `identityId` Design

`identityId` should be a stable identifier derived from the cryptographic identity itself.

Recommended approach:

- derive it from the public key fingerprint
- keep the algorithm deterministic so the same restored identity gets the same `identityId`
- derive it from the canonical export of the long-term identity public key, not from temporary session/cert data

Concrete recommended formula for this project:

1. export the long-term identity public key in a fixed JSON shape
2. serialize it using canonical JSON ordering
3. compute `SHA-256`
4. encode the result as `base64url`

This concrete choice should be finalized before code is written, not during partial implementation.

Conceptually:

- same restored identity across browsers -> same `identityId`
- accidental newly-created identity under the same username -> different `identityId`

This requirement is strict:

- the same identity restored in another browser must produce the same `identityId`
- if that property is not true, the entire `v2 foundation` plan becomes unreliable

### Mongo Direction For V2 Foundation

#### `identity_backups`

Target document shape:

```json
{
  "username": "Saka",
  "identityId": "id_abc123",
  "version": 2,
  "ciphertextB64": "...",
  "ivB64": "...",
  "saltB64": "...",
  "kdf": {
    "name": "PBKDF2",
    "hash": "SHA-256",
    "iterations": 100000
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

For `v2 foundation`, keeping one active backup per username is still acceptable if scope needs to stay tight, but the backup document must include `identityId`.

#### `certs`

Target document shape:

```json
{
  "username": "Saka",
  "identityId": "id_abc123",
  "certificate": { "...": "..." },
  "createdAt": "...",
  "updatedAt": "...",
  "active": true
}
```

For this phase, keeping one active cert per username is still acceptable as a scope-saving compromise, but the cert must carry `identityId`.

This is still an intermediate model, not the final long-term multi-identity history model.

Important:

- `1 active cert / username` is a transitional model for `v2 foundation`
- it is not the long-term destination
- it exists only to keep this phase controlled and to avoid mixing the identity foundation work with full multi-identity history support

### Client Data Direction

The local vault must clearly persist:

- `username`
- `identityId`

Cloud backup payload must clearly include:

- `version`
- `username`
- `identityId`
- `repr`
- `digest`
- `exportedAt`

Legacy handling rule for this phase:

- backup payloads that do not contain `identityId` are considered legacy
- legacy payloads should fail on the `v2 foundation` path
- do not build a half-compatibility layer for old payloads in this phase

Restore validation must no longer rely on username alone.

It must validate:

- payload version
- payload username
- payload identityId
- current restore target username
- and, where relevant, whether the browser already contains a different local identity for the same username

### Runtime Direction

When the client registers with the server, the runtime must know:

- username
- identityId

Session semantics for this phase remain intentionally limited:

- keep `1 active session / username`
- but that active session must explicitly carry `identityId`

That same identity metadata must be carried consistently through:

- cert publication
- cert retrieval
- session registration
- cloud backup save/get handling

The key rule for this phase:

- do not let some components reason by username while others reason by identityId

That "halfway state" is more dangerous than the original simpler model.

### Why Catch-Up Must Wait

Recent-message catch-up is still the intended next major phase after this.

But it should only happen after the identity model is clear.

Reason:

- if message sync happens before identity binding is reliable, the client can easily merge or interpret history under the wrong identity assumptions
- that would make debugging much harder than necessary

### V2 Foundation Checklist By File

#### `client/storage.js`

- define how `identityId` is created and stored
- persist `identityId` inside local vault-related state
- upgrade backup payload export to include `identityId`
- upgrade backup payload import validation to require `identityId`

#### `client/chat.js`

- make register/session metadata include `identityId`
- ensure any cert-related metadata exchanged with the server understands `identityId`

#### `client/ui/app.js`

- adjust restore warnings if the browser already has a different local identity for the same username
- keep UX clear when restore would overwrite a different identity, not just any local state
- use stronger wording for the different-identity overwrite case, for example:
  - `This backup belongs to a different local identity than the one currently stored in this browser. Restoring will overwrite the current local identity.`

#### `server/mongo.js`

- extend `identity_backups` helpers to read/write `identityId`
- extend `certs` helpers to read/write `identityId`
- adjust indexes as needed for the chosen intermediate model

#### `server/server.js`

- accept and validate `identityId` in register/session flow
- accept and validate `identityId` in cert-related flow
- accept and validate `identityId` in backup save/get flow where applicable

### Recommended Implementation Order

The order matters. Do not parallelize the conceptual steps too early.

1. Finalize the `identityId` format and derivation method.
2. Put `identityId` into local vault state.
3. Put `identityId` into backup payload version 2.
4. Put `identityId` into Mongo `identity_backups`.
5. Put `identityId` into Mongo `certs`.
6. Put `identityId` into register/session runtime metadata.
7. Tighten restore validation so it reasons about both username and identity.
8. Only after that consider the later catch-up phase.

### V2 Foundation Final Checklist

Use this as the execution checklist before writing code.

#### Step 0: Environment Reset

- use a separate branch for `v2 foundation`
- use a clean Mongo DB or fully reset the existing test DB
- clear browser site data before serious testing
- do not attempt to preserve old test payloads without `identityId`

#### Step 1: Finalize `identityId`

- choose the exact derivation method for `identityId`
- derive it from the canonical export of the long-term identity public key
- use canonical JSON + `SHA-256` + `base64url` encoding unless there is a strong reason to change it before implementation starts
- verify that the same restored identity produces the same `identityId`
- verify that a newly-created accidental identity under the same username produces a different `identityId`

#### Step 2: Upgrade Local Vault State

- persist `identityId` in the persisted vault payload itself, and make sure runtime can load it again after reload/restore
- ensure newly-created identities always get an `identityId`
- ensure restored identities load the same `identityId` again

#### Step 3: Upgrade Backup Payload To Version 2

- add `identityId` to the encrypted backup payload
- move backup export logic to `version: 2`
- treat payloads without `identityId` as legacy and fail them on the `v2` path

#### Step 4: Upgrade Mongo `identity_backups`

- store `identityId` in `identity_backups`
- keep the chosen active-backup semantics stable during this phase
- verify backup save/get returns data consistent with the same identity

#### Step 5: Upgrade Mongo `certs`

- store `identityId` in `certs`
- keep the chosen active-cert semantics stable during this phase
- verify cert metadata no longer relies on username alone

#### Step 6: Upgrade Register / Session Runtime

- include `identityId` in register/session metadata
- keep current semantics: `1 active session / username`
- ensure that active session also knows the bound `identityId`

#### Step 7: Upgrade Restore Validation And UX

- validate backup payload by both `username` and `identityId`
- if browser already has a different local identity for the same username, show the stronger overwrite warning
- do not silently treat different local identities as equivalent just because the username matches
- if validation fails, restore must fail completely and must not write any partial local state

#### Step 8: Regression Test Foundation

- same identity across 2 browsers -> same `identityId`
- same username but accidental new identity -> different `identityId`
- browser A has old identity A, browser C creates accidental new identity B under the same username, then restoring the old backup must warn correctly and bring the browser back to identity A
- export backup from identity A and confirm the backup payload metadata is `version: 2` and includes `identityId`
- `identity_backups` contains `identityId`
- `certs` contains `identityId`
- register/session carries `identityId`
- restore validation rejects legacy payloads without `identityId`
- restart server and verify backup retrieval + restore still bind to the correct `identityId`

#### Step 9: Stop Scope Here

- do not start recent-message catch-up until the above checklist is stable
- do not start Google login/auth redesign in the same phase

### Main Risks

The biggest risks in this phase are:

1. Halfway adoption
   - some paths use `identityId`
   - other paths still behave purely by `username`
2. Regression in existing flows
   - login
   - cert publication/retrieval
   - cloud backup save/restore
   - single active session
3. Over-investing in compatibility for old test data
   - not worth it for current project stage

### Success Criteria For V2 Foundation

This phase should be considered successful if:

1. Every local identity has a stable `identityId`.
2. Restored copies of the same identity keep the same `identityId`.
3. Newly-created accidental identities under the same username get a different `identityId`.
4. Cloud backup documents include `identityId`.
5. Cert documents include `identityId`.
6. Register/session metadata includes `identityId`.
7. Restore validation no longer reasons by username alone.
8. Restarting the server does not break backup retrieval or identity binding.

### Additional Test For V2 Foundation

#### Restart Server

After backup has been saved:

1. restart the server
2. restore the backup in another browser
3. confirm the backup is still retrievable
4. confirm the restored payload still resolves to the correct `identityId`
5. confirm `Start` after restore still binds to the correct identity

### What Comes After

Only after this foundation is stable should the next phase begin:

- recent-message catch-up

That later phase should still be intentionally limited to:

- recent window only
- conversation-scoped fetch
- dedupe and merge
- no full history rebuild yet

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

## Phase: Cloudflare / Public Readiness

### Goal

Prepare the app to run outside `localhost`, especially through Cloudflare Tunnel or a later custom domain.

This phase is intentionally narrow:

- remove direct client dependency on hardcoded `localhost`
- make WebSocket URL public-ready
- make backup/restore HTTP API base public-ready
- make server routing cleaner for `/ws`, `/api/...`, and static UI serving
- keep all existing crypto, identity, backup payload, pending, and recent catch-up logic unchanged

This is a readiness phase, not a complete production deployment phase.

### Core Network Rule

Default behavior should be same-origin when the app is served publicly.

Example public shape:

- UI: `https://chat.example.com`
- API: `https://chat.example.com/api/...`
- WebSocket: `wss://chat.example.com/ws`

Local Vite development remains a special case:

- UI: `http://localhost:5173`
- backend/API/WS: `http://localhost:3000`, `ws://localhost:3000/ws`

Override config is supported for special debugging/deployment cases, but the normal public path should not rely on hardcoded `localhost`.

### Checkpoint 1: WebSocket URL Resolver

Completed in `client/chat.js`.

Changes:

- replaced direct hardcoded `ws://localhost:3000/ws`
- added runtime WebSocket URL resolver
- local Vite dev on `localhost:5173` still maps to `ws://localhost:3000/ws`
- public `https://...` pages map to `wss://.../ws`
- public `http://...` pages map to `ws://.../ws`
- optional overrides are supported through runtime/global/Vite config

Supported override keys include:

- `globalThis.__CHAT_CONFIG__.WS_URL`
- `globalThis.__CHAT_WS_URL__`
- `VITE_CHAT_WS_URL`
- `VITE_WS_URL`

Local regression result:

- WebSocket still connects with status `101`
- local realtime chat still works

### Checkpoint 2: Backup / Restore API Base

Completed in `client/chat.js`.

Changes:

- added HTTP API base resolver
- both backup endpoints now use the normalized API base
- restore identity list endpoint remains covered
- restore target fetch endpoint remains covered

Relevant endpoints:

- `GET /api/backups/:username`
- `GET /api/backup/:username?identityId=...`

Supported override keys include:

- `globalThis.__CHAT_CONFIG__.API_BASE_URL`
- `globalThis.__CHAT_CONFIG__.HTTP_BASE_URL`
- `VITE_CHAT_API_BASE_URL`
- `VITE_API_BASE_URL`
- `VITE_CHAT_HTTP_BASE_URL`
- `VITE_HTTP_BASE_URL`

Local regression result:

- cloud backup still works
- cloud restore still works
- multiple backup identity selection still works

### Checkpoint 3: Server Routing Cleanup

Completed in `server/server.js`.

Changes:

- added explicit route helpers for:
  - `/api/...`
  - `/ws`
  - static UI files
- HTTP requests to `/ws` return `426 Use WebSocket to connect`
- unknown `/api/...` paths return JSON, not HTML fallback
- WebSocket upgrade now checks parsed URL pathname
- static UI serving resolves paths more safely
- static UI fallback returns `index.html` for non-API/non-WS paths
- added optional `PUBLIC_BASE_URL` log support

Local regression result:

- `http://localhost:3000/ws` returns `Use WebSocket to connect.`
- `http://localhost:3000/api/not-found` returns JSON:
  - `{"ok":false,"error":"Not found"}`
- Start, realtime chat, backup, restore, and recent history still work locally

### Public Tunnel Static Module Fix

Completed in `server/server.js` after testing with Cloudflare Quick Tunnel.

Problem found during public tunnel testing:

- the public URL loaded `index.html`
- browser then requested module imports such as `/chat.js` and `/storage.js`
- the backend static server originally served only `client/ui`
- missing JavaScript module paths fell back to `index.html`
- browser rejected them because it expected JavaScript but received `text/html`

Observed browser error:

- `Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of text/html`

Fix:

- backend static serving now exposes the required browser modules:
  - `/chat.js`
  - `/storage.js`
  - `/crypto/...`
- missing file paths with extensions return `404` instead of falling back to `index.html`
- UI fallback to `index.html` is kept only for non-API/non-WS app routes

Result:

- Cloudflare public URL can load the app without module MIME errors
- public app can connect through `wss://.../ws`
- Start and realtime chat can be tested through the temporary Cloudflare URL

### Local Test Checklist

Use two terminals:

1. `npm start`
2. `npm run dev`

Then test:

- open `http://localhost:5173`
- start an existing identity
- verify WebSocket status is `101`
- send a realtime message between two users
- backup to cloud
- restore from cloud
- verify recent-message catch-up still triggers when opening a conversation
- open `http://localhost:3000/ws`
- open `http://localhost:3000/api/not-found`

Expected local behavior:

- local Vite still works
- local backend still runs on port `3000`
- no `No server config` error
- no WebSocket regression
- no backup/restore regression

### Cloudflare Tunnel Test Checklist

After local regression passes, test through a public tunnel.

Example tunnel shape:

- Cloudflare public URL: `https://<temporary-name>.trycloudflare.com`
- local target: `http://localhost:3000`

Expected public behavior:

- UI loads through the public `https://...` URL
- DevTools Network shows WebSocket connecting to `wss://.../ws`
- no browser mixed-content error
- `Start` works
- realtime chat works
- `Backup to Cloud` works
- `Restore from Cloud` works
- recent-message catch-up still works

Important:

- Cloudflare Tunnel test should happen after local regression, not instead of local regression.
- The public client must not attempt to connect to `localhost`.
- If the page is loaded via HTTPS, WebSocket must use WSS.

### Current Non-Goals

This phase does not implement:

- production account authentication
- Google login / Firebase Auth
- custom domain purchase
- production monitoring
- production-grade rate limiting across all endpoints
- IndexedDB vault migration
- React UI rewrite
- full multi-device fan-out
- full message history sync

### Next Practical Step

After this phase is committed and pushed:

1. test the app locally one more time
2. run Cloudflare Tunnel against the local backend
3. open the temporary Cloudflare HTTPS URL
4. verify the app uses `wss://.../ws`
5. only after that consider buying and attaching a custom domain

## Phase: Conversation Inbox / Auto Peer Discovery

### Goal

Improve chat UX so a user does not need to manually type a peer name after receiving a first message.

Current direction:

- keep scope client-side
- do not change Double Ratchet
- do not change Mongo schema
- do not implement unread badges yet
- do not implement server-side conversation list yet

The phase focuses on automatically learning conversation peers from real chat activity.

### Checkpoint 1: Realtime Incoming Peer Discovery

Completed in `client/chat.js` and `client/ui/app.js`.

Problem:

- when a new peer sent a realtime message, the message could be decrypted and stored
- but the UI notification only fired when that peer was already the currently open conversation
- therefore the sidebar might not immediately show the new sender
- user could still need to manually type the peer name

Fix:

- `client/chat.js` now calls `window.onChatMessage` for every successfully decrypted inbound realtime message
- the event includes:
  - `from`
  - `text`
  - `ts`
  - `isCurrentPeer`
- `client/ui/app.js` always learns the sender with `ensurePeerInDirectory(from)`
- sidebar is re-rendered immediately
- if the sender is the current peer, the message is appended to the open chat
- if the sender is not the current peer, the UI shows a lightweight `New message from ...` toast

Expected behavior after checkpoint 1:

- Alice is online
- Bob sends Alice a first realtime message
- Alice's sidebar automatically shows Bob
- Alice can click Bob and open that conversation without manually typing Bob's username

Test recommendation:

- use fresh demo accounts to avoid old history/state noise
- run through Cloudflare public URL or local URL
- avoid mixing old `Giang`/`Minh` data if those identities have known history inconsistencies

### Checkpoint 2: Pending / Offline Peer Discovery

Completed in `client/chat.js`.

Goal:

- when a peer sends a message while the user is offline
- after pending messages are flushed on next Start
- the sender should appear in the sidebar automatically

Implementation notes:

- pending/offline messages already flow through the same decrypt path as realtime messages
- after server flushes pending messages, packets are decrypted by `processCipherPacket(...)`
- peer discovery now goes through shared helper `rememberConversationPeer(peer)`
- the helper ignores empty peer names
- the helper does not add the current user as a peer
- peer is persisted only after decrypt succeeds and the plaintext message is stored in local history

Important rule locked by this checkpoint:

- do not learn/persist a peer from raw ciphertext alone
- only learn the peer after successful decrypt and valid local history write

Expected behavior after checkpoint 2:

- Alice is offline
- Charlie sends Alice a message
- Alice starts again
- pending message is flushed and decrypted
- Alice's sidebar automatically shows Charlie
- Alice can click Charlie and open the pending message

Regression checks:

- no manual peer typing is required after pending flush
- the app must not add Alice herself as a conversation peer
- decrypt failure must not create a ghost peer in the sidebar

Test result:

- checkpoint 2 was tested with demo users after checkpoint 1
- pending/offline peer discovery behaved as expected

### Checkpoint 3: Recent Merge Peer Persistence

Completed in `client/chat.js` and `client/ui/app.js`.

Goal:

- when recent catch-up merges messages involving a peer
- that peer should be learned and persisted in the local conversation list
- this is not full conversation discovery from the server
- this only ensures the chosen peer remains persisted after recent merge

Implementation notes:

- `mergeDisplayMessagesIntoLocalHistory(peer, displayMessages)` now uses the shared helper `rememberConversationPeer(peer)`
- this keeps recent merge behavior consistent with realtime and pending peer discovery
- self-peer guard still applies through the shared helper
- UI refreshes the sidebar after a successful recent/local merge with non-empty history
- empty or failed recent fetch does not create a new peer

Important scope clarification:

- this checkpoint does not scan MongoDB for all possible conversations
- this checkpoint does not implement full history synchronization
- this checkpoint does not guarantee both sides have identical full timelines
- it only keeps the currently selected peer persisted after a valid recent/local history merge

Regression checks:

- opening an existing conversation keeps the peer in the sidebar
- reloading and starting again should keep the peer if it is in the vault conversation index
- typing a random peer with no certificate/history should not create a sidebar entry
- recent fetch failure remains non-blocking

Test result:

- test with random peer name showed no ghost peer was added
- `Random` did not appear in `CONVERSATIONS`
- UI showed a certificate guidance toast instead:
  - `Peer "Random" has no certificate yet. Ask them to click Start.`

### Checkpoint 4: Reload Persistence Regression

Completed in `client/ui/app.js`.

Goal:

- test reload behavior
- confirm learned peers remain after reload because they are stored in the vault conversation index
- ensure UI does not keep stale active peer state after Start/reload

Implementation notes:

- `currentPeer` is reset to `null` after successful `Start` before peers are reloaded from vault
- peer list is still loaded from the vault conversation index via `syncPeersFromVault()`
- this prevents stale active peer/highlight behavior from a previous runtime session

Expected behavior after checkpoint 4:

- Alice has learned Bob and Charlie
- Alice reloads the page
- Alice starts again on the same origin
- Bob and Charlie still appear in `CONVERSATIONS`
- clicking Bob opens Bob's local history
- clicking Charlie opens Charlie's local history
- no old peer remains incorrectly active before user chooses a conversation

Test result:

- reload persistence was tested after checkpoint 3
- learned peers remained visible after reload/start
- clicking peers opened the expected local histories

### Checkpoint 5: Final Notes And Regression

Completed in `PROJECT_NOTES.md`.

Final regression checklist for this phase:

- realtime new peer:
  - Bob sends Alice a first realtime message
  - Alice's sidebar shows Bob without Alice typing Bob manually
- pending/offline new peer:
  - Alice is offline
  - Charlie sends Alice a message
  - Alice starts again
  - Charlie appears in Alice's sidebar after pending flush/decrypt
- recent/local merge:
  - opening a conversation with valid history keeps that peer persisted
  - typing a random peer with no certificate/history does not create a ghost sidebar entry
- reload persistence:
  - learned peers remain visible after reload and Start
  - clicking a learned peer opens the corresponding local history
- self-peer guard:
  - local outgoing messages do not add the current user as a peer

Phase result:

- the sidebar now learns peers from successful realtime inbound messages
- pending/offline messages reuse the same decrypt-success peer discovery path
- recent/local history merge uses the same peer persistence helper
- reload persistence is backed by the vault conversation index

### Non-Goals For This Phase

- unread count
- notification center
- search UI
- group chat
- archive/mute conversation
- server-side conversation list
- full history synchronization

### Remaining Limitations

- conversation list is still local-vault based, not a server-side inbox
- conversations are sorted alphabetically, not by latest message time
- there is no unread count
- there is no last-message preview
- full history synchronization is still a separate future phase
- if a message cannot be decrypted, the sender is not learned as a conversation peer

### Recommended Next Improvements

After this phase, the most practical follow-up UX improvements are:

1. Sort conversations by latest message time.
2. Add last-message preview.
3. Add unread count/badge.
4. Later, consider a server-side encrypted inbox index if the product needs cross-device conversation discovery.

## Phase: Conversation Ordering + Preview

### Goal

Make the conversation sidebar closer to a real chat app:

- store local conversation metadata
- show the latest message preview
- order conversations by newest message first
- keep fallback compatibility with the old peer index

This phase remains local-vault based. It does not add server-side inbox, unread badges, full history sync, or multi-device conversation sync.

### Metadata Model

Metadata is stored inside the encrypted local vault.

Minimal shape:

- `peer`
- `lastMessageAt`
- `lastMessagePreview`
- `updatedAt`

Rules:

- update metadata only after a message is valid
- inbound/pending updates happen only after decrypt succeeds
- outgoing updates happen only after local save succeeds
- recent merge must not roll preview backward with older messages
- do not create metadata for the current user as a peer
- old peer index remains the fallback source for legacy conversations

### Checkpoint 1: Conversation Metadata Storage Foundation

Completed in `client/storage.js`.

Changes:

- added vault key:
  - `__securechat_conversation_meta_v1__`
- added helper normalization for:
  - preview text
  - timestamps
- added metadata map helpers:
  - `readConversationMetadataMap()`
  - `writeConversationMetadataMap()`
- added public APIs:
  - `upsertConversationMetadata(peer, patch)`
  - `getConversationMetadata(peer)`
  - `listConversationMetadata()`

Compatibility behavior:

- `__securechat_conversations_v1__` remains supported
- `listConversationMetadata()` includes peers from the old peer index even if they do not have metadata yet
- no existing conversation peers should disappear after this checkpoint

Test result:

- checkpoint 1 was tested after fixing MongoDB Atlas Network Access
- existing user could Start successfully
- existing sidebar peers remained visible
- existing conversations could still be opened

### Environment Note: MongoDB Atlas IP Whitelist

During checkpoint 1 testing, `npm start` failed with:

- `MongoServerSelectionError`
- `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`
- `ReplicaSetNoPrimary`

Root cause:

- current public IP was not allowed in MongoDB Atlas Network Access

Fix:

- add the current IP address in MongoDB Atlas Network Access

Related Cloudflare symptom:

- `cloudflared tunnel --url http://localhost:3000` may still create a public URL
- but it fails with `Unable to reach the origin service` if `npm start` did not successfully start the backend on port `3000`

Rule:

- always make sure `npm start` reaches `Mongo connected` before testing Cloudflare Tunnel

### Checkpoint 2: Realtime Metadata Updates

Completed in `client/chat.js`.

Goal:

- update metadata after outgoing message is saved locally
- update metadata after inbound realtime message is decrypted and saved
- keep self-peer guard
- use message timestamp if valid, otherwise fallback to `Date.now()`

Implementation notes:

- imported `upsertConversationMetadata(...)` from `client/storage.js`
- added helper `messageTimestamp(...)`
- added helper `updateConversationMetadataFromMessage(...)`
- outgoing messages update metadata only after local history is written
- inbound messages update metadata only after decrypt succeeds and local history is written
- preview is trimmed before saving
- metadata is not created for the current user as a peer

Expected behavior after checkpoint 2:

- Alice sends Bob a realtime message
- Alice's local metadata for Bob stores the latest timestamp and preview
- Bob decrypts the message
- Bob's local metadata for Alice stores the latest timestamp and preview
- existing sidebar behavior remains unchanged until the later UI checkpoint

Test result:

- checkpoint 2 should be tested by sending messages both directions between two demo users
- UI preview/order is not expected to change yet because checkpoint 4 will render metadata

### Checkpoint 3: Pending + Recent Metadata Updates

Completed in `client/chat.js`.

Goal:

- pending should be covered by inbound decrypt path
- recent merge should update metadata only when the newest merged/local message is newer than existing metadata
- recent must not roll preview backward

Implementation notes:

- pending/offline messages already use `processCipherPacket(...)`, so they reuse the realtime inbound metadata update path from checkpoint 2
- imported `getConversationMetadata(...)` from `client/storage.js`
- added helper `latestDisplayMessageForPeer(...)`
- added helper `updateConversationMetadataIfNewer(...)`
- recent merge checks the latest decrypted/displayable message from the peer
- recent merge updates metadata only if the candidate timestamp is not older than existing metadata

Important rule:

- recent catch-up must not roll `lastMessagePreview` or `lastMessageAt` backward with older messages
- failed or empty recent decrypt does not update metadata

Expected behavior after checkpoint 3:

- pending/offline inbound messages update preview metadata after decrypt
- recent merge can fill metadata for a peer if the merged message is newer
- recent merge does not overwrite a newer preview with an older recovered message

### Checkpoint 4: Sidebar Ordering + Preview UI

Completed in `client/ui/app.js` and `client/ui/style.css`.

Goal:

- render sidebar from conversation metadata
- sort by `lastMessageAt` descending
- fallback alphabetical for peers without timestamp
- show truncated preview under peer name

Implementation notes:

- `client/ui/app.js` imports `listConversationMetadata(...)` from `client/storage.js`
- UI keeps an in-memory metadata map keyed by normalized peer
- `syncPeersFromVault()` loads metadata from the vault and still falls back to the old peer index through `listConversationPeers()`
- `renderPeerList()` now builds sidebar rows from metadata-aware render items
- conversations with newer `lastMessageAt` appear first
- peers without metadata still render, sorted alphabetically after timestamp comparison fallback
- each row shows:
  - avatar
  - peer name
  - latest message preview when available
- preview is trimmed and truncated in the UI
- after send, incoming message, and recent merge, the UI refreshes sidebar metadata from the vault

Expected behavior after checkpoint 4:

- Bob sends Alice a message, Bob appears in Alice's sidebar with that preview
- Charlie sends Alice a newer message, Charlie moves above Bob
- Alice sends Bob a newer message, Bob moves back to the top on Alice's sidebar
- reload + Start keeps the ordering and preview because metadata is stored in the local vault
- old peers without metadata are still visible

### Checkpoint 5: Backward Compatibility + Backfill

Completed in `client/chat.js` and `client/ui/app.js`.

Goal:

- old peer index still renders
- opening a legacy conversation can backfill metadata from its latest local message
- no forced migration on Start

Implementation notes:

- `openConversation(peer)` now reads the local history and backfills metadata from the newest valid local message
- backfill considers both directions in the local conversation:
  - peer -> local user
  - local user -> peer
- backfill skips self conversations and invalid/empty messages
- backfill uses the same "only if newer" rule as recent merge, so it should not roll preview/timestamp backward
- Start still does not force a full metadata migration
- `loadHistory(peer)` refreshes sidebar metadata after `openConversation(peer)` so legacy preview/order appears when the user opens that conversation

Expected behavior after checkpoint 5:

- a legacy peer without metadata still appears from the old peer index
- clicking that peer opens local history
- after opening it, sidebar gains preview and timestamp metadata if local history has a valid latest message
- reload + Start keeps the backfilled preview because it is persisted in the vault metadata map

### Checkpoint 6: Docs + Final Regression

Completed in `PROJECT_NOTES.md`.

Final behavior:

- conversation sidebar uses local vault metadata when available
- each conversation can show:
  - peer name
  - latest message preview
  - ordering based on `lastMessageAt`
- newest conversation appears first
- old peers from the legacy peer index still render even if metadata is missing
- opening an old conversation can backfill metadata from local history
- metadata is local-vault data, not a server-side inbox
- metadata is updated only after a message is valid for the relevant path:
  - outgoing after local save succeeds
  - realtime inbound after decrypt succeeds
  - pending inbound after decrypt succeeds
  - recent merge after a valid display message is merged

Important rules:

- do not create metadata for self conversations
- do not update metadata from undecrypted ciphertext
- recent/backfill must not roll preview backward if current metadata is newer
- Start does not force a full migration; backfill is lazy when opening a conversation

Remaining limitations:

- no unread badge yet
- no server-side conversation inbox yet
- conversation metadata is per browser/local vault
- metadata is not a replacement for backup/restore
- multi-device metadata consistency is not complete
- if a browser has no restored/local vault, it cannot infer full conversation state just from the server

Final regression checklist:

- Realtime preview:
  - Bob sends Alice a message
  - Alice sidebar shows Bob with preview
- Ordering:
  - Charlie sends Alice a newer message
  - Charlie moves above Bob
  - Alice sends Bob a newer message
  - Bob moves back above Charlie
- Pending/offline:
  - Alice offline
  - Bob sends Alice a message
  - Alice starts again
  - pending message decrypts
  - Bob preview/order updates after decrypt
- Recent merge:
  - open a conversation that triggers recent catch-up
  - no duplicate obvious messages
  - preview does not roll back to an older message
- Reload persistence:
  - reload the browser
  - Start same user
  - sidebar still shows peers, ordering, and previews
- Legacy backfill:
  - old peer without metadata still appears
  - click the peer
  - preview appears if local history has a valid latest message
- Negative checks:
  - no self peer appears in sidebar
  - failed decrypt does not create a fake peer/preview
  - sending to peer without certificate still shows the existing certificate warning

Phase conclusion:

- Conversation Ordering + Preview is complete for local-vault metadata scope
- the sidebar is now closer to a normal chat app:
  - learned peers appear automatically
  - recent conversations rise to the top
  - previews persist across reload on the same origin
- next likely UI step is unread state or better visual design
- next likely architecture step is account/auth or server-side encrypted inbox depending on product priority

## Phase: React UI Migration

### Goal

Move the browser UI from vanilla DOM-imperative code to React while keeping the existing chat/runtime/storage architecture intact.

Locked scope for this phase:

- replace `client/ui/app.js` ownership with React progressively
- keep `client/chat.js` as the chat/session/WebSocket/Double Ratchet runtime
- keep `client/storage.js` as the vault/local metadata/backup payload runtime
- do not change backend routes, WebSocket protocol, Mongo schema, or crypto flow unless a migration blocker is discovered

Important migration rule:

- React and the old vanilla UI must not co-own the same DOM tree
- every major flow must have exactly one owner during migration
- window runtime callbacks must eventually be owned by a single bridge layer, not by multiple components or mixed legacy handlers

### Checkpoint 1: Legacy UI Inventory And Baseline

Completed as a documentation checkpoint before changing the UI entry.

Purpose:

- freeze the current UI surface area before React work begins
- identify the runtime contract that the React layer must preserve
- create a regression baseline so later checkpoints can be tested for parity instead of guessed from memory

Current vanilla UI files:

- `client/ui/app.js`
- `client/ui/index.html`
- `client/ui/style.css`

Current DOM ids used directly by `client/ui/app.js`:

- `username`
- `password`
- `passwordField`
- `startBtn`
- `restoreBtn`
- `backupBtn`
- `logoutBtn`
- `status`
- `to`
- `peerList`
- `peerEmpty`
- `messages`
- `msg`
- `sendBtn`
- `backupModal`
- `backupPassword`
- `backupPasswordToggle`
- `backupModalCancel`
- `backupModalConfirm`
- `startGuardModal`
- `startGuardCancel`
- `startGuardRestore`
- `startGuardContinue`
- `restoreChoiceModal`
- `restoreIdentityList`
- `restoreChoiceCancel`

Current runtime API consumed by the vanilla UI from `client/chat.js`:

- `initChat(...)`
- `sendMessage(...)`
- `openConversation(...)`
- `fetchRecentMessages(...)`
- `mergeRecentMessagesForDisplay(...)`
- `destroyChat()`
- `listConversationPeers()`
- `isPeerReady(...)`
- `onPeerReady(...)`
- `saveCloudBackup(...)`
- `fetchCloudBackup(...)`
- `fetchCloudBackupIdentities(...)`

Current runtime API consumed by the vanilla UI from `client/storage.js`:

- `initVault(...)`
- `hasPersistedVault(...)`
- `exportIdentityPayload(...)`
- `verifyPersistedVaultPassword(...)`
- `encryptIdentityPayload(...)`
- `decryptIdentityPayload(...)`
- `importIdentityPayload(...)`
- `loadIdentityMetadata()`
- `listConversationMetadata()`

Current window runtime callbacks between `client/chat.js` and the UI:

- `window.onChatMessage`
- `window.onForcedLogout`
- `window.onChatDisconnected`

Current callback direction:

- `client/chat.js` emits those callbacks
- `client/ui/app.js` assigns handlers for those callbacks

Migration invariant introduced by this checkpoint:

- later React checkpoints should move callback ownership behind one bridge layer
- React components should not assign `window.onChatMessage` / `window.onForcedLogout` / `window.onChatDisconnected` directly in multiple places

Baseline user-visible behavior that later checkpoints must preserve:

- `Start` initializes or loads the local vault and opens the chat session
- `Logout` saves state and clears the active UI session
- disconnect changes the UI to `Disconnected`, shows password again, and requires manual reconnect
- realtime send/receive continues to work
- pending/offline flush continues to work after the user starts again
- recent-message catch-up remains best-effort and must not block local history usage
- sidebar conversation ordering + preview remains local-vault based
- sending to a peer without a certificate still shows the existing readiness warning
- backup to cloud still requires an active session and password verification
- restore from cloud still requires explicit identity selection when multiple backup identities exist
- restore success still clears the password field and does not auto-start the session

Regression checklist introduced by this checkpoint:

- local Start success with an existing vault
- Start failure with an incorrect password for the existing local vault
- manual reconnect after server disconnect
- realtime send/receive both directions
- pending/offline delivery after recipient comes back online
- recent catch-up opens and merges without obvious duplicate messages
- conversation ordering + preview persists after reload
- backup success and backup wrong-password handling
- restore single identity
- restore multiple identities
- restore cancel without overwriting local vault

Checkpoint result:

- no runtime behavior changed yet
- the legacy UI contract is now documented explicitly
- later React checkpoints can be validated against this baseline instead of relying on memory

### Checkpoint 2: React Shell And Entry Ownership Switch

Completed in:

- `client/ui/index.html`
- `client/ui/main.jsx`
- `client/ui/App.jsx`
- `client/ui/style.css`
- `package.json`

Goal:

- move the browser UI entry from the vanilla script to a React root
- ensure the old DOM-imperative UI is no longer mounted in parallel with React
- keep this checkpoint intentionally narrow by not reconnecting chat/runtime logic yet

Changes:

- added `react` and `react-dom` to the project dependencies
- `client/ui/index.html` now mounts a single `#root` container
- the old `<script type="module" src="./app.js">` entry was removed from the active HTML path
- added `client/ui/main.jsx` as the React entry point
- added `client/ui/App.jsx` as the first React-rendered shell
- kept the existing CSS file and extended it with a few migration-only shell styles
- updated `npm start` to build the frontend before the backend boots
- updated `server/server.js` to prefer serving `dist/` when a built frontend is available

Important behavior change for this checkpoint:

- this checkpoint intentionally pauses interactive chat behavior in the active UI
- the app now renders a React shell with disabled controls and a migration notice
- this is temporary and expected at this stage
- runtime/chat parity will resume only after the bridge and UI wiring checkpoints are completed

Important migration win from this checkpoint:

- React now owns the active DOM tree
- `client/ui/app.js` is preserved in the repository for reference, but it is no longer loaded by `index.html`
- this removes the main risk of React and the old vanilla handlers co-owning the same DOM tree
- backend-served UI and quick tunnel can now render the built React shell instead of trying to execute raw source JSX

Checkpoint result:

- the app should load through React instead of the vanilla entry
- the screen should clearly show that this is the React shell checkpoint
- buttons and inputs should be visibly disabled
- interactive chat is intentionally unavailable until the next checkpoints reconnect the runtime

### Checkpoint 3: Runtime Bridge And React State Foundation

Completed in:

- `client/ui/lib/chatRuntimeBridge.js`
- `client/ui/hooks/useChatApp.js`
- `client/ui/App.jsx`
- `client/ui/style.css`

Goal:

- move runtime callback ownership out of the legacy UI file and into one React-side bridge
- establish a reducer-driven React state model before reconnecting auth/chat flows
- keep this checkpoint focused on architecture plumbing rather than restoring full interactivity

Changes:

- added `chatRuntimeBridge.js` as the single place that installs and removes:
  - `window.onChatMessage`
  - `window.onForcedLogout`
  - `window.onChatDisconnected`
- added `subscribeToChatRuntime(...)` so React can subscribe without assigning `window.*` handlers directly
- added `useChatApp()` with a reducer-based state model for:
  - bridge installation status
  - runtime listener count
  - latest runtime event type
  - basic event snapshot fields for future UI wiring
- updated the React shell to show bridge diagnostics instead of only static migration text

Important rule locked by this checkpoint:

- React components must not assign `window.onChatMessage` / `window.onForcedLogout` / `window.onChatDisconnected` directly
- all runtime callback ownership now goes through the bridge layer
- later checkpoints should extend reducer actions instead of scattering many unrelated `useState` fields across the tree

Expected behavior after this checkpoint:

- the app still renders the React shell, not the old vanilla UI
- auth/chat controls remain intentionally disabled
- the sidebar now shows runtime bridge diagnostics
- the center card now shows reducer-backed runtime snapshot fields
- refreshing the page should not create stacked callback handlers because the bridge installs/uninstalls through one subscription path

Checkpoint result:

- the React UI now has the correct ownership boundary for runtime events
- the reducer foundation is ready for the next checkpoints to reconnect `Start`, `Logout`, sidebar, and chat pane behavior
- interactive parity is still intentionally deferred to the next checkpoints

### Checkpoint 4: React Topbar Auth Controls

Completed in:

- `client/ui/hooks/useChatApp.js`
- `client/ui/App.jsx`
- `client/ui/style.css`

Goal:

- restore `Start`, `Logout`, and manual reconnect through React
- keep the ownership of session state inside the reducer/hook layer
- avoid reconnecting restore/backup or conversation UI yet

Changes:

- added reducer state for:
  - `username`
  - `password`
  - `started`
  - `starting`
  - status text and tone
- added React actions for:
  - field updates
  - `handleStart()`
  - `handleLogout()`
- `handleStart()` now calls `initChat(...)` through the React hook
- `handleLogout()` now calls `destroyChat()` through the React hook
- disconnect and forced-logout bridge events now update topbar session state
- the topbar now conditionally hides the password field after successful start and shows it again for reconnect

Important temporary limitation for this checkpoint:

- to avoid accidental identity creation while restore is still disconnected, `Start` currently works only when a persisted local vault already exists for that username in the current browser
- if the browser has no local vault for that username yet, React shows a checkpoint-specific blocking message instead of recreating the old start-guard/restore flow early
- `Restore from Cloud` and `Backup to Cloud` remain intentionally disabled until the later modal/flow checkpoint

Expected behavior after this checkpoint:

- existing demo accounts with a local vault can `Start`
- after successful start:
  - status becomes `Ready`
  - password field disappears
- `Logout` becomes available once the session is started
- if the runtime emits disconnect:
  - status becomes `Disconnected`
  - password field comes back
  - `Start` changes into reconnect behavior
- the sidebar and chat pane are still placeholder UI at this checkpoint

Checkpoint result:

- React now owns the topbar auth/session controls
- session lifecycle no longer depends on the old `client/ui/app.js`
- full chat usability is still pending the sidebar/chat checkpoints

### Checkpoint 5: React Conversation Sidebar

Completed in:

- `client/ui/hooks/useChatApp.js`
- `client/ui/App.jsx`

Goal:

- reconnect the local conversation sidebar through React
- use vault metadata ordering/preview instead of the previous placeholder copy
- keep actual history loading and message rendering for the next checkpoint

Changes:

- added reducer state for:
  - `conversations`
  - `conversationsLoaded`
  - `activePeer`
- added normalized conversation helpers inside the React hook
- after a successful `Start`, React now loads `listConversationMetadata()` from the current vault
- sidebar rows now render:
  - avatar
  - peer name
  - preview text when available
- conversations are sorted:
  - newest `lastMessageAt` first
  - alphabetical fallback for peers without timestamps
- clicking a conversation now updates the active peer in React state

Important limitation for this checkpoint:

- selecting a peer does not yet load local history into the chat pane
- realtime updates can trigger a sidebar metadata refresh through the runtime event counter, but the main conversation timeline is still not reconnected yet
- peer typing/manual peer discovery input is still deferred

Expected behavior after this checkpoint:

- after `Start` on a browser/origin with an existing local vault, the sidebar should show local conversations if metadata exists
- the first available conversation becomes the active highlighted peer by default
- clicking a sidebar item changes the highlight and updates the read-only peer field
- if the vault has no local conversation metadata yet, the sidebar shows an empty-state message instead of the old placeholder text

Checkpoint result:

- React now owns the conversation sidebar structure and metadata rendering
- ordering + preview are back at the sidebar level for vaults that already contain local conversation metadata
- full chat usability still waits for the next checkpoint that reconnects history loading and message sending

### Checkpoint 6: React Chat Pane And Send Flow

Completed in:

- `client/ui/hooks/useChatApp.js`
- `client/ui/App.jsx`
- `client/ui/style.css`

Goal:

- reconnect local history loading for the active conversation
- reconnect recent-message catch-up merge into the React timeline
- reconnect composer/send flow through the existing chat runtime

Changes:

- added reducer state for:
  - `messages`
  - `messageDraft`
  - `messageLoading`
  - `recentLoading`
  - `sending`
  - `activePeerReady`
- after selecting an active peer, React now:
  - loads local history through `openConversation(...)`
  - fetches recent ciphertext history through `fetchRecentMessages(...)`
  - merges displayable recent messages through `mergeRecentMessagesForDisplay(...)`
- added `onPeerReady(...)` wiring so send availability follows the runtime cert-readiness state
- added `handleSend()` that calls `sendMessage(...)` and then refreshes the active local conversation
- incoming realtime messages for the currently open peer now append into the React message list through the bridge path

Important limitation for this checkpoint:

- backup/restore flows remain disabled
- the Start flow still requires an existing local vault on the current origin because the restore/new-identity flows are still deferred
- the current checkpoint assumes the runtime core continues to own encryption/decryption/history persistence; React only renders and orchestrates around those APIs

Expected behavior after this checkpoint:

- after `Start` on a browser/origin with an existing local vault and valid peers:
  - selecting a sidebar conversation loads local history into the main pane
  - recent catch-up runs after local history load
  - the composer enables only when the selected peer certificate is ready
  - sending a message refreshes the visible local conversation
- if no active conversation is selected yet, the main pane shows the React checkpoint helper card instead of a blank area

Checkpoint result:

- React now owns the chat timeline rendering and composer behavior
- local history, recent merge, and send flow are reconnected through the existing `client/chat.js` runtime
- backup/restore/modal parity is still pending the next checkpoint

### Checkpoint 7: React Modals, Restore, Backup, And Toasts

Completed in:

- `client/ui/hooks/useChatApp.js`
- `client/ui/App.jsx`
- `client/ui/style.css`

Goal:

- restore the identity-management flows that were still missing from the React UI
- replace the old DOM-imperative modal handling with React-owned modal state
- make it possible again to restore cloud-backed identities onto the current origin

Changes:

- added React modal flows for:
  - Start guard
  - Backup password entry
  - Restore identity choice when multiple cloud backups exist
- reconnected:
  - `fetchCloudBackupIdentities(...)`
  - `fetchCloudBackup(...)`
  - `decryptIdentityPayload(...)`
  - `importIdentityPayload(...)`
  - `exportIdentityPayload(...)`
  - `encryptIdentityPayload(...)`
  - `saveCloudBackup(...)`
- `Start` now uses a React start-guard modal instead of the temporary hard block when no local vault exists
- `Continue` from the start guard re-enables the new-local-identity path on the current origin
- `Restore from Cloud` is available again and supports explicit identity selection
- `Backup to Cloud` is available again and verifies the local vault password before upload
- added React toast notifications for key success/error/informational flows

Important scope note:

- this checkpoint restores the old behavior family without rewriting the underlying crypto/runtime logic
- overwrite confirmation for restore still uses the same decision point as before, but the surrounding flow is now React-owned
- the current implementation still depends on the existing runtime/storage exports rather than introducing a new state backend

Expected behavior after this checkpoint:

- on a fresh origin/browser:
  - `Start` shows the React start-guard modal
  - `Restore from Cloud` can restore a cloud-backed identity for an old user such as `AliceDemo`
- after restore success:
  - password is cleared
  - status becomes `Restore ready`
  - the user must enter the password again and press `Start`
- when already started:
  - `Backup to Cloud` opens a React password modal and can save the current identity backup

Checkpoint result:

- React now owns the modal/toast flows that were previously still missing
- old cloud-backed users can be restored onto the current origin again
- the next checkpoint can focus on cleanup/final parity instead of missing identity flows
- during checkpoint 7 validation, local history dedupe in `client/chat.js` was tightened so the same offline message is not re-added when one path comes from pending flush and another path comes from recent-catch-up merge

### Checkpoint 8: Demo Cleanup And UI Polish

Completed in:

- `client/ui/App.jsx`
- `client/ui/style.css`

Goal:

- remove migration/debug diagnostics from the user-facing UI
- make the React chat surface presentable for product demo use
- keep all runtime/restore/chat behavior from the previous checkpoints intact

Changes:

- removed the sidebar runtime bridge diagnostic panel from the main render path
- removed the large runtime snapshot diagnostic card below the message timeline
- replaced checkpoint-specific empty-state copy with product-facing conversation guidance
- refined the active conversation header with:
  - cleaner spacing
  - a friendlier status subtitle
  - a compact readiness badge instead of debug text blocks
- kept React-owned:
  - Start / Logout / Reconnect
  - Restore from Cloud
  - Backup to Cloud
  - conversation sidebar
  - timeline/composer
  - modals and toasts

Expected behavior after this checkpoint:

- the demo UI no longer shows:
  - runtime bridge counters
  - latest runtime snapshot values
  - checkpoint-labeled helper cards
- when a peer is selected:
  - the header shows the peer name
  - readiness appears as a small status badge
- when no conversation is selected yet:
  - the empty state reads like product guidance rather than migration/debug copy

Checkpoint result:

- the React UI is visually cleaner and more suitable for instructor demo use
- debugging internals are no longer exposed in the main user-facing surface
- runtime behavior from checkpoints 1-7 remains unchanged; this checkpoint is presentation cleanup only

## Phase: React UI Polish / Responsive

### Checkpoint 0: Branch And Baseline

Completed in:

- `PROJECT_NOTES.md`

Goal:

- start the post-migration polish phase from a clean branch boundary
- lock the current React UI behavior before changing layout, spacing, and responsive rules
- define the safety rails for the polish work so demo-ready visuals do not regress core chat flows

Branch:

- active branch for this phase: `feature/react-ui-polish`

Scope rules for this phase:

- polish UI only
- preserve all existing behavior
- do not change:
  - chat protocol
  - MongoDB schema
  - crypto logic
  - storage behavior
  - cloud backup payload format
- avoid deep edits in:
  - `client/chat.js`
  - `client/storage.js`
- limit code changes mainly to:
  - `client/ui/App.jsx`
  - `client/ui/style.css`
  - small className or structure updates only when needed for styling/responsive work

Baseline UI state before polish:

- React UI migration is complete
- the current app already supports:
  - `Start`
  - `Logout`
  - `Reconnect`
  - `Restore from Cloud`
  - `Backup to Cloud`
  - sidebar conversations with ordering + preview
  - realtime chat
  - offline pending delivery
  - recent-message catch-up merge
- demo/debug-specific runtime panels have already been removed from the user-facing UI

Baseline regression checklist for every polish checkpoint:

- session flows:
  - `Start`
  - `Logout`
  - `Reconnect`
  - `Restore from Cloud`
  - `Backup to Cloud`
- conversation flows:
  - sidebar still renders peers
  - ordering + preview stay correct
  - selecting a conversation still opens the correct peer
- message flows:
  - realtime send/receive still works
  - offline pending still returns once
  - recent catch-up does not duplicate messages
- tunnel/demo flows:
  - `npm start` still serves the built UI
  - `cloudflared tunnel --url http://localhost:3000` still works
  - the same quick-tunnel URL can still be used for restore/start/chat testing

Responsive checks that must be done after each visual checkpoint:

- desktop width
- narrowed desktop window
- quick visual smoke check on phone if available

Quality checks that must be considered during polish:

- disabled buttons remain readable
- focus states remain visible
- text contrast remains readable
- modal actions stay obvious
- message composer stays usable on narrow screens
- no layout area should look like a debug surface

Planned checkpoint order for this phase:

- Checkpoint 1: Design Baseline And Visual System
- Checkpoint 2: Topbar Polish
- Checkpoint 3: Sidebar Polish
- Checkpoint 4: Chat Pane + Composer Polish
- Checkpoint 5: Modal And Toast Polish
- Checkpoint 6: Responsive Final Pass
- Checkpoint 7: Final Demo Cleanup + Docs

Checkpoint result:

- the UI polish phase now has a clean baseline and explicit regression checklist
- the next checkpoint can focus on the visual system without ambiguity about scope

### Checkpoint 1: Design Baseline And Visual System

Completed in:

- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- establish a cleaner visual system before polishing individual UI areas
- reduce the "small app floating in a large monitor" effect seen in the baseline screenshots
- unify spacing, panel depth, text hierarchy, and color usage without changing behavior
- apply a first responsive cleanup pass so phone layouts are not left in the exact baseline state while later checkpoints are still pending

Changes:

- expanded the shared design tokens in `:root` to include:
  - base background colors
  - panel and muted panel colors
  - stronger text and muted text tokens
  - success / warning / danger colors
  - radius scale
  - shadow scale
  - spacing scale
- widened the main shell so the app uses large desktop space more effectively
- refined the page background gradients so the canvas feels softer and less empty
- upgraded panel presentation for:
  - topbar
  - sidebar
  - chat surface
  using stronger hierarchy, larger radius, and consistent blur/shadow treatment
- standardized core control sizing:
  - buttons
  - topbar inputs
  - sidebar field
  - composer input
- tightened text hierarchy for:
  - muted helper text
  - section labels
  - empty states
- slightly improved chat bubble spacing and message area breathing room without changing message logic
- added baseline responsive adjustments for:
  - large desktop width usage
  - tablet spacing
  - phone panel padding
  - sticky composer treatment on narrow screens
  - smaller mobile topbar / message header sizing
  - bounded chat-panel height so the message area scrolls inside the panel instead of relying on the browser page scroll
  - bounded peer-list height so long conversation lists can scroll inside the sidebar area
  - desktop viewport locking so the browser page scrollbar is not the primary scroll surface for long chat histories
  - explicit grid-row and panel-height constraints so desktop chat/sidebar panes keep their own scroll behavior

Important scope note:

- this checkpoint does not change:
  - layout ownership
  - auth flow
  - conversation behavior
  - runtime behavior
- the work is still intentionally visual-system first, but it now also includes a light responsive pass because the baseline phone screenshots showed avoidable spacing issues

Expected behavior after this checkpoint:

- on large desktop screens, the app should feel less narrow and less lost in empty space
- panels should look more coherent with each other
- inputs and buttons should feel more consistent in size
- on phones, spacing should feel tighter and the composer should feel more anchored
- on desktop and phone, longer conversations should scroll inside the message area rather than stretching the entire page
- peer lists should also be able to scroll independently when many conversations are present
- the app should still behave exactly like the previous checkpoint

Checkpoint result:

- the React UI now has a more consistent visual foundation for the remaining polish work
- the next checkpoints can focus on specific regions instead of re-deciding global colors, spacing, and depth

### Checkpoint 2: Topbar Polish

Completed in:

- `client/ui/App.jsx`
- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- make the topbar feel like a clearer control surface instead of one long mixed row
- improve the visual hierarchy of brand, auth inputs, actions, and session status
- keep the existing `Start / Restore / Backup / Logout` behavior unchanged

Changes:

- reorganized the topbar into clearer regions:
  - brand block
  - auth input block
  - action button block
  - session status block
- added a compact brand mark so the app header has a stronger visual anchor
- introduced a `Session status` label above the status pill for clearer state reading
- improved desktop layout so action controls no longer feel loosely scattered across one line
- improved mobile layout so topbar controls wrap in a more intentional grid instead of collapsing awkwardly
- corrected a mobile regression where the topbar content could split into an unusable side-column layout on narrow phones
- simplified the narrow-phone topbar further into a strict single-column flow after overflow was observed in real-device testing
- preserved all button handlers, disabled rules, and auth flow logic

Important scope note:

- this checkpoint does not change:
  - auth semantics
  - reconnect logic
  - restore flow behavior
  - backup flow behavior
- the work is purely structural and visual for the topbar area

Expected behavior after this checkpoint:

- on desktop:
  - the app title area should feel more distinct
  - auth inputs and action buttons should read as separate groups
  - session status should be easier to locate quickly
- on mobile:
  - the topbar should stack more cleanly
  - buttons should wrap more predictably
  - status should remain readable without looking detached
  - inputs and buttons should keep usable width instead of collapsing into a narrow right-side column
- all existing topbar flows should still behave exactly as before

Checkpoint result:

- the topbar now has clearer grouping and stronger hierarchy on both desktop and mobile
- the next checkpoint can focus on the sidebar without carrying forward a cluttered header layout

### Checkpoint 2A: Peer Input Behavior Fix

Completed in:

- `client/ui/hooks/useChatApp.js`
- `client/ui/App.jsx`
- `PROJECT_NOTES.md`

Goal:

- restore the ability to start or open a conversation by typing a peer name directly
- fix the regression where the `Chat with` field had become a read-only mirror of the active sidebar peer

Changes:

- introduced a separate `peerDraft` state in the React hook
- kept `activePeer` as the committed peer currently opened in the chat pane
- changed the `Chat with` field back into a live input
- pressing `Enter` in the field now commits the typed peer and opens/begins that conversation flow
- selecting a sidebar item still syncs both:
  - `activePeer`
  - `peerDraft`
- preserved manually committed peers even when the current sidebar metadata does not yet contain that peer, so the UI does not jump back to the first known conversation

Important scope note:

- this fix restores expected chat UX behavior
- it does not add a new protocol or backend feature
- it only separates:
  - the draft peer name being typed
  - the peer currently committed in the active conversation

Expected behavior after this checkpoint:

- users can type a peer name that is not already visible in the sidebar
- pressing `Enter` should switch the conversation target to that peer
- sidebar selection should still work as before

Checkpoint result:

- the `Chat with` field is no longer a dead display-only field
- the React UI again supports starting a conversation with a peer that has not been previously opened in the local sidebar

### Checkpoint 3: Sidebar Polish

Completed in:

- `client/ui/App.jsx`
- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- make the conversation sidebar feel closer to a real chat conversation list
- improve readability, active state, empty state, scrolling, and mobile tap targets
- preserve existing chat/session/storage behavior

Changes:

- grouped the `Chat with` input into a clearer peer target card
- added helper text so users understand that typing a peer name and pressing `Enter` opens or starts that chat
- added a conversation count badge beside the `Conversations` heading
- improved conversation row structure with stronger avatar, peer name, preview, hover, active, and keyboard focus states
- added a preview fallback for conversations that do not yet have a local message preview
- improved preview truncation so long last-message text stays inside the sidebar row
- made the peer list remain the scrollable sidebar area when many conversations exist
- tuned mobile spacing and tap target sizes for the sidebar without changing the mobile layout model

Important scope note:

- this checkpoint does not add user search, account discovery, or autocomplete
- this checkpoint does not change conversation ordering logic
- this checkpoint does not change message loading, sending, recent catch-up, storage, crypto, or backend behavior

Expected behavior after this checkpoint:

- before Start, the sidebar should show a clean empty state and disabled peer input
- after Start, local conversations should render as compact chat rows
- selecting a conversation should update the active row clearly
- typing a peer name and pressing `Enter` should still open/start that peer instead of jumping to the first sidebar item
- long previews should truncate cleanly on desktop and mobile
- when there are many conversations, the peer list should scroll inside the sidebar area

Checkpoint result:

- sidebar presentation is now more product-like and ready for the next polish pass
- existing chat behavior remains owned by the previous React migration/runtime bridge work

### Checkpoint 4: Chat Pane + Composer Polish

Completed in:

- `client/ui/App.jsx`
- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- improve the central chat pane and message composer without changing chat runtime behavior
- support multi-line messages in the composer, especially on mobile keyboards
- keep existing send/receive, recent catch-up, pending/offline, and local history behavior unchanged

Changes:

- changed the message composer from a single-line `input` to a controlled `textarea`
- added auto-height behavior for the composer up to a safe maximum height
- preserved desktop fast-send behavior:
  - `Enter` sends
  - `Shift + Enter` inserts a new line
- changed mobile behavior so the keyboard Enter/newline key inserts a new line instead of sending immediately
- kept the `Send` button as the reliable send action on mobile
- adjusted composer styling for multi-line text, focus state, placeholder, and mobile spacing
- slightly refined chat pane/message spacing while preserving the existing message rendering logic

Important scope note:

- this checkpoint does not change encryption, protocol, storage, backend, WebSocket, or message merge logic
- this checkpoint does not change how messages are saved or decrypted
- this checkpoint only changes the React composer element and supporting UI styles

Expected behavior after this checkpoint:

- users can type multi-line messages
- sent multi-line messages should display with line breaks because message bubbles already use `white-space: pre-wrap`
- on desktop, pressing `Enter` sends and `Shift + Enter` creates a new line
- on mobile, pressing the keyboard newline key creates a new line, and users send with the `Send` button
- the composer should grow a little for multi-line text but not cover the whole chat pane
- existing realtime and offline chat flows should continue working

Checkpoint result:

- the chat composer is closer to normal chat-app behavior
- mobile message composition is safer because newline no longer accidentally sends the message

### Checkpoint 5: Modal And Toast Polish

Completed in:

- `client/ui/App.jsx`
- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- improve modal and toast presentation for demo readiness
- keep backup, restore, start guard, and identity-choice flows unchanged
- make dialogs easier to read on desktop and mobile

Changes:

- improved the shared modal frame with a clearer header layout, context eyebrow, and compact app mark
- added modal context labels for:
  - encrypted backup
  - identity guard
  - cloud restore
- improved modal card sizing, backdrop blur, spacing, and scroll handling for smaller screens
- improved modal action area separation so primary and secondary actions are easier to distinguish
- improved backup password input styling without changing password behavior
- improved restore identity choice rows with a clearer label, stronger identity text, hover, and focus states
- improved toast layout with a tone dot, stronger card styling, and better mobile width/positioning

Important scope note:

- this checkpoint does not change any backup or restore API call
- this checkpoint does not change password validation or vault behavior
- this checkpoint does not change start guard decision logic
- this checkpoint does not change identity selection behavior

Expected behavior after this checkpoint:

- `Backup to Cloud` should open a cleaner password modal
- `Start Confirmation` should remain the same flow but look clearer
- multi-identity restore should still allow choosing exactly one identity
- toast messages should be easier to notice without covering too much of the app
- on mobile, modal buttons should remain large enough to tap and should not overflow horizontally

Checkpoint result:

- modal and toast UI now look more consistent with the polished React interface
- all sensitive flows remain controlled by the existing runtime and hook actions

### Checkpoint 5A: Composer Multiline Scrollbar Fix

Completed in:

- `client/ui/App.jsx`
- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- fix the rough native textarea scrollbar that appears when users type many lines
- keep multiline message behavior from Checkpoint 4
- avoid changing send/receive logic

Changes:

- moved the composer maximum height into a named constant in the React component
- the textarea now hides vertical overflow while the content still fits
- the textarea only enables vertical scrolling after it reaches the maximum composer height
- styled the textarea scrollbar to be thinner and less visually disruptive
- removed visible native scrollbar buttons in WebKit/Blink browsers where supported
- adjusted textarea padding and border radius so multiline text fits better

Expected behavior after this fix:

- typing a few lines should grow the composer without showing a scrollbar
- typing many lines should show a cleaner internal scrollbar instead of the browser's bulky native control
- sending multiline messages should still work exactly as in Checkpoint 4

### Checkpoint 6: Responsive Final Pass

Completed in:

- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- review and stabilize the polished React UI across desktop, laptop, tablet, and mobile sizes
- reduce layout overflow risk before demo
- preserve all chat, storage, backup, restore, and runtime behavior

Changes:

- added global horizontal overflow protection so accidental wide children do not create sideways page scroll
- made the app shell width more predictable by using a viewport-aware width instead of mixing max-width with side padding
- changed the desktop content grid to use a responsive sidebar width with `clamp(...)`
- added a laptop-specific breakpoint for 1025px-1280px to reduce topbar and grid pressure
- kept desktop chat/sidebar inside the app viewport while preserving internal scroll areas
- improved tablet/mobile shell sizing so cards stay inside the viewport with consistent side gutters
- adjusted mobile chat panel height with a bounded `min(...)` value instead of a fixed viewport-only height
- added scroll containment to:
  - message history
  - peer list
  - modal content

Important scope note:

- this checkpoint only changes CSS layout/responsive behavior
- it does not change React state, chat runtime, crypto, storage, server, or MongoDB
- it does not add mobile drawer/tab navigation
- it does not change message ordering, recent catch-up, pending delivery, or backup/restore logic

Expected behavior after this checkpoint:

- on desktop, the browser page should not be the main chat scroller
- on laptop widths, topbar and content should stay balanced without squeezing the chat pane too much
- on tablet/mobile, topbar, chat pane, composer, and sidebar should not create horizontal overflow
- message history, peer list, and modal bodies should scroll inside their own regions where applicable
- existing realtime and offline chat behavior should remain unchanged

Checkpoint result:

- the UI has a safer responsive foundation for demo across desktop and mobile
- remaining work can focus on final cleanup/docs rather than broad layout restructuring

### Checkpoint 7: Final Demo Cleanup And Phase Summary

Completed in:

- `PROJECT_NOTES.md`

Goal:

- close the React UI Polish / Responsive phase with a final demo-readiness review
- confirm no user-facing debug/checkpoint/runtime bridge panels remain in the active UI
- document what this phase changed and what it intentionally did not change

Final cleanup review:

- searched the active UI for obvious demo/debug labels such as:
  - checkpoint
  - debug
  - runtime bridge
  - React Shell Only
  - Latest Runtime
- no user-facing debug panel or checkpoint helper card remains in `client/ui/App.jsx`
- remaining `migration-*` strings are CSS class names only; they are not visible product text
- no additional code cleanup was required in this checkpoint

Phase result:

- the app now has a more product-like React UI on top of the existing secure chat runtime
- topbar/auth controls are clearer and more demo-friendly
- sidebar conversations look and behave more like a real chat list
- chat pane and message bubbles are cleaner
- composer supports multiline messages
- modal and toast UI is more consistent
- desktop/laptop/mobile responsive behavior has been tightened
- quick tunnel demo flow remains compatible with the same `npm start` + `cloudflared tunnel --url http://localhost:3000` approach

Behavior preserved:

- no crypto behavior was changed
- no backend route or Mongo schema was changed
- no WebSocket protocol was changed
- no account discovery/autocomplete was added
- no IndexedDB vault migration was added
- no Google/Firebase Auth was added
- `client/chat.js` and `client/storage.js` remain the core runtime/storage layers

Final demo checklist for this phase:

- Start existing local identities
- Restore from Cloud when needed
- Backup to Cloud
- Alice/Bob realtime messaging
- one-side-offline pending delivery
- recent catch-up without obvious duplicates
- multiline message input
- desktop layout on large monitor
- mobile layout on Samsung/phone quick tunnel
- modal/toast rendering on mobile

Recommended next phase:

- if demo stability is the priority, keep this branch stable and avoid new feature work before presenting
- if continuing development, the next practical phases are:
  - Account ID / Authentication
  - Domain + Named Cloudflare Tunnel
  - Storage Hardening

Checkpoint result:

- React UI Polish / Responsive is complete from an implementation and documentation standpoint
- the branch is ready for final user regression testing, commit, and push

### Checkpoint 8: UX Micro Fixes

Completed in:

- `client/ui/App.jsx`
- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- improve two small but important chat UX details after the main polish phase
- keep all runtime, encryption, storage, and backend behavior unchanged

Changes:

- added a password visibility toggle to the topbar password field
- added a password visibility toggle to the `Backup to Cloud` password modal
- implemented the toggle with an inline eye-style SVG icon and accessible labels
- reset password visibility when the topbar password field is hidden or when the backup modal closes
- added automatic scroll-to-latest behavior for the message list
- opening a conversation now scrolls to the latest loaded message
- new messages scroll down automatically when the user is already near the bottom
- if the user has scrolled upward to read old messages, incoming messages should not forcibly pull the view down

Important scope note:

- this checkpoint does not change password validation
- this checkpoint does not store password visibility state anywhere persistent
- this checkpoint does not change send/receive behavior
- this checkpoint does not change recent catch-up, pending delivery, or local history storage

Expected behavior after this checkpoint:

- users can briefly reveal and hide password text while typing
- backup password entry has the same reveal/hide affordance
- selecting a conversation should land at the newest message instead of the oldest visible part of history
- sending or receiving messages while already near the bottom should keep the latest message visible
- reading older messages should not be interrupted by forced auto-scroll unless the user returns near the bottom

### Checkpoint 9: Branding Logo Update

Completed in:

- `client/ui/assets/realtime-secure-chat-logo.png`
- `client/ui/App.jsx`
- `client/ui/style.css`
- `client/ui/index.html`
- `PROJECT_NOTES.md`

Goal:

- replace the previous text brand block with the new Realtime Secure Chat logo
- keep the topbar layout usable on desktop and mobile
- avoid changing chat/runtime behavior

Changes:

- added a cropped project-local PNG asset for the new logo
- replaced the old `RS` mark, title, and subtitle with a single responsive logo image
- updated the browser document title from `Realtime Secure Messenger` to `Realtime Secure Chat`
- adjusted brand CSS so the logo scales inside the topbar instead of forcing layout overflow
- kept the auth controls, session status, sidebar, chat pane, composer, and modal behavior unchanged

Important scope note:

- this checkpoint is branding-only
- no protocol, crypto, storage, backend, or chat runtime behavior was changed
- the source logo file stays outside the app; the app uses the copied/cropped asset under `client/ui/assets`

Expected behavior after this checkpoint:

- the topbar should show only the logo on the left, not the old `RS + title + subtitle` block
- the logo should remain readable on desktop
- the logo should shrink safely on mobile without pushing auth controls off-screen
- the browser tab title should read `Realtime Secure Chat`

### Domain + Named Cloudflare Tunnel Setup

Completed setup:

- added `securechat.id.vn` to Cloudflare
- changed registrar nameservers to Cloudflare nameservers
- Cloudflare Universal SSL is active for `securechat.id.vn` and `*.securechat.id.vn`
- created a named Cloudflare Tunnel for the local app
- routed `chat.securechat.id.vn` to the named tunnel
- verified the fixed public URL can be used instead of a changing quick tunnel URL

Public demo URL:

- `https://chat.securechat.id.vn`

Normal demo startup:

1. Start the app server:

   ```powershell
   cd G:\proj3\realtime-secure-chat
   npm start
   ```

2. Start the named tunnel:

   ```powershell
   cloudflared tunnel run realtime-secure-chat
   ```

3. Open:

   ```text
   https://chat.securechat.id.vn
   ```

Fallback demo startup:

- if the named domain or tunnel has an issue close to demo time, keep using quick tunnel:

  ```powershell
  cloudflared tunnel --url http://localhost:3000
  ```

Important scope note:

- no crypto behavior was changed
- no backend API behavior was changed
- no MongoDB schema was changed
- no chat protocol was changed
- no account/auth model was changed
- Cloudflare Tunnel only exposes the app while the local server and tunnel process are running
- tunnel credentials and local Cloudflare config files must not be committed

Operational notes:

- use `https://chat.securechat.id.vn` consistently for demo and normal testing
- browser local vaults are scoped by domain, so identities stored under old quick tunnel URLs are separate from identities stored under the fixed domain
- if a browser/device does not already have the expected local identity, use `Restore from Cloud`
- before ending an important demo/chat session, use `Backup to Cloud` so the identity can be restored on a new browser or device
- stop a demo by pressing `Ctrl + C` in both the app server terminal and the tunnel terminal

Regression checklist:

- fixed domain opens over HTTPS without SSL warnings
- Alice/Bob realtime messaging works through the fixed domain
- one-side-offline pending delivery works through the fixed domain
- restore from cloud works on a new browser/device when needed
- backup to cloud still works
- mobile browser can open and use the fixed domain
- quick tunnel fallback still works if needed

## Phase: Account ID Foundation

Goal:

- reduce the remaining ambiguity caused by using `username` as both an account identifier and a display label
- introduce a safer path toward `accountId`, while keeping the current demo behavior stable
- keep `identityId` as the cryptographic identity identifier derived from the long-term public key
- prepare the codebase for future Firebase/Google Auth without adding real external auth in this phase

Important scope boundary:

- this phase does not add Firebase Auth
- this phase does not add Google login
- this phase does not add a global user directory or autocomplete
- this phase does not change the Double Ratchet protocol
- this phase does not change the encryption format unless explicitly needed for compatibility metadata
- this phase must preserve legacy username fallback while the account model is transitional

Target terminology:

- `accountId`: stable technical account identifier used by routing/storage policy
- `displayName`: human-readable label shown in the UI
- `identityId`: cryptographic identity identifier derived from the long-term public key

Transitional rule:

- local `accountId` is not real authentication
- a transitional local account id only makes the current username-based model less ambiguous
- it must not be described as proof of user identity
- real authentication is a later phase

### Account ID Foundation - Checkpoint 0: Username Usage Inventory

Completed in:

- `PROJECT_NOTES.md`

Goal:

- inventory where `username` is currently used
- classify each area before changing runtime behavior
- document the migration direction for Checkpoint 1 through Checkpoint 4

Current username usage inventory:

1. React UI input and display

   Files:

   - `client/ui/App.jsx`
   - `client/ui/hooks/useChatApp.js`

   Current behavior:

   - `state.username` is entered by the user in the topbar
   - the same value is used for Start, Restore from Cloud, Backup to Cloud, and message bubble ownership
   - peer selection still uses typed peer names and conversation peer labels

   Classification:

   - partly display label
   - partly temporary account identifier

   Migration direction:

   - keep the visible input label simple for now
   - internally introduce `displayName` and `accountId`
   - UI should continue showing a human-readable name, but runtime policy should move toward `accountId`

2. React app state and actions

   File:

   - `client/ui/hooks/useChatApp.js`

   Current behavior:

   - `username` is used by `performStart`
   - `username` is used by backup and restore flows
   - `username` is used to inspect persisted local identity
   - `continueWithoutRestoreFor` is keyed by username

   Classification:

   - temporary account/session key
   - restore target label
   - UI display value

   Migration direction:

   - add a derived transitional `accountId`
   - keep `username` available as `displayName`
   - guard/restore state should eventually key by account identity rather than display text alone

3. Chat runtime session

   File:

   - `client/chat.js`

   Current behavior:

   - `myUser` is the normalized username for the active session
   - WebSocket register sends `{ type: "register", user: myUser }`
   - local Double Ratchet state is keyed with `dr:state:${username}`
   - conversation thread labels use username pairs
   - certificate generation still uses username
   - cloud backup save still sends `username`

   Classification:

   - runtime account label
   - legacy routing key
   - local storage namespace
   - display name for peer/cert compatibility

   Migration direction:

   - introduce account metadata without breaking the existing `user` field
   - send both legacy `user` and new transitional `accountId` once Checkpoint 1/2 begins
   - keep username fallback until all server and storage reads understand accountId

4. Local vault and browser storage

   File:

   - `client/storage.js`

   Current behavior:

   - local vault storage key is derived from `userId`
   - backup payload version 2 contains `username` and `identityId`
   - identity metadata contains `username` and `identityId`
   - import/export validates backup username and identityId
   - conversation metadata is still peer-name based

   Classification:

   - local vault namespace
   - backup ownership metadata
   - restore validation field

   Migration direction:

   - add `accountId` to identity metadata and backup payload in a backward-compatible way
   - keep validating legacy `username` while new backups include accountId
   - avoid changing vault storage keys until migration behavior is explicit and tested

5. Server WebSocket routing

   File:

   - `server/server.js`

   Current behavior:

   - active sessions are kept in `accountSessions` keyed by username
   - `wsToSession` stores `{ user, identityId }`
   - register uses `data.user`
   - identity binding activates one active identity per username
   - send routing looks up the active account session by username
   - force logout semantics are still `1 active session / username`

   Classification:

   - online routing key
   - active device policy key
   - legacy account label

   Migration direction:

   - Checkpoint 2 should introduce accountId-aware active session maps
   - keep username fallback so old clients and old records still work
   - preserve the current one-active-session policy until a later multi-device phase

6. MongoDB persistence

   File:

   - `server/mongo.js`

   Current behavior:

   - `certs` uses `{ username, identityId }`
   - `identity_backups` uses `{ username, identityId }`
   - `account_active_devices` uses unique `{ username }`
   - `pending_messages` uses `to`, `senderIdentityId`, `recipientIdentityId`
   - `messages` uses `conversationId`, currently derived from username pair

   Classification:

   - persistence ownership key
   - routing and lookup key
   - legacy compatibility key

   Migration direction:

   - add accountId fields additively where needed
   - do not drop username fields yet
   - do not remove existing indexes until accountId indexes and fallback behavior are tested

7. Legacy vanilla UI

   File:

   - `client/ui/app.js`

   Current behavior:

   - still contains the old username-based UI flow
   - no longer the React entry point

   Classification:

   - legacy reference only

   Migration direction:

   - avoid using this file as an implementation source for new accountId behavior
   - do not delete it in this phase unless a separate cleanup checkpoint is approved

Checkpoint 0 conclusions:

- `username` is still overloaded across UI display, session identity, storage namespace, backup ownership, cert ownership, and server routing
- `identityId` already solves the cryptographic identity side, but does not solve account identity or display-name ambiguity by itself
- the safest next step is to introduce a local transitional account model without external authentication
- future checkpoints should add fields and fallbacks before changing enforcement behavior

Checkpoint 1 target:

- add a small account identity helper/model
- derive a local transitional `accountId` from the normalized username
- keep `displayName` equal to the entered username for now
- thread account metadata through React state and client runtime without changing server policy yet

Checkpoint 2 target:

- make server active-session and routing logic understand `accountId`
- keep username fallback
- preserve current one-active-session behavior

Checkpoint 3 target:

- add `accountId` to backup/restore metadata in a backward-compatible way
- keep legacy backup payloads restorable
- avoid overwriting or restoring the wrong identity when display names overlap

Checkpoint 4 target:

- clean UI wording so `displayName` is shown to users while `accountId` is treated as internal
- keep Chat with behavior unchanged until a future user-directory/auth phase

Checkpoint 0 test expectation:

- no runtime behavior should change
- app should still build and run exactly as before
- documentation should clearly describe the accountId foundation scope and non-goals

### Account ID Foundation - Checkpoint 1: Local Transitional AccountId

Completed in:

- `client/account.js`
- `client/chat.js`
- `client/storage.js`
- `client/ui/hooks/useChatApp.js`
- `PROJECT_NOTES.md`

Goal:

- introduce a local transitional account profile without changing server routing policy
- keep the existing username UI and legacy username fallback working
- start separating internal account identity from human-readable display text

Changes:

- added `client/account.js`
  - `normalizeDisplayName(value)`
  - `normalizeAccountId(value)`
  - `deriveLocalAccountId(displayName)`
  - `buildLocalAccountProfile(displayName)`
- the transitional account id is deterministic and local:
  - scheme: `local-username-v1`
  - id format: `local:<sha256-derived-base64url>`
  - input: normalized display name
- React app state now tracks:
  - `accountId`
  - `displayName`
- Start now derives a local account profile before calling the chat runtime
- `initChat(username, password, accountProfile)` now accepts optional account metadata
- `chat.js` stores runtime account metadata as:
  - `myAccountId`
  - `myDisplayName`
- WebSocket `register` and `identity_bind` now include additive account metadata fields:
  - `accountId`
  - `displayName`
  - `accountIdScheme`
- the current server ignores these new fields for routing in this checkpoint
- local identity metadata in the vault is now saved as version 2 with:
  - `username`
  - `accountId`
  - `displayName`
  - `identityId`
- old identity metadata without account fields still loads correctly
- backup plaintext payload now includes account metadata before encryption
- encrypted backup server metadata remains legacy-compatible for this checkpoint

Important scope note:

- this checkpoint does not implement real authentication
- this checkpoint does not prove that a user owns an account
- this checkpoint does not add Firebase/Google login
- this checkpoint does not change active-session routing on the server
- this checkpoint does not change MongoDB indexes
- this checkpoint does not change the visible username input behavior
- this checkpoint does not add user search/autocomplete

Expected behavior:

- existing local identities should still Start with the same username/password
- new local identities should get account metadata saved in the vault
- Backup to Cloud should still save encrypted backup blobs
- Restore from Cloud should still restore old and new backups
- Alice/Bob realtime chat should behave the same as before
- offline pending delivery should behave the same as before
- same username casing behavior remains unchanged

Checkpoint 1 test expectation:

- app builds successfully
- no visible UI flow is intentionally changed
- runtime should remain compatible with the current server because new account fields are additive
- `PROJECT_NOTES.md` must clearly state that local accountId is transitional and not real authentication

### Account ID Foundation - Checkpoint 2: Server AccountId-Aware Routing

Completed in:

- `server/server.js`
- `server/mongo.js`
- `PROJECT_NOTES.md`

Goal:

- make the server understand accountId metadata during active-session routing
- keep username fallback so existing demo users and legacy records continue to work
- preserve the current one-active-session behavior

Changes:

- WebSocket sessions now track additive account metadata:
  - `user`
  - `accountId`
  - `displayName`
  - `identityId`
- server active sessions are now tracked by an internal account session key
- username fallback is kept through a username-to-account-session map
- `register` accepts additive account metadata from the client
- `identity_bind` preserves and updates account metadata
- `registered` and `identity_bound` responses echo account metadata when present
- active-session replacement logs now include accountId when present
- `isActiveAccountSocket` checks the active account session using accountId first, then username fallback
- realtime send routing still accepts typed username recipients, but the active target session can now carry account metadata
- message envelopes saved/forwarded by the server now carry additive account metadata when available:
  - `senderAccountId`
  - `senderDisplayName`
  - `recipientAccountId`
  - `recipientDisplayName`
- recent history responses can include the same account metadata fields
- `account_active_devices` now persists:
  - `username`
  - `accountId`
  - `displayName`
  - `activeIdentityId`
- `pending_messages` and `messages` can now store account metadata fields additively
- `identity_backups` can store `accountId` additively from the active session
- a sparse index on `account_active_devices.accountId` was added while keeping the existing unique username index

Important scope note:

- this checkpoint does not add real authentication
- this checkpoint does not remove username fallback
- this checkpoint does not change the user-facing Chat with behavior
- this checkpoint does not add server-side user search
- this checkpoint does not allow multiple active devices per account
- this checkpoint does not require migrating old MongoDB documents

Expected behavior:

- Alice/Bob/Charlie should still Start with existing usernames
- realtime routing should behave the same as before for typed peer names
- one active session per current username/account label should still be enforced
- offline pending delivery should still work
- recent catch-up should still work
- old records without accountId fields should still be usable
- new active-device documents should include account metadata when clients provide it

Checkpoint 2 test expectation:

- app builds successfully
- server starts successfully
- Mongo indexes are created without dropping existing username fallback behavior
- existing browser-local identities still work
- domain/named tunnel demo flow remains unchanged

### Account ID Foundation - Checkpoint 3: Account-Aware Backup And Restore Metadata

Completed in:

- `client/storage.js`
- `client/chat.js`
- `client/ui/hooks/useChatApp.js`
- `server/server.js`
- `server/mongo.js`
- `PROJECT_NOTES.md`

Goal:

- make cloud backup and restore carry account metadata in a backward-compatible way
- keep old encrypted backup blobs restorable
- prevent new account-aware backups from being restored under a mismatched account id

Changes:

- encrypted backup payloads now preserve account metadata when available:
  - `accountId`
  - `displayName`
  - `accountIdScheme`
- encrypted backup upload now sends account metadata to the server additively
- `identity_backups` server metadata now stores:
  - `accountId`
  - `displayName`
  - `accountIdScheme`
- backup list responses now include account metadata when available
- backup fetch responses now include account metadata when available
- restore validation now accepts an expected `accountId`
- if a backup payload or server backup metadata has an accountId, restore requires it to match the locally derived accountId for the entered display name
- legacy backups without accountId remain restorable through the existing username + identityId checks
- server backup save rejects an accountId mismatch between the active WebSocket session and the uploaded backup metadata
- backup identity targeting by `identityId` remains unchanged

Important scope note:

- this checkpoint does not implement real authentication
- this checkpoint does not add Google/Firebase login
- this checkpoint does not change the visible username input model
- this checkpoint does not add user search/autocomplete
- this checkpoint does not remove legacy backup support
- this checkpoint does not solve multi-device ratchet-state synchronization

Expected behavior:

- new backups should show account metadata in MongoDB
- old backups that do not have account metadata should still restore
- restore with correct username/password/identity should still work
- restore should fail safely if a new backup's accountId does not match the accountId derived from the entered display name
- backup/save should fail safely if a client tries to upload backup metadata for a different accountId than the active session

Checkpoint 3 test expectation:

- app builds successfully
- Alice/Bob/Giang existing realtime chat still works
- Backup to Cloud still succeeds for a started local identity
- Restore from Cloud still restores the selected identity
- multiple backup identities under one display name still require explicit identity selection
- legacy backup documents without accountId fields remain usable
- MongoDB documents created after this checkpoint include account metadata where available

### Account ID Foundation - Checkpoint 4: UI Wording Cleanup

Completed in:

- `client/ui/App.jsx`
- `client/ui/hooks/useChatApp.js`
- `PROJECT_NOTES.md`

Goal:

- make the UI describe the user-entered name as a display name/account label
- keep `accountId` internal and out of normal user-facing input
- avoid implying that the current display-name field is real authentication

Changes:

- topbar label changed from `Username` to `Display name`
- peer entry wording now says `peer display name`
- backup modal wording now says the backup belongs to the current account label's local identity
- start guard wording now says no local identity was found for this display name in this browser
- restore selector wording now says the display name has multiple cloud backups and asks the user to choose a device identity
- restore selector can show backup display-name metadata when available
- restore error wording now tells the user to check display name, password, or backup availability

Important scope note:

- this checkpoint does not rename internal `username` variables
- this checkpoint does not change server routing
- this checkpoint does not change storage keys or MongoDB schema
- this checkpoint does not add Firebase/Google login
- this checkpoint does not add user search/autocomplete
- this checkpoint does not change `Chat with` behavior beyond wording

Expected behavior:

- UI should be clearer that the typed name is a display label for the current transitional account model
- existing Alice/Bob/Giang test users should still work
- Start/Restore/Backup/Logout behavior should not change
- Chat with still accepts typed peer display names exactly as before

Checkpoint 4 test expectation:

- app builds successfully
- the topbar displays `Display name`
- Start still works with existing local identities
- Restore from Cloud still works
- Backup to Cloud still works
- multiple-backup restore selector remains usable
- realtime and offline chat behavior remains unchanged

## Account ID Hardening / Auth Readiness

This phase follows the completed Account ID Foundation work.

Goal:

- harden backup/restore and device-switching safety before adding real Firebase/Google authentication
- keep the current React UI, chat runtime, crypto protocol, and MongoDB schema stable
- make account/display/identity state easier to explain and safer to demo

Non-goals:

- no Firebase/Google login in this phase
- no external authentication provider
- no user directory or autocomplete
- no multi-device Double Ratchet state synchronization
- no protocol rewrite
- no storage rewrite to IndexedDB

Recommended checkpoint order:

1. Final Regression Baseline
2. Backup Metadata Foundation
3. Backup Freshness Warning
4. Account/Identity Info Panel
5. Backup/Restore UX Safety
6. Documentation + Demo Script
7. Stable Tag / Release Candidate

### Account ID Hardening - Checkpoint 0: Final Regression Baseline

Completed in:

- `PROJECT_NOTES.md`

Goal:

- capture the expected stable behavior before further hardening work
- document the manual regression checklist for the current demo-ready branch
- explicitly record current limitations so later checkpoints do not overclaim what they solve

Baseline expectations:

- `npm start` builds the React UI and starts the Node backend on port `3000`
- named Cloudflare Tunnel can expose the app at `https://chat.securechat.id.vn`
- quick tunnel remains available as fallback with `cloudflared tunnel --url http://localhost:3000`
- WebSocket URLs must be same-origin/public-safe and use `wss://` when loaded through HTTPS
- existing local identities such as Alice/Giang should still Start from their current browser vaults
- realtime one-to-one chat should work for online users
- pending/offline delivery should still deliver messages when the recipient starts again
- Backup to Cloud should save an encrypted identity backup
- Restore from Cloud should restore a selected identity and still require pressing `Start` afterward
- multiple backup identities under one display name should still require explicit identity selection
- legacy username/display-name fallback should remain usable

Known limitations:

- this is still not real Google/Firebase authentication
- `displayName` is still a user-entered label and can be duplicated in principle
- `accountId` is still transitional and derived locally from the display name
- the project still works best with one active device/browser per account label at a time
- switching devices without backing up/restoring the latest vault can desynchronize Double Ratchet state
- freshness warnings planned in later checkpoints can reduce this risk but will not implement full multi-device sync
- server does not read plaintext messages; it stores and relays ciphertext plus routing metadata

Manual regression checklist:

1. Local production server:
   - run `npm start`
   - open `http://localhost:3000`
   - confirm the React UI loads
2. Named domain:
   - run `cloudflared tunnel run realtime-secure-chat`
   - open `https://chat.securechat.id.vn`
   - confirm the UI loads and WebSocket connects
3. Quick tunnel fallback:
   - run `cloudflared tunnel --url http://localhost:3000`
   - open the generated `trycloudflare.com` URL
   - confirm the UI does not blank-screen
4. Realtime chat:
   - Start Alice in one browser
   - Start Giang in another browser
   - send messages both directions
   - confirm sidebar preview and ordering still update
5. Offline pending:
   - log out or close Giang
   - send a message from Alice to Giang
   - Start Giang again
   - confirm the message arrives once
6. Backup and restore:
   - Start a user
   - save Backup to Cloud with the correct password
   - restore in another browser/profile
   - press Start after restore
   - confirm chat can continue
7. Active session replacement:
   - Start the same display name in another browser/device
   - confirm the older active session is replaced as expected
   - avoid continuing chat from stale local vaults without a fresh restore

Checkpoint 0 test expectation:

- app builds successfully
- no application behavior changes
- documentation clearly defines what the hardening phase will and will not solve

### Account ID Hardening - Checkpoint 1: Backup Metadata Foundation

Completed in:

- `client/storage.js`
- `client/chat.js`
- `client/ui/hooks/useChatApp.js`
- `server/server.js`
- `server/mongo.js`
- `PROJECT_NOTES.md`

Goal:

- add stable backup metadata needed for later freshness warnings
- prefer server-recorded save time over client clock for cloud freshness comparison
- keep encrypted backup and restore behavior backward-compatible

Changes:

- encrypted backup payloads now include `clientSavedAt`
- backup blob metadata sent to the server now includes `clientSavedAt`
- Mongo `identity_backups` now stores:
  - `clientSavedAt`
  - `serverSavedAt`
- backup list responses now include:
  - `backupVersion`
  - `clientSavedAt`
  - `serverSavedAt`
- backup fetch responses now include:
  - `clientSavedAt`
  - `serverSavedAt`
- WebSocket `backup_saved` success responses now include a small `backup` receipt object
- client backup flow stores a local vault receipt in `__securechat_backup_meta_v1__`
- local backup receipt includes:
  - `username`
  - `accountId`
  - `displayName`
  - `accountIdScheme`
  - `identityId`
  - `identityShortId`
  - `backupVersion`
  - `clientSavedAt`
  - `serverSavedAt`
  - `localLastBackupServerSavedAt`
- added `saveBackupMetadata(...)` and `loadBackupMetadata(...)` helpers in `client/storage.js`

Important scope note:

- this checkpoint does not show a freshness warning yet
- this checkpoint does not block Start
- this checkpoint does not auto-restore cloud backup
- this checkpoint does not change Double Ratchet state handling
- this checkpoint does not implement multi-device sync
- this checkpoint does not change the backup encryption password flow

Expected behavior:

- Backup to Cloud should still succeed for active identities
- Restore from Cloud should still restore old and new backups
- legacy backups without `clientSavedAt` or `serverSavedAt` should still restore
- new backup records should have server-side `serverSavedAt`
- after successful backup, the local vault should have backup receipt metadata for later comparison

Checkpoint 1 test expectation:

- app builds successfully
- server syntax check passes
- Alice/Giang realtime chat still works
- Backup to Cloud creates or updates `identity_backups` with `clientSavedAt` and `serverSavedAt`
- Restore from Cloud still works after a new backup
- offline pending behavior remains unchanged

### Account ID Hardening - Checkpoint 2: Backup Freshness Warning

Completed in:

- `client/ui/hooks/useChatApp.js`
- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- warn the user when the cloud backup metadata suggests a newer backup may exist for the current local identity
- reduce the chance of continuing from a stale local vault after switching devices
- keep Start usable and non-blocking

Changes:

- after a successful `Start`, the React hook now checks backup freshness in the background
- the check compares the matching cloud backup `serverSavedAt` with the local vault receipt `localLastBackupServerSavedAt`
- matching is scoped to the current local `identityId` and compatible `accountId` when available
- if the cloud timestamp is newer, the UI shows:
  - status: `Cloud backup may be newer`
  - warning toast explaining that the browser may be using an older local state
- if the freshness API/check fails, Start still succeeds and the warning check is skipped
- warning styling was added for status pills and toast cards

Important scope note:

- this checkpoint does not prove that the cloud backup definitely has newer Double Ratchet state
- this checkpoint does not auto-restore
- this checkpoint does not block Start
- this checkpoint does not solve multi-device state synchronization
- this checkpoint only uses metadata as a safety signal
- users still need to backup before leaving a device and restore before continuing on another device

Expected behavior:

- normal Start should still work as before
- if local backup receipt is current, no warning should appear
- if cloud `serverSavedAt` is newer than the local receipt, the warning should appear after Start
- if backup metadata is unavailable or legacy, Start should remain usable
- realtime/offline chat behavior should remain unchanged

Checkpoint 2 test expectation:

- app builds successfully
- Alice/Giang realtime chat still works
- Backup to Cloud still succeeds
- Restore from Cloud still succeeds
- normal Start should not be blocked by backup metadata checks
- warning appears only as non-blocking guidance when metadata indicates a newer cloud backup may exist

### Account ID Hardening - Checkpoint 2A: Freshness Warning For Missing Local Receipt

Completed in:

- `client/ui/hooks/useChatApp.js`
- `PROJECT_NOTES.md`

Reason:

- manual testing showed a realistic device-switching risk:
  - a phone had an older local vault from before backup receipt metadata existed
  - laptop saved a newer cloud backup
  - phone could still press `Start` and chat from the older local vault without warning
  - this can desynchronize Double Ratchet state

Change:

- if a matching cloud backup exists for the current identity
- and the local vault does not have a local backup receipt timestamp
- the UI now shows a non-blocking warning:
  - status: `Cloud backup available`
  - toast: `Cloud backup available. Restore first if this account was used on another device.`

Important scope note:

- the warning does not claim the local vault is definitely stale
- the warning avoids internal wording such as `local backup checkpoint`
- Start remains allowed
- Restore remains manual
- this still does not implement multi-device state synchronization

Expected behavior:

- devices with current local backup receipt should behave as before
- devices with older local vaults and no receipt should get a clear restore-first warning when cloud backup exists
- the warning is guidance for device switching, not a hard security block

Follow-up correction after manual phone/laptop testing:

- showing the warning only after `Start` is too late because the stale browser may already replace the active session
- freshness risk is now checked before opening the chat session when a local vault exists
- if the pre-start check detects risk, the app opens a backup safety modal before `initChat(...)`
- the modal gives three explicit choices:
  - `Restore from Cloud`
  - `Start anyway`
  - `Cancel`
- this prevents an older browser vault from silently kicking a newer active device without a restore-first warning
- after successful restore, the client now saves local backup receipt metadata from the restored cloud backup
- a freshly restored device should therefore have a local `serverSavedAt` checkpoint for future freshness checks

UI stability correction:

- runtime bridge subscription now installs once per React app mount instead of rebinding on every active conversation change
- the current active peer is tracked through a React ref so realtime events are routed against the latest selected peer
- this reduces race risk where a realtime event arrives while the conversation pane is reloading and the visible message list can appear stale or empty
- no chat protocol, storage schema, Mongo schema, or Double Ratchet behavior was changed by this correction

### Account ID Hardening - Checkpoint 3: Account/Identity Info Panel

Completed in:

- `client/ui/App.jsx`
- `client/ui/hooks/useChatApp.js`
- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- make the transitional account model easier to see and explain during demo
- show the difference between user-facing display name, internal account id, cryptographic identity id, and local backup receipt
- keep all sensitive material hidden

Changes:

- added a sidebar `Account identity` panel after Start/Restore
- the panel shows only non-secret summary fields:
  - display name
  - shortened account id
  - shortened identity id
  - last known local backup receipt time
- the panel updates after:
  - successful Start
  - successful Backup to Cloud
  - successful Restore from Cloud
- added compact styling that fits inside the existing sidebar on desktop and mobile

Important scope note:

- this checkpoint does not change account derivation
- this checkpoint does not add Firebase/Google authentication
- this checkpoint does not change backup encryption
- this checkpoint does not change Double Ratchet state
- this checkpoint does not expose private keys, vault data, plaintext message history, or backup passwords
- shortened ids are for demo/debug clarity only, not a user authentication mechanism

Expected behavior:

- before Start, the account panel should not appear
- after Start, the panel should show the current display name, account id short value, identity id short value, and backup state
- after Backup to Cloud, the backup chip should show the account has a local backup receipt
- after Restore from Cloud, the restored identity id short value should be visible before the user presses Start again
- chat, backup, restore, active-session replacement, and offline pending behavior should remain unchanged

Checkpoint 3 test expectation:

- app builds successfully
- Alice/new clean user realtime chat still works
- Backup to Cloud still succeeds and refreshes the panel
- Restore from Cloud still succeeds and fills the panel with restored identity metadata
- warning modal from Checkpoint 2A still appears before risky Start attempts
- no secret key material or full backup payload is shown in the UI

### Account ID Hardening - Checkpoint 4: Backup/Restore UX Safety

Completed in:

- `client/ui/App.jsx`
- `client/ui/hooks/useChatApp.js`
- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- make backup/restore decisions clearer before users switch devices
- remove browser-native restore overwrite confirmation and replace it with an app-owned modal
- reduce accidental restore/start choices that can desynchronize Double Ratchet state

Changes:

- replaced `window.confirm(...)` during restore overwrite with a React modal
- the restore overwrite modal shows:
  - current local identity short id
  - cloud backup identity short id
  - clear warning when the cloud backup identity differs from the local identity
- restore overwrite now requires an explicit `Restore and Replace` action
- added short safety notes to:
  - Backup to Cloud modal
  - Start Confirmation modal
  - Backup Freshness warning modal
- the safety copy explains when to backup, when to restore, and why `Start anyway` can be risky after device switching

Important scope note:

- this checkpoint does not change backup encryption
- this checkpoint does not change cloud backup payload shape
- this checkpoint does not change accountId derivation
- this checkpoint does not change server routing, Mongo schema, WebSocket protocol, or Double Ratchet logic
- password handling is not made worse; the existing restore flow already keeps restore password in React state while completing restore
- no private keys, full vault payload, backup password, or plaintext history is displayed in the modal

Expected behavior:

- Backup to Cloud still opens the password modal and saves backup when the password is correct
- Restore from Cloud still works for one-backup and multi-backup display names
- restoring over an existing local vault now opens an app-styled confirmation modal instead of a browser popup
- Cancel on the overwrite modal cancels restore without replacing the local vault
- Restore and Replace proceeds with restore and then requires Start as before
- Checkpoint 2A risky Start modal still appears before starting from a potentially stale local vault

Checkpoint 4 test expectation:

- app builds successfully
- Alice/new clean user realtime chat still works
- Backup to Cloud still succeeds
- Restore from Cloud into a browser with no local vault still succeeds without overwrite modal
- Restore from Cloud into a browser that already has a local vault opens the overwrite modal
- cancelling overwrite leaves local chat usable
- confirming overwrite restores the selected cloud identity and preserves the existing restore-then-Start flow
- no secret material is shown in any backup/restore safety modal

### Account ID Hardening - Checkpoint 5: Documentation + Demo Script

Completed in:

- `DEMO_SCRIPT.md`
- `PROJECT_NOTES.md`

Goal:

- prepare a safe, readable demo script for the current Account ID Hardening state
- document the exact demo flows that should be shown
- describe current limitations clearly without overclaiming real authentication or multi-device sync

Changes:

- added `DEMO_SCRIPT.md` as a standalone demo guide
- documented how to run the project with:
  - local server on port `3000`
  - named Cloudflare Tunnel
  - quick tunnel fallback
- documented demo flows for:
  - realtime chat
  - offline pending messages
  - Backup to Cloud
  - Restore from Cloud
  - device-switch safety warning
  - restore overwrite safety modal
- added plain-language definitions for:
  - display name
  - accountId
  - identityId
  - vault
  - Backup to Cloud
  - Restore from Cloud
- recorded demo safety guidance:
  - use clean users that have not desynchronized
  - backup before switching devices
  - restore before chatting on a new device
  - avoid showing secrets during demo

Important scope note:

- this checkpoint is documentation only
- no app runtime code changed
- no crypto, storage, WebSocket, MongoDB, React UI, or server behavior changed
- no sensitive values were added to the documentation
- the documentation continues to state that `accountId` is transitional and not real authentication

Expected behavior:

- app behavior remains exactly the same as Checkpoint 4
- documentation can be read aloud during progress reporting
- demo instructions should match the current domain and fallback tunnel setup

Checkpoint 5 test expectation:

- review `DEMO_SCRIPT.md` for clarity
- confirm it does not contain passwords, tunnel credentials, private keys, backup payloads, Mongo connection strings, or account secrets
- optionally run `npm start` and `cloudflared tunnel run realtime-secure-chat` to confirm the commands still match the current setup

## Firebase Auth Planning / Auth Provider Design

This phase is a planning/design phase before coding Firebase or Google sign-in.

Goal:

- design how a real authentication provider should fit into the existing E2EE chat architecture
- avoid confusing Firebase account identity with local vault identity or Double Ratchet state
- prepare a safe implementation plan for a later coding phase
- preserve the current demo-ready behavior while planning the next architecture step

Non-goals:

- no Firebase SDK installation in this phase
- no Google sign-in button in this phase
- no Firebase Admin SDK in this phase
- no WebSocket authentication token verification in this phase
- no MongoDB schema migration in this phase
- no change to Double Ratchet, vault encryption, backup encryption, or message protocol

Recommended checkpoint order:

1. Auth Design Baseline
2. Firebase Account Model Design
3. Auth Flow UX Design
4. Auth Session And Identity State Design
5. Backend Auth Boundary Design
6. Backup/Restore Migration Design
7. Threat Model / Safety Notes
8. Implementation Plan For Firebase Auth Foundation

### Firebase Auth Planning - Checkpoint 0: Auth Design Baseline

Completed in:

- `PROJECT_NOTES.md`

Goal:

- capture the current account, identity, vault, backup, and routing model before introducing Firebase
- clearly state what problem Firebase is expected to solve later
- clearly state what Firebase will not solve in an E2EE chat app

Current account model:

- users currently type a human-readable `displayName` in the UI
- the app derives a transitional local `accountId` from that display name
- the current `accountId` is not real authentication
- `identityId` is derived from the long-term public key and identifies the cryptographic identity
- one display name can have multiple backup identities, so restore may require identity selection

Current local identity model:

- each browser stores an encrypted local vault
- the vault contains identity metadata, Double Ratchet state, local message history, conversation metadata, and backup receipt metadata
- if browser site data/localStorage is deleted, the local vault is deleted too
- cloud backup is still required to recover identity state on a new browser/device

Current backup/restore model:

- Backup to Cloud uploads an encrypted backup blob
- Restore from Cloud downloads and decrypts a selected backup locally
- the server stores encrypted backup data and metadata but does not receive the backup password
- newer backup metadata is used to warn before risky device switching
- restore overwrite now requires explicit confirmation if a local vault already exists

Current server/routing model:

- backend serves UI/static files, HTTP APIs, and WebSocket on port `3000`
- public access is available through the named Cloudflare Tunnel at `https://chat.securechat.id.vn`
- server runtime tracks active sessions with account-aware metadata while keeping legacy fallback
- current mode is still best treated as one active browser/device per account label at a time

Current MongoDB role:

- `certs`: signed public certificate material and identity metadata used for peer setup
- `identity_backups`: encrypted cloud identity backups plus backup metadata
- `messages`: encrypted message envelopes for recent-message catch-up
- `pending_messages`: encrypted offline messages waiting for recipient delivery
- `account_active_devices`: account/session metadata for active device routing

Firebase will eventually solve:

- real account authentication
- stable account owner identity through `firebaseUid`
- reduced reliance on user-entered display names for account identity
- a safer foundation for future multi-device/account UX

Firebase will not automatically solve:

- E2EE key recovery if the user loses local vault and has no backup
- Double Ratchet state synchronization across multiple devices
- plaintext message access for the server
- backup password recovery
- automatic restore of a browser that has no local identity

Important architecture boundary:

- Firebase/Google Auth answers: who owns this account?
- local vault and Double Ratchet answer: does this browser have the cryptographic identity and current secure chat state?
- signing into Google later must not automatically mean the browser can chat immediately
- a new browser may still need Restore from Cloud or Create New Identity after authentication

Checkpoint 0 test expectation:

- no runtime behavior changes
- no code behavior changes
- documentation clearly says `accountId` is transitional and not real authentication
- documentation clearly separates Firebase account auth from local E2EE identity/vault state

### Firebase Auth Planning - Checkpoint 1: Firebase Account Model Design

Completed in:

- `PROJECT_NOTES.md`

Goal:

- define the account and identity model that a later Firebase implementation should follow
- prevent future code from using display names as trusted account identifiers
- keep legacy fallback explicit so existing demo data remains understandable during migration

Canonical model after Firebase:

- `firebaseUid` is the trusted account owner id after Firebase token verification
- `displayName` is a human-readable label only
- `identityId` is the cryptographic identity id derived from the long-term public key
- `email` is optional account profile information and must not be used as a primary key
- local `accountId` remains the transitional id only while the app is in legacy/local mode

Account identifier rules:

- when Firebase is signed in and the backend has verified the ID token:
  - canonical account id = `firebaseUid`
  - server routing and ownership decisions should use the verified `firebaseUid`
  - server must not trust a client-provided `accountId`
- when Firebase is not enabled or the app runs in legacy demo mode:
  - canonical account id = current transitional local `accountId`
  - legacy username/display-name fallback remains available
  - the fallback must be documented as transitional, not real authentication

Display name rules:

- display names can be duplicated
- display names can change in a future UI
- display names are acceptable for search/display labels
- display names must not be used as the long-term ownership key after Firebase exists
- existing username-oriented code can remain as a compatibility layer until Firebase-backed paths are implemented and tested

Identity rules:

- one Firebase account can have one or more cryptographic identities over time
- one identity is represented by `identityId`
- `identityId` remains necessary for:
  - choosing the correct cloud backup
  - avoiding restore into the wrong local identity
  - routing to the active device identity
  - explaining why Google login alone does not restore E2EE state
- Firebase must not replace the `identityId` concept

Backup ownership model:

- future Firebase-era backups should be scoped by:
  - verified `firebaseUid`
  - `identityId`
  - backup metadata timestamps
- display name should remain metadata only
- legacy backups without `firebaseUid` must remain restorable through explicit legacy fallback
- legacy backups should not be automatically linked to a Firebase account just because display names match
- linking a legacy backup to a Firebase account should require:
  - user is signed in with Firebase
  - user enters the correct backup/vault password
  - user explicitly confirms linking

Data model contract:

- `canonicalAccountId`:
  - `firebaseUid` when Firebase auth is active and verified
  - transitional local `accountId` in legacy/local mode
- `senderAccountId` / `recipientAccountId`:
  - should become verified Firebase account ids in authenticated paths
  - can keep transitional account ids in legacy paths
- `senderIdentityId` / `recipientIdentityId`:
  - remain cryptographic identity ids
  - should not be replaced by Firebase ids
- `displayName`:
  - UI label only
  - safe to show
  - unsafe as a unique account key
- `email`:
  - optional UI/account profile metadata
  - not a primary key
  - should not be used for routing or backup ownership

Migration stance:

- do not remove current username/accountId fallback in the first Firebase coding phase
- add Firebase fields additively first
- prefer dual-read paths during migration:
  - Firebase-aware lookup when `firebaseUid` is available
  - legacy lookup when old records do not have Firebase metadata
- only tighten or remove fallback after Firebase-backed backup, restore, routing, and regression tests are stable

Important scope note:

- this checkpoint is documentation only
- no Firebase SDK was added
- no server auth verification was added
- no MongoDB schema changed
- no React UI changed
- no backup payload changed

Checkpoint 1 test expectation:

- no runtime behavior changes
- documentation clearly states `firebaseUid` is the future trusted account id
- documentation clearly states `displayName` is not a primary key
- documentation clearly keeps `identityId` separate from Firebase account identity
- documentation explicitly rejects auto-linking legacy backups by display name alone

### Firebase Auth Planning - Checkpoint 2: Auth Flow UX Design

Completed in:

- `PROJECT_NOTES.md`

Goal:

- define the intended user flow after adding Google/Firebase sign-in
- prevent the UI from implying that Google login automatically unlocks E2EE chat state
- preserve the existing Start / Restore / Backup mental model while introducing real account auth

Core UX principle:

- Firebase sign-in authenticates the account owner
- local vault availability determines whether this browser can continue as a cryptographic identity
- chat should open only after both conditions are handled:
  - account/auth state is valid
  - local identity state is available and started

Primary auth states:

- signed out:
  - show `Sign in with Google`
  - keep legacy/local demo mode available only if explicitly supported during migration
- signed in:
  - show the authenticated account profile summary
  - show display name as editable profile/display label only if that is part of the later UI
  - do not auto-start chat
- auth loading:
  - show a non-destructive loading state while Firebase restores auth persistence
- auth error:
  - show a user-readable error and keep the current local session safe

Primary identity states after sign-in:

- no local vault for this Firebase account:
  - offer `Restore from Cloud`
  - offer `Create New Identity`
  - do not show normal chat composer yet
- local vault exists:
  - allow `Start`
  - still run backup freshness/device-switch warnings before starting
- restored but not started:
  - show `Restore ready`
  - require pressing `Start`
- started:
  - show chat UI
  - allow Backup to Cloud and Logout
- locked/disconnected:
  - require password/Start or reconnect flow according to the final implementation design

Recommended first Google sign-in UX:

1. User clicks `Sign in with Google`.
2. Firebase client completes sign-in and exposes a user object.
3. UI shows signed-in account summary:
   - Google display name or local display label
   - email if available
   - no sensitive token data
4. UI checks whether a local vault exists for the canonical account.
5. If no local vault exists:
   - primary action: `Restore from Cloud`
   - secondary action: `Create New Identity`
6. If local vault exists:
   - primary action: `Start Secure Chat`
   - secondary action: `Restore from Cloud`
7. User must explicitly Start after Restore/Create.

Restore UX after Firebase:

- Restore should be scoped to the signed-in Firebase account when possible
- legacy backup restore should be a separate compatibility path
- if a backup does not have `firebaseUid`, UI should say it is a legacy backup
- linking a legacy backup to the signed-in Firebase account should require explicit confirmation
- restore must not happen silently just because display names match

Create New Identity UX after Firebase:

- creating a new identity should be explicit
- UI should explain that a new cryptographic identity is being created for this browser
- after creation, the user should be encouraged to Backup to Cloud
- if the same Firebase account already has cloud backups, UI should recommend Restore first before creating a new identity

Logout UX after Firebase:

- `Logout` should have two layers in the final design:
  - sign out of Firebase account
  - close/destroy active chat session
- signing out should disconnect WebSocket/chat session
- signing out should not automatically delete local vault
- deleting local vault should be a separate destructive action with explicit confirmation

Popup vs redirect decision:

- first implementation should prefer `signInWithPopup` for desktop/demo simplicity
- mobile must be tested separately because popup behavior can vary across browsers
- if popup is unreliable on mobile, a later checkpoint/phase can design `signInWithRedirect`
- redirect flow should not be added casually because it introduces additional state restoration and domain/authDomain considerations

Firebase Console planning requirements:

- Google provider must be enabled in Firebase Authentication sign-in methods
- authorized domains should include:
  - `chat.securechat.id.vn`
  - `localhost` for local testing if needed
- do not store Firebase config secrets in documentation
- client Firebase config is not equivalent to server credentials
- server credentials/Admin SDK configuration must remain server-side only in the later implementation phase

Important non-goals for this checkpoint:

- no Google sign-in code
- no Firebase client config
- no Firebase Admin SDK
- no auth token verification
- no UI implementation yet
- no change to existing Start/Restore behavior

Checkpoint 2 test expectation:

- no runtime behavior changes
- documentation clearly states login does not auto-open chat
- documentation clearly states a new browser still needs Restore from Cloud or Create New Identity
- documentation records popup-first as the initial implementation preference
- documentation includes authorized domain planning for `chat.securechat.id.vn` and `localhost`

### Firebase Auth Planning - Checkpoint 2.5: Auth Session And Identity State Design

Completed in:

- `PROJECT_NOTES.md`

Goal:

- separate Firebase auth session state from local E2EE identity state
- define how the future UI should behave when Firebase session, vault state, and chat runtime state do not match
- prevent future code from treating a signed-in Google session as an unlocked chat session

State layers:

1. Auth session state:
   - controlled by Firebase Auth
   - answers whether a user is signed in and which verified account owns the session
   - example values:
     - `auth_loading`
     - `signed_out`
     - `signed_in`
     - `auth_error`

2. Local identity/vault state:
   - controlled by browser-local storage and the user's vault password
   - answers whether this browser has the cryptographic identity needed for E2EE
   - example values:
     - `unknown`
     - `no_local_vault`
     - `local_vault_exists`
     - `restore_ready`
     - `identity_started`
     - `identity_locked`

3. Chat runtime state:
   - controlled by `client/chat.js`, WebSocket, certificates, and Double Ratchet state
   - answers whether this browser currently has an active secure chat runtime
   - example values:
     - `not_started`
     - `starting`
     - `ready`
     - `disconnected`
     - `forced_logout`

Key rule:

- Firebase `signed_in` is necessary for future authenticated account ownership
- Firebase `signed_in` is not sufficient for E2EE chat
- E2EE chat requires a usable local identity/vault and a started chat runtime

Expected state combinations:

- `signed_out` + any local vault:
  - do not open authenticated chat
  - local vault may remain on disk/browser storage
  - user can sign in again later without deleting local vault
- `signed_in` + `no_local_vault`:
  - show Restore/Create identity choices
  - do not show normal chat composer
- `signed_in` + `local_vault_exists` + `not_started`:
  - allow Start after password/device-switch checks
- `signed_in` + `restore_ready`:
  - require Start before chat opens
- `signed_in` + `identity_started` + `ready`:
  - show normal chat UI
- `signed_in` + `identity_started` + `disconnected`:
  - allow reconnect/start flow without implying auth failed
- `auth_error` + active chat:
  - future implementation should close or pause authenticated WebSocket use safely
  - do not delete local vault automatically

Firebase persistence design:

- Firebase Web Auth may persist signed-in state across browser restarts
- restoring Firebase auth persistence must not auto-unlock the local vault
- after page reload:
  - Firebase may restore `signed_in`
  - UI must still check local vault availability
  - user may still need to enter vault password and press Start

Token refresh / expiration design:

- future WebSocket auth should use a Firebase ID token
- ID tokens can expire and be refreshed by Firebase client SDK
- if WebSocket reconnects:
  - client should request a fresh ID token
  - server should verify the new token
  - server should derive account identity from verified token claims, not from client-provided accountId
- if token refresh fails:
  - close or pause authenticated chat session
  - keep local vault intact
  - ask user to sign in again

Logout design:

- `Sign out` from Firebase should:
  - close authenticated WebSocket session
  - stop/destroy active chat runtime
  - clear transient UI/session state
  - not delete the browser local vault by default
- `Delete local identity/vault` should be a separate destructive action:
  - explicit label
  - confirmation modal
  - clear explanation that cloud backup is needed to recover later

Device switching design:

- signing into Google on a second device proves account ownership only
- the second device still needs Restore from Cloud or Create New Identity
- if the device has an old local vault, existing freshness warnings should still run before Start
- Start anyway should remain possible only as an explicit risky action, not as the default path

Future UI implication:

- topbar should eventually show two statuses:
  - account/auth status, such as `Signed in`
  - secure identity/session status, such as `Restore needed`, `Ready`, or `Disconnected`
- this avoids misleading the user into thinking Google sign-in means secure chat state is ready

Important non-goals for this checkpoint:

- no Firebase Auth persistence code
- no token refresh implementation
- no WebSocket auth implementation
- no local vault deletion feature
- no UI implementation

Checkpoint 2.5 test expectation:

- no runtime behavior changes
- documentation clearly separates auth session state, local vault state, and chat runtime state
- documentation states Firebase persistence must not auto-unlock local vault
- documentation states sign-out must not delete local vault by default
- documentation states token refresh/reconnect must use freshly verified ID tokens in the future

### Firebase Auth Planning - Checkpoint 3: Backend Auth Boundary Design

Completed in:

- `PROJECT_NOTES.md`

Goal:

- define the backend security boundary for future Firebase Auth implementation
- ensure the server trusts only Firebase ID tokens that it verifies itself
- keep legacy/local demo mode explicit during migration

Core backend rule:

- client-provided `firebaseUid`, `accountId`, `email`, or display name must not be trusted as proof of account ownership
- the client may send a Firebase ID token
- the server must verify that token using Firebase Admin SDK or an equivalent trusted backend verifier
- only after verification may the server use `decodedToken.uid` as the authenticated account id

Future authenticated request model:

- HTTP APIs that need account ownership should accept:
  - `Authorization: Bearer <firebase-id-token>`
  - or an equivalent explicit auth field during transitional development
- WebSocket register should include an auth token when Firebase mode is enabled
- server should derive:
  - `authenticatedFirebaseUid` from verified token claims
  - `canonicalAccountId` from `authenticatedFirebaseUid`
  - display/profile fields only as metadata

WebSocket register design:

- current register payload includes legacy/transitional account metadata
- future authenticated register should include:
  - Firebase ID token
  - client display label metadata
  - active `identityId` after cert/identity setup
- server should:
  - verify token before treating the socket as authenticated
  - bind the socket to verified `firebaseUid`
  - ignore or downgrade any client-sent `accountId` when a verified Firebase token exists
  - keep `identityId` as the active cryptographic identity for routing

Server session model after Firebase:

- `wsToSession` should eventually contain:
  - verified `firebaseUid` when authenticated
  - canonical account id
  - display name metadata
  - active `identityId`
  - auth mode, such as `firebase` or `legacy`
- active session lookup should prefer verified Firebase account id when present
- legacy username/accountId lookup should remain only for migration/demo fallback

HTTP backup/restore boundary:

- Firebase-era backup list/fetch APIs should be scoped by verified `firebaseUid`
- server should not allow one authenticated Firebase account to list or fetch another account's backups
- encrypted backup payloads still remain unreadable to server
- display name should be used only for filtering/display compatibility, not as ownership proof
- legacy restore path should remain visibly separate while old backups exist

Certificate and messaging boundary:

- Firebase auth proves account ownership
- certificates and `identityId` still prove cryptographic identity/device continuity
- server should not replace `senderIdentityId` / `recipientIdentityId` with Firebase uid
- message routing should eventually use:
  - verified account id for account ownership/session grouping
  - active `identityId` for device/identity targeting

Error handling design:

- missing token in authenticated-only path:
  - return or emit `auth_required`
- invalid/expired token:
  - return or emit `auth_invalid`
  - client should sign in again or refresh token
- token verifies but account/identity mismatch:
  - return or emit `account_identity_mismatch`
- legacy fallback used:
  - log as transitional mode
  - avoid presenting it as fully authenticated Firebase behavior

Token lifecycle design:

- client should request a fresh ID token before opening/reopening authenticated WebSocket
- server should verify token during WebSocket registration
- server should not store long-lived client tokens in MongoDB
- server may store verified uid/session metadata, not raw secrets
- if token expires during a long WebSocket session, the implementation phase must decide between:
  - periodic re-auth message
  - reconnect with fresh token
  - server-side session TTL

Security non-negotiables:

- never trust `uid` copied from client JSON without token verification
- never use email as the database ownership key
- never authorize backup ownership by displayName alone
- never expose Firebase Admin credentials to the browser
- never put service-account credentials in frontend bundles or public docs
- never weaken E2EE because Firebase Auth exists

Migration stance:

- first Firebase coding phase should add authenticated paths beside legacy paths
- legacy mode can remain for local demo and old records
- once Firebase paths are stable, later phases can tighten fallback usage
- removing fallback should be a separate migration phase, not part of initial auth integration

Important non-goals for this checkpoint:

- no Firebase Admin SDK code
- no token verifier code
- no WebSocket register change
- no API auth middleware implementation
- no MongoDB schema/index change
- no client Firebase SDK

Checkpoint 3 test expectation:

- no runtime behavior changes
- documentation clearly says server must verify Firebase ID tokens itself
- documentation clearly says server must ignore unverified client-provided uid/accountId
- documentation keeps `identityId` separate from Firebase uid
- documentation preserves legacy fallback only as transitional migration behavior

### Firebase Auth Planning - Checkpoint 4: Backup/Restore Migration Design

Completed in:

- `PROJECT_NOTES.md`

Goal:

- design how encrypted backup and restore should migrate from display-name/transitional account ids to Firebase-backed account ownership
- preserve old backups while preventing accidental cross-account restore/linking
- keep E2EE boundaries intact: server stores encrypted backup blobs but does not read vault secrets

Current backup model recap:

- backups are stored in `identity_backups`
- backup payloads are encrypted client-side
- backup metadata currently includes username/display name, transitional accountId, identityId, backup version, and backup timestamps
- restore can select between multiple identities under the same display name
- freshness warnings use backup metadata to reduce stale-device Start risk

Future Firebase-era backup identity:

- new backups should be associated with:
  - verified `firebaseUid`
  - `identityId`
  - display/profile metadata
  - backup schema version
  - server-side save timestamp
- `firebaseUid` proves account ownership only after backend token verification
- `identityId` continues to identify the cryptographic identity inside the account
- displayName remains metadata and must not be used as the ownership key

Proposed backup metadata fields:

- `firebaseUid`:
  - set for backups created in authenticated Firebase mode
  - null or missing for legacy backups
- `legacyAccountId`:
  - current transitional account id, retained for migration/debugging
- `displayName`:
  - UI label only
- `identityId`:
  - cryptographic identity id
- `backupSchemaVersion`:
  - version marker for backup metadata contract
- `clientSavedAt`:
  - client-side timestamp, informational
- `serverSavedAt`:
  - server-side timestamp, preferred for freshness comparison
- `linkedAt`:
  - optional timestamp when a legacy backup is explicitly linked to a Firebase account
- `linkedFromLegacy`:
  - optional boolean/metadata flag for migrated legacy backups

Backup save rules after Firebase:

- if Firebase mode is active:
  - server verifies token
  - server derives `firebaseUid`
  - server stores backup under verified `firebaseUid + identityId`
  - server should reject or ignore any mismatching client-supplied account owner fields
- if legacy mode is active:
  - server may continue using current transitional accountId/displayName metadata
  - records should remain clearly marked as legacy/transitional
- backup overwrite/upsert should be scoped by verified owner and identity:
  - Firebase mode: `firebaseUid + identityId`
  - legacy mode: existing legacy key rules

Restore list rules after Firebase:

- authenticated Firebase restore should list backups for the verified `firebaseUid`
- legacy backups should not be mixed silently with Firebase-owned backups
- UI may show a separate section such as `Legacy backups`
- if multiple identities exist, restore selector must remain explicit
- restore selector should show enough non-secret metadata:
  - identity short id
  - display label
  - saved time
  - legacy/Firebase-owned status

Legacy backup linking rule:

- do not auto-link a legacy backup to a Firebase account based only on displayName
- linking a legacy backup should require:
  - user is signed in with Firebase
  - user chooses a specific legacy backup identity
  - user enters the correct restore/vault password
  - client successfully decrypts the backup locally
  - user confirms linking this identity to the current Firebase account
- only after those checks should metadata be updated to associate that backup with the verified `firebaseUid`

Restore overwrite rules:

- restoring into a browser with no local vault:
  - allow restore after password decrypt succeeds
- restoring into a browser with an existing local vault:
  - keep explicit overwrite confirmation
  - show current local identity short id
  - show cloud backup identity short id
  - do not overwrite silently
- restoring a Firebase-owned backup while signed into a different Firebase account:
  - server should reject before returning the backup
- restoring a legacy backup:
  - UI should make legacy status visible
  - optional linking to current Firebase account must be explicit

Freshness warning after Firebase:

- freshness comparison should prefer `serverSavedAt`
- Firebase-owned backups should compare only within the same verified `firebaseUid + identityId`
- legacy backups should keep current fallback behavior until migrated
- a signed-in Firebase session must not suppress freshness warnings
- device-switch warnings still matter because Firebase does not sync Double Ratchet state

Mongo migration stance:

- add fields additively first
- do not delete or rewrite existing backup records in the first Firebase coding phase
- add indexes only after deciding final query patterns
- likely future indexes:
  - `{ firebaseUid: 1, identityId: 1 }`
  - `{ legacyAccountId: 1, identityId: 1 }`
  - `{ displayName: 1, identityId: 1 }` only as legacy/support lookup
- legacy fields should remain readable while old demo identities exist

Security and privacy notes:

- backup payload remains encrypted client-side
- server should never receive backup password
- server should never decrypt vault state
- Firebase auth changes backup ownership checks, not backup encryption
- losing local vault without a valid cloud backup still means E2EE identity may be unrecoverable

Important non-goals for this checkpoint:

- no schema migration
- no new MongoDB indexes
- no backup API changes
- no restore UI changes
- no Firebase token verification code
- no legacy-link implementation

Checkpoint 4 test expectation:

- no runtime behavior changes
- documentation clearly states future backups should scope by verified `firebaseUid + identityId`
- documentation clearly states legacy backups remain restorable
- documentation clearly rejects auto-linking legacy backups by displayName alone
- documentation keeps backup encryption and Firebase account ownership as separate concerns

### Firebase Auth Planning - Checkpoint 5: Threat Model / Safety Notes

Completed in:

- `PROJECT_NOTES.md`

Goal:

- define what Firebase Auth improves and what risks remain in an E2EE chat system
- prevent future implementation from weakening the existing crypto/vault model
- give clear explanations for demo/report questions about authentication vs encryption

Assets to protect:

- plaintext chat messages
- long-term identity private keys
- Double Ratchet state
- encrypted local vault contents
- backup password
- encrypted cloud backup payloads
- Firebase Admin/server credentials
- WebSocket session ownership
- backup ownership metadata

Threats Firebase helps reduce:

- two people claiming the same display name as an account owner
- client forging account ownership by typing a different display name
- server relying only on locally derived transitional accountId
- accidental backup listing/fetching by displayName alone
- weak account identity in future multi-device/account UX

Threats Firebase does not solve:

- compromised browser/device after vault is unlocked
- lost local vault with no usable cloud backup
- forgotten backup/vault password
- stale Double Ratchet state after unsafe device switching
- full multi-device Double Ratchet synchronization
- malicious or buggy frontend code after the user is already signed in
- users choosing `Start anyway` from an outdated local vault

E2EE boundary:

- Firebase Auth proves account ownership
- Firebase Auth does not decrypt messages
- Firebase Auth does not recover E2EE private keys
- Firebase Auth does not prove a browser has the latest ratchet state
- server should still only store ciphertext and metadata needed for routing, backup, and delivery
- backup encryption must remain client-side

Key safety statement:

- signing in with Google/Firebase proves who owns the account
- it does not prove this browser has the right local vault
- it does not prove this browser has the newest Double Ratchet state
- it does not let the server read plaintext

Server trust boundary:

- server may trust `decodedToken.uid` only after verifying the Firebase ID token
- server must not trust client-sent `firebaseUid`, `accountId`, email, or displayName as ownership proof
- server must not expose Firebase Admin credentials to the browser
- server must not persist raw ID tokens unnecessarily

Backup safety:

- cloud backup remains encrypted
- server-side ownership checks should prevent cross-account backup access
- password-based decryption remains client-side
- if a user loses both local vault and cloud backup/password, Firebase cannot recover the E2EE identity
- legacy backup linking must be explicit because displayName is not a reliable ownership proof

Device-switching safety:

- Firebase login on a new device should not auto-start chat
- a new device should restore the latest cloud backup or create a new identity explicitly
- freshness warnings should remain even after Firebase Auth exists
- Start anyway remains a risky action, not the normal path

Implementation guardrails:

- do not replace `identityId` with `firebaseUid`
- do not route encrypted messages by displayName as the long-term design
- do not let Firebase Auth bypass backup freshness warnings
- do not store backup passwords on the server
- do not place Firebase Admin/service-account credentials in frontend files
- do not claim Firebase gives multi-device E2EE sync
- do not remove legacy fallback until Firebase paths are fully tested

Residual risks after Firebase:

- if a browser is compromised, an attacker may interact with whatever that browser can access
- if the user restores an old backup and chooses Start anyway, state can still desynchronize
- if backup password is weak or reused, encrypted backup security depends on password strength and KDF parameters
- if server auth verification is implemented incorrectly, account ownership checks can be bypassed
- if legacy fallback remains too permissive, old username/displayName paths can remain a source of ambiguity

Demo/report explanation:

- "Firebase handles account login. The encryption layer is separate."
- "The server can verify which account is signed in, but it still cannot read messages."
- "A signed-in account still needs a local vault or restored backup to continue E2EE chat."
- "If the local vault is deleted and no backup exists, Firebase cannot recreate the private keys."

Important non-goals for this checkpoint:

- no code changes
- no Firebase setup
- no new security mechanism implementation
- no crypto parameter changes
- no server auth middleware

Checkpoint 5 test expectation:

- no runtime behavior changes
- documentation clearly separates authentication security from E2EE security
- documentation clearly states Firebase cannot recover lost E2EE keys
- documentation clearly states Firebase does not solve multi-device ratchet sync
- documentation records implementation guardrails for the later coding phase

### Firebase Auth Planning - Checkpoint 6: Implementation Plan For Firebase Auth Foundation

Completed in:

- `PROJECT_NOTES.md`

Goal:

- convert the Firebase Auth planning decisions into a concrete coding roadmap for the next phase
- keep the future implementation incremental and testable
- avoid mixing Google sign-in, backend verification, backup migration, and UI cleanup into one risky change

Recommended next coding branch:

- `feature/firebase-auth-foundation`

Preconditions before coding:

- create or choose a Firebase project
- enable Firebase Authentication
- enable Google provider
- Firebase Console checklist:
  - Authentication -> Sign-in method -> Google -> Enable
  - Authentication -> Settings -> Authorized domains
  - add `chat.securechat.id.vn`
  - add `localhost` if local auth testing is needed
- add authorized domains:
  - `chat.securechat.id.vn`
  - `localhost` if local auth testing is needed
- decide where server-side Firebase Admin credentials will live
- do not commit Firebase Admin/service-account credentials
- keep named Cloudflare Tunnel working before changing auth flow

Auth mode feature flag:

- future implementation should use an explicit auth mode flag, for example:
  - `AUTH_MODE=legacy`
  - `AUTH_MODE=firebase_optional`
  - `AUTH_MODE=firebase_required`
- recommended first implementation value:
  - `AUTH_MODE=firebase_optional`
- expected behavior:
  - without Firebase login, legacy/local mode can still run
  - with Firebase login, server uses verified `firebaseUid`
  - if Firebase config is absent or disabled, app should not crash
  - `firebase_required` should only be considered after Firebase paths are stable

Coding phase checkpoint 0 - Baseline:

- create the new implementation branch
- run current regression:
  - `npm start`
  - named tunnel smoke
  - realtime chat
  - offline pending
  - backup/restore
  - device-switch warning
- confirm current legacy/local mode still works before Firebase code starts

Coding phase checkpoint 1 - Firebase Client Setup:

- add Firebase client dependency/config loading
- create a small client auth adapter, for example:
  - `client/auth/firebaseClient.js`
  - `getCurrentUser`
  - `signInWithGoogle`
  - `signOut`
  - `getIdToken`
- prefer environment/config injection rather than hard-coding project values throughout UI code
- do not add Firebase Admin credentials to the frontend
- make the difference explicit:
  - Firebase client config can exist in frontend config
  - Firebase Admin/service-account credentials must remain server-side only
  - service account private keys must not be committed to Git
- if Firebase config is absent/disabled:
  - app should keep legacy mode working when `AUTH_MODE=firebase_optional`
  - Google sign-in UI should be hidden or show a clear `Firebase auth disabled` state
- test:
  - app still builds
  - legacy mode still works if Firebase config is absent or disabled

Coding phase checkpoint 2 - Auth UI Shell:

- add a minimal `Sign in with Google` UI state
- show signed-in account profile summary after sign-in
- do not auto-start chat after sign-in
- keep Restore/Create/Start decisions explicit
- first implementation can use `signInWithPopup`
- mobile redirect can be deferred if popup is reliable enough for demo
- decide auth persistence explicitly:
  - Firebase signed-in state may persist across browser reloads
  - persisted Firebase sign-in must not auto-open the local vault
  - persisted Firebase sign-in must not auto-start chat
- sign out must:
  - close or unregister the current authenticated WebSocket/session
  - stop/destroy active chat runtime
  - return UI to signed-out account state
  - not delete local vault by default
- test:
  - sign in on desktop domain
  - sign out closes account session UI and active WebSocket/session
  - local vault is not deleted on sign out
  - existing chat flows are not opened automatically by sign-in
  - refresh after sign-in keeps account auth state if persistence allows, but chat remains locked/not-started until vault Start/Restore

Coding phase checkpoint 3 - Server Token Verification:

- add Firebase Admin SDK on the server
- add a verifier helper, for example:
  - `server/auth/firebaseAdmin.js`
  - `verifyFirebaseIdToken(token)`
- server must derive `firebaseUid` from verified token claims
- server must not trust client-sent uid/accountId in Firebase mode
- MVP token lifecycle:
  - client requests a fresh ID token immediately before authenticated WebSocket register
  - if server rejects expired/invalid token, client should sign out or ask the user to sign in again
  - deeper token refresh/re-auth during long-lived sockets can be a follow-up
- keep legacy mode available for migration
- test:
  - missing token returns/produces auth-required behavior on authenticated path
  - invalid token fails safely
  - legacy mode still works when Firebase mode is not used

Coding phase checkpoint 4 - Authenticated WebSocket Register:

- extend WebSocket register to optionally include Firebase ID token
- verify token before binding socket to Firebase account
- session metadata should include:
  - auth mode
  - verified firebaseUid when present
  - canonical account id, preferably namespaced during migration such as `firebase:<uid>`
  - display metadata
  - active identityId
- active-session replacement should prefer verified account identity when present
- test:
  - Firebase signed-in user can Start
  - second login for same account replaces active session predictably
  - legacy users still work during migration
  - no plaintext message behavior changes

Coding phase checkpoint 5 - Firebase-Aware Backup Ownership:

- add Firebase-aware backup metadata fields additively
- new Firebase-mode backups should store verified `firebaseUid`
- backup save should reject mismatched client-provided owner metadata
- client must not decide backup owner in Firebase mode
- server should set or verify owner metadata from verified `firebaseUid`
- backup list/fetch should scope to verified Firebase account when authenticated
- legacy backup restore remains available through explicit compatibility path
- test:
  - Firebase account cannot list another account's backups
  - legacy backup still restores through legacy path
  - new Firebase backup restores on another browser after sign-in
  - encrypted payload remains encrypted

Coding phase checkpoint 6 - Legacy Backup Linking UX:

- design and implement explicit legacy backup linking only if needed
- linking requires:
  - signed-in Firebase account
  - explicit legacy backup selection
  - successful local decrypt with password
  - explicit confirmation
- do not auto-link by displayName
- test:
  - cancel leaves backup unlinked
  - wrong password does not link
  - confirmed link associates backup with verified account metadata only after decrypt succeeds

Coding phase checkpoint 7 - Regression And Demo Update:

- run full regression:
  - Firebase sign-in
  - sign-out
  - local vault still requires Start/password
  - realtime chat
  - offline pending
  - backup/restore
  - device-switch warning
  - legacy fallback
  - mobile/domain smoke
  - duplicate displayName across different Firebase accounts
  - sign out does not leave an authenticated socket active
  - Firebase sign-in persistence does not auto-unlock local vault
- update `DEMO_SCRIPT.md` and `PROJECT_NOTES.md`
- document what is now real auth and what remains transitional

Recommended implementation order:

1. Client Firebase setup
2. Auth UI shell
3. Server token verification
4. Authenticated WebSocket register
5. Firebase-aware backup ownership
6. Legacy backup linking if needed
7. Regression/docs

Hard stop rules:

- stop if Google sign-in works but legacy chat breaks
- stop if WebSocket auth breaks quick tunnel/named domain smoke
- stop if Firebase token is trusted without backend verification
- stop if backup/restore can cross account boundaries
- stop if the UI implies Google login restores E2EE keys automatically
- stop if sign out leaves an authenticated WebSocket/session active
- stop if Firebase login automatically opens a local vault without Start/password

Important non-goals for the first coding phase:

- no full multi-device Double Ratchet sync
- no automatic cloud sync of all conversation history
- no server plaintext access
- no deletion of legacy fallback until tested
- no migration that rewrites all old backup records in place

Checkpoint 6 test expectation:

- no runtime behavior changes
- documentation gives a concrete checkpoint-by-checkpoint coding roadmap
- roadmap starts with Firebase setup but delays risky backup migration until backend verification exists
- roadmap preserves legacy fallback during initial implementation
- roadmap includes regression and demo update steps

## Firebase Auth Foundation

This phase starts the actual Firebase/Google authentication implementation.

Goal:

- add Firebase Auth incrementally without breaking existing legacy/local demo behavior
- keep E2EE, vault, Double Ratchet, backup/restore, and offline pending behavior stable
- introduce real account authentication only through verified Firebase tokens
- preserve `AUTH_MODE=firebase_optional` as the safe initial migration mode

Important phase rule:

- each checkpoint must remain testable on its own
- do not implement backup ownership changes before backend token verification exists
- do not make Google sign-in auto-open chat or auto-unlock local vault
- do not remove legacy fallback until Firebase paths are fully tested

### Firebase Auth Foundation - Checkpoint 0: Baseline

Completed in:

- `PROJECT_NOTES.md`

Goal:

- confirm the branch starts from a clean, working legacy/local baseline
- verify the app still builds before adding Firebase code
- record the regression expectations for the rest of this phase

Branch:

- `feature/firebase-auth-foundation`

Automated checks run:

- `npm run build`
- `node --check server/server.js`
- `node --check server/mongo.js`

Result:

- React/Vite production build passed
- server syntax check passed
- Mongo helper syntax check passed

Baseline expectations before Checkpoint 1:

- legacy/local login should still work
- realtime Alice/new-user chat should still work
- offline pending delivery should still work
- Backup to Cloud should still save encrypted backup
- Restore from Cloud should still restore selected identity
- device-switch warning from Account ID Hardening should still appear for risky Start attempts
- named tunnel should still expose `https://chat.securechat.id.vn`
- quick tunnel should remain available as fallback

Important scope note:

- no Firebase SDK was added in this checkpoint
- no Google sign-in UI was added
- no backend token verification was added
- no WebSocket register behavior changed
- no MongoDB schema changed
- no backup/restore behavior changed

Checkpoint 0 test expectation:

- app builds successfully
- existing legacy/local demo flow still works before Firebase code starts
- branch is ready for Checkpoint 1: Firebase Client Setup

### Firebase Auth Foundation - Checkpoint 1: Firebase Client Setup

Completed in:

- `package.json`
- `package-lock.json`
- `.env.example`
- `.gitignore`
- `client/auth/firebaseClient.js`
- `PROJECT_NOTES.md`

Goal:

- add the Firebase Web client SDK as a frontend dependency
- add a small Firebase Auth adapter that can be wired into React in later checkpoints
- keep the current legacy/local chat flow working when Firebase config is absent

Implemented:

- installed the `firebase` package and updated the lockfile
- added `.env.example` with safe Vite-side Firebase config placeholders
- kept real `.env` and `.env.*` files ignored while allowing `.env.example` to be committed
- added `client/auth/firebaseClient.js`
  - reads `VITE_AUTH_MODE`
  - reads optional Firebase Web app config from `VITE_FIREBASE_*`
  - exposes Firebase availability helpers
  - lazily initializes Firebase Auth only when config is complete and mode is not `legacy`
  - exposes Google popup sign-in, sign-out, auth-state subscription, current user, and ID token helpers for later checkpoints

Important behavior:

- default auth mode is `firebase_optional`
- if Firebase config is missing or incomplete, the adapter reports Firebase as unavailable instead of crashing
- this checkpoint does not import the adapter into the UI yet
- no Google sign-in button was added
- no Firebase Admin SDK was added
- no backend token verification was added
- no WebSocket register behavior changed
- no MongoDB schema changed
- no backup/restore behavior changed

Security notes:

- Firebase Web config belongs to the browser-side app and is not an Admin secret
- Firebase Admin/service-account credentials must remain server-side only and must not be committed
- Firebase sign-in will not unlock the local vault by itself in later checkpoints
- E2EE identity, vault password, `identityId`, and Double Ratchet state remain separate from Firebase account identity

Checkpoint 1 test expectation:

- app builds successfully with the new Firebase client dependency
- app still starts without `.env.local` Firebase config
- current legacy/local Start, realtime chat, offline pending, Backup to Cloud, and Restore from Cloud behavior should remain unchanged
- no Google sign-in UI is expected yet

### Firebase Auth Foundation - Checkpoint 1A: Restore/Start Guard Regression Fix

Completed in:

- `client/ui/hooks/useChatApp.js`
- `client/chat.js`
- `server/server.js`
- `PROJECT_NOTES.md`

Reason:

- during Checkpoint 1 named-domain testing, repeated device-switch restore/start flows exposed two safety gaps:
  - Restore failures were too generic, so rate-limit or decrypt errors looked like unexplained password failures.
  - Pre-start warning only checked cloud backups that matched the current local `identityId`; if a browser/phone had a different old local identity for the same display name, Start could proceed without a strong restore warning.

Implemented:

- added a pre-start cloud-backup signal for the case where a cloud backup exists for the display name/account but does not match the browser's current local identity
- tightened Start guard so a browser is considered safe to Start silently only when it has a usable local identity metadata record, not merely any local vault blob
- existing local vault with wrong password now fails clearly before any chat start attempt
- scoped the in-session restore bypass to the exact restored display name, so restoring one user no longer lets a different newly typed user skip the first-start guard in the same tab
- kept the existing "newer cloud backup" warning behavior for matching identities
- preserved the user's ability to continue intentionally through the existing confirmation modal
- changed restore API rate-limit responses to return a clear message
- changed the client restore API wrapper to preserve server-provided restore errors
- changed restore UI toast handling to show the specific error message when available

Important behavior:

- this still does not add Google sign-in UI
- this still does not add Firebase Admin verification
- this still does not change MongoDB schema
- this still does not change Double Ratchet or backup encryption
- the fix is intentionally conservative: if a device has a local identity but cloud has a different identity for the same display name/account, the UI should warn before Start

Checkpoint 1A test expectation:

- if a device has no local vault for a display name, Start still opens the existing Restore/Continue guard
- if a device only has an empty/partial local vault without valid identity metadata, Start also opens the Restore/Continue guard
- if one display name was restored in the current tab, a different new display name must still show the Restore/Continue guard
- if a device has a local vault but the password is wrong, Start fails with a local identity password error
- if a device has an older/different local identity and cloud backup exists, Start opens a cloud-backup warning instead of silently starting
- if Restore is rate-limited, the UI shows a rate-limit message instead of a generic password-looking failure
- successful Restore still says backup restored, then requires pressing Start
- realtime chat, Backup to Cloud, and Restore from Cloud remain functional after the fix

### Firebase Auth Foundation - Checkpoint 2: Auth UI Shell

Completed in:

- `client/ui/hooks/useChatApp.js`
- `client/ui/App.jsx`
- `client/ui/style.css`
- `PROJECT_NOTES.md`

Goal:

- expose a minimal Firebase/Google auth shell in the React UI
- keep Firebase account sign-in separate from local vault Start/Restore
- avoid changing backend token verification, WebSocket register, MongoDB schema, or backup ownership in this checkpoint

Implemented:

- wired the Firebase client adapter into React state
- added auth availability state from `getFirebaseAuthAvailability()`
- subscribed to Firebase auth state only when Firebase client config is complete and auth mode is not `legacy`
- added a topbar `Account auth` panel
  - when Firebase is not configured, it shows a disabled/legacy state
  - when Firebase is configured, it exposes `Sign in with Google`
  - when signed in, it shows a short signed-in account summary and `Sign out`
- added Google sign-in action through the existing Firebase client adapter
- added Firebase sign-out action
- sign-out also destroys the active chat runtime if a local chat session is currently started
- sign-in does not call `Start`
- sign-in does not restore cloud backup
- sign-in does not unlock the local vault
- sign-in does not change Double Ratchet state
- added responsive CSS for the auth panel on desktop, tablet, and mobile

Important behavior:

- without `.env.local` Firebase config, the panel should say Firebase is not configured and the Google sign-in button should be disabled
- legacy/local display-name Start/Restore/Backup remains available
- Firebase signed-in state may persist after browser refresh if Firebase is configured
- persisted Firebase sign-in must still leave chat locked until the user explicitly presses Start or Restore
- this checkpoint still does not verify Firebase ID tokens on the server
- this checkpoint still does not bind WebSocket sessions to verified Firebase accounts
- this checkpoint still does not change backup ownership

Security notes:

- Google sign-in proves future account ownership only
- Google sign-in does not prove this browser has the latest E2EE identity or Double Ratchet state
- local vault password and cloud restore remain required for E2EE state
- server must not trust client-side Firebase user data until the backend verifies an ID token in a later checkpoint

Checkpoint 2 test expectation:

- app builds successfully
- without Firebase config, named-domain demo still works in legacy/local mode
- auth panel appears but does not block Start/Restore/Backup
- Google sign-in button is disabled when Firebase config is absent
- local Start guard, backup freshness warning, restore, realtime chat, and offline pending still work
- if Firebase config is later provided, signing in should not auto-start chat or unlock the vault

### Firebase Auth Foundation - Checkpoint 2A: Backup Flush And Peer Switch Safety

Completed in:

- `client/chat.js`
- `client/ui/hooks/useChatApp.js`
- `client/ui/App.jsx`
- `PROJECT_NOTES.md`

Reason:

- named-domain device-switch testing exposed a risk where a user could switch to a random peer, switch back, see an empty/loading chat pane, then run Backup to Cloud
- if backup exported the persisted vault before the live chat runtime had flushed its latest Double Ratchet state, a restored device could load message history but continue from stale ratchet counters/keys

Implemented:

- added `flushChatState()` to the chat runtime public API
- Backup to Cloud now verifies the local vault password and then forces a runtime state flush before exporting/encrypting the cloud backup payload
- Backup to Cloud is blocked while local history, recent catch-up, or send is still in progress
- the Backup button is disabled during chat sync so the user cannot accidentally save a backup while the active conversation is still changing
- conversation load/recent catch-up now uses an active-peer snapshot for the async flow, reducing race risk when the user changes peer quickly
- typing a peer display name now only opens the peer when the peer already has a local conversation or a ready certificate
- unknown peer names no longer switch the active runtime conversation; the UI shows a warning instead
- Backup to Cloud is also blocked if the active conversation has stored metadata/preview but the message pane is unexpectedly empty after loading
- selecting the already-active peer no longer clears the current timeline before reloading
- if a local/recent reload returns an empty result while the current timeline already has messages, React keeps the existing messages instead of replacing them with an empty pane
- when an unknown peer name is rejected, the Chat with input is reset back to the current active peer
- a browser that receives forced logout because the same account started elsewhere is marked with a local stale-session flag
- the next Start on that browser opens a restore/start-anyway warning instead of silently using the old local ratchet state
- the stale-session flag is cleared after a successful Restore from Cloud or Backup to Cloud

Important behavior:

- this does not change Double Ratchet cryptography
- this does not change MongoDB schema
- this does not change backup encryption format
- this does not make already-desynced identities safe again; those should be restored from a known-good backup or replaced during testing
- backup remains a manual action, but it now waits for a stable local runtime state before exporting

Checkpoint 2A test expectation:

- while switching conversations or fetching recent messages, Backup to Cloud should be temporarily unavailable
- after chat sync finishes, Backup to Cloud should work normally
- after sending/receiving messages, Backup to Cloud should save the latest runtime state
- restoring that backup on another device should load history and continue sending/receiving without ratchet desync
- typing a random peer name and then returning to a valid peer should not allow a stale backup to be created during the transition
- typing a random peer name with no ready certificate/local conversation should leave the current conversation unchanged and show a warning
- if the UI ever shows an empty pane for a conversation that has an existing preview, Backup to Cloud should remain blocked until the conversation is reloaded/reselected correctly
- when a laptop is kicked by a phone login, starting again on the laptop should warn that the local session may be stale
- if the phone sent or received messages, the safe flow is Backup to Cloud on the phone before returning to the laptop, then Restore from Cloud on the laptop

### Firebase Auth Foundation - Checkpoint 3: Server Token Verification Boundary

Completed in:

- `server/auth/firebaseVerifier.js`
- `server/server.js`
- `.env.example`
- `PROJECT_NOTES.md`

Goal:

- add a backend-only Firebase ID token verification boundary
- keep legacy/local named-domain demo behavior unchanged while Firebase server config is absent
- avoid trusting client-provided Firebase user data until the server verifies an ID token

Implemented:

- added `server/auth/firebaseVerifier.js`
  - reads optional server auth mode from `SERVER_AUTH_MODE`
  - reads Firebase project id from `FIREBASE_PROJECT_ID`
  - verifies Firebase ID tokens server-side using Firebase Secure Token public certificates
  - validates token signature, `aud`, `iss`, `sub`, `iat`, and `exp`
  - derives `firebaseUid` only from verified token claims
  - caches Firebase public certs according to the response cache header
- added `GET /api/auth/firebase/status`
  - reports whether server-side Firebase verification is enabled/configured
  - does not expose secrets
- added `POST /api/auth/firebase/verify`
  - expects `Authorization: Bearer <firebase-id-token>`
  - returns `401` for missing/invalid tokens when server Firebase verification is enabled
  - returns disabled/configuration status when server auth remains legacy or unconfigured
- added safe server-side env placeholders to `.env.example`

Important behavior:

- this checkpoint does not require Firebase Admin/service-account credentials
- this checkpoint does not commit any Firebase secret
- this checkpoint does not change WebSocket register behavior yet
- this checkpoint does not change backup ownership yet
- this checkpoint does not change MongoDB schema
- this checkpoint does not change Double Ratchet, vault, backup encryption, or message ciphertext behavior
- legacy mode remains the default through `SERVER_AUTH_MODE=legacy`

Security notes:

- the server may only treat a Firebase account as authenticated after `verifyFirebaseIdToken()` succeeds
- the server must not trust `uid`, email, or accountId values copied from client JSON
- Firebase Auth proves account ownership only; it does not unlock local vaults or prove the browser has the newest Double Ratchet state
- WebSocket and backup APIs still need separate Firebase-aware integration in later checkpoints before Firebase ownership is enforced

Checkpoint 3 test expectation:

- app builds successfully
- server syntax check passes
- with default/legacy server auth config, named-domain legacy chat, Backup to Cloud, and Restore from Cloud still work
- `GET /api/auth/firebase/status` returns JSON and does not require a token
- `POST /api/auth/firebase/verify` without Firebase server config returns disabled/configuration JSON instead of crashing
- if `SERVER_AUTH_MODE=firebase_optional` and `FIREBASE_PROJECT_ID` are configured later, missing/invalid tokens should fail safely with `401`

### Firebase Auth Foundation - Checkpoint 4: Authenticated WebSocket Register

Completed in:

- `client/chat.js`
- `server/server.js`
- `PROJECT_NOTES.md`

Goal:

- allow the WebSocket register handshake to carry a Firebase ID token when the browser is signed in
- verify that token on the server before treating the socket as Firebase-authenticated
- keep legacy/local register behavior working when Firebase is not configured or no token is present

Implemented:

- client chat runtime now asks the Firebase client adapter for a fresh ID token before opening the WebSocket
- if a Firebase user is signed in and Firebase client config is available, `register` sends `firebaseIdToken`
- if Firebase is not configured or no user is signed in, `register` continues in legacy/local mode
- client now waits for both `config` and `registered` before continuing chat initialization
- server verifies `firebaseIdToken` during WebSocket `register`
- when verification succeeds:
  - server derives `firebaseUid` from verified token claims
  - server derives canonical account id as `firebase:<uid>`
  - server ignores client-supplied account id for the authenticated session
  - `registered` and `identity_bound` responses include `authMode: "firebase"` and `firebaseUid`
- when no token is present:
  - legacy mode continues unless `SERVER_AUTH_MODE=firebase_required`
- when token is missing in required mode or invalid when provided:
  - server sends `auth_error`
  - server closes the socket safely

Important behavior:

- this checkpoint still does not change backup ownership rules
- this checkpoint still does not scope backup list/fetch by Firebase account
- this checkpoint still does not change MongoDB schema
- this checkpoint still does not change Double Ratchet, local vault, or ciphertext format
- Firebase sign-in still does not unlock the vault or auto-start chat
- legacy named-domain demo remains available when Firebase config is absent

Security notes:

- Firebase `uid` is only accepted after server-side ID token verification
- client-provided `accountId`, `uid`, or email is not trusted for Firebase-authenticated sessions
- the server uses the verified uid only as account ownership/routing metadata, not as an encryption key
- E2EE identity remains `identityId`; Firebase account identity remains separate

Checkpoint 4 test expectation:

- app builds successfully
- server syntax check passes
- without Firebase client/server config, legacy Start, realtime chat, Backup to Cloud, Restore from Cloud, and offline pending still work
- `GET /api/auth/firebase/status` still reports legacy/disabled by default
- if Firebase client config is later provided, sign-in should make WebSocket register include an ID token
- if server Firebase mode is later enabled and token verifies, server should register the session as `authMode: "firebase"`
- invalid Firebase token should fail safely without binding a socket to a trusted Firebase account

### Firebase Auth Foundation - Checkpoint 4A: Send Delivery Confirmation Guard

Completed in:

- `client/chat.js`
- `server/server.js`
- `PROJECT_NOTES.md`

Reason:

- device-switch testing showed a risky failure mode where the sender UI could show outgoing messages even when the server had not explicitly confirmed delivery or offline queue acceptance
- this made it hard to tell whether the problem was UI-only, routing/session-related, or a Double Ratchet state issue

Implemented:

- each outgoing chat message now includes a client `requestId`
- server `delivery` responses now echo the matching `requestId`
- server send rejections such as inactive identity binding now return a structured `delivery` failure instead of an uncorrelated generic error
- client waits for server delivery confirmation before writing the outgoing plaintext message into local conversation history
- client only treats a message as sent after the server confirms either:
  - direct realtime delivery to an online recipient
  - successful offline queue storage for an offline recipient
- if delivery confirmation fails, times out, or the WebSocket closes, the client rolls the local Double Ratchet state back to the pre-send snapshot

Important behavior:

- this checkpoint does not change ciphertext format
- this checkpoint does not change MongoDB schema
- this checkpoint does not change certificate, backup, or restore payload format
- successful offline sends are still allowed; they are considered successful only after the server accepts them into the pending queue
- failed sends should now show an error instead of silently appearing as successful local messages

Checkpoint 4A test expectation:

- normal realtime chat still works both directions
- offline pending still works: sender sees the message only after the server accepts it for queueing
- when a stale/kicked browser tries to send, the UI should report an error instead of appending a fake successful message
- after switching a user from laptop to phone via restore, multiple messages from the phone should either arrive at the peer or fail visibly; they should not silently appear only on the sender
