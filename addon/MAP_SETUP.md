# Map setup — create `arena.vmap` with a `spawn_forest` spawn point

## Why this is a manual step

The stock `content/dota_addons/r3hab_pit_of_champions/maps/template_map.vmap` is a
**binary DMX** file (its header reads `<!-- dmx encoding binary 9 format vmap 20 -->`),
not KV3 text. Injecting a new entity into a binary DMX blob by hand is not reliable and
would risk corrupting the map, so this one step is done once in Hammer (the Source 2 map
editor). After this, everything else (compile, launch) is scripted.

Blockers this fixes:
- **#2** — the map has no `spawn_forest` entity, so `Entities:FindByName(nil, "spawn_forest")`
  in `wave.lua` returns nil and no zombies spawn.
- **#3** — the `.vmap` is not compiled, so there is no playable level.

## Prerequisites

1. Dota 2 **Workshop Tools** DLC installed (Steam → Library → Dota 2 → right-click →
   Properties → DLC, or launch Dota 2 with the **Tools** option once to install it).
2. Run `tools/link-addon.ps1` so the Dota addon folders point at this repo.

## Steps (one time, in Hammer)

1. Launch **Dota 2 → Tools**. In the asset browser / launcher, open **Hammer**
   (the world editor) for addon `r3hab_pit_of_champions`.
2. **File → Open** → `maps/template_map.vmap`.
3. **File → Save As** → `maps/arena.vmap` (same `maps/` folder). You are now editing the
   arena map; the template stays untouched.
4. Make sure there is a flat playable surface. The template already ships with a ground
   surface; if not, draw a large flat block with a dev/measure material and assign it the
   tool floor. (A simple flat block is enough for Phase 0.)
5. Add the spawn point entity:
   - Select the **Entity Tool**.
   - Click somewhere near the middle of the playable area, on the ground, to place a
     point entity.
   - In the entity's **Object Properties**, set its **Class** to `info_target`
     (a lightweight point entity that is perfect as a named marker; `path_corner` also
     works). 
   - Set its **Name** (the `targetname` keyvalue) to exactly: `spawn_forest`
     (lowercase, underscore — must match `wave.lua`).
   - Note its world origin; the zombies spawn within a 200-unit radius of it, so keep it
     clear of walls.
6. **File → Save** (`Ctrl+S`).
7. Build the map: either **File → Build** (Fast) inside Hammer, **or** from a terminal run:
   ```powershell
   ./tools/compile.ps1 -InputPath maps/arena.vmap
   ```
   This produces `game/dota_addons/r3hab_pit_of_champions/maps/arena.vmap_c`.

## Verify

- `game/.../maps/arena.vmap_c` exists.
- The entity is named `spawn_forest` (re-open in Hammer and check the Name field, or
  search the entity list).

Once done, follow `addon/PLAYTEST.md`.
