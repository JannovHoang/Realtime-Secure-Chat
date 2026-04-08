// client/chat.js (DM 1–1 hardened + persist Double Ratchet state into Vault)
// - DOES NOT modify Project 2 messenger.browser.js
// - Persists state (CryptoKeys exported) via Project 1 vault (storeRecord/loadRecord)
// - Restores state BEFORE processing buffered WS messages (preQueue)
// - FIX 1: If peer certificate pub changes -> reset conn state for that peer
// - FIX 2: If decrypt fails (OperationError) -> auto resync once by resetting conn and retrying decrypt
// - FIX 3: If "message" arrives BEFORE we have sender cert -> queue it; drain when cert arrives
// - FIX 4: Flush DR state immediately on leaving tab/logout to make offline-queue stable
// - FIX 5 (NEW): After FIRST generateCertificate/cert_submit => await saveStateNow() to prevent key rotation
// - FIX 6 (NEW): Handle server pending_flushed => kick drain again

import {
  initVault,
  storeRecord,
  loadRecord,
  addConversationPeer,
  listConversationPeers as listConversationPeersFromVault,
  hmacRecordKey,
  deriveIdentityIdFromPublicJwk,
  saveIdentityMetadata,
} from "./storage.js";
import { MessengerClient } from "../crypto/dr/messenger.browser.js";

const WS_URL = "ws://localhost:3000/ws";
const BACKUP_REQUEST_TIMEOUT_MS = 10000;

// ===== runtime state =====
let socket = null;
let pending = [];
let messenger = null;

let myUser = null;
let currentPeer = null;

let caPubKey = null;
let govPubKey = null;

const readyPeers = new Set();
let preQueue = [];

// UI hooks
const peerReadyListeners = new Set();
const backupSaveRequests = new Map();
let backupRequestSeq = 0;

// Persisted DR state key (per-username)
const drStateKey = (u) => `dr:state:${u}`;

// Debounced save state
let saveTimer = null;

// ===== inbound queue =====
const inboundQueue = new Map(); // from -> [ { header, ciphertextB64, ts } ... ]
const MAX_QUEUE_PER_PEER = 500;

// ===== flush-on-leave handlers =====
let unloadHandlersInstalled = false;

// For demo/offline stability: 0ms is OK (no security impact; only more local writes)
const SAVE_DEBOUNCE_MS = 0;

/* ===================== helpers ===================== */
function normalizeUsername(u) {
  return String(u || "").trim(); // keep case, trim only
}

function normalizeIdentityId(v) {
  return String(v || "").trim();
}

function wsSend(obj) {
  const s = JSON.stringify(obj);
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    pending.push(s);
    return;
  }
  socket.send(s);
}

function flushPending() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  for (const s of pending) socket.send(s);
  pending = [];
}

function nextBackupRequestId() {
  backupRequestSeq += 1;
  return `backup-${Date.now()}-${backupRequestSeq}`;
}

function getServerHttpBase() {
  const u = new URL(WS_URL);
  u.protocol = u.protocol === "wss:" ? "https:" : "http:";
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.origin;
}

function settleBackupSaveRequest(requestId, ok, error = "Backup save failed") {
  if (!requestId) return false;
  const pendingReq = backupSaveRequests.get(requestId);
  if (!pendingReq) return false;

  backupSaveRequests.delete(requestId);
  clearTimeout(pendingReq.timer);
  if (ok) pendingReq.resolve();
  else pendingReq.reject(new Error(error));
  return true;
}

