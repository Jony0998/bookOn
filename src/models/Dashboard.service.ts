import MemberModel from "../schema/Member.model";
import ProductModel from "../schema/Product.model";
import OrderModel from "../schema/Order.model";
import { MemberStatus, MemberType } from "../libs/types/enums/member.enum";
import { ProductStatus } from "../libs/types/enums/product.enum";
import { OrderStatus } from "../libs/types/enums/order.enum";

export const LOW_STOCK = 10;
const DAY = 24 * 3600 * 1000;

/** Read-only figures for the admin panel (single library shop) */
class DashboardService {
  public async getSummary() {
    const since30 = new Date(Date.now() - 30 * DAY);
    const since7 = new Date(Date.now() - 7 * DAY);

    const [productStats, memberStats, orderStats, revenue, revenue30, lowStock, topViewed, recentOrders] = await Promise.all([
      ProductModel.aggregate([
        { $match: { productStatus: { $ne: ProductStatus.DELETE } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ["$productStatus", ProductStatus.PROCESS] }, 1, 0] } },
            paused: { $sum: { $cond: [{ $eq: ["$productStatus", ProductStatus.PAUSE] }, 1, 0] } },
            lowStock: { $sum: { $cond: [{ $lt: ["$productLeftCount", LOW_STOCK] }, 1, 0] } },
            stockUnits: { $sum: "$productLeftCount" },
          },
        },
      ]).exec(),
      MemberModel.aggregate([
        { $match: { memberType: MemberType.USER } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ["$memberStatus", MemberStatus.ACTIVE] }, 1, 0] } },
            blocked: { $sum: { $cond: [{ $eq: ["$memberStatus", MemberStatus.BLOCK] }, 1, 0] } },
            newWeek: { $sum: { $cond: [{ $gte: ["$createdAt", since7] }, 1, 0] } },
          },
        },
      ]).exec(),
      OrderModel.aggregate([{ $group: { _id: "$orderStatus", count: { $sum: 1 } } }]).exec(),
      // Revenue = confirmed (on the way) + delivered orders
      OrderModel.aggregate([
        { $match: { orderStatus: { $in: [OrderStatus.PROCESS, OrderStatus.FINISH] } } },
        { $group: { _id: null, sum: { $sum: "$orderTotal" } } },
      ]).exec(),
      OrderModel.aggregate([
        { $match: { orderStatus: { $in: [OrderStatus.PROCESS, OrderStatus.FINISH] }, createdAt: { $gte: since30 } } },
        { $group: { _id: null, sum: { $sum: "$orderTotal" } } },
      ]).exec(),
      ProductModel.find({ productStatus: { $ne: ProductStatus.DELETE }, productLeftCount: { $lt: LOW_STOCK } })
        .sort({ productLeftCount: 1 })
        .limit(6)
        .select("productName productAuthor productLeftCount productImages productStatus")
        .lean()
        .exec(),
      ProductModel.find({ productStatus: ProductStatus.PROCESS })
        .sort({ productViews: -1, productLikes: -1 })
        .limit(5)
        .select("productName productAuthor productViews productLikes productImages")
        .lean()
        .exec(),
      this.getOrders(undefined, 6),
    ]);

    const byStatus = Object.fromEntries(orderStats.map((s: any) => [s._id, s.count])) as Record<string, number>;
    return {
      products: productStats[0] ?? { total: 0, active: 0, paused: 0, lowStock: 0, stockUnits: 0 },
      members: memberStats[0] ?? { total: 0, active: 0, blocked: 0, newWeek: 0 },
      orders: {
        pending: byStatus[OrderStatus.PAUSE] ?? 0,
        process: byStatus[OrderStatus.PROCESS] ?? 0,
        finish: byStatus[OrderStatus.FINISH] ?? 0,
        cancelled: byStatus[OrderStatus.DELETE] ?? 0,
      },
      revenue: revenue[0]?.sum ?? 0,
      revenue30: revenue30[0]?.sum ?? 0,
      lowStock,
      topViewed,
      recentOrders,
    };
  }

  /** Orders with the customer's contact details and the books in them */
  public async getOrders(status?: OrderStatus, limit = 100) {
    const match = status ? { orderStatus: status } : { orderStatus: { $ne: OrderStatus.DELETE } };
    return OrderModel.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: "members",
          localField: "memberId",
          foreignField: "_id",
          as: "member",
          pipeline: [{ $project: { memberNick: 1, memberPhone: 1, memberAddress: 1, memberEmail: 1, memberImage: 1 } }],
        },
      },
      { $unwind: { path: "$member", preserveNullAndEmptyArrays: true } },
      { $lookup: { from: "orderItems", localField: "_id", foreignField: "orderId", as: "items" } },
      {
        $lookup: {
          from: "products",
          localField: "items.productId",
          foreignField: "_id",
          as: "products",
          pipeline: [{ $project: { productName: 1, productAuthor: 1, productImages: 1 } }],
        },
      },
    ]).exec();
  }
}

export default DashboardService;
