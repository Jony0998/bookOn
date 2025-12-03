import express from "express";
const routerAdmin = express.Router();
import adminController from "./controllers/admincontroller";
import productController from "./controllers/product.controller";

/**  Admin **/

routerAdmin
 .get("/", adminController.goHome);

routerAdmin
  .get("/login", adminController.getLogin)
  .post("/login", adminController.processLogin);

   routerAdmin
  .get("/signup", adminController.getSignup)
  .post("/signup", adminController.processSignup)

  routerAdmin.get("/logout", adminController.logout);
  routerAdmin.get("/check-me", adminController.checkAuthSession);

  /** Product **/

  routerAdmin.get(
  "/product/all",
  adminController.verifyRestaurant,
  adminController.getAllProducts
);
routerAdmin.post(
  "/product/create",
  adminController.verifyRestaurant,
  // makeUploader("products").array("productImages", 5),
  // uploadProductImage.single('productImage'),
  productController.createNewProduct
);
// routerAdmin.post(
//   "/product/:id",
//   adminController.verifyRestaurant,
//   productController.updateChosenProduct
// );

   /** User **/

export default routerAdmin; 