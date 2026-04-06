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

  db = client.db("realtime_secure_chat");
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

async function ensureIndexes() {
  const currentDb = getDb();

  await currentDb
    .collection("pending_messages")
    .createIndex({ to: 1, ts: 1 });

  await currentDb
    .collection("certs")
    .createIndex({ username: 1 }, { unique: true });
}

module.exports = {
  connectMongo,
  getDb,
  enqueuePendingMessage,
  getPendingMessagesForUser,
  deletePendingMessagesByIds,
  ensureIndexes,
};
