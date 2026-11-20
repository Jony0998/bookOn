import mongoose, { Schema } from "mongoose";

export enum ArticleStatus {
  DRAFT = "DRAFT",
  PUBLISHED = "PUBLISHED",
}

export enum ArticleLanguage {
  UZ = "UZ",
  RU = "RU",
  EN = "EN",
}

/**
 * News / blog post written by the library. The body is plain text with a tiny
 * markup ("## " heading, "> " quote, "- " list item, blank line = new paragraph),
 * rendered as React elements on the site, never as raw HTML.
 */
const articleSchema = new Schema(
  {
    articleTitle: { type: String, required: true, trim: true },
    /** URL part, stable after creation so shared links keep working */
    articleSlug: { type: String, required: true, unique: true },
    articleExcerpt: { type: String, trim: true },
    articleBody: { type: String, required: true },
    articleImage: { type: String },
    articleTags: { type: [String], default: [] },
    articleLanguage: { type: String, enum: Object.values(ArticleLanguage), default: ArticleLanguage.UZ },
    articleStatus: { type: String, enum: Object.values(ArticleStatus), default: ArticleStatus.DRAFT },
    /** Books featured under the article */
    articleProducts: { type: [{ type: Schema.Types.ObjectId, ref: "Product" }], default: [] },
    articleReadMinutes: { type: Number, default: 1 },
    articleViews: { type: Number, default: 0 },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

articleSchema.index({ articleStatus: 1, publishedAt: -1 });
articleSchema.index({ articleTags: 1 });

export default mongoose.model("Article", articleSchema, "articles");
