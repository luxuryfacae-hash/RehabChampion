-- state.lua — per-player authoritative session snapshot + net-table sync.
require("api")
require("stats")

State = State or {}
State.byPlayer = State.byPlayer or {}

function RehabSteamId(playerId)
  local sid = PlayerResource:GetSteamID(playerId)
  if sid and sid ~= 0 then return tostring(sid) end
  return "test_" .. tostring(playerId)
end

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

function State:RefreshModifier(playerId)
  local p = self.byPlayer[playerId]
  if not p or not p.hero then return end
  local mod = p.hero:FindModifierByName("modifier_rehab_stats")
  if mod then mod:SetStatMap(Stats.Aggregate(p.equipped)) end
end

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
      Api:Post("/character/save", { steamid = steamid, heroName = "npc_dota_hero_juggernaut" },
        function(ok2, data2)
          if ok2 and data2 then p.character = data2.character end
          self:Sync(playerId)
        end)
    end
  end)
end

return State
