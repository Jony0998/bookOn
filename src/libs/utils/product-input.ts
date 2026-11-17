import Errors, { HttpCode, Message } from "../types/Errors";
import {
  ProductCollection,
  ProductLanguage,
  ProductShelf,
  ProductStatus,
} from "../types/enums/product.enum";
import { ProductInput } from "../types/product";

/**
 * Whitelists and validates admin product input (multipart form or JSON).
 * Anything not listed here (views, likes, _id, ...) is silently dropped.
 */

type Mode = "create" | "update";

export interface ParsedProductInput {
  set: Partial<ProductInput>;
  /** optional fields the admin cleared (update only) */
  unset: (keyof ProductInput)[];
}

const STRING_FIELDS = {
  productName: { max: 200, required: true },
  productAuthor: { max: 120, required: true },
  productPublisher: { max: 120, required: false },
  productDesc: { max: 5000, required: false },
} as const;

const NUMBER_FIELDS = {
  productPrice: { min: 0, max: 100_000_000, integer: false, required: true },
  productLeftCount: { min: 0, max: 1_000_000, integer: true, required: true },
  productDiscountPrice: { min: 0, max: 100_000_000, integer: false, required: false },
  productPages: { min: 1, max: 20_000, integer: true, required: false },
  productPublishYear: { min: 1450, max: new Date().getFullYear() + 1, integer: true, required: false },
} as const;

const ENUM_FIELDS = {
  productStatus: { values: Object.values(ProductStatus), required: false },
  productCollection: { values: Object.values(ProductCollection), required: true },
  productLanguage: { values: Object.values(ProductLanguage), required: false },
} as const;

const invalid = () => new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);

const isBlank = (value: unknown) =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "");

/** "978-0-13-468599-1" -> "9780134685991"; accepts ISBN-10 and ISBN-13 */
export const normalizeIsbn = (value: string): string => {
  const isbn = value.replace(/[\s-]/g, "").toUpperCase();
  if (!/^(\d{9}[\dX]|97[89]\d{10})$/.test(isbn)) throw invalid();
  return isbn;
};

export const parseProductInput = (body: unknown, mode: Mode): ParsedProductInput => {
  const source: Record<string, unknown> =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const set: Record<string, unknown> = {};
  const unset: (keyof ProductInput)[] = [];

  const handleBlank = (key: keyof ProductInput, required: boolean) => {
    if (required) {
      // Required fields must be present on create and may not be cleared on update
      if (mode === "create" || key in source) throw invalid();
    } else if (mode === "update" && key in source) {
      unset.push(key);
    }
  };

  for (const [key, rule] of Object.entries(STRING_FIELDS)) {
    const value = source[key];
    if (isBlank(value)) { handleBlank(key as keyof ProductInput, rule.required); continue; }
    if (typeof value !== "string" || value.trim().length > rule.max) throw invalid();
    set[key] = value.trim();
  }

  for (const [key, rule] of Object.entries(NUMBER_FIELDS)) {
    const value = source[key];
    if (isBlank(value)) { handleBlank(key as keyof ProductInput, rule.required); continue; }
    const num = Number(value);
    if (!Number.isFinite(num) || num < rule.min || num > rule.max) throw invalid();
    if (rule.integer && !Number.isInteger(num)) throw invalid();
    set[key] = num;
  }

  for (const [key, rule] of Object.entries(ENUM_FIELDS)) {
    const value = source[key];
    if (isBlank(value)) { handleBlank(key as keyof ProductInput, rule.required); continue; }
    if (!(rule.values as readonly unknown[]).includes(value)) throw invalid();
    set[key] = value;
  }

  // Checkbox groups arrive as a string (one ticked), an array, or not at all.
  // The admin forms send an empty marker "" so "none ticked" can clear the list.
  const shelves = source.productShelves;
  if (shelves !== undefined) {
    const list = (Array.isArray(shelves) ? shelves : [shelves]).filter((v) => v !== "");
    const allowed = Object.values(ProductShelf) as unknown[];
    if (!list.every((v) => allowed.includes(v))) throw invalid();
    set.productShelves = Array.from(new Set(list)) as ProductShelf[];
  }

  const isbn = source.productIsbn;
  if (isBlank(isbn)) handleBlank("productIsbn", false);
  else if (typeof isbn !== "string") throw invalid();
  else set.productIsbn = normalizeIsbn(isbn);

  return { set: set as Partial<ProductInput>, unset };
};

/** A discount only makes sense when it is below the regular price */
export const assertDiscountBelowPrice = (price?: number, discount?: number) => {
  if (price !== undefined && discount !== undefined && discount >= price) throw invalid();
};
