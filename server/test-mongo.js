const { connectMongo, getDb } = require("./mongo");

(async () => {
  try {
    await connectMongo();
    const db = getDb();

    const result = await db.collection("test_connection").insertOne({
      message: "hello mongo atlas",
      createdAt: new Date(),
    });

    console.log("Insert OK:", result.insertedId);

    const docs = await db.collection("test_connection").find({}).toArray();
    console.log("Docs:", docs);

    process.exit(0);
  } catch (err) {
    console.error("Mongo test failed:", err);
    process.exit(1);
  }
})();
