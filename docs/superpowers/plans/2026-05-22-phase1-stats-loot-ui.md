# RehabChampion Phase 1 — Stats + Loot + UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the persisted ARPG core loop in-engine — Juggernaut with item-affix stats, server-rolled loot drops, and a Panorama equipment/bag/stash UI — wired to the existing backend from the first kill.

**Architecture:** The Lua game-server (host) drives gameplay and decides drop rarity/ilvl from wave context; the backend rolls affix magnitudes and owns persistence. `CustomNetTables` mirror authoritative backend state to each Panorama client; Panorama only displays state and fires `CustomGameEventManager` requests. A single master modifier (`modifier_rehab_stats`) aggregates equipped affixes into Dota stat properties.

**Tech Stack:** Lua (VScripts), Valve KV, Panorama (XML/CSS/TypeScript-as-JS); backend Node 24 + TypeScript + Fastify + Postgres + Vitest (already built).

---

## Shared Contracts (referenced by every task — do not diverge)

**Backend item shape** (`ItemRow`, returned by `/item/*` and `/session/start`):
```
{ id:int, owner_steamid64:string, character_id:int|null, base_id:string, rarity:string,
  ilvl:int, affixes:[{stat:string, value:number}], sockets:[], location:"equipped"|"bag"|"stash",
  slot:string|null, created_at:string }
```

**Affix `stat` keys (exactly these 10, from `backend/src/loot.ts` AFFIX_POOL):**
`strength, agility, intellect, armor, health, mana, attack_damage, attack_speed, crit_chance, lifesteal`

**Equip slot ids (UI ↔ Lua ↔ backend `slot` column):**
`weapon, offhand, helm, chest, gloves, boots, belt, amulet, ring1, ring2`

**Custom net tables:**
- `rehab_player`, key = `tostring(playerId)` → `{ character:{...}|nil, equipped:[item], bag:[item], stash:[item] }`
- `rehab_wave`, key = `"state"` → `{ wave:int, remaining:int }`

**Custom game events (client → server):**
- `rehab_equip` → `{ itemId:int, slot:string }`
- `rehab_unequip` → `{ itemId:int }`
- `rehab_move` → `{ itemId:int, location:"bag"|"stash" }`

**SteamID resolution (Lua):** `PlayerResource:GetSteamID(playerId)` returns a uint64; in Tools it can be `0`. Use helper `RehabSteamId(playerId)` returning `tostring(steamid)` when nonzero, else `"test_"..playerId` so local playtests persist deterministically.

**Backend base URL / secret:** already in `api.lua` (`API_BASE_URL = "http://127.0.0.1:3000"`, `API_HMAC_SECRET`). The secret MUST equal the backend's `HMAC_SECRET` env var at playtest time.

---

## Part A — Backend hardening (TDD; fully verified by me)

### Task A1: Cap item level on `/item/pickup`

`rarity` is already enum-validated and `ilvl` is `.int().positive()`. The only missing guard is an upper bound on `ilvl` (prevents a host requesting ilvl 10^9 to inflate affixes).

**Files:**
- Modify: `backend/src/loot.ts` (export `MAX_ILVL`)
- Modify: `backend/src/server.ts` (`/item/pickup` schema)
- Test: `backend/test/api.test.ts` (add case)

- [ ] **Step 1: Write the failing test.** Append to `backend/test/api.test.ts` inside the `describe("POST /item/pickup", ...)` block:

```ts
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
```

- [ ] **Step 2: Run it, expect FAIL.**

Run (from `backend/`, with Docker Postgres up — see "Running the backend" at end):
```
$env:DATABASE_URL="postgres://rehab:rehab@localhost:5433/rehab"; npx vitest run test/api.test.ts
```
Expected: the new test FAILs (got 200, expected 400).

- [ ] **Step 3: Implement.** In `backend/src/loot.ts`, add after `RARITIES`:

```ts
/** Highest item level the server will roll. Drop tier is f(wave); this caps abuse. */
export const MAX_ILVL = 1000;
```

In `backend/src/server.ts`, import it and tighten the pickup schema:

```ts
import { rollItem, RARITIES, MAX_ILVL, type Rarity } from "./loot.js";
```
```ts
    const schema = z.object({
      steamid: z.string().min(1),
      characterId: z.number().int().nullable().optional(),
      baseId: z.string().min(1),
      ilvl: z.number().int().positive().max(MAX_ILVL),
      rarity: rarityEnum,
    });
```

- [ ] **Step 4: Run tests, expect PASS.**
```
$env:DATABASE_URL="postgres://rehab:rehab@localhost:5433/rehab"; npx vitest run
```
Expected: all suites pass (18 tests).

- [ ] **Step 5: Commit.**
```
git add backend/src/loot.ts backend/src/server.ts backend/test/api.test.ts
git commit -m "feat(backend): cap item level on pickup to prevent affix inflation"
```

---

## Part B — In-engine gameplay (Lua/KV; static review + your playtest)

> Path prefix for this part: `addon/game/dota_addons/r3hab_pit_of_champions/`

### Task B2-prereq / Task B1: Juggernaut ARPG rescale (KV)

**Files:**
- Modify: `scripts/npc/npc_heroes_custom.txt`

- [ ] **Step 1: Replace the placeholder Templar Assassin override** with a Juggernaut ARPG rescale. Overwrite the file body inside `"DOTAHeroes" { ... }`:

