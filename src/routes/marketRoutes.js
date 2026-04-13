import { Router } from "express";
import { getSimplePrices } from "../controllers/marketController.js";

const router = Router();

router.get(["/Market/Prices", "/market/prices"], getSimplePrices);

export default router;
