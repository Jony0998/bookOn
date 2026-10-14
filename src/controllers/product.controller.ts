import { Request, Response } from "express";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { T } from "../libs/types/common";
import { AdminRequest, ExtendedRequest } from "../libs/types/member";
import ProductService from "../models/Product.service";
import { Product, ProductInput, ProductInquiry } from "../libs/types/product";
import { ProductCollection } from "../libs/types/enums/product.enum";
import { parsePagination } from "../libs/types/config";
import { alertScript } from "../libs/utils/alert";

const productService = new ProductService();
const PRODUCT_SORT_FIELDS = ["createdAt", "updatedAt", "productPrice", "productViews", "productLikes"];

const productController: T = {};

/** SPA */


productController.getProducts = async (req: Request, res: Response) => {
  try {
    console.log("getProducts");
    const {page, limit, order, productCollection, search} = req.query;
    const inquiry: ProductInquiry = {
      order: PRODUCT_SORT_FIELDS.includes(String(order)) ? String(order) : "createdAt",
      ...parsePagination(page, limit, 8, 50),
    };
    // Unknown collections simply match nothing (older clients send legacy values)
    if (productCollection) inquiry.productCollection = String(productCollection) as ProductCollection;
    if (search) inquiry.search = String(search).slice(0, 100);

    const result = await productService.getProducts(inquiry);
    
    
    res.status(HttpCode.OK).json(result);
  } catch (err) {
    console.log("Error getProducts", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};


productController.getProduct = async (req: ExtendedRequest, res: Response) => {
    try {
    console.log("getProduct");
    const { id } = req.params;

    const memberId = req.member?._id ?? null,   //login bo'lmagan user => null
          result = await productService.getProduct(memberId, id);

          res.status(HttpCode.OK).json(result);
  } catch (err) {
    console.log("Error getProduct:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
  
  
}


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
      return ele.path.replace(/\\/g, "/");
    });

    await productService.createNewProduct(data);
    res.send(alertScript("Successful creation", "/admin/product/all"));
  } catch (err) {
    console.log("Error createNewProduct:", err);
    const message =
      err instanceof Errors ? err.message : Message.SOMETHING_WENT_WRONG;
    res.send(alertScript(message, "/admin/product/all"));
  }
};

productController.updateChosenProduct = async (req: Request, res: Response) => {
  try {
    console.log("updateChosenProduct");
    const id = req.params.id;
    // console.log("req.ramas", req.params);

    const result = await productService.updateChosenProduct(id, req.body);

    res.status(HttpCode.OK).json({ data: result });
  } catch (err) {
    console.log("Error updateChosenProduct:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

productController.likeProduct = async (req: ExtendedRequest, res: Response) => {
  try {
    const memberId = req.member?._id;
    const { productId } = req.body;
    const result = await productService.likeProduct(memberId, productId);
    res.status(HttpCode.OK).json(result);
  } catch (err) {
    console.log("Error likeProduct:", err);
    if (err instanceof Errors) res.status(err.code).json(err);
    else res.status(Errors.standard.code).json(Errors.standard);
  }
};

productController.checkUserLiked = async (req: ExtendedRequest, res: Response) => {
  try {
    if (!req.member) { res.status(HttpCode.OK).json({ liked: false }); return; }
    const { productId } = req.query as { productId: string };
    const liked = await productService.checkUserLiked(req.member._id, productId);
    res.status(HttpCode.OK).json({ liked });
  } catch (err) {
    res.status(HttpCode.OK).json({ liked: false });
  }
};

export default productController;

