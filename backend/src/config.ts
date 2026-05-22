import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  HMAC_SECRET: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}

export const config = loadConfig();
