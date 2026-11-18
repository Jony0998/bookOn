import express from "express";
const routerAdmin = express.Router();
import libraryController from "./controllers/library.controller";
import productController from "./controllers/product.controller";
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