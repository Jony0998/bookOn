import fs from "fs";
import { Request, Response } from "express";
import { T } from "../libs/types/common";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { AdminRequest } from "../libs/types/member";
import { parsePagination } from "../libs/types/config";
import { alertScript } from "../libs/utils/alert";
import { parseArticleInput } from "../libs/utils/article-input";
import { publicUrl } from "../libs/utils/mailer";
import ArticleService from "../models/Article.service";
import { ArticleLanguage } from "../schema/Article.model";

const articleService = new ArticleService();
const articleController: T = {};

const fail = (res: Response, err: unknown) => {
  if (err instanceof Errors) res.status(err.code).json(err);
  else res.status(Errors.standard.code).json(Errors.standard);
};
const discard = (file?: Express.Multer.File) => {
  if (file) fs.unlink(file.path, () => {});
};
const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/*********************** SITE (JSON) ***************************/

articleController.getArticles = async (req: Request, res: Response) => {
  try {
    const { page, limit } = parsePagination(req.query.page, req.query.limit, 9, 24);
    const tag = typeof req.query.tag === "string" ? req.query.tag.slice(0, 30).toLowerCase() : undefined;
    const lang = typeof req.query.lang === "string" && (Object.values(ArticleLanguage) as string[]).includes(req.query.lang) ? req.query.lang : undefined;
    res.status(HttpCode.OK).json(await articleService.getPublished({ page, limit, tag, lang }));
  } catch (err) {
    console.log("Error getArticles:", err);
    fail(res, err);
  }
};

articleController.getTags = async (req: Request, res: Response) => {
  try {
    res.status(HttpCode.OK).json(await articleService.getTags());
  } catch (err) {
    fail(res, err);
  }
};

articleController.getArticle = async (req: Request, res: Response) => {
  try {
    res.status(HttpCode.OK).json(await articleService.getBySlug(String(req.params.slug)));
  } catch (err) {
    fail(res, err);
  }
};

/**
 * Link previews: Telegram/Facebook/WhatsApp bots don't run JavaScript, so nginx
 * sends them here for /news/:slug. Humans who land here are redirected to the app.
 */
articleController.ogArticle = async (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  const url = `${publicUrl()}/news/${encodeURIComponent(slug)}`;
  try {
    const a = await articleService.getBySlug(slug, false);
    const image = a.articleImage ? `${publicUrl()}/${a.articleImage}` : `${publicUrl()}/icons/icon-512.png`;
    res.set("Cache-Control", "public, max-age=300").send(`<!doctype html>
<html lang="${escapeHtml(String(a.articleLanguage).toLowerCase())}"><head><meta charset="utf-8">
<title>${escapeHtml(a.articleTitle)} — BookOn</title>
<meta name="description" content="${escapeHtml(a.articleExcerpt)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="BookOn">
<meta property="og:title" content="${escapeHtml(a.articleTitle)}">
<meta property="og:description" content="${escapeHtml(a.articleExcerpt)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapeHtml(url)}">
${a.publishedAt ? `<meta property="article:published_time" content="${new Date(a.publishedAt).toISOString()}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${escapeHtml(url)}">
</head><body><p><a href="${escapeHtml(url)}">${escapeHtml(a.articleTitle)}</a></p></body></html>`);
  } catch {
    res.redirect(302, `${publicUrl()}/news`);
  }
};

/*********************** ADMIN (SSR) ***************************/

articleController.adminList = async (req: AdminRequest, res: Response) => {
  try {
    const articles = await articleService.getAllForAdmin();
    res.render("articles", { articles, admin: req.session.member, active: "articles" });
  } catch (err) {
    console.log("Error adminList:", err);
    res.status(500).send(alertScript(Message.SOMETHING_WENT_WRONG, "/admin"));
  }
};

articleController.adminNew = async (req: AdminRequest, res: Response) => {
  const books = await articleService.getPickableBooks();
  res.render("article-form", { article: null, books, admin: req.session.member, active: "articles" });
};

articleController.adminEdit = async (req: AdminRequest, res: Response) => {
  try {
    const [article, books] = await Promise.all([articleService.getById(String(req.params.id)), articleService.getPickableBooks()]);
    res.render("article-form", { article, books, admin: req.session.member, active: "articles", saved: req.query.saved === "1" });
  } catch {
    res.status(404).send(alertScript("Maqola topilmadi.", "/admin/article/all"));
  }
};

/** Form submit button: name="intent" value="publish" | "draft" */
const intent = (req: Request) => (req.body?.intent === "publish" ? true : req.body?.intent === "draft" ? false : null);

articleController.adminCreate = async (req: AdminRequest, res: Response) => {
  try {
    const input = parseArticleInput(req.body);
    const image = req.file ? req.file.path.replace(/\\/g, "/") : undefined;
    const article = await articleService.create(input, image, intent(req) === true);
    res.redirect(`/admin/article/${article._id}/edit?saved=1`);
  } catch (err) {
    console.log("Error adminCreate:", err);
    discard(req.file);
    res.send(alertScript("Saqlab boʻlmadi: sarlavha (3–160 belgi) va matn (kamida 20 belgi) majburiy, teglar 6 tagacha.", "/admin/article/new"));
  }
};

articleController.adminUpdate = async (req: AdminRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    const input = parseArticleInput(req.body);
    const image = req.file ? req.file.path.replace(/\\/g, "/") : undefined;
    await articleService.update(id, input, image, intent(req));
    res.redirect(`/admin/article/${id}/edit?saved=1`);
  } catch (err) {
    console.log("Error adminUpdate:", err);
    discard(req.file);
    res.send(alertScript("Saqlab boʻlmadi: sarlavha (3–160 belgi) va matn (kamida 20 belgi) majburiy, teglar 6 tagacha.", `/admin/article/${id}/edit`));
  }
};

articleController.adminStatus = async (req: AdminRequest, res: Response) => {
  try {
    res.status(HttpCode.OK).json({ data: await articleService.setStatus(String(req.params.id), req.body?.articleStatus) });
  } catch (err) {
    fail(res, err);
  }
};

articleController.adminDelete = async (req: AdminRequest, res: Response) => {
  try {
    await articleService.remove(String(req.params.id));
    res.status(HttpCode.OK).json({ deleted: true });
  } catch (err) {
    fail(res, err);
  }
};

export default articleController;
