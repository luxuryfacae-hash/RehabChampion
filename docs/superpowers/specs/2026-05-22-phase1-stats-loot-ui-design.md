# RehabChampion — Phase 1 Design: Stats + Loot + UI (backend-integrated)

**Date:** 2026-05-22
**Addon id:** `r3hab_pit_of_champions`
**Builds on:** Phase 0 + Backend (committed, 17/17 tests green)
**Parent spec:** `2026-05-22-rehabchampion-design.md` (§5.3 stats, §5.4 loot, §5.5 UI, §7 phases)
**Status:** Approved — pending user review of this doc before plan.

---

## 1. Goal & scope

Deliver the playable ARPG core loop, **persisted from the first kill**: pick Juggernaut → fight scaling
waves → server-rolled loot drops → equip via a custom Panorama UI → stats apply live → bag/stash managed
account-wide through the existing backend.

Because the backend already exists and is verified, Phase 1 is **backend-integrated from day one** —
the original "offline Phase 1, add backend in Phase 2" split is collapsed.

**In scope**
- Juggernaut ARPG rescale (level cap 100, custom XP curve) + master stat modifier.
- `modifier_rehab_stats` aggregating equipped item affixes into effective stats.
- On-death loot drops with weighted rarity + item level, affixes rolled server-side.
- Custom Panorama UI: equipment (10 slots), bag grid, live stat sheet, account-wide stash tab,
  drag-to-equip, rarity coloring, compare tooltips.
- Wave scaling `f(wave, partySize)` + wave-counter HUD.
- Session bootstrap (`/session/start`) and full item lifecycle wired through `api.lua`.

**Out of scope (later phases)**
- Bosses, ascension tiers, crafting/essence UI, town hub & vendors (Phase 3).
- Multiple heroes beyond Juggernaut (expand after the rescale curve is tuned).
- Co-op balance tuning, Workshop packaging (Phase 4).
- VPS deployment (separate track; backend runs locally for Phase 1 playtest).

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Loot/persistence | Backend from day one |
| Characters per account | Multiple (account-wide shared stash) |
| Phase 1 UI scope | Full: equipment + bag + stat sheet + shared stash |
| v1 hero roster | Single hero (Juggernaut) to tune the rescale curve |
| Rarity/ilvl roll authority | Lua game-server rolls rarity + ilvl from wave context; backend rolls affix magnitudes |

## 3. Architecture & data flow

```
Game load ──/session/start {steamid}──▶ backend ──▶ {characters, equipped, bag, stash}
  └─ characters empty? ──/character/save {heroName:"npc_dota_hero_juggernaut"}──▶ new character
Pick/active character ──▶ attach modifier_rehab_stats (computed from equipped affixes)
Enemy dies ──▶ loot.lua: drop? → base + rarity(weighted by wave) + ilvl(=wave tier)
  └─ /item/pickup {steamid, baseId, ilvl, rarity} ──▶ backend rolls AFFIXES ──▶ world drop prop
Pickup (walk over / click) ──▶ already persisted ──▶ item appears in bag net table
Drag item → equip slot (Panorama) ──▶ custom event ──▶ /item/equip ──▶ recompute modifier ──▶ net table
Bag ⇄ Stash drag ──▶ /item/move {location}
Level up / run end ──▶ /character/save, /run/complete
```

**Authority split.** Affix magnitudes (the cheat-sensitive numbers) are rolled server-side and trusted.
Rarity and item level are decided by the host's Lua game-server from wave context. A listen-server host
can still call the API as themselves — accepted and documented per parent spec §6.4; mitigated by sanity
caps on the backend (ilvl/rarity clamped to valid ranges).

**Client/server boundary.** `CustomNetTables` mirror authoritative backend state to each player's Panorama
client. Panorama only *displays* state and *requests* actions via `CustomGameEventManager` events; it never
asserts numeric values.

## 4. In-engine components (Lua / KV)

