import type { Pool } from "pg";
import type { Affix, Rarity } from "../loot.js";

export type ItemLocation = "equipped" | "bag" | "stash";

export interface ItemRow {
  id: number;
  owner_steamid64: string;
  character_id: number | null;
  base_id: string;
  rarity: string;
  ilvl: number;
  affixes: Affix[];
  sockets: unknown[];
  location: ItemLocation;
  slot: string | null;
  created_at: string;
}

export interface InsertItemInput {
  ownerSteamid64: string;
  characterId: number | null;
  baseId: string;
  rarity: Rarity;
  ilvl: number;
  affixes: Affix[];
}

export async function insertItem(pool: Pool, input: InsertItemInput): Promise<ItemRow> {
  const { rows } = await pool.query<ItemRow>(
    `INSERT INTO items (owner_steamid64, character_id, base_id, rarity, ilvl, affixes, location)
     VALUES ($1, $2, $3, $4, $5, $6, 'bag')
     RETURNING *`,
    [
      input.ownerSteamid64,
      input.characterId,
      input.baseId,
      input.rarity,
      input.ilvl,
      JSON.stringify(input.affixes),
    ],
  );
  return rows[0];
}

export async function getItem(
  pool: Pool,
  itemId: number,
  ownerSteamid64: string,
): Promise<ItemRow | null> {
  const { rows } = await pool.query<ItemRow>(
    `SELECT * FROM items WHERE id = $1 AND owner_steamid64 = $2`,
    [itemId, ownerSteamid64],
  );
  return rows[0] ?? null;
}

export async function listItems(
  pool: Pool,
  ownerSteamid64: string,
  location?: ItemLocation,
): Promise<ItemRow[]> {
  if (location) {
    const { rows } = await pool.query<ItemRow>(
      `SELECT * FROM items WHERE owner_steamid64 = $1 AND location = $2 ORDER BY id`,
      [ownerSteamid64, location],
    );
    return rows;
  }
  const { rows } = await pool.query<ItemRow>(
    `SELECT * FROM items WHERE owner_steamid64 = $1 ORDER BY id`,
    [ownerSteamid64],
  );
  return rows;
}

export async function equipItem(
  pool: Pool,
  itemId: number,
  ownerSteamid64: string,
  slot: string,
  characterId: number | null,
): Promise<ItemRow | null> {
  const { rows } = await pool.query<ItemRow>(
    `UPDATE items SET location = 'equipped', slot = $3, character_id = COALESCE($4, character_id)
      WHERE id = $1 AND owner_steamid64 = $2
      RETURNING *`,
    [itemId, ownerSteamid64, slot, characterId],
  );
  return rows[0] ?? null;
}

export async function unequipItem(
  pool: Pool,
  itemId: number,
  ownerSteamid64: string,
): Promise<ItemRow | null> {
  const { rows } = await pool.query<ItemRow>(
    `UPDATE items SET location = 'bag', slot = NULL
      WHERE id = $1 AND owner_steamid64 = $2
      RETURNING *`,
    [itemId, ownerSteamid64],
  );
  return rows[0] ?? null;
}

export async function moveItem(
  pool: Pool,
  itemId: number,
  ownerSteamid64: string,
  location: Extract<ItemLocation, "bag" | "stash">,
): Promise<ItemRow | null> {
  const { rows } = await pool.query<ItemRow>(
    `UPDATE items SET location = $3, slot = NULL
      WHERE id = $1 AND owner_steamid64 = $2 AND location <> 'equipped'
      RETURNING *`,
    [itemId, ownerSteamid64, location],
  );
  return rows[0] ?? null;
}

export interface CraftInput {
  stat: string;
  delta: number;
}

/** Applies an essence craft: adds/improves a single affix, charging essence cost. */
export async function craftItem(
  pool: Pool,
  itemId: number,
  ownerSteamid64: string,
  craft: CraftInput,
  essenceCost: number,
): Promise<{ item: ItemRow; essence: number } | "no_item" | "no_character" | "insufficient_essence"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: itemRows } = await client.query<ItemRow>(
      `SELECT * FROM items WHERE id = $1 AND owner_steamid64 = $2 FOR UPDATE`,
      [itemId, ownerSteamid64],
    );
    const item = itemRows[0];
    if (!item) {
      await client.query("ROLLBACK");
      return "no_item";
    }
    if (item.character_id == null) {
      await client.query("ROLLBACK");
      return "no_character";
    }
    const { rows: charRows } = await client.query<{ essence: string }>(
      `SELECT essence FROM characters WHERE id = $1 AND steamid64 = $2 FOR UPDATE`,
      [item.character_id, ownerSteamid64],
    );
    const charEssence = Number(charRows[0]?.essence ?? 0);
    if (!charRows[0] || charEssence < essenceCost) {
      await client.query("ROLLBACK");
      return "insufficient_essence";
    }

    const affixes: Affix[] = Array.isArray(item.affixes) ? item.affixes : [];
    const existing = affixes.find((a) => a.stat === craft.stat);
    if (existing) {
      existing.value = Math.round((existing.value + craft.delta) * 100) / 100;
    } else {
      affixes.push({ stat: craft.stat, value: craft.delta });
    }

    const { rows: updItem } = await client.query<ItemRow>(
      `UPDATE items SET affixes = $3 WHERE id = $1 AND owner_steamid64 = $2 RETURNING *`,
      [itemId, ownerSteamid64, JSON.stringify(affixes)],
    );
    const newEssence = charEssence - essenceCost;
    await client.query(`UPDATE characters SET essence = $2 WHERE id = $1`, [
      item.character_id,
      newEssence,
    ]);
    await client.query("COMMIT");
    return { item: updItem[0], essence: newEssence };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
