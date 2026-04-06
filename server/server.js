// server/server.js
// DM 1ƒ?"1 WebSocket relay + CA signing (Project 2 compatible)
// Server NEVER decrypts. It only relays ciphertext + metadata.
// UI static serving is optional; Vite dev server is usually used in dev.

"use strict";

require("dotenv").config();

const http = require("http");
const path = require("path");
const fs = require("fs");
const WebSocket = require("ws");
const crypto = require("node:crypto"); // Node WebCrypto subtle for import/export JWK
const {
  connectMongo,
  ensureIndexes,
  enqueuePendingMessage,
  getPendingMessagesForUser,
  deletePendingMessagesByIds,
} = require("./mongo");

const {
  generateECDSA,
  signWithECDSA,
  generateEG,
  cryptoKeyToJSON, // exports CryptoKey -> JWK (JSON object)
} = require("../crypto/dr/lib.js");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const UI_DIR = path.join(__dirname, "..", "client", "ui");

// ===== Persisted keys file =====
const KEYS_PATH = path.join(__dirname, "keys.json");

// ===== Pending offline storage =====
const PENDING_PATH = path.join(__dirname, "pending.json");
const MAX_PENDING_PER_USER = process.env.PENDING_MAX
  ? Number(process.env.PENDING_MAX)
  : 500;

function loadKeysFile() {
  if (!fs.existsSync(KEYS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(KEYS_PATH, "utf8"));
  } catch (e) {
    console.error("Failed to parse server/keys.json:", e);
    return null;
  }
}

function saveKeysFile(obj) {
  fs.writeFileSync(KEYS_PATH, JSON.stringify(obj, null, 2), "utf8");
}

// ===== WebCrypto helpers (Node) =====
const subtle = crypto.webcrypto?.subtle;
if (!subtle) {
  throw new Error(
    "Node WebCrypto subtle is not available. Please use Node 18+ (recommended)."
  );
}

// IMPORTANT: Your Project 2 lib uses P-384 for BOTH ECDSA and ECDH.
const NAMED_CURVE = "P-384";

async function importECDSAPublicKeyFromJwk(jwk) {
  return subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: NAMED_CURVE },
    true,
    ["verify"]
  );
}

async function importECDSAPrivateKeyFromJwk(jwk) {
  return subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: NAMED_CURVE },
    true,
    ["sign"]
  );
}

async function importECDHPublicKeyFromJwk(jwk) {
  // Public ECDH key normally has no usages
  return subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: NAMED_CURVE },
    true,
    []
  );
}

async function importECDHPrivateKeyFromJwk(jwk) {
  // Your generateEG() uses ['deriveKey']
  return subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: NAMED_CURVE },
    true,
    ["deriveKey"]
  );
}

// ===== In-memory state =====
const wsToUser = new Map(); // ws -> username (normalized)
const userToWs = new Map(); // username -> ws (latest active)
const signedCerts = new Map(); // username -> { certificate, signatureB64 }

// ===== PATCH: pending offline messages (ciphertext only) =====
const pendingMsgs = new Map(); // username -> Array<msgObj>
let pendingSaveTimer = null;

// ===== CA + GOV keys (persisted) =====
let CA = null; // { pub, sec } ECDSA
let GOV = null; // { pub, sec } ECDH
let CA_PUB_JWK = null;
let GOV_PUB_JWK = null;

// ===== Helpers =====
function normalizeUsername(u) {
  return String(u || "").trim(); // IMPORTANT: trim only, keep case
}

