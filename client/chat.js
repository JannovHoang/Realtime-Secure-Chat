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
  listRecordNames,
  upsertConversationMetadata,
  getConversationMetadata,
  hmacRecordKey,
  deriveIdentityIdFromPublicJwk,
  saveIdentityMetadata,
  changeVaultPassword as changeStoredVaultPassword,
  setupRecoveryKey as setupStoredRecoveryKey,
} from "./storage.js";
import {
  buildLocalAccountProfile,
  normalizeAccountId,
  normalizeDisplayName,
} from "./account.js";
import {
  getCurrentUser as getCurrentFirebaseUser,
  getIdToken as getFirebaseIdToken,
} from "./auth/firebaseClient.js";
import { MessengerClient } from "../crypto/dr/messenger.browser.js";

const LOCAL_DEV_UI_PORT = "5173";
const LOCAL_DEV_SERVER_PORT = "3000";
const DEFAULT_WS_PATH = "/ws";
const BACKUP_REQUEST_TIMEOUT_MS = 10000;
const HISTORY_REQUEST_TIMEOUT_MS = 10000;
const SEND_REQUEST_TIMEOUT_MS = 10000;
const IDENTITY_BIND_TIMEOUT_MS = 10000;
const HISTORY_RECENT_DEFAULT_LIMIT = 50;
const HISTORY_RECENT_MAX_LIMIT = 100;
const HISTORY_KEY_SEED_RECORD = "__securechat_history_key_seed_v1__";

// ===== runtime state =====
let socket = null;
let pending = [];
let messenger = null;

let myUser = null;
let myAccountId = null;
let myDisplayName = null;
let currentPeer = null;

let caPubKey = null;
let govPubKey = null;

const readyPeers = new Set();
let preQueue = [];

// UI hooks
const peerReadyListeners = new Set();
const backupSaveRequests = new Map();
let backupRequestSeq = 0;
const historyFetchRequests = new Map();
let historyRequestSeq = 0;
const sendRequests = new Map();
let sendRequestSeq = 0;

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

async function normalizeAccountProfile(username, accountProfile = null) {
  const displayName = normalizeDisplayName(
    accountProfile?.displayName || username
  );
  const accountId = normalizeAccountId(accountProfile?.accountId);

  if (accountId && displayName) {
    return {
      accountId,
      displayName,
      accountIdScheme:
        String(accountProfile?.accountIdScheme || "").trim() || "provided",
    };
  }

  return await buildLocalAccountProfile(displayName || username);
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

function nextHistoryRequestId() {
  historyRequestSeq += 1;
  return `history-${Date.now()}-${historyRequestSeq}`;
}

function nextSendRequestId() {
  sendRequestSeq += 1;
  return `send-${Date.now()}-${sendRequestSeq}`;
}

function getRuntimeConfigValue(key) {
  const globalConfig =
    typeof globalThis !== "undefined" && globalThis.__CHAT_CONFIG__
      ? globalThis.__CHAT_CONFIG__
      : null;
  if (globalConfig && typeof globalConfig[key] === "string") {
    return globalConfig[key];
  }

  const globalKey = `__CHAT_${key}__`;
  if (
    typeof globalThis !== "undefined" &&
    typeof globalThis[globalKey] === "string"
  ) {
    return globalThis[globalKey];
  }

  const viteKey = `VITE_CHAT_${key}`;
  const viteLegacyKey = `VITE_${key}`;
  const viteEnv = import.meta?.env || {};
  return viteEnv[viteKey] || viteEnv[viteLegacyKey] || "";
}

function normalizeWsUrl(rawUrl, baseHref) {
  const url = new URL(rawUrl, baseHref);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Unsupported WebSocket protocol: ${url.protocol}`);
  }
  return url.toString();
}

function normalizeHttpBaseUrl(rawUrl, baseHref) {
  const url = new URL(rawUrl, baseHref);
  if (url.protocol === "ws:") url.protocol = "http:";
  else if (url.protocol === "wss:") url.protocol = "https:";
  else if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported HTTP protocol: ${url.protocol}`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.origin + url.pathname;
}

function getDefaultWsUrl() {
  const loc =
    typeof window !== "undefined" && window.location
      ? window.location
      : new URL(`http://localhost:${LOCAL_DEV_UI_PORT}/`);

  const isLocalHost =
    loc.hostname === "localhost" ||
    loc.hostname === "127.0.0.1" ||
    loc.hostname === "::1";

  // Vite dev serves the UI on 5173 while the Node/WebSocket server runs on 3000.
  if (isLocalHost && loc.port === LOCAL_DEV_UI_PORT) {
    return `ws://${loc.hostname}:${LOCAL_DEV_SERVER_PORT}${DEFAULT_WS_PATH}`;
  }

  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}${DEFAULT_WS_PATH}`;
}

function getServerWsUrl() {
  const configured = getRuntimeConfigValue("WS_URL").trim();
  const baseHref =
    typeof window !== "undefined" && window.location
      ? window.location.href
      : `http://localhost:${LOCAL_DEV_UI_PORT}/`;
  return configured ? normalizeWsUrl(configured, baseHref) : getDefaultWsUrl();
}