function abToB64(ab) {
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToAb(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function threadKey(peer) {
  const label = myUser < peer ? `dm:${myUser}<->${peer}` : `dm:${peer}<->${myUser}`;
  const h = await hmacRecordKey(label);
  return `dmh:${h}`;
}

/* ===================== Persist / Restore Double Ratchet state ===================== */
async function exportHmacKeyRawB64(hmacKey) {
  const raw = await crypto.subtle.exportKey("raw", hmacKey);
  return abToB64(raw);
}

async function importHmacKeyFromRawB64(rawB64) {
  const raw = b64ToAb(rawB64);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"]
  );
}

async function importAesKeyFromRawB64(rawB64) {
  const raw = b64ToAb(rawB64);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
}

async function exportEgKeyPairJwk(egKeyPair) {
  const pubJwk = await crypto.subtle.exportKey("jwk", egKeyPair.pub);
  const secJwk = await crypto.subtle.exportKey("jwk", egKeyPair.sec);
  return { pubJwk, secJwk };
}

async function importEgKeyPairFromJwk({ pubJwk, secJwk }) {
  const pub = await importEcdhKeyFromJwk(pubJwk, [], false);
  const sec = await importEcdhKeyFromJwk(secJwk, ["deriveBits"], true);
  return { pub, sec };
}

function cleanJwk(jwk) {
  const out = { ...jwk };
  delete out.key_ops;
  return out;
}

function isValidEcJwk(jwk, requireD) {
  if (!jwk || typeof jwk !== "object") return false;
  if (jwk.kty !== "EC" || jwk.crv !== "P-384") return false;
  if (!jwk.x || !jwk.y) return false;
  if (requireD && !jwk.d) return false;
  if (!requireD && jwk.d) return false;
  return true;
}

async function importEcdhKeyFromJwk(jwk, usages, requireD) {
  if (!isValidEcJwk(jwk, requireD)) {
    throw new Error("Invalid EC JWK");
  }

  try {
    return await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDH", namedCurve: "P-384" },
      true,
      usages
    );
  } catch {
    const cleaned = cleanJwk(jwk);
    console.warn("[chat] importKey failed, retrying with sanitized JWK");
    return await crypto.subtle.importKey(
      "jwk",
      cleaned,
      { name: "ECDH", namedCurve: "P-384" },
      true,
      usages
    );
  }
}

async function exportMessengerState(m) {
  const out = {
    v: 2,
    identityId: m.identityId || null,
    certs: m.certs || {},
    EGKeyPair: null,
    conns: {},
  };

  if (m.EGKeyPair?.pub && m.EGKeyPair?.sec) {
    out.EGKeyPair = await exportEgKeyPairJwk(m.EGKeyPair);
  }

  const conns = m.conns || {};
  for (const [name, st] of Object.entries(conns)) {
    const stOut = {
      rootKeyB64: st.rootKey ? await exportHmacKeyRawB64(st.rootKey) : null,
      sendKeyB64: st.sendKey ? await exportHmacKeyRawB64(st.sendKey) : null,
      recvKeyB64: st.recvKey ? await exportHmacKeyRawB64(st.recvKey) : null,
      sendCount: st.sendCount ?? 0,
      recvCount: st.recvCount ?? 0,
      peerPubJwk: st.peerPubJwk ?? null,
      skipped: [],
      lastSeen: Array.from(st.lastSeen || []),
    };

    if (st.skipped && st.skipped instanceof Map) {
      for (const [id, entry] of st.skipped.entries()) {
        if (entry?.mkRaw) stOut.skipped.push({ id, mkRawB64: abToB64(entry.mkRaw) });
      }
    }

    out.conns[name] = stOut;
  }

  return out;
}

async function importMessengerState(m, state) {
  if (!state || typeof state !== "object") return;

  m.identityId = typeof state.identityId === "string" ? state.identityId : null;
  m.certs = state.certs && typeof state.certs === "object" ? state.certs : {};

  if (state.EGKeyPair?.pubJwk && state.EGKeyPair?.secJwk) {
    m.EGKeyPair = await importEgKeyPairFromJwk(state.EGKeyPair);
  }

  m.conns = {};
  const conns = state.conns && typeof state.conns === "object" ? state.conns : {};
  for (const [name, stIn] of Object.entries(conns)) {
    const peerPubJwk = stIn.peerPubJwk || null;

    let peerPub = null;
    if (peerPubJwk) {
      peerPub = await importEcdhKeyFromJwk(peerPubJwk, [], false);
    }

    const st = {
      rootKey: stIn.rootKeyB64 ? await importHmacKeyFromRawB64(stIn.rootKeyB64) : null,
      sendKey: stIn.sendKeyB64 ? await importHmacKeyFromRawB64(stIn.sendKeyB64) : null,
      recvKey: stIn.recvKeyB64 ? await importHmacKeyFromRawB64(stIn.recvKeyB64) : null,
      sendCount: Number(stIn.sendCount || 0),
      recvCount: Number(stIn.recvCount || 0),
      peerPub,
      peerPubJwk,
      skipped: new Map(),
      lastSeen: new Set(Array.isArray(stIn.lastSeen) ? stIn.lastSeen : []),
    };

    if (Array.isArray(stIn.skipped)) {
      for (const item of stIn.skipped) {
        if (!item?.id || !item?.mkRawB64) continue;
        const mkRaw = b64ToAb(item.mkRawB64);
        const mkCrypto = await importAesKeyFromRawB64(item.mkRawB64);
        st.skipped.set(item.id, { mkRaw, mkCrypto });
      }
    }

    m.conns[name] = st;
  }
}

