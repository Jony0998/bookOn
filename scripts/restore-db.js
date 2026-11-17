/**
 * Restore a backup made by scripts/backup-db.js into the database in MONGO_URL.
 * Every collection found in the backup is REPLACED.
 *
 * Usage: node scripts/restore-db.js <backupDir> [--production]
 *   Refuses to write to the production database name ("BookOn") unless
 *   --production is passed explicitly.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), override: false });
const mongoose = require("mongoose");
const { EJSON } = mongoose.mongo.BSON;

const PRODUCTION_DB = "BookOn";

async function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) throw new Error("Usage: node scripts/restore-db.js <backupDir>");

  await mongoose.connect(process.env.MONGO_URL);
  const db = mongoose.connection.db;
  if (db.databaseName === PRODUCTION_DB && !process.argv.includes("--production"))
    throw new Error(`Refusing to overwrite the production database "${PRODUCTION_DB}"`);
  console.log(`Restoring ${dir} -> ${db.databaseName}`);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".indexes.json"));
  for (const file of files) {
    const name = path.basename(file, ".json");
    const docs = EJSON.parse(fs.readFileSync(path.join(dir, file), "utf8"), { relaxed: false });
    const collection = db.collection(name);
    await collection.drop().catch(() => {}); // drops indexes too

    const indexFile = path.join(dir, `${name}.indexes.json`);
    if (fs.existsSync(indexFile)) {
      for (const { key, name: indexName, v, ns, ...options } of JSON.parse(fs.readFileSync(indexFile, "utf8"))) {
        if (indexName !== "_id_") await collection.createIndex(key, { name: indexName, ...options });
      }
    }
    if (docs.length) await collection.insertMany(docs);
    console.log(`  ${name}: ${docs.length} docs`);
  }
}

main()
  .catch((err) => {
    console.error("Restore failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
