# Phase: Multi-Device Backup Discipline / Latest Backup Rules

Status: in progress.

## Goal

Make cross-device use safer by reducing chances that users chat from encrypted
state that was not backed up or restored on the current device.

## Checkpoint 0: Baseline Design And Test Plan

Status: completed.

Runtime behavior change: none.

This checkpoint defines the rules before implementation so the next checkpoints
can stay narrow and testable.

## Backup Discipline Model

- The normal Firebase restore path uses the latest backup for the account's
  active encrypted identity.
- Older backups are advanced/recovery material. They must not be silently used
  as the normal continuation path.
- Manual Backup to Cloud remains the deadline-safe source of truth. Automatic
  backup/checkpointing stays out of this phase unless the must-have work is
  stable.
- Backup freshness is about encrypted local state, not account ownership.
  Google Sign-In proves the Firebase account; the vault password still unlocks
  and decrypts local E2EE state.
- If local chat state changes after the last cloud backup, the user should be
  guided to make a fresh Backup to Cloud before switching devices.
- If cloud metadata appears newer than local state, the user should be guided to
  restore latest backup before chatting from the older local state.
- Recovery key restore keeps the restored identity. After recovery, the user
  should unlock with the new vault password and save a fresh Backup to Cloud.
- Start over creates/promotes a new active identity. After Start over, the user
  should save a fresh Backup to Cloud before switching devices.

## Latest Backup Rules

- Firebase-owned backup save must remain limited to the active encrypted
  identity.
- Firebase Restore from Cloud must default to latest active backup.
- UI copy should avoid implying full multi-device sync. The app supports manual
  encrypted backup/restore discipline, not automatic Double Ratchet state sync.
- Warnings should distinguish:
  - cloud newer than local: restore latest before continuing on this device;
  - local newer than cloud: backup before moving to another device;
  - inactive identity: unlock/chat/backup is blocked until the active identity
    path is used.

## Candidate Runtime Checkpoints

1. Make existing freshness metadata and warning copy explicit enough for demo.
2. Add or tighten backup-needed guidance after local chat state changes.
3. Tighten restore/backup UI around latest active backup versus older backup
   recovery material.
4. Update demo/report docs after runtime behavior is verified.

## Checkpoint 1: Freshness Warning Copy And Metadata Audit

Status: completed.

Runtime behavior change: warning/status copy only. No backup format, crypto,
server storage, or restore path changes.

Implemented:

- Clarified cloud-newer status as latest backup newer than this browser's local
  backup record.
- Clarified cloud-backup-available status as latest active backup available.
- Clarified different-identity warning to prefer Restore Latest Backup before
  chatting from a mismatched local identity.
- Renamed the modal action from Restore from Cloud to Restore Latest Backup for
  freshness warnings.
- Clarified older-backup modal copy: older backups are recovery material, not
  the normal continuation path.

Checkpoint 1 test focus:

- Existing active-identity and backup enforcement behavior remains unchanged.
- Cloud-newer warning clearly instructs Restore Latest Backup before chatting.
- Different-identity warning clearly instructs Restore Latest Backup before
  chatting.
- Older-backup advanced flow still requires confirmation and no longer reads as
  a normal continuation path.

## Checkpoint 2: Backup-Needed Guidance After Local Chat Changes

Status: completed.

Runtime behavior change: UI guidance only. No automatic backup, backup format,
crypto, server storage, or restore path changes.

Implemented:

- Added a session-level backup-needed signal after a user sends a message.
- Added the same signal after a realtime incoming message is received.
- Displayed the signal in the encrypted identity panel:
  "Local encrypted chat state changed after the last backup. Use Backup to Cloud
  before switching devices."
- Cleared the signal after successful Backup to Cloud.
- Cleared the signal after restore/start/logout so it does not carry across
  unrelated local sessions.

Checkpoint 2 test focus:

- Sending a message shows backup-needed guidance.
- Receiving a realtime message shows backup-needed guidance.
- Backup to Cloud clears the guidance.
- Chat, active identity enforcement, and restore behavior remain unchanged.

## Checkpoint 3: Restore Latest And Older Backup Discipline

Status: completed.

Runtime behavior change: restore confirmation copy only. No backup format,
crypto, server storage, active identity enforcement, or restore API changes.

Implemented:

- Kept Firebase Restore from Cloud on the latest active backup path.
- Made the single-backup same-identity confirmation read as a latest-backup
  refresh instead of a generic replace:
  "Refresh From Latest Backup?"
- Renamed that confirmation action to "Restore Latest Backup" when the selected
  backup is the latest active backup for the same encrypted identity.
- Kept different-identity restore confirmation as "Replace Local Identity?"
- Kept older backups behind the advanced confirmation flow and labeled them as
  recovery material, not the normal continuation path.

Checkpoint 3 test focus:

- A same-identity latest active restore shows the latest-backup refresh copy.
- A different-identity restore still shows the replace warning.
- Older backup restore still requires the advanced confirmation.
- Restore, chat, Backup to Cloud, and active identity enforcement remain
  unchanged.

## Test Plan

- Backup to Cloud from the active Firebase identity succeeds and records latest
  encrypted state metadata.
- Restore from Cloud on a second browser/device defaults to the latest active
  backup.
- An older local device sees a clear cloud-newer warning after another device
  saves a newer backup.
- A device that sends or receives messages after its last backup shows clear
  backup-needed guidance before switching devices.
- Older backups are not presented as the normal continuation path.
- Inactive local identity still cannot chat or save a Firebase-owned latest
  backup.
- Recovery key restore keeps the restored identity and guides the user to unlock
  with the new password, then Backup to Cloud.
- Start over promotes a new active identity and guides the user to Backup to
  Cloud before device switching.
- Legacy signed-out flow still works for demo/migration use.
- No plaintext messages, vault password, raw recovery key, private keys, or
  plaintext ratchet state appear in logs or server storage.

## Files Likely In Scope Later

- `client/chat.js`
- `client/ui/App.jsx`
- `client/ui/hooks/useChatApp.js`
- `client/storage.js`
- `server/server.js`
- `server/mongo.js`
- `docs/REGRESSION_CHECKLIST.md`
- `docs/DEMO_SCRIPT.md`

## Out Of Scope For This Phase

- Full automatic multi-device Double Ratchet synchronization.
- Automatic latest backup/checkpointing unless explicitly promoted later.
- Contact/peer identity disambiguation.
- Email/password registration.
- Firebase Admin migration.
- Production deployment hardening.
- Vault encryption format or crypto primitive changes.

## Previous Candidate Work

- Clearer backup-needed prompts after chat on a restored/new device.
- More precise freshness warning copy.
- Latest-backup metadata checks before unlock and before sending.
- Better recovery guidance after Use recovery key.
- Better Start over backup guidance.

## Non-Goals

- No plaintext sync.
- No removal of vault password.
- No full multi-device Double Ratchet sync.
