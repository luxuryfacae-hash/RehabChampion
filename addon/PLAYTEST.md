# Playtest — RehabChampion Phase 0

These are the manual steps to launch and verify the addon in-engine. They cannot be
automated (the Workshop Tools require the Steam client GUI).

## 1. Enable Workshop Tools

Steam → Library → Dota 2 → right-click → **Properties** → install the **Dota 2 Workshop
Tools** DLC if not already present. (Launching Dota 2 with the **Tools** option the first
time will offer to install it.)

## 2. Link the repo into the Dota addon folders

From a PowerShell prompt at the repo root:

```powershell
./tools/link-addon.ps1
```

Confirm the prompt. This junctions:
- `<Dota>/game/dota_addons/r3hab_pit_of_champions`    → `addon/game/.../`
- `<Dota>/content/dota_addons/r3hab_pit_of_champions` → `addon/content/.../`

(Pass `-DotaPath "<path>"` if your Dota install is not the default Steam location.)

## 3. Create the arena map (one time)

Follow `addon/MAP_SETUP.md` to produce `maps/arena.vmap` with a point entity named
`spawn_forest`. This is the one manual GUI step.

## 4. Compile assets

```powershell
./tools/compile.ps1                       # compile everything, or
./tools/compile.ps1 -InputPath maps/arena.vmap   # just the map
```

Expect `game/dota_addons/r3hab_pit_of_champions/maps/arena.vmap_c` to be produced.

## 5. Launch via Tools

Option A — Launcher UI: Dota 2 → **Tools** → select addon `r3hab_pit_of_champions` →
choose the **arena** map → **Play**.

Option B — Console (with `-tools`/dev console enabled), run:

```
dota_launch_custom_game r3hab_pit_of_champions arena
```

## 6. Expected console output

Open the in-game console (`` ` ``) and watch for, in order:

1. On load:        `R3HAB PIT OF CHAMPIONS LOADED`
2. When the match enters GAME_IN_PROGRESS: `GAME STARTED`
3. ~5 seconds later: `SPAWNING WAVE`
4. **5 `npc_rehab_zombie` units spawn** within ~200 units of the `spawn_forest` entity
   (Undying-minion zombie model, ~200 HP each, on team BADGUYS).

## 7. Failure signatures (and what they mean)

- `ERROR: spawn entity 'spawn_forest' not found in map` — the map has no `spawn_forest`
  entity, or you launched the uncompiled/wrong map. Redo step 3/4.
- `ERROR: CreateUnitByName returned nil for 'npc_rehab_zombie' ...` — the unit KV failed
  to load; check `scripts/npc/npc_units_custom.txt` parsed (no syntax error) and the addon
  is linked correctly.
- No `R3HAB PIT OF CHAMPIONS LOADED` — vscripts not found; verify the junction and that
  you launched the `r3hab_pit_of_champions` addon.

> Not verified by the build agent: in-engine launch, the Undying minion model path
> resolving at runtime, and the map compile all require your Steam client + Workshop Tools.

---

# Playtest — RehabChampion Phase 1 (Stats + Loot + UI)

Phase 1 adds the persisted ARPG loop: Juggernaut rescale, server-rolled loot, a Panorama
character UI, and scaling waves wired to the backend. The Phase 0 steps 1–5 above still
apply (link, compile, launch). Phase 1 **also requires the backend running locally**, and
changes the wave behavior described in Phase 0 §6.

## 1. Start the backend (separate terminal, before launching Dota)

From `backend/` in PowerShell:

```powershell
docker compose up -d
$env:DATABASE_URL = "postgres://rehab:rehab@localhost:5433/rehab"
$env:HMAC_SECRET  = "change-me-to-a-long-random-string"   # MUST match API_HMAC_SECRET in scripts/vscripts/api.lua
npm run migrate
npm run dev    # serves on http://127.0.0.1:3000
```

The addon's `api.lua` posts to `http://127.0.0.1:3000` with the shared HMAC secret. If the
secret or URL differ, every `/session/*` and `/item/*` call fails (see failure signatures).

## 2. Pick Juggernaut

When prompted, select **Juggernaut** (`npc_dota_hero_juggernaut`). Phase 1 only rescales
this hero; others will load but are untuned.

## 3. Expected console output (`` ` `` to open console)

In order:

1. `R3HAB PIT OF CHAMPIONS LOADED`
2. `GAME STARTED`
3. `[State] session/start failed ...` should **NOT** appear — its absence means the backend
   call succeeded. (A new account silently creates a Juggernaut character.)
4. `SPAWNING WAVE 1 (N enemies)` where `N = (4 + wave) * partySize`.
5. As you kill enemies: occasional `[Loot] <base_id> dropped (<Rarity> ilvl <n>)` lines.
6. When a wave is cleared, the next spawns ~3s later: `SPAWNING WAVE 2 (...)`, etc.

## 4. Expected in-game behavior

- **HUD:** top-center `Wave N  (M left)` counter, updating as enemies die.
- **Character panel:** press **`c`** to toggle. Three columns — Equipped (10 slots), Stats
  (the 10 affix totals), and a Bag/Stash tabbed grid. Items are rarity-colored; hover shows
  a tooltip with affixes.
- **Loot:** kills drop items into the Bag (they are already persisted server-side).
- **Equip:** drag a bag item onto a slot (or click it) → the Stats column totals change and
  your hero's attributes (default `F1`/attributes panel) rise accordingly.
- **Stash:** switch to the Stash tab; click a stash item to move it to the bag. (Account-wide.)
- **Persistence check:** equip/stash some items, then reload the addon (`restart` in console
  or relaunch). On `session/start` your equipped/bag/stash should reappear.

## 5. Known Phase 1 simplifications (by design)

- **No auto-swap:** equipping into an already-occupied slot does not automatically return the
  previous item server-side — unequip the old item first. (The UI reflects the swap locally,
  but the backend keeps the prior item `equipped` until you unequip it.)
- **Drop prop is cosmetic:** the dropped item is added to your bag immediately on the
  backend roll; the world prop is just visual feedback and despawns after 5s.
- **Rarity/ilvl are host-rolled** from wave context; only affix magnitudes are
  server-authoritative. Accepted listen-server trust (design spec §6.4).
- **Affix pool is the 10 base stats**; move speed / spell amp / resists / crit damage are a
  later backend tuning pass.

## 6. Phase 1 failure signatures

- `[State] session/start failed for <steamid>` — backend unreachable or HMAC mismatch.
  Verify `npm run dev` is up on :3000 and `HMAC_SECRET` == `api.lua`'s `API_HMAC_SECRET`.
- Items roll but never appear in the bag — net table not reaching the client; confirm the
  Panorama manifest compiled (`custom_ui_manifest.xml` present under the compiled
  `game/.../panorama/layout/custom_game/`).
- Equipping does nothing — check the console for an HTTP error from `/item/equip`; confirm
  the item's `slot` is one of: weapon, offhand, helm, chest, gloves, boots, belt, amulet,
  ring1, ring2.

> Not verified by the build agent: all of the above — every Phase 1 behavior runs only in
> the Dota VM with the Workshop Tools GUI + your Steam client and a running backend.