```
"DOTAHeroes"
{
	"npc_dota_hero_juggernaut"
	{
		"override_hero"				"npc_dota_hero_juggernaut"
		"MaxLevel"					"100"
		// Flatter ARPG stat gain; item affixes do the heavy lifting.
		"AttributeBaseStrength"		"24"
		"AttributeStrengthGain"		"3.0"
		"AttributeBaseAgility"		"20"
		"AttributeAgilityGain"		"2.8"
		"AttributeBaseIntelligence"	"14"
		"AttributeIntelligenceGain"	"1.8"
		"StatusHealthRegen"			"2.0"
		"MovementSpeed"				"315"
	}
}
```

- [ ] **Step 2: Static check.** Confirm the KV parses: balanced quotes/braces, single root `"DOTAHeroes"`. (No engine compile needed for hero KV.)

- [ ] **Step 3: Commit.**
```
git add addon/game/dota_addons/r3hab_pit_of_champions/scripts/npc/npc_heroes_custom.txt
git commit -m "feat(addon): rescale Juggernaut for ARPG (level cap 100, flat gains)"
```

### Task B2: Master stat modifier (`modifier_rehab_stats`)

Aggregates a flat affix table into Dota stat properties. Pure aggregation — values come from `stats.lua`'s cache, set by `inventory.lua`/`state.lua`.

**Files:**
- Create: `scripts/vscripts/modifiers/modifier_rehab_stats.lua`
- Create: `scripts/vscripts/stats.lua`
- Modify: `scripts/vscripts/addon_game_mode.lua` (LinkLuaModifier)

- [ ] **Step 1: Create `scripts/vscripts/stats.lua`** — converts a list of equipped items into a summed affix map:

```lua
-- stats.lua — pure aggregation of equipped item affixes into a flat stat map.
Stats = Stats or {}

-- The 10 affix keys the backend rolls. Keep in sync with backend/src/loot.ts AFFIX_POOL.
Stats.KEYS = {
  "strength", "agility", "intellect", "armor", "health", "mana",
  "attack_damage", "attack_speed", "crit_chance", "lifesteal",
}

--- Sum affixes across a list of equipped item tables → { stat = total }.
-- @param equipped table  array of items: { affixes = { {stat=,value=}, ... } }
-- @return table  map of stat key -> number (missing keys absent)
function Stats.Aggregate(equipped)
  local out = {}
  for _, item in ipairs(equipped or {}) do
    for _, affix in ipairs(item.affixes or {}) do
      out[affix.stat] = (out[affix.stat] or 0) + (affix.value or 0)
    end
  end
  return out
end

return Stats
```

- [ ] **Step 2: Create `scripts/vscripts/modifiers/modifier_rehab_stats.lua`:**

```lua
-- modifier_rehab_stats — master ARPG stat modifier. One per hero.
-- Holds an aggregated affix map (set via :SetStatMap) and exposes it to Dota
-- through the property handlers below. crit_chance/lifesteal are handled on attack.
modifier_rehab_stats = class({})

function modifier_rehab_stats:IsHidden() return true end
function modifier_rehab_stats:IsPurgable() return false end
function modifier_rehab_stats:RemoveOnDeath() return false end

function modifier_rehab_stats:OnCreated()
  self.stats = {}
end

-- Called by inventory/state code whenever the equipped set changes.
function modifier_rehab_stats:SetStatMap(map)
  self.stats = map or {}
  if IsServer() then self:ForceRefresh() end
end

local function s(self, key) return self.stats and self.stats[key] or 0 end

function modifier_rehab_stats:DeclareFunctions()
  return {
    MODIFIER_PROPERTY_STATS_STRENGTH_BONUS,
    MODIFIER_PROPERTY_STATS_AGILITY_BONUS,
    MODIFIER_PROPERTY_STATS_INTELLECT_BONUS,
    MODIFIER_PROPERTY_PHYSICAL_ARMOR_BONUS,
    MODIFIER_PROPERTY_HEALTH_BONUS,
    MODIFIER_PROPERTY_MANA_BONUS,
    MODIFIER_PROPERTY_PREATTACK_BONUS_DAMAGE,
    MODIFIER_PROPERTY_ATTACKSPEED_BONUS_CONSTANT,
    MODIFIER_PROPERTY_PREATTACK_CRITICALSTRIKE,
    MODIFIER_EVENT_ON_ATTACK_LANDED,
  }
end

function modifier_rehab_stats:GetModifierBonusStats_Strength() return s(self, "strength") end
function modifier_rehab_stats:GetModifierBonusStats_Agility() return s(self, "agility") end
function modifier_rehab_stats:GetModifierBonusStats_Intellect() return s(self, "intellect") end
function modifier_rehab_stats:GetModifierPhysicalArmorBonus() return s(self, "armor") end
function modifier_rehab_stats:GetModifierHealthBonus() return s(self, "health") end
function modifier_rehab_stats:GetModifierManaBonus() return s(self, "mana") end
function modifier_rehab_stats:GetModifierPreAttack_BonusDamage() return s(self, "attack_damage") end
function modifier_rehab_stats:GetModifierAttackSpeedBonus_Constant() return s(self, "attack_speed") end

-- crit_chance is a percent; fixed 150% crit damage in Phase 1 (crit_damage affix is a later pool addition).
function modifier_rehab_stats:GetModifierPreAttack_CriticalStrike()
  local chance = s(self, "crit_chance")
  if chance > 0 and RandomFloat(0, 100) <= chance then
    return 150
  end
  return nil
end

-- lifesteal is a percent of damage dealt, healed to the attacker.
function modifier_rehab_stats:OnAttackLanded(params)
  if not IsServer() then return end
  if params.attacker ~= self:GetParent() then return end
  local pct = s(self, "lifesteal")
  if pct > 0 and params.damage and params.damage > 0 then
    self:GetParent():Heal(params.damage * pct / 100, self:GetParent())
  end
end

return modifier_rehab_stats
```

