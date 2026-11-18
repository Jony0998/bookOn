import OrderItemModel from "../schema/OrderItem.model";
import OrderModel from "../schema/Order.model";
import MemberModel from "../schema/Member.model";
import { Member } from "../libs/types/member";
import { OrderInquiry, OrderItemInput, OrderUpdateInput } from "../libs/types/order";
import { shapeIntoMongooseObjectId } from "../libs/types/config";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { Types } from "mongoose";
import { OrderStatus } from "../libs/types/enums/order.enum";
import MemberService from "./Member.service";
import ProductModel from "../schema/Product.model";
import { ProductStatus } from "../libs/types/enums/product.enum";
import { normalizePhone } from "../libs/utils/member-input";

const MAX_ORDER_ITEMS = 50;
const MAX_ITEM_QUANTITY = 100;
export const FREE_SHIPPING_FROM = 100;
export const SHIPPING_FEE = 5;

/**
 * Order lifecycle
 *   PAUSE   placed at checkout, waiting for the library
 *   PROCESS confirmed by the library: copies leave the stock, reader gets 1 point
 *   FINISH  delivered (library or reader marks it)
 *   DELETE  cancelled (reader while PAUSE; library while PAUSE or PROCESS — stock is returned)
 */
const READER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus>> = {
  [OrderStatus.DELETE]: OrderStatus.PAUSE,
  [OrderStatus.FINISH]: OrderStatus.PROCESS,
};
const LIBRARY_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.PROCESS]: [OrderStatus.PAUSE],
  [OrderStatus.FINISH]: [OrderStatus.PROCESS],
  [OrderStatus.DELETE]: [OrderStatus.PAUSE, OrderStatus.PROCESS],
};

export interface CheckoutInput {
  items: OrderItemInput[];
  delivery?: { phone?: unknown; address?: unknown; note?: unknown };
  saveToProfile?: unknown;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

class OrderService {
  private readonly orderModel;
  private readonly orderItemModel;
  private readonly productModel;
  private readonly memberService;

  constructor() {
    this.orderModel = OrderModel;
    this.orderItemModel = OrderItemModel;
    this.productModel = ProductModel;
    this.memberService = new MemberService();
  }

  /**
   * Checkout. Accepts { items, delivery: { phone, address, note }, saveToProfile }.
   * A bare items array (older clients) falls back to the phone/address in the profile.
   */
  public async createOrder(member: Member, body: unknown): Promise<any> {
    const memberId = shapeIntoMongooseObjectId(member._id);
    const checkout: CheckoutInput = Array.isArray(body)
      ? { items: body }
      : ((body && typeof body === "object" ? body : {}) as CheckoutInput);
    const input = checkout.items;

    if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ORDER_ITEMS)
      throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);

