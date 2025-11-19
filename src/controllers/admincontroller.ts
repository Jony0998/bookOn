import { T } from "../libs/types/common";
import { Request, Response } from "express";
import MemberService from "../models/Member.service";


const adminController: T = {};


adminController.getAdmin = async (req: Request, res: Response) => {
  try {
    res.send("getAdmin");
    console.log("getAdmin");

  } catch (err) {
    console.log("Error, getAdmin:", err);
  }
};

adminController.getSignup = (req: Request, res: Response) => {
  try {
    res.send("signup");
    console.log("getSignup"); // standard
  } catch (err) {
    console.log("Error, getSignup:", err);
  }
};

adminController.getLogin = (req: Request, res: Response) => {
  try {
    console.log("getLogin"); // standars
    res.send("login");
  } catch (err) {
    console.log("Error, getLogin:", err);
  }
};

export default adminController;