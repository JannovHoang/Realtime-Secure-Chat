require("dotenv").config();

const { MongoClient, ServerApiVersion } = require("mongodb");

let client = null;
let db = null;

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
  await currentDb.collection("identity_backups").updateOne(
    { username, identityId: backupDoc.identityId },
    {
      $set: {
        username,
        identityId: backupDoc.identityId,
        version: backupDoc.version,
        ciphertextB64: backupDoc.ciphertextB64,
        ivB64: backupDoc.ivB64,
        saltB64: backupDoc.saltB64,
        kdf: backupDoc.kdf,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

async function getIdentityBackup(username, identityId = null) {
  const currentDb = getDb();
  if (identityId) {
    return currentDb.collection("identity_backups").findOne({ username, identityId });
  }

  return currentDb
    .collection("identity_backups")
    .find({ username })
    .sort({ updatedAt: -1, createdAt: -1, identityId: 1 })
    .limit(1)
    .next();
}

async function listIdentityBackups(username) {
  const currentDb = getDb();
  return currentDb
    .collection("identity_backups")
    .find({ username })
    .project({ _id: 0, username: 1, identityId: 1, createdAt: 1, updatedAt: 1 })
    .sort({ updatedAt: -1, createdAt: -1, identityId: 1 })
    .toArray();
}

async function saveAccountActiveDevice(username, activeIdentityId) {
  const currentDb = getDb();
  const now = new Date();
  await currentDb.collection("account_active_devices").updateOne(
    { username },
    {
      $set: {
        username,
        activeIdentityId,
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

  await dropLegacyUniqueIndexIfPresent(certs, "username_1");
  await certs.createIndex({ username: 1, identityId: 1 }, { unique: true });

  await currentDb
    .collection("messages")
    .createIndex({ conversationId: 1, ts: 1 });

  await dropLegacyUniqueIndexIfPresent(backups, "username_1");
  await backups.createIndex({ username: 1, identityId: 1 }, { unique: true });

  await activeDevices.createIndex({ username: 1 }, { unique: true });
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
  ensureIndexes,
};