- [ ] **Step 3: Register the Lua modifier** in `scripts/vscripts/addon_game_mode.lua`. Add at the very top (before `require`s use it the engine needs it linked early):

```lua
require("wave")
require("timers")
require("stats")

LinkLuaModifier("modifier_rehab_stats", "modifiers/modifier_rehab_stats", LUA_MODIFIER_MOTION_NONE)
```

- [ ] **Step 4: Static review.** Verify: `LinkLuaModifier` path matches the file location (`modifiers/modifier_rehab_stats.lua`); every key in `Stats.KEYS` has either a property handler or on-attack handling; no typos in `MODIFIER_PROPERTY_*` constant names.

- [ ] **Step 5: Commit.**
```
git add addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/stats.lua \
        addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/modifiers/modifier_rehab_stats.lua \
        addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/addon_game_mode.lua
git commit -m "feat(addon): modifier_rehab_stats aggregates equipped affixes"
```

### Task B3: Session state cache + net-table sync (`state.lua`)

Owns each player's authoritative snapshot, pushes it to the client net table, and refreshes the hero's stat modifier.

**Files:**
- Create: `scripts/vscripts/state.lua`
- Modify: `scripts/vscripts/addon_game_mode.lua`

- [ ] **Step 1: Create `scripts/vscripts/state.lua`:**

```lua
-- state.lua — per-player authoritative session snapshot + net-table sync.
require("api")
require("stats")

State = State or {}
State.byPlayer = State.byPlayer or {}  -- playerId -> { steamid, character, equipped, bag, stash }

function RehabSteamId(playerId)
  local sid = PlayerResource:GetSteamID(playerId)
  if sid and sid ~= 0 then return tostring(sid) end
  return "test_" .. tostring(playerId)
end

-- Push the player's snapshot to the rehab_player net table (client reads it).
function State:Sync(playerId)
  local p = self.byPlayer[playerId]
  if not p then return end
  CustomNetTables:SetTableValue("rehab_player", tostring(playerId), {
    character = p.character,
    equipped = p.equipped or {},
    bag = p.bag or {},
    stash = p.stash or {},
  })
  self:RefreshModifier(playerId)
end

-- Recompute the master modifier from equipped items.
function State:RefreshModifier(playerId)
  local p = self.byPlayer[playerId]
  if not p or not p.hero then return end
  local mod = p.hero:FindModifierByName("modifier_rehab_stats")
  if mod then mod:SetStatMap(Stats.Aggregate(p.equipped)) end
end

-- Called once the player's hero exists. Boots the backend session.
function State:Start(playerId, hero)
  local steamid = RehabSteamId(playerId)
  self.byPlayer[playerId] = { steamid = steamid, hero = hero, equipped = {}, bag = {}, stash = {} }
  hero:AddNewModifier(hero, nil, "modifier_rehab_stats", {})

  Api:Post("/session/start", { steamid = steamid }, function(ok, data)
    if not ok or not data then
      print("[State] session/start failed for " .. steamid)
      return
    end
    local p = self.byPlayer[playerId]
    p.equipped, p.bag, p.stash = data.equipped or {}, data.bag or {}, data.stash or {}
    if data.characters and #data.characters > 0 then
      p.character = data.characters[1]
      self:Sync(playerId)
    else
      -- New account: create the Juggernaut character.
      Api:Post("/character/save", { steamid = steamid, heroName = "npc_dota_hero_juggernaut" },
        function(ok2, data2)
          if ok2 and data2 then p.character = data2.character end
          self:Sync(playerId)
        end)
    end
  end)
end

return State
```

- [ ] **Step 2: Wire hero spawn** in `addon_game_mode.lua`. Add a player-hero hook in `InitGameMode`:

```lua
function GameMode:InitGameMode()
    print("R3HAB PIT OF CHAMPIONS LOADED")
    require("state")
    require("loot")
    require("inventory")
    ListenToGameEvent("game_rules_state_change", Dynamic_Wrap(GameMode, "OnGameStart"), self)
    ListenToGameEvent("npc_spawned", Dynamic_Wrap(GameMode, "OnNpcSpawned"), self)
end

function GameMode:OnNpcSpawned(event)
    local unit = EntIndexToHScript(event.entindex)
    if unit and unit:IsRealHero() and not unit.rehab_started then
        unit.rehab_started = true
        State:Start(unit:GetPlayerOwnerID(), unit)
    end
end
```

- [ ] **Step 3: Static review.** Confirm `rehab_player` net table is registered client-side (Task C1) and that `Api:Post` callback shape matches `api.lua` (`cb(ok, decoded, status, raw)`).

- [ ] **Step 4: Commit.**
```
git add addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/state.lua \
        addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/addon_game_mode.lua
git commit -m "feat(addon): session bootstrap + net-table sync (state.lua)"
```

