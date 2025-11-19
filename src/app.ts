
import express from "express";
import path from "path";
import session from "express-session";
import ConnectMongoDB from "connect-mongodb-session";
import router from "./router";

const MongoDBStore = ConnectMongoDB(session);
const store = new MongoDBStore({
  uri: String(process.env.MONGO_URL),
  collection: "sessions",
}); 

/** 1-ENTERANCE **/
const app = express();
app.use(express.static(path.join(__dirname, "public"))); // Traditional api
app.use("/uploads", express.static(path.join(__dirname, '../uploads')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // REST API

/** 2-SESSIONS **/


/** 3-VIEWS **/
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");


/** 4-ROUTERS **/
app.use("/", router); // SPA: REACT


export default app;


