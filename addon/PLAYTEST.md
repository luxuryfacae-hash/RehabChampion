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
