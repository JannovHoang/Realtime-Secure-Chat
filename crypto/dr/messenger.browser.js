// crypto/dr/messenger.browser.js
'use strict'

import {
  bufferToString,
  genRandomSalt,
  generateEG,
  computeDH,
  verifyWithECDSA,
  HMACtoAESKey,
  HMACtoHMACKey,
  HKDF,
  encryptWithGCM,
  decryptWithGCM,
  cryptoKeyToJSON,
  govEncryptionDataStr,
  _abToB64,
  _b64ToAb
} from './lib.browser.js'

const { subtle } = crypto

// ---- helpers for state persistence ----
const abToB64 = (ab) => _abToB64(ab)
const b64ToAb = (b64) => _b64ToAb(b64)

async function exportRawKeyB64 (key) {
  if (!key) return null
  const raw = await subtle.exportKey('raw', key)
  return abToB64(raw)
}
async function importHmacKeyFromB64 (b64) {
  if (!b64) return null
  const raw = b64ToAb(b64)
  return await subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign', 'verify']
  )
}
async function importAesKeyFromB64 (b64) {
  if (!b64) return null
  const raw = b64ToAb(b64)
  return await subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt'])
}

class MessengerClient {
  constructor (certAuthorityPublicKey, govPublicKey) {
    this.caPublicKey = certAuthorityPublicKey
    this.govPublicKey = govPublicKey

    this.conns = {}
    this.certs = {}
    this.EGKeyPair = {}
  }

  async generateCertificate (username) {
    this.EGKeyPair = await generateEG()
    const certificate = {
      username: username,
      pub: await cryptoKeyToJSON(this.EGKeyPair.pub)
    }
    return certificate
  }

  async receiveCertificate (certificate, signature) {
    const certString = JSON.stringify(certificate)
    const ok = await verifyWithECDSA(this.caPublicKey, certString, signature)
    if (!ok) throw 'Invalid certificate signature'
    this.certs[certificate.username] = certificate
  }

  async _initConn (name) {
    if (this.conns[name]) return

    const cert = this.certs[name]
    if (!cert) throw `No certificate for ${name}`

    const peerPubKey = await subtle.importKey(
      'jwk',
      cert.pub,
      { name: 'ECDH', namedCurve: 'P-384' },
      true,
      []
    )

    const shared = await computeDH(this.EGKeyPair.sec, peerPubKey)
    const rootKey = await HMACtoHMACKey(shared, 'root')

    this.conns[name] = {
      rootKey: rootKey,
      sendKey: null,
      recvKey: null,
      sendCount: 0,
      recvCount: 0,
      peerPub: peerPubKey,
      peerPubJwk: cert.pub,
      skipped: new Map(),   // id -> { mkRawB64, mkCrypto }
      lastSeen: new Set()
    }
  }

  async _dhRatchet (name, newPubKey, newPubJwk = null) {
    const st = this.conns[name]
    const shared = await computeDH(this.EGKeyPair.sec, newPubKey)
    const [newRoot, newRecv] = await HKDF(st.rootKey, shared, 'ratchet')

    st.rootKey = newRoot
    st.recvKey = newRecv
    st.recvCount = 0
    st.peerPub = newPubKey
    if (newPubJwk) st.peerPubJwk = newPubJwk
    st.sendKey = null

    st.skipped = new Map()
  }

  async _ensureSendChain (name) {
    const st = this.conns[name]
    if (st.sendKey) return
    const [newRoot, newSend] = await HKDF(st.rootKey, st.rootKey, 'send')
    st.rootKey = newRoot
    st.sendKey = newSend
  }

  async _deriveRecvKeysUpTo (st, targetCount) {
    while (st.recvCount < targetCount) {
      const mkRaw = await HMACtoAESKey(st.recvKey, 'mk', true)
      const mkRawB64 = abToB64(mkRaw)
      const mkCrypto = await subtle.importKey('raw', mkRaw, 'AES-GCM', true, ['encrypt', 'decrypt'])

      const idx = st.recvCount + 1
      const id = `${JSON.stringify(st.peerPubJwk)}|${idx}`
      st.skipped.set(id, { mkRawB64, mkCrypto })

      st.recvKey = await HMACtoHMACKey(st.recvKey, 'next')
      st.recvCount += 1
    }
  }

  async sendMessage (name, plaintext) {
    await this._initConn(name)
    const st = this.conns[name]
    await this._ensureSendChain(name)

    st.sendCount += 1

    const senderPubJwk = await cryptoKeyToJSON(this.EGKeyPair.pub)
    const header = {
      pub: senderPubJwk,
      count: st.sendCount,
      vGovJwk: st.peerPubJwk
    }

    Object.defineProperty(header, 'vGov', { value: this.EGKeyPair.pub, enumerable: false, writable: false })

    const chainKey = st.sendKey
    const mkRaw = await HMACtoAESKey(chainKey, 'mk', true)

    const sharedForGov = await computeDH(this.EGKeyPair.sec, this.govPublicKey)
    const govAesKey = await HMACtoAESKey(sharedForGov, govEncryptionDataStr)
    const ivGov = genRandomSalt(12)
    const cGov = await encryptWithGCM(govAesKey, mkRaw, ivGov)

    Object.defineProperty(header, 'cGov', { value: cGov, enumerable: false, writable: false })
    Object.defineProperty(header, 'ivGov', { value: ivGov, enumerable: false, writable: false })
    header.cGov_b64 = _abToB64(cGov)
    header.ivGov_b64 = _abToB64(ivGov)

    const receiverIV = genRandomSalt(12)
    Object.defineProperty(header, 'receiverIV', { value: receiverIV, enumerable: false, writable: false })
    header.receiverIV_b64 = _abToB64(receiverIV)

    const aadJson = JSON.stringify(header)
    const subtleMK = await subtle.importKey('raw', mkRaw, 'AES-GCM', true, ['encrypt', 'decrypt'])
    const ct = await encryptWithGCM(subtleMK, plaintext, receiverIV, aadJson)

    st.sendKey = await HMACtoHMACKey(chainKey, 'next')

    return [header, ct]
  }

