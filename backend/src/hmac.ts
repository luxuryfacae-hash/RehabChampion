import { createHmac, timingSafeEqual } from "node:crypto";
export const sign = (secret: string, body: string): string =>
  createHmac("sha256", secret).update(body).digest("hex");
export const verify = (secret: string, body: string, sig: string): boolean => {
  const a = Buffer.from(sign(secret, body));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
};
