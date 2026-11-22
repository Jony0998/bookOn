/** Tiny helpers shared by the e2e scripts (no test framework needed) */
const path = require("path");
const { spawn } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env"), override: false });
const mongoose = require("mongoose");

let failures = 0;
let passes = 0;

const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
  if (ok) passes++;
  else failures++;
};

const summary = () => {
  console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nALL ${passes} PASSED`);
  return failures ? 1 : 0;
};

/** Connects and refuses to continue unless the database is a *_test one */
const requireTestDb = async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const db = mongoose.connection.db;
  if (!/_test$/.test(db.databaseName)) {
    await mongoose.disconnect();
    throw new Error(`Refusing to run e2e against "${db.databaseName}" (needs a *_test database)`);
  }
  return db;
};

/** Starts the API with ts-node on a spare port; resolves when it listens */
const startServer = async (root, port = 3013) => {
  const child = spawn(process.execPath, [require.resolve("ts-node/dist/bin.js", { paths: [root] }), "src/server.ts"], {
    cwd: root,
    // No mail provider: the server logs links instead of emailing test addresses
    env: { ...process.env, PORT: String(port), NODE_ENV: "development", SMTP_HOST: "", RESEND_API_KEY: "", MAIL_DISABLED: "1" },
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 120 && !log.includes("Server running"); i++) await new Promise((r) => setTimeout(r, 500));
  if (!log.includes("Server running")) {
    child.kill();
    throw new Error("server did not start:\n" + log);
  }
  return {
    api: `http://localhost:${port}`,
    log: () => log,
    stop: async () => {
      child.kill();
      await mongoose.disconnect();
    },
  };
};

module.exports = { check, summary, requireTestDb, startServer };
