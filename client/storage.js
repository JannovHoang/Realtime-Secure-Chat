// client/storage.js
// =======================================
// Adapter for Project 1: Password Manager (Browser)
// + Persist vault (encrypted) to localStorage
// + Chunk ALL values safely to avoid "Password too long"
// + Chunk INDEX_KEY as well (CRITICAL FIX)
// + Unicode-safe chunking (Vietnamese / emoji safe)
// =======================================

import * as pmModule from "../crypto/pm/password-manager.browser.js";
import { normalizeAccountId, normalizeDisplayName } from "./account.js";
const { Keychain } = pmModule;

// -------------------- State --------------------
let keychain = null;          // in-memory per tab
let vaultStorageKey = null;   // localStorage key per user

// Encrypted index keys (inside vault)
const INDEX_KEY = "__securechat_index_v1__";
const CONV_INDEX_KEY = "__securechat_conversations_v1__";
const CONV_META_KEY = "__securechat_conversation_meta_v1__";
const IDENTITY_META_KEY = "__securechat_identity_meta_v2__";
const BACKUP_META_KEY = "__securechat_backup_meta_v1__";

// Chunking scheme
const CHUNK_META_SUFFIX = "::chunks_meta"; // JSON { n, encoding, totalBytes }
const CHUNK_PART_PREFIX = "::chunk:";

// PM hard limit is 64 bytes → use safe margin
const MAX_CHUNK_BYTES = 48;

