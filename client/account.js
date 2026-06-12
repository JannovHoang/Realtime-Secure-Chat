const LOCAL_ACCOUNT_PREFIX = "local";
const LOCAL_ACCOUNT_HASH_LABEL = "securechat:local-account:v1";

function toBase64Url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function normalizeDisplayName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAccountId(value) {
  return String(value ?? "").trim();
}

export async function deriveLocalAccountId(displayName) {
  const normalized = normalizeDisplayName(displayName);
  if (!normalized) throw new Error("Display name is required");

  const data = new TextEncoder().encode(
    `${LOCAL_ACCOUNT_HASH_LABEL}:${normalized}`
  );
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `${LOCAL_ACCOUNT_PREFIX}:${toBase64Url(digest)}`;
}

export async function buildLocalAccountProfile(displayName) {
  const normalizedDisplayName = normalizeDisplayName(displayName);
  if (!normalizedDisplayName) throw new Error("Display name is required");

  return {
    accountId: await deriveLocalAccountId(normalizedDisplayName),
    displayName: normalizedDisplayName,
    accountIdScheme: `${LOCAL_ACCOUNT_PREFIX}-username-v1`,
  };
}
