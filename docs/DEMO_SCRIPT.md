# Public Demo Script

## Setup

Terminal 1:

```powershell
npm start
```

Terminal 2:

```powershell
cloudflared tunnel run realtime-secure-chat
```

Open:

```text
https://chat.securechat.id.vn
```

## Demo Flow

1. Sign in with the intended Google account. For local testing, use the existing
   demo accounts such as AliceDemo, BebeDemo, and Giang Hoang in separate
   browser profiles.
2. Explain: Google proves account ownership; it does not unlock E2EE keys.
3. Enter vault password and unlock the default vault, or restore latest backup
   first if this is a fresh browser/device.
4. Show that the unlocked workspace is compact: Backup to Cloud, Settings, and
   Sign out are the top-level actions.
5. Open an existing peer conversation from the conversation list, for example
   AliceDemo with BebeDemo. For a brand-new conversation, enter the exact peer
   display name in `Chat with`.
6. Send realtime messages both ways.
7. Show the backup-needed guidance after a sent or received message.
8. Click Backup to Cloud from the newest working device and show that the
   backup-needed guidance clears.
9. On another browser/device, sign in with the same Google account.
10. Restore latest backup and unlock with the vault password.
11. If the restore confirmation is same-identity latest backup, show
    `Refresh From Latest Backup?` / `Restore latest backup`.
12. If multiple backups exist, show that older backups are under
    `Advanced: show older backups`.
13. Return to the older browser/device and show freshness or inactive identity
    warning when applicable.

## Mobile Demo Notes

- Signed out and locked states show Account/Vault entry only; they should not
  show the composer or full chat workspace.
- After unlock, mobile first shows Conversations.
- Tap a conversation to open Chat detail.
- Chat detail keeps the peer header and back control visible while messages
  scroll.
- The composer appears only in Chat detail when the peer certificate is ready.

## Backup Discipline Talking Points

- Backup to Cloud stores encrypted state only.
- Before switching devices, backup from the newest working device.
- Restore latest backup before chatting on another device.
- After local send/receive, the app reminds the user to Backup to Cloud before
  switching devices.
- Same-identity latest restore refreshes the browser from the latest active
  backup.
- If the user chats after backup but does not backup again, another device can
  only restore the older state.
- Recovery key helps recover vault access, but Backup to Cloud carries latest
  encrypted chat state.
- After Use recovery key, unlock with the new password and Backup to Cloud.
- After Start over, Backup to Cloud before switching devices.
- Signed-out legacy unlock can still open browser-local vaults by display/vault
  label for migration. For normal Firebase demo flows, sign in with Google first
  and then unlock or restore the intended vault.
- Backup/restore endpoints are rate-limited for abuse protection. During demo,
  avoid repeatedly clicking restore; if rate-limited, wait a few minutes or use
  the local demo restart workaround only as an environment reset.

## Limitations To Mention

- No full automatic multi-device Double Ratchet sync yet.
- Display-name duplicate disambiguation is not complete.
- Contact discovery/search suggestions are not implemented yet. Starting a new
  chat still requires knowing the peer display name.
- Older backups are recovery/advanced material, not normal continuation.
- A browser can retain local vaults for multiple display names after different
  Google accounts have used that browser.
