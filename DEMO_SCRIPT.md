# Realtime Secure Chat - Demo Script

This document is a safe demo guide. It intentionally avoids passwords, tunnel
credentials, private keys, backup payloads, and database secrets.

## 1. Demo Goal

This project is a realtime secure chat application. The main goal is to let two
users exchange direct messages while the server only routes encrypted data. The
server stores ciphertext and routing metadata, but it does not read plaintext
messages.

The current demo focuses on:

- realtime one-to-one chat
- offline pending message delivery
- encrypted identity backup and restore
- account and identity metadata visibility
- safer device switching warnings
- fixed public domain access through Cloudflare Tunnel

## 2. How To Run The Demo

Start the app locally:

```powershell
npm start
```

Expose the app through the named Cloudflare Tunnel:

```powershell
cloudflared tunnel run realtime-secure-chat
```

Open:

```text
https://chat.securechat.id.vn
```

Fallback if the named tunnel or domain has a problem:

```powershell
cloudflared tunnel --url http://localhost:3000
```

Then open the generated `trycloudflare.com` URL.

## 3. Short Presentation Script

This is a secure realtime chat project. The frontend is built with React and
served by the Node backend. The backend also handles WebSocket connections,
static UI files, API endpoints, and MongoDB persistence.

For messaging, the project uses an end-to-end encryption design based on a
Double Ratchet style session. Each user has a long-term identity key. The
identity produces an `identityId`, which is stored in the local vault and in
backup metadata. When two users chat, the plaintext is encrypted on the client.
The server receives only encrypted message envelopes and routing metadata.

The browser stores the local identity, chat state, and local message history in
an encrypted vault. The cloud backup feature uploads an encrypted identity
backup to MongoDB. Restore from Cloud downloads that encrypted backup and imports
it back into the browser after the user enters the correct password.

The current account model is transitional. The user still enters a display name,
but the app also derives an internal `accountId` and tracks a cryptographic
`identityId`. This helps make routing and restore decisions safer, while keeping
the UI understandable for demo.

For public access, the app runs locally on port `3000`, and Cloudflare Tunnel
exposes it through `https://chat.securechat.id.vn`. This does not turn the laptop
into a public server with an open inbound port. The local `cloudflared` process
opens an outbound connection to Cloudflare, and Cloudflare forwards requests
through that tunnel.

## 4. Demo Flow

### A. Realtime Chat

1. Open Alice in one browser.
2. Open a second clean user in another browser.
3. Start both users.
4. In Alice, type the second user's display name in `Chat with`.
5. Send a message from Alice.
6. Send a reply from the second user.
7. Show that both sides receive messages in realtime.
8. Show that the sidebar preview and conversation order update.

Expected result:

- messages appear on both sides
- the server does not display plaintext
- the UI remains connected through `https://chat.securechat.id.vn`

### B. Offline Pending Message

1. Keep Alice online.
2. Logout or close the second user.
3. Alice sends a message to the second user.
4. Start the second user again.
5. Open the conversation with Alice.

Expected result:

- the offline message is delivered once
- the message appears in the conversation
- sidebar metadata updates

### C. Backup To Cloud

1. Start a user that has a working local identity.
2. Click `Backup to Cloud`.
3. Enter the correct password.
4. Confirm that the backup succeeds.
5. Show the `Account identity` panel.

Expected result:

- the app reports backup success
- the identity panel shows the display name, shortened account id, shortened
  identity id, and backup state
- the backup stored on the server remains encrypted

### D. Restore From Cloud

1. Open another browser/profile or phone.
2. Enter the same display name and password.
3. Click `Restore from Cloud`.
4. If multiple backup identities exist, choose the correct identity.
5. After restore succeeds, press `Start`.
6. Open the previous conversation and send a test message.

Expected result:

- restore requires the correct password
- restore does not auto-start chat
- after pressing Start, the restored identity can continue chatting

### E. Device Switching Safety

1. Backup the user from the current browser.
2. Use another browser or phone with the same display name.
3. Try pressing `Start` directly when a cloud backup is available or newer.

Expected result:

- the app shows a backup safety warning before entering chat
- the user can choose `Restore from Cloud`, `Start anyway`, or `Cancel`
- for safe use, choose `Restore from Cloud` before chatting from a different
  device

### F. Restore Overwrite Safety

1. Use a browser that already has a local vault for the display name.
2. Click `Restore from Cloud`.
3. Confirm that the app shows `Replace Local Identity?`.
4. Choose `Cancel` once.
5. Try again and choose `Restore and Replace`.

Expected result:

- cancel does not replace the local vault
- confirm replaces the local identity with the selected cloud backup
- the flow still requires pressing `Start` after restore

## 5. Important Terms

`Display name`

The human-readable name typed by the user. In the current transitional version,
this is still the main visible account label.

`accountId`

An internal transitional identifier derived locally from the display name. It is
not real authentication yet. It prepares the project for a future Firebase or
Google Auth phase.

`identityId`

A stable cryptographic identity identifier derived from the user's long-term
public key. This is more important than display name when selecting which
identity backup should be restored.

`Vault`

The encrypted browser-local storage area that holds identity state, ratchet
state, local conversation history, and metadata. If browser site data is deleted,
the local vault is deleted too, so the user must restore from cloud backup.

`Backup to Cloud`

Creates an encrypted identity backup and stores it on the server. The server does
not receive the plaintext vault or backup password.

`Restore from Cloud`

Downloads an encrypted backup, decrypts it locally with the user's password, and
imports the selected identity into the browser.

## 6. Current Limitations

- This phase does not implement Firebase or Google login yet.
- `accountId` is still transitional and derived from display name.
- The project still works best with one active browser/device per account at a
  time.
- Switching devices should be done by backing up on the old device and restoring
  on the new device before continuing chat.
- The app does not implement full multi-device Double Ratchet synchronization.
- If a user continues chatting from an old local vault, secure chat state can
  desynchronize. The warning modals reduce this risk but do not replace real
  multi-device sync.

## 7. Safe Demo Checklist

Before demo:

- run `npm start`
- run `cloudflared tunnel run realtime-secure-chat`
- open `https://chat.securechat.id.vn`
- use clean demo users that have not already desynchronized
- backup before switching devices
- restore before chatting on a new device

Avoid during demo:

- do not reuse users known to have desynchronized ratchet state
- do not show passwords
- do not show Cloudflare tunnel credentials
- do not show Mongo connection strings
- do not show private keys or backup payload contents