| File | Responsibility | Depends on |
|---|---|---|
| `hero.lua` | Juggernaut rescale (HP/mana/damage curves, XP curve, cap 100); attaches `modifier_rehab_stats` on spawn | KV hero overrides |
| `stats.lua` + `modifier_rehab_stats` | Pure aggregation of equipped affixes → effective stats; applies via `MODIFIER_PROPERTY_*` | `state.lua` |
| `state.lua` | Per-player session cache (active char, equipped, bag, stash), synced from net tables | `api.lua` |
| `loot.lua` | On-death drop roll: drop chance, weighted rarity by wave, ilvl = f(wave); calls `Api:Post("/item/pickup")`; spawns clickable world drop | `api.lua`, `wave.lua` |
| `inventory.lua` | Equip/unequip/move handlers bridging Panorama custom events ↔ `api.lua` ↔ net tables | `api.lua`, `state.lua` |
| `wave.lua` (extend) | Scaling `f(wave, partySize)`, wave counter, inter-wave delay, drop hook on death | `loot.lua`, `timers.lua` |
| `addon_game_mode.lua` (extend) | Hero pick flow, `/session/start` on player load, net-table registration | all above |

**KV files**
- `npc_heroes_custom.txt` — `npc_dota_hero_juggernaut` ARPG override (base stats, gain, ability scaling hook).
- `npc_units_custom.txt` — keep `npc_rehab_zombie`; add scaling-friendly base stats.
- `npc_abilities_custom.txt` — `modifier_rehab_stats` declared as a Lua modifier (datadriven shell if needed).

### 4.1 Stat system (`modifier_rehab_stats`)

A single master modifier aggregates: base hero + allocated paragon stats + sum of equipped item affixes,
recomputed whenever equipped set changes. Applied through `DeclareFunctions` returning the relevant
`MODIFIER_PROPERTY_*` handlers.

**The affix `stat` strings are a hard contract** with the backend. Phase 1 maps exactly the 10 affixes
the backend's `AFFIX_POOL` (`backend/src/loot.ts`) currently rolls — no more, no less:

| Affix `stat` (from backend) | Modifier property handler |
|---|---|
| `strength` | `GetModifierBonusStats_Strength` → `MODIFIER_PROPERTY_STATS_STRENGTH_BONUS` |
| `agility` | `GetModifierBonusStats_Agility` → `MODIFIER_PROPERTY_STATS_AGILITY_BONUS` |
| `intellect` | `GetModifierBonusStats_Intellect` → `MODIFIER_PROPERTY_STATS_INTELLECT_BONUS` |
| `armor` | `GetModifierPhysicalArmorBonus` → `MODIFIER_PROPERTY_PHYSICAL_ARMOR_BONUS` |
| `health` | `GetModifierHealthBonus` → `MODIFIER_PROPERTY_HEALTH_BONUS` |
| `mana` | `GetModifierManaBonus` → `MODIFIER_PROPERTY_MANA_BONUS` |
| `attack_damage` | `GetModifierPreAttack_BonusDamage` → `MODIFIER_PROPERTY_PREATTACK_BONUS_DAMAGE` |
| `attack_speed` | `GetModifierAttackSpeedBonus_Constant` → `MODIFIER_PROPERTY_ATTACKSPEED_BONUS_CONSTANT` |
| `crit_chance` | `GetModifierPreAttack_CriticalStrike` (rolls `RandomFloat` vs `crit_chance`%, fixed 150% crit dmg) |
| `lifesteal` | `OnAttackLanded` event → heal attacker for `lifesteal`% of damage dealt |

Expanding the pool (move speed, spell amp, cooldown reduction, crit damage, resistances — parent spec §5.3)
is a **backend tuning task deferred to playtest**; when added there, a matching handler row is added here.
Single source of truth: the `stat` strings in `AFFIX_POOL` must equal the keys `stats.lua` switches on.

### 4.2 Loot drop flow (`loot.lua`)

1. On `entity_killed` for an enemy: roll drop chance (base, scalable).
2. If drop: pick a base from the slot/base table; roll **rarity** from a wave-weighted table; set **ilvl**
   from the wave tier.
