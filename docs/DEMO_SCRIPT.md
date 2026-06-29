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

1. Sign in with Google.
2. Explain: Google proves account ownership; it does not unlock E2EE keys.
3. Enter vault password and unlock the default vault.
4. Open a peer conversation such as Alice/Bob demo users.
5. Send realtime messages both ways.
6. Close or disconnect one side, send a message, then reconnect to show pending
   ciphertext delivery.
7. Click Backup to Cloud from the newest working device.
8. On another browser/device, sign in with the same Google account.
9. Restore from Cloud and unlock with the vault password.
10. Return to the older browser/device and show freshness or inactive identity
    warning when applicable.

## Backup Discipline Talking Points

- Backup to Cloud stores encrypted state only.
- Before switching devices, backup from the newest working device.
- Restore latest backup before chatting on another device.
- If the user chats after backup but does not backup again, another device can
  only restore the older state.
- Recovery key helps recover vault access, but Backup to Cloud carries latest
  encrypted chat state.
- After Use recovery key, unlock with the new password and Backup to Cloud.
- After Start over, Backup to Cloud before switching devices.

## Limitations To Mention

- No full automatic multi-device Double Ratchet sync yet.
- Display-name duplicate disambiguation is not complete.
- Older backups are recovery/advanced material, not normal continuation.
