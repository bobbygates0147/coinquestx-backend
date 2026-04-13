import mongoose from "mongoose";
import { env } from "./env.js";

export const connectDb = async () => {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI);
  console.log("MongoDB connected");
};
