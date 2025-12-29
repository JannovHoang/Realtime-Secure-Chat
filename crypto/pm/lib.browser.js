// crypto/pm/lib.browser.js
"use strict";

// Browser version of Project 1 lib.js (no Node crypto, no Buffer dependency)

const _enc = new TextEncoder();
const _dec = new TextDecoder();

// String <-> ArrayBuffer helpers
function stringToBuffer(str) {
  return _enc.encode(str).buffer; // ArrayBuffer
}

function bufferToString(buf) {
  return _dec.decode(new Uint8Array(buf)); // string
}

// Base64 helpers (browser-safe)
function encodeBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function decodeBuffer(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function getRandomBytes(len) {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out; // Uint8Array
}

export { stringToBuffer, bufferToString, encodeBuffer, decodeBuffer, getRandomBytes };
