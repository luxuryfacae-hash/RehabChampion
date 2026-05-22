# RehabChampion — Design Spec

**Working title:** RehabChampion (addon id: `r3hab_pit_of_champions`)
**Date:** 2026-05-22
**Type:** Dota 2 custom game (Source 2 Workshop addon) — co-op ARPG inspired by *Roshpit Champions*
**Status:** Design approved-in-progress (pending user review of this doc)

---

## 1. Vision

A 1–4 player co-op action-RPG built inside Dota 2's Source 2 engine. Players take an existing Dota hero (rescaled for ARPG play), fight escalating waves of enemies and bosses, and collect randomized loot with rarities and stat affixes. Characters, gear, and a shared stash **persist across matches** via an external backend. The signature loop is *kill → loot → upgrade → push higher difficulty*, exactly as in Roshpit Champions.

## 2. Scope & non-goals

**In scope (full game, built in phases):**
- Co-op for 1–4 players, scaling enemies/loot to party size.
- Rescaled Dota heroes as playable characters.
- Custom stat system (ARPG attributes beyond Dota's STR/AGI/INT).
- Randomized loot: bases, rarities, affixes, item levels.
- Custom equipment + inventory + stash UI in Panorama (native Dota inventory is too small).
- Crafting / re-rolling / gambling currency sinks.
- Enemy scaling, rare/champion mobs, and bosses.
- Ascension difficulty tiers.
- Persistent characters/gear/stash via an external API + Postgres.

**Non-goals (v1):**
- PvP.
- Trading between players (deferred; high abuse surface).
- Mobile/standalone — this runs only in Dota 2.
- Original 3D art/models — we reuse Dota assets (custom art is a later, optional pass).
- Matchmaking/ranked ladders.

## 3. Current state (baseline we build on)

The existing addon is **Valve's stock template renamed**, plus ~50 lines of custom Lua:
- `addon_game_mode.lua` boots and, 5s after game start, calls `SpawnEnemyWave()`.
- `wave.lua` spawns 5× `npc_dota_creature_basic_zombie` at a map entity `spawn_forest`.
- `timers.lua` is a minimal `SetContextThink` wrapper.
- KV files contain leftover template examples; `npc_items_custom.txt` is empty.
- Map is the stock `template_map.vmap`, **not compiled**.

**Three blockers prevent it running today:**
1. `wave.lua` spawns `npc_dota_creature_basic_zombie`, which is **not defined** in any KV file.
2. The map has no `spawn_forest` entity, so the spawn point lookup returns nil.
3. The `.vmap` is not compiled, so there is no playable level.

Phase 0 fixes all three.

## 4. Architecture

Two cooperating systems plus shared docs, in one monorepo (this GitHub repo).

```
RehabChampion/
├── addon/                      # mirrors Dota's content + game addon trees
│   ├── content/                # source assets (maps, particles, materials)
│   └── game/                   # runtime: vscripts (Lua), scripts/npc (KV), panorama UI, resources
├── backend/                    # Node + TypeScript (Fastify) API + Postgres
│   ├── src/
│   ├── migrations/
│   └── test/
├── docs/                       # this spec, setup guides, the implementation plan
└── tools/                      # build/symlink/compile helper scripts
```

The `addon/` tree is symlinked (or junctioned on Windows) into
`steamapps/common/dota 2 beta/{content,game}/dota_addons/r3hab_pit_of_champions`
so the repo is the single source of truth and the Workshop Tools see it live. A helper script in `tools/` creates the junctions.

### 4.1 Persistence reality

The Dota 2 Lua VM is sandboxed — it **cannot** write to disk or a DB. Persistence is achieved exactly as Roshpit does it: Lua issues HTTP requests via `CreateHTTPRequestScriptVM` to the external backend, keyed by each player's 64-bit SteamID. The backend owns all persistent state.

```
[Dota client/server, Lua]  --HTTP(JSON, HMAC-signed)-->  [Fastify API]  -->  [Postgres]
        ^  applies stats, drops loot, renders Panorama UI
```

## 5. In-engine addon design

### 5.1 Game flow
- **Hub / town:** safe area where players manage equipment, stash, vendor, crafting, and choose an ascension tier, then step into a portal to start a run.
- **Run:** a sequence of waves/zones in an arena. Enemies scale with wave number, party size, and ascension tier. A **boss** every *N* waves. Clearing grants loot, gold, and essence; death/abandon ends the run (gear is already persisted as it's acquired).
- **Return to town:** persistent character carries level, gear, stash, currency forward.

### 5.2 Heroes & progression
- Players pick from the Dota roster; we apply ARPG rescaling (HP/mana/damage curves, ability scaling) via overrides and a master modifier.
- **Character level** decoupled from Dota's 30 cap (target cap e.g. 100) with a custom XP curve; post-cap "paragon"-style points for incremental stats.
- Skill/stat points allocated by the player, persisted server-side.

### 5.3 Stat system
A master modifier (`modifier_rehab_stats`) aggregates the character's effective stats from base hero + allocated points + equipped item affixes, and applies them each update. Extended attributes beyond Dota's three:
- Crit chance, crit damage, life steal / life-on-hit, spell amplification, cooldown reduction, movement speed, attack/cast speed, area damage, and elemental/physical resistances.
- All combat-relevant values are **computed server-authoritatively** (see §6.4) before being applied; the client UI only displays them.

### 5.4 Loot system (signature mechanic)
- **Item bases** mapped to ARPG equipment slots: Weapon, Off-hand, Helm, Chest, Gloves, Boots, Belt, Amulet, Ring×2. (Stored as data, not native Dota inventory items.)
- **Rarities (6 tiers):** Common → Uncommon → Rare → Epic → Legendary → Mythic. Higher rarity = more affixes and higher affix tiers.
- **Affixes:** each item rolls prefixes/suffixes from a weighted pool; each affix is a stat mod whose magnitude tier scales with **item level** (driven by area/ascension level). Example: `+X Strength`, `+X% Attack Speed`, `+X% Crit Chance`, `+X Life on Hit`.
- **Item level & drop weighting:** higher zones/ascension raise item level and rarity odds.
- **Pickup:** loot drops as world props; walking over (or clicking) sends a server-validated pickup request; item is added to the persistent inventory.

### 5.5 Equipment / inventory / stash UI
- Native Dota inventory (6+3) is too small, so equipment, bag, and stash live in a **custom Panorama UI** backed by net tables + backend data.
- Drag-to-equip, compare tooltips, rarity coloring, stat sheet. Equipping/unequipping updates `modifier_rehab_stats` and persists.
- **Stash:** shared, account-wide storage tabs (read/write through backend).

### 5.6 Crafting & currency (Phase 3)
- **Gold:** vendor purchases / sell.
- **Essence:** re-roll affixes, upgrade rarity, add sockets. Currency sinks modeled on Roshpit's gambling/essence loop.
- **Gambling vendor:** spend currency for a random item of chosen base/ilvl.

### 5.7 Enemies, scaling & bosses
- Custom `npc_dota_creature` units reusing Dota creep models, with stat curves driven by a single scaling function of `(wave, partySize, ascension)`.
- **Rare/champion mobs:** elite enemies carrying monster modifiers (extra speed, shielding, etc.) that drop better loot.
- **Bosses:** Roshan-themed encounters every *N* waves with mechanics (telegraphed slams, adds, enrage). Guaranteed higher-rarity drops.

### 5.8 Ascension difficulty
- Tiers T1..Tn; each raises enemy HP/damage and area/item level and improves loot odds. Clearing a tier's boss unlocks the next. Unlocked tiers persist per account.

## 6. Backend design

### 6.1 Stack & hosting
- **Node + TypeScript + Fastify + Postgres.** Validation with zod; DB access via a thin query layer (e.g. `pg` + SQL migrations, or Drizzle).
- **Hosting:** production on the user's **VPS** (existing `codex_vps` access); local Postgres + `node` for dev. (Changeable to a managed host later.)

### 6.2 Data model (initial)
- `accounts(steamid64 PK, created_at, last_seen)`
- `characters(id PK, steamid64 FK, hero_name, level, xp, paragon_points, gold, essence, ascension_unlocked, allocated_stats JSONB, created_at)`
- `items(id PK, owner_steamid64 FK, character_id FK NULL, base_id, rarity, ilvl, affixes JSONB, sockets JSONB, location ENUM[equipped|bag|stash], slot, created_at)`
- Indexes on `owner_steamid64`, `character_id`, `location`.

### 6.3 API (initial surface)
- `POST /session/start` → `{ steamid, sig }` ⇒ character(s) + equipped + bag + stash snapshot.
- `POST /character/save` → level/xp/paragon/gold/essence/allocated_stats.
- `POST /item/pickup` → server **rolls** the item (client never sends stats) and stores it.
- `POST /item/equip` · `POST /item/unequip` · `POST /item/move` (bag↔stash).
- `POST /item/craft` → server applies essence operation, validates currency.
- `POST /run/complete` → persist rewards/progress.

### 6.4 Security model
- Every request carries `steamid64` + an **HMAC signature** using a shared secret (env var) known to the addon and backend; backend rejects bad signatures.
- **Server-authoritative loot/stats:** the backend rolls affixes and computes item power; the client may *request* actions ("pick up this drop", "equip item N") but never asserts numeric values. This blocks the obvious stat-injection cheats.
- Residual trust: a listen-server host can still call the API as themselves; we accept this (as Roshpit-class games do) and document it. Rate-limiting + sanity caps mitigate abuse.

## 7. Build phases (roadmap)

- **Phase 0 — Foundation & "it runs."** Pull the addon into the repo, set up the symlink/junction + CLI build helpers, fix the 3 blockers (define enemy units, add spawn points, compile a basic arena map), spawn scaling waves you can fight. *No loot/UI/backend yet.*
- **Phase 1 — Stats + loot (single-match).** Master stat modifier, item data model in-engine, drops with rarities/affixes, custom Panorama equipment/inventory UI, wave counter HUD. Everything resets per match (no backend yet).
- **Phase 2 — Persistence.** Build the backend (API + Postgres + tests), wire Lua HTTP client, persist characters/gear/stash, account-wide stash, HMAC + server-authoritative validation. Deploy to VPS.
- **Phase 3 — Depth.** Crafting/essence/gambling, bosses, ascension tiers, town hub & vendors.
- **Phase 4 — Co-op & ship.** Party scaling/balance, polish, packaging for Workshop publish.

Each phase gets its own implementation plan and is independently testable.

## 8. Testing strategy

- **Backend:** fully testable by me — unit + integration tests (API + DB via a test Postgres), run in CI/locally. This is where most automatable correctness lives, so loot rolling, validation, and persistence logic are pushed backend-side.
- **Addon Lua/KV:** I can do static review and structural validation, and compile assets via CLI `resourcecompiler.exe` where possible. **I cannot playtest in-engine** — launching/playing requires the Workshop Tools GUI and your Steam client. Each phase ships with explicit manual test steps and console commands for you to run.
- **Honesty rule:** I will always distinguish "verified by me" from "needs your playtest."

## 9. Finalize / setup checklist (for the user)

1. Enable Workshop Tools: Steam → Library → Dota 2 → right-click → *Properties* → set launch option / install **Dota 2 Workshop Tools** DLC if not present.
2. Run `tools/link-addon` (provided) to junction the repo's `addon/content` and `addon/game` into the Dota addon folders.
3. Build the map (Hammer, or CLI compile helper) and assets.
4. Launch Dota 2 with **Tools** → load addon `r3hab_pit_of_champions` → *Play*.
5. For persistence: deploy `backend/` to the VPS, set the shared HMAC secret + DB URL, point the addon's API base URL at it.

## 10. Risks & open questions

- **No in-engine playtest by me** — the tightest constraint; mitigated by backend-heavy logic + clear manual test steps.
- **Map authoring** needs Hammer for anything beyond a flat arena; Phase 0 uses a minimal arena to stay CLI-buildable.
- **HTTP from custom games** works in Tools and published modes; we validate early in Phase 2.
- **Anti-cheat residual trust** on listen servers — accepted and documented.
- **Open:** final hero shortlist for rescaling tuning; exact rarity/affix weights and number ranges (tuned in Phase 1); single vs. multiple characters per account (default: multiple).

---

*Next step after approval: invoke the writing-plans skill to produce the Phase 0 implementation plan.*
