# Phase: Automatic Latest Backup / Backup Checkpointing

Status: planned.

## Goal

Reduce manual backup mistakes while preserving E2EE.

## Candidate Work

- Optional encrypted backup reminders/checkpoints.
- Backup-needed indicator after local chat state changes.
- Safe backup timing after recovery and Start over.

## Hard Rules

- Upload encrypted snapshots only.
- Do not store vault password or plaintext keys.
- Do not remove user control over account/vault recovery.
