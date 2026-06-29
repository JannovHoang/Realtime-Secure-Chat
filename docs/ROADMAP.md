# Roadmap

## Deadline Priority

This project has a short remaining delivery window. Prefer stable demo/report
readiness over risky feature expansion.

Must-have:

1. Device Switching And Active Identity Enforcement.
2. Multi-Device Backup Discipline / Latest Backup Rules.
3. Demo / Regression / Report.

Should-have:

4. Contact / Peer Identity Disambiguation MVP.

Nice-to-have:

5. Automatic Latest Backup / Backup Checkpointing.

Future work:

6. Full multi-device sync.
7. Email/password registration.
8. Firebase Admin migration.
9. Production deployment hardening.

## 1. Device Switching And Active Identity Enforcement

Status: completed.

Goal: make Firebase account active identity server-enforced so stale local
identities cannot silently continue as the current account identity.

## 2. Multi-Device Backup Discipline / Latest Backup Rules

Priority: must-have.

Status: completed.

Goal: make cross-device use safer by tightening latest-backup expectations,
freshness warnings, and backup guidance after chat, recovery, and Start over.

Scope for deadline:

- Restore default uses latest backup of the active identity.
- Older backups are advanced/recovery data only.
- Cloud-newer and local-newer warnings are clear.
- Manual Backup Now remains available and reliable.
- Local chat changes after the last backup produce clear backup-needed
  guidance.
- Recovery and Start over flows clearly instruct users to save a fresh Backup to
  Cloud before switching devices.
- UI/report clearly state there is no full automatic multi-device Double
  Ratchet sync.

Completed phase outcome:

- Freshness warnings point users to Restore Latest Backup when cloud metadata is
  newer than local state.
- Local chat changes after the last backup show Backup to Cloud guidance before
  device switching.
- Restore confirmation copy distinguishes latest active backup refresh from
  local identity replacement.
- Older backups remain advanced/recovery material, not the normal continuation
  path.
- Manual Backup to Cloud remains the supported deadline-safe discipline.

## 3. Contact / Peer Identity Disambiguation

Priority: should-have MVP.

Goal: stop treating display name alone as a peer identity. Store peer identity
metadata, detect duplicate display names, and warn when a known peer changes
encrypted identity.

Deadline MVP:

- Show peer short identity id where it helps demo clarity.
- Warn or label clearly when display name is not a unique identity.
- Avoid large routing/contact rewrites.

## 4. Automatic Latest Backup / Backup Checkpointing

Priority: nice-to-have. Do not start unless must-have items are stable.

Goal: reduce manual backup mistakes by adding safe prompts or optional encrypted
backup checkpoints. Any auto backup must upload encrypted state only.

Hard preconditions:

- Active identity enforcement is stable.
- Latest backup rules are stable.
- Manual backup/restore regression is stable.
- Contact/peer identity ambiguity is at least clearly surfaced in UI/report.

Notes:

- Auto backup improves device switching but is not full multi-device sync.
- It must never upload plaintext vault data, passwords, recovery keys, private
  keys, ratchet state, or message keys.
- It must not run if the local identity is inactive or if freshness state says a
  newer cloud backup should be restored first.

## 5. Firebase Account Ownership Hardening / Production Auth Cleanup

Priority: future work unless a small blocking bug appears.

Goal: harden Firebase token verification behind a stable auth adapter and
prepare for Firebase Admin SDK if production credentials are available.

## 6. Legacy Migration / Compatibility Cleanup

Priority: future work.

Goal: reduce reliance on display-name routes and local vault labels while keeping
safe migration paths for existing demo data.

## 7. Security / Abuse / Operational Hardening

Priority: future work.

Goal: improve rate limits, logging hygiene, token failure behavior, operational
docs, and abuse resistance without weakening E2EE.

## 8. UX Polish / Demo Readiness

Priority: must-have as part of demo/report freeze.

Goal: polish mobile/desktop workflows, warning copy, empty states, reconnect
flows, and demo scripts.

## Deferred Explicitly

- Full multi-device Double Ratchet synchronization.
- Email/password registration.
- Firebase Admin SDK migration.
- Production deployment hardening.