function getDefaultHttpBase() {
  const u = new URL(getServerWsUrl());
  u.protocol = u.protocol === "wss:" ? "https:" : "http:";
  u.pathname = "";
  u.search = "";
  u.hash = "";
  return u.origin;
}

function getServerHttpBase() {
  const configured = (
    getRuntimeConfigValue("API_BASE_URL") ||
    getRuntimeConfigValue("HTTP_BASE_URL")
  ).trim();
  const baseHref =
    typeof window !== "undefined" && window.location
      ? window.location.href
      : `http://localhost:${LOCAL_DEV_UI_PORT}/`;
  return configured
    ? normalizeHttpBaseUrl(configured, baseHref)
    : getDefaultHttpBase();
}

function buildApiUrl(pathname) {
  return new URL(pathname, `${getServerHttpBase()}/`);
}

async function getFirebaseRegisterToken() {
  const currentUser = getCurrentFirebaseUser();
  if (!currentUser) return null;

  try {
    const token = await getFirebaseIdToken(true);
    if (!token) {
      throw new Error("Firebase user is signed in but no ID token was returned");
    }
    return token;
  } catch (err) {
    throw new Error(
      `Firebase auth token unavailable. Sign out and sign in again. ${String(
        err?.message || err || ""
      ).trim()}`
    );
  }
}

function getClientDeviceLabel() {
  const nav =
    typeof navigator !== "undefined"
      ? navigator
      : null;
  if (!nav) return "Unknown browser";

  const ua = String(nav.userAgent || "");
  const uaData = nav.userAgentData || null;
  const platform = String(uaData?.platform || nav.platform || "").trim();

  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = platform || "unknown device";
  if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Win/i.test(platform)) os = "Windows";
  else if (/Mac/i.test(platform)) os = "macOS";
  else if (/Linux/i.test(platform)) os = "Linux";

  return `${browser} on ${os}`.slice(0, 80);
}

async function buildOptionalFirebaseAuthHeaders() {
  const currentUser = getCurrentFirebaseUser();
  if (!currentUser) return {};

  const token = await getFirebaseIdToken(true).catch((err) => {
    console.warn("[chat] Firebase ID token unavailable for API request:", err);
    throw new Error("Firebase auth token unavailable. Sign out and sign in again.");
  });
  if (!token) {
    throw new Error("Firebase auth token unavailable. Sign out and sign in again.");
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function settleBackupSaveRequest(
  requestId,
  ok,
  error = "Backup save failed",
  payload = null
) {
  if (!requestId) return false;
  const pendingReq = backupSaveRequests.get(requestId);
  if (!pendingReq) return false;

  backupSaveRequests.delete(requestId);
  clearTimeout(pendingReq.timer);
  if (ok) pendingReq.resolve(payload);
  else pendingReq.reject(new Error(error));
  return true;
}

function settleHistoryFetchRequest(requestId, ok, messages = [], error = "History fetch failed") {
  if (!requestId) return false;
  const pendingReq = historyFetchRequests.get(requestId);
  if (!pendingReq) return false;

  historyFetchRequests.delete(requestId);
  clearTimeout(pendingReq.timer);
  if (ok) pendingReq.resolve(messages);
  else pendingReq.reject(new Error(error));
  return true;
}

function settleSendRequest(requestId, ok, payload = null, error = "Send failed") {
  if (!requestId) return false;
  const pendingReq = sendRequests.get(requestId);
  if (!pendingReq) return false;

  sendRequests.delete(requestId);
  clearTimeout(pendingReq.timer);
  if (ok) pendingReq.resolve(payload);
  else pendingReq.reject(new Error(error));
  return true;
}

function rejectAllSendRequests(error = "Chat connection closed") {
  for (const [requestId, pendingReq] of sendRequests) {
    sendRequests.delete(requestId);
    clearTimeout(pendingReq.timer);
    pendingReq.reject(new Error(error));
  }
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

function randomB64(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return abToB64(bytes.buffer);
}

function threadLabel(peer) {
  const label = myUser < peer ? `dm:${myUser}<->${peer}` : `dm:${peer}<->${myUser}`;
  return label;
}

async function getOrCreateHistoryKeySeed() {
  const existing = await loadRecord(HISTORY_KEY_SEED_RECORD);
  if (typeof existing === "string" && existing.trim()) return existing.trim();

  const seed = randomB64(32);
  await storeRecord(HISTORY_KEY_SEED_RECORD, seed);
  return seed;
}

async function hmacSha256B64(rawKeyB64, label) {
  const key = await crypto.subtle.importKey(
    "raw",
    b64ToAb(rawKeyB64),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(label)
  );
  return abToB64(sig);
}

async function threadKey(peer) {
  const seed = await getOrCreateHistoryKeySeed();
  const h = await hmacSha256B64(seed, threadLabel(peer));
  return `dmh:${h}`;
}

async function legacyThreadKey(peer) {
  const h = await hmacRecordKey(threadLabel(peer));
  return `dmh:${h}`;
}

async function threadKeysForRead(peer) {
  const keys = [];
  const primary = await threadKey(peer);
  keys.push(primary);

  try {
    const legacy = await legacyThreadKey(peer);
    if (legacy && !keys.includes(legacy)) keys.push(legacy);
  } catch {}

  return keys;
}

function normalizeRecentLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return HISTORY_RECENT_DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.floor(n), HISTORY_RECENT_MAX_LIMIT));
}

