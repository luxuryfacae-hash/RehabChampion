import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { verify } from "./hmac.js";
import { rollItem, RARITIES, MAX_ILVL, type Rarity } from "./loot.js";
import {
  ensureAccount,
  listCharacters,
  createCharacter,
  saveCharacter,
} from "./repo/characters.js";
import {
  insertItem,
  getItem,
  listItems,
  equipItem,
  unequipItem,
  moveItem,
  craftItem,
} from "./repo/items.js";

export interface BuildOptions {
  pool: Pool;
  hmacSecret: string;
  rng?: () => number;
}

// Augment request to carry the raw body string for HMAC verification.
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const sessionSchema = z.object({ steamid: z.string().min(1) });
const rarityEnum = z.enum(RARITIES as unknown as [string, ...string[]]);

function defaultRng(): number {
  return Math.random();
}

export async function buildServer(opts: BuildOptions): Promise<FastifyInstance> {
  const { pool, hmacSecret } = opts;
  const rng = opts.rng ?? defaultRng;
  const app = Fastify({ logger: false });

  // Capture raw body so HMAC is computed over the exact bytes the client signed.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const raw = body as string;
      try {
        const json = raw.length ? JSON.parse(raw) : {};
        (json as Record<string, unknown>).__raw = raw;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.addHook("preHandler", async (req, reply) => {
    const sig = req.headers["x-signature"];
    const bodyObj = (req.body ?? {}) as Record<string, unknown>;
    const raw = typeof bodyObj.__raw === "string" ? (bodyObj.__raw as string) : "";
    req.rawBody = raw;
    delete bodyObj.__raw;
    if (typeof sig !== "string" || !verify(hmacSecret, raw, sig)) {
      reply.code(401).send({ error: "bad_signature" });
    }
  });

  app.post("/session/start", async (req, reply) => {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const { steamid } = parsed.data;
    await ensureAccount(pool, steamid);
    const characters = await listCharacters(pool, steamid);
    const equipped = await listItems(pool, steamid, "equipped");
    const bag = await listItems(pool, steamid, "bag");
    const stash = await listItems(pool, steamid, "stash");
    return { characters, equipped, bag, stash };
  });

  app.post("/character/save", async (req, reply) => {
    const schema = z.object({
      steamid: z.string().min(1),
      characterId: z.number().int().optional(),
      heroName: z.string().optional(),
      level: z.number().int().optional(),
      xp: z.number().int().optional(),
      paragon_points: z.number().int().optional(),
      gold: z.number().int().optional(),
      essence: z.number().int().optional(),
      allocated_stats: z.record(z.unknown()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const d = parsed.data;
    await ensureAccount(pool, d.steamid);
    let characterId = d.characterId;
    if (characterId == null) {
      const created = await createCharacter(pool, d.steamid, d.heroName ?? "unknown");
      characterId = created.id;
    }
    const updated = await saveCharacter(pool, characterId, d.steamid, d);
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return { character: updated };
  });

  app.post("/item/pickup", async (req, reply) => {
    // Server rolls loot; any client-sent stats/affixes are ignored.
    const schema = z.object({
      steamid: z.string().min(1),
      characterId: z.number().int().nullable().optional(),
      baseId: z.string().min(1),
      ilvl: z.number().int().positive().max(MAX_ILVL),
      rarity: rarityEnum,
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const d = parsed.data;
    await ensureAccount(pool, d.steamid);
    const rolled = rollItem(d.baseId, d.ilvl, d.rarity as Rarity, rng);
    const item = await insertItem(pool, {
      ownerSteamid64: d.steamid,
      characterId: d.characterId ?? null,
      baseId: rolled.baseId,
      rarity: rolled.rarity,
      ilvl: rolled.ilvl,
      affixes: rolled.affixes,
    });
    return { item };
  });

  app.post("/item/equip", async (req, reply) => {
    const schema = z.object({
      steamid: z.string().min(1),
      itemId: z.number().int(),
      slot: z.string().min(1),
      characterId: z.number().int().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const d = parsed.data;
    const item = await equipItem(pool, d.itemId, d.steamid, d.slot, d.characterId ?? null);
    if (!item) return reply.code(404).send({ error: "not_found" });
    return { item };
  });

  app.post("/item/unequip", async (req, reply) => {
    const schema = z.object({ steamid: z.string().min(1), itemId: z.number().int() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const d = parsed.data;
    const item = await unequipItem(pool, d.itemId, d.steamid);
    if (!item) return reply.code(404).send({ error: "not_found" });
    return { item };
  });

  app.post("/item/move", async (req, reply) => {
    const schema = z.object({
      steamid: z.string().min(1),
      itemId: z.number().int(),
      location: z.enum(["bag", "stash"]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const d = parsed.data;
    const item = await moveItem(pool, d.itemId, d.steamid, d.location);
    if (!item) return reply.code(404).send({ error: "not_found" });
    return { item };
  });

  app.post("/item/craft", async (req, reply) => {
    const schema = z.object({
      steamid: z.string().min(1),
      itemId: z.number().int(),
      stat: z.string().min(1),
      delta: z.number(),
      essenceCost: z.number().int().nonnegative().default(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const d = parsed.data;
    const result = await craftItem(
      pool,
      d.itemId,
      d.steamid,
      { stat: d.stat, delta: d.delta },
      d.essenceCost,
    );
    if (result === "no_item" || result === "no_character") {
      return reply.code(404).send({ error: result });
    }
    if (result === "insufficient_essence") {
      return reply.code(402).send({ error: "insufficient_essence" });
    }
    return { item: result.item, essence: result.essence };
  });

  app.post("/run/complete", async (req, reply) => {
    const schema = z.object({
      steamid: z.string().min(1),
      characterId: z.number().int(),
      xp: z.number().int().nonnegative().optional(),
      gold: z.number().int().nonnegative().optional(),
      essence: z.number().int().nonnegative().optional(),
      level: z.number().int().positive().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_request" });
    const d = parsed.data;
    const updated = await saveCharacter(pool, d.characterId, d.steamid, {
      xp: d.xp,
      gold: d.gold,
      essence: d.essence,
      level: d.level,
    });
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return { character: updated };
  });

  return app;
}
