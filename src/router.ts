import express from "express";
import memberController from "./controllers/member.contoller";
const router = express.Router();

router.get("/", memberController.getAdmin)

export default router;