async function ensureMessengerIdentityId() {
  if (!messenger?.EGKeyPair?.pub) {
    throw new Error("Missing long-term public key for identityId");
  }

  const pubJwk = await crypto.subtle.exportKey("jwk", messenger.EGKeyPair.pub);
  const identityId = await deriveIdentityIdFromPublicJwk(pubJwk);
  messenger.identityId = identityId;
  await saveIdentityMetadata({ username: myUser, identityId });
  return identityId;
}

/* ===================== Persist state via vault ===================== */
async function loadDrState() {
  if (!myUser) return null;
  const raw = await loadRecord(drStateKey(myUser));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Immediate save (used on logout/close tab + critical checkpoints)
async function saveStateNow() {
  if (!messenger || !myUser) return;
  try {
    const st = await exportMessengerState(messenger);
    await storeRecord(drStateKey(myUser), JSON.stringify(st));
  } catch (e) {
    console.warn("[chat] saveStateNow failed:", e);
  }
}

// Debounced save (normal operation)
function scheduleSaveState() {
  if (!messenger || !myUser) return;

  if (SAVE_DEBOUNCE_MS <= 0) {
    void saveStateNow();
    return;
  }

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveStateNow(), SAVE_DEBOUNCE_MS);
}

function emitPeerReady(peer) {
  for (const fn of peerReadyListeners) {
    try {
      fn(peer);
    } catch {}
  }
}

/* ===================== reset per-peer conn (cert change / resync) ===================== */
function resetPeerConn(peer) {
  try {
    if (!messenger?.conns) return;
    delete messenger.conns[peer];
  } catch {}
}

function certPubChanged(oldCert, newCert) {
  try {
    if (!oldCert?.pub || !newCert?.pub) return false;
    return JSON.stringify(oldCert.pub) !== JSON.stringify(newCert.pub);
  } catch {
    return false;
  }
}

/* ===================== inbound queue helpers ===================== */
function queueInbound(from, pkt) {
  const key = normalizeUsername(from);
  if (!key) return;
  const arr = inboundQueue.get(key) || [];
  if (arr.length >= MAX_QUEUE_PER_PEER) arr.shift();
  arr.push(pkt);
  inboundQueue.set(key, arr);
}

async function drainInbound(from) {
  const key = normalizeUsername(from);
  if (!key) return;
  const arr = inboundQueue.get(key);
  if (!arr || arr.length === 0) return;

  if (!messenger?.certs?.[key]) return;

  inboundQueue.set(key, []);
  for (const pkt of arr) {
    try {
      await processCipherPacket(key, pkt.header, pkt.ciphertextB64, pkt.ts);
    } catch {
      queueInbound(key, pkt);
      return; // preserve order
    }
  }
}

async function drainInboundAll() {
  if (!messenger) return;
  const peers = Object.keys(messenger.certs || {});
  for (const u of peers) {
    if (u && u !== myUser) await drainInbound(u);
  }
}

function drainInboundAllSoon() {
  // retry a few times to cover timing (offline msgs may arrive before cert_cache is processed)
  const delays = [0, 30, 80, 150];
  for (const d of delays) {
    setTimeout(() => void drainInboundAll(), d);
  }
}

async function handleForceLogout(payload) {
  try {
    if (window.onForcedLogout) window.onForcedLogout(payload);
  } catch {}
  await destroyChat();
}

