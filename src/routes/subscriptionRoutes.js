import { Router } from "express";
import { subscriptionController } from "../controllers/subscriptionController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post(
  "/Subscription/Create",
  authenticate,
  subscriptionController.create
);
router.get("/Subscription", authenticate, subscriptionController.list);
router.get("/Subscription/:id", authenticate, subscriptionController.getById);
router.patch("/Subscription/:id", authenticate, subscriptionController.update);
router.delete("/Subscription/:id", authenticate, subscriptionController.remove);

export default router;
