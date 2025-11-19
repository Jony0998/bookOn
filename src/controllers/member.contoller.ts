import { T } from "../libs/types/common";
import { NextFunction, Request, Response } from "express";


const memberController: T = {};


memberController.getAdmin = async (req: Request, res: Response) => {
  try {
    res.send("getAdmin");
    console.log("getAdmin");

  } catch (err) {
    console.log("Error getRestaurant:", err);
  }
};

export default memberController;