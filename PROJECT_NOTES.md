# Project Notes

## Project Goal

- Build a real-time secure chat app with end-to-end encryption.
- The server and database must never decrypt message content.
- Offline delivery must be durable.
- Ciphertext history must be durable.
- A single username should have only one active device/session at a time.
- The app should be demoable from other machines through a public tunnel.

## Current Architecture

### Client

- UI lives in `client/ui/`.
- Main chat logic lives in `client/chat.js`.
- The client:
  - connects to the WebSocket server
  - generates or restores identity material
  - receives certificates
  - encrypts and decrypts messages
  - stores local state in an encrypted vault

### Local Identity Storage

- Vault logic lives in `client/storage.js`.
- The vault is stored in browser `localStorage`.
- Local vault data includes:
  - Double Ratchet state
  - local conversation history currently stored after decrypt
  - conversation peer list

### Crypto

- Double Ratchet implementation lives in `crypto/dr/`.
- Password manager / vault implementation lives in `crypto/pm/`.
- The server signs certificates but does not decrypt messages.

### Server

- Main server code lives in `server/server.js`.
- The server currently:
  - accepts WebSocket connections
  - registers users
  - signs and broadcasts certificates
  - relays ciphertext messages
  - forces logout of an older connection when the same username logs in again
  - stores offline messages in `server/pending.json`
- Current single-device behavior is in-memory and is sufficient for one Node server process.

## Definitions

- Identity: private keys + Double Ratchet state + cert cache stored locally.
- History: ciphertext + metadata stored durably on the server/database.
- Backup/Restore: export and import of identity data.
- Pending messages: ciphertext queued for offline delivery.
- Cert cache: signed certificates distributed by the server so clients can verify peers.

## Username Rules

- Normalize usernames with `trim()`.
- Keep case as-is.
- Reject empty usernames.

## Important Behavioral Rules

- The server must store only ciphertext and metadata, never plaintext.
- On login/register flow, clients should receive certificates before pending messages are flushed.
- Current intended ordering for the registration flow:
  1. `config`
  2. `registered`
  3. `cert_cache`
  4. `pending_flushed`
- If pending messages arrive before certificates, decrypt may fail or messages may need to be re-queued locally.

## Current State

- Realtime DM over WebSocket works locally.
- End-to-end encryption with Double Ratchet works.
- Local encrypted vault works.
- Offline queue currently uses `server/pending.json`.
- Signed certificates are currently kept in server memory.
- WebSocket URL is currently hardcoded to localhost and must be refactored before public tunnel demo.

## Planned Next Steps

### Phase 0

- Initialize Git cleanly if needed.
- Push baseline project to GitHub.
- Work on a feature branch before Mongo integration.

### Phase 1

- Refactor client WebSocket URL so it does not hardcode localhost.
- Support running behind a public tunnel.

### Phase 2

- Add MongoDB Atlas connection in `server/mongo.js`.
- Add boot-time connectivity check and index creation.

### Phase 3

- Move offline pending queue from `pending.json` to MongoDB.
- Keep server-side data as ciphertext only.

### Phase 4

- Persist signed certificates in MongoDB so restart does not lose cert cache.

### Phase 5

- Persist ciphertext message history in MongoDB.

### Phase 6

- Test multi-machine demo through ngrok or Cloudflare Tunnel.

## Files To Watch

- `client/chat.js`
- `client/storage.js`
- `client/ui/app.js`
- `server/server.js`
- `server/mongo.js` (planned)
- `README.md`

## Notes For Future Context Windows

- Treat this file as the current project summary and technical intent.
- If code and this file disagree, trust the code first and then update this file.
- Keep this document short, explicit, and current after each major phase.