function historyDedupeFallbackKey(item) {
  const cipher = item?.envelope?.ciphertextB64 || "";
  return `${item?.from || ""}|${item?.to || ""}|${item?.ts || ""}|${cipher}`;
}

function validateHistoryRecentItem(item) {
  if (!item || typeof item !== "object") return null;
  const id = typeof item._id === "string" ? item._id.trim() : "";
  const from = normalizeUsername(item.from);
  const to = normalizeUsername(item.to);
  const ts = Number(item.ts);
  const envelope = item.envelope && typeof item.envelope === "object" ? item.envelope : null;
  const header = envelope?.header;
  const ciphertextB64 = envelope?.ciphertextB64;

  if (!id || !from || !to || !Number.isFinite(ts)) return null;
  if (!header || typeof header !== "object") return null;
  if (typeof ciphertextB64 !== "string" || !ciphertextB64) return null;

  return {
    _id: id,
    from,
    to,
    senderIdentityId: normalizeIdentityId(item.senderIdentityId) || null,
    recipientIdentityId: normalizeIdentityId(item.recipientIdentityId) || null,
    envelope: {
      header,
      ciphertextB64,
    },
    ts,
  };
}

function normalizeHistoryRecentItems(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const normalized = [];

  for (const raw of items) {
    const item = validateHistoryRecentItem(raw);
    if (!item) continue;
    const dedupeKey = item._id || historyDedupeFallbackKey(item);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(item);
  }

  normalized.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return String(a._id).localeCompare(String(b._id));
  });
  return normalized;
}

function localHistoryDedupeKey(item) {
  if (item?.serverId) return `server:${item.serverId}`;
  return `local:${item?.from || ""}|${item?.ts || ""}|${item?.text || ""}`;
}

function localHistoryFallbackDedupeKey(item) {
  return `local:${item?.from || ""}|${item?.ts || ""}|${item?.text || ""}`;
}

function localHistoryDedupeKeys(item) {
  const keys = new Set();
  const primary = localHistoryDedupeKey(item);
  if (primary) keys.add(primary);
  const fallback = localHistoryFallbackDedupeKey(item);
  if (fallback) keys.add(fallback);
  return Array.from(keys);
}

function hasLocalHistoryDuplicate(items, nextItem) {
  const nextKeys = new Set(localHistoryDedupeKeys(nextItem));
  return items.some((existing) =>
    localHistoryDedupeKeys(existing).some((key) => nextKeys.has(key))
  );
}

