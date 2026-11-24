import mongoose from "mongoose";
import { APOSTROPHES } from "./text";

type Db = InstanceType<typeof mongoose.mongo.Db>;

/**
 * Atlas Search index for the catalog, kept in code ("infrastructure as code"):
 * the server creates it when missing and updates it when this definition changes.
 */
export const BOOK_INDEX = "books";

/** Drop apostrophes, split words, lower-case and fold accents: "Oʻtkan" == "otkan" */
const uzText = {
  name: "uzText",
  charFilters: [{ type: "mapping", mappings: Object.fromEntries(APOSTROPHES.map((a) => [a, ""])) }],
  tokenizer: { type: "standard" },
  tokenFilters: [{ type: "lowercase" }, { type: "icuFolding" }],
};

const text = { type: "string", analyzer: "uzText", searchAnalyzer: "uzText" };
const autocomplete = { type: "autocomplete", analyzer: "uzText", tokenization: "edgeGram", minGrams: 2, maxGrams: 15, foldDiacritics: true };
const token = { type: "token" };

export const BOOK_INDEX_DEFINITION = {
  analyzer: "uzText",
  searchAnalyzer: "uzText",
  analyzers: [uzText],
  mappings: {
    dynamic: false,
    fields: {
      productName: [text, autocomplete],
      productAuthor: [text, autocomplete],
      productDesc: text,
      productPublisher: text,
      productIsbn: token,
      productStatus: token,
      productCollection: token,
      productLanguage: token,
      productShelves: token,
    },
  },
};

export type IndexState = "ready" | "building" | "unavailable";

/** Stable JSON so "same definition" doesn't depend on key order */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

/**
 * Creates or updates the index. Never throws: on a plain MongoDB (no Atlas
 * Search) it reports "unavailable" and the app keeps using the fallback search.
 */
export const ensureBookIndex = async (db: Db): Promise<{ state: IndexState; action: string; detail?: string }> => {
  try {
    const existing = await db.collection("products").aggregate([{ $listSearchIndexes: { name: BOOK_INDEX } }]).toArray();
    const index: any = existing[0];
    if (!index) {
      await db.command({ createSearchIndexes: "products", indexes: [{ name: BOOK_INDEX, definition: BOOK_INDEX_DEFINITION }] });
      return { state: "building", action: "created" };
    }
    if (canonical(index.latestDefinition) !== canonical(BOOK_INDEX_DEFINITION)) {
      await db.command({ updateSearchIndex: "products", name: BOOK_INDEX, definition: BOOK_INDEX_DEFINITION });
      return { state: index.queryable ? "ready" : "building", action: "updated" };
    }
    return { state: index.queryable ? "ready" : "building", action: "unchanged", detail: index.status };
  } catch (err: any) {
    return { state: "unavailable", action: "none", detail: err?.codeName || err?.message?.slice(0, 120) };
  }
};

/** Current state without changing anything */
export const bookIndexState = async (db: Db): Promise<IndexState> => {
  try {
    const [index]: any[] = await db.collection("products").aggregate([{ $listSearchIndexes: { name: BOOK_INDEX } }]).toArray();
    return index ? (index.queryable ? "ready" : "building") : "unavailable";
  } catch {
    return "unavailable";
  }
};
