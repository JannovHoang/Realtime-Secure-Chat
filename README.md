# Real-time Secure Messenger

This project is a real-time, end-to-end encrypted (E2EE) chat app built for a
course project. It combines:

- Project 1 (Password Manager / Vault) for local state persistence
- Project 2 (Double Ratchet) for E2EE messaging
- Project 3 (WebSocket relay) for realtime delivery

The server **never decrypts** messages. It only relays ciphertext.

---

## Features

- Realtime DM over WebSocket
- End-to-end encryption with Double Ratchet
- Certificate signing by a server CA (ECDSA P-384)
- Offline message queue (ciphertext only)
- Local state persistence in an encrypted vault (browser localStorage, client-side only)
- Optional Google/Firebase sign-in for account ownership
- Browser-local default vault pointer for Google signed-in unlock UX
- Server-enforced active encrypted identity for Firebase-owned accounts
- Encrypted cloud backup/restore with latest-backup restore as the default path

---

## Project Structure

```
client/
  chat.js        # client logic, DR, vault restore/save
  ui/            # UI (Vite)
crypto/
  dr/            # Double Ratchet
  pm/            # Password Manager (Vault)
server/
  server.js      # WebSocket relay + CA signing + offline queue
```

---

## Requirements

- Node.js 18+ (WebCrypto support)
- npm

---

## Run (Development)

Normal local/public-domain setup uses two terminals in the project root:

Terminal 1:
```
npm start
```

Terminal 2:
```
cloudflared tunnel run realtime-secure-chat
```

Then open:
```
https://chat.securechat.id.vn
```

For Vite-only client development, `npm run dev` is still available.

## Account And Vault Model

Google/Firebase sign-in proves account ownership when configured, but it does
not unlock encrypted chat data. The vault password is still required to open the
browser-local E2EE vault and decrypt encrypted cloud backups.

In Firebase mode, display name is a chat/profile label and legacy vault label,
not the durable account owner key. A browser-local default vault pointer can
remember which local vault belongs to the signed-in Google account on that
browser. The pointer stores metadata only and must not contain vault passwords,
recovery keys, plaintext keys, or plaintext messages.

The app does not implement full automatic multi-device Double Ratchet sync.
Before switching devices, save a fresh cloud backup from the newest working
device, then restore the latest backup on the other device.

For signed-in Firebase accounts, the server tracks one active encrypted identity.
Older local identities are blocked from normal Firebase chat and backup paths;
the user should restore the latest active backup or explicitly start over.

---

## Offline Messaging

When the recipient is offline, the server stores ciphertext (not plaintext) in
`server/pending.json`.
Once the user logs in again, pending messages are flushed automatically.

The server does not have access to any encryption keys and cannot decrypt
offline messages.

Notes:
- `pending.json` is runtime data and should not be committed.
- There is a per-user queue limit (`PENDING_MAX`, default 500).

---

## Troubleshooting

- If decrypt fails after offline login, check that the vault can be restored.
- Refreshing a client may reset its local vault state if persistence fails.
- Use consistent usernames (case-sensitive). Different casing results in different identities.

---

# Tiếng Việt

## Giới thiệu

Ứng dụng nhắn tin thời gian thực với mã hóa đầu-cuối (E2EE). Server chỉ
chuyển tiếp ciphertext và không thể đọc nội dung.

## Chạy dự án

Mở 2 terminal ở thư mục gốc:

Terminal 1 (server):
```
npm start
```

Terminal 2 (UI):
```
npm run dev
```

Mở:
```
http://localhost:5173
```

## Offline message

Khi người nhận offline, server chỉ lưu ciphertext (không lưu plaintext) vào
`server/pending.json` và sẽ tự gửi lại khi người nhận login.

---

## License

For educational use only.