3. `Api:Post("/item/pickup", {steamid, baseId, ilvl, rarity})` — backend rolls affixes and persists to bag.
4. On success, spawn a clickable/walk-over world drop prop colored by rarity; pickup pushes the item into the
   bag net table (it is already persisted server-side, so the drop prop is purely a pickup gesture).

## 5. Panorama UI

```
┌──────────────────────────────── CHARACTER ───────────────────────────────┐
│  ┌─ EQUIPPED ─────────────┐   ┌─ STATS ───────────┐   ┌─ BAG ───────────┐ │
│  │ [Helm][Amulet][   ]    │   │ STR 142  Crit 23% │   │ ▦ ▦ ▦ ▦ ▦ ▦ ▦ ▦ │ │
│  │ [Wpn ][Chest][Off ]    │   │ AGI  88  CritDmg…  │   │ ▦ ▦ ▦ ▦ ▦ ▦ ▦ ▦ │ │
│  │ [Glov][Belt ][Boot]    │   │ INT  61  LoH 12    │   │ ▦ ▦ ▦ ▦ ▦ ▦ ▦ ▦ │ │
│  │ [Ring][Ring ]          │   │ MS 415  SpellAmp…  │   │ (rarity-colored)│ │
│  └────────────────────────┘   └───────────────────┘   └─────────────────┘ │
│  [ Inventory ]  [ Stash ]  ◀ tabs        drag item → slot to equip          │
└────────────────────────────────────────────────────────────────────────────┘
```

- Slots: Weapon, Off-hand, Helm, Chest, Gloves, Boots, Belt, Amulet, Ring×2 (parent spec §5.4).
- Toggle hotkey opens/closes; rarity-colored item borders; hover shows compare tooltip vs equipped.
- Drag-drop fires `CustomGameEventManager` events → Lua `inventory.lua` → `api.lua` → net-table refresh.
- Tabs switch the right grid between **Inventory** (`location='bag'`) and **Stash** (`location='stash'`,
  account-wide). Stash moves use `/item/move`.
- Wave-counter HUD element (current wave / enemies remaining).

## 6. Backend changes

The existing API already covers `/session/start`, `/item/pickup`, `/item/equip`, `/item/unequip`,
`/item/move`, `/character/save`, `/run/complete`, `/item/craft`. Phase 1 needs only **hardening**, TDD as before:

- **Sanity caps** on `/item/pickup`: validate `rarity ∈ {Common…Mythic}` and clamp `ilvl` to `[1, MAX_ILVL]`;
  reject out-of-range with 400. (New failing test → implement.)
- Confirm `/session/start` returns `bag`, `stash`, `equipped`, `characters` separately (it does — covered by
  existing `api.test.ts`; add an assertion for stash isolation if missing).

No schema migration required.

## 7. Testing strategy (honesty split)

- **Verified by me:** all backend changes via Vitest + Docker Postgres; Lua static review; KV structural
  validation; asset/map compile via `resourcecompiler.exe` where possible; net-table payload shape contracts
  documented and checked against backend response shapes.
- **Needs your playtest (Workshop Tools GUI only):** in-engine loop — stats applying on equip, drops
  spawning, drag-equip, stash moves, wave scaling. Each build step ships explicit console commands and
  expected console/visual output.

## 8. Build sequence

1. Backend hardening (sanity caps) — TDD.
2. `hero.lua` + Juggernaut KV rescale + master modifier attach.
3. `stats.lua` + `modifier_rehab_stats` (affix → property aggregation).
4. `loot.lua` drop roll + world drop prop + `/item/pickup` wiring.
5. `state.lua` + net-table registration + `/session/start` on player load.
6. `inventory.lua` equip/unequip/move bridge.
7. Panorama UI (XML/CSS/JS): equipment, bag, stat sheet, stash tab, HUD.
8. Wave scaling + counter.
9. Playtest doc with console commands + expected output.

## 9. Open questions (deferred, not blocking)

- Exact affix weights and numeric ranges per rarity tier — tuned during playtest (parent spec §10).
- Drop-chance and rarity-by-wave curves — start conservative, tune in playtest.
- Paragon point allocation UI — minimal in Phase 1 (auto or simple), full UI later.
