import express from "express";
import memberController from "./controllers/member.contoller";
const router = express.Router();


/** Member **/

router.post("/login", memberController.login); // call
router.post("/signup", memberController.signup); // call

export default router;