/* ===================== decrypt/store/render one packet ===================== */
async function processCipherPacket(from, header, ciphertextB64, ts) {
  const ciphertext = b64ToAb(ciphertextB64);

  let plaintext;
  try {
    plaintext = await messenger.receiveMessage(from, [header, ciphertext]);
  } catch (err) {
    resetPeerConn(from);
    plaintext = await messenger.receiveMessage(from, [header, ciphertext]);
  }

  const key = await threadKey(from);
  const history = (await loadRecord(key)) || "[]";

  let arr;
  try {
    arr = JSON.parse(history);
    if (!Array.isArray(arr)) arr = [];
  } catch {
    arr = [];
  }

  arr.push({ from, text: plaintext, ts: ts ?? Date.now() });
  await storeRecord(key, JSON.stringify(arr));
  await addConversationPeer(from);

  scheduleSaveState();

  if (window.onChatMessage && from === currentPeer) {
    window.onChatMessage({ from, text: plaintext, ts });
  }
}

/* ===================== incoming handler ===================== */
async function handleIncoming(data) {
  if (!messenger) return;

  // NEW: server says it flushed offline queue to us
  if (data.type === "pending_flushed") {
    // kick drain again (messages may have been queued earlier)
    drainInboundAllSoon();
    return;
  }

  // cached certs
  if (data.type === "cert_cache" && Array.isArray(data.items)) {
    for (const it of data.items) {
      if (!it?.certificate || !it?.signatureB64) continue;
      const cert = it.certificate;
      if (!cert?.username || cert.username === myUser) continue;

      const old = messenger.certs?.[cert.username];
      if (old && certPubChanged(old, cert)) resetPeerConn(cert.username);

      try {
        await messenger.receiveCertificate(cert, b64ToAb(it.signatureB64));
        if (!readyPeers.has(cert.username)) {
          readyPeers.add(cert.username);
          emitPeerReady(cert.username);
        }
        scheduleSaveState();
        await drainInbound(cert.username);
      } catch {}
    }

    // after importing cached certs, try drain all (timing safe)
    drainInboundAllSoon();
    return;
  }

  // new cert
  if (data.type === "cert_signed" && data.certificate?.username) {
    const u = data.certificate.username;
    if (u !== myUser) {
      const old = messenger.certs?.[u];
      if (old && certPubChanged(old, data.certificate)) resetPeerConn(u);

      try {
        await messenger.receiveCertificate(data.certificate, b64ToAb(data.signatureB64));
        if (!readyPeers.has(u)) {
          readyPeers.add(u);
          emitPeerReady(u);
        }
        scheduleSaveState();
        await drainInbound(u);
        drainInboundAllSoon();
      } catch (err) {
        console.warn("[chat] cert verify failed:", err);
      }
    }
    return;
  }

  // dm message
  if (data.type === "message") {
    const from = normalizeUsername(data.from);
    if (!from) return;

    if (!data.header || !data.ciphertextB64) {
      console.warn("[chat] malformed message packet:", data);
      return;
    }

    if (!messenger.certs?.[from]) {
      queueInbound(from, {
        header: data.header,
        ciphertextB64: data.ciphertextB64,
        ts: data.ts ?? Date.now(),
      });
      return;
    }

    try {
      await processCipherPacket(from, data.header, data.ciphertextB64, data.ts);
    } catch (err) {
      console.warn("[chat] decrypt failed (kept queued):", err);
      queueInbound(from, {
        header: data.header,
        ciphertextB64: data.ciphertextB64,
        ts: data.ts ?? Date.now(),
      });
      // retry later
      setTimeout(() => void drainInbound(from), 50);
    }
    return;
  }

  if (data.type === "delivery" && data.ok === false) {
    console.warn("[chat] delivery failed:", data.to, data.reason);
  }
}

/* ===================== unload flush helpers ===================== */
function installUnloadHandlers() {
  if (unloadHandlersInstalled) return;
  unloadHandlersInstalled = true;

  window.addEventListener("pagehide", onPageHide, { capture: true });
  window.addEventListener("beforeunload", onBeforeUnload, { capture: true });
  document.addEventListener("visibilitychange", onVisibilityChange, { capture: true });
}

function removeUnloadHandlers() {
  if (!unloadHandlersInstalled) return;
  unloadHandlersInstalled = false;

  window.removeEventListener("pagehide", onPageHide, { capture: true });
  window.removeEventListener("beforeunload", onBeforeUnload, { capture: true });
  document.removeEventListener("visibilitychange", onVisibilityChange, { capture: true });
}

function onVisibilityChange() {
  try {
    if (document.visibilityState === "hidden") void saveStateNow();
  } catch {}
}
function onPageHide() {
  try {
    void saveStateNow();
  } catch {}
}
function onBeforeUnload() {
  try {
    void saveStateNow();
  } catch {}
}

function notifyDisconnected() {
  try {
    if (window.onChatDisconnected) window.onChatDisconnected();
  } catch {}
}

/* ===================== init ===================== */
export async function initChat(username, password) {
  await destroyChat();

  myUser = normalizeUsername(username);
  if (!myUser) throw new Error("Username is required");

  readyPeers.clear();
  messenger = null;
  currentPeer = null;
  preQueue = [];
  pending = [];
  caPubKey = null;
  govPubKey = null;
  inboundQueue.clear();

  await initVault(password, myUser);

  socket = new WebSocket(WS_URL);

  let resolveConfig;
  const configPromise = new Promise((resolve, reject) => {
    resolveConfig = resolve;
    setTimeout(() => reject(new Error("No server config")), 5000);
  });

  socket.onopen = () => {
    wsSend({ type: "register", user: myUser });
    flushPending();
  };

  socket.onerror = (e) => console.warn("[chat] ws error", e);
  socket.onclose = () => {
    console.warn("[chat] disconnected");
    notifyDisconnected();
  };

  socket.onmessage = async (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }

    if (data.type === "force_logout") {
      await handleForceLogout({
        reason: data.reason || "logged_in_elsewhere",
        previousIdentityId: data.previousIdentityId || null,
        replacedByIdentityId: data.replacedByIdentityId || null,
      });
      return;
    }

    if (data.type === "config") {
      resolveConfig(data);
      return;
    }

    if (data.type === "backup_saved") {
      settleBackupSaveRequest(data.requestId, data.ok === true, data.error);
      return;
    }

    if (!messenger) {
      preQueue.push(data);
      return;
    }

    try {
      await handleIncoming(data);
    } catch (err) {
      console.warn("[chat] incoming handler error:", err);
    }
  };

  const cfg = await configPromise;

  caPubKey = await crypto.subtle.importKey(
    "jwk",
    cfg.caPubJwk,
    { name: "ECDSA", namedCurve: "P-384" },
    true,
    ["verify"]
  );

  govPubKey = await crypto.subtle.importKey(
    "jwk",
    cfg.govPubJwk,
    { name: "ECDH", namedCurve: "P-384" },
    true,
    []
  );

  messenger = new MessengerClient(caPubKey, govPubKey);

  // Restore DR state BEFORE any queued messages are processed
  const saved = await loadDrState();
  if (saved) {
    try {
      await importMessengerState(messenger, saved);
      console.log("[chat] restored DR state from vault");
    } catch (e) {
      console.warn("[chat] failed to restore state (starting fresh):", e);
    }
  }

  // rebuild readyPeers
  try {
    const certNames = Object.keys(messenger.certs || {});
    for (const u of certNames) if (u && u !== myUser) readyPeers.add(u);
  } catch {}

  // Ensure EGKeyPair + cert_submit
  // IMPORTANT FIX: If we generate a new keypair, we MUST save immediately to avoid rotation.
  if (!messenger.EGKeyPair?.pub || !messenger.EGKeyPair?.sec) {
    const cert = await messenger.generateCertificate(myUser);
    const identityId = await ensureMessengerIdentityId();
    wsSend({ type: "identity_bind", identityId });
    cert.identityId = identityId;
    wsSend({ type: "cert_submit", certificate: cert });

    // CRITICAL: hard flush state NOW (prevents losing EGKeyPair if tab closes)
    await saveStateNow();
  } else {
    const identityId = await ensureMessengerIdentityId();
    wsSend({ type: "identity_bind", identityId });
    const cert = {
      username: myUser,
      identityId,
      pub: await crypto.subtle.exportKey("jwk", messenger.EGKeyPair.pub),
    };
    wsSend({ type: "cert_submit", certificate: cert });

    // still save (cheap)
    await saveStateNow();
  }

  installUnloadHandlers();

  // Process buffered messages that arrived early (offline queue + cert_cache, etc.)
  const queued = preQueue;
  preQueue = [];
  for (const msg of queued) {
    try {
      await handleIncoming(msg);
    } catch (err) {
      console.warn("[chat] failed to process queued msg:", err);
    }
  }

  // Try draining a few times (timing safe)
  drainInboundAllSoon();

  console.log("[chat] ready:", myUser);
}