function parseLocalHistory(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function sortLocalHistory(items) {
  items.sort((a, b) => {
    const at = Number(a?.ts) || 0;
    const bt = Number(b?.ts) || 0;
    return at - bt;
  });
  return items;
}

function mergeLocalHistoryArrays(arrays) {
  const merged = [];
  for (const arr of arrays) {
    for (const item of arr) {
      if (!item || typeof item.text !== "string" || !item.from) continue;
      if (hasLocalHistoryDuplicate(merged, item)) continue;
      merged.push(item);
    }
  }
  return sortLocalHistory(merged);
}

async function loadLocalHistoryFromAllThreadKeys(peer) {
  const p = normalizeUsername(peer);
  const keys = await threadKeysForRead(p);
  const histories = [];

  for (const key of keys) {
    const raw = await loadRecord(key);
    histories.push(parseLocalHistory(raw));
  }

  try {
    const indexedHistoryKeys = await listRecordNames("dmh:");
    for (const key of indexedHistoryKeys) {
      if (keys.includes(key)) continue;
      const arr = parseLocalHistory(await loadRecord(key));
      const belongsToPeer = arr.some(
        (item) => item?.from === p || item?.to === p
      );
      if (!belongsToPeer) continue;
      keys.push(key);
      histories.push(arr);
    }
  } catch {}

  return {
    primaryKey: keys[0],
    keys,
    messages: mergeLocalHistoryArrays(histories),
  };
}

async function cloneMessengerForCatchUp() {
  if (!messenger || !caPubKey || !govPubKey) {
    throw new Error("Call initChat() first");
  }

  const state = await exportMessengerState(messenger);
  const clone = new MessengerClient(caPubKey, govPubKey);
  await importMessengerState(clone, state);
  return clone;
}

async function decryptRecentMessagesForDisplay(peer, recentItems) {
  const p = normalizeUsername(peer);
  if (!p || !myUser) return [];

  const items = normalizeHistoryRecentItems(recentItems);
  if (items.length === 0) return [];

  const temp = await cloneMessengerForCatchUp();
  const display = [];

  for (const item of items) {
    // Phase 1 catch-up only attempts inbound peer -> me. Outgoing messages
    // should come from existing local plaintext history.
    if (item.from !== p || item.to !== myUser) continue;

    try {
      const ciphertext = b64ToAb(item.envelope.ciphertextB64);
      const plaintext = await temp.receiveMessage(p, [
        item.envelope.header,
        ciphertext,
      ]);
      display.push({
        from: p,
        text: plaintext,
        ts: item.ts,
        serverId: item._id,
        source: "recent_catchup",
      });
    } catch {
      // Best-effort only. Never reset or mutate the live ratchet state here.
    }
  }

  return display;
}

async function loadLocalConversationHistory(peer) {
  const p = normalizeUsername(peer);
  if (!p) return [];

  const { messages } = await loadLocalHistoryFromAllThreadKeys(p);
  return messages;
}

async function mergeDisplayMessagesIntoLocalHistory(peer, displayMessages) {
  const p = normalizeUsername(peer);
  if (!p) return [];
  if (!Array.isArray(displayMessages) || displayMessages.length === 0) {
    return loadLocalConversationHistory(p);
  }

  const { primaryKey, messages } = await loadLocalHistoryFromAllThreadKeys(p);
  let arr = messages;

  const seen = new Set();
  for (const existing of arr) {
    for (const key of localHistoryDedupeKeys(existing)) seen.add(key);
  }
  for (const msg of displayMessages) {
    if (!msg || typeof msg.text !== "string" || !msg.from) continue;
    const next = {
      from: msg.from,
      text: msg.text,
      ts: Number.isFinite(Number(msg.ts)) ? Number(msg.ts) : Date.now(),
    };
    if (msg.serverId) next.serverId = msg.serverId;
    if (msg.source) next.source = msg.source;

    const dedupeKeys = localHistoryDedupeKeys(next);
    if (dedupeKeys.some((key) => seen.has(key))) continue;
    for (const key of dedupeKeys) seen.add(key);
    arr.push(next);
  }

  sortLocalHistory(arr);

  await storeRecord(primaryKey, JSON.stringify(arr));
  await rememberConversationPeer(p);
  const latest = latestDisplayMessageForPeer(p, arr);
  if (latest) {
    await updateConversationMetadataIfNewer(p, latest.text, latest.ts);
  }
  return arr;
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
  await saveIdentityMetadata({
    username: myUser,
    accountId: myAccountId,
    displayName: myDisplayName || myUser,
    identityId,
  });
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

export async function flushChatState() {
  await saveStateNow();
}

async function ensureConversationHistoryRecordsIndexed() {
  if (!myUser) return;

  const peers = new Set();
  try {
    for (const peer of await listConversationPeersFromVault()) {
      const p = normalizeUsername(peer);
      if (p && p !== myUser) peers.add(p);
    }
  } catch {}

  const pCurrent = normalizeUsername(currentPeer);
  if (pCurrent && pCurrent !== myUser) peers.add(pCurrent);

  for (const peer of readyPeers) {
    const p = normalizeUsername(peer);
    if (p && p !== myUser) peers.add(p);
  }

  for (const peer of Object.keys(messenger?.conns || {})) {
    const p = normalizeUsername(peer);
    if (p && p !== myUser) peers.add(p);
  }

  for (const peer of peers) {
    const { primaryKey, keys, messages } =
      await loadLocalHistoryFromAllThreadKeys(peer);

    if (messages.length > 0) {
      await storeRecord(primaryKey, JSON.stringify(messages));
    }

    for (const key of keys) {
      const history = await loadRecord(key);
      if (history != null) {
        // Older vaults may contain history records that predate the explicit
        // vault index. Re-storing the same plaintext indexes the record before
        // password rotation, so changeVaultPassword can migrate it.
        await storeRecord(key, history);
      }
    }
  }
}

export async function changeLocalVaultPassword(currentPassword, newPassword) {
  if (!myUser || !messenger) throw new Error("Call initChat() first");
  await saveStateNow();
  await ensureConversationHistoryRecordsIndexed();
  return await changeStoredVaultPassword(myUser, currentPassword, newPassword);
}

export async function setupLocalRecoveryKey() {
  if (!myUser || !messenger) throw new Error("Call initChat() first");
  await saveStateNow();
  await ensureConversationHistoryRecordsIndexed();
  return await setupStoredRecoveryKey(myUser);
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

function certMatchesActiveIdentity(item, cert) {
  const activeIdentityId = normalizeIdentityId(item?.activeIdentityId);
  if (!activeIdentityId) return true;
  return normalizeIdentityId(cert?.identityId) === activeIdentityId;
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

async function rememberConversationPeer(peer) {
  const p = normalizeUsername(peer);
  if (!p || p === myUser) return null;
  await addConversationPeer(p);
  return p;
}

function messageTimestamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : Date.now();
}

async function updateConversationMetadataFromMessage(peer, text, ts) {
  const p = normalizeUsername(peer);
  const preview = String(text || "").trim();
  if (!p || p === myUser || !preview) return null;
  return upsertConversationMetadata(p, {
    lastMessageAt: messageTimestamp(ts),
    lastMessagePreview: preview,
  });
}

function latestDisplayMessageForPeer(peer, messages) {
  const p = normalizeUsername(peer);
  if (!p || !Array.isArray(messages)) return null;

  let latest = null;
  for (const msg of messages) {
    if (!msg || msg.from !== p || typeof msg.text !== "string") continue;
    const ts = messageTimestamp(msg.ts);
    if (!latest || ts > latest.ts) {
      latest = { text: msg.text, ts };
    }
  }
  return latest;
}

function latestDisplayMessageForConversation(peer, messages) {
  const p = normalizeUsername(peer);
  if (!p || !Array.isArray(messages)) return null;

  let latest = null;
  for (const msg of messages) {
    if (!msg || typeof msg.text !== "string") continue;
    if (msg.from !== p && msg.from !== myUser) continue;

    const ts = messageTimestamp(msg.ts);
    if (!latest || ts > latest.ts) {
      latest = { text: msg.text, ts };
    }
  }
  return latest;
}

async function updateConversationMetadataIfNewer(peer, text, ts) {
  const p = normalizeUsername(peer);
  const nextTs = messageTimestamp(ts);
  const current = await getConversationMetadata(p);
  const currentTs = Number(current?.lastMessageAt) || 0;
  if (currentTs && nextTs < currentTs) return current;
  return updateConversationMetadataFromMessage(p, text, nextTs);
}

async function backfillConversationMetadataFromHistory(peer, messages) {
  const p = normalizeUsername(peer);
  if (!p || p === myUser) return null;
  const latest = latestDisplayMessageForConversation(p, messages);
  if (!latest) return null;
  await rememberConversationPeer(p);
  return updateConversationMetadataIfNewer(p, latest.text, latest.ts);
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
    // A decrypt failure is not proof that the peer certificate changed. Resetting
    // the live ratchet here can destroy the last good state and make a stale
    // restore/device-switch issue permanent. Keep the packet queued instead.
    throw err;
  }

  const { primaryKey, messages } = await loadLocalHistoryFromAllThreadKeys(from);
  let arr = messages;

  const messageTs = messageTimestamp(ts);
  const nextItem = { from, text: plaintext, ts: messageTs };
  if (!hasLocalHistoryDuplicate(arr, nextItem)) {
    arr.push(nextItem);
  }
  sortLocalHistory(arr);
  await storeRecord(primaryKey, JSON.stringify(arr));
  const discoveredPeer = await rememberConversationPeer(from);
  if (discoveredPeer) {
    await updateConversationMetadataFromMessage(discoveredPeer, plaintext, messageTs);
  }

  scheduleSaveState();

  if (discoveredPeer && window.onChatMessage) {
    window.onChatMessage({
      from: discoveredPeer,
      text: plaintext,
      ts: messageTs,
      isCurrentPeer: discoveredPeer === currentPeer,
    });
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
      if (!certMatchesActiveIdentity(it, cert)) continue;

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
      if (!certMatchesActiveIdentity(data, data.certificate)) return;
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
export async function initChat(username, password, accountProfile = null, options = {}) {
  await destroyChat();

  myUser = normalizeUsername(username);
  if (!myUser) throw new Error("Username is required");
  const normalizedAccount = await normalizeAccountProfile(myUser, accountProfile);
  myAccountId = normalizedAccount.accountId;
  myDisplayName = normalizedAccount.displayName;

  readyPeers.clear();
  messenger = null;
  currentPeer = null;
  preQueue = [];
  pending = [];
  caPubKey = null;
  govPubKey = null;
  inboundQueue.clear();

  await initVault(password, myUser);

  const firebaseIdToken = await getFirebaseRegisterToken();
  const deviceLabel = getClientDeviceLabel();
  const beforeIdentityBind =
    typeof options.beforeIdentityBind === "function"
      ? options.beforeIdentityBind
      : null;
  let beforeIdentityBindDoneFor = "";

  socket = new WebSocket(getServerWsUrl());

  let resolveConfig;
  let rejectConfig;
  const configPromise = new Promise((resolve, reject) => {
    resolveConfig = resolve;
    rejectConfig = reject;
    setTimeout(() => reject(new Error("No server config")), 5000);
  });
  let resolveRegistered;
  let rejectRegistered;
  const registeredPromise = new Promise((resolve, reject) => {
    resolveRegistered = resolve;
    rejectRegistered = reject;
    setTimeout(() => reject(new Error("Server registration timed out")), 5000);
  });
  let identityBindWaiter = null;

  function settleIdentityBind(ok, payload) {
    if (!identityBindWaiter) return false;
    const waiter = identityBindWaiter;
    identityBindWaiter = null;
    clearTimeout(waiter.timer);
    if (ok) waiter.resolve(payload);
    else waiter.reject(payload instanceof Error ? payload : new Error(String(payload || "Identity binding failed")));
    return true;
  }

  function waitForIdentityBound() {
    if (identityBindWaiter) {
      identityBindWaiter.reject(new Error("Identity binding already pending"));
      clearTimeout(identityBindWaiter.timer);
      identityBindWaiter = null;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        settleIdentityBind(false, new Error("Server identity binding timed out"));
      }, IDENTITY_BIND_TIMEOUT_MS);
      identityBindWaiter = { resolve, reject, timer };
    });
  }

  async function bindIdentity(identityId) {
    const normalizedIdentityId = normalizeIdentityId(identityId);
    if (beforeIdentityBind && beforeIdentityBindDoneFor !== normalizedIdentityId) {
      await beforeIdentityBind({
        identityId: normalizedIdentityId,
        username: myUser,
        accountId: myAccountId,
        displayName: myDisplayName,
        deviceLabel,
      });
      beforeIdentityBindDoneFor = normalizedIdentityId;
    }
    const boundPromise = waitForIdentityBound();
    wsSend({
      type: "identity_bind",
      identityId: normalizedIdentityId,
      accountId: myAccountId,
      displayName: myDisplayName,
      deviceLabel,
    });
    const bound = await boundPromise;
    if (bound?.accountId) {
      myAccountId = normalizeAccountId(bound.accountId);
    }
    if (bound?.displayName) {
      myDisplayName = normalizeDisplayName(bound.displayName) || myDisplayName;
    }
    return bound;
  }

  socket.onopen = () => {
    wsSend({
      type: "register",
      user: myUser,
      accountId: myAccountId,
      displayName: myDisplayName,
      accountIdScheme: normalizedAccount.accountIdScheme,
      firebaseIdToken: firebaseIdToken || null,
      deviceLabel,
    });
    flushPending();
  };

  socket.onerror = (e) => console.warn("[chat] ws error", e);
  socket.onclose = () => {
    console.warn("[chat] disconnected");
    settleIdentityBind(false, new Error("Chat connection closed during identity binding"));
    rejectAllSendRequests("Chat connection closed before delivery confirmation");
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

    if (data.type === "registered") {
      resolveRegistered(data);
      return;
    }

    if (data.type === "identity_bound") {
      settleIdentityBind(true, data);
      return;
    }

    if (data.type === "auth_error") {
      const err = new Error(
        String(data.message || data.error || "Authentication failed")
      );
      settleIdentityBind(false, err);
      rejectConfig(err);
      rejectRegistered(err);
      try {
        socket?.close();
      } catch {}
      return;
    }

    if (data.type === "backup_saved") {
      settleBackupSaveRequest(data.requestId, data.ok === true, data.error, data.backup || null);
      return;
    }

    if (data.type === "delivery") {
      settleSendRequest(
        data.requestId,
        data.ok === true,
        data,
        data.error || data.reason || "Message delivery failed"
      );
      return;
    }

    if (data.type === "error") {
      if (
        settleSendRequest(
          data.requestId,
          false,
          null,
          data.error || "Server rejected the request"
        )
      ) {
        return;
      }
      if (
        identityBindWaiter &&
        String(data.error || "").toLowerCase().includes("identity")
      ) {
        settleIdentityBind(false, data.error || "Identity binding failed");
        return;
      }
      console.warn("[chat] server error:", data.error || data);
      return;
    }

    if (data.type === "history_recent") {
      const messages = normalizeHistoryRecentItems(data.messages);
      settleHistoryFetchRequest(
        data.requestId,
        data.ok === true,
        messages,
        data.error
      );
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
  const registered = await registeredPromise;

  if (registered?.accountId) {
    myAccountId = normalizeAccountId(registered.accountId);
  }
  if (registered?.displayName) {
    myDisplayName = normalizeDisplayName(registered.displayName) || myDisplayName;
  }

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
    await bindIdentity(identityId);
    cert.identityId = identityId;
    wsSend({ type: "cert_submit", certificate: cert });

    // CRITICAL: hard flush state NOW (prevents losing EGKeyPair if tab closes)
    await saveStateNow();
  } else {
    const identityId = await ensureMessengerIdentityId();
    await bindIdentity(identityId);
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

export function getAccountId() {
  return myAccountId;
}

export function getDisplayName() {
  return myDisplayName || myUser;
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

  const { primaryKey, messages } = await loadLocalHistoryFromAllThreadKeys(p);
  if (messages.length > 0) {
    await storeRecord(primaryKey, JSON.stringify(messages));
  }
  await backfillConversationMetadataFromHistory(p, messages);
  return messages;
}

export async function sendMessage(peer, text) {
  if (!messenger) throw new Error("Call initChat() first");
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Chat connection is not ready");
  }

  const p = normalizeUsername(peer);
  const msg = String(text || "").trim();
  if (!p || !msg) return;

  if (!readyPeers.has(p)) {
    throw new Error(`Chưa có certificate của ${p} (mở tab người kia và Start trước)`);
  }

  const stateBeforeSend = await exportMessengerState(messenger);
  const [header, ciphertext] = await messenger.sendMessage(p, msg);
  const requestId = nextSendRequestId();
  const deliveryPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sendRequests.delete(requestId);
      reject(new Error("Message delivery timed out"));
    }, SEND_REQUEST_TIMEOUT_MS);

    sendRequests.set(requestId, { resolve, reject, timer });
  });

  wsSend({
    type: "send",
    requestId,
    to: p,
    header,
    ciphertextB64: abToB64(ciphertext),
  });

  try {
    await deliveryPromise;
  } catch (err) {
    try {
      await importMessengerState(messenger, stateBeforeSend);
    } catch (rollbackErr) {
      console.warn("[chat] failed to roll back send state:", rollbackErr);
    }
    throw err;
  }

  const { primaryKey, messages } = await loadLocalHistoryFromAllThreadKeys(p);
  let arr = messages;
  const ts = Date.now();
  const nextItem = { from: myUser, text: msg, ts };
  if (!hasLocalHistoryDuplicate(arr, nextItem)) {
    arr.push(nextItem);
  }
  sortLocalHistory(arr);
  await storeRecord(primaryKey, JSON.stringify(arr));
  await rememberConversationPeer(p);
  await updateConversationMetadataFromMessage(p, msg, ts);

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
      ...blobDoc,
      username: myUser,
      accountId: myAccountId,
      displayName: myDisplayName,
    });
  });
}

