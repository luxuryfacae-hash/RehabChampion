import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server";
import { sign } from "../src/hmac";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://rehab:rehab@localhost:5433/rehab";
const SECRET = "test-secret";

const pool = new pg.Pool({ connectionString: DATABASE_URL });
let app: FastifyInstance;

// Deterministic rng so rolled items are reproducible in assertions.
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

async function call(path: string, payload: unknown, opts: { sig?: string } = {}) {
  const raw = JSON.stringify(payload);
  const sig = opts.sig ?? sign(SECRET, raw);
  return app.inject({
    method: "POST",
    url: path,
    headers: { "content-type": "application/json", "x-signature": sig },
    payload: raw,
  });
}

beforeAll(async () => {
  app = await buildServer({ pool, hmacSecret: SECRET, rng: seededRng(123) });
  await app.ready();
  // Clean slate for the test steamids.
  await pool.query(
    `DELETE FROM accounts WHERE steamid64 IN ('s_new','s_items','s_craft')`,
  );
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM accounts WHERE steamid64 IN ('s_new','s_items','s_craft')`,
  );
  await app.close();
  await pool.end();
});

describe("POST /session/start", () => {
  it("creates an account and returns empty snapshot for a new steamid", async () => {
    const res = await call("/session/start", { steamid: "s_new" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.characters).toEqual([]);
    expect(body.stash).toEqual([]);
    expect(body.bag).toEqual([]);
    expect(body.equipped).toEqual([]);

    const { rows } = await pool.query(
      `SELECT steamid64 FROM accounts WHERE steamid64 = 's_new'`,
    );
    expect(rows).toHaveLength(1);
  });

  it("rejects a bad signature with 401", async () => {
    const res = await call("/session/start", { steamid: "s_new" }, { sig: "deadbeef" });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /item/pickup", () => {
  it("rolls + stores an item server-side, ignoring client-sent stats", async () => {
    await call("/session/start", { steamid: "s_items" });
    const res = await call("/item/pickup", {
      steamid: "s_items",
      baseId: "sword_01",
      ilvl: 10,
      rarity: "Rare",
      // Attacker-supplied stats that must be ignored:
      affixes: [{ stat: "strength", value: 999999 }],
      stats: { godmode: true },
    });
    expect(res.statusCode).toBe(200);
    const item = res.json().item;
    expect(item.base_id).toBe("sword_01");
    expect(item.rarity).toBe("Rare");
    expect(item.ilvl).toBe(10);
    expect(item.affixes).toHaveLength(3); // Rare = 3 affixes, server-rolled
    expect(item.location).toBe("bag");
    // The injected 999999 value must NOT be present.
    const hasInjected = item.affixes.some((a: { value: number }) => a.value === 999999);
    expect(hasInjected).toBe(false);
  });

  it("rejects an out-of-range ilvl with 400", async () => {
    await call("/session/start", { steamid: "s_items" });
    const res = await call("/item/pickup", {
      steamid: "s_items",
      baseId: "sword_01",
      ilvl: 100000,
      rarity: "Rare",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /item/equip + /unequip + /move", () => {
  it("equips an item, setting slot and equipped location", async () => {
    await call("/session/start", { steamid: "s_items" });
    const pick = await call("/item/pickup", {
      steamid: "s_items",
      baseId: "helm_01",
      ilvl: 5,
      rarity: "Common",
    });
    const itemId = pick.json().item.id;

    const res = await call("/item/equip", {
      steamid: "s_items",
      itemId,
      slot: "head",
    });
    expect(res.statusCode).toBe(200);
    const item = res.json().item;
    expect(item.location).toBe("equipped");
    expect(item.slot).toBe("head");
  });

  it("unequips back to bag and moves to stash", async () => {
    const pick = await call("/item/pickup", {
      steamid: "s_items",
      baseId: "ring_01",
      ilvl: 5,
      rarity: "Common",
    });
    const itemId = pick.json().item.id;
    await call("/item/equip", { steamid: "s_items", itemId, slot: "ring" });

    const un = await call("/item/unequip", { steamid: "s_items", itemId });
    expect(un.json().item.location).toBe("bag");
    expect(un.json().item.slot).toBeNull();

    const mv = await call("/item/move", { steamid: "s_items", itemId, location: "stash" });
    expect(mv.json().item.location).toBe("stash");
  });
});

describe("POST /character/save + /run/complete", () => {
  it("creates and updates a character", async () => {
    const created = await call("/character/save", {
      steamid: "s_items",
      heroName: "npc_dota_hero_juggernaut",
      level: 3,
      xp: 500,
      gold: 100,
    });
    expect(created.statusCode).toBe(200);
    const charId = created.json().character.id;
    expect(created.json().character.level).toBe(3);

    const run = await call("/run/complete", {
      steamid: "s_items",
      characterId: charId,
      xp: 1500,
      gold: 250,
      essence: 10,
      level: 5,
    });
    expect(run.statusCode).toBe(200);
    expect(run.json().character.level).toBe(5);
    expect(Number(run.json().character.essence)).toBe(10);
  });
});

describe("POST /item/craft", () => {
  it("charges essence and modifies an affix", async () => {
    await call("/session/start", { steamid: "s_craft" });
    const created = await call("/character/save", {
      steamid: "s_craft",
      heroName: "h",
      essence: 50,
    });
    const charId = created.json().character.id;

    const pick = await call("/item/pickup", {
      steamid: "s_craft",
      characterId: charId,
      baseId: "axe_01",
      ilvl: 10,
      rarity: "Common",
    });
    const itemId = pick.json().item.id;

    const res = await call("/item/craft", {
      steamid: "s_craft",
      itemId,
      stat: "fire_resist",
      delta: 7,
      essenceCost: 20,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().essence).toBe(30);
    const affix = res.json().item.affixes.find((a: { stat: string }) => a.stat === "fire_resist");
    expect(affix.value).toBe(7);
  });

  it("rejects craft with insufficient essence (402)", async () => {
    const created = await call("/character/save", {
      steamid: "s_craft",
      heroName: "h2",
      essence: 1,
    });
    const charId = created.json().character.id;
    const pick = await call("/item/pickup", {
      steamid: "s_craft",
      characterId: charId,
      baseId: "bow_01",
      ilvl: 10,
      rarity: "Common",
    });
    const itemId = pick.json().item.id;
    const res = await call("/item/craft", {
      steamid: "s_craft",
      itemId,
      stat: "cold_resist",
      delta: 5,
      essenceCost: 999,
    });
    expect(res.statusCode).toBe(402);
  });
});
