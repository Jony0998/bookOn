import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.join(process.cwd(), process.env.NODE_ENV === "production" ? ".env.production" : ".env"),
  override: false, // PM2/shell dan berilgan PORT va boshqalarni .env ustiga yozmasin
});
// Fail fast instead of running with secrets like "undefined"
const REQUIRED_ENV = ["MONGO_URL", "SESSION_SECRET", "SECRET_TOKEN"];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error("Missing required env variables:", missingEnv.join(", "));
  process.exit(1);
}

import fs from "fs";
import server from "./app";
import mongoose from "mongoose";

mongoose.set("strictQuery", true);

// Ensure uploads directories exist (for production deploy)
const uploadsDir = path.join(process.cwd(), "uploads");
["", "members", "products"].forEach((sub) => {
  const dir = path.join(uploadsDir, sub);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log("Created uploads dir:", dir);
  }
});

mongoose
  // Establish TCP connection to MongoDB
  .connect(process.env.MONGO_URL as string, {})
  .then((data) => {
    console.log("MongoDB connection succeed");
    // PM2 app name (Windows da ecosystem env ba'zan yetkazilmaydi, shuning uchun name orqali ham qarab chiqamiz)
    const appName = process.env.name || "";
    const portFromEnv = Number(process.env.PORT);
    const PORT =
      appName === "BOOKON2"
        ? 3004
        : portFromEnv || (process.env.NODE_ENV === "production" ? 3004 : 3003);

    server.listen(PORT, function () {
      console.info(`Server running at http://localhost:${PORT}/`);
      console.info(`Admin at http://localhost:${PORT}/admin\n`);
    });
  })
  .catch((err) => {
    // Exit so PM2/Docker restarts us instead of running without a listener
    console.error("ERROR on connection MongoDB", err);
    process.exit(1);
  });
