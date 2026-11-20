import express from "express";
const routerAdmin = express.Router();
import libraryController from "./controllers/library.controller";
import productController from "./controllers/product.controller";
import orderController from "./controllers/order.controller";
import articleController from "./controllers/article.controller";
import makeUploader from "./libs/utils/uploader";
import OrderModel from "./schema/Order.model";
import { OrderStatus } from "./libs/types/enums/order.enum";
import { MemberType } from "./libs/types/enums/member.enum";

/** Sidebar badge: pending orders, for every admin page of a signed-in library */
routerAdmin.use(async (req, res, next) => {
  try {
    const member = (req.session as any)?.member;
    if (member?.memberType === MemberType.LIBRARY)
      res.locals.pendingCount = await OrderModel.countDocuments({ orderStatus: OrderStatus.PAUSE }).exec();
  } catch {
    /* the badge is optional */
  }
  next();
});

/**  Admin **/

routerAdmin
 .get("/", libraryController.goHome);

routerAdmin
  .get("/login", libraryController.getLogin)
  .post("/login", libraryController.processLogin);

routerAdmin
  .get("/signup", libraryController.getSignup)
  .post(
    "/signup",
    makeUploader("members").single("memberImage"),
    libraryController.processSignup
  );

  routerAdmin.get("/logout", libraryController.logout);
  routerAdmin.get("/check-me", libraryController.checkAuthSession);

  /** Product **/

  routerAdmin.get(
  "/product/all",
  libraryController.verifyLibrary,
  productController.getAllProducts
);
routerAdmin.post(
  "/product/create",
  libraryController.verifyLibrary,
   makeUploader("products").array("productImages", 5),
  // uploadProductImage.single('productImage'),
  productController.createNewProduct
);
routerAdmin.post(
  "/product/:id",
  libraryController.verifyLibrary,
  productController.updateChosenProduct
);

  /** Order **/

  routerAdmin.get("/order/all", libraryController.verifyLibrary, libraryController.getOrders);
  routerAdmin.post("/order/:id/status", libraryController.verifyLibrary, orderController.updateOrderByLibrary);

  /** Article (news) **/

  const articleUpload = makeUploader("articles").single("articleImage");
  routerAdmin.get("/article/all", libraryController.verifyLibrary, articleController.adminList);
  routerAdmin.get("/article/new", libraryController.verifyLibrary, articleController.adminNew);
  routerAdmin.get("/article/:id/edit", libraryController.verifyLibrary, articleController.adminEdit);
  routerAdmin.post("/article/create", libraryController.verifyLibrary, articleUpload, articleController.adminCreate);
  routerAdmin.post("/article/:id/status", libraryController.verifyLibrary, articleController.adminStatus);
  routerAdmin.post("/article/:id/delete", libraryController.verifyLibrary, articleController.adminDelete);
  routerAdmin.post("/article/:id", libraryController.verifyLibrary, articleUpload, articleController.adminUpdate);

   /** User **/

   routerAdmin.get(
  "/user/all",
  libraryController.verifyLibrary,
  libraryController.getUsers
);

routerAdmin.post(
  "/user/edit",
  libraryController.verifyLibrary,
  libraryController.updateChosenUser
);

export default routerAdmin; 