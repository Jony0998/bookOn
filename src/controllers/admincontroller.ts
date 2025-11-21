import { T } from "../libs/types/common";
import { Request, Response } from "express";
import MemberService from "../models/Member.service";
import { MemberInput } from "../libs/types/member";
import { MemberType } from "../libs/types/enums/member.enum";


const adminController: T = {};
const memberService = new MemberService();

adminController.goHome = async (req: Request, res: Response) => {
  try {
    res.send("goHome");
    console.log("Home Page");

  } catch (err) {
    console.log("Error, goHome:", err);
  }
};


adminController.getLogin = (req: Request, res: Response) => {
  try {
    console.log("getLogin"); 
    res.send("login");
  } catch (err) {
    console.log("Error, getLogin:", err);
  }
};

adminController.processLogin = (req: Request, res: Response ) => {
  try {
    console.log("processLogin");
    res.send("done");   
    } catch (err) {
    console.log("Error processLogin:", err);
 
  }
};

adminController.getSignup = (req: Request, res: Response) => {
  try {
    res.send("signup");
    console.log("getSignup"); 
  } catch (err) {
    console.log("Error, getSignup:", err);
  }
};

adminController.processSignup = async (req: Request, res: Response ) => {
  try {
    console.log("processSignup");
    console.log("body:", req.body);

    const newMember: MemberInput = req.body;
    newMember.memberType = MemberType.ADMIN;
    const result = await memberService.processSignup(newMember);
    res.send(result);   
    } catch (err) {
    console.log("Error processSignup:", err);
 
  }
};


export default adminController;