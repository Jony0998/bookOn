import express from "express";
const routerAdmin = express.Router();
import path from "path";
import adminController from "./controllers/admin.controller";

/**  Admin **/
routerAdmin
 .get("/", adminController.getAdmin);

 routerAdmin
  .get("/signup", adminController.getSignup)

routerAdmin
  .get("/login", adminController.getLogin)


export default routerAdmin;