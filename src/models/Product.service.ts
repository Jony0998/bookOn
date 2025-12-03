import Errors, { HttpCode, Message } from "../libs/types/Errors";

import ProductModel from "../schema/Product.model";
import { T } from "../libs/types/common";
import { ObjectId } from "mongoose";
import { shapeIntoMongooseObjectId } from "../libs/config";
import { Product, ProductInput } from "../libs/types/product";

class ProductService {
  private readonly productModel;

  constructor() {
    this.productModel = ProductModel;

  }


/** SSR */

  public async getAllProducts(): Promise<Product[]> {
    // string => objectId
    const result = await this.productModel.find().lean<Product[]>().exec();

    if (!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    return result;
  }

  public async createNewProduct(input: ProductInput): Promise<Product[]> {
    try {
    console.log("passed here1")

      return await this.productModel.create(input);

    } catch (err) {
      console.log("passed here error")

      console.log("Error, model:createNewProduct", err);
      throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);
    }
  }

}

export default ProductService;
