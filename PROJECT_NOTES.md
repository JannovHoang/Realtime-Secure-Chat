# Realtime Secure Chat - Public Project Notes

This file is the short, public project handoff. The previous long working notes
were copied to `local-notes/PROJECT_NOTES_PRIVATE.md` for local-only reference.
Do not commit files in `local-notes/`.

For a new Codex session:

1. Read this file first.
2. If available locally, read `local-notes/CODEX_HANDOFF_PRIVATE.md`.
3. If the private handoff is not available, read `docs/CODEX_HANDOFF_TEMPLATE.md`
   and the public docs in `docs/`.

## Project

Realtime Secure Chat is an end-to-end encrypted realtime chat app for a course
project. It combines:

- local encrypted vault storage
- Double Ratchet messaging
- WebSocket realtime relay
- MongoDB Atlas persistence for public metadata/ciphertext backups
- optional Firebase Google Sign-In for product account ownership
- Cloudflare Tunnel public-domain testing

The server must never decrypt plaintext messages, vault data, private keys,
ratchet state, vault passwords, or raw recovery keys.

## Current Stable State

- Normal public-domain setup:
  - terminal 1: `npm start`
  - terminal 2: `cloudflared tunnel run realtime-secure-chat`
  - open `https://chat.securechat.id.vn`
- Firebase Google Sign-In is available when environment variables are configured.
- Google/Firebase proves product account ownership only.
- Vault password still unlocks the browser-local E2EE vault.
- Display name is a profile/chat label and legacy vault label, not the durable
  account owner key.
- Firebase account id is `firebase:<uid>` and must be derived from a verified
  Firebase ID token on the server.
- Browser-local default vault pointer maps a Firebase uid to a local vault label
  and active identity id. It stores metadata only.
- Firebase-owned accounts now have a server-enforced active encrypted identity.
- Inactive local identities are blocked from normal Firebase chat and
  Firebase-owned latest-backup save paths.
- Normal Firebase Restore from Cloud targets the active identity's latest backup.
- Start over creates/promotes a new active encrypted identity after explicit
  user confirmation.
- Recovery key restore keeps the identity from the recovery wrapper/backup; it
  does not create a new identity.

## Current Branch / Phase

Current branch at the time of this cleanup:

```text
feature/active-identity-enforcement
```

Recently completed phase:

```text
Device Switching And Active Identity Enforcement
```

Current checkpoint status:

```text
Checkpoint 8 completed: docs and regression cleanup.
```

## Public Docs

- `README.md` - project overview and run instructions.
- `DEMO_SCRIPT.md` - existing demo notes.
- `docs/CURRENT_STATE.md` - current architecture and limitations.
- `docs/ROADMAP.md` - phase order and goals.
- `docs/REGRESSION_CHECKLIST.md` - regression checklist.
- `docs/DEMO_SCRIPT.md` - short public demo flow.
- `docs/SECURITY_MODEL.md` - security model and invariants.
- `docs/CODEX_HANDOFF_TEMPLATE.md` - public handoff template.

## Architecture Rules

- Do not remove the vault password requirement.
- Do not treat Google Sign-In as E2EE key recovery.
- Do not use display name as Firebase account ownership proof.
- Do not trust client-supplied Firebase uid/account id/email unless the server
  verified the Firebase ID token.
- Do not store plaintext private keys, ratchet state, vault password, raw
  recovery key, plaintext vault data, or plaintext message contents on the
  server.
- Do not auto-restore or auto-promote inactive identities.
- Do not silently use older backups as the default continuation path.
- Keep legacy signed-out mode available until migration cleanup is explicit.

## Known Limitations

- Full automatic multi-device Double Ratchet synchronization is not implemented.
- Users should save a fresh Backup to Cloud before switching devices.
- Users should restore the latest backup before chatting on another device.
- If users chat after backup without another backup, another device can only
  restore the older encrypted state.
- Duplicate display names across different Google accounts are not fully
  disambiguated yet.
- Local vault storage is still keyed by legacy display/vault label.
- Some restore APIs still route by `/api/backups/:username`.
- Older backups remain advanced/recovery material, not normal continuation.

## Short Roadmap

1. Multi-Device Backup Discipline / Latest Backup Rules.
2. Contact / Peer Identity Disambiguation.
3. Automatic Latest Backup / Backup Checkpointing.
4. Firebase Account Ownership Hardening / Production Auth Cleanup.
5. Legacy Migration / Compatibility Cleanup.
6. Security / Abuse / Operational Hardening.
7. UX Polish / Demo Readiness.

## Private Notes Policy

Private/local files belong under:

```text
local-notes/
```

These files must not be committed:

- `local-notes/PROJECT_NOTES_PRIVATE.md`
- `local-notes/CODEX_HANDOFF_PRIVATE.md`
- any file matching `*_PRIVATE.md`
- any file matching `*.private.md`

Before committing documentation changes, run:

```powershell
git status
git ls-files local-notes
```

`git ls-files local-notes` should print nothing.
