// client/storage.js
// =======================================
// Adapter for Project 1: Password Manager (Browser)
// + Persist vault (encrypted) to localStorage
// + Chunk ALL values safely to avoid "Password too long"
// + Chunk INDEX_KEY as well (CRITICAL FIX)
// + Unicode-safe chunking (Vietnamese / emoji safe)
// =======================================

import * as pmModule from "../crypto/pm/password-manager.browser.js";
const { Keychain } = pmModule;

// -------------------- State --------------------
let keychain = null;          // in-memory per tab
let vaultStorageKey = null;   // localStorage key per user

// Encrypted index keys (inside vault)
const INDEX_KEY = "__securechat_index_v1__";
const CONV_INDEX_KEY = "__securechat_conversations_v1__";

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

function validateImportedPayload(payload, expectedUsername = null) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid backup payload");
  }
  if (payload.version !== 1) {
    throw new Error("Unsupported backup version");
  }
  if (typeof payload.username !== "string" || !normalizeKeyName(payload.username)) {
    throw new Error("Invalid backup username");
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

export async function exportIdentityPayload(userId = "default") {
  const persisted = await readPersistedForUser(userId);
  if (!persisted?.repr || !persisted?.digest) {
    throw new Error("No persisted vault for user");
  }

  return {
    version: 1,
    username: normalizeKeyName(userId),
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

export async function encryptIdentityPayload(payload, password) {
  validateImportedPayload(payload);

  const saltAb = randomBytes(16);
  const ivAb = randomBytes(12);
  const key = await deriveBackupKey(password, saltAb, ["encrypt"]);
  const plaintextAb = strToAb(JSON.stringify(payload));
  const ciphertextAb = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivAb },
    key,
    plaintextAb
  );

  return {
    version: 1,
    username: normalizeKeyName(payload.username),
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

export async function decryptIdentityPayload(blob, password, expectedUsername = null) {
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

  validateImportedPayload(payload, expectedUsername || blob.username || null);
  return payload;
}

export async function importIdentityPayload(payload, expectedUsername = null) {
  validateImportedPayload(payload, expectedUsername);

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

export async function hmacRecordKey(label) {
  if (!keychain?.secrets?.domainKey) throw new Error("Vault not initialized");
  const data = new TextEncoder().encode(String(label ?? ""));
  const raw = await crypto.subtle.sign("HMAC", keychain.secrets.domainKey, data);
  return abToB64(raw);
}
