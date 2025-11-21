import MemberModel from "../schema/Member.model";
import Errors from "../libs/types/Errors";
import { HttpCode } from "../libs/types/Errors";
import { Message } from "../libs/types/Errors";
import { MemberInput, Member } from "../libs/types/member";
import { MemberType } from "../libs/types/enums/member.enum";

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

    try {
      const result = await this.memberModel.create(input);
      result.memberPassword = "";
      // @ts-ignore
      return result;
    } catch (err) {
      throw new Errors(HttpCode.BAD_REQUEST, Message.CREATE_FAILED);
    }
  } 
  }


  export default MemberService;