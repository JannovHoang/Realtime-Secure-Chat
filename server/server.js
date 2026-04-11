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
  saveCert,
  getAllCerts,
  saveCiphertextMessage,
  saveIdentityBackup,
  getIdentityBackup,
  listIdentityBackups,
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
const MAX_BACKUP_BLOB_B64_LEN = process.env.MAX_BACKUP_BLOB_B64_LEN
  ? Number(process.env.MAX_BACKUP_BLOB_B64_LEN)
  : 8 * 1024 * 1024;
const BACKUP_GET_WINDOW_MS = 5 * 60 * 1000;
const BACKUP_GET_LIMIT = 10;
const backupGetRateLimit = new Map(); // ip -> timestamps[]

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
const wsToSession = new Map(); // ws -> { user, identityId }
const accountSessions = new Map(); // username -> { activeIdentityId, ws }
const signedCerts = new Map(); // username:identityId -> { certificate, signatureB64, identityId }

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

function normalizeIdentityId(v) {
  return String(v || "").trim();
}

function getSession(ws) {
  return wsToSession.get(ws) || null;
}

function getSessionUser(ws) {
  return getSession(ws)?.user || null;
}

function getSessionIdentityId(ws) {
  return getSession(ws)?.identityId || null;
}

function getActiveAccountSession(username) {
  const user = normalizeUsername(username);
  if (!user) return null;
  const session = accountSessions.get(user);
  if (!session?.ws || session.ws.readyState !== WebSocket.OPEN) return null;
  return session;
}

function isActiveAccountSocket(ws) {
  const session = getSession(ws);
  if (!session?.user || !session.identityId) return false;
  const active = getActiveAccountSession(session.user);
  return active?.ws === ws && active.activeIdentityId === session.identityId;
}

async function sendCertCacheAndPending(user, ws) {
  const all = await getCertCacheWithFallback();
  sendJson(ws, { type: "cert_cache", items: all });

  const flushed = await flushPendingWithFallback(user, ws);
  sendJson(ws, { type: "pending_flushed", count: flushed });
}

async function activateAccountSession(ws, user, identityId) {
  const active = getActiveAccountSession(user);
  if (active?.ws && active.ws !== ws) {
    console.log(
      "[session] replacing active account device",
      JSON.stringify({
        username: user,
        previousIdentityId: active.activeIdentityId || null,
        nextIdentityId: identityId || null,
      })
    );
    sendJson(active.ws, {
      type: "force_logout",
      reason: "logged_in_elsewhere",
      previousIdentityId: active.activeIdentityId || null,
      replacedByIdentityId: identityId || null,
    });
    try {
      active.ws.close(4001, "Logged in elsewhere");
    } catch {}
  }

  accountSessions.set(user, {
    activeIdentityId: identityId,
    ws,
  });

  await sendCertCacheAndPending(user, ws);
}

function makeIdentityScopedKey(username, identityId) {
  return `${normalizeUsername(username)}::${normalizeIdentityId(identityId)}`;
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

function writeJson(res, statusCode, obj, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    ...extraHeaders,
  });
  res.end(JSON.stringify(obj));
}

function getRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = backupGetRateLimit.get(ip) || [];
  const fresh = timestamps.filter((ts) => now - ts < BACKUP_GET_WINDOW_MS);
  if (fresh.length >= BACKUP_GET_LIMIT) {
    backupGetRateLimit.set(ip, fresh);
    return true;
  }
  fresh.push(now);
  backupGetRateLimit.set(ip, fresh);
  return false;
}

function abToB64(ab) {
  return Buffer.from(new Uint8Array(ab)).toString("base64");
}

