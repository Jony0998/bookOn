import { Request, Response } from "express";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { T } from "../libs/types/common";
import { AdminRequest, ExtendedRequest } from "../libs/types/member";
import ProductService from "../models/Product.service";
import { ProductInput, ProductInquiry } from "../libs/types/product";
import { ProductCollection, ProductLanguage, ProductShelf } from "../libs/types/enums/product.enum";
import { parsePagination } from "../libs/types/config";
import { alertScript } from "../libs/utils/alert";
import { parseProductInput } from "../libs/utils/product-input";
import fs from "fs";
import searchService from "../models/Search.service";
import { normalizeQuery } from "../libs/search/text";

/** Remove uploaded images of a product that was not saved */
const discardUploads = (files?: Express.Multer.File[]) =>
  files?.forEach((file) => fs.unlink(file.path, () => {}));

const productService = new ProductService();

/** Admin labels for the home page "mood" shelves */
const SHELF_LABELS = [
  { value: ProductShelf.CLASSIC, label: "Klassika" },
  { value: ProductShelf.UZBEK_LIT, label: "O'zbek adabiyoti" },
  { value: ProductShelf.GROWTH, label: "O'sish uchun" },
  { value: ProductShelf.EVENING_TEA, label: "Kechki choy bilan" },
];
const PRODUCT_SORT_FIELDS = ["createdAt", "updatedAt", "productPrice", "productViews", "productLikes"];

const productController: T = {};

/** SPA */


/** As-you-type suggestions for the search box (up to 6 books) */
productController.suggest = async (req: Request, res: Response) => {
  try {
    const { items, engine } = await searchService.suggest(normalizeQuery(req.query.q));
    res.setHeader("X-Search-Engine", engine);
    res.setHeader("Cache-Control", "public, max-age=30");
    res.status(HttpCode.OK).json(items);
  } catch (err) {
    console.log("Error suggest", err);
    res.status(Errors.standard.code).json(Errors.standard);
  }
};

productController.getProducts = async (req: Request, res: Response) => {
  try {
    console.log("getProducts");
    const {page, limit, order, productCollection, productLanguage, shelf, search} = req.query;
    const requestedOrder = String(order ?? "");
    const inquiry: ProductInquiry = {
      order: PRODUCT_SORT_FIELDS.includes(requestedOrder) ? requestedOrder : "createdAt",
      ...parsePagination(page, limit, 8, 50),
    };
    // Unknown collections simply match nothing (older clients send legacy values)
    if (productCollection) inquiry.productCollection = String(productCollection) as ProductCollection;
    // Unknown values match nothing rather than erroring, like productCollection
    if (productLanguage) inquiry.productLanguage = String(productLanguage) as ProductLanguage;
    if (shelf) inquiry.shelf = String(shelf) as ProductShelf;

    const query = normalizeQuery(search);
    if (query) {
      // A search is ranked by relevance unless the reader picked another order
      const { items, engine } = await searchService.search({
        query,
        productCollection: inquiry.productCollection,
        productLanguage: inquiry.productLanguage,
        shelf: inquiry.shelf,
        order: PRODUCT_SORT_FIELDS.includes(requestedOrder) ? requestedOrder : "relevance",
        skip: (inquiry.page - 1) * inquiry.limit,
        limit: inquiry.limit,
      });
      res.setHeader("X-Search-Engine", engine);
      return res.status(HttpCode.OK).json(items);
    }

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
    res.render("products", { products: data, shelves: SHELF_LABELS, admin: (req as AdminRequest).session?.member, active: "products" });
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

    const data = parseProductInput(req.body, "create").set as ProductInput;
    data.productImages = req.files.map((ele) => ele.path.replace(/\\/g, "/"));

    await productService.createNewProduct(data);
    res.send(alertScript("Kitob qoʻshildi. U “Toʻxtatilgan” holatda — sotuvga chiqarish uchun holatini “Sotuvda” qiling.", "/admin/product/all"));
  } catch (err) {
    console.log("Error createNewProduct:", err);
    discardUploads(req.files);
    const message =
      err instanceof Errors ? err.message : Message.SOMETHING_WENT_WRONG;
    res.send(alertScript(message, "/admin/product/all"));
  }
};

productController.updateChosenProduct = async (req: Request, res: Response) => {
  try {
    console.log("updateChosenProduct");
    const id = req.params.id;
    const input = parseProductInput(req.body, "update");
    const result = await productService.updateChosenProduct(id, input);

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

productController.getLikedProducts = async (req: ExtendedRequest, res: Response) => {
  try {
    const result = await productService.getLikedProducts(req.member._id);
    res.status(HttpCode.OK).json(result);
  } catch (err) {
    console.log("Error getLikedProducts:", err);
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

