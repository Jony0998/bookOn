import { ObjectId } from "mongoose";
import { MemberStatus, MemberType } from "./enums/member.enum";
import { Request } from "express";
import { Session } from "express-session";

export interface Member {
  _id: any;
  memberType: MemberType | string;
  memberStatus: MemberStatus | string;
  memberNick: string;
  memberPhone?: string;
  memberEmail?: string;
  memberEmailVerified?: boolean;
  memberPassword?: string;
  memberAddress?: string;
  memberDesc?: string;
  memberImages?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberInput {
  memberType?: MemberType;
  memberStatus?: MemberStatus;
  memberNick: string;
  memberPhone?: string;
  memberEmail?: string;
  memberPassword: string;
  memberAddress?: string;
  memberDesc?: string;
  memberImage?: string;
}

/** Admin panel login (library account, by nick) */
export interface LoginInput {
  memberNick: string;
  memberPassword: string;
}

/** Shop login: `login` is an email address or a username */
export interface SpaLoginInput {
  login: string;
  memberPassword: string;
}

export interface MemberUpdateInput {
  _id?: string | ObjectId;
  memberStatus?: MemberStatus;
  memberNick?: string;
  memberPhone?: string;
  memberEmail?: string;
  memberEmailVerified?: boolean;
  memberPassword?: string;
  memberAddress?: string;
  memberDesc?: string;
  memberImage?: string;
}

export interface ExtendedRequest extends Request {
  member: Member;
  file: Express.Multer.File;
  files: Express.Multer.File[];
}

export interface AdminRequest extends Request {
  member: Member;
  session: Session & { member: Member };
  file: Express.Multer.File;
  files: Express.Multer.File[];
}
