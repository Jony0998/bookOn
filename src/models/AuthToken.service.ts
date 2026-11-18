import crypto from "crypto";
import AuthTokenModel, { AuthTokenType } from "../schema/AuthToken.model";
import Errors, { HttpCode, Message } from "../libs/types/Errors";

const LIFETIME_MS: Record<AuthTokenType, number> = {
  [AuthTokenType.VERIFY_EMAIL]: 48 * 3600 * 1000, // 2 days
  [AuthTokenType.RESET_PASSWORD]: 3600 * 1000, // 1 hour
};
/** Minimum gap between two emails of the same kind to the same member */
export const RESEND_COOLDOWN_MS = 60 * 1000;

const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

class AuthTokenService {
  /**
   * Issues a fresh token (older ones of the same type stop working) and
   * returns the raw value to put in the emailed link.
   */
  public async issue(memberId: any, type: AuthTokenType): Promise<string> {
    const recent = await AuthTokenModel.findOne({ memberId, type }).sort({ createdAt: -1 }).lean().exec();
    if (recent && Date.now() - new Date(recent.createdAt as Date).getTime() < RESEND_COOLDOWN_MS)
      throw new Errors(HttpCode.TOO_MANY_REQUESTS, Message.TOO_MANY_REQUESTS);

    await AuthTokenModel.deleteMany({ memberId, type }).exec();
    const raw = crypto.randomBytes(32).toString("base64url");
    await AuthTokenModel.create({
      memberId,
      type,
      tokenHash: hash(raw),
      expiresAt: new Date(Date.now() + LIFETIME_MS[type]),
    });
    return raw;
  }

  /** Validates and burns a token; returns the member it belongs to */
  public async consume(raw: unknown, type: AuthTokenType): Promise<any> {
    if (typeof raw !== "string" || raw.length < 20 || raw.length > 100)
      throw new Errors(HttpCode.BAD_REQUEST, Message.TOKEN_INVALID);
    // findOneAndDelete makes a token usable exactly once, even under races
    const token = await AuthTokenModel.findOneAndDelete({
      tokenHash: hash(raw),
      type,
      expiresAt: { $gt: new Date() },
    }).exec();
    if (!token) throw new Errors(HttpCode.BAD_REQUEST, Message.TOKEN_INVALID);
    return token.memberId;
  }

  public async revokeAll(memberId: any, type: AuthTokenType): Promise<void> {
    await AuthTokenModel.deleteMany({ memberId, type }).exec();
  }
}

export default AuthTokenService;