    // ---- delivery details
    let phone = "";
    let address = "";
    let note = "";
    if (Array.isArray(body)) {
      const profile = await MemberModel.findById(memberId).select("memberPhone memberAddress").lean().exec();
      phone = profile?.memberPhone ?? "";
      address = profile?.memberAddress ?? "";
    } else {
      phone = normalizePhone(text(checkout.delivery?.phone));
      address = text(checkout.delivery?.address);
      if (address.length < 5 || address.length > 200) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_ADDRESS);
      note = text(checkout.delivery?.note).slice(0, 300);
    }

    // ---- items: merge duplicate lines; client prices are ignored
    const quantities = new Map<string, number>();
    for (const item of input) {
      const quantity = Number(item?.itemQuantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY)
        throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);
      const productId = String(shapeIntoMongooseObjectId(String(item?.productId)));
      quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
    }

    const products = await this.productModel
      .find({
        _id: { $in: Array.from(quantities.keys()).map((id) => new Types.ObjectId(id)) },
        productStatus: ProductStatus.PROCESS,
      })
      .lean()
      .exec();
    if (products.length !== quantities.size)
      throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);
    // Do not accept more copies than the shelf holds
    if (products.some((product) => (quantities.get(String(product._id)) as number) > product.productLeftCount))
      throw new Errors(HttpCode.BAD_REQUEST, Message.OUT_OF_STOCK);

    const items = products.map((product) => ({
      productId: product._id,
      // Charge the sale price when the book is discounted (the admin form enforces discount < price)
      itemPrice:
        product.productDiscountPrice != null && product.productDiscountPrice < product.productPrice
          ? product.productDiscountPrice
          : product.productPrice,
      itemQuantity: quantities.get(String(product._id)) as number,
    }));
    const amount = items.reduce((sum, item) => sum + item.itemPrice * item.itemQuantity, 0);
    const delivery = amount < FREE_SHIPPING_FROM ? SHIPPING_FEE : 0;

    let newOrder;
    try {
      newOrder = await this.orderModel.create({
        orderTotal: amount + delivery,
        orderDelivery: delivery,
        memberId: memberId,
        orderPhone: phone || undefined,
        orderAddress: address || undefined,
        orderNote: note || undefined,
      });
      await this.orderItemModel.insertMany(
        items.map((item) => ({ ...item, orderId: newOrder!._id }))
      );
    } catch (err) {
      console.log("Error, model:createOrder:", err);
      // Do not leave an order without items behind
      if (newOrder) {
        await this.orderModel.deleteOne({ _id: newOrder._id }).exec();
        await this.orderItemModel.deleteMany({ orderId: newOrder._id }).exec();
      }
      throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);
    }

    // Remember the details for next time (best effort: a phone used by another account is skipped)
    if (!Array.isArray(body) && checkout.saveToProfile === true) {
      await MemberModel.updateOne({ _id: memberId }, { $set: { memberAddress: address } }).exec().catch(() => undefined);
      await MemberModel.updateOne({ _id: memberId }, { $set: { memberPhone: phone } }).exec().catch(() => undefined);
    }
    return newOrder;
  }

  public async getMyOrders(member: Member, inquiry: OrderInquiry): Promise<any[]> {
    const memberId = shapeIntoMongooseObjectId(member._id);
    const result = await this.orderModel
      .aggregate([
        { $match: { memberId: memberId, orderStatus: inquiry.orderStatus } },
        { $sort: { updatedAt: -1 } },
        { $skip: (inquiry.page - 1) * inquiry.limit },
        { $limit: inquiry.limit },
        { $lookup: { from: "orderItems", localField: "_id", foreignField: "orderId", as: "orderItems" } },
        { $lookup: { from: "products", localField: "orderItems.productId", foreignField: "_id", as: "productData" } },
      ])
      .exec();
    if (!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    return result;
  }

  /** Reader: cancel a pending order, or mark a confirmed one as received */
  public async updateOrder(member: Member, input: OrderUpdateInput): Promise<any> {
    const memberId = shapeIntoMongooseObjectId(member._id),
      orderId = shapeIntoMongooseObjectId(String(input?.orderId)),
      orderStatus = input?.orderStatus;

    const allowedFrom = READER_TRANSITIONS[orderStatus as OrderStatus];
    if (!allowedFrom) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_STATUS_CHANGE);

    // The status filter makes each transition happen at most once, atomically
    const result = await this.orderModel
      .findOneAndUpdate(
        { memberId: memberId, _id: orderId, orderStatus: allowedFrom },
        { orderStatus: orderStatus },
        { new: true }
      )
      .exec();
    if (!result) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_STATUS_CHANGE);
    return result;
  }

  /** Library (admin panel): confirm, deliver or cancel any order */
  public async updateOrderByLibrary(orderIdRaw: string, target: unknown): Promise<any> {
    const orderId = shapeIntoMongooseObjectId(orderIdRaw);
    const status = target as OrderStatus;
    const from = LIBRARY_TRANSITIONS[status];
    if (!from) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_STATUS_CHANGE);

    // Claim the order first so two clicks can never both apply
    const order = await this.orderModel
      .findOneAndUpdate({ _id: orderId, orderStatus: { $in: from } }, { orderStatus: status }, { new: false })
      .exec();
    if (!order) throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_STATUS_CHANGE);

    if (status === OrderStatus.PROCESS) {
      try {
        await this.takeStock(order._id);
      } catch (err) {
        await this.orderModel.updateOne({ _id: order._id }, { orderStatus: order.orderStatus }).exec();
        throw err;
      }
      await this.orderModel.updateOne({ _id: order._id }, { stockTaken: true }).exec();
      await this.memberService.addUserPoint({ _id: order.memberId } as Member, 1);
    }
    if (status === OrderStatus.DELETE && order.stockTaken) {
      await this.returnStock(order._id);
      await this.orderModel.updateOne({ _id: order._id }, { stockTaken: false }).exec();
    }
    return this.orderModel.findById(order._id).lean().exec();
  }

  /** Removes the order's copies from stock, all or nothing */
  private async takeStock(orderId: any) {
    const items = await this.orderItemModel.find({ orderId }).lean().exec();
    const done: { productId: any; qty: number }[] = [];
    for (const item of items) {
      const res = await this.productModel
        .updateOne(
          { _id: item.productId, productLeftCount: { $gte: item.itemQuantity } },
          { $inc: { productLeftCount: -item.itemQuantity } }
        )
        .exec();
      if (!res.modifiedCount) {
        for (const d of done) await this.productModel.updateOne({ _id: d.productId }, { $inc: { productLeftCount: d.qty } }).exec();
        throw new Errors(HttpCode.BAD_REQUEST, Message.OUT_OF_STOCK);
      }
      done.push({ productId: item.productId, qty: item.itemQuantity });
    }
  }

  private async returnStock(orderId: any) {
    const items = await this.orderItemModel.find({ orderId }).lean().exec();
    for (const item of items)
      await this.productModel.updateOne({ _id: item.productId }, { $inc: { productLeftCount: item.itemQuantity } }).exec();
  }
}

export default OrderService;