### Task B4: Loot drops (`loot.lua`)

On enemy death, the Lua host rolls drop chance + rarity (wave-weighted) + ilvl (wave tier), asks the backend to roll affixes, then spawns a clickable world drop that adds the item to the bag.

**Files:**
- Create: `scripts/vscripts/loot.lua`
- Modify: `scripts/vscripts/addon_game_mode.lua` (entity_killed hook)

- [ ] **Step 1: Create `scripts/vscripts/loot.lua`:**

```lua
-- loot.lua — host-side drop rolling; backend rolls affix magnitudes.
require("api")

Loot = Loot or {}

Loot.BASES = { "weapon_axe", "helm_01", "chest_01", "boots_01", "ring_01", "amulet_01" }
Loot.SLOT_OF = {
  weapon_axe = "weapon", helm_01 = "helm", chest_01 = "chest",
  boots_01 = "boots", ring_01 = "ring1", amulet_01 = "amulet",
}

-- Rarity weights shift toward higher tiers as waves climb.
local RARITIES = { "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic" }
local function rollRarity(wave)
  local weights = {
    math.max(1, 60 - wave * 2), 25, math.min(40, 5 + wave),
    math.min(20, wave), math.min(8, wave / 2), math.min(3, wave / 4),
  }
  local total = 0
  for _, w in ipairs(weights) do total = total + w end
  local r = RandomFloat(0, total)
  for i, w in ipairs(weights) do
    r = r - w
    if r <= 0 then return RARITIES[i] end
  end
  return "Common"
end

-- Drop chance per kill (tune in playtest).
Loot.DROP_CHANCE = 0.35

-- Called on enemy death. playerId = killer's owner (loot goes to them).
function Loot:OnEnemyKilled(playerId, wave, position)
  if RandomFloat(0, 1) > self.DROP_CHANCE then return end
  local steamid = RehabSteamId(playerId)
  local baseId = self.BASES[RandomInt(1, #self.BASES)]
  local rarity = rollRarity(wave)
  local ilvl = math.min(1000, 1 + wave * 5)

  Api:Post("/item/pickup", { steamid = steamid, baseId = baseId, ilvl = ilvl, rarity = rarity },
    function(ok, data)
      if not ok or not data or not data.item then return end
      self:SpawnDrop(playerId, data.item, position)
    end)
end

-- Spawn a clickable world drop; clicking/walking over adds it to the bag net table.
function Loot:SpawnDrop(playerId, item, position)
  local p = State.byPlayer[playerId]
  if p then
    table.insert(p.bag, item)
    State:Sync(playerId)
  end
  -- Visible feedback: a rune-style prop at the kill location.
  local drop = CreateUnitByName("npc_dota_creature", position, false, nil, nil, DOTA_TEAM_NEUTRALS)
  if drop then
    drop:AddNewModifier(drop, nil, "modifier_phased", { duration = 5 })
    Timers:CreateTimer(5, function() if not drop:IsNull() then drop:RemoveSelf() end end)
  end
  print(string.format("[Loot] %s dropped %s (%s ilvl %d)", item.base_id or "?", item.rarity or "?", item.rarity or "?", item.ilvl or 0))
end

return Loot
```

- [ ] **Step 2: Hook `entity_killed`** in `addon_game_mode.lua` `InitGameMode`:

```lua
    ListenToGameEvent("entity_killed", Dynamic_Wrap(GameMode, "OnEntityKilled"), self)
```
and the handler:
```lua
function GameMode:OnEntityKilled(event)
    local killed = EntIndexToHScript(event.entindex_killed)
    local attacker = event.entindex_attacker and EntIndexToHScript(event.entindex_attacker)
    if not killed or killed:GetTeamNumber() ~= DOTA_TEAM_BADGUYS then return end
    local playerId = (attacker and attacker.GetPlayerOwnerID and attacker:GetPlayerOwnerID()) or 0
    if playerId < 0 then playerId = 0 end
    Loot:OnEnemyKilled(playerId, Wave.current or 1, killed:GetAbsOrigin())
end
```

- [ ] **Step 3: Static review.** `Wave.current` is defined in Task B6; `State.byPlayer` from B3; item field is `base_id`/`ilvl` (snake_case from backend), not `baseId`.

- [ ] **Step 4: Commit.**
```
git add addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/loot.lua \
        addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/addon_game_mode.lua
git commit -m "feat(addon): server-rolled loot drops on enemy kill (loot.lua)"
```

### Task B5: Equip/move bridge (`inventory.lua`)

Receives Panorama requests, calls the backend, and re-syncs.

**Files:**
- Create: `scripts/vscripts/inventory.lua`
- Modify: `scripts/vscripts/addon_game_mode.lua` (register custom events)

- [ ] **Step 1: Create `scripts/vscripts/inventory.lua`:**

