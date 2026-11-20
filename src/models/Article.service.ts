import fs from "fs";
import path from "path";
import ArticleModel, { ArticleStatus } from "../schema/Article.model";
import ProductModel from "../schema/Product.model";
import { ProductStatus } from "../libs/types/enums/product.enum";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { shapeIntoMongooseObjectId } from "../libs/types/config";
import { ArticleInput, makeSlug } from "../libs/utils/article-input";

/** Fields for article cards (no body) */
const CARD_FIELDS = {
  articleTitle: 1,
  articleSlug: 1,
  articleExcerpt: 1,
  articleImage: 1,
  articleTags: 1,
  articleLanguage: 1,
  articleReadMinutes: 1,
  publishedAt: 1,
};

const removeFile = (file?: string | null) => {
  if (file) fs.unlink(path.join(process.cwd(), file), () => {});
};

class ArticleService {
  /*********************** SITE ***************************/

  public async getPublished(inquiry: { page: number; limit: number; tag?: string; lang?: string }) {
    const match: Record<string, unknown> = { articleStatus: ArticleStatus.PUBLISHED };
    if (inquiry.tag) match.articleTags = inquiry.tag;
    if (inquiry.lang) match.articleLanguage = inquiry.lang;
    return ArticleModel.find(match, CARD_FIELDS)
      .sort({ publishedAt: -1 })
      .skip((inquiry.page - 1) * inquiry.limit)
      .limit(inquiry.limit)
      .lean()
      .exec();
  }

  /** Tags used by published articles, most used first */
  public async getTags(): Promise<{ tag: string; count: number }[]> {
    const rows = await ArticleModel.aggregate([
      { $match: { articleStatus: ArticleStatus.PUBLISHED } },
      { $unwind: "$articleTags" },
      { $group: { _id: "$articleTags", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 20 },
    ]).exec();
    return rows.map((row: any) => ({ tag: row._id, count: row.count }));
  }

  /** One published article with its active books; counts a view */
  public async getBySlug(slug: string, countView = true) {
    if (typeof slug !== "string" || !/^[a-z0-9-]{3,80}$/.test(slug)) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    const article = await ArticleModel.findOneAndUpdate(
      { articleSlug: slug, articleStatus: ArticleStatus.PUBLISHED },
      countView ? { $inc: { articleViews: 1 } } : {},
      { new: true }
    )
      .lean()
      .exec();
    if (!article) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);

    const books = article.articleProducts.length
      ? await ProductModel.find({ _id: { $in: article.articleProducts }, productStatus: ProductStatus.PROCESS }).lean().exec()
      : [];
    // keep the order the library chose
    const order = new Map(article.articleProducts.map((id: any, i: number) => [String(id), i]));
    books.sort((a: any, b: any) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));

    const more = await ArticleModel.find(
      { articleStatus: ArticleStatus.PUBLISHED, _id: { $ne: article._id } },
      CARD_FIELDS
    )
      .sort({ publishedAt: -1 })
      .limit(3)
      .lean()
      .exec();
    return { ...article, books, more };
  }

  /*********************** ADMIN ***************************/

  public async getAllForAdmin() {
    return ArticleModel.find({}).sort({ updatedAt: -1 }).lean().exec();
  }

  public async getById(id: string) {
    const article = await ArticleModel.findById(shapeIntoMongooseObjectId(id)).lean().exec();
    if (!article) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    return article;
  }

  public async create(input: ArticleInput, image: string | undefined, publish: boolean) {
    return ArticleModel.create({
      ...input,
      articleSlug: makeSlug(input.articleTitle),
      articleImage: image,
      articleStatus: publish ? ArticleStatus.PUBLISHED : ArticleStatus.DRAFT,
      publishedAt: publish ? new Date() : undefined,
    });
  }

  /** Update fields; a new image replaces (and deletes) the old one */
  public async update(id: string, input: ArticleInput, image: string | undefined, publish: boolean | null) {
    const current = await this.getById(id);
    const set: Record<string, unknown> = { ...input };
    if (image) set.articleImage = image;
    if (publish === true) {
      set.articleStatus = ArticleStatus.PUBLISHED;
      if (!current.publishedAt) set.publishedAt = new Date();
    } else if (publish === false) {
      set.articleStatus = ArticleStatus.DRAFT;
    }
    const updated = await ArticleModel.findByIdAndUpdate(current._id, { $set: set }, { new: true }).lean().exec();
    if (image && current.articleImage && current.articleImage !== image) removeFile(current.articleImage);
    return updated;
  }

  public async setStatus(id: string, status: unknown) {
    if (status !== ArticleStatus.PUBLISHED && status !== ArticleStatus.DRAFT)
      throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);
    const current = await this.getById(id);
    const set: Record<string, unknown> = { articleStatus: status };
    if (status === ArticleStatus.PUBLISHED && !current.publishedAt) set.publishedAt = new Date();
    return ArticleModel.findByIdAndUpdate(current._id, { $set: set }, { new: true }).lean().exec();
  }

  public async remove(id: string) {
    const current = await this.getById(id);
    await ArticleModel.deleteOne({ _id: current._id }).exec();
    removeFile(current.articleImage);
  }

  /** Books the admin can attach (active and paused) */
  public async getPickableBooks() {
    return ProductModel.find({ productStatus: { $ne: ProductStatus.DELETE } })
      .select("productName productAuthor productImages productStatus")
      .sort({ productName: 1 })
      .lean()
      .exec();
  }
}

export default ArticleService;
