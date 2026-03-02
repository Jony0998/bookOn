import mongoose, { Schema } from "mongoose";
import {
  ProductCollection,
  ProductSize,
  ProductWeight,
} from "../libs/types/enums/product.enum";
import { ProductStatus } from "../libs/types/enums/product.enum";

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
    },
    productPrice: {
      type: Number,
      required: true,
    },

    productLeftCount: {
      type: Number,
      required: true,
    },

    productSize: {
      type: String,
      enum: ProductSize,
      default: ProductSize.MEDIUM,
    },

    productVolume: {
      type: String,
      enum: ProductWeight,
      default: ProductWeight.MEDIUM,
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
  },
  { timestamps: true } // updateAt , createAt
);

productSchema.index(
  {
    productName: 1,
    productSize: 1,
    productVolume: 1,
  },
  {
    unique: true,
  }
);

export default mongoose.model("Product", productSchema);
