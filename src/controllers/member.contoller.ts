import { HttpCode } from "../libs/types/Errors";
import { T } from "../libs/types/common";
import { NextFunction, Request, Response } from "express";
import Errors from "../libs/types/Errors";
import MemberService from "../models/Member.service";
import { MemberInput } from "../libs/types/member";
import { Member } from "../libs/types/member";
import { LoginInput } from "../libs/types/member";


const memberController: T = {};
const memberService = new MemberService();

memberController.getRestaurant = async (req: Request, res: Response) => {
  try {
    console.log("getAdmin");
    const result = await memberService.getAdmin();

    res.status(HttpCode.OK).json(result);
  } catch (err) {
    console.log("Error getRestaurant:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};


memberController.signup = async (req: Request, res: Response) => {
  try {
    console.log("signup");

    const input: MemberInput = req.body,
      result: Member = await memberService.signup(input)
      // TOKEN AUTHENTICATION

      res.json({member: result});
    } catch (err) {
      console.log("Error signup:", err);
    // res.json({});
      if (err instanceof Errors) res.status(err.code).json(err);
      else res.status(Errors.standard.code).json(Errors.standard);
  }  
}


memberController.login = async (req: Request, res: Response) => {
  try {
    console.log("login");
    const input: LoginInput = req.body,
    result = await memberService.login(input)
 // TOKEN AUTHENTICATION

    res.json({member: result});
  } catch (err) {
    console.log("Error login:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

export default memberController;