/* ===================== status API for UI ===================== */
export function getUsername() {
  return myUser;
}

export function getCurrentIdentityId() {
  return messenger?.identityId || null;
}

export async function listConversationPeers() {
  if (!myUser) return [];
  return await listConversationPeersFromVault();
}

export function isPeerReady(peer) {
  const p = normalizeUsername(peer);
  return !!p && readyPeers.has(p);
}

export function onPeerReady(fn) {
  if (typeof fn !== "function") return () => {};
  peerReadyListeners.add(fn);
  return () => peerReadyListeners.delete(fn);
}

/* ===================== DM API ===================== */
export async function openConversation(peer) {
  const p = normalizeUsername(peer);
  if (!p) return [];
  currentPeer = p;

  try {
    await drainInbound(p);
  } catch {}

  const key = await threadKey(p);
  const history = (await loadRecord(key)) || "[]";
  try {
    const arr = JSON.parse(history);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function sendMessage(peer, text) {
  if (!messenger) throw new Error("Call initChat() first");

  const p = normalizeUsername(peer);
  const msg = String(text || "").trim();
  if (!p || !msg) return;

  if (!readyPeers.has(p)) {
    throw new Error(`Chưa có certificate của ${p} (mở tab người kia và Start trước)`);
  }

  const [header, ciphertext] = await messenger.sendMessage(p, msg);

  const key = await threadKey(p);
  const history = (await loadRecord(key)) || "[]";
  let arr;
  try {
    arr = JSON.parse(history);
    if (!Array.isArray(arr)) arr = [];
  } catch {
    arr = [];
  }
  arr.push({ from: myUser, text: msg, ts: Date.now() });
  await storeRecord(key, JSON.stringify(arr));
  await addConversationPeer(p);

  wsSend({
    type: "send",
    to: p,
    header,
    ciphertextB64: abToB64(ciphertext),
  });

  scheduleSaveState();
}

export async function saveCloudBackup(blobDoc) {
  if (!myUser || !socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Cloud backup requires an active session");
  }

  const requestId = nextBackupRequestId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      backupSaveRequests.delete(requestId);
      reject(new Error("Backup save timed out"));
    }, BACKUP_REQUEST_TIMEOUT_MS);

    backupSaveRequests.set(requestId, { resolve, reject, timer });
    wsSend({
      type: "backup_save",
      requestId,
      username: myUser,
      ...blobDoc,
    });
  });
}

export async function fetchCloudBackup(username, identityId = null) {
  const user = normalizeUsername(username);
  if (!user) {
    throw new Error("Username is required");
  }

  const url = new URL(
    `${getServerHttpBase()}/api/backup/${encodeURIComponent(user)}`
  );
  const normalizedIdentityId = normalizeIdentityId(identityId || "");
  if (normalizedIdentityId) {
    url.searchParams.set("identityId", normalizedIdentityId);
  }

  const res = await fetch(url.toString());

  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error("Restore failed");
  }

  if (!res.ok || !data?.ok) {
    throw new Error("Restore failed");
  }

  return data;
}

export async function fetchCloudBackupIdentities(username) {
  const user = normalizeUsername(username);
  if (!user) {
    throw new Error("Username is required");
  }

  const url = `${getServerHttpBase()}/api/backups/${encodeURIComponent(user)}`;
  const res = await fetch(url);

  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error("Restore failed");
  }

  if (!res.ok || !data?.ok || !Array.isArray(data.items)) {
    throw new Error("Restore failed");
  }

  return data.items;
}

/* ===================== logout / cleanup ===================== */
export async function destroyChat() {
  try {
    await saveStateNow();
  } catch {}

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  removeUnloadHandlers();

  try {
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "logout");
    }
  } catch {}

  socket = null;
  pending = [];
  preQueue = [];

  messenger = null;
  currentPeer = null;

  caPubKey = null;
  govPubKey = null;

  readyPeers.clear();
  inboundQueue.clear();

  for (const req of backupSaveRequests.values()) {
    clearTimeout(req.timer);
    req.reject(new Error("Backup save interrupted"));
  }
  backupSaveRequests.clear();

  myUser = null;
}
