import { timingSafeEqual, createHmac, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "ptp_session";

/** 定长比较，避免密码校验被计时攻击 */
export function safeCompare(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

interface SessionPayload {
  iat: number;
  exp: number;
  nonce: string;
}

export function issueSession(secret: string, days: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iat: now,
    exp: now + days * 86_400,
    nonce: randomBytes(8).toString("hex"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;

  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/** 需要登录的路由挂这个 preHandler */
export function requireAuth(secret: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!verifySession(token, secret)) {
      return reply.code(401).send({ error: "未登录" });
    }
  };
}
