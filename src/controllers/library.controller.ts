// Controllers are implemented as objects; import common types from libs.
import { NextFunction, Request, Response } from "express";
import { T } from "../libs/types/common";
import MemberService from "../models/Member.service";
import { AdminRequest, LoginInput, MemberInput } from "../libs/types/member";
import { MemberType } from "../libs/types/enums/member.enum";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { pickFields } from "../libs/types/config";
import { alertScript } from "../libs/utils/alert";
import DashboardService, { LOW_STOCK } from "../models/Dashboard.service";
import { OrderStatus } from "../libs/types/enums/order.enum";
const memberService = new MemberService();
const dashboardService = new DashboardService();

const libraryController: T = {};
/** Dashboard; anonymous visitors go to the login page (it used to be public) */
libraryController.goHome = async (req: AdminRequest, res: Response) => {
  try {
    console.log("goHome");
    if (req.session?.member?.memberType !== MemberType.LIBRARY) return res.redirect("/admin/login");
    const summary = await dashboardService.getSummary();
    res.render("home", { summary, admin: req.session.member, active: "home", lowStockLimit: LOW_STOCK });
  } catch (err) {
    console.log("Error, getHome:", err);
    res.status(HttpCode.INTERNAL_SERVER_ERROR).send(alertScript(Message.SOMETHING_WENT_WRONG, "/admin/product/all"));
  }
};

libraryController.getOrders = async (req: AdminRequest, res: Response) => {
  try {
    console.log("getOrders");
    const requested = String(req.query.status ?? "");
    const status = (Object.values(OrderStatus) as string[]).includes(requested) ? (requested as OrderStatus) : undefined;
    const orders = await dashboardService.getOrders(status);
    res.render("orders", { orders, status: status ?? "", admin: req.session.member, active: "orders" });
  } catch (err) {
    console.log("Error getOrders:", err);
    res.status(HttpCode.INTERNAL_SERVER_ERROR).send(alertScript(Message.SOMETHING_WENT_WRONG, "/admin"));
  }
};

libraryController.getSignup = async (req: Request, res: Response) => {
  try {
    // Only one library account may exist; show the form only before it does
    const libraryExists = await memberService.getLibrary().then(() => true).catch(() => false);
    res.render("signup", { libraryExists });
    console.log("getSignup");
  } catch (err) {
    console.log("Error getSignup:", err);
  }
};

libraryController.getLogin = (req: Request, res: Response) => {
  try {
    console.log("getLogin");
    if ((req as AdminRequest).session?.member?.memberType === MemberType.LIBRARY) return res.redirect("/admin");
    res.render("login");
  } catch (err) {
    console.log("Error getLogin:", err);
    res.redirect("/admin");
  }
};

libraryController.processSignup = async (
  req: AdminRequest,
  res: Response
) => {
  try {
    console.log("processSignup");
    const file = req.file;

    if (!file)
      throw new Errors(HttpCode.BAD_REQUEST, Message.SOMETHING_WENT_WRONG);

    const fields = pickFields(req.body, [
      "memberNick",
      "memberPhone",
      "memberAddress",
      "memberDesc",
    ] as const);
    const memberPassword = req.body?.memberPassword;
    if (!fields.memberNick || !fields.memberPhone || typeof memberPassword !== "string" || !memberPassword)
      throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);

    const newMember: MemberInput = {
      ...fields,
      memberNick: fields.memberNick,
      memberPhone: fields.memberPhone,
      memberPassword,
      memberImage: file.path.replace(/\\/g, "/"),
      memberType: MemberType.LIBRARY,
    };
    const result = await memberService.processSignup(newMember);

    req.session.member = result;
    req.session.save(function () {
      res.redirect("/admin/product/all");
    });
  } catch (err) {
    console.log("Error processSignup:", err);
    const message =
      err instanceof Errors ? err.message : Message.SOMETHING_WENT_WRONG;
    res.send(alertScript(message, "/admin/signup"));
  }
};

libraryController.processLogin = async (
  req: AdminRequest,
  res: Response
) => {
  try {
    console.log("processLogin");
    const input: LoginInput = {
      memberNick: String(req.body?.memberNick ?? ""),
      memberPassword: String(req.body?.memberPassword ?? ""),
    };
    const result = await memberService.processLogin(input);
    // TODO: SESSIONS AUTHENTICATION

    req.session.member = result;
    req.session.save(function () {
      res.redirect("/admin/product/all");
    });
  } catch (err) {
    console.log("Error processLogin:", err);
    const message =
      err instanceof Errors ? err.message : Message.SOMETHING_WENT_WRONG;
    res.send(alertScript(message, "/admin/login"));
  }
};

// logout

libraryController.logout = async (req: AdminRequest, res: Response) => {
  try {
    console.log("logout");
    req.session.destroy(function () {
      res.redirect("/admin");
    });
  } catch (err) {
    console.log("Error logout:", err);
    res.redirect("/admin");
  }
};

libraryController.getUsers = async (req: Request, res: Response) => {
  try {
    const result = await memberService.getUsers();
    res.render("users", { users: result, admin: (req as AdminRequest).session.member, active: "users" });
  } catch (err) {
    console.log("Error getUsers:", err);
    res.redirect("/admin/login");
  }
};

libraryController.updateChosenUser = async (req: Request, res: Response) => {
  try {
    console.log("updateChosenUser");
    const result = await memberService.updateChosenUser(req.body);

    res.status(HttpCode.OK).json({ data: result });
  } catch (err) {
    console.log("Error updateChosenUser:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard)
  }
};

libraryController.checkAuthSession = async (
  req: AdminRequest,
  res: Response
) => {
  try {
    console.log("checkAuthSession");
    if (req.session?.member)
      res.send(alertScript(req.session.member.memberNick));
    else res.send(alertScript(Message.NOT_AUTHENTICATED));
  } catch (err) {
    console.log("Error checkAuthSession:", err);
    res.send(alertScript(Message.SOMETHING_WENT_WRONG));
  }
};

libraryController.verifyLibrary = (
  req: AdminRequest,
  res: Response,
  next: NextFunction
) => {
  if (req.session?.member?.memberType === MemberType.LIBRARY) {
    req.member = req.session.member;
    // console.log("req.session: ", req.session.member);
    next();
  } else {
    res.status(HttpCode.UNAUTHORIZED).send(alertScript(Message.NOT_AUTHENTICATED, "/admin/login"));
  }
};

export default libraryController;
