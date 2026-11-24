import mongoose from "mongoose";
import ProductModel from "../schema/Product.model";
import OrderModel from "../schema/Order.model";
import LikeModel from "../schema/Like.model";
import ViewModel from "../schema/View.model";
import BookNeighborsModel, { NeighborReason } from "../schema/BookNeighbors.model";
import { ProductStatus } from "../libs/types/enums/product.enum";
import { OrderStatus } from "../libs/types/enums/order.enum";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { BookInfo, Interaction, Neighbor, SIGNAL_WEIGHT, computeNeighbors, personalize } from "../libs/reco/similarity";

const MAX_SEEDS = 10;
const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{24}$/i.test(v);
const oid = (v: string) => new mongoose.Types.ObjectId(v);

export type RecoBasis = "history" | "seeds" | "popular";
export interface RecoTag {
  reason: NeighborReason | "BECAUSE" | "POPULAR";
  because?: { _id: string; productName: string };
}

const toInfo = (p: any): BookInfo => ({
  id: String(p._id),
  author: p.productAuthor,
  collection: p.productCollection,
  shelves: p.productShelves,
  language: p.productLanguage,
});

class RecommendationService {
  private running: Promise<unknown> | null = null;
  public lastRun: { at: Date; books: number; interactions: number; ms: number } | null = null;

  /** Every reader signal: confirmed or pending orders, likes, views */
  private async interactions(memberId?: string): Promise<Interaction[]> {
    const member = memberId ? { memberId: oid(memberId) } : {};
    const [ordered, liked, viewed] = await Promise.all([
      OrderModel.aggregate([
        { $match: { ...member, orderStatus: { $ne: OrderStatus.DELETE } } },
        { $lookup: { from: "orderItems", localField: "_id", foreignField: "orderId", as: "items" } },
        { $unwind: "$items" },
        { $project: { _id: 0, member: { $toString: "$memberId" }, book: { $toString: "$items.productId" } } },
      ]).exec(),
      LikeModel.find({ ...member, likeGroup: "PRODUCT" }, { memberId: 1, likeRefId: 1 }).lean().exec(),
      ViewModel.find({ ...member, viewGroup: "PRODUCT" }, { memberId: 1, viewRefId: 1 }).lean().exec(),
    ]);
    return [
      ...ordered.map((o: any) => ({ member: o.member, book: o.book, weight: SIGNAL_WEIGHT.ORDER })),
      ...liked.map((l: any) => ({ member: String(l.memberId), book: String(l.likeRefId), weight: SIGNAL_WEIGHT.LIKE })),
      ...viewed.map((v: any) => ({ member: String(v.memberId), book: String(v.viewRefId), weight: SIGNAL_WEIGHT.VIEW })),
    ];
  }

  /** Recompute every book's neighbors (books on sale only). One run at a time. */
  public rebuild() {
    if (!this.running) {
      this.running = this.doRebuild().finally(() => (this.running = null));
    }
    return this.running as Promise<NonNullable<RecommendationService["lastRun"]>>;
  }

  private async doRebuild() {
    const started = Date.now();
    const books = await ProductModel.find({ productStatus: ProductStatus.PROCESS }, { productAuthor: 1, productCollection: 1, productShelves: 1, productLanguage: 1 }).lean().exec();
    const interactions = await this.interactions();
    const neighbors = computeNeighbors(books.map(toInfo), interactions);
    const now = new Date();
    const ops = [...neighbors.entries()].map(([id, list]) => ({
      replaceOne: {
        filter: { _id: oid(id) },
        replacement: { _id: oid(id), neighbors: list.map((n) => ({ productId: oid(n.id), score: n.score, reason: n.reason })), computedAt: now },
        upsert: true,
      },
    }));
    if (ops.length) await BookNeighborsModel.bulkWrite(ops as any, { ordered: false });
    // books that left the shop keep no neighbor list
    await BookNeighborsModel.deleteMany({ computedAt: { $lt: now } }).exec();
    this.lastRun = { at: now, books: books.length, interactions: interactions.length, ms: Date.now() - started };
    return this.lastRun;
  }

  private async neighborsOf(ids: string[]): Promise<Map<string, Neighbor[]>> {
    const docs = await BookNeighborsModel.find({ _id: { $in: ids.map(oid) } }).lean().exec();
    return new Map(docs.map((d: any) => [String(d._id), d.neighbors.map((n: any) => ({ id: String(n.productId), score: n.score, reason: n.reason }))]));
  }