export async function fetchRecentMessages(peer, limit = HISTORY_RECENT_DEFAULT_LIMIT) {
  if (!myUser || !socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Recent history requires an active session");
  }

  const p = normalizeUsername(peer);
  if (!p) {
    throw new Error("Peer is required");
  }

  const requestId = nextHistoryRequestId();
  const safeLimit = normalizeRecentLimit(limit);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      historyFetchRequests.delete(requestId);
      reject(new Error("History fetch timed out"));
    }, HISTORY_REQUEST_TIMEOUT_MS);

    historyFetchRequests.set(requestId, { resolve, reject, timer });
    wsSend({
      type: "history_fetch_recent",
      requestId,
      peer: p,
      limit: safeLimit,
    });
  });
}

export async function mergeRecentMessagesForDisplay(peer, recentItems) {
  if (!messenger) throw new Error("Call initChat() first");
  const displayMessages = await decryptRecentMessagesForDisplay(peer, recentItems);
  return mergeDisplayMessagesIntoLocalHistory(peer, displayMessages);
}

export async function fetchCloudBackup(username, identityId = null, options = {}) {
  const user = normalizeUsername(username);
  if (!user) {
    throw new Error("Username is required");
  }

  const url = buildApiUrl(`/api/backup/${encodeURIComponent(user)}`);
  const normalizedIdentityId = normalizeIdentityId(identityId || "");
  if (normalizedIdentityId) {
    url.searchParams.set("identityId", normalizedIdentityId);
  }

  const headers =
    options.includeAuth === false ? {} : await buildOptionalFirebaseAuthHeaders();
  const res = await fetch(url.toString(), { headers });

  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error("Restore failed");
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || "Restore failed");
  }

  return data;
}

