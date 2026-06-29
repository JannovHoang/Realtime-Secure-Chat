# Phase: Contact / Peer Identity Disambiguation

Status: planned.

## Goal

Stop treating display name alone as a peer identity.

## Candidate Work

- Store peer identity/account metadata locally.
- Detect duplicate display names.
- Show distinct contact records when needed.
- Warn when a known peer changes encrypted identity.
- Keep legacy display-name typing as migration-compatible UX.

## Non-Goals

- No server plaintext contact graph.
- No automatic trust of a changed identity.