  async receiveMessage (name, [header, ciphertext]) {
    await this._initConn(name)
    const st = this.conns[name]

    const senderPubStr = JSON.stringify(header.pub)
    const replayTag = `${header.count}|${senderPubStr}`
    if (st.lastSeen.has(replayTag)) throw 'Replay detected'
    st.lastSeen.add(replayTag)

    const senderPub = await subtle.importKey(
      'jwk',
      header.pub,
      { name: 'ECDH', namedCurve: 'P-384' },
      true,
      []
    )

    if (!st.peerPubJwk || JSON.stringify(st.peerPubJwk) !== JSON.stringify(header.pub)) {
      await this._dhRatchet(name, senderPub, header.pub)
    }

    if (!st.recvKey) {
      const [newRoot, newRecv] = await HKDF(st.rootKey, st.rootKey, 'send')
      st.rootKey = newRoot
      st.recvKey = newRecv
      st.recvCount = 0
    }

    const targetIdx = header.count
    if (st.recvCount < targetIdx) {
      await this._deriveRecvKeysUpTo(st, targetIdx)
    }

    const id = `${JSON.stringify(st.peerPubJwk)}|${targetIdx}`
    let mkEntry = st.skipped.get(id)
    if (!mkEntry) {
      const mkRaw = await HMACtoAESKey(st.recvKey, 'mk', true)
      const mkRawB64 = abToB64(mkRaw)
      const mkCrypto = await subtle.importKey('raw', mkRaw, 'AES-GCM', true, ['encrypt', 'decrypt'])
      mkEntry = { mkRawB64, mkCrypto }

      st.recvKey = await HMACtoHMACKey(st.recvKey, 'next')
      st.recvCount += 1
    } else {
      st.skipped.delete(id)
    }

    const aadJson = JSON.stringify(header)

    const receiverIV =
      header.receiverIV ||
      (header.receiverIV_b64 ? new Uint8Array(_b64ToAb(header.receiverIV_b64)) : null)

    if (!receiverIV) throw 'Missing receiver IV'

    const ptBuf = await decryptWithGCM(mkEntry.mkCrypto, ciphertext, receiverIV, aadJson)
    return bufferToString(ptBuf)
  }

  // ===================== NEW: persist / restore state =====================

  async exportState () {
    const egPubJwk = this.EGKeyPair?.pub ? await cryptoKeyToJSON(this.EGKeyPair.pub) : null
    const egSecJwk = this.EGKeyPair?.sec ? await subtle.exportKey('jwk', this.EGKeyPair.sec) : null

    const connsOut = {}
    for (const [peer, st] of Object.entries(this.conns)) {
      const skippedArr = []
      for (const [id, entry] of st.skipped.entries()) {
        skippedArr.push({ id, mkRawB64: entry.mkRawB64 })
      }

      connsOut[peer] = {
        rootKeyB64: await exportRawKeyB64(st.rootKey),
        sendKeyB64: await exportRawKeyB64(st.sendKey),
        recvKeyB64: await exportRawKeyB64(st.recvKey),
        sendCount: st.sendCount,
        recvCount: st.recvCount,
        peerPubJwk: st.peerPubJwk,
        lastSeen: Array.from(st.lastSeen),
        skipped: skippedArr
      }
    }

    return {
      v: 1,
      certs: this.certs,
      egPubJwk,
      egSecJwk,
      conns: connsOut
    }
  }

  async importState (state) {
    if (!state || state.v !== 1) throw new Error('Bad state version')

    this.certs = state.certs || {}

    if (state.egPubJwk && state.egSecJwk) {
      const pub = await subtle.importKey('jwk', state.egPubJwk, { name: 'ECDH', namedCurve: 'P-384' }, true, [])
      const sec = await subtle.importKey('jwk', state.egSecJwk, { name: 'ECDH', namedCurve: 'P-384' }, true, ['deriveKey'])
      this.EGKeyPair = { pub, sec }
    }

    this.conns = {}

    const connsIn = state.conns || {}
    for (const [peer, stIn] of Object.entries(connsIn)) {
      const peerPub = await subtle.importKey(
        'jwk',
        stIn.peerPubJwk,
        { name: 'ECDH', namedCurve: 'P-384' },
        true,
        []
      )

      const st = {
        rootKey: await importHmacKeyFromB64(stIn.rootKeyB64),
        sendKey: await importHmacKeyFromB64(stIn.sendKeyB64),
        recvKey: await importHmacKeyFromB64(stIn.recvKeyB64),
        sendCount: Number(stIn.sendCount || 0),
        recvCount: Number(stIn.recvCount || 0),
        peerPub,
        peerPubJwk: stIn.peerPubJwk,
        skipped: new Map(),
        lastSeen: new Set(Array.isArray(stIn.lastSeen) ? stIn.lastSeen : [])
      }

      // rebuild skipped MK entries
      const skipped = Array.isArray(stIn.skipped) ? stIn.skipped : []
      for (const it of skipped) {
        if (!it?.id || !it?.mkRawB64) continue
        const mkCrypto = await importAesKeyFromB64(it.mkRawB64)
        st.skipped.set(it.id, { mkRawB64: it.mkRawB64, mkCrypto })
      }

      this.conns[peer] = st
    }
  }
}

export { MessengerClient }