function sendJson(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function abToB64(ab) {
  return Buffer.from(new Uint8Array(ab)).toString("base64");
}

// ===== Pending persistence =====
function loadPendingFile() {
  if (!fs.existsSync(PENDING_PATH)) return;
  try {
    const raw = fs.readFileSync(PENDING_PATH, "utf8");
    const obj = JSON.parse(raw || "{}");
    if (!obj || typeof obj !== "object") return;

    for (const [user, arr] of Object.entries(obj)) {
      if (!Array.isArray(arr)) continue;
      const key = normalizeUsername(user);
      if (!key) continue;
      pendingMsgs.set(key, arr);
    }
  } catch (e) {
    console.warn("Failed to load pending queue:", e);
  }
}

function savePendingFile() {
  try {
    const out = Object.fromEntries(pendingMsgs.entries());
    console.log("[pending] saving users=", Object.keys(out).length);
    const tmpPath = `${PENDING_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(out, null, 2), "utf8");
    fs.renameSync(tmpPath, PENDING_PATH);
  } catch (e) {
    console.warn("Failed to save pending queue:", e);
  }
}

function schedulePendingSave() {
  if (pendingSaveTimer) clearTimeout(pendingSaveTimer);
  pendingSaveTimer = setTimeout(savePendingFile, 200);
}

// ===== PATCH helpers: enqueue + flush =====
function enqueuePending(to, msgObj) {
  const key = normalizeUsername(to);
  if (!key) return;
  if (!pendingMsgs.has(key)) pendingMsgs.set(key, []);
  const q = pendingMsgs.get(key);
  q.push(msgObj);
  console.log("[pending] enqueue key=", key, "newLen=", q.length);
  while (q.length > MAX_PENDING_PER_USER) q.shift();
  schedulePendingSave();
}

function flushPending(user, ws) {
  const key = normalizeUsername(user);
  const q = pendingMsgs.get(key);
  if (!q || q.length === 0) return 0;

  let sent = 0;
  while (q.length) {
    const msg = q.shift();
    const ok = sendJson(ws, msg);
    if (!ok) {
      q.unshift(msg);
      break;
    }
    sent++;
  }

  if (q.length === 0) {
    pendingMsgs.delete(key);
  } else {
    pendingMsgs.set(key, q);
  }

  schedulePendingSave();
  return sent;
}

async function enqueuePendingWithFallback(to, msgObj) {
  const key = normalizeUsername(to);
  if (!key) return;

  try {
    await enqueuePendingMessage(key, msgObj, MAX_PENDING_PER_USER);
    console.log("[pending] mongo enqueue key=", key);
    return;
  } catch (e) {
    console.warn("[pending] mongo enqueue failed, using file fallback:", e);
  }

  enqueuePending(key, msgObj);
}

async function flushPendingWithFallback(user, ws) {
  const key = normalizeUsername(user);
  let sent = 0;

  try {
    const docs = await getPendingMessagesForUser(key, MAX_PENDING_PER_USER);
    const deliveredIds = [];

    for (const doc of docs) {
      const msg = {
        type: "message",
        from: doc.from,
        to: doc.to,
        header: doc.header,
        ciphertextB64: doc.ciphertextB64,
        ts: doc.ts,
      };

      const ok = sendJson(ws, msg);
      if (!ok) break;

      deliveredIds.push(doc._id);
      sent++;
    }

    if (deliveredIds.length > 0) {
      await deletePendingMessagesByIds(deliveredIds);
    }
  } catch (e) {
    console.warn("[pending] mongo flush failed, using file fallback:", e);
  }

  sent += flushPending(key, ws);
  return sent;
}

async function initKeysOnce() {
  const persisted = loadKeysFile();

  // If found, load stable keys so certs remain valid across server restarts
  if (
    persisted?.ca?.pub &&
    persisted?.ca?.sec &&
    persisted?.gov?.pub &&
    persisted?.gov?.sec
  ) {
    try {
      const caPub = await importECDSAPublicKeyFromJwk(persisted.ca.pub);
      const caSec = await importECDSAPrivateKeyFromJwk(persisted.ca.sec);

      const govPub = await importECDHPublicKeyFromJwk(persisted.gov.pub);
      const govSec = await importECDHPrivateKeyFromJwk(persisted.gov.sec);

      CA = { pub: caPub, sec: caSec };
      GOV = { pub: govPub, sec: govSec };
      CA_PUB_JWK = persisted.ca.pub;
      GOV_PUB_JWK = persisted.gov.pub;

      console.log("Loaded CA/GOV keys from server/keys.json");
      return;
    } catch (e) {
      console.error(
        "Failed to import persisted keys (will regenerate new keys):",
        e
      );
      // fallthrough to regenerate
    }
  }

  // First run OR persisted keys invalid -> generate and save
  CA = await generateECDSA();
  GOV = await generateEG();

  CA_PUB_JWK = await cryptoKeyToJSON(CA.pub);
  GOV_PUB_JWK = await cryptoKeyToJSON(GOV.pub);

  const caSecJwk = await cryptoKeyToJSON(CA.sec);
  const govSecJwk = await cryptoKeyToJSON(GOV.sec);

  saveKeysFile({
    ca: { pub: CA_PUB_JWK, sec: caSecJwk },
    gov: { pub: GOV_PUB_JWK, sec: govSecJwk },
    createdAt: new Date().toISOString(),
    curve: NAMED_CURVE,
  });

  console.log("Generated and saved CA/GOV keys to server/keys.json");
}

// ===== HTTP server (optional static serving) =====
const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith("/ws")) {
    res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Use WebSocket to connect.");
  }

  const safePath = req.url === "/" ? "/index.html" : req.url || "/index.html";
  const filePath = path.join(UI_DIR, safePath);

  if (!filePath.startsWith(UI_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": getMime(filePath) });
    res.end(data);
  });
});

// ===== WebSocket server =====
const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (!req.url || !req.url.startsWith("/ws")) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) =>
    wss.emit("connection", ws, req)
  );
});

wss.on("connection", (ws) => {
  // Send config immediately (client waits for this)
  sendJson(ws, { type: "config", caPubJwk: CA_PUB_JWK, govPubJwk: GOV_PUB_JWK });
  sendJson(ws, { type: "server_hello", ok: true });

  ws.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return sendJson(ws, { type: "error", error: "Invalid JSON" });
    }

    // 1) Register
    if (data.type === "register" && typeof data.user === "string") {
      const user = normalizeUsername(data.user);
      if (!user) {
        return sendJson(ws, { type: "error", error: "Empty username" });
      }

      const existing = userToWs.get(user);
      if (existing && existing !== ws) {
        sendJson(existing, {
          type: "force_logout",
          reason: "logged_in_elsewhere",
        });
        try {
          existing.close(4001, "Logged in elsewhere");
        } catch {}
      }

      wsToUser.set(ws, user);
      userToWs.set(user, ws);

      sendJson(ws, { type: "registered", user });

      // ===== send certs BEFORE flushing offline messages =====
      const all = [];
      for (const { certificate, signatureB64 } of signedCerts.values()) {
        all.push({ certificate, signatureB64 });
      }
      sendJson(ws, { type: "cert_cache", items: all });

      // ===== THEN flush pending offline messages =====
      const flushed = await flushPendingWithFallback(user, ws);
      sendJson(ws, { type: "pending_flushed", count: flushed });
      return;
    }

    // 2) Client submits certificate
    if (
      data.type === "cert_submit" &&
      data.certificate &&
      typeof data.certificate.username === "string"
    ) {
      const registeredUser = wsToUser.get(ws);
      if (!registeredUser) {
        return sendJson(ws, { type: "error", error: "Not registered" });
      }

      const certUser = normalizeUsername(data.certificate.username);
      if (certUser !== registeredUser) {
        return sendJson(ws, {
          type: "error",
          error: "Certificate username mismatch",
          registeredAs: registeredUser,
          certUsername: certUser,
        });
      }

      const cert = data.certificate;

      // Sign exact string verified by clients
      const certString = JSON.stringify(cert);
      const sigAb = await signWithECDSA(CA.sec, certString);
      const signatureB64 = abToB64(sigAb);

      signedCerts.set(certUser, { certificate: cert, signatureB64 });

      // Broadcast signed cert
      const msg = { type: "cert_signed", certificate: cert, signatureB64 };
      for (const peer of wss.clients) {
        sendJson(peer, msg);
      }
      return;
    }

    // 3) Send DM ciphertext
    if (data.type === "send" && typeof data.to === "string") {
      console.log(
        "[send] from=",
        wsToUser.get(ws),
        "to=",
        data.to,
        "hasCipher=",
        !!data.ciphertextB64
      );
      const from = wsToUser.get(ws) ?? "unknown";
      const to = normalizeUsername(data.to);
      if (!to) {
        return sendJson(ws, { type: "error", error: "Empty recipient" });
      }

      const msgObj = {
        type: "message",
        from,
        to,
        header: data.header,
        ciphertextB64: data.ciphertextB64,
        ts: Date.now(),
      };

      const toWs = userToWs.get(to);
      console.log(
        "[send] toNormalized=",
        to,
        "toWs?",
        !!toWs,
        "readyState=",
        toWs?.readyState
      );
      if (toWs && toWs.readyState === WebSocket.OPEN) {
        const ok = sendJson(toWs, msgObj);
        if (ok) {
          return sendJson(ws, { type: "delivery", ok: true, to, queued: false });
        }
      }

      // recipient offline OR send failed -> queue ciphertext-only msg for later
      await enqueuePendingWithFallback(to, msgObj);

      // Tell sender it was queued
      return sendJson(ws, { type: "delivery", ok: true, to, queued: true });
    }

    // Backward compatibility
    if (data.type === "join") {
      return sendJson(ws, { type: "joined", room: data.room ?? null });
    }

    return sendJson(ws, { type: "error", error: "Unknown message type" });
  });

  ws.on("close", () => {
    const user = wsToUser.get(ws);
    wsToUser.delete(ws);
    if (user && userToWs.get(user) === ws) {
      userToWs.delete(user);
    }
  });
});

// ===== Boot =====
(async () => {
  try {
    await connectMongo();
    await ensureIndexes();
    await initKeysOnce();
    loadPendingFile();

    server.listen(PORT, () => {
      console.log(`HTTP UI (optional): http://localhost:${PORT}`);
      console.log(`WebSocket: ws://localhost:${PORT}/ws`);
    });
  } catch (err) {
    console.error("Server startup failed:", err);
    process.exit(1);
  }
})();
