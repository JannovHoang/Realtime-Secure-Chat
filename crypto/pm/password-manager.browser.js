// crypto/pm/password-manager.browser.js
"use strict";

/********* Imports (Browser) ********/
import {
  stringToBuffer,
  bufferToString,
  encodeBuffer,
  decodeBuffer,
  getRandomBytes,
} from "./lib.browser.js";

const { subtle } = crypto;

/********* Constants ********/
const PBKDF2_ITERATIONS = 100000;
const MAX_PASSWORD_LENGTH = 64;

class Keychain {
  constructor(kvs = {}, salt = null, masterBits = null, aesKey = null, domainKey = null) {
    this.data = { kvs, salt };
    this.secrets = { masterBits, aesKey, domainKey };
  }

  static async _deriveMasterBits(password, saltBuf) {
    const keyMaterial = await subtle.importKey(
      "raw",
      stringToBuffer(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    return await subtle.deriveBits(
      { name: "PBKDF2", salt: saltBuf, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      keyMaterial,
      256
    );
  }

  static async _importHmacKey(rawBuf) {
    return await subtle.importKey(
      "raw",
      rawBuf,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }

  static async _importAesKey(rawBuf) {
    return await subtle.importKey(
      "raw",
      rawBuf,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  static async _hmacRaw(hmacKey, dataString) {
    return await subtle.sign("HMAC", hmacKey, stringToBuffer(dataString));
  }

  _padPassword(buf) {
    const raw = new Uint8Array(buf);
    if (raw.length > MAX_PASSWORD_LENGTH) throw new Error("Password too long");
    const out = new Uint8Array(MAX_PASSWORD_LENGTH);
    out.set(raw);
    return out.buffer;
  }

  _unpadPassword(buf) {
    const raw = new Uint8Array(buf);
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) end--;
    return raw.slice(0, end).buffer;
  }

  static async init(password) {
    const saltBuf = getRandomBytes(16);
    const saltB64 = encodeBuffer(saltBuf);

    const masterBits = await this._deriveMasterBits(password, saltBuf);
    const masterHmacKey = await this._importHmacKey(masterBits);

    const encRaw = await this._hmacRaw(masterHmacKey, "enc");
    const domainRaw = await this._hmacRaw(masterHmacKey, "domain");

    const aesKey = await this._importAesKey(encRaw);
    const domainKey = await this._importHmacKey(domainRaw);

    return new Keychain({}, saltB64, masterBits, aesKey, domainKey);
  }

  static async load(password, repr, trustedDataCheck) {
    const obj = JSON.parse(repr);

    if (trustedDataCheck) {
      const digest = await subtle.digest("SHA-256", stringToBuffer(repr));
      const digestB64 = encodeBuffer(digest);
      if (digestB64 !== trustedDataCheck) throw new Error("Integrity check failed");
    }

    const saltBuf = decodeBuffer(obj.salt);

    let masterBits;
    try {
      masterBits = await this._deriveMasterBits(password, saltBuf);
    } catch {
      throw new Error("Incorrect password");
    }

    const masterHmacKey = await this._importHmacKey(masterBits);
    const encRaw = await this._hmacRaw(masterHmacKey, "enc");
    const domainRaw = await this._hmacRaw(masterHmacKey, "domain");

    const aesKey = await this._importAesKey(encRaw);
    const domainKey = await this._importHmacKey(domainRaw);

    // password verification step (only if kvs not empty)
    const kvsKeys = Object.keys(obj.kvs || {});
    if (kvsKeys.length > 0) {
      const lookup = kvsKeys[0];
      const rec = obj.kvs[lookup];
      try {
        await subtle.decrypt(
          {
            name: "AES-GCM",
            iv: decodeBuffer(rec.iv),
            additionalData: decodeBuffer(lookup),
            tagLength: 128,
          },
          aesKey,
          decodeBuffer(rec.ciphertext)
        );
      } catch {
        throw new Error("Incorrect password");
      }
    }

    return new Keychain(obj.kvs || {}, obj.salt, masterBits, aesKey, domainKey);
  }

  async dump() {
    const data = { kvs: this.data.kvs, salt: this.data.salt };
    const repr = JSON.stringify(data);

    const digest = await subtle.digest("SHA-256", stringToBuffer(repr));
    const digestB64 = encodeBuffer(digest);

    return [repr, digestB64];
  }

  async get(name) {
    const rawLookup = await Keychain._hmacRaw(this.secrets.domainKey, name);
    const lookup = encodeBuffer(rawLookup);

    if (!(lookup in this.data.kvs)) return null;

    const rec = this.data.kvs[lookup];

    const pt = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBuffer(rec.iv),
        additionalData: rawLookup,
        tagLength: 128,
      },
      this.secrets.aesKey,
      decodeBuffer(rec.ciphertext)
    );

    return bufferToString(this._unpadPassword(pt));
  }

  async set(name, value) {
    const rawLookup = await Keychain._hmacRaw(this.secrets.domainKey, name);
    const lookup = encodeBuffer(rawLookup);

    const padded = this._padPassword(stringToBuffer(value));
    const iv = getRandomBytes(12);

    const ciphertext = await subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: rawLookup,
        tagLength: 128,
      },
      this.secrets.aesKey,
      padded
    );

    this.data.kvs[lookup] = {
      iv: encodeBuffer(iv),
      ciphertext: encodeBuffer(ciphertext),
    };
  }

  async remove(name) {
    const rawLookup = await Keychain._hmacRaw(this.secrets.domainKey, name);
    const lookup = encodeBuffer(rawLookup);

    if (lookup in this.data.kvs) {
      delete this.data.kvs[lookup];
      return true;
    }
    return false;
  }
}

export { Keychain };
