import mongoose, { Schema } from "mongoose";

export enum AuthTokenType {
  VERIFY_EMAIL = "VERIFY_EMAIL",
  RESET_PASSWORD = "RESET_PASSWORD",
}

/**
 * One-time tokens sent by email. Only a SHA-256 hash is stored, so a database
 * leak does not expose usable links; MongoDB removes expired ones (TTL index).
 */
const authTokenSchema = new Schema(
  {
    memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true, index: true },
    type: { type: String, enum: Object.values(AuthTokenType), required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("AuthToken", authTokenSchema, "authTokens");
