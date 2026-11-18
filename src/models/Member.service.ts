import MemberModel from "../schema/Member.model";
import {
  LoginInput,
  Member,
  MemberInput,
  MemberUpdateInput,
  SpaLoginInput,
} from "../libs/types/member";
import { duplicateError } from "../libs/utils/member-input";
import Errors, { HttpCode, Message } from "../libs/types/Errors";
import { MemberStatus, MemberType } from "../libs/types/enums/member.enum";
import * as bcrypt from "bcrypt";
import { shapeIntoMongooseObjectId } from "../libs/types/config";

/** Fields safe to show to anyone (no phone, address or password) */
const PUBLIC_MEMBER_FIELDS = {
  memberNick: 1,
  memberType: 1,
  memberImage: 1,
  memberDesc: 1,
  memberPoints: 1,
  createdAt: 1,
};

class MemberService {
  private readonly memberModel;

  constructor() {
    this.memberModel = MemberModel;
  }

  /*********************** SPA ***************************/

  /** Public shop contact card: never the whole account (email, status, ...) */
  public async getLibrary(): Promise<any> {
    const result = await this.memberModel
      .findOne(
        { memberType: MemberType.LIBRARY },
        { ...PUBLIC_MEMBER_FIELDS, memberPhone: 1, memberAddress: 1 }
      )
      .lean()
      .exec();

    if (!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);

    return result;
  }