```lua
-- inventory.lua — bridges Panorama custom events to the backend, then re-syncs.
require("api")

Inventory = Inventory or {}

local function findAndRemove(list, itemId)
  for i, it in ipairs(list) do
    if it.id == itemId then table.remove(list, i); return it end
  end
  return nil
end

function Inventory:Register()
  CustomGameEventManager:RegisterListener("rehab_equip", function(_, ev) self:OnEquip(ev) end)
  CustomGameEventManager:RegisterListener("rehab_unequip", function(_, ev) self:OnUnequip(ev) end)
  CustomGameEventManager:RegisterListener("rehab_move", function(_, ev) self:OnMove(ev) end)
end

function Inventory:OnEquip(ev)
  local playerId = ev.PlayerID
  local p = State.byPlayer[playerId]; if not p then return end
  Api:Post("/item/equip", { steamid = p.steamid, itemId = ev.itemId, slot = ev.slot,
                            characterId = p.character and p.character.id },
    function(ok, data)
      if not ok or not data or not data.item then return end
      -- Unequip whatever was in that slot back to the bag, locally + server already moved it.
      for i = #p.equipped, 1, -1 do
        if p.equipped[i].slot == ev.slot then table.insert(p.bag, p.equipped[i]); table.remove(p.equipped, i) end
      end
      findAndRemove(p.bag, ev.itemId)
      table.insert(p.equipped, data.item)
      State:Sync(playerId)
    end)
end

function Inventory:OnUnequip(ev)
  local playerId = ev.PlayerID
  local p = State.byPlayer[playerId]; if not p then return end
  Api:Post("/item/unequip", { steamid = p.steamid, itemId = ev.itemId }, function(ok, data)
    if not ok or not data or not data.item then return end
    findAndRemove(p.equipped, ev.itemId)
    table.insert(p.bag, data.item)
    State:Sync(playerId)
  end)
end

function Inventory:OnMove(ev)
  local playerId = ev.PlayerID
  local p = State.byPlayer[playerId]; if not p then return end
  Api:Post("/item/move", { steamid = p.steamid, itemId = ev.itemId, location = ev.location },
    function(ok, data)
      if not ok or not data or not data.item then return end
      local from = (ev.location == "stash") and p.bag or p.stash
      local to = (ev.location == "stash") and p.stash or p.bag
      findAndRemove(from, ev.itemId)
      table.insert(to, data.item)
      State:Sync(playerId)
    end)
end

return Inventory
```

- [ ] **Step 2: Register listeners** in `addon_game_mode.lua` `InitGameMode` (after requires):
```lua
    Inventory:Register()
```

- [ ] **Step 3: Static review.** Event field access uses `ev.PlayerID` (engine-supplied), `ev.itemId/slot/location` (client payload). Backend `equip` already moves the prior slot occupant? It does not — so the local "unequip prior slot occupant" mirrors what the UI shows; the prior item stays `equipped` server-side until explicitly unequipped. Note this as a known Phase 1 simplification (swap = manual unequip first) in PLAYTEST.

- [ ] **Step 4: Commit.**
```
git add addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/inventory.lua \
        addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/addon_game_mode.lua
git commit -m "feat(addon): equip/unequip/move bridge to backend (inventory.lua)"
```

### Task B6: Wave scaling + counter (`wave.lua`)

**Files:**
- Modify: `scripts/vscripts/wave.lua`
- Modify: `scripts/vscripts/addon_game_mode.lua`

- [ ] **Step 1: Rewrite `wave.lua`** to track wave number, scale enemy count/stats, and publish the counter net table:

```lua
-- wave.lua — scaling enemy waves + wave counter net table.
Wave = Wave or {}
Wave.current = 0
Wave.remaining = 0

local function partySize()
  local n = 0
  for pid = 0, DOTA_MAX_TEAM_PLAYERS - 1 do
    if PlayerResource:IsValidPlayerID(pid) and PlayerResource:GetSelectedHeroEntity(pid) then n = n + 1 end
  end
  return math.max(1, n)
end

function Wave:Publish()
  CustomNetTables:SetTableValue("rehab_wave", "state", { wave = self.current, remaining = self.remaining })
end

function SpawnEnemyWave()
  Wave.current = Wave.current + 1
  local count = (4 + Wave.current) * partySize()
  print("SPAWNING WAVE " .. Wave.current .. " (" .. count .. " enemies)")

  local spawn = Entities:FindByName(nil, "spawn_forest")
  if not spawn then
    print("ERROR: spawn entity 'spawn_forest' not found in map")
    return
  end

  Wave.remaining = count
  for i = 1, count do
    local unit = CreateUnitByName("npc_rehab_zombie", spawn:GetAbsOrigin() + RandomVector(200),
      true, nil, nil, DOTA_TEAM_BADGUYS)
    if unit then
      unit:CreatureLevelUp(Wave.current - 1)  -- scale via creature HP/Damage gain
    else
      print("ERROR: CreateUnitByName returned nil for 'npc_rehab_zombie'")
    end
  end
  Wave:Publish()
end

-- Decrement on death; start the next wave when cleared.
function Wave:OnEnemyDied()
  self.remaining = math.max(0, self.remaining - 1)
  self:Publish()
  if self.remaining == 0 then
    Timers:CreateTimer(3, function() SpawnEnemyWave() end)
  end
end
```

- [ ] **Step 2: Call `Wave:OnEnemyDied()`** from `GameMode:OnEntityKilled` (Task B4 handler), after the loot call:
```lua
    Wave:OnEnemyDied()
```

- [ ] **Step 3: Static review.** `Wave.current` referenced by `loot.lua` exists; `CreatureLevelUp` uses the `Creature` gain block already in `npc_rehab_zombie`.

- [ ] **Step 4: Commit.**
```
git add addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/wave.lua \
        addon/game/dota_addons/r3hab_pit_of_champions/scripts/vscripts/addon_game_mode.lua
git commit -m "feat(addon): scaling waves + wave counter net table"
```

