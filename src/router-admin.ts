import express from "express";
const routerAdmin = express.Router();
import path from "path";
import adminController from "./controllers/admincontroller";

/**  Admin **/

routerAdmin
 .get("/", adminController.goHome);

routerAdmin
  .get("/login", adminController.getLogin)
  .post("/login", adminController.processLogin);

   routerAdmin
  .get("/signup", adminController.getSignup)
  .post("/signup", adminController.processSignup)

  /** Product **/

   /** User **/

export default routerAdmin;