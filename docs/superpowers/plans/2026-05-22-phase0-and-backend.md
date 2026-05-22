# RehabChampion — Phase 0 (Addon Foundation) + Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the addon into the repo with the three run-blockers fixed, and build a fully tested persistence backend (Node + TypeScript + Fastify + Postgres) that the addon will call.

**Architecture:** Monorepo. `addon/` mirrors the Dota content+game trees and is junctioned into the Workshop addon folders. `backend/` is a standalone Fastify service with Postgres, tested against a Docker Postgres. The two communicate via HMAC-signed JSON over HTTP.

**Tech Stack:** Lua (VScripts), Valve KV; Node 24, TypeScript, Fastify, zod, `pg`, node-postgres migrations via `node-pg-migrate`, Vitest, Docker Postgres.

---

## File Structure

```
addon/
  game/dota_addons/r3hab_pit_of_champions/
    scripts/vscripts/addon_game_mode.lua    # boot + game state hooks
    scripts/vscripts/wave.lua               # wave spawning (FIX blocker #1)
    scripts/vscripts/timers.lua             # timer helper
    scripts/npc/npc_units_custom.txt        # define enemy units (FIX blocker #1)
    addoninfo.txt                           # addon metadata
  content/dota_addons/r3hab_pit_of_champions/
    maps/arena.vmap                         # minimal arena w/ spawn entity (FIX blockers #2,#3)
tools/
  link-addon.ps1                            # junction repo <-> Dota addon folders
  compile.ps1                               # CLI resourcecompiler wrapper
backend/
  package.json  tsconfig.json  vitest.config.ts  docker-compose.yml  .env.example
  migrations/1700000000000_init.cjs         # accounts, characters, items
  src/config.ts                             # env loading + validation
  src/hmac.ts                               # request signing/verification
  src/db.ts                                 # pg pool
  src/repo/characters.ts                    # character queries
  src/repo/items.ts                         # item queries
  src/loot.ts                               # server-authoritative affix rolling
  src/server.ts                             # Fastify app + routes
  src/index.ts                              # entrypoint
  test/hmac.test.ts  test/loot.test.ts  test/api.test.ts
```

---

## Part A — Addon Foundation (Phase 0)

### Task A1: Import existing addon into the repo

**Files:**
- Create: `addon/game/dota_addons/r3hab_pit_of_champions/...` (copy from Dota install)
- Create: `addon/content/dota_addons/r3hab_pit_of_champions/...`

- [ ] **Step 1:** Copy the existing addon `game` and `content` trees from `D:\Program Files (x86)\Steam\steamapps\common\dota 2 beta\{game,content}\dota_addons\r3hab_pit_of_champions` into `addon/`. Exclude tool caches (`tools_*.bin`, `*.sqlite3`, `*_c` compiled outputs).
- [ ] **Step 2:** Add `.gitignore` for compiled artifacts (`*_c`, `tools_*.bin`, `*.sqlite3`).
- [ ] **Step 3:** Commit: `chore(addon): import r3hab_pit_of_champions source into repo`.

### Task A2: Fix blocker #1 — define the enemy unit the wave spawns

**Files:**
- Modify: `addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/wave.lua`
- Modify: `addon/game/dota_addons/r3hab_pit_of_champions/scripts/npc/npc_units_custom.txt`

- [ ] **Step 1:** In `npc_units_custom.txt`, add a `npc_rehab_zombie` unit definition based on a stock zombie/creep model with sane base stats (HP 200, dmg 20-24, MS 280, BaseClass `npc_dota_creature`).
- [ ] **Step 2:** In `wave.lua`, change the spawned unit name from `npc_dota_creature_basic_zombie` to `npc_rehab_zombie`, and add a guard that logs an error if `CreateUnitByName` returns nil.
- [ ] **Step 3:** Commit: `fix(addon): spawn defined npc_rehab_zombie instead of undefined unit`.

### Task A3: Fix blockers #2 & #3 — arena map with spawn point, compiled via CLI