function makeConversationId(a, b) {
  const left = normalizeUsername(a);
  const right = normalizeUsername(b);
  return left < right ? `dm:${left}<->${right}` : `dm:${right}<->${left}`;
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

async function getCertCacheWithFallback() {
  try {
    const docs = await getAllCerts();
    const items = [];
    signedCerts.clear();
    const activeByUser = new Map();

    for (const [username, session] of accountSessions.entries()) {
      if (session?.activeIdentityId) {
        activeByUser.set(username, session.activeIdentityId);
      }
    }

    for (const doc of docs) {
      if (!doc?.username || !doc?.certificate || !doc?.signatureB64) continue;
      const identityId = doc.identityId || doc.certificate?.identityId || null;
      const activeIdentityId = activeByUser.get(doc.username) || null;
      items.push({
        certificate: doc.certificate,
        signatureB64: doc.signatureB64,
        identityId,
        activeIdentityId,
        active: !!activeIdentityId && identityId === activeIdentityId,
      });
      const key = makeIdentityScopedKey(
        doc.username,
        identityId || ""
      );
      signedCerts.set(key, {
        certificate: doc.certificate,
        signatureB64: doc.signatureB64,
        identityId,
      });
    }

    return items;
  } catch (e) {
    console.warn("[certs] mongo load failed, using memory fallback:", e);
  }

  const all = [];
  for (const { certificate, signatureB64 } of signedCerts.values()) {
    const identityId = certificate?.identityId || null;
    const activeIdentityId = accountSessions.get(certificate?.username)?.activeIdentityId || null;
    all.push({
      certificate,
      signatureB64,
      identityId,
      activeIdentityId,
      active: !!activeIdentityId && identityId === activeIdentityId,
    });
  }
  return all;
}

async function saveCiphertextHistoryWithFallback(msgObj) {
  try {
    await saveCiphertextMessage({
      conversationId: makeConversationId(msgObj.from, msgObj.to),
      from: msgObj.from,
      to: msgObj.to,
      header: msgObj.header,
      ciphertextB64: msgObj.ciphertextB64,
      ts: msgObj.ts,
      kind: "dm",
    });
  } catch (e) {
    console.warn("[messages] mongo save failed, history not persisted:", e);
  }
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
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (
    req.method === "OPTIONS" &&
    (reqUrl.pathname.startsWith("/api/backup/") ||
      reqUrl.pathname.startsWith("/api/backups/"))
  ) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (req.method === "GET" && reqUrl.pathname.startsWith("/api/backups/")) {
    const username = normalizeUsername(
      decodeURIComponent(reqUrl.pathname.slice("/api/backups/".length))
    );
    const ip = getRequestIp(req);

    if (!username) {
      return writeJson(res, 400, {
        ok: false,
        error: "Restore unavailable",
      });
    }

    if (isRateLimited(ip)) {
      return writeJson(res, 429, {
        ok: false,
        error: "Restore unavailable",
      });
    }

    void (async () => {
      try {
        const items = await listIdentityBackups(username);
        const safeItems = items
          .filter((doc) => doc?.identityId)
          .map((doc) => ({
            identityId: doc.identityId,
            createdAt: doc.createdAt || null,
            updatedAt: doc.updatedAt || null,
          }));

        return writeJson(res, 200, {
          ok: true,
          username,
          items: safeItems,
        });
      } catch (err) {
        console.warn("[backup_list] failed:", err);
        return writeJson(res, 200, {
          ok: false,
          error: "Restore unavailable",
        });
      }
    })();
    return;
  }

  if (req.method === "GET" && reqUrl.pathname.startsWith("/api/backup/")) {
    const username = normalizeUsername(
      decodeURIComponent(reqUrl.pathname.slice("/api/backup/".length))
    );
    const identityId = normalizeIdentityId(reqUrl.searchParams.get("identityId"));
    const ip = getRequestIp(req);

    if (!username) {
      return writeJson(res, 400, {
        ok: false,
        error: "Restore unavailable",
      });
    }

    if (isRateLimited(ip)) {
      return writeJson(res, 429, {
        ok: false,
        error: "Restore unavailable",
      });
    }

    void (async () => {
      try {
        const doc = await getIdentityBackup(username, identityId || null);
        if (
          !doc?.username ||
          typeof doc.ciphertextB64 !== "string" ||
          typeof doc.ivB64 !== "string" ||
          typeof doc.saltB64 !== "string"
        ) {
          return writeJson(res, 200, {
            ok: false,
            error: "Restore unavailable",
          });
        }

        return writeJson(res, 200, {
          ok: true,
          username: doc.username,
          identityId: doc.identityId || null,
          version: doc.version,
          ciphertextB64: doc.ciphertextB64,
          ivB64: doc.ivB64,
          saltB64: doc.saltB64,
          kdf: doc.kdf,
        });
      } catch (err) {
        console.warn("[backup_get] failed:", err);
        return writeJson(res, 200, {
          ok: false,
          error: "Restore unavailable",
        });
      }
    })();
    return;
  }

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
      const identityId = normalizeIdentityId(data.identityId);
      if (!user) {
        return sendJson(ws, { type: "error", error: "Empty username" });
      }

      wsToSession.set(ws, { user, identityId: identityId || null });

      sendJson(ws, { type: "registered", user, identityId: identityId || null });

      if (identityId) {
        await activateAccountSession(ws, user, identityId);
      }
      return;
    }

    if (data.type === "identity_bind") {
      const session = getSession(ws);
      const identityId = normalizeIdentityId(data.identityId);
      if (!session?.user || !identityId) {
        return sendJson(ws, { type: "error", error: "Invalid identity binding" });
      }

      if (session.identityId && session.identityId !== identityId) {
        console.log(
          "[session] identity rebind",
          JSON.stringify({
            username: session.user,
            previousIdentityId: session.identityId,
            nextIdentityId: identityId,
          })
        );
      }

      wsToSession.set(ws, {
        user: session.user,
        identityId,
      });
      await activateAccountSession(ws, session.user, identityId);
      return sendJson(ws, {
        type: "identity_bound",
        user: session.user,
        identityId,
      });
    }

    // 2) Client submits certificate
    if (
      data.type === "cert_submit" &&
      data.certificate &&
      typeof data.certificate.username === "string"
    ) {
      const registeredUser = getSessionUser(ws);
      const registeredIdentityId = getSessionIdentityId(ws);
      if (!registeredUser) {
        return sendJson(ws, { type: "error", error: "Not registered" });
      }
      if (!registeredIdentityId || !isActiveAccountSocket(ws)) {
        return sendJson(ws, { type: "error", error: "Identity not bound" });
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
      const certIdentityId = normalizeIdentityId(cert.identityId);
      if (!certIdentityId) {
        return sendJson(ws, { type: "error", error: "Certificate identity mismatch" });
      }
      if (registeredIdentityId && certIdentityId !== registeredIdentityId) {
        return sendJson(ws, { type: "error", error: "Certificate identity mismatch" });
      }
      // Sign exact string verified by clients
      const certString = JSON.stringify(cert);
      const sigAb = await signWithECDSA(CA.sec, certString);
      const signatureB64 = abToB64(sigAb);

      signedCerts.set(makeIdentityScopedKey(certUser, certIdentityId), {
        certificate: cert,
        signatureB64,
        identityId: certIdentityId,
      });

      try {
        await saveCert(certUser, certIdentityId, cert, signatureB64);
      } catch (e) {
        console.warn("[certs] mongo save failed, keeping memory cache only:", e);
      }

      // Broadcast signed cert
      const activeIdentityId = accountSessions.get(certUser)?.activeIdentityId || null;
      const msg = {
        type: "cert_signed",
        certificate: cert,
        signatureB64,
        identityId: certIdentityId,
        activeIdentityId,
        active: !!activeIdentityId && certIdentityId === activeIdentityId,
      };
      for (const peer of wss.clients) {
        sendJson(peer, msg);
      }
      return;
    }

    // 3) Send DM ciphertext
    if (data.type === "send" && typeof data.to === "string") {
      console.log(
        "[send] from=",
        getSessionUser(ws),
        "to=",
        data.to,
        "hasCipher=",
        !!data.ciphertextB64
      );
      const from = getSessionUser(ws) ?? "unknown";
      if (!isActiveAccountSocket(ws)) {
        return sendJson(ws, { type: "error", error: "Identity not bound" });
      }
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

      await saveCiphertextHistoryWithFallback(msgObj);

      const activeTargetSession = getActiveAccountSession(to);
      const toWs = activeTargetSession?.ws || null;
      console.log(
        "[send] toNormalized=",
        to,
        "activeIdentityId=",
        activeTargetSession?.activeIdentityId || null,
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

    if (data.type === "backup_save") {
      const requestId = typeof data.requestId === "string" ? data.requestId : null;
      const registeredUser = getSessionUser(ws);
      const registeredIdentityId = getSessionIdentityId(ws);
      const username = normalizeUsername(data.username);
      const identityId = normalizeIdentityId(data.identityId);

      if (!registeredUser || !username || username !== registeredUser) {
        return sendJson(ws, {
          type: "backup_saved",
          ok: false,
          requestId,
          error: "Backup save failed",
        });
      }

      if (
        !identityId ||
        !registeredIdentityId ||
        identityId !== registeredIdentityId ||
        !isActiveAccountSocket(ws)
      ) {
        return sendJson(ws, {
          type: "backup_saved",
          ok: false,
          requestId,
          error: "Backup save failed",
        });
      }

      if (
        typeof data.ciphertextB64 !== "string" ||
        typeof data.ivB64 !== "string" ||
        typeof data.saltB64 !== "string" ||
        !data.ciphertextB64 ||
        !data.ivB64 ||
        !data.saltB64
      ) {
        return sendJson(ws, {
          type: "backup_saved",
          ok: false,
          requestId,
          error: "Backup save failed",
        });
      }

      if (data.ciphertextB64.length > MAX_BACKUP_BLOB_B64_LEN) {
        return sendJson(ws, {
          type: "backup_saved",
          ok: false,
          requestId,
          error: "Backup save failed",
        });
      }

      try {
        await saveIdentityBackup(username, {
          identityId,
          version: Number(data.version || 2),
          ciphertextB64: data.ciphertextB64,
          ivB64: data.ivB64,
          saltB64: data.saltB64,
          kdf: data.kdf && typeof data.kdf === "object" ? data.kdf : null,
        });
        return sendJson(ws, {
          type: "backup_saved",
          ok: true,
          requestId,
        });
      } catch (err) {
        console.warn("[backup_save] failed:", err);
        return sendJson(ws, {
          type: "backup_saved",
          ok: false,
          requestId,
          error: "Backup save failed",
        });
      }
    }

    // Backward compatibility
    if (data.type === "join") {
      return sendJson(ws, { type: "joined", room: data.room ?? null });
    }

    return sendJson(ws, { type: "error", error: "Unknown message type" });
  });

  ws.on("close", () => {
    const user = getSessionUser(ws);
    wsToSession.delete(ws);
    const active = user ? accountSessions.get(user) : null;
    if (user && active?.ws === ws) {
      accountSessions.delete(user);
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
