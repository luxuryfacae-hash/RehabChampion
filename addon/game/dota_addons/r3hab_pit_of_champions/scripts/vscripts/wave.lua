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

-- Resolve a spawn origin: prefer the named map entity, else anchor near any hero so the
-- addon is playable on any map (including the stock template) without authoring a map.
local function resolveSpawnOrigin()
  local spawn = Entities:FindByName(nil, "spawn_forest")
  if spawn then return spawn:GetAbsOrigin() end
  for pid = 0, DOTA_MAX_TEAM_PLAYERS - 1 do
    local hero = PlayerResource:IsValidPlayerID(pid) and PlayerResource:GetSelectedHeroEntity(pid)
    if hero then
      print("WARN: 'spawn_forest' not found; anchoring wave near a hero")
      return GetGroundPosition(hero:GetAbsOrigin() + RandomVector(600), nil)
    end
  end
  return nil
end

function Wave:Publish()
  CustomNetTables:SetTableValue("rehab_wave", "state", { wave = self.current, remaining = self.remaining })
end

function SpawnEnemyWave()
  Wave.current = Wave.current + 1
  local count = (4 + Wave.current) * partySize()
  print("SPAWNING WAVE " .. Wave.current .. " (" .. count .. " enemies)")

  local origin = resolveSpawnOrigin()
  if not origin then
    print("ERROR: no 'spawn_forest' entity and no hero to anchor the wave")
    return
  end

  Wave.remaining = count
  for i = 1, count do
    local unit = CreateUnitByName("npc_rehab_zombie", origin + RandomVector(200),
      true, nil, nil, DOTA_TEAM_BADGUYS)
    if unit then
      unit:CreatureLevelUp(Wave.current - 1)
    else
      print("ERROR: CreateUnitByName returned nil for 'npc_rehab_zombie'")
    end
  end
  Wave:Publish()
end

function Wave:OnEnemyDied()
  self.remaining = math.max(0, self.remaining - 1)
  self:Publish()
  if self.remaining == 0 then
    Timers:CreateTimer(3, function() SpawnEnemyWave() end)
  end
end
