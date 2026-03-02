import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path from "path";
import app from "./app";
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
    const PORT = Number(process.env.PORT) || 3003;

    app.listen(PORT, function () {
      console.info(` The server is running successfully on port : http://localhost:${PORT}/`);
      console.info(`Admin project on http://localhost:${PORT}/admin \n`)
    });
  })
  .catch((err) => console.log("ERROR on connection MongoDB", err));
