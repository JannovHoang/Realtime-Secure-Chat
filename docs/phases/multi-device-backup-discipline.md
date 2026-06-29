# Phase: Multi-Device Backup Discipline / Latest Backup Rules

Status: planned.

## Goal

Make cross-device use safer by reducing chances that users chat from encrypted
state that was not backed up or restored on the current device.

## Candidate Work

- Clearer backup-needed prompts after chat on a restored/new device.
- More precise freshness warning copy.
- Latest-backup metadata checks before unlock and before sending.
- Better recovery guidance after Use recovery key.
- Better Start over backup guidance.

## Non-Goals

- No plaintext sync.
- No removal of vault password.
- No full multi-device Double Ratchet sync.
