/**
 * Migration 001: restaurant-template product fields -> book fields.
 *   - removes productSize / productVolume
 *   - fills productAuthor ("Unknown") and productLanguage ("UZ") where missing
 *   - replaces the old unique index (name+size+volume) with the new ones
 *
 * Idempotent. Dry run by default; pass --apply to write.
 * Usage: node scripts/migrations/001-book-fields.js [--apply]
 *   MONGO_URL is read from the environment, falling back to .env
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env"), override: false });
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const OLD_INDEX = "productName_1_productSize_1_productVolume_1";
const DEFAULT_AUTHOR = "Unknown";
const DEFAULT_LANGUAGE = "UZ";

async function main() {
  await mongoose.connect(process.env.MONGO_URL);
  const db = mongoose.connection.db;
  const products = db.collection("products");
  console.log(`Database: ${db.databaseName}  (${APPLY ? "APPLY" : "dry run"})`);

  const needsAuthor = await products.countDocuments({ productAuthor: { $exists: false } });
  const needsLanguage = await products.countDocuments({ productLanguage: { $exists: false } });
  const hasOldFields = await products.countDocuments({
    $or: [{ productSize: { $exists: true } }, { productVolume: { $exists: true } }],
  });
  const indexes = (await products.indexes()).map((index) => index.name);
  console.log({ needsAuthor, needsLanguage, hasOldFields, hasOldIndex: indexes.includes(OLD_INDEX) });

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to write changes.");
    return;
  }

  // Drop the old index first: it would otherwise block nothing, but it is dead weight
  if (indexes.includes(OLD_INDEX)) await products.dropIndex(OLD_INDEX);

  await products.updateMany({ productAuthor: { $exists: false } }, { $set: { productAuthor: DEFAULT_AUTHOR } });
  await products.updateMany({ productLanguage: { $exists: false } }, { $set: { productLanguage: DEFAULT_LANGUAGE } });
  await products.updateMany({}, { $unset: { productSize: "", productVolume: "" } });

  // Same title by "Unknown" twice would break the new unique index: report instead of guessing
  const duplicates = await products
    .aggregate([
      { $group: { _id: { n: "$productName", a: "$productAuthor", l: "$productLanguage" }, ids: { $push: "$_id" }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  if (duplicates.length) {
    console.error("Duplicate name+author+language, fix the authors in admin then re-run:", JSON.stringify(duplicates));
    process.exitCode = 1;
    return;
  }

  await products.createIndex(
    { productName: 1, productAuthor: 1, productLanguage: 1 },
    { unique: true }
  );
  await products.createIndex(
    { productIsbn: 1 },
    { unique: true, partialFilterExpression: { productIsbn: { $type: "string" } } }
  );
  console.log("Done. Indexes:", (await products.indexes()).map((index) => index.name).join(", "));
}

main()
  .catch((err) => {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
