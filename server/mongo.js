require("dotenv").config();

const { MongoClient, ServerApiVersion } = require("mongodb");

let client = null;
let db = null;

const ACTIVE_IDENTITY_SCHEMA_VERSION = 1;
const ACTIVE_IDENTITY_SOURCES = new Set([
  "migration_unlock",
  "restore_latest",
  "create",
  "start_over",
  "backup_active",
]);

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeDeviceLabel(value) {
  const label = normalizeString(value).replace(/\s+/g, " ");
  return label ? label.slice(0, 80) : "Unknown browser";
}

function normalizeActiveIdentitySource(value) {
  const source = normalizeString(value);
  return ACTIVE_IDENTITY_SOURCES.has(source) ? source : "";
}

async function connectMongo() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Missing MONGODB_URI in .env");
  }

  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect();
  await client.db("admin").command({ ping: 1 });

  db = client.db();
  console.log("Mongo connected");
  return db;
}

function getDb() {
  if (!db) {
    throw new Error("Mongo is not connected");
  }
  return db;
}

async function enqueuePendingMessage(to, msgObj, maxPerUser = 500) {
  const currentDb = getDb();
  const pending = currentDb.collection("pending_messages");

  await pending.insertOne({
    to,
    from: msgObj.from,
    senderAccountId: msgObj.senderAccountId || null,
    senderDisplayName: msgObj.senderDisplayName || null,
    recipientAccountId: msgObj.recipientAccountId || null,
    recipientDisplayName: msgObj.recipientDisplayName || null,
    senderIdentityId: msgObj.senderIdentityId || null,
    recipientIdentityId: msgObj.recipientIdentityId || null,
    header: msgObj.header,
    ciphertextB64: msgObj.ciphertextB64,
    ts: msgObj.ts,
  });

  if (!Number.isFinite(maxPerUser) || maxPerUser <= 0) return;

  const overflow = await pending
    .find({ to })
    .sort({ ts: -1, _id: -1 })
    .skip(maxPerUser)
    .project({ _id: 1 })
    .toArray();

  if (overflow.length > 0) {
    await pending.deleteMany({
      _id: { $in: overflow.map((doc) => doc._id) },
    });
  }
}

async function getPendingMessagesForUser(to, limit = 500) {
  const currentDb = getDb();
  return currentDb
    .collection("pending_messages")
    .find({ to })
    .sort({ ts: 1, _id: 1 })
    .limit(limit)
    .toArray();
}

async function getPendingMessagesForUserIdentity(to, identityId, limit = 500) {
  const currentDb = getDb();
  return currentDb
    .collection("pending_messages")
    .find({
      to,
      $or: [
        { recipientIdentityId: identityId },
        { recipientIdentityId: null },
        { recipientIdentityId: { $exists: false } },
      ],
    })
    .sort({ ts: 1, _id: 1 })
    .limit(limit)
    .toArray();
}

async function deletePendingMessagesByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const currentDb = getDb();
  await currentDb.collection("pending_messages").deleteMany({
    _id: { $in: ids },
  });
}

