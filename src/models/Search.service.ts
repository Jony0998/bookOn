import mongoose from "mongoose";
import ProductModel from "../schema/Product.model";
import { ProductStatus } from "../libs/types/enums/product.enum";
import { T } from "../libs/types/common";
import { BOOK_INDEX, IndexState, bookIndexState } from "../libs/search/books-index";
import { apostropheInsensitiveRegex, queryVariants } from "../libs/search/text";

export type SearchEngine = "atlas" | "fallback";

export interface BookSearch {
  query: string;
  productCollection?: string;
  productLanguage?: string;
  shelf?: string;
  /** "relevance" or a product field to sort by */
  order: string;
  skip: number;
  limit: number;
}

const STATE_TTL_MS = 60_000;
/** Suggestions scoring below this share of the best one are dropped */
const SUGGEST_MIN_SHARE = 0.35;
const SUGGEST_FIELDS = { productName: 1, productAuthor: 1, productImages: { $slice: ["$productImages", 1] }, productPrice: 1, productDiscountPrice: 1, productLanguage: 1 };

/**
 * Book search with Atlas Search (typo-tolerant, prefix suggestions, relevance)
 * and a fallback for databases without it (plain MongoDB in CI / locally, or
 * while the index is still building). Both understand Latin/Cyrillic and
 * apostrophe variants (see libs/search/text.ts).
 */
class SearchService {
  private state: IndexState | null = null;
  private checkedAt = 0;

  /** Which engine answers right now (index state cached for a minute) */
  public async engine(): Promise<SearchEngine> {
    // SEARCH_ENGINE=fallback switches Atlas Search off (tests, emergencies)
    if (process.env.SEARCH_ENGINE === "fallback") return "fallback";
    if (!this.state || Date.now() - this.checkedAt > STATE_TTL_MS) {
      const db = mongoose.connection.db;
      this.state = db ? await bookIndexState(db) : "unavailable";
      this.checkedAt = Date.now();
    }
    return this.state === "ready" ? "atlas" : "fallback";
  }

  /** After a failed $search, stop trying it until the next state check */
  private markUnavailable() {
    this.state = "unavailable";
    this.checkedAt = Date.now();
  }

  /** Atlas Search query: exact phrase > prefix of title/author > fuzzy words > description */
  private atlasStage(variants: string[], filters: T, forSuggest = false) {
    const should: T[] = [];
    for (const v of variants) {
      const fuzzy = v.length >= 4 ? { fuzzy: { maxEdits: v.length >= 8 ? 2 : 1, prefixLength: 1 } } : {};
      should.push(
        { phrase: { query: v, path: "productName", score: { boost: { value: 8 } } } },
        { autocomplete: { query: v, path: "productName", ...fuzzy, score: { boost: { value: 5 } } } },
        { autocomplete: { query: v, path: "productAuthor", ...fuzzy, score: { boost: { value: 3 } } } }
      );
      if (!forSuggest) {
        should.push(
          { text: { query: v, path: ["productName", "productAuthor"], ...fuzzy, score: { boost: { value: 2 } } } },
          { text: { query: v, path: ["productDesc", "productPublisher"], ...(v.length >= 5 ? { fuzzy: { maxEdits: 1 } } : {}) } }
        );
      }
    }
    const filter: T[] = [{ equals: { path: "productStatus", value: ProductStatus.PROCESS } }];
    for (const [path, value] of Object.entries(filters)) if (value) filter.push({ equals: { path, value } });
    return { $search: { index: BOOK_INDEX, compound: { should, filter, minimumShouldMatch: 1 } } };
  }

  /** Fallback: apostrophe-insensitive regex on title, author and publisher */
  private fallbackMatch(variants: string[], filters: T) {
    const match: T = { productStatus: ProductStatus.PROCESS };
    for (const [path, value] of Object.entries(filters)) if (value) match[path] = value;
    const regexes = variants.map(apostropheInsensitiveRegex);
    match.$or = regexes.flatMap((re) => [{ productName: re }, { productAuthor: re }, { productPublisher: re }]);
    return match;
  }

  private filtersOf(input: { productCollection?: string; productLanguage?: string; shelf?: string }) {
    return { productCollection: input.productCollection, productLanguage: input.productLanguage, productShelves: input.shelf };
  }

  /** Catalog search: same result shape as the plain catalog listing */
  public async search(input: BookSearch): Promise<{ items: any[]; engine: SearchEngine }> {
    const variants = queryVariants(input.query);
    if (!variants.length) return { items: [], engine: "fallback" };
    const filters = this.filtersOf(input);
    const sort: T | null = input.order === "relevance" ? null : { [input.order]: input.order === "productPrice" ? 1 : -1 };

    if ((await this.engine()) === "atlas") {
      try {
        const items = await ProductModel.aggregate([
          this.atlasStage(variants, filters),
          ...(sort ? [{ $sort: sort }] : []),
          { $skip: input.skip },
          { $limit: input.limit },
        ]).exec();
        return { items, engine: "atlas" };
      } catch (err: any) {
        console.warn("[search] Atlas Search failed, using fallback:", err?.codeName || err?.message);
        this.markUnavailable();
      }
    }
    const items = await ProductModel.aggregate([
      { $match: this.fallbackMatch(variants, filters) },
      // without a relevance score, titles that start with the query come first
      { $addFields: { _starts: { $cond: [{ $regexMatch: { input: "$productName", regex: apostropheInsensitiveRegex(variants[0]).source, options: "i" } }, 1, 0] } } },
      { $sort: sort ?? { _starts: -1, productViews: -1 } },
      { $skip: input.skip },
      { $limit: input.limit },
      { $project: { _starts: 0 } },
    ]).exec();
    return { items, engine: "fallback" };
  }

  /** As-you-type suggestions for the header search box */
  public async suggest(query: string, limit = 6): Promise<{ items: any[]; engine: SearchEngine }> {
    const variants = queryVariants(query);
    if (!variants.length || variants[0].replace(/\s/g, "").length < 2) return { items: [], engine: "fallback" };

    if ((await this.engine()) === "atlas") {
      try {
        const scored = await ProductModel.aggregate([
          this.atlasStage(variants, {}, true),
          { $limit: limit },
          { $project: { ...SUGGEST_FIELDS, score: { $meta: "searchScore" } } },
        ]).exec();
        // Fuzzy matching on short words ("dev" ~ "de") adds weak hits; a suggestion
        // list should only show books that are close to the best one
        const top = scored[0]?.score ?? 0;
        const items = scored.filter((b) => b.score >= top * SUGGEST_MIN_SHARE).map(({ score, ...book }) => book);
        return { items, engine: "atlas" };
      } catch (err: any) {
        console.warn("[search] Atlas suggest failed, using fallback:", err?.codeName || err?.message);
        this.markUnavailable();
      }
    }
    const items = await ProductModel.aggregate([
      { $match: this.fallbackMatch(variants, {}) },
      { $sort: { productViews: -1 } },
      { $limit: limit },
      { $project: SUGGEST_FIELDS },
    ]).exec();
    return { items, engine: "fallback" };
  }
}

/** One instance for the whole app, so the index state cache is shared */
export default new SearchService();