export async function fetchCloudBackupIdentities(username, options = {}) {
  const user = normalizeUsername(username);
  if (!user) {
    throw new Error("Username is required");
  }

  const url = buildApiUrl(`/api/backups/${encodeURIComponent(user)}`);
  const headers =
    options.includeAuth === false ? {} : await buildOptionalFirebaseAuthHeaders();
  const res = await fetch(url.toString(), { headers });

  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error("Restore failed");
  }

  if (!res.ok || !data?.ok || !Array.isArray(data.items)) {
    throw new Error(data?.error || "Restore failed");
  }

  return data.items;
}

export async function fetchAccountActiveIdentity() {
  const headers = await buildOptionalFirebaseAuthHeaders();
  const res = await fetch(buildApiUrl("/api/account/active-identity").toString(), {
    headers,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error("Active identity check failed");
  }

  if (data?.ok === false && data?.configured === false && data?.enabled === false) {
    return {
      ok: true,
      configured: false,
      unavailable: true,
      error: data.error || "Active identity check unavailable",
    };
  }

  if (!res.ok || data?.ok !== true) {
    throw new Error(data?.error || "Active identity check failed");
  }

  return data;
}

export async function establishAccountActiveIdentity({
  activeIdentityId,
  displayName = "",
  source,
} = {}) {
  const identityId = normalizeIdentityId(activeIdentityId);
  if (!identityId) {
    throw new Error("Active identity id is required");
  }
  const normalizedSource = String(source || "").trim();
  if (!normalizedSource) {
    throw new Error("Active identity source is required");
  }

  const headers = await buildOptionalFirebaseAuthHeaders();
  const res = await fetch(buildApiUrl("/api/account/active-identity").toString(), {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      activeIdentityId: identityId,
      displayName: normalizeDisplayName(displayName || myDisplayName || myUser),
      deviceLabel: getClientDeviceLabel(),
      source: normalizedSource,
    }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error("Active identity update failed");
  }

  if (!res.ok || data?.ok !== true) {
    throw new Error(data?.error || "Active identity update failed");
  }

  return data;
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

  for (const req of historyFetchRequests.values()) {
    clearTimeout(req.timer);
    req.reject(new Error("History fetch interrupted"));
  }
  historyFetchRequests.clear();

  myUser = null;
  myAccountId = null;
  myDisplayName = null;
}
