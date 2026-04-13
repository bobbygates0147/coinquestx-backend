import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  listUserThreads,
  getUserThread,
  sendUserMessage,
} from "../controllers/supportMessageController.js";

const router = Router();

router.get(
  ["/Message/Threads", "/Messages/Threads", "/message/threads", "/messages/threads"],
  authenticate,
  listUserThreads
);
router.get(
  [
    "/Message/Thread/:threadId",
    "/Messages/Thread/:threadId",
    "/message/thread/:threadId",
    "/messages/thread/:threadId",
  ],
  authenticate,
  getUserThread
);
router.post(
  ["/Message/Send", "/Messages/Send", "/message/send", "/messages/send"],
  authenticate,
  sendUserMessage
);

export default router;