**Files:**
- Create: `addon/content/dota_addons/r3hab_pit_of_champions/maps/arena.vmap`
- Create: `tools/link-addon.ps1`, `tools/compile.ps1`

- [ ] **Step 1:** Write `tools/link-addon.ps1` that creates directory junctions from the Dota addon folders to the repo's `addon/game/...` and `addon/content/...` (so the tools see repo files).
- [ ] **Step 2:** Author a minimal `arena.vmap` (KV3) containing a flat playable surface and an `info_target`/entity named `spawn_forest` at a known origin so `wave.lua`'s `Entities:FindByName(nil,"spawn_forest")` resolves. (If hand-authoring the .vmap proves unreliable, document that the user opens Hammer once, drops a named entity, and saves — this is the one manual fallback.)
- [ ] **Step 3:** Write `tools/compile.ps1` invoking `game/bin/win64/resourcecompiler.exe -i <map/asset>` to build the map and particles.
- [ ] **Step 4 (manual, documented):** User runs Dota 2 → Tools → load addon → Play; expect console line `R3HAB PIT OF CHAMPIONS LOADED`, then `SPAWNING WAVE`, then 5 zombies appear.
- [ ] **Step 5:** Commit: `feat(addon): minimal arena map with spawn point + build scripts`.

---

## Part B — Backend (TDD)

### Task B1: Scaffold backend project

**Files:** Create `backend/package.json`, `tsconfig.json`, `vitest.config.ts`, `docker-compose.yml`, `.env.example`, `src/config.ts`.

- [ ] **Step 1:** `package.json` with deps: `fastify`, `zod`, `pg`, `node-pg-migrate`; dev: `typescript`, `tsx`, `vitest`, `@types/node`, `@types/pg`. Scripts: `dev`, `build`, `test`, `migrate`.
- [ ] **Step 2:** `docker-compose.yml` exposing Postgres 16 on `5433` with a test DB.
- [ ] **Step 3:** `src/config.ts` loads + zod-validates `DATABASE_URL`, `HMAC_SECRET`, `PORT`.
- [ ] **Step 4:** Commit: `chore(backend): scaffold Fastify + TS + Postgres project`.

### Task B2: HMAC signing (TDD)

**Files:** Create `src/hmac.ts`, `test/hmac.test.ts`.

- [ ] **Step 1: Write failing test** `test/hmac.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sign, verify } from "../src/hmac";
describe("hmac", () => {
  const secret = "test-secret";
  it("verifies a correctly signed body", () => {
    const body = JSON.stringify({ steamid: "123", n: 1 });
    expect(verify(secret, body, sign(secret, body))).toBe(true);
  });
  it("rejects a tampered body", () => {
    const sig = sign(secret, JSON.stringify({ steamid: "123" }));
    expect(verify(secret, JSON.stringify({ steamid: "999" }), sig)).toBe(false);
  });
});
```
- [ ] **Step 2:** Run `npx vitest run test/hmac.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `src/hmac.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";
export const sign = (secret: string, body: string): string =>
  createHmac("sha256", secret).update(body).digest("hex");
