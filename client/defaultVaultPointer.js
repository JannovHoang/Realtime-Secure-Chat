import { normalizeAccountId, normalizeDisplayName } from "./account.js";
import { hasPersistedVault } from "./storage.js";

const POINTER_SCHEMA_VERSION = 1;
const POINTER_KEY_PREFIX = "securechat:defaultVault:firebase:";

function normalizeFirebaseUid(value) {
  return String(value || "").trim();
}

function normalizeIdentityId(value) {
  return String(value || "").trim();
}

function normalizeVaultLabel(value) {
  return normalizeDisplayName(value);
}

function normalizeIsoTimestamp(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function normalizePositiveNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function makePointerStorageKey(firebaseUid) {
  const uid = normalizeFirebaseUid(firebaseUid);
  if (!uid) throw new Error("Firebase uid is required");
  return `${POINTER_KEY_PREFIX}${encodeURIComponent(uid)}`;
}

export function validateDefaultVaultPointer(pointer, currentFirebaseUid) {
  if (!pointer || typeof pointer !== "object" || Array.isArray(pointer)) {
    return null;
  }

  const firebaseUid = normalizeFirebaseUid(pointer.firebaseUid);
  const expectedUid = normalizeFirebaseUid(currentFirebaseUid);
  if (!firebaseUid || !expectedUid || firebaseUid !== expectedUid) return null;

  const accountId = normalizeAccountId(pointer.accountId);
  if (accountId !== `firebase:${firebaseUid}`) return null;

  const activeIdentityId = normalizeIdentityId(
    pointer.activeIdentityId || pointer.identityId
  );
  const legacyVaultLabel = normalizeVaultLabel(
    pointer.legacyVaultLabel || pointer.vaultLabel || pointer.displayName
  );
  if (!activeIdentityId || !legacyVaultLabel) return null;

  const displayName = normalizeDisplayName(pointer.displayName || legacyVaultLabel);
  const lastUpdatedAt =
    normalizeIsoTimestamp(pointer.lastUpdatedAt) || new Date().toISOString();

  return {
    schemaVersion: POINTER_SCHEMA_VERSION,
    authMode: "firebase",
    firebaseUid,
    accountId,
    activeIdentityId,
    displayName: displayName || legacyVaultLabel,
    legacyVaultLabel,
    lastKnownBackupVersion: normalizePositiveNumber(
      pointer.lastKnownBackupVersion
    ),
    lastKnownBackupServerSavedAt: normalizeIsoTimestamp(
      pointer.lastKnownBackupServerSavedAt
    ),
    lastUpdatedAt,
  };
}

export async function getDefaultVaultPointer(firebaseUid, options = {}) {
  const uid = normalizeFirebaseUid(firebaseUid);
  if (!uid) return null;

  let parsed;
  try {
    const raw = localStorage.getItem(makePointerStorageKey(uid));
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const pointer = validateDefaultVaultPointer(parsed, uid);
  if (!pointer) return null;

  if (options.requireLocalVault) {
    const exists = await hasPersistedVault(pointer.legacyVaultLabel).catch(
      () => false
    );
    if (!exists) return null;
  }

  return pointer;
}

export function setDefaultVaultPointer(firebaseUid, pointer) {
  const uid = normalizeFirebaseUid(firebaseUid);
  const normalized = validateDefaultVaultPointer(
    {
      ...pointer,
      firebaseUid: pointer?.firebaseUid || uid,
      accountId: pointer?.accountId || `firebase:${uid}`,
      lastUpdatedAt: pointer?.lastUpdatedAt || new Date().toISOString(),
    },
    uid
  );

  if (!normalized) {
    throw new Error("Invalid default vault pointer");
  }

  localStorage.setItem(makePointerStorageKey(uid), JSON.stringify(normalized));
  return normalized;
}

export function clearDefaultVaultPointer(firebaseUid) {
  const uid = normalizeFirebaseUid(firebaseUid);
  if (!uid) return false;
  try {
    localStorage.removeItem(makePointerStorageKey(uid));
    return true;
  } catch {
    return false;
  }
}

