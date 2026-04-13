import { Router } from "express";
import { realEstateController } from "../controllers/realEstateController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/RealEstate/Create", authenticate, realEstateController.create);
router.post("/RealEstate/:id/Complete", authenticate, realEstateController.complete);
router.get("/RealEstate", authenticate, realEstateController.list);
router.get("/RealEstate/:id", authenticate, realEstateController.getById);
router.patch("/RealEstate/:id", authenticate, realEstateController.update);
router.delete("/RealEstate/:id", authenticate, realEstateController.remove);

export default router;
