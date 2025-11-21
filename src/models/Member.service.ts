import MemberModel from "../schema/Member.model";
import Errors from "../libs/types/Errors";
import { HttpCode } from "../libs/types/Errors";
import { Message } from "../libs/types/Errors";
import { MemberInput, Member, LoginInput } from "../libs/types/member";
import { MemberType } from "../libs/types/enums/member.enum";
import * as bcrypt from "bcrypt";

class MemberService {
   private readonly memberModel;
  
   constructor() {
     this.memberModel = MemberModel;
   }

    /****************** SSR *******************/

   public async processSignup(input: MemberInput): Promise<Member> {
    const exist = await this.memberModel
      .findOne({ memberType: MemberType.ADMIN })
      .exec();
    if (exist) throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);

    const salt = await bcrypt.genSalt();
    input.memberPassword = await bcrypt.hash(input.memberPassword, salt);

    try {
      const result = await this.memberModel.create(input);
      result.memberPassword = "";
      // @ts-ignore
      return result;
    } catch (err) {
      throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);
    }
  } 

  public async processLogin(input: LoginInput): Promise<Member> {
    const member = await this.memberModel
      .findOne(
        { memberNick: input.memberNick },
        { memberNick: 1, memberPassword: 1 }
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
    // @ts-ignore
    return await this.memberModel.findById(member._id).exec();
  }
  
  }


  export default MemberService;