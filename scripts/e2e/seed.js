/**
 * Minimal data the e2e scripts expect, for an empty test database (CI starts
 * with a fresh MongoDB): one library account, a book on sale, a paused book
 * and a reader with an email. Adds only what is missing; never runs outside
 * a "*_test" database.
 *
 * Usage: MONGO_URL=<...>/BookOn_test node scripts/e2e/seed.js
 */
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const { requireTestDb } = require("./harness");

(async () => {
  const db = await requireTestDb();
  const members = db.collection("members");
  const products = db.collection("products");
  const now = new Date();
  const added = [];

  if (!(await members.findOne({ memberType: "LIBRARY" }))) {
    await members.insertOne({
      memberType: "LIBRARY",
      memberStatus: "ACTIVE",
      memberNick: "SeedLibrary",
      memberEmail: "library@example.com",
      memberEmailVerified: true,
      memberPassword: await bcrypt.hash("seed-library-1", 10),
      memberAddress: "Toshkent",
      memberPoints: 0,
      createdAt: now,
      updatedAt: now,
    });
    added.push("library");
  }
  if (!(await members.findOne({ memberType: "USER", memberEmail: { $exists: true } }))) {
    await members.insertOne({
      memberType: "USER",
      memberStatus: "ACTIVE",
      memberNick: "seed_reader",
      memberEmail: "reader@example.com",
      memberEmailVerified: true,
      memberPassword: await bcrypt.hash("seed-reader-1", 10),
      memberPoints: 0,
      createdAt: now,
      updatedAt: now,
    });
    added.push("reader");
  }

  const book = (name, author, status, extra = {}) => ({
    productStatus: status,
    productCollection: "FICTION",
    productName: name,
    productAuthor: author,
    productPrice: 12,
    productLeftCount: 20,
    productLanguage: "UZ",
    productShelves: ["UZBEK_LIT"],
    productDesc: "Seed book for automated tests.",
    productImages: [],
    productViews: 0,
    productLikes: 0,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  if (!(await products.findOne({ productStatus: "PROCESS" }))) {
    await products.insertMany([book("Oʻtkan kunlar", "Abdulla Qodiriy", "PROCESS"), book("Shum bola", "Gʻafur Gʻulom", "PROCESS", { productPrice: 9 })]);
    added.push("books on sale");
  }
  if (!(await products.findOne({ productStatus: "PAUSE" }))) {
    await products.insertOne(book("Mehrobdan chayon", "Abdulla Qodiriy", "PAUSE"));
    added.push("paused book");
  }

  console.log(added.length ? `Seeded: ${added.join(", ")}` : "Seed: nothing missing");
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.disconnect();
  process.exit(1);
});
