
import express from "express";
import path from "path";
import session from "express-session";
import ConnectMongoDB from "connect-mongodb-session";
import router from "./router";
import routerAdmin from "./router-admin";
import morgan from "morgan";
import { MORGAN_FORMAT } from "./libs/config";


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
app.use(morgan(MORGAN_FORMAT));


/** 2-SESSIONS **/
app.use(
  session({
    secret: String(process.env.SESSION_SECRET),
    cookie: {
      maxAge: 1000 * 3600 * 6, // 6hr
    },
    store: store,
    resave: true,   // har kirganda yangilaydi
    saveUninitialized: true,
  })
);

/** 3-VIEWS **/
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");


/** 4-ROUTERS **/
app.use("/admin", routerAdmin); // SSR: EJS
app.use("/", router); // SPA: REACT


export default app;