  /** Full product documents (on sale only), in the given order */
  private async loadBooks(ids: string[]) {
    const list = await ProductModel.find({ _id: { $in: ids.map(oid) }, productStatus: ProductStatus.PROCESS }).lean().exec();
    const byId = new Map(list.map((p: any) => [String(p._id), p]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as any[];
  }

  /** "Similar books" under a book page */
  public async similar(productId: unknown, limit = 8) {
    if (!isId(productId)) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    const book = await ProductModel.findOne({ _id: oid(productId), productStatus: ProductStatus.PROCESS }).lean().exec();
    if (!book) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);

    let list = (await this.neighborsOf([productId])).get(productId);
    if (!list) {
      // a book added after the last rebuild: content similarity on the fly
      const others = await ProductModel.find({ productStatus: ProductStatus.PROCESS }, { productAuthor: 1, productCollection: 1, productShelves: 1, productLanguage: 1 }).lean().exec();
      list = computeNeighbors(others.map(toInfo), []).get(productId) ?? [];
    }
    const top = list.slice(0, limit);
    const books = await this.loadBooks(top.map((n) => n.id));
    const reasons = new Map(top.map((n) => [n.id, n.reason]));
    return books.map((p) => ({ ...p, recommendation: { reason: reasons.get(String(p._id)) } as RecoTag }));
  }

  /** Most-read books on sale, for readers we know nothing about yet */
  private async popular(limit: number, exclude: Set<string>) {
    const list = await ProductModel.aggregate([
      { $match: { productStatus: ProductStatus.PROCESS, _id: { $nin: [...exclude].map(oid) } } },
      { $addFields: { _pop: { $add: ["$productViews", { $multiply: ["$productLikes", 3] }] } } },
      { $sort: { _pop: -1, createdAt: -1 } },
      { $limit: limit },
      { $project: { _pop: 0 } },
    ]).exec();
    return list.map((p) => ({ ...p, recommendation: { reason: "POPULAR" } as RecoTag }));
  }

  /**
   * "For you": the reader's history (signed in) plus books this browser viewed
   * (seeds). Topped up with popular books when there's too little to go on.
   */
  public async forReader(memberId: string | null, rawSeeds: unknown, limit = 8): Promise<{ basis: RecoBasis; items: any[] }> {
    const seeds = String(rawSeeds ?? "").split(",").filter(isId).slice(0, MAX_SEEDS);
    const history = new Map<string, number>();
    const owned = new Set<string>(); // ordered or liked: don't recommend again
    if (memberId) {
      for (const i of await this.interactions(memberId)) {
        history.set(i.book, Math.max(history.get(i.book) ?? 0, i.weight));
        if (i.weight >= SIGNAL_WEIGHT.LIKE) owned.add(i.book);
      }
    }
    for (const s of seeds) if (!history.has(s)) history.set(s, SIGNAL_WEIGHT.VIEW);

    let items: any[] = [];
    let basis: RecoBasis = "popular";
    if (history.size) {
      const neighbors = await this.neighborsOf([...history.keys()]);
      const ranked = personalize(history, (id) => neighbors.get(id) ?? [], owned).slice(0, limit);
      const books = await this.loadBooks(ranked.map((r) => r.id));
      const names = new Map((await ProductModel.find({ _id: { $in: ranked.map((r) => oid(r.because)) } }, { productName: 1 }).lean().exec()).map((p: any) => [String(p._id), p.productName]));
      const because = new Map(ranked.map((r) => [r.id, r.because]));
      items = books.map((p) => {
        const seed = because.get(String(p._id))!;
        return { ...p, recommendation: { reason: "BECAUSE", because: names.has(seed) ? { _id: seed, productName: names.get(seed) } : undefined } as RecoTag };
      });
      if (items.length) basis = memberId && [...history.keys()].some((id) => !seeds.includes(id)) ? "history" : "seeds";
    }
    if (items.length < limit) {
      const exclude = new Set([...history.keys(), ...items.map((p) => String(p._id))]);
      items = [...items, ...(await this.popular(limit - items.length, exclude))];
    }
    return { basis, items };
  }
}

/** One instance: rebuilds are shared and never run twice at once */
const recommendationService = new RecommendationService();
export default recommendationService;

const REBUILD_EVERY_MS = 6 * 3600 * 1000;

/** Background job: shortly after start, then every 6 hours */
export const startRecommendationJob = () => {
  const run = () =>
    recommendationService
      .rebuild()
      .then((r) => console.info(`Recommendations rebuilt: ${r.books} books, ${r.interactions} signals, ${r.ms} ms`))
      .catch((err) => console.warn("Recommendations rebuild failed:", err?.message || err));
  setTimeout(run, 5_000).unref();
  setInterval(run, REBUILD_EVERY_MS).unref();
};
