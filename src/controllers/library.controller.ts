// Controllers are implemented as objects; import common types from libs.
import { NextFunction, Request, Response } from "express";
import { T } from "../libs/types/common";
import MemberService from "../models/Member.service";
import { AdminRequest, LoginInput, MemberInput } from "../libs/types/member";
import { MemberType } from "../libs/types/enums/member.enum";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { pickFields } from "../libs/types/config";
const memberService = new MemberService();

const libraryController: T = {};
libraryController.goHome = (req: Request, res: Response) => {
  try {
    console.log("goHome");
    res.render("home");
    // send | json | redirect | end | render
  } catch (err) {
    console.log("Error, getHome:", err);
    res.redirect("/admin");
  }
};

libraryController.getSignup = (req: Request, res: Response) => {
  try {
    res.render("signup");
    console.log("getSignup");
  } catch (err) {
    console.log("Error getSignup:", err);
  }
};

libraryController.getLogin = (req: Request, res: Response) => {
  try {
    console.log("getLogin");
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
    res.send(
      `<script> alert("${message}"); window.location.replace('/admin/signup') </script>`
    );
  }
};

libraryController.processLogin = async (
  req: AdminRequest,
  res: Response
) => {
  try {
    console.log("processLogin");
    console.log("body:", req.body);
    const input: LoginInput = req.body;
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
    res.send(
      `<script> alert("${message}"); window.location.replace('/admin/login') </script>`
    );
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
    res.render("users", { users: result });
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
      res.send(`<script> alert("${req.session.member.memberNick}") </script>`);
    else res.send(`<script> alert("${Message.NOT_AUTHENTICATED}") </script>`);
  } catch (err) {
    res.send(err);
    console.log("Error checkAuthSession:", err);
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
    const message = Message.NOT_AUTHENTICATED;
    res.send(
      `<script> alert("${message}"); window.location.replace('/admin/login'); </script>`
    );
  }
};

export default libraryController;
