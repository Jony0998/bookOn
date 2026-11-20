import crypto from "crypto";
import mongoose from "mongoose";
import Errors, { HttpCode, Message } from "../types/Errors";
import { ArticleLanguage } from "../../schema/Article.model";

export interface ArticleInput {
  articleTitle: string;
  articleExcerpt: string;
  articleBody: string;
  articleTags: string[];
  articleLanguage: ArticleLanguage;
  articleProducts: mongoose.Types.ObjectId[];
  articleReadMinutes: number;
}

const invalid = () => new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(",") : [];

const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h",
};

/** "Yangi kelgan kitoblar: O‘tkan kunlar" -> "yangi-kelgan-kitoblar-otkan-kunlar-k3f9" */
export const makeSlug = (title: string): string => {
  const base = title
    .toLowerCase()
    .replace(/[ʻʼ'’‘`]/g, "")
    .split("")
    .map((ch) => CYRILLIC[ch] ?? ch)
    .join("")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${base || "maqola"}-${crypto.randomBytes(3).toString("hex").slice(0, 4)}`;
};

/** Whitelists and validates the admin article form (multipart or JSON) */
export const parseArticleInput = (body: unknown): ArticleInput => {
  const source = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const articleTitle = str(source.articleTitle);
  if (articleTitle.length < 3 || articleTitle.length > 160) throw invalid();

  const articleBody = str(source.articleBody).replace(/\r\n/g, "\n");
  if (articleBody.length < 20 || articleBody.length > 20000) throw invalid();

  // Excerpt: given, or the first ~220 characters of the text
  let articleExcerpt = str(source.articleExcerpt);
  if (articleExcerpt.length > 300) throw invalid();
  if (!articleExcerpt) {
    const plain = articleBody.replace(/^(##|>|-)\s+/gm, "").replace(/\s+/g, " ").trim();
    articleExcerpt = plain.length > 220 ? `${plain.slice(0, 217).replace(/\s+\S*$/, "")}…` : plain;
  }

  const articleTags = Array.from(
    new Set(list(source.articleTags).map((tag) => tag.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))
  );
  if (articleTags.length > 6 || articleTags.some((tag) => tag.length < 2 || tag.length > 30)) throw invalid();

  const language = str(source.articleLanguage) || ArticleLanguage.UZ;
  if (!(Object.values(ArticleLanguage) as string[]).includes(language)) throw invalid();

  const ids = list(source.articleProducts).map((id) => id.trim()).filter(Boolean);
  if (ids.length > 8 || !ids.every((id) => mongoose.Types.ObjectId.isValid(id))) throw invalid();

  const words = articleBody.split(/\s+/).filter(Boolean).length;
  return {
    articleTitle,
    articleExcerpt,
    articleBody,
    articleTags,
    articleLanguage: language as ArticleLanguage,
    articleProducts: Array.from(new Set(ids)).map((id) => new mongoose.Types.ObjectId(id)),
    articleReadMinutes: Math.max(1, Math.round(words / 200)),
  };
};
