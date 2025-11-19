import { T } from "../libs/types/common";
import { Request, Response } from "express";
import MemberService from "../models/Member.service";


const adminController: T = {};


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
    console.log("getLogin"); // standars
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
    console.log("getSignup"); // standard
  } catch (err) {
    console.log("Error, getSignup:", err);
  }
};

adminController.processSignup = (req: Request, res: Response ) => {
  try {
    console.log("processLogin");
    res.send("done");   
    } catch (err) {
    console.log("Error processLogin:", err);
 
  }
};


export default adminController;