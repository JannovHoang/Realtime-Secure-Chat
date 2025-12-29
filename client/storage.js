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

// Encrypted index key (inside vault)
const INDEX_KEY = "__securechat_index_v1__";

// Chunking scheme
const CHUNK_META_SUFFIX = "::chunks_meta"; // JSON { n, encoding, totalBytes }
const CHUNK_PART_PREFIX = "::chunk:";

// PM hard limit is 64 bytes → use safe margin
const MAX_CHUNK_BYTES = 48;

// -------------------- Helpers --------------------
function makeVaultStorageKey(userId) {
  return `securechat:vault:${userId}`;
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

// -------------------- Public API --------------------
export function hasPersistedVault(userId = "default") {
  return localStorage.getItem(makeVaultStorageKey(userId)) != null;
}

export function clearPersistedVault(userId = "default") {
  localStorage.removeItem(makeVaultStorageKey(userId));
}

/**
 * Initialize OR load existing vault
 */
export async function initVault(password, userId = "default") {
  vaultStorageKey = makeVaultStorageKey(userId);
  const persisted = readPersisted();

  if (persisted?.repr && persisted?.digest) {
    keychain = await Keychain.load(password, persisted.repr, persisted.digest);
    return keychain;
  }

  keychain = await Keychain.init(password);
  await setValueChunked(INDEX_KEY, JSON.stringify([]));
  await persistNow();
  return keychain;
}

export async function loadVault(password, repr, digest, userId = "default") {
  vaultStorageKey = makeVaultStorageKey(userId);
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

export async function listRecordNames(prefix = "") {
  const p = normalizeKeyName(prefix);
  const idx = await readIndex();
  if (!p) return idx;
  return idx.filter((k) => k.startsWith(p));
}