  public async signup(input: MemberInput): Promise<any> {
    const salt = await bcrypt.genSalt();
    input.memberPassword = await bcrypt.hash(input.memberPassword, salt);

    try {
      const result = await this.memberModel.create(input);
      result.memberPassword = "";
      return result.toJSON();
    } catch (err) {
      console.error("Error, model:signup", err);
      throw duplicateError(err) ?? new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);
    }
  }

  /** Login by email or username; one generic error so accounts can't be probed */
  public async login(input: SpaLoginInput): Promise<any> {
    const login = input.login.trim();
    const filter = login.includes("@")
      ? { memberEmail: login.toLowerCase() }
      : { memberNick: login };
    const member = await this.memberModel
      .findOne(
        { ...filter, memberStatus: { $ne: MemberStatus.DELETE } },
        { memberNick: 1, memberPassword: 1, memberStatus: 1 }
      )
      .exec();

    const isMatch = member ? await bcrypt.compare(input.memberPassword, member.memberPassword) : false;
    if (!member || !isMatch) throw new Errors(HttpCode.UNAUTHORIZED, Message.WRONG_CREDENTIALS);
    if (member.memberStatus === MemberStatus.BLOCK)
      throw new Errors(HttpCode.FORBIDDEN, Message.BLOCKED_USER);

    return await this.memberModel.findById(member._id).lean().exec();
  }

  public async findActiveByEmail(email: string): Promise<any> {
    return await this.memberModel
      .findOne({ memberEmail: email, memberStatus: MemberStatus.ACTIVE })
      .lean()
      .exec();
  }

  public async findActiveById(memberId: any): Promise<any> {
    return await this.memberModel
      .findOne({ _id: shapeIntoMongooseObjectId(memberId), memberStatus: MemberStatus.ACTIVE })
      .lean()
      .exec();
  }

  public async markEmailVerified(memberId: any): Promise<void> {
    await this.memberModel.updateOne({ _id: memberId }, { $set: { memberEmailVerified: true } }).exec();
  }

  /** New password from a reset link; following the link also proves the inbox */
  public async setPassword(memberId: any, password: string): Promise<void> {
    const hashed = await bcrypt.hash(password, await bcrypt.genSalt());
    const result = await this.memberModel
      .updateOne(
        { _id: memberId, memberStatus: MemberStatus.ACTIVE },
        { $set: { memberPassword: hashed, memberEmailVerified: true } }
      )
      .exec();
    if (!result.matchedCount) throw new Errors(HttpCode.BAD_REQUEST, Message.TOKEN_INVALID);
  }

  public async getMemberDetail(member: Member): Promise<any> {
    const memberId = shapeIntoMongooseObjectId(member._id);
    const result = await this.memberModel
      .findOne({
        _id: memberId,
        memberStatus: MemberStatus.ACTIVE,
      })
      .exec();

    if (!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    return result;
  }
  // define
  public async updateMember(
    member: Member,
    input: MemberUpdateInput,
    unset: (keyof MemberUpdateInput)[] = []
  ): Promise<any> {
    const memberId = shapeIntoMongooseObjectId(member._id);
    const update: Record<string, unknown> = { $set: input };
    if (unset.length) update.$unset = Object.fromEntries(unset.map((key) => [key, 1]));
    let result;
    try {
      result = await this.memberModel
        .findOneAndUpdate({ _id: memberId }, update, { new: true })
        .exec();
    } catch (err: any) {
      throw duplicateError(err) ?? err;
    }
    if (!result) throw new Errors(HttpCode.NOT_MODIFIED, Message.UPDATE_FAILED);

    return result;
  }

  public async getMemberPublic(memberId: string): Promise<any> {
    const id = shapeIntoMongooseObjectId(memberId);
    const result = await this.memberModel
      .findOne({ _id: id, memberStatus: MemberStatus.ACTIVE }, PUBLIC_MEMBER_FIELDS)
      .lean()
      .exec();
    if (!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);
    return result;
  }

  public async getTopUsers(): Promise<any[]> {
    const result = await this.memberModel
      .find(
        {
          memberStatus: MemberStatus.ACTIVE,
          memberType: MemberType.USER,
          memberPoints: { $gte: -1 },
        },
        PUBLIC_MEMBER_FIELDS
      )
      .sort({ memberPoints: -1 })
      .limit(4)
      .exec();

    if (!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);

    return result;
  }


   public async addUserPoint(
     member: Member,
     point: number
   ): Promise<any> {
     const memberId = shapeIntoMongooseObjectId(member._id);


     return await this.memberModel
     .findOneAndUpdate(
    {
     _id: memberId,
     memberType: MemberType.USER,
     memberStatus: MemberStatus.ACTIVE,

     }, 
     
      { $inc: { memberPoints: point } },
     
      { new: true }
    )
    .exec();
    
   }



         /****************** SSR *******************/

  public async processSignup(input: MemberInput): Promise<Member> {
    const existingLibrary = await this.memberModel
      .findOne({ memberType: MemberType.LIBRARY })
      .exec();
    if (existingLibrary) {
      throw new Errors(HttpCode.BAD_REQUEST, Message.LIBRARY_ALREADY_EXISTS);
    }

    const salt = await bcrypt.genSalt();
    input.memberPassword = await bcrypt.hash(input.memberPassword, salt);

    try {
      const result = await this.memberModel.create(input);
      result.memberPassword = "";
      return result;
    } catch (err: any) {
      throw duplicateError(err) ?? new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);
    }
  }

  public async processLogin(input: LoginInput): Promise<any> {
    const member = await this.memberModel
      .findOne(
        { memberNick: input.memberNick, memberType: MemberType.LIBRARY },
        { memberNick: 1, memberPassword: 1, memberType: 1 }
      )
      .exec();
    if (!member) throw new Errors(HttpCode.NOT_FOUND, Message.NO_MEMBER_NICK);

    const isMatch = await bcrypt.compare(
      input.memberPassword,
      member.memberPassword
    );
    if (!isMatch) {
      throw new Errors(HttpCode.UNAUTHORIZED, Message.WRONG_PASSWORD);
    }
    return await this.memberModel.findById(member._id).exec();
  }

  public async getUsers(): Promise<any[]> {
    const result = await this.memberModel
      .find({ memberType: MemberType.USER })
      .exec();
    if (!result) throw new Errors(HttpCode.NOT_FOUND, Message.NO_DATA_FOUND);

    return result;
  }

  public async updateChosenUser(input: MemberUpdateInput): Promise<any> {
    const memberId = shapeIntoMongooseObjectId(input?._id);
    // Admin panel only changes user status
    if (!Object.values(MemberStatus).includes(input?.memberStatus as MemberStatus))
      throw new Errors(HttpCode.BAD_REQUEST, Message.INVALID_INPUT);

    const result = await this.memberModel
      .findOneAndUpdate(
        { _id: memberId, memberType: MemberType.USER },
        { memberStatus: input.memberStatus },
        { new: true }
      )
      .exec();
    if (!result) throw new Errors(HttpCode.NOT_MODIFIED, Message.UPDATE_FAILED);

    return result;
  }
}

export default MemberService;
