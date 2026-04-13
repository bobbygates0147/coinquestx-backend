import { Router } from "express";
import { signalController } from "../controllers/signalController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/Signal/Create", authenticate, signalController.create);
router.get("/Signal", authenticate, signalController.list);
router.get("/Signal/:id", authenticate, signalController.getById);
router.patch("/Signal/:id", authenticate, signalController.update);
router.delete("/Signal/:id", authenticate, signalController.remove);

export default router;
