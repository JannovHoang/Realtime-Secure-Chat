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
3. Enter vault password and unlock the default vault.
4. Open a peer conversation, for example AliceDemo with BebeDemo.
5. Send realtime messages both ways.
6. Show the backup-needed guidance after a sent or received message.
7. Click Backup to Cloud from the newest working device and show that the
   backup-needed guidance clears.
8. On another browser/device, sign in with the same Google account.
9. Restore from Cloud and unlock with the vault password.
10. If the restore confirmation is same-identity latest backup, show
    `Refresh From Latest Backup?` / `Restore Latest Backup`.
11. If multiple backups exist, show that older backups are under
    `Advanced: show older backups`.
12. Return to the older browser/device and show freshness or inactive identity
    warning when applicable.

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

## Limitations To Mention

- No full automatic multi-device Double Ratchet sync yet.
- Display-name duplicate disambiguation is not complete.
- Older backups are recovery/advanced material, not normal continuation.
- A browser can retain local vaults for multiple display names after different
  Google accounts have used that browser.
