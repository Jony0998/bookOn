import { Request, Response } from "express";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { T } from "../libs/types/common";
import { AdminRequest, ExtendedRequest } from "../libs/types/member";
import ProductService from "../models/product.service";
import { ProductInput } from "../libs/types/product";

const productService = new ProductService();

const productController: T = {};

/** SSR */

productController.getAllProducts = async (req: Request, res: Response) => {
  try {
    console.log("getAllProducts");
    const data = await productService.getAllProducts();
    // console.log("data:", data);
    res.render("products", { products: data });
  } catch (err) {
    console.log("Error getAllProducts:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

productController.createNewProduct = async (
  req: AdminRequest,
  res: Response
) => {
  try {
    console.log("createNewProduct");
    if (!req.files?.length)
      throw new Errors(HttpCode.INTERNAL_SERVER_ERROR, Message.CREATE_FAILED);

    const data: ProductInput = req.body;
    data.productImages = req.files?.map((ele) => {
      return ele.path;
    });

    if(data.productVolume) {
      data.productVolume = Number(data.productVolume);
    }
    console.log("passed heere boshiga")
    console.log(typeof req.body.productVolume);
    console.log("req.body:", req.body)



    await productService.createNewProduct(data);
    console.log("passed here controller")
    res.send(
      `<script> alert("Successful creation"); window.location.replace('/admin/product/all')</script>`
    );
  } catch (err) {
    console.log("Error createNewProduct:", err);
    const message =
      err instanceof Errors ? err.message : Message.SOMETHING_WENT_WRONG;
    res.send(
      `<script> alert("${message}"); window.location.replace('/admin/product/all')</script>`
    );
  }
};


export default productController;
