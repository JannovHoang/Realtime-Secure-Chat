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

async function deletePendingMessagesByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const currentDb = getDb();
  await currentDb.collection("pending_messages").deleteMany({
    _id: { $in: ids },
  });
}

async function saveCert(username, certificate, signatureB64) {
  const currentDb = getDb();
  await currentDb.collection("certs").updateOne(
    { username },
    {
      $set: {
        username,
        certificate,
        signatureB64,
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
    .sort({ username: 1 })
    .toArray();
}

async function saveCiphertextMessage(msgDoc) {
  const currentDb = getDb();
  await currentDb.collection("messages").insertOne(msgDoc);
}

async function saveIdentityBackup(username, backupDoc) {
  const currentDb = getDb();
  const now = new Date();
  await currentDb.collection("identity_backups").updateOne(
    { username },
    {
      $set: {
        username,
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

async function getIdentityBackup(username) {
  const currentDb = getDb();
  return currentDb.collection("identity_backups").findOne({ username });
}

async function ensureIndexes() {
  const currentDb = getDb();

  await currentDb
    .collection("pending_messages")
    .createIndex({ to: 1, ts: 1 });

  await currentDb
    .collection("certs")
    .createIndex({ username: 1 }, { unique: true });

  await currentDb
    .collection("messages")
    .createIndex({ conversationId: 1, ts: 1 });

  await currentDb
    .collection("identity_backups")
    .createIndex({ username: 1 }, { unique: true });
}

module.exports = {
  connectMongo,
  getDb,
  enqueuePendingMessage,
  getPendingMessagesForUser,
  deletePendingMessagesByIds,
  saveCert,
  getAllCerts,
  saveCiphertextMessage,
  saveIdentityBackup,
  getIdentityBackup,
  ensureIndexes,
};
