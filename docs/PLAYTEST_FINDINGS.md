# Playtest Findings — 2026-05-22 (Phase 1, first in-engine launch)

First launch of the linked Phase 1 build via `dota_launch_custom_game r3hab_pit_of_champions
template_map`. Stopped during pre-game (before waves). This logs what worked and the two
bugs to fix next session.

## Environment (confirmed working)

- Dota install: `D:\Program Files (x86)\Steam\steamapps\common\dota 2 beta` (NOT the C: default
  the tool scripts assume — always pass `-DotaPath "D:\...\dota 2 beta"`).
- Repo linked into Dota via directory junctions (game + content). The pre-repo originals were
  renamed to `r3hab_pit_of_champions.prerepo.bak` under both `game/dota_addons` and
  `content/dota_addons` (safe to delete once we're confident).
- `template_map.vmap` compiled (`tools/compile.ps1 -DotaPath "D:\..." -InputPath maps/template_map.vmap`).
- Backend run locally: `cd backend; docker compose up -d; $env:DATABASE_URL=...; $env:HMAC_SECRET="change-me-to-a-long-random-string"; npm run dev` → listens on :3000.

## Worked (from console log)

- `[VScript] R3HAB PIT OF CHAMPIONS LOADED` — our Phase 1 code runs (not the stale copy).
- `Registered rehab_equip / rehab_unequip / rehab_move` — inventory custom-event listeners OK.
- Juggernaut override loaded and was selectable/selected.

## BUG 1 (high) — master stat modifier not registered

```
Attempted to create unknown modifier type modifier_rehab_stats!
```
`State:Start` calls `hero:AddNewModifier(hero, nil, "modifier_rehab_stats", {})` but the engine
doesn't know the modifier, so stats never apply.

- `LinkLuaModifier("modifier_rehab_stats", "modifiers/modifier_rehab_stats", LUA_MODIFIER_MOTION_NONE)`
  is at the top of `addon_game_mode.lua`, and `R3HAB ... LOADED` (later in the file) prints — so
  the file loads, but the link apparently didn't take.
- **Next-session checks:** open vconsole and look for a Lua error when the modifier file loads
  (a parse/runtime error in `modifiers/modifier_rehab_stats.lua` would silently prevent
  registration); confirm the link path resolves (`scripts/vscripts/modifiers/modifier_rehab_stats.lua`);
  try moving `LinkLuaModifier` into `Activate()`/`Precache` or adding a temporary
  `print` at the top of the modifier file to confirm it's required; verify `class({})` is defined
  (it is engine-global) at link time.

## BUG 2 (high, blocks persistence) — HMAC signature mismatch

```
[Api] POST /session/start failed (status 401): {"error":"bad_signature"}
[State] session/start failed for 76561198058977173
```
The shared secret matches on both sides (`change-me-to-a-long-random-string`), and the backend
verifies HMAC over the exact raw body the client sends, so the only explanation is the
**pure-Lua HMAC-SHA256 in `api.lua` computes a different digest than Node's
`crypto.createHmac("sha256", secret).update(body).digest("hex")`.**

- **Next-session checks:** add a one-shot debug in `api.lua` to print `hmac_sha256_hex(secret, body)`
  for a FIXED `secret`/`body`, and compare against Node:
  `node -e 'console.log(require("crypto").createHmac("sha256","k").update("m").digest("hex"))'`
  (k="k", m="m" → `... ` known vector). If they differ, the bug is in the Lua SHA-256/HMAC
  (suspect the `bit`-library path used under LuaJIT vs the software fallback — Dota's LuaJIT has
  `bit`, so the `bit.*` branch is exercised; check 32-bit overflow handling in `rrotate`/`lshift`).
- Until fixed, no session/loot/equip persists.

## Not bugs (expected)

- "no waves yet" — stopped during `DOTA_GAMERULES_STATE_PRE_GAME`; `SpawnEnemyWave()` fires 5s
  after `GAME_IN_PROGRESS`.
- Various `Failed loading resource ... .vtex_c/.vmat_c` and `fill-parent-flow` panel warnings —
  stock-template/cosmetic noise, not ours.
- `Cannot open ... to calculate addon CRC!` — junction CRC quirk, harmless in tools mode.

## Suggested next-session order

1. Fix BUG 2 (HMAC) — verify Lua vs Node digest on a fixed vector; persistence is the spine.
2. Fix BUG 1 (modifier registration) — get stats applying.
3. Re-launch, let it reach GAME_IN_PROGRESS, confirm waves + drops + equip + stat changes.
4. Then tune drop rates / affix ranges with real feedback.
