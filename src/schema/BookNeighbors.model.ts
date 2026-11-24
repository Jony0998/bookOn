import mongoose, { Schema } from "mongoose";

/** Why a book is recommended next to another one (shown to readers) */
export enum NeighborReason {
  TOGETHER = "TOGETHER", // readers who took one also took the other
  AUTHOR = "AUTHOR",
  GENRE = "GENRE",
  SIMILAR = "SIMILAR", // shelves / language
}

/**
 * Precomputed "similar books" for one book (the _id is the book id). Rebuilt
 * by Recommendation.service in the background, so pages only read.
 */
const neighborSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    score: { type: Number, required: true },
    reason: { type: String, enum: Object.values(NeighborReason), required: true },
  },
  { _id: false }
);

const bookNeighborsSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, ref: "Product" },
    neighbors: { type: [neighborSchema], default: [] },
    computedAt: { type: Date, required: true },
  },
  { versionKey: false }
);

export default mongoose.model("BookNeighbors", bookNeighborsSchema, "bookNeighbors");
