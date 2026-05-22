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
