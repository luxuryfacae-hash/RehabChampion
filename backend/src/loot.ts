export const RARITIES = [
  "Common",
  "Uncommon",
  "Rare",
  "Epic",
  "Legendary",
  "Mythic",
] as const;

export type Rarity = (typeof RARITIES)[number];

/** Highest item level the server will roll. Drop tier is f(wave); this caps abuse. */
export const MAX_ILVL = 1000;

export interface Affix {
  stat: string;
  value: number;
}

export interface RolledItem {
  baseId: string;
  rarity: Rarity;
  ilvl: number;
  affixes: Affix[];
}

export type Rng = () => number;

/** Common=1, Uncommon=2, ... Mythic=6 (index in RARITIES + 1). */
export function affixCountForRarity(rarity: Rarity): number {
  const idx = RARITIES.indexOf(rarity);
  if (idx < 0) throw new Error(`unknown rarity: ${rarity}`);
  return idx + 1;
}

interface AffixDef {
  stat: string;
  weight: number;
  base: number;
  perIlvl: number;
}

const AFFIX_POOL: AffixDef[] = [
  { stat: "strength", weight: 10, base: 2, perIlvl: 0.5 },
  { stat: "agility", weight: 10, base: 2, perIlvl: 0.5 },
  { stat: "intellect", weight: 10, base: 2, perIlvl: 0.5 },
  { stat: "armor", weight: 8, base: 1, perIlvl: 0.3 },
  { stat: "health", weight: 8, base: 10, perIlvl: 3 },
  { stat: "mana", weight: 8, base: 8, perIlvl: 2 },
  { stat: "attack_damage", weight: 6, base: 3, perIlvl: 1 },
  { stat: "attack_speed", weight: 5, base: 2, perIlvl: 0.4 },
  { stat: "crit_chance", weight: 4, base: 1, perIlvl: 0.2 },
  { stat: "lifesteal", weight: 3, base: 1, perIlvl: 0.15 },
];

const TOTAL_WEIGHT = AFFIX_POOL.reduce((s, a) => s + a.weight, 0);

function pickAffix(rng: Rng): AffixDef {
  let r = rng() * TOTAL_WEIGHT;
  for (const a of AFFIX_POOL) {
    r -= a.weight;
    if (r < 0) return a;
  }
  return AFFIX_POOL[AFFIX_POOL.length - 1];
}

/**
 * Server-authoritative item roll. Pure: identical (args, rng) → identical output.
 * Affix value = round((base + perIlvl*ilvl) * rollMultiplier), where rollMultiplier
 * in [0.8, 1.2] is drawn from rng — so magnitude scales monotonically with ilvl
 * for a fixed rng sequence.
 */
export function rollItem(
  baseId: string,
  ilvl: number,
  rarity: Rarity,
  rng: Rng,
): RolledItem {
  const count = affixCountForRarity(rarity);
  const affixes: Affix[] = [];
  for (let i = 0; i < count; i++) {
    const def = pickAffix(rng);
    const rollMultiplier = 0.8 + rng() * 0.4;
    const magnitude = (def.base + def.perIlvl * ilvl) * rollMultiplier;
    affixes.push({ stat: def.stat, value: Math.round(magnitude * 100) / 100 });
  }
  return { baseId, rarity, ilvl, affixes };
}