async function saveCert(username, identityId, certificate, signatureB64) {
  const currentDb = getDb();
  await currentDb.collection("certs").updateOne(
    { username, identityId },
    {
      $set: {
        username,
        identityId,
        certificate,
        signatureB64,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

async function getAllCerts() {
  const currentDb = getDb();
  return currentDb
    .collection("certs")
    .find({})
    .sort({ username: 1, updatedAt: -1, identityId: 1 })
    .toArray();
}

async function saveCiphertextMessage(msgDoc) {
  const currentDb = getDb();
  await currentDb.collection("messages").insertOne(msgDoc);
}

async function getRecentMessagesForConversation(conversationId, limit = 50) {
  const currentDb = getDb();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const docs = await currentDb
    .collection("messages")
    .find({ conversationId })
    .sort({ ts: -1, _id: -1 })
    .limit(safeLimit)
    .toArray();

  return docs.reverse();
}

async function saveIdentityBackup(username, backupDoc) {
  const currentDb = getDb();
  const now = new Date();
  const serverSavedAt = now.toISOString();
  await currentDb.collection("identity_backups").updateOne(
    { username, identityId: backupDoc.identityId },
    {
      $set: {
        username,
        accountId: backupDoc.accountId || null,
        displayName: backupDoc.displayName || username,
        accountIdScheme: backupDoc.accountIdScheme || null,
        authMode: backupDoc.authMode || "legacy",
        firebaseUid: backupDoc.firebaseUid || null,
        identityId: backupDoc.identityId,
        version: backupDoc.version,
        clientSavedAt: backupDoc.clientSavedAt || null,
        serverSavedAt,
        ciphertextB64: backupDoc.ciphertextB64,
        ivB64: backupDoc.ivB64,
        saltB64: backupDoc.saltB64,
        kdf: backupDoc.kdf,
        recoveryWrapper:
          backupDoc.recoveryWrapper && typeof backupDoc.recoveryWrapper === "object"
            ? backupDoc.recoveryWrapper
            : null,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return {
    username,
    accountId: backupDoc.accountId || null,
    displayName: backupDoc.displayName || username,
    accountIdScheme: backupDoc.accountIdScheme || null,
    authMode: backupDoc.authMode || "legacy",
    firebaseUid: backupDoc.firebaseUid || null,
    identityId: backupDoc.identityId,
    backupVersion: backupDoc.version,
    clientSavedAt: backupDoc.clientSavedAt || null,
    serverSavedAt,
    hasRecoveryKey: !!backupDoc.recoveryWrapper,
  };
}

function buildBackupOwnerQuery(username, owner = null) {
  const query = { username };
  if (owner?.firebaseUid) {
    query.firebaseUid = owner.firebaseUid;
    query.authMode = "firebase";
  }
  return query;
}

async function getIdentityBackup(username, identityId = null, owner = null) {
  const currentDb = getDb();
  const query = buildBackupOwnerQuery(username, owner);
  if (identityId) {
    return currentDb.collection("identity_backups").findOne({ ...query, identityId });
  }

  return currentDb
    .collection("identity_backups")
    .find(query)
    .sort({ updatedAt: -1, createdAt: -1, identityId: 1 })
    .limit(1)
    .next();
}

async function listIdentityBackups(username, owner = null) {
  const currentDb = getDb();
  const query = buildBackupOwnerQuery(username, owner);
  return currentDb
    .collection("identity_backups")
    .find(query)
    .project({
      _id: 0,
      username: 1,
      accountId: 1,
      displayName: 1,
      accountIdScheme: 1,
      authMode: 1,
      firebaseUid: 1,
      identityId: 1,
      version: 1,
      clientSavedAt: 1,
      serverSavedAt: 1,
      recoveryWrapper: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .sort({ updatedAt: -1, createdAt: -1, identityId: 1 })
    .toArray();
}

async function saveAccountActiveDevice(username, activeIdentityId, accountMeta = {}) {
  const currentDb = getDb();
  const now = new Date();
  const accountId =
    typeof accountMeta.accountId === "string" && accountMeta.accountId.trim()
      ? accountMeta.accountId.trim()
      : null;
  const displayName =
    typeof accountMeta.displayName === "string" && accountMeta.displayName.trim()
      ? accountMeta.displayName.trim()
      : username;
  const authMode =
    typeof accountMeta.authMode === "string" && accountMeta.authMode.trim()
      ? accountMeta.authMode.trim()
      : "legacy";
  const firebaseUid =
    typeof accountMeta.firebaseUid === "string" && accountMeta.firebaseUid.trim()
      ? accountMeta.firebaseUid.trim()
      : null;
  const accountIdSource =
    typeof accountMeta.accountIdSource === "string" && accountMeta.accountIdSource.trim()
      ? accountMeta.accountIdSource.trim()
      : accountId
        ? "client_legacy"
        : "none";
  const deviceLabel =
    typeof accountMeta.deviceLabel === "string" && accountMeta.deviceLabel.trim()
      ? accountMeta.deviceLabel.trim().slice(0, 80)
      : "Unknown browser";
  const connectedAt =
    typeof accountMeta.connectedAt === "string" && accountMeta.connectedAt.trim()
      ? accountMeta.connectedAt.trim()
      : null;
  await currentDb.collection("account_active_devices").updateOne(
    { username },
    {
      $set: {
        username,
        accountId,
        displayName,
        activeIdentityId,
        authMode,
        firebaseUid,
        accountIdSource,
        deviceLabel,
        connectedAt,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

async function getAccountActiveDevice(username) {
  const currentDb = getDb();
  return currentDb.collection("account_active_devices").findOne({ username });
}

function toSafeActiveIdentityDoc(doc) {
  if (!doc) return null;
  return {
    schemaVersion: Number(doc.schemaVersion || ACTIVE_IDENTITY_SCHEMA_VERSION),
    accountId: doc.accountId || "",
    firebaseUid: doc.firebaseUid || null,
    activeIdentityId: doc.activeIdentityId || "",
    activeRevision: Number(doc.activeRevision || 0),
    displayName: doc.displayName || "",
    deviceLabel: doc.deviceLabel || "Unknown browser",
    source: doc.source || "",
    serverUpdatedAt:
      doc.serverUpdatedAt instanceof Date
        ? doc.serverUpdatedAt.toISOString()
        : doc.serverUpdatedAt || null,
    createdAt:
      doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt || null,
    updatedAt:
      doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt || null,
  };
}

async function getAccountActiveIdentity(accountId) {
  const normalizedAccountId = normalizeString(accountId);
  if (!normalizedAccountId) return null;

  const currentDb = getDb();
  const doc = await currentDb
    .collection("account_active_identities")
    .findOne({ accountId: normalizedAccountId });
  return toSafeActiveIdentityDoc(doc);
}

async function saveAccountActiveIdentity(accountMeta = {}) {
  const accountId = normalizeString(accountMeta.accountId);
  const activeIdentityId = normalizeString(accountMeta.activeIdentityId);
  const source = normalizeActiveIdentitySource(accountMeta.source);

  if (!accountId) {
    throw new Error("accountId is required for active identity metadata");
  }
  if (!activeIdentityId) {
    throw new Error("activeIdentityId is required for active identity metadata");
  }
  if (!source) {
    throw new Error("valid active identity source is required");
  }

  const currentDb = getDb();
  const collection = currentDb.collection("account_active_identities");
  const now = new Date();
  const existing = await collection.findOne({ accountId });
  const existingRevision = Number(existing?.activeRevision || 0);
  const identityChanged = existing?.activeIdentityId !== activeIdentityId;
  const shouldIncrementRevision = !existing || identityChanged;
  const activeRevision = shouldIncrementRevision
    ? existingRevision + 1
    : Math.max(existingRevision, 1);

  const doc = {
    schemaVersion: ACTIVE_IDENTITY_SCHEMA_VERSION,
    accountId,
    firebaseUid: normalizeString(accountMeta.firebaseUid) || null,
    activeIdentityId,
    activeRevision,
    displayName: normalizeString(accountMeta.displayName),
    deviceLabel: normalizeDeviceLabel(accountMeta.deviceLabel),
    source,
    serverUpdatedAt: now,
    updatedAt: now,
  };

  await collection.updateOne(
    { accountId },
    {
      $set: doc,
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return getAccountActiveIdentity(accountId);
}

async function dropLegacyUniqueIndexIfPresent(collection, indexName) {
  try {
    const indexes = await collection.indexes();
    const found = indexes.find((idx) => idx.name === indexName);
    if (!found) return;
    await collection.dropIndex(indexName);
  } catch {
    // Ignore when the index does not exist or cannot be dropped yet.
  }
}

async function ensureIndexes() {
  const currentDb = getDb();

  await currentDb
    .collection("pending_messages")
    .createIndex({ to: 1, ts: 1 });
  await currentDb
    .collection("pending_messages")
    .createIndex({ to: 1, recipientIdentityId: 1, ts: 1 });

  const certs = currentDb.collection("certs");
  const backups = currentDb.collection("identity_backups");
  const activeDevices = currentDb.collection("account_active_devices");
  const activeIdentities = currentDb.collection("account_active_identities");

  await dropLegacyUniqueIndexIfPresent(certs, "username_1");
  await certs.createIndex({ username: 1, identityId: 1 }, { unique: true });

  await currentDb
    .collection("messages")
    .createIndex({ conversationId: 1, ts: 1 });

  await dropLegacyUniqueIndexIfPresent(backups, "username_1");
  await backups.createIndex({ username: 1, identityId: 1 }, { unique: true });
  await backups.createIndex(
    { firebaseUid: 1, username: 1, identityId: 1 },
    { sparse: true }
  );

  await activeDevices.createIndex({ username: 1 }, { unique: true });
  await activeDevices.createIndex(
    { accountId: 1 },
    { sparse: true }
  );

  await activeIdentities.createIndex({ accountId: 1 }, { unique: true });
  await activeIdentities.createIndex(
    { firebaseUid: 1 },
    { sparse: true }
  );
  await activeIdentities.createIndex({ activeIdentityId: 1 });
}

module.exports = {
  connectMongo,
  getDb,
  enqueuePendingMessage,
  getPendingMessagesForUser,
  getPendingMessagesForUserIdentity,
  deletePendingMessagesByIds,
  saveCert,
  getAllCerts,
  saveCiphertextMessage,
  getRecentMessagesForConversation,
  saveIdentityBackup,
  getIdentityBackup,
  listIdentityBackups,
  saveAccountActiveDevice,
  getAccountActiveDevice,
  saveAccountActiveIdentity,
  getAccountActiveIdentity,
  ensureIndexes,
};
