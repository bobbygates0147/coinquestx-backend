import { Router } from "express";
import { getChatReply } from "../controllers/chatController.js";
import { optionalAuthenticate } from "../middleware/auth.js";

const router = Router();

router.post("/Chat/Reply", optionalAuthenticate, getChatReply);

export default router;

