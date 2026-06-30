# Phase: Chat UI Polish / Account Vault Simplification

Status: in progress.

## Goal

Make the app feel more like a polished secure chat product for demo while
preserving the existing account, vault, backup, WebSocket, and crypto behavior.

The UI should make the normal path obvious:

```text
Sign in with Google -> Unlock or restore vault -> Chat -> Backup before switching devices
```

## Checkpoint 0: UI Plan And Scope Freeze

Status: completed.

Runtime behavior change: none.

This checkpoint defines the UI polish plan and hard non-goals before runtime UI
changes start.

## Hard Scope Rules

Do not change:

- cryptographic primitives
- Double Ratchet behavior
- recovery key format or handling
- local vault storage format
- encrypted backup payload format
- WebSocket message format
- HTTP API contracts
- MongoDB schema
- active identity enforcement rules
- backup/restore handler semantics

Runtime checkpoints may move, hide, group, or restyle existing controls, but the
underlying handlers must remain the same:

- Backup now calls the existing backup flow.
- Unlock vault calls the existing start/unlock flow.
- Restore latest backup calls the existing restore flow.
- Sign out calls the existing sign-out/logout flow.
- Change vault password calls the existing password-change flow.
- Create recovery key calls the existing recovery-key flow.
- Start over calls the existing reset/start-over flow.

## UX Principles

- Show only actions that fit the current state.
- Make Google Sign-In the normal Firebase entry point.
- Keep signed-out legacy mode available, but make it secondary and clearly
  labeled as local/legacy compatibility.
- Keep Backup to Cloud visible after unlock because it is central to the demo
  and device-switching model.
- Treat Start over as a recovery/danger action, never a normal top-level action.
- Keep technical identity details available for demo/debug, but do not let them
  dominate the chat sidebar.
- Show backup-needed guidance as an action banner near the chat/composer, not as
  permanent identity metadata.
- Use semantic colors:
  - primary blue for the main action in the current state;
  - secondary neutral for supporting actions;
  - amber for warnings;
  - red only for danger actions and destructive confirmations;
  - green for successful status.

## State-Based Action Matrix

### Signed Out

Primary:

- Sign in with Google

Secondary:

- Use legacy/local mode

Hidden:

- Backup to Cloud
- Change vault password
- Create recovery key
- Start over
- Logout

### Signed In, No Local Vault Pointer

Primary:

- Restore from Cloud

Secondary:

- Create new encrypted identity
- Use legacy local identity
- Sign out

### Signed In, Vault Locked

Primary:

- Unlock vault

Secondary:

- Restore latest backup
- Use recovery key
- Sign out

Recovery/danger area:

- Start over with a new encrypted identity

### Vault Unlocked

Top-level actions:

- Backup now
- Settings
- Sign out

Settings:

- Change vault password
- Create recovery key
- Restore latest backup
- Technical details

Danger zone:

- Start over with a new encrypted identity

## Planned Runtime Checkpoints

1. State-based action visibility plus Google-first entry.
2. Vault unlock panel for signed-in users.
3. Compact account/vault status and sidebar conversation priority.
4. Backup-needed banner with Backup now action.
5. Account/Vault entry vs Chat Workspace split.
6. Settings and advanced action grouping.
7. Status wording polish.
8. Visual polish and semantic color hierarchy.
9. Regression and demo checklist update.

### Checkpoint 5 Target: Account/Vault Entry vs Chat Workspace Split

Separate the large account/vault entry UI from the unlocked chat workspace.
This checkpoint remains UI/layout/rendering-condition only.

Account/Vault Entry is used before the app is ready for chat:

- signed out;
- signed in without a local vault/default pointer;
- vault locked;
- restore, recovery, and start-over flows.

Chat Workspace is used after the vault is unlocked:

- compact top bar only;
- sidebar conversations plus chat pane on desktop/laptop;
- existing mobile Account/Vault, Conversations, and Chat detail flow preserved
  unless a small rendering fix is required;
- no large display-name input, Account Auth card, Session Status card, or
  unlocked-only technical actions dominating the chat header.

Unlocked Chat Workspace top-level actions should stay limited to:

- Backup now / Backup to Cloud;
- Settings;
- Sign out when applicable.

Settings should keep secondary and advanced actions grouped:

- Profile / Identity: display name or identity label if needed.
- Vault: Change vault password, Create recovery key.
- Backup: Backup now, Restore latest backup if still useful in unlocked state.
- Advanced: Technical details.
- Danger zone: Start over with a new encrypted identity.

## Design Targets

### Sidebar After Unlock

```text
Chat with
[peer input]

Conversations
- BebeDemo
- Giang Hoang
- ...

Account
AliceDemo · Vault unlocked
Google backup · Backup pending
[Details]
```

### Chat Pane Backup Banner

```text
Local changes are not backed up yet. Back up before switching devices.
[Backup now]
```

### Settings Grouping

```text
Vault
- Change vault password
- Create recovery key

Backup
- Backup now
- Restore latest backup

Advanced
- Technical details

Danger zone
- Start over with a new encrypted identity
```

## Regression Focus

- Google Sign-In and Sign-Out.
- Legacy signed-out mode still works.
- Signed-in pointer unlock still asks only for vault password.
- Restore latest backup still works.
- Backup to Cloud still works and clears backup-needed guidance.
- Realtime chat works both directions.
- Offline pending delivery still works.
- Recovery key, change password, and Start over modals still call existing
  flows.
- Inactive identity warning/block remains intact.
- No private files are tracked.

## Non-Goals

- Full redesign.
- New contact routing.
- Peer identity disambiguation.
- Automatic backup.
- New backend routes.
- Local vault migration.
- Removing legacy signed-out mode.
