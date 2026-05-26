import Errors, { HttpCode, Message } from "../libs/types/Errors";
import ProductModel from "../schema/Product.model";
import { T } from "../libs/types/common";
import { ObjectId } from "mongoose";
import { Product, ProductInput, ProductInquiry, ProductUpdateInput } from "../libs/types/product";
import ViewService from "./View.service";
import LikeService from "./Like.service";
import { ProductStatus } from "../libs/types/enums/product.enum";
import { shapeIntoMongooseObjectId } from "../libs/types/config";
import { ViewInput } from "../libs/types/view";
import { ViewGroup } from "../libs/types/enums/view.enum";
import { LikeInput } from "../libs/types/like";
import { LikeGroup } from "../libs/types/enums/like.enum";

class ProductService {
  private readonly productModel;
  public viewService;
  public likeService;

  constructor() {
    this.productModel = ProductModel;
    this.viewService = new ViewService();
    this.likeService = new LikeService();
  }
  /** SPA */

public async getProducts(inquiry: ProductInquiry): Promise<any[]> {
  
  const match: T = {productStatus: ProductStatus.PROCESS};

  if(inquiry.productCollection) 
    match.productCollection = inquiry.productCollection;
  if(inquiry.search) {
    match.productName = { $regex: new RegExp(inquiry.search, "i") };
  }

  const sort: T = inquiry.order === "productPrice" 
   ? { [inquiry.order]: 1 }    // arzondan qimmatga
   : { [inquiry.order]: -1 };

   const result = await this.productModel.aggregate([
     { $match: match },
     { $sort: sort },
     { $skip: (inquiry.page * 1 - 1 ) * inquiry.limit },    // skip for pagination
     { $limit: inquiry.limit * 1 },                        // how many records to return
   ])
     .exec();

     if(!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);

  return result;
}


public async getProduct(
  memberId: ObjectId | null, 
  id: string
): Promise<any> {
    const productId = shapeIntoMongooseObjectId(id);
    
    let result = await this.productModel
    .findOne({
      _id: productId, 
      productStatus: ProductStatus.PROCESS,
    })
      .exec();
   if (!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
 
          if (memberId) {
            // Check Existence
       const input: ViewInput = {
       memberId: memberId,
       viewRefId: productId,
       viewGroup: ViewGroup.PRODUCT,
       };        
       const existView = await this.viewService.checkViewExistence(input);

          if (!existView) {
            await this.viewService.insertMemberView(input);

            // Increase Counts
            result = await this.productModel
            .findByIdAndUpdate(
               productId,
               { $inc: { productViews: 1 } },
               { new: true },
            )
            .exec();

          }

          }

          return result;
}


  /** SSR */

  public async getAllProducts(): Promise<any[]> {
    // string => objectId
    const result = await this.productModel.find().exec();

    if (!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    return result;
  }

  public async createNewProduct(input: ProductInput): Promise<any> {
    try {
      return await this.productModel.create(input);
    } catch (err) {
      console.error("Error, model:createNewProduct", err);
      throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);
    }
  }

  public async likeProduct(memberId: ObjectId, productId: string): Promise<any> {
    const product_id = shapeIntoMongooseObjectId(productId);

    const input: LikeInput = {
      memberId,
      likeRefId: product_id,
      likeGroup: LikeGroup.PRODUCT,
    };

    const existLike = await this.likeService.checkLikeExistence(input);
    const modifier = existLike ? -1 : 1;

    if (existLike) {
      await this.likeService.deleteMemberLike(input);
    } else {
      await this.likeService.insertMemberLike(input);
    }

    return await this.productModel
      .findByIdAndUpdate(product_id, { $inc: { productLikes: modifier } }, { new: true })
      .exec();
  }

  public async updateChosenProduct(
    id: string,
    input: ProductUpdateInput
  ): Promise<any> {
    // string => objectId
    id = shapeIntoMongooseObjectId(id);
    const result = await this.productModel
      .findOneAndUpdate({ _id: id }, input, { new: true })
      .exec();

    if (!result) throw new Errors(HttpCode.NOT_MODIFIED, Message.UPDATE_FAILED);
    return result;
  }
}

export default ProductService;
