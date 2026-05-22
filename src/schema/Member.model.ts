import mongoose, { Schema } from "mongoose";
import { MemberStatus, MemberType } from "../libs/types/enums/member.enum";

// Two approaches to defining a schema: 1. Schema first, 2. Code first.
// This app uses the schema-first approach.

const memberSchema = new Schema({
  memberType: {
    type: String,
    enum: MemberType,
    default: MemberType.USER,
  },

  memberStatus: {
    type: String,
    enum: MemberStatus,
    default: MemberStatus.ACTIVE,
  },

  memberNick: {
    type: String,
    index: { unique: true, sparse: true },
    required: true,
  },

  memberPhone: {
    type: String,
    index: { unique: true, sparse: true },
    required: true,
  },

  memberPassword: {
    type: String,
    select: false,
    required: true,
  },

  memberAddress: {
    type: String,
  },

  memberDesc: {
    type: String,
  },

  memberImage: {
    type: String,
  },

  memberPoints: {
    type: Number,
    default: 0,
  },


}, {timestamps: true}); //  {timestamps: true} --  bu orqali biz databaseda  createdAt , updatedAt malumotlarini qoyib beradi


export default mongoose.model("Member", memberSchema)