// -------------------- Helpers --------------------
function toBase64Url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function hashLabel(label) {
  const data = new TextEncoder().encode(String(label ?? ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(digest);
}

async function makeVaultStorageKey(userId) {
  const label = `securechat:vault:${userId}`;
  const h = await hashLabel(label);
  return `securechat:vault:${h}`;
}

/**
 * Normalize record names / keys WITHOUT changing case.
 * Why: prevent "Huong" vs "Huong " vs "Huong " (NBSP) creating duplicate keys.
 * - Keep case (Huong != huong)
 * - Normalize Unicode (NFKC)
 * - Convert weird whitespaces to normal space
 * - Collapse multiple spaces
 * - Trim
 */
function normalizeKeyName(name) {
  return String(name ?? "")
    .normalize("NFKC")
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ") // NBSP & weird spaces -> space
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePreview(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTimestamp(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

// UTF-8 byte length (accurate)
function utf8ByteLen(str) {
  return new TextEncoder().encode(str).length;
}

/**
 * Unicode-safe chunking by code points
 */
function splitStringIntoUtf8ChunksSafe(str, maxBytes = MAX_CHUNK_BYTES) {
  const chunks = [];
  let cur = "";
  let curBytes = 0;

  for (const ch of String(str)) {
    const b = utf8ByteLen(ch);

    if (b > maxBytes) {
      if (cur) chunks.push(cur);
      chunks.push(ch);
      cur = "";
      curBytes = 0;
      continue;
    }

    if (curBytes + b > maxBytes) {
      chunks.push(cur);
      cur = ch;
      curBytes = b;
    } else {
      cur += ch;
      curBytes += b;
    }
  }

  if (cur) chunks.push(cur);
  return { chunks, totalBytes: utf8ByteLen(str) };
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

function strToAb(str) {
  return new TextEncoder().encode(String(str ?? "")).buffer;
}

function abToStr(ab) {
  return new TextDecoder().decode(ab);
}

function randomBytes(len) {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out.buffer;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        out[key] = canonicalize(value[key]);
        return out;
      }, {});
  }
  return value;
}

function validateImportedPayload(
  payload,
  expectedUsername = null,
  expectedIdentityId = null,
  expectedAccountId = null
) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid backup payload");
  }
  if (payload.version !== 2) {
    throw new Error("Unsupported backup version");
  }
  if (typeof payload.username !== "string" || !normalizeKeyName(payload.username)) {
    throw new Error("Invalid backup username");
  }
  if (typeof payload.identityId !== "string" || !normalizeKeyName(payload.identityId)) {
    throw new Error("Invalid backup identityId");
  }
  if (typeof payload.repr !== "string" || !payload.repr) {
    throw new Error("Invalid backup repr");
  }
  if (typeof payload.digest !== "string" || !payload.digest) {
    throw new Error("Invalid backup digest");
  }

  const payloadUser = normalizeKeyName(payload.username);
  const expectedUser = normalizeKeyName(expectedUsername || "");
  if (expectedUser && payloadUser !== expectedUser) {
    throw new Error("Backup username mismatch");
  }

  const payloadIdentityId = normalizeKeyName(payload.identityId);
  const expectedId = normalizeKeyName(expectedIdentityId || "");
  if (expectedId && payloadIdentityId !== expectedId) {
    throw new Error("Backup identity mismatch");
  }

  const payloadAccountId = normalizeAccountId(payload.accountId);
  const expectedAccount = normalizeAccountId(expectedAccountId || "");
  if (expectedAccount && payloadAccountId && payloadAccountId !== expectedAccount) {
    throw new Error("Backup account mismatch");
  }
}

function normalizeIsoTimestamp(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function readPersisted() {
  if (!vaultStorageKey) return null;
  const raw = localStorage.getItem(vaultStorageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw); // { repr, digest, savedAt }
  } catch {
    return null;
  }
}

async function persistNow() {
  if (!keychain) throw new Error("Vault not initialized");
  const [repr, digest] = await keychain.dump();
  localStorage.setItem(
    vaultStorageKey,
    JSON.stringify({ repr, digest, savedAt: Date.now() })
  );
}

async function readPersistedForUser(userId) {
  const key = await makeVaultStorageKey(userId);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writePersistedForUser(userId, persisted) {
  const key = await makeVaultStorageKey(userId);
  localStorage.setItem(key, JSON.stringify(persisted));
}

async function deriveBackupKey(password, saltAb, usages) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    strToAb(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltAb,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

// -------------------- Chunked KV helpers --------------------
async function deleteChunkedIfExists(name) {
  const metaKey = `${name}${CHUNK_META_SUFFIX}`;
  const metaRaw = await keychain.get(metaKey);
  if (!metaRaw) return false;

  try {
    const meta = JSON.parse(metaRaw);
    const n = Number(meta?.n || 0);
    for (let i = 0; i < n; i++) {
      await keychain.remove(`${name}${CHUNK_PART_PREFIX}${i}`);
    }
    await keychain.remove(metaKey);
    return true;
  } catch {
    await keychain.remove(metaKey);
    return true;
  }
}

async function setValueChunked(name, value) {
  if (!keychain) throw new Error("Vault not initialized");
  const key = normalizeKeyName(name);
  const val = String(value ?? "");
  if (!key) throw new Error("Empty record name");

  // Remove legacy or old chunks
  await keychain.remove(key).catch(() => {});
  await deleteChunkedIfExists(key).catch(() => {});

  // Fast path
  try {
    await keychain.set(key, val);
    return;
  } catch {
    // fall through to chunking
  }

  const { chunks, totalBytes } = splitStringIntoUtf8ChunksSafe(val, MAX_CHUNK_BYTES);
  const metaKey = `${key}${CHUNK_META_SUFFIX}`;
  const meta = { n: chunks.length, encoding: "utf-8", totalBytes };

  await keychain.set(metaKey, JSON.stringify(meta));
  for (let i = 0; i < chunks.length; i++) {
    await keychain.set(`${key}${CHUNK_PART_PREFIX}${i}`, chunks[i]);
  }
}

async function getValueChunked(name) {
  if (!keychain) throw new Error("Vault not initialized");
  const key = normalizeKeyName(name);
  if (!key) return null;

  const direct = await keychain.get(key);
  if (direct != null) return direct;

  const metaKey = `${key}${CHUNK_META_SUFFIX}`;
  const metaRaw = await keychain.get(metaKey);
  if (!metaRaw) return null;

  try {
    const meta = JSON.parse(metaRaw);
    const n = Number(meta?.n || 0);
    if (!Number.isFinite(n) || n <= 0) return null;

    let out = "";
    for (let i = 0; i < n; i++) {
      const part = await keychain.get(`${key}${CHUNK_PART_PREFIX}${i}`);
      if (part == null) return null;
      out += part;
    }
    return out;
  } catch {
    return null;
  }
}

// -------------------- Index helpers (CHUNKED!) --------------------
async function readIndex() {
  const s = await getValueChunked(INDEX_KEY);
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeIndex(arr) {
  const uniq = Array.from(
    new Set(arr.map(normalizeKeyName).filter(Boolean))
  );
  await setValueChunked(INDEX_KEY, JSON.stringify(uniq));
}

async function readConversationIndex() {
  const s = await getValueChunked(CONV_INDEX_KEY);
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeConversationIndex(arr) {
  const uniq = Array.from(
    new Set(arr.map(normalizeKeyName).filter(Boolean))
  );
  await setValueChunked(CONV_INDEX_KEY, JSON.stringify(uniq));
}

async function readConversationMetadataMap() {
  const s = await getValueChunked(CONV_META_KEY);
  if (!s) return {};

  try {
    const raw = JSON.parse(s);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      const peer = normalizeKeyName(value?.peer || key);
      if (!peer) continue;

      out[peer] = {
        peer,
        lastMessageAt: normalizeTimestamp(value?.lastMessageAt, 0),
        lastMessagePreview: normalizePreview(value?.lastMessagePreview),
        updatedAt: normalizeTimestamp(value?.updatedAt, 0),
      };
    }
    return out;
  } catch {
    return {};
  }
}

async function writeConversationMetadataMap(map) {
  const clean = {};
  for (const value of Object.values(map || {})) {
    const peer = normalizeKeyName(value?.peer);
    if (!peer) continue;
    clean[peer] = {
      peer,
      lastMessageAt: normalizeTimestamp(value?.lastMessageAt, 0),
      lastMessagePreview: normalizePreview(value?.lastMessagePreview),
      updatedAt: normalizeTimestamp(value?.updatedAt, 0),
    };
  }
  await setValueChunked(CONV_META_KEY, JSON.stringify(clean));
}

// -------------------- Public API --------------------
export async function hasPersistedVault(userId = "default") {
  const key = await makeVaultStorageKey(userId);
  return localStorage.getItem(key) != null;
}

export async function clearPersistedVault(userId = "default") {
  const key = await makeVaultStorageKey(userId);
  localStorage.removeItem(key);
}

/**
 * Initialize OR load existing vault
 */
export async function initVault(password, userId = "default") {
  vaultStorageKey = await makeVaultStorageKey(userId);
  const persisted = readPersisted();

  if (persisted?.repr && persisted?.digest) {
    keychain = await Keychain.load(password, persisted.repr, persisted.digest);
    return keychain;
  }

  keychain = await Keychain.init(password);
  await setValueChunked(INDEX_KEY, JSON.stringify([]));
  await setValueChunked(CONV_INDEX_KEY, JSON.stringify([]));
  await persistNow();
  return keychain;
}

export async function loadVault(password, repr, digest, userId = "default") {
  vaultStorageKey = await makeVaultStorageKey(userId);
  keychain = await Keychain.load(password, repr, digest);
  await persistNow();
  return keychain;
}

/**
 * Store record safely (ALWAYS chunk-aware)
 */
export async function storeRecord(name, value) {
  const key = normalizeKeyName(name);
  if (!key) throw new Error("Empty record name");

  const idx = await readIndex();
  if (!idx.includes(key)) {
    idx.push(key);
    await writeIndex(idx);
  }

  await setValueChunked(key, value);
  await persistNow();
}

/**
 * Load record safely
 */
export async function loadRecord(name) {
  return await getValueChunked(name);
}

export async function removeRecord(name) {
  const key = normalizeKeyName(name);
  if (!key) return false;

  const ok1 = await keychain.remove(key).catch(() => false);
  const ok2 = await deleteChunkedIfExists(key).catch(() => false);

  const idx = await readIndex();
  await writeIndex(idx.filter((x) => x !== key));

  await persistNow();
  return Boolean(ok1 || ok2);
}

export async function dumpVault() {
  if (!keychain) throw new Error("Vault not initialized");
  return await keychain.dump(); // [repr, digest]
}

export async function deriveIdentityIdFromPublicJwk(pubJwk) {
  if (!pubJwk || typeof pubJwk !== "object") {
    throw new Error("Missing public key for identityId");
  }
  const canonical = JSON.stringify(canonicalize(pubJwk));
  return await hashLabel(canonical);
}

export async function saveIdentityMetadata(meta) {
  if (!keychain) throw new Error("Vault not initialized");
  const username = normalizeKeyName(meta?.username);
  const identityId = normalizeKeyName(meta?.identityId);
  const accountId = normalizeAccountId(meta?.accountId);
  const displayName = normalizeDisplayName(meta?.displayName || username);
  if (!username || !identityId) {
    throw new Error("Invalid identity metadata");
  }

  await storeRecord(
    IDENTITY_META_KEY,
    JSON.stringify({
      version: 2,
      username,
      accountId: accountId || null,
      displayName: displayName || username,
      identityId,
      savedAt: Date.now(),
    })
  );
}

export async function loadIdentityMetadata() {
  if (!keychain) throw new Error("Vault not initialized");
  const raw = await loadRecord(IDENTITY_META_KEY);
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const username = normalizeKeyName(parsed?.username);
  const accountId = normalizeAccountId(parsed?.accountId);
  const displayName = normalizeDisplayName(parsed?.displayName || username);
  const identityId = normalizeKeyName(parsed?.identityId);
  if (!username || !identityId) return null;

  return {
    version: Number(parsed?.version || 1),
    username,
    accountId: accountId || null,
    displayName: displayName || username,
    identityId,
    savedAt: Number(parsed?.savedAt || 0),
  };
}

export async function saveBackupMetadata(meta = {}) {
  if (!keychain) throw new Error("Vault not initialized");
  const username = normalizeKeyName(meta.username);
  const identityId = normalizeKeyName(meta.identityId);
  if (!username || !identityId) {
    throw new Error("Invalid backup metadata");
  }

  const accountId = normalizeAccountId(meta.accountId);
  const displayName = normalizeDisplayName(meta.displayName || username);
  const serverSavedAt = normalizeIsoTimestamp(meta.serverSavedAt);
  const clientSavedAt = normalizeIsoTimestamp(meta.clientSavedAt);

  await storeRecord(
    BACKUP_META_KEY,
    JSON.stringify({
      version: 1,
      username,
      accountId: accountId || null,
      displayName: displayName || username,
      accountIdScheme:
        typeof meta.accountIdScheme === "string" && meta.accountIdScheme.trim()
          ? meta.accountIdScheme.trim()
          : null,
      authMode:
        typeof meta.authMode === "string" && meta.authMode.trim()
          ? meta.authMode.trim()
          : null,
      firebaseUid:
        typeof meta.firebaseUid === "string" && meta.firebaseUid.trim()
          ? meta.firebaseUid.trim()
          : null,
      identityId,
      identityShortId: identityId.slice(0, 8),
      backupVersion: Number(meta.backupVersion || meta.version || 2),
      clientSavedAt,
      serverSavedAt,
      localLastBackupServerSavedAt: serverSavedAt,
      savedAt: Date.now(),
    })
  );
}

export async function loadBackupMetadata() {
  if (!keychain) throw new Error("Vault not initialized");
  const raw = await loadRecord(BACKUP_META_KEY);
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const username = normalizeKeyName(parsed?.username);
  const identityId = normalizeKeyName(parsed?.identityId);
  if (!username || !identityId) return null;

  return {
    version: Number(parsed?.version || 1),
    username,
    accountId: normalizeAccountId(parsed?.accountId) || null,
    displayName: normalizeDisplayName(parsed?.displayName || username) || username,
    accountIdScheme:
      typeof parsed?.accountIdScheme === "string" && parsed.accountIdScheme.trim()
        ? parsed.accountIdScheme.trim()
        : null,
    authMode:
      typeof parsed?.authMode === "string" && parsed.authMode.trim()
        ? parsed.authMode.trim()
        : null,
    firebaseUid:
      typeof parsed?.firebaseUid === "string" && parsed.firebaseUid.trim()
        ? parsed.firebaseUid.trim()
        : null,
    identityId,
    identityShortId: String(parsed?.identityShortId || identityId.slice(0, 8)),
    backupVersion: Number(parsed?.backupVersion || 2),
    clientSavedAt: normalizeIsoTimestamp(parsed?.clientSavedAt),
    serverSavedAt: normalizeIsoTimestamp(parsed?.serverSavedAt),
    localLastBackupServerSavedAt: normalizeIsoTimestamp(
      parsed?.localLastBackupServerSavedAt
    ),
    savedAt: Number(parsed?.savedAt || 0),
  };
}

export async function exportIdentityPayload(userId = "default") {
  const persisted = await readPersistedForUser(userId);
  if (!persisted?.repr || !persisted?.digest) {
    throw new Error("No persisted vault for user");
  }

  const identityMeta = await loadIdentityMetadata();
  const username = normalizeKeyName(userId);
  if (!identityMeta?.identityId) {
    throw new Error("No persisted identityId for user");
  }
  if (normalizeKeyName(identityMeta.username) !== username) {
    throw new Error("Persisted identity metadata mismatch");
  }

  return {
    version: 2,
    username,
    accountId: identityMeta.accountId || null,
    displayName: identityMeta.displayName || username,
    identityId: identityMeta.identityId,
    repr: persisted.repr,
    digest: persisted.digest,
    exportedAt: new Date().toISOString(),
  };
}

export async function verifyPersistedVaultPassword(userId, password) {
  const persisted = await readPersistedForUser(userId);
  if (!persisted?.repr || !persisted?.digest) return false;
  try {
    await Keychain.load(password, persisted.repr, persisted.digest);
    return true;
  } catch {
    return false;
  }
}

export async function getPersistedVaultMetadata(userId) {
  const persisted = await readPersistedForUser(userId);
  if (!persisted?.repr || !persisted?.digest) return null;
  return {
    savedAt: normalizeTimestamp(persisted.savedAt, 0),
    hasVault: true,
  };
}

export async function encryptIdentityPayload(payload, password) {
  validateImportedPayload(payload);
  const clientSavedAt =
    normalizeIsoTimestamp(payload.clientSavedAt) || new Date().toISOString();
  const payloadForEncryption = {
    ...payload,
    clientSavedAt,
  };

  const saltAb = randomBytes(16);
  const ivAb = randomBytes(12);
  const key = await deriveBackupKey(password, saltAb, ["encrypt"]);
  const plaintextAb = strToAb(JSON.stringify(payloadForEncryption));
  const ciphertextAb = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivAb },
    key,
    plaintextAb
  );

  return {
    version: 2,
    username: normalizeKeyName(payload.username),
    accountId: normalizeAccountId(payload.accountId) || null,
    displayName:
      normalizeDisplayName(payload.displayName || payload.username) ||
      normalizeKeyName(payload.username),
    accountIdScheme:
      typeof payload.accountIdScheme === "string" && payload.accountIdScheme.trim()
        ? payload.accountIdScheme.trim()
        : null,
    identityId: normalizeKeyName(payload.identityId),
    clientSavedAt,
    ciphertextB64: abToB64(ciphertextAb),
    ivB64: abToB64(ivAb),
    saltB64: abToB64(saltAb),
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 100000,
    },
  };
}

export async function decryptIdentityPayload(
  blob,
  password,
  expectedUsername = null,
  expectedIdentityId = null,
  expectedAccountId = null
) {
  if (!blob || typeof blob !== "object") {
    throw new Error("Invalid encrypted backup");
  }
  if (typeof blob.ciphertextB64 !== "string" || !blob.ciphertextB64) {
    throw new Error("Invalid encrypted backup ciphertext");
  }
  if (typeof blob.ivB64 !== "string" || !blob.ivB64) {
    throw new Error("Invalid encrypted backup iv");
  }
  if (typeof blob.saltB64 !== "string" || !blob.saltB64) {
    throw new Error("Invalid encrypted backup salt");
  }

  const expectedAccount = normalizeAccountId(expectedAccountId || "");
  const blobAccount = normalizeAccountId(blob.accountId);
  const blobAuthMode = String(blob.authMode || "").trim();
  if (expectedAccount && blobAccount && blobAccount !== expectedAccount) {
    throw new Error("Backup account mismatch");
  }

  const saltAb = b64ToAb(blob.saltB64);
  const ivAb = b64ToAb(blob.ivB64);
  const ciphertextAb = b64ToAb(blob.ciphertextB64);
  const key = await deriveBackupKey(password, saltAb, ["decrypt"]);

  let plaintextAb;
  try {
    plaintextAb = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivAb },
      key,
      ciphertextAb
    );
  } catch {
    throw new Error("Backup decrypt failed");
  }

  let payload;
  try {
    payload = JSON.parse(abToStr(plaintextAb));
  } catch {
    throw new Error("Backup payload is not valid JSON");
  }

  validateImportedPayload(
    payload,
    expectedUsername || blob.username || null,
    expectedIdentityId || blob.identityId || null,
    expectedAccountId || (blobAuthMode === "firebase" ? null : blob.accountId) || null
  );
  return payload;
}