---

## Part C — Panorama UI (XML/CSS/JS; static review + your playtest)

> Path prefix: `addon/content/dota_addons/r3hab_pit_of_champions/panorama/` for sources;
> the manifest lives under `addon/game/.../panorama/layout/custom_game/`.

### Task C1: Panorama scaffold + net-table registration

**Files:**
- Create: `addon/game/.../panorama/layout/custom_game/custom_ui_manifest.xml`
- Create: `addon/content/.../panorama/layout/custom_game/hud.xml`
- Create: `addon/content/.../panorama/scripts/custom_game/hud.js`
- Create: `addon/content/.../panorama/styles/custom_game/hud.css`

- [ ] **Step 1: Manifest** `custom_ui_manifest.xml`:
```xml
<root>
  <Panel>
    <CustomUIElement type="Hud" layoutfile="file://{resources}/layout/custom_game/hud.xml" />
  </Panel>
</root>
```

- [ ] **Step 2: `hud.xml`** loads styles/script and declares root panels:
```xml
<root>
  <styles><include src="file://{resources}/styles/custom_game/hud.css" /></styles>
  <scripts><include src="file://{resources}/scripts/custom_game/hud.js" /></scripts>
  <Panel hittest="false" style="width:100%;height:100%;">
    <Label id="WaveCounter" class="WaveCounter" text="Wave 0" />
    <Panel id="CharacterPanel" class="CharacterPanel" visible="false" />
  </Panel>
</root>
```

- [ ] **Step 3: `hud.js`** subscribes to net tables and toggles the panel:
```js
"use strict";
var STATE = { player: null, wave: null };

function MyId() { return Players.GetLocalPlayer(); }

function OnPlayerChanged() {
  var pid = Game.GetLocalPlayerID();
  var data = CustomNetTables.GetTableValue("rehab_player", pid.toString());
  STATE.player = data;
  if (typeof RenderCharacter === "function") RenderCharacter(data); // defined in Task C2
}

function OnWaveChanged() {
  var w = CustomNetTables.GetTableValue("rehab_wave", "state") || { wave: 0, remaining: 0 };
  STATE.wave = w;
  $("#WaveCounter").text = "Wave " + w.wave + "  (" + w.remaining + " left)";
}

function ToggleCharacter() {
  var p = $("#CharacterPanel");
  p.visible = !p.visible;
}

(function () {
  CustomNetTables.SubscribeNetTableListener("rehab_player", OnPlayerChanged);
  CustomNetTables.SubscribeNetTableListener("rehab_wave", OnWaveChanged);
  Game.CreateCustomKeyBind("c", "ToggleCharacter");
  Game.AddCommand("ToggleCharacter", ToggleCharacter, "", 0);
  OnWaveChanged();
})();
```

- [ ] **Step 4: `hud.css`** — minimal positioning:
```css
.WaveCounter { horizontal-align: center; margin-top: 16px; color: #fff; font-size: 28px; }
.CharacterPanel { width: 900px; height: 520px; align: center middle; background-color: #0d0d12ee;
  border: 2px solid #444; border-radius: 6px; }
```

- [ ] **Step 5: Static review.** Manifest `type="Hud"`; net-table names match Lua (`rehab_player`, `rehab_wave`).

- [ ] **Step 6: Commit.**
```
git add addon/game/dota_addons/r3hab_pit_of_champions/panorama addon/content/dota_addons/r3hab_pit_of_champions/panorama
git commit -m "feat(ui): panorama HUD scaffold + net-table subscriptions"
```

### Task C2: Character panel — equipment, stat sheet, bag

**Files:**
- Modify: `addon/content/.../panorama/layout/custom_game/hud.xml` (fill `CharacterPanel`)
- Modify: `addon/content/.../panorama/scripts/custom_game/hud.js` (add `RenderCharacter`)
- Modify: `addon/content/.../panorama/styles/custom_game/hud.css`

- [ ] **Step 1: Replace the empty `CharacterPanel`** in `hud.xml` with three columns and tab buttons:
```xml
<Panel id="CharacterPanel" class="CharacterPanel" visible="false">
  <Panel class="Column">
    <Label class="ColTitle" text="Equipped" />
    <Panel id="EquipSlots" class="EquipGrid" />
  </Panel>
  <Panel class="Column">
    <Label class="ColTitle" text="Stats" />
    <Panel id="StatSheet" class="StatSheet" />
  </Panel>
  <Panel class="Column">
    <Panel class="TabRow">
      <Button class="Tab" onactivate="ShowBag()"><Label text="Inventory"/></Button>
      <Button class="Tab" onactivate="ShowStash()"><Label text="Stash"/></Button>
    </Panel>
    <Panel id="ItemGrid" class="ItemGrid" />
  </Panel>
</Panel>
```

