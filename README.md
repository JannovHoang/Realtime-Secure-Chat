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

Open two terminals in the project root:

Terminal 1 (server):
```
npm start
```

Terminal 2 (UI):
```
npm run dev
```

Then open:
```
http://localhost:5173
```

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
