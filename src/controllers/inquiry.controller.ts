import { Request, Response } from "express";
import { T } from "../libs/types/common";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { AdminRequest, ExtendedRequest } from "../libs/types/member";
import { alertScript } from "../libs/utils/alert";
import { parseInquiryInput } from "../libs/utils/inquiry-input";
import { publicUrl, sendAuthMail, toMailLang } from "../libs/utils/mailer";
import InquiryService, { inquiryKey } from "../models/Inquiry.service";

const inquiryService = new InquiryService();
const inquiryController: T = {};

const fail = (res: Response, err: unknown) => {
  if (err instanceof Errors) res.status(err.code).json(err);
  else res.status(Errors.standard.code).json(Errors.standard);
};
const keyOf = (req: Request) => (typeof req.query.key === "string" ? req.query.key : typeof req.body?.key === "string" ? req.body.key : undefined);

/*********************** SITE (JSON) ***************************/

inquiryController.create = async (req: ExtendedRequest, res: Response) => {
  try {
    // Bots fill every field; people never see this one
    if (typeof req.body?.website === "string" && req.body.website.trim())
      throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);
    const input = parseInquiryInput(req.body, req.member);
    res.status(HttpCode.CREATED).json(await inquiryService.create(input, req.member, req.ip || ""));
  } catch (err) {
    console.log("Error inquiry create:", err instanceof Errors ? err.message : err);
    fail(res, err);
  }
};

inquiryController.getMine = async (req: ExtendedRequest, res: Response) => {
  try {
    res.status(HttpCode.OK).json(await inquiryService.getMine(req.member._id));
  } catch (err) {
    fail(res, err);
  }
};

inquiryController.unread = async (req: ExtendedRequest, res: Response) => {
  try {
    res.status(HttpCode.OK).json({ unread: await inquiryService.unreadCount(req.member._id) });
  } catch (err) {
    fail(res, err);
  }
};

inquiryController.getOne = async (req: ExtendedRequest, res: Response) => {
  try {
    res.status(HttpCode.OK).json(await inquiryService.getForReader(String(req.params.id), { member: req.member, key: keyOf(req) }));
  } catch (err) {
    fail(res, err);
  }
};

inquiryController.reply = async (req: ExtendedRequest, res: Response) => {
  try {
    res.status(HttpCode.OK).json(await inquiryService.readerReply(String(req.params.id), { member: req.member, key: keyOf(req) }, req.body?.message));
  } catch (err) {
    console.log("Error inquiry reply:", err instanceof Errors ? err.message : err);
    fail(res, err);
  }
};

/*********************** ADMIN (SSR) ***************************/

const ADMIN_TABS = ["NEW", "ANSWERED", "CLOSED", "ALL"];

inquiryController.adminList = async (req: AdminRequest, res: Response) => {
  try {
    const tab = ADMIN_TABS.includes(String(req.query.status)) ? String(req.query.status) : "NEW";
    const { list, count } = await inquiryService.getAllForAdmin(tab === "ALL" ? undefined : tab);
    res.render("inquiries", { inquiries: list, count, tab, admin: req.session.member, active: "inquiries" });
  } catch (err) {
    console.log("Error inquiry adminList:", err);
    res.status(500).send(alertScript(Message.SOMETHING_WENT_WRONG, "/admin"));
  }
};

inquiryController.adminView = async (req: AdminRequest, res: Response) => {
  try {
    const inquiry = await inquiryService.getForAdmin(String(req.params.id));
    res.render("inquiry", {
      inquiry,
      sent: req.query.sent === "1",
      mailed: req.query.mail === "1",
      admin: req.session.member,
      active: "inquiries",
    });
  } catch {
    res.status(404).send(alertScript("Murojaat topilmadi.", "/admin/inquiry/all"));
  }
};

inquiryController.adminReply = async (req: AdminRequest, res: Response) => {
  const id = String(req.params.id);
  try {
    const { doc, message } = await inquiryService.libraryReply(id, req.body?.message);
    let mailed = false;
    if (doc.inquiryEmail) {
      const link = `${publicUrl()}/reception/${doc._id}?key=${inquiryKey(doc._id)}`;
      mailed = await sendAuthMail("reply", doc.inquiryEmail, doc.inquiryName, link, toMailLang(doc.inquiryLang), message);
    }
    res.redirect(`/admin/inquiry/${id}?sent=1&mail=${mailed ? 1 : 0}`);
  } catch (err) {
    console.log("Error inquiry adminReply:", err);
    const text = err instanceof Errors && err.message === Message.INVALID_MESSAGE ? "Javob 5–2000 belgi boʻlishi kerak." : "Javobni saqlab boʻlmadi.";
    res.send(alertScript(text, `/admin/inquiry/${id}`));
  }
};

inquiryController.adminStatus = async (req: AdminRequest, res: Response) => {
  try {
    res.status(HttpCode.OK).json({ inquiryStatus: await inquiryService.setStatus(String(req.params.id), req.body?.inquiryStatus) });
  } catch (err) {
    fail(res, err);
  }
};

export default inquiryController;
