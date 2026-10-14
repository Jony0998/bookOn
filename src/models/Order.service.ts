import OrderItemModel from "../schema/OrderItem.model";
import OrderModel from "../schema/Order.model";
import { Member } from "../libs/types/member";
import { Order, OrderInquiry, OrderItemInput, OrderUpdateInput } from "../libs/types/order";
import { shapeIntoMongooseObjectId } from "../libs/types/config";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { Types } from "mongoose";
import { OrderStatus } from "../libs/types/enums/order.enum";
import MemberService from "./Member.service";
import ProductModel from "../schema/Product.model";
import { ProductStatus } from "../libs/types/enums/product.enum";

const MAX_ORDER_ITEMS = 50;
const MAX_ITEM_QUANTITY = 100;

/** target status -> status the order must currently have */
const ALLOWED_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus>> = {
  [OrderStatus.PROCESS]: OrderStatus.PAUSE,
  [OrderStatus.DELETE]: OrderStatus.PAUSE,
  [OrderStatus.FINISH]: OrderStatus.PROCESS,
};

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

  public async createOrder(
    member: Member,
    input: OrderItemInput[]
  ): Promise<any> {
    const memberId = shapeIntoMongooseObjectId(member._id);

    if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ORDER_ITEMS)
      throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);

    // Merge duplicate lines and validate quantities; client prices are ignored
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

    const items = products.map((product) => ({
      productId: product._id,
      itemPrice: product.productPrice,
      itemQuantity: quantities.get(String(product._id)) as number,
    }));
    const amount = items.reduce((sum, item) => sum + item.itemPrice * item.itemQuantity, 0);
    const delivery = amount < 100 ? 5 : 0;

    let newOrder;
    try {
      newOrder = await this.orderModel.create({
        orderTotal: amount + delivery,
        orderDelivery: delivery,
        memberId: memberId,
      });
      await this.orderItemModel.insertMany(
        items.map((item) => ({ ...item, orderId: newOrder!._id }))
      );
      return newOrder;
    } catch (err) {
      console.log("Error, model:createOrder:", err);
      // Do not leave an order without items behind
      if (newOrder) {
        await this.orderModel.deleteOne({ _id: newOrder._id }).exec();
        await this.orderItemModel.deleteMany({ orderId: newOrder._id }).exec();
      }
      throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);
    }
  }


  public async getMyOrders(
    member: Member,
    inquiry: OrderInquiry
 ): Promise<any[]> {
    const memberId = shapeIntoMongooseObjectId(member._id);
     const matches = {
         memberId: memberId,
         orderStatus: inquiry.orderStatus 
        };

        const result = await this.orderModel.aggregate([
            {$match: matches},
            {$sort: {updatedAt: -1}},
            {$skip: (inquiry.page -1)*inquiry.limit},
            {$limit: inquiry.limit},
            {

            $lookup: {
              from: "orderItems",
              localField: "_id",
              foreignField: "orderId",
              as: "orderItems",
              },
            },


           {

          $lookup: {
            from: "products",
            localField: "orderItems.productId",
            foreignField: "_id",
            as: "productData",
          }

           }

        ])
           .exec();
        if (!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);

     return result;
}

  public async updateOrder(
    member: Member,
    input: OrderUpdateInput
  ): Promise<any> {
    const memberId = shapeIntoMongooseObjectId(member._id),
      orderId = shapeIntoMongooseObjectId(String(input?.orderId)),
      orderStatus = input?.orderStatus;

    const allowedFrom = ALLOWED_TRANSITIONS[orderStatus as OrderStatus];
    if (!allowedFrom)
      throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_STATUS_CHANGE);

    // The status filter makes each transition happen at most once, atomically
    const result = await this.orderModel
      .findOneAndUpdate(
        { memberId: memberId, _id: orderId, orderStatus: allowedFrom },
        { orderStatus: orderStatus },
        { new: true }
      )
      .exec();

    if (!result)
      throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_STATUS_CHANGE);

    // order status Pause => Process +1
    if (orderStatus === OrderStatus.PROCESS) {
      await this.memberService.addUserPoint(member, 1);
    }

    return result;
  }

}

export default OrderService;