// crypto/dr/lib.browser.js
"use strict";

const govEncryptionDataStr = "AES-GENERATION";

// ---- Text helpers
const _enc = new TextEncoder();
const _dec = new TextDecoder();

function bufferToString(arr) {
  return _dec.decode(new Uint8Array(arr));
}

// ---- Random bytes
function genRandomSalt(len = 16) {
  return crypto.getRandomValues(new Uint8Array(len));
}

// ---- Base64 helpers
function _abToB64(ab) {
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function _b64ToAb(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

const { subtle } = crypto;

async function cryptoKeyToJSON(cryptoKey) {
  return await subtle.exportKey("jwk", cryptoKey);
}

async function generateEG() {
  const keypair = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-384" },
    true,
    ["deriveBits"]
  );
  return { pub: keypair.publicKey, sec: keypair.privateKey };
}

/**
 * FIXED computeDH:
 * Avoid Chrome DataError when deriving HMAC directly from ECDH.
 * Derive 256 bits then import as HMAC key.
 */
async function computeDH(myPrivateKey, theirPublicKey) {
  const bits = await subtle.deriveBits(
    { name: "ECDH", public: theirPublicKey },
    myPrivateKey,
    256
  );

  return await subtle.importKey(
    "raw",
    bits,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign", "verify"]
  );
}

async function verifyWithECDSA(publicKey, message, signature) {
  return await subtle.verify(
    { name: "ECDSA", hash: { name: "SHA-384" } },
    publicKey,
    signature,
    _enc.encode(message)
  );
}

async function HMACtoAESKey(key, data, exportToArrayBuffer = false) {
  const hmacBuf = await subtle.sign({ name: "HMAC" }, key, _enc.encode(data));
  const out = await subtle.importKey("raw", hmacBuf, "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ]);
  if (exportToArrayBuffer) return await subtle.exportKey("raw", out);
  return out;
}

async function HMACtoHMACKey(key, data) {
  const hmacBuf = await subtle.sign({ name: "HMAC" }, key, _enc.encode(data));
  return await subtle.importKey(
    "raw",
    hmacBuf,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"]
  );
}

async function HKDF(inputKey, salt, infoStr) {
  const inputKeyBuf = await subtle.sign(
    { name: "HMAC" },
    inputKey,
    _enc.encode("0")
  );
  const inputKeyHKDF = await subtle.importKey("raw", inputKeyBuf, "HKDF", false, [
    "deriveKey",
  ]);

  const salt1 = await subtle.sign({ name: "HMAC" }, salt, _enc.encode("salt1"));
  const salt2 = await subtle.sign({ name: "HMAC" }, salt, _enc.encode("salt2"));

  const hkdfOut1 = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: salt1, info: _enc.encode(infoStr) },
    inputKeyHKDF,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"]
  );

  const hkdfOut2 = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: salt2, info: _enc.encode(infoStr) },
    inputKeyHKDF,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"]
  );

  return [hkdfOut1, hkdfOut2];
}

async function encryptWithGCM(key, plaintext, iv, authenticatedData = "") {
  const pt = typeof plaintext === "string" ? _enc.encode(plaintext) : new Uint8Array(plaintext);
  const aad = _enc.encode(authenticatedData);
  return await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    pt
  );
}

async function decryptWithGCM(key, ciphertext, iv, authenticatedData = "") {
  const aad = _enc.encode(authenticatedData);
  return await subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    ciphertext
  );
}

// ---- ECDSA helpers
async function generateECDSA() {
  const keypair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-384" },
    true,
    ["sign", "verify"]
  );
  return { pub: keypair.publicKey, sec: keypair.privateKey };
}

async function signWithECDSA(privateKey, message) {
  return await subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-384" } },
    privateKey,
    _enc.encode(message)
  );
}

export {
  govEncryptionDataStr,
  bufferToString,
  genRandomSalt,
  cryptoKeyToJSON,
  generateEG,
  computeDH,
  verifyWithECDSA,
  HMACtoAESKey,
  HMACtoHMACKey,
  HKDF,
  encryptWithGCM,
  decryptWithGCM,
  generateECDSA,
  signWithECDSA,
  _abToB64,
  _b64ToAb,
};
