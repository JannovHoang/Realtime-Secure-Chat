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

This follow-up phase is now in progress and has already passed the first two checkpoints in code.

What is implemented so far:

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

Current UX rule:

- when the browser already stores a different local identity, overwrite warning now says that restore will replace the current browser identity with the selected target identity

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

- fetch a recent window of ciphertext messages
- per conversation
- decrypt what is possible
- merge and dedupe safely

Not in scope for that phase:

- full history rebuild
- deep pagination
- global sync of every conversation at login

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