export const verify = (secret: string, body: string, sig: string): boolean => {
  const a = Buffer.from(sign(secret, body));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
};
```
- [ ] **Step 4:** Run test → PASS.
- [ ] **Step 5:** Commit: `feat(backend): HMAC request signing`.

### Task B3: DB schema + migration

**Files:** Create `migrations/<ts>_init.cjs`, `src/db.ts`.

- [ ] **Step 1:** Migration creates:
  - `accounts(steamid64 TEXT PK, created_at TIMESTAMPTZ DEFAULT now(), last_seen TIMESTAMPTZ DEFAULT now())`
  - `characters(id SERIAL PK, steamid64 TEXT REFERENCES accounts, hero_name TEXT, level INT DEFAULT 1, xp BIGINT DEFAULT 0, paragon_points INT DEFAULT 0, gold BIGINT DEFAULT 0, essence BIGINT DEFAULT 0, ascension_unlocked INT DEFAULT 1, allocated_stats JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT now())`
  - `items(id SERIAL PK, owner_steamid64 TEXT REFERENCES accounts, character_id INT NULL REFERENCES characters, base_id TEXT, rarity TEXT, ilvl INT, affixes JSONB, sockets JSONB DEFAULT '[]', location TEXT CHECK (location IN ('equipped','bag','stash')) DEFAULT 'bag', slot TEXT NULL, created_at TIMESTAMPTZ DEFAULT now())`
  - Indexes on `items(owner_steamid64)`, `items(character_id)`.
- [ ] **Step 2:** `src/db.ts` exports a `pg` Pool from `DATABASE_URL`.
- [ ] **Step 3:** Run migration against Docker Postgres; verify tables exist.
- [ ] **Step 4:** Commit: `feat(backend): initial schema (accounts, characters, items)`.

### Task B4: Server-authoritative loot rolling (TDD)

**Files:** Create `src/loot.ts`, `test/loot.test.ts`.

- [ ] **Step 1: Write failing test** asserting: rarity influences affix count (Common=1 … Mythic=6); affix magnitudes scale with `ilvl`; output shape is `{ baseId, rarity, ilvl, affixes: [{stat, value}] }`; rolling is deterministic given a seeded RNG.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `src/loot.ts`: a weighted affix pool, `affixCountForRarity()`, `rollItem(baseId, ilvl, rarity, rng)` computing values as `base + perIlvl*ilvl` per affix tier. Pure function; RNG injectable.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(backend): server-authoritative loot rolling`.

### Task B5: Repos + API routes (TDD with Docker Postgres)

**Files:** Create `src/repo/characters.ts`, `src/repo/items.ts`, `src/server.ts`, `src/index.ts`, `test/api.test.ts`.

- [ ] **Step 1: Write failing integration test** `test/api.test.ts` (boots Fastify app against Docker Postgres):
  - `POST /session/start` with valid HMAC for a new steamid creates an account and returns `{ characters: [], stash: [] }`.
  - Bad signature → 401.
  - `POST /item/pickup` rolls + stores an item server-side and returns it; the client-sent stats (if any) are ignored.
  - `POST /item/equip` moves an item to `equipped` and sets its slot.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** repos (parameterized SQL) + `server.ts` (a Fastify `preHandler` verifying HMAC over the raw body using `src/hmac.ts`, then routes calling repos/loot). `index.ts` starts it on `PORT`.
- [ ] **Step 4:** Run full suite → PASS.
- [ ] **Step 5:** Commit: `feat(backend): session/item API with HMAC auth + persistence`.

### Task B6: Lua HTTP client stub for the addon

**Files:** Create `addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/api.lua`.

- [ ] **Step 1:** Implement `api.lua` with `Api:Post(path, payload, cb)` using `CreateHTTPRequestScriptVM`, JSON-encoding the body, attaching the HMAC header (shared secret from a config), and base URL from a config constant. (Cannot be unit-tested off-engine; documented for in-engine test.)
- [ ] **Step 2:** Commit: `feat(addon): backend HTTP client (api.lua)`.

---

## Self-Review

- **Spec coverage:** Architecture (§4) → A1, B1; persistence reality (§4.1) → B6; loot (§5.4) → B4; data model (§6.2) → B3; API (§6.3) → B5; security (§6.4) → B2, B5. Blockers (§3) → A2, A3. Stats/UI/crafting/bosses/ascension are later phases (out of this plan's scope, by design).
- **Placeholder scan:** Map authoring (A3) has a documented manual fallback rather than a fake "TODO" — acceptable given the GUI constraint. No other placeholders.
- **Type consistency:** `sign/verify` signatures match across B2/B5; item shape `{baseId,rarity,ilvl,affixes}` consistent between B4 and B5; `location` enum consistent between B3 and B5.

## Execution Handoff

Backend tasks (B*) are fully verifiable here (Docker Postgres + Vitest). Addon tasks (A*) are code-complete but the final playtest (A3 Step 4) is yours.