- [ ] **Step 2: Add render logic** to `hud.js`. Defines slot order, rarity colors, and renders equipped/stats/bag. (Drag is added in C3.)
```js
var SLOTS = ["weapon","offhand","helm","chest","gloves","boots","belt","amulet","ring1","ring2"];
var STAT_KEYS = ["strength","agility","intellect","armor","health","mana","attack_damage","attack_speed","crit_chance","lifesteal"];
var RARITY_COLOR = { Common:"#9d9d9d", Uncommon:"#1eff00", Rare:"#0070dd", Epic:"#a335ee", Legendary:"#ff8000", Mythic:"#e6cc80" };
var ACTIVE_TAB = "bag";

function ItemTooltip(item) {
  var lines = item.base_id + " (" + item.rarity + " ilvl " + item.ilvl + ")";
  (item.affixes || []).forEach(function (a) { lines += "\n+" + a.value + " " + a.stat; });
  return lines;
}

function MakeItemButton(item, onActivate) {
  var btn = $.CreatePanel("Button", $("#ItemGrid"), "");
  btn.AddClass("ItemCell");
  btn.style.borderColor = RARITY_COLOR[item.rarity] || "#666";
  btn.SetPanelEvent("onactivate", onActivate);
  btn.SetPanelEvent("onmouseover", function () {
    $.DispatchEvent("DOTAShowTextTooltip", btn, ItemTooltip(item));
  });
  btn.SetPanelEvent("onmouseout", function () { $.DispatchEvent("DOTAHideTextTooltip"); });
  return btn;
}

function RenderCharacter(data) {
  if (!data) return;
  // Equipped slots.
  var eq = $("#EquipSlots"); eq.RemoveAndDeleteChildren();
  var bySlot = {}; (data.equipped || []).forEach(function (it) { bySlot[it.slot] = it; });
  SLOTS.forEach(function (slot) {
    var cell = $.CreatePanel("Button", eq, "");
    cell.AddClass("SlotCell");
    var it = bySlot[slot];
    if (it) {
      cell.style.borderColor = RARITY_COLOR[it.rarity] || "#666";
      cell.SetPanelEvent("onactivate", function () { GameEvents.SendCustomGameEventToServer("rehab_unequip", { itemId: it.id }); });
      cell.SetPanelEvent("onmouseover", function () { $.DispatchEvent("DOTAShowTextTooltip", cell, ItemTooltip(it)); });
      cell.SetPanelEvent("onmouseout", function () { $.DispatchEvent("DOTAHideTextTooltip"); });
    }
  });
  // Stat sheet: sum of equipped affixes.
  var totals = {}; STAT_KEYS.forEach(function (k) { totals[k] = 0; });
  (data.equipped || []).forEach(function (it) { (it.affixes||[]).forEach(function (a) { totals[a.stat]=(totals[a.stat]||0)+a.value; }); });
  var sheet = $("#StatSheet"); sheet.RemoveAndDeleteChildren();
  STAT_KEYS.forEach(function (k) {
    var row = $.CreatePanel("Label", sheet, "");
    row.AddClass("StatRow");
    row.text = k + ": " + (Math.round((totals[k]||0)*100)/100);
  });
  RenderGrid(data);
}

function RenderGrid(data) {
  var grid = $("#ItemGrid"); grid.RemoveAndDeleteChildren();
  var items = (ACTIVE_TAB === "stash") ? (data.stash||[]) : (data.bag||[]);
  items.forEach(function (it) {
    MakeItemButton(it, function () {
      if (ACTIVE_TAB === "stash") {
        GameEvents.SendCustomGameEventToServer("rehab_move", { itemId: it.id, location: "bag" });
      } else {
        GameEvents.SendCustomGameEventToServer("rehab_equip", { itemId: it.id, slot: SlotForBase(it.base_id) });
      }
    });
  });
}

function SlotForBase(baseId) {
  var map = { weapon_axe:"weapon", helm_01:"helm", chest_01:"chest", boots_01:"boots", ring_01:"ring1", amulet_01:"amulet" };
  return map[baseId] || "weapon";
}

function ShowBag() { ACTIVE_TAB = "bag"; if (STATE.player) RenderGrid(STATE.player); }
function ShowStash() { ACTIVE_TAB = "stash"; if (STATE.player) RenderGrid(STATE.player); }
```
Add to the IIFE so the toggle is reachable: `Game.AddCommand("ShowBag", ShowBag, "", 0); Game.AddCommand("ShowStash", ShowStash, "", 0);`

- [ ] **Step 2b: Static review.** `SlotForBase` map matches `Loot.SLOT_OF` (Task B4); `STAT_KEYS` matches `Stats.KEYS` (Task B2) and backend affixes.

- [ ] **Step 3: CSS** — append grid styles:
```css
.Column { flow-children: down; width: 290px; margin: 10px; }
.ColTitle { color: #ccc; font-size: 18px; margin-bottom: 6px; }
.EquipGrid { flow-children: right-wrap; width: 100%; }
.SlotCell, .ItemCell { width: 56px; height: 56px; margin: 4px; border: 2px solid #666; background-color: #1b1b22; }
.StatRow { color: #ddd; font-size: 15px; }
.TabRow { flow-children: right; }
.Tab { padding: 4px 10px; background-color: #23232c; margin-right: 4px; }
.ItemGrid { flow-children: right-wrap; width: 100%; height: 380px; overflow: squish scroll; }
```

- [ ] **Step 4: Commit.**
```
git add addon/content/dota_addons/r3hab_pit_of_champions/panorama
git commit -m "feat(ui): character panel — equipment, stat sheet, bag/stash grids"
```

### Task C3: Drag-to-equip + stash moves

Click-to-equip already works (C2). Add drag-drop as the primary gesture per spec §5.5.

**Files:**
- Modify: `hud.js`

