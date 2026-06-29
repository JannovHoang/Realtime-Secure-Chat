# Roadmap

## 1. Device Switching And Active Identity Enforcement

Status: completed.

Goal: make Firebase account active identity server-enforced so stale local
identities cannot silently continue as the current account identity.

## 2. Multi-Device Backup Discipline / Latest Backup Rules

Goal: make cross-device use safer by tightening latest-backup expectations,
freshness warnings, and backup guidance after chat, recovery, and Start over.

## 3. Contact / Peer Identity Disambiguation

Goal: stop treating display name alone as a peer identity. Store peer identity
metadata, detect duplicate display names, and warn when a known peer changes
encrypted identity.

## 4. Automatic Latest Backup / Backup Checkpointing

Goal: reduce manual backup mistakes by adding safe prompts or optional encrypted
backup checkpoints. Any auto backup must upload encrypted state only.

## 5. Firebase Account Ownership Hardening / Production Auth Cleanup

Goal: harden Firebase token verification behind a stable auth adapter and
prepare for Firebase Admin SDK if production credentials are available.

## 6. Legacy Migration / Compatibility Cleanup

Goal: reduce reliance on display-name routes and local vault labels while keeping
safe migration paths for existing demo data.

## 7. Security / Abuse / Operational Hardening

Goal: improve rate limits, logging hygiene, token failure behavior, operational
docs, and abuse resistance without weakening E2EE.

## 8. UX Polish / Demo Readiness

Goal: polish mobile/desktop workflows, warning copy, empty states, reconnect
flows, and demo scripts.
