import mongoose, { Schema } from "mongoose";
import {
  ProductCollection,
  ProductLanguage,
  ProductShelf,
  ProductStatus,
} from "../libs/types/enums/product.enum";

const productSchema = new Schema(
  {
    productStatus: {
      type: String,
      enum: ProductStatus,
      default: ProductStatus.PAUSE,
    },

    productCollection: {
      type: String,
      enum: ProductCollection,
      required: true,
    },

    productName: {
      type: String,
      required: true,
      trim: true,
    },

    productAuthor: {
      type: String,
      required: true,
      trim: true,
    },

    productPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    /** Sale price; shown instead of productPrice when set and lower */
    productDiscountPrice: {
      type: Number,
      min: 0,
    },

    productLeftCount: {
      type: Number,
      required: true,
      min: 0,
    },

    productIsbn: {
      type: String,
      trim: true,
    },

    productPublisher: {
      type: String,
      trim: true,
    },

    productPublishYear: {
      type: Number,
    },

    productPages: {
      type: Number,
      min: 1,
    },

    productLanguage: {
      type: String,
      enum: ProductLanguage,
      default: ProductLanguage.UZ,
    },

    productShelves: {
      type: [{ type: String, enum: Object.values(ProductShelf) }],
      default: [],
    },

    productDesc: {
      type: String,
    },

    productImages: {
      type: [String],
      default: [],
    },

    productViews: {
      type: Number,
      default: 0,
    },
    productLikes: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true } // updateAt , createAt
);

// The same title may exist in several languages, but not twice in one language
productSchema.index(
  { productName: 1, productAuthor: 1, productLanguage: 1 },
  { unique: true }
);
// ISBN identifies one edition; only enforced when it is filled in
productSchema.index(
  { productIsbn: 1 },
  { unique: true, partialFilterExpression: { productIsbn: { $type: "string" } } }
);

export default mongoose.model("Product", productSchema);
