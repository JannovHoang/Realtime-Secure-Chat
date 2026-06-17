"use strict";

const crypto = require("node:crypto");

const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const DEFAULT_CACHE_MS = 60 * 60 * 1000;

let cachedCerts = null;
let cachedUntil = 0;

function getFirebaseProjectId() {
  return String(
    process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      ""
  ).trim();
}

function getFirebaseServerAuthMode() {
  const mode = String(process.env.SERVER_AUTH_MODE || process.env.AUTH_MODE || "legacy")
    .trim()
    .toLowerCase();
  if (mode === "firebase_required") return "firebase_required";
  if (mode === "firebase_optional") return "firebase_optional";
  return "legacy";
}

function getFirebaseAuthServerStatus() {
  const projectId = getFirebaseProjectId();
  const authMode = getFirebaseServerAuthMode();
  const configured = Boolean(projectId);
  const enabled = authMode !== "legacy" && configured;
  let reason = "enabled";
  if (authMode === "legacy") reason = "server auth mode is legacy";
  else if (!configured) reason = "FIREBASE_PROJECT_ID is not configured";

  return {
    authMode,
    configured,
    enabled,
    required: authMode === "firebase_required",
    projectId: configured ? projectId : "",
    reason,
  };
}

function base64UrlToBuffer(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function parseJsonPart(part, label) {
  try {
    return JSON.parse(base64UrlToBuffer(part).toString("utf8"));
  } catch {
    throw new Error(`Invalid Firebase ID token ${label}`);
  }
}

function parseMaxAge(cacheControl) {
  const match = String(cacheControl || "").match(/max-age=(\d+)/i);
  if (!match) return DEFAULT_CACHE_MS;
  return Math.max(1, Number(match[1])) * 1000;
}

async function fetchFirebaseCerts() {
  const now = Date.now();
  if (cachedCerts && now < cachedUntil) return cachedCerts;

  const res = await fetch(CERTS_URL);
  if (!res.ok) {
    throw new Error("Firebase cert fetch failed");
  }

  const certs = await res.json();
  if (!certs || typeof certs !== "object" || Array.isArray(certs)) {
    throw new Error("Firebase cert response invalid");
  }

  cachedCerts = certs;
  cachedUntil = now + parseMaxAge(res.headers.get("cache-control"));
  return cachedCerts;
}

function verifyJwtSignature(signingInput, signature, certificatePem) {
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(certificatePem, signature);
}

function validateFirebaseClaims(payload, projectId) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuer = `https://securetoken.google.com/${projectId}`;

  if (payload.aud !== projectId) throw new Error("Firebase token audience mismatch");
  if (payload.iss !== issuer) throw new Error("Firebase token issuer mismatch");
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Firebase token subject missing");
  }
  if (payload.sub.length > 128) throw new Error("Firebase token subject invalid");
  if (!Number.isFinite(Number(payload.iat))) {
    throw new Error("Firebase token issued-at missing");
  }
  if (!Number.isFinite(Number(payload.exp))) {
    throw new Error("Firebase token expiry missing");
  }
  if (Number(payload.exp) <= nowSeconds) {
    throw new Error("Firebase token expired");
  }
}

async function verifyFirebaseIdToken(token) {
  const status = getFirebaseAuthServerStatus();
  if (!status.enabled) {
    throw new Error(`Firebase auth is not enabled: ${status.reason}`);
  }

  const raw = String(token || "").trim();
  const parts = raw.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid Firebase ID token format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = parseJsonPart(headerB64, "header");
  const payload = parseJsonPart(payloadB64, "payload");

  if (header.alg !== "RS256") throw new Error("Firebase token algorithm invalid");
  if (!header.kid) throw new Error("Firebase token key id missing");

  const certs = await fetchFirebaseCerts();
  const certificatePem = certs[header.kid];
  if (!certificatePem) throw new Error("Firebase token key id unknown");

  const signatureOk = verifyJwtSignature(
    `${headerB64}.${payloadB64}`,
    base64UrlToBuffer(signatureB64),
    certificatePem
  );
  if (!signatureOk) throw new Error("Firebase token signature invalid");

  validateFirebaseClaims(payload, status.projectId);

  return {
    firebaseUid: String(payload.sub),
    email: typeof payload.email === "string" ? payload.email : "",
    emailVerified: Boolean(payload.email_verified),
    name: typeof payload.name === "string" ? payload.name : "",
    picture: typeof payload.picture === "string" ? payload.picture : "",
    provider:
      typeof payload.firebase?.sign_in_provider === "string"
        ? payload.firebase.sign_in_provider
        : "",
    claims: payload,
  };
}

function readBearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

module.exports = {
  getFirebaseAuthServerStatus,
  readBearerToken,
  verifyFirebaseIdToken,
};
