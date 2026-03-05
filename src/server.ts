import dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.join(process.cwd(), process.env.NODE_ENV === "production" ? ".env.production" : ".env"),
});
import fs from "fs";
import server from "./app";
import mongoose from "mongoose";

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
    // const PORT = process.env.PORT ?? 3003;
    const PORT = Number(process.env.PORT) || (process.env.NODE_ENV === "production" ? 3004 : 3003);

    server.listen(PORT, function () {
      console.info(`Server running at http://localhost:${PORT}/`);
      console.info(`Admin at http://localhost:${PORT}/admin\n`);
    });
  })
  .catch((err) => console.log("ERROR on connection MongoDB", err));
