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
import { ParsedProductInput, assertDiscountBelowPrice } from "../libs/utils/product-input";

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
  if (inquiry.productLanguage) match.productLanguage = inquiry.productLanguage;
  if (inquiry.shelf) match.productShelves = inquiry.shelf;
  if(inquiry.search) {
    // Escape user input so it is matched literally (prevents ReDoS / regex injection)
    const escaped = inquiry.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");
    match.$or = [{ productName: pattern }, { productAuthor: pattern }];
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
    assertDiscountBelowPrice(input.productPrice, input.productDiscountPrice);
    try {
      return await this.productModel.create(input);
    } catch (err: any) {
      console.error("Error, model:createNewProduct", err);
      if (err?.code === 11000) throw new Errors(HttpCode.BAD_REQUEST, Message.PRODUCT_ALREADY_EXISTS);
      throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);
    }
  }

  /** Wishlist: active products the member liked, most recently liked first */
  public async getLikedProducts(memberId: ObjectId): Promise<any[]> {
    const ids = await this.likeService.getMemberLikedIds(memberId, LikeGroup.PRODUCT);
    if (!ids.length) return [];
    const products = await this.productModel
      .find({ _id: { $in: ids }, productStatus: ProductStatus.PROCESS })
      .lean()
      .exec();
    const order = new Map(ids.map((id, index) => [String(id), index]));
    return products.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
  }

  public async likeProduct(memberId: ObjectId, productId: string): Promise<any> {
    const product_id = shapeIntoMongooseObjectId(productId);
    // Only active products can be liked; avoids likes pointing at nothing
    const exists = await this.productModel
      .exists({ _id: product_id, productStatus: ProductStatus.PROCESS })
      .exec();
    if (!exists) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);

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

  public async checkUserLiked(memberId: ObjectId, productId: string): Promise<boolean> {
    const product_id = shapeIntoMongooseObjectId(productId);
    const input: LikeInput = { memberId, likeRefId: product_id, likeGroup: LikeGroup.PRODUCT };
    const exists = await this.likeService.checkLikeExistence(input);
    return !!exists;
  }

  public async updateChosenProduct(
    id: string,
    input: ParsedProductInput
  ): Promise<any> {
    const productId = shapeIntoMongooseObjectId(id);
    const set: ProductUpdateInput = input.set;

    const current = await this.productModel.findById(productId).lean().exec();
    if (!current) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);

    // Validate the discount against the price the product will have after the update
    const discount = input.unset.includes("productDiscountPrice")
      ? undefined
      : set.productDiscountPrice ?? current.productDiscountPrice ?? undefined;
    assertDiscountBelowPrice(set.productPrice ?? current.productPrice, discount);

    const update: T = { $set: set };
    if (input.unset.length)
      update.$unset = Object.fromEntries(input.unset.map((key) => [key, 1]));

    try {
      const result = await this.productModel
        .findOneAndUpdate({ _id: productId }, update, { new: true, runValidators: true })
        .exec();
      if (!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
      return result;
    } catch (err: any) {
      if (err instanceof Errors) throw err;
      console.error("Error, model:updateChosenProduct", err);
      if (err?.code === 11000) throw new Errors(HttpCode.BAD_REQUEST, Message.PRODUCT_ALREADY_EXISTS);
      throw new Errors(HttpCode.BAD_REQUEST, Message.UPDATE_FAILED);
    }
  }
}

export default ProductService;
