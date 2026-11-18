// Controllers are implemented as objects; import common types from libs.
import { CookieOptions, NextFunction, Request, Response } from "express";
import { T } from "../libs/types/common";
import MemberService from "../models/Member.service";
import {
  ExtendedRequest,
  Member,
  MemberInput,
  MemberUpdateInput,
  SpaLoginInput,
} from "../libs/types/member";
import AuthService from "../models/Auth.service";
import AuthTokenService from "../models/AuthToken.service";
import { AuthTokenType } from "../schema/AuthToken.model";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { AUTH_TIMER, pickFields } from "../libs/types/config";
import { assertNick, assertPassword, normalizeEmail, normalizePhone } from "../libs/utils/member-input";
import { publicUrl, sendAuthMail, toMailLang } from "../libs/utils/mailer";

import fs from "fs";

const memberService = new MemberService();
const authService = new AuthService();
const authTokenService = new AuthTokenService();

const memberController: T = {};

/** Auth cookie: httpOnly, SameSite=Lax, Secure whenever the request came over HTTPS */
const authCookieOptions = (req: Request): CookieOptions => ({
  maxAge: AUTH_TIMER * 3600 * 1000,
  httpOnly: true,
  sameSite: "lax",
  secure: req.secure,
  path: "/",
});

memberController.getLibrary = async (req: Request, res: Response) => {
  try {
    console.log("getLibrary");
    const result = await memberService.getLibrary();

    res.status(HttpCode.OK).json(result);
  } catch (err) {
    console.log("Error getLibrary:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

/** Sends a verify-email link; returns whether a mail actually went out */
const sendVerification = async (member: Member, lang: unknown): Promise<boolean> => {
  if (!member.memberEmail) return false;
  const raw = await authTokenService.issue(member._id, AuthTokenType.VERIFY_EMAIL);
  const link = `${publicUrl()}/verify-email?token=${encodeURIComponent(raw)}`;
  return sendAuthMail("verify", member.memberEmail, member.memberNick, link, toMailLang(lang));
};

memberController.signup = async (req: Request, res: Response) => {
  try {
    console.log("signup");

    // Never trust memberType/memberStatus/memberPoints/memberEmailVerified from the client
    const fields = pickFields(req.body, ["memberPhone", "memberAddress", "memberDesc"] as const);
    const input: MemberInput = {
      memberNick: assertNick(req.body?.memberNick),
      memberEmail: normalizeEmail(req.body?.memberEmail),
      memberPassword: assertPassword(req.body?.memberPassword),
    };
    if (fields.memberPhone) input.memberPhone = normalizePhone(fields.memberPhone);
    if (fields.memberAddress) input.memberAddress = fields.memberAddress.slice(0, 200);
    if (fields.memberDesc) input.memberDesc = fields.memberDesc.slice(0, 500);

    const result: Member = await memberService.signup(input),
      token = await authService.createToken(result);
    // The account works right away; a failed email must not fail the signup
    const emailSent = await sendVerification(result, req.body?.lang).catch(() => false);

    res.cookie("accessToken", token, authCookieOptions(req));

    res.status(HttpCode.CREATED).json({ member: result, accessToken: token, emailSent });
  } catch (err) {
    console.log("Error signup:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

memberController.login = async (req: Request, res: Response) => {
  try {
    console.log("login");
    // Coerce to strings so objects like {"$ne": null} never reach the query.
    // `memberNick` is still accepted from older clients.
    const input: SpaLoginInput = {
        login: String(req.body?.login ?? req.body?.memberNick ?? ""),
        memberPassword: String(req.body?.memberPassword ?? ""),
      },
      result = await memberService.login(input),
      token = await authService.createToken(result);

    res.cookie("accessToken", token, authCookieOptions(req));

    res.status(HttpCode.OK).json({ member: result, accessToken: token });
  } catch (err) {
    console.log("Error login:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

// LogOut

memberController.logout = (req: ExtendedRequest, res: Response) => {
  try {
    console.log("logout");
    const { maxAge, ...clearOptions } = authCookieOptions(req);
    res.clearCookie("accessToken", clearOptions);
    res.status(HttpCode.OK).json({ logout: true });
  } catch (err) {
    console.log("Error logout:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

memberController.getMemberDetail = async (
  req: ExtendedRequest,
  res: Response
) => {
  try {
    console.log("getMemberDetail");
    const result = await memberService.getMemberDetail(req.member);

    res.status(HttpCode.OK).json(result);
  } catch (err) {
    console.log("Error getMemberDetail:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

memberController.updateMember = async (
  req: ExtendedRequest, 
  res: Response) => {
  try {
    console.log("updateMember");
    // Users may only change their own profile fields
    const fields = pickFields(req.body, [
      "memberNick",
      "memberPhone",
      "memberEmail",
      "memberAddress",
      "memberDesc",
    ] as const);
    if (fields.memberNick === "") throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);

    const current = await memberService.getMemberDetail(req.member);
    const input: MemberUpdateInput = {};
    const unset: (keyof MemberUpdateInput)[] = [];

    // Existing usernames may predate the current rules; only a changed nick is checked
    if (fields.memberNick !== undefined && fields.memberNick !== current.memberNick)
      input.memberNick = assertNick(fields.memberNick);
    // Only a changed phone is validated: older accounts may hold free text there
    // (the library account had "Jony"), which must not block saving other fields.
    // Empty optional fields are removed (an empty phone would clash in the unique index).
    if (fields.memberPhone !== undefined && fields.memberPhone !== (current.memberPhone ?? "")) {
      if (fields.memberPhone) input.memberPhone = normalizePhone(fields.memberPhone);
      else unset.push("memberPhone");
    }
    if (fields.memberAddress !== undefined) input.memberAddress = fields.memberAddress.slice(0, 200);
    if (fields.memberDesc !== undefined) input.memberDesc = fields.memberDesc.slice(0, 500);

    let emailChanged = false;
    if (fields.memberEmail !== undefined) {
      const email = fields.memberEmail ? normalizeEmail(fields.memberEmail) : "";
      if (email !== (current.memberEmail ?? "")) {
        emailChanged = !!email;
        if (email) input.memberEmail = email;
        else unset.push("memberEmail");
        input.memberEmailVerified = false;
      }
    }

    if (req.file) input.memberImage = req.file.path.replace(/\\/g, "/");
    const result = await memberService.updateMember(req.member, input, unset);
    if (emailChanged) {
      await authTokenService.revokeAll(result._id, AuthTokenType.VERIFY_EMAIL);
      await sendVerification(result, req.body?.lang).catch(() => false);
    }

    res.status(HttpCode.OK).json(result);
  } catch (err) {
    console.log("Error updateMember:", err);
    // The upload was not saved to the profile: do not leave the file behind
    if (req.file) fs.unlink(req.file.path, () => {});
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

memberController.getMemberPublic = async (req: Request, res: Response) => {
  try {
    const { memberId } = req.params;
    const result = await memberService.getMemberPublic(memberId);
    res.status(HttpCode.OK).json(result);
  } catch (err) {
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

memberController.getTopUsers = async (req: Request, res: Response) => {
   try {
    console.log("getTopUsers");

    const result = await memberService.getTopUsers();

    res.status(HttpCode.OK).json(result);
  } catch (err) {
    console.log("Error getTopUsers:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

/** EMAIL: verify, resend, forgot / reset password **/

memberController.verifyEmail = async (req: Request, res: Response) => {
  try {
    const memberId = await authTokenService.consume(req.body?.token, AuthTokenType.VERIFY_EMAIL);
    await memberService.markEmailVerified(memberId);
    res.status(HttpCode.OK).json({ verified: true });
  } catch (err) {
    console.log("Error verifyEmail:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

memberController.resendVerification = async (req: ExtendedRequest, res: Response) => {
  try {
    const member = await memberService.getMemberDetail(req.member);
    if (!member.memberEmail) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_EMAIL);
    if (member.memberEmailVerified) {
      res.status(HttpCode.OK).json({ alreadyVerified: true });
      return;
    }
    const emailSent = await sendVerification(member, req.body?.lang);
    res.status(HttpCode.OK).json({ emailSent });
  } catch (err) {
    console.log("Error resendVerification:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

memberController.forgotPassword = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.memberEmail);
    const member = await memberService.findActiveByEmail(email);
    if (member) {
      try {
        const raw = await authTokenService.issue(member._id, AuthTokenType.RESET_PASSWORD);
        const link = `${publicUrl()}/reset-password?token=${encodeURIComponent(raw)}`;
        await sendAuthMail("reset", email, member.memberNick, link, toMailLang(req.body?.lang));
      } catch (err) {
        // Cooldown hit: stay silent so the answer never reveals whether the email exists
        if (!(err instanceof Errors && err.code === HttpCode.TOO_MANY_REQUESTS)) throw err;
      }
    }
    // Same answer whether or not the address is registered
    res.status(HttpCode.OK).json({ sent: true });
  } catch (err) {
    console.log("Error forgotPassword:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

memberController.resetPassword = async (req: Request, res: Response) => {
  try {
    const password = assertPassword(req.body?.memberPassword);
    const memberId = await authTokenService.consume(req.body?.token, AuthTokenType.RESET_PASSWORD);
    await memberService.setPassword(memberId, password);
    await authTokenService.revokeAll(memberId, AuthTokenType.RESET_PASSWORD);
    res.status(HttpCode.OK).json({ reset: true });
  } catch (err) {
    console.log("Error resetPassword:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

memberController.changePassword = async (req: ExtendedRequest, res: Response) => {
  try {
    const next = assertPassword(req.body?.newPassword);
    await memberService.changePassword(req.member._id, String(req.body?.currentPassword ?? ""), next);
    // Any reset link still in someone's inbox should not undo this
    await authTokenService.revokeAll(req.member._id, AuthTokenType.RESET_PASSWORD);
    res.status(HttpCode.OK).json({ changed: true });
  } catch (err) {
    console.log("Error changePassword:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

memberController.verifyAuth = async (
  req: ExtendedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.cookies["accessToken"];
    if (token) req.member = await authService.checkAuth(token);
    if (!req.member)
      throw new Errors(HttpCode.UNAUTHORIZED, Message.NOT_AUTHENTICATED);

    next();
  } catch (err) {
    console.log("Error verifyAuth:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

memberController.retrieveAuth = async (
  req: ExtendedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.cookies["accessToken"];
    if (token) req.member = await authService.checkAuth(token);

    next();
  } catch (err) {
    console.log("Error retrieveAuth:", err);
    next();
  }
};

export default memberController;
