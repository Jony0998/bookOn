import mongoose, { Schema } from "mongoose";
import { OrderStatus } from "../libs/types/enums/order.enum";

const orderSchema = new Schema(
  {
    orderTotal: {
      type: Number,
      required: true,
    },

    orderDelivery: {
      type: Number,
      required: true,
    },

    orderStatus: {
      type: String,
      enum: OrderStatus,
      default: OrderStatus.PAUSE,
    },

    memberId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Member",
    },

    /** Delivery details captured at checkout; later profile edits don't change them */
    orderPhone: { type: String, trim: true },
    orderAddress: { type: String, trim: true },
    orderNote: { type: String, trim: true },

    /** Set when the library confirms the order and the copies leave the stock */
    stockTaken: { type: Boolean, default: false },
  },
  { timestamps: true }
);

orderSchema.index({ orderStatus: 1, createdAt: -1 });

export default mongoose.model("Order", orderSchema);
