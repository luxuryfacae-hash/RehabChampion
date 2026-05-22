import type { Pool } from "pg";

export interface CharacterRow {
  id: number;
  steamid64: string;
  hero_name: string | null;
  level: number;
  xp: string;
  paragon_points: number;
  gold: string;
  essence: string;
  ascension_unlocked: number;
  allocated_stats: Record<string, unknown>;
  created_at: string;
}

export async function ensureAccount(pool: Pool, steamid64: string): Promise<void> {
  await pool.query(
    `INSERT INTO accounts (steamid64) VALUES ($1)
     ON CONFLICT (steamid64) DO UPDATE SET last_seen = now()`,
    [steamid64],
  );
}

export async function listCharacters(pool: Pool, steamid64: string): Promise<CharacterRow[]> {
  const { rows } = await pool.query<CharacterRow>(
    `SELECT * FROM characters WHERE steamid64 = $1 ORDER BY id`,
    [steamid64],
  );
  return rows;
}

export async function createCharacter(
  pool: Pool,
  steamid64: string,
  heroName: string,
): Promise<CharacterRow> {
  const { rows } = await pool.query<CharacterRow>(
    `INSERT INTO characters (steamid64, hero_name) VALUES ($1, $2) RETURNING *`,
    [steamid64, heroName],
  );
  return rows[0];
}

export interface SaveCharacterInput {
  level?: number;
  xp?: number;
  paragon_points?: number;
  gold?: number;
  essence?: number;
  allocated_stats?: Record<string, unknown>;
}

export async function saveCharacter(
  pool: Pool,
  characterId: number,
  steamid64: string,
  input: SaveCharacterInput,
): Promise<CharacterRow | null> {
  const { rows } = await pool.query<CharacterRow>(
    `UPDATE characters SET
        level = COALESCE($3, level),
        xp = COALESCE($4, xp),
        paragon_points = COALESCE($5, paragon_points),
        gold = COALESCE($6, gold),
        essence = COALESCE($7, essence),
        allocated_stats = COALESCE($8, allocated_stats)
      WHERE id = $1 AND steamid64 = $2
      RETURNING *`,
    [
      characterId,
      steamid64,
      input.level ?? null,
      input.xp ?? null,
      input.paragon_points ?? null,
      input.gold ?? null,
      input.essence ?? null,
      input.allocated_stats ? JSON.stringify(input.allocated_stats) : null,
    ],
  );
  return rows[0] ?? null;
}
