// client/shims/crypto.js
// Browser shim for Node's "crypto" / "node:crypto" when bundling with Vite.
//
// Goal: support code paths that expect:
// - crypto.webcrypto (WebCrypto API)
// - crypto.getRandomValues
// - crypto.randomBytes (common in Node crypto libs)
//
// IMPORTANT: This is ESM (Vite-friendly).

const webcrypto = globalThis.crypto;

function getRandomValues(arr) {
  return globalThis.crypto.getRandomValues(arr);
}

// Minimal randomBytes implementation using WebCrypto
function randomBytes(n) {
  const a = new Uint8Array(n);
  getRandomValues(a);
  return a;
}

// Provide both named exports and a default export (for maximum compatibility)
export { webcrypto, getRandomValues, randomBytes };

export default {
  webcrypto,
  getRandomValues,
  randomBytes,
};
