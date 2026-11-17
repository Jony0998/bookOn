import { ObjectId } from "mongoose";

import {
  ProductCollection,
  ProductLanguage,
  ProductShelf,
  ProductStatus,
} from "./enums/product.enum";

export interface Product {
  _id: ObjectId;
  productStatus: ProductStatus;
  productCollection: ProductCollection;
  productName: string;
  productAuthor: string;
  productPrice: number;
  productDiscountPrice?: number;
  productLeftCount: number;
  productIsbn?: string;
  productPublisher?: string;
  productPublishYear?: number;
  productPages?: number;
  productLanguage: ProductLanguage;
  productShelves: ProductShelf[];
  productDesc?: string;
  productImages: string[];
  productViews: number;
  productLikes: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductInquiry {
  order: string;
  page: number;
  limit: number;
  productCollection?: ProductCollection;
  productLanguage?: ProductLanguage;
  shelf?: ProductShelf;
  search?: string;
}

/** Fields the admin may set; views, likes and timestamps are server-owned */
export interface ProductInput {
  productStatus?: ProductStatus;
  productCollection: ProductCollection;
  productName: string;
  productAuthor: string;
  productPrice: number;
  productDiscountPrice?: number;
  productLeftCount: number;
  productIsbn?: string;
  productPublisher?: string;
  productPublishYear?: number;
  productPages?: number;
  productLanguage?: ProductLanguage;
  productShelves?: ProductShelf[];
  productDesc?: string;
  productImages?: string[];
}

export type ProductUpdateInput = Partial<Omit<ProductInput, "productImages">>;
