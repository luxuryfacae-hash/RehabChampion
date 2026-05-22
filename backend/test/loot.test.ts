import { describe, it, expect } from "vitest";
import { rollItem, affixCountForRarity, RARITIES } from "../src/loot";

// Deterministic RNG: linear congruential generator seeded.
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("affixCountForRarity", () => {
  it("maps each rarity to its count, Common=1 ... Mythic=6", () => {
    expect(affixCountForRarity("Common")).toBe(1);
    expect(affixCountForRarity("Uncommon")).toBe(2);
    expect(affixCountForRarity("Rare")).toBe(3);
    expect(affixCountForRarity("Epic")).toBe(4);
    expect(affixCountForRarity("Legendary")).toBe(5);
    expect(affixCountForRarity("Mythic")).toBe(6);
  });

  it("exposes rarities in ascending order", () => {
    expect(RARITIES).toEqual([
      "Common",
      "Uncommon",
      "Rare",
      "Epic",
      "Legendary",
      "Mythic",
    ]);
  });
});

describe("rollItem", () => {
  it("returns the correct shape", () => {
    const item = rollItem("sword_01", 10, "Rare", seededRng(1));
    expect(item.baseId).toBe("sword_01");
    expect(item.rarity).toBe("Rare");
    expect(item.ilvl).toBe(10);
    expect(Array.isArray(item.affixes)).toBe(true);
    for (const a of item.affixes) {
      expect(typeof a.stat).toBe("string");
      expect(typeof a.value).toBe("number");
    }
  });

  it("produces an affix count matching the rarity", () => {
    expect(rollItem("x", 5, "Common", seededRng(2)).affixes).toHaveLength(1);
    expect(rollItem("x", 5, "Mythic", seededRng(2)).affixes).toHaveLength(6);
  });

  it("is deterministic given a seeded rng", () => {
    const a = rollItem("x", 20, "Epic", seededRng(42));
    const b = rollItem("x", 20, "Epic", seededRng(42));
    expect(a).toEqual(b);
  });

  it("differs across seeds", () => {
    const a = rollItem("x", 20, "Epic", seededRng(1));
    const b = rollItem("x", 20, "Epic", seededRng(2));
    expect(a).not.toEqual(b);
  });

  it("scales affix magnitude with ilvl", () => {
    const low = rollItem("x", 1, "Mythic", seededRng(7));
    const high = rollItem("x", 100, "Mythic", seededRng(7));
    // Same seed/rarity rolls the same affixes & rolls, only ilvl differs.
    const lowTotal = low.affixes.reduce((s, a) => s + a.value, 0);
    const highTotal = high.affixes.reduce((s, a) => s + a.value, 0);
    expect(highTotal).toBeGreaterThan(lowTotal);
  });
});