export async function importIdentityPayload(
  payload,
  expectedUsername = null,
  expectedIdentityId = null,
  expectedAccountId = null
) {
  validateImportedPayload(
    payload,
    expectedUsername,
    expectedIdentityId,
    expectedAccountId
  );

  const username = normalizeKeyName(payload.username);
  await writePersistedForUser(username, {
    repr: payload.repr,
    digest: payload.digest,
    savedAt: Date.now(),
  });
}

export async function listRecordNames(prefix = "") {
  const p = normalizeKeyName(prefix);
  const idx = await readIndex();
  if (!p) return idx;
  return idx.filter((k) => k.startsWith(p));
}

export async function addConversationPeer(peer) {
  const p = normalizeKeyName(peer);
  if (!p) return;
  const idx = await readConversationIndex();
  if (!idx.includes(p)) {
    idx.push(p);
    await writeConversationIndex(idx);
  }
  await persistNow();
}

export async function listConversationPeers() {
  return await readConversationIndex();
}

export async function upsertConversationMetadata(peer, patch = {}) {
  const p = normalizeKeyName(peer);
  if (!p) return null;

  const map = await readConversationMetadataMap();
  const current = map[p] || {
    peer: p,
    lastMessageAt: 0,
    lastMessagePreview: "",
    updatedAt: 0,
  };

  const hasPatchTimestamp = Object.prototype.hasOwnProperty.call(
    patch,
    "lastMessageAt"
  );
  const nextTimestamp = hasPatchTimestamp
    ? normalizeTimestamp(patch.lastMessageAt, current.lastMessageAt || 0)
    : current.lastMessageAt || 0;

  const next = {
    peer: p,
    lastMessageAt: nextTimestamp,
    lastMessagePreview: current.lastMessagePreview || "",
    updatedAt: Date.now(),
  };

  if (Object.prototype.hasOwnProperty.call(patch, "lastMessagePreview")) {
    const preview = normalizePreview(patch.lastMessagePreview);
    if (preview) next.lastMessagePreview = preview;
  }

  map[p] = next;
  await writeConversationMetadataMap(map);
  await addConversationPeer(p);
  return next;
}

export async function getConversationMetadata(peer) {
  const p = normalizeKeyName(peer);
  if (!p) return null;
  const map = await readConversationMetadataMap();
  return map[p] || null;
}

export async function listConversationMetadata() {
  const [peers, map] = await Promise.all([
    readConversationIndex(),
    readConversationMetadataMap(),
  ]);
  const seen = new Set();
  const out = [];

  for (const peer of peers) {
    const p = normalizeKeyName(peer);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(
      map[p] || {
        peer: p,
        lastMessageAt: 0,
        lastMessagePreview: "",
        updatedAt: 0,
      }
    );
  }

  for (const meta of Object.values(map)) {
    const p = normalizeKeyName(meta?.peer);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(meta);
  }

  return out;
}

export async function hmacRecordKey(label) {
  if (!keychain?.secrets?.domainKey) throw new Error("Vault not initialized");
  const data = new TextEncoder().encode(String(label ?? ""));
  const raw = await crypto.subtle.sign("HMAC", keychain.secrets.domainKey, data);
  return abToB64(raw);
}
