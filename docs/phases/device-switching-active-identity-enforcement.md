# Phase: Device Switching And Active Identity Enforcement

Status: completed.

## Goal

Prevent old local identities on other devices from silently continuing as the
current active identity for a signed-in Firebase account.

## Implemented

- Server active identity metadata by Firebase account id.
- Active identity read/promote API.
- Explicit active identity establishment for migration/create/restore/start over.
- Client stale identity warning before unlock.
- WebSocket inactive identity blocking.
- Backup list/get/save alignment with server active identity.
- Start over promotion to a new active identity.
- Inactive identity UX polish.
- Docs and regression checklist.

## Still Out Of Scope

- Full multi-device Double Ratchet synchronization.
- Contact/peer identity disambiguation.
- Promote old inactive identity advanced flow.
- Automatic restore.
