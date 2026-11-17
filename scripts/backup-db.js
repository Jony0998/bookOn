/**
 * Read-only MongoDB backup: dumps every collection to <outDir>/<name>.json
 * as canonical Extended JSON (keeps ObjectId/Date types for an exact restore).
 *
 * Usage: node scripts/backup-db.js [outDir]
 *   MONGO_URL is read from the environment, falling back to .env
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: false });
const mongoose = require("mongoose");
// bson is not a direct dependency; use the copy bundled with the mongoose driver
const { EJSON } = mongoose.mongo.BSON;

async function main() {
  const url = process.env.MONGO_URL;
  if (!url) throw new Error("MONGO_URL is not set");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(process.argv[2] || path.join(require("os").homedir(), "BookOn-backups", `ejson-${stamp}`));
  fs.mkdirSync(outDir, { recursive: true });

  await mongoose.connect(url);
  const db = mongoose.connection.db;
  console.log(`Database: ${db.databaseName} -> ${outDir}`);

  const collections = await db.listCollections().toArray();
  for (const { name } of collections) {
    const docs = await db.collection(name).find({}).toArray();
    const indexes = await db.collection(name).indexes();
    fs.writeFileSync(path.join(outDir, `${name}.json`), EJSON.stringify(docs, null, 2, { relaxed: false }));
    fs.writeFileSync(path.join(outDir, `${name}.indexes.json`), JSON.stringify(indexes, null, 2));
    console.log(`  ${name}: ${docs.length} docs`);
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Backup failed:", err.message);
  process.exit(1);
});
