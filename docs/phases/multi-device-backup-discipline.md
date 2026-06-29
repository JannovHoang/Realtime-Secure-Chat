# Phase: Multi-Device Backup Discipline / Latest Backup Rules

Status: in progress.

## Goal

Make cross-device use safer by reducing chances that users chat from encrypted
state that was not backed up or restored on the current device.

## Checkpoint 0: Baseline Design And Test Plan

Status: in progress.

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
