import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { LikeInput } from "../libs/types/like";
import LikeModel from "../schema/Like.model";

class LikeService {
  private readonly likeModel;

  constructor() {
    this.likeModel = LikeModel;
  }

  public async checkLikeExistence(input: LikeInput): Promise<any> {
    return await this.likeModel
      .findOne({ memberId: input.memberId, likeRefId: input.likeRefId })
      .exec();
  }

  public async insertMemberLike(input: LikeInput): Promise<any> {
    try {
      return await this.likeModel.create(input);
    } catch (err) {
      throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);
    }
  }

  public async getMemberLikedIds(memberId: any, likeGroup: string): Promise<any[]> {
    const likes = await this.likeModel
      .find({ memberId, likeGroup })
      .sort({ createdAt: -1 })
      .limit(500)
      .select("likeRefId")
      .lean()
      .exec();
    return likes.map((like) => like.likeRefId);
  }

  public async deleteMemberLike(input: LikeInput): Promise<any> {
    return await this.likeModel
      .findOneAndDelete({ memberId: input.memberId, likeRefId: input.likeRefId })
      .exec();
  }
}

export default LikeService;