- [ ] **Step 1: Add drag handlers** to `MakeItemButton` cells and drop targets on equip slots. Use Panorama's drag API:
```js
function MakeDraggable(panel, item) {
  panel.SetDraggable(true);
  $.RegisterEventHandler("DragStart", panel, function (id, dragCallbacks) {
    var img = $.CreatePanel("Panel", $.GetContextPanel(), "");
    img.AddClass("ItemCell");
    img.style.borderColor = RARITY_COLOR[item.rarity] || "#666";
    dragCallbacks.displayPanel = img;
    dragCallbacks.offsetX = 0; dragCallbacks.offsetY = 0;
    panel.itemData = item;
    return true;
  });
}
function RegisterSlotDrop(cell, slot) {
  $.RegisterEventHandler("DragDrop", cell, function (id, dragged) {
    if (dragged && dragged.itemData) {
      GameEvents.SendCustomGameEventToServer("rehab_equip", { itemId: dragged.itemData.id, slot: slot });
    }
    return true;
  });
}
```
Call `MakeDraggable(btn, item)` inside `MakeItemButton`, and `RegisterSlotDrop(cell, slot)` for each equip slot in `RenderCharacter`.

- [ ] **Step 2: Stash drag** — register a `DragDrop` on `#ItemGrid` while the Stash tab is active to send `rehab_move` to `stash`; on Inventory tab, dropping an equipped item there sends `rehab_unequip`. Gate by `ACTIVE_TAB`.

- [ ] **Step 3: Static review.** Confirm `GameEvents.SendCustomGameEventToServer` event names match Task B5 listeners exactly (`rehab_equip`, `rehab_unequip`, `rehab_move`).

- [ ] **Step 4: Commit.**
```
git add addon/content/dota_addons/r3hab_pit_of_champions/panorama
git commit -m "feat(ui): drag-to-equip and stash drag moves"
```

---

## Part D — Integration & playtest

### Task D1: Verify wiring in `addon_game_mode.lua`

- [ ] **Step 1: Read** the final `addon_game_mode.lua` and confirm, in order: requires (`wave, timers, stats, state, loot, inventory`), `LinkLuaModifier`, `Inventory:Register()`, and listeners for `game_rules_state_change`, `npc_spawned`, `entity_killed`. Confirm the 5s `SpawnEnemyWave()` still fires in `OnGameStart`.

- [ ] **Step 2: Commit** (if any wiring fixes were needed):
```
git commit -am "fix(addon): finalize game-mode system wiring"
```

### Task D2: Update PLAYTEST doc

**Files:**
- Modify: `addon/PLAYTEST.md`

- [ ] **Step 1: Append a Phase 1 section** with the exact sequence and expected output:
  - Start the backend: from `backend/`, `docker compose up -d`, set `HMAC_SECRET` to match `api.lua`, `npm run migrate`, `npm run dev`.
  - Launch Dota 2 Tools → load `r3hab_pit_of_champions` → Play.
  - Expected console: `R3HAB PIT OF CHAMPIONS LOADED` → `GAME STARTED` → `[State] session/start` success → `SPAWNING WAVE 1`.
  - Kill enemies; expect occasional `[Loot] ... dropped ...` lines and items appearing in the bag (press `c` to open the Character panel).
  - Equip an item; expect the stat sheet totals to change and the hero's attributes (F1 stat panel) to rise.
  - Move an item to Stash; reload the addon; expect it to persist (account-wide).
  - Document the known Phase 1 simplification: equipping into an occupied slot does not auto-swap the old item server-side (unequip first).

- [ ] **Step 2: Commit.**
```
git add addon/PLAYTEST.md
git commit -m "docs(addon): Phase 1 playtest steps + expected output"
```

---

## Running the backend (reference for Task A1 and playtest)

From `backend/` (PowerShell):
```
docker compose up -d
$env:DATABASE_URL="postgres://rehab:rehab@localhost:5433/rehab"
$env:HMAC_SECRET="change-me-to-a-long-random-string"   # MUST match api.lua API_HMAC_SECRET
npm run migrate
npm run dev      # serves on :3000 for playtest
npx vitest run   # for Task A1 verification
```

---

## Self-Review

- **Spec coverage:** decisions table → Shared Contracts + all tasks; stats §4.1 → B1/B2/B3; loot §4.2 → A1/B4; UI §5 → C1/C2/C3 + B6 (HUD); backend §6 → A1; testing §7 → A1 (verified) + D2 (playtest); build sequence §8 → task order A→B→C→D.
- **Placeholder scan:** no TBD/TODO; every code step has complete code. CSS is minimal but complete. The only non-code "documented" steps are D2 playtest prose (inherently manual) and the affix-pool expansion explicitly deferred in the spec.
- **Type/name consistency:** affix `stat` keys identical across backend pool, `Stats.KEYS`, `STAT_KEYS` (JS), and the modifier handlers; slot ids identical across `Loot.SLOT_OF`, `SlotForBase`, and `SLOTS`; net-table names (`rehab_player`, `rehab_wave`) and event names (`rehab_equip/unequip/move`) identical between Lua and JS; backend item fields referenced as snake_case (`base_id`, `ilvl`) in both Lua and JS.

## Execution Handoff

Backend (A1) is fully verifiable here. All addon tasks (B/C/D) are code-complete-and-static-reviewed by me; the in-engine behavior is your playtest (Workshop Tools GUI), per the spec's honesty rule.
