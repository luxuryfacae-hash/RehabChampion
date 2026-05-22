-- loot.lua — host-side drop rolling; backend rolls affix magnitudes.
require("api")

Loot = Loot or {}

Loot.BASES = { "weapon_axe", "helm_01", "chest_01", "boots_01", "ring_01", "amulet_01" }
Loot.SLOT_OF = {
  weapon_axe = "weapon", helm_01 = "helm", chest_01 = "chest",
  boots_01 = "boots", ring_01 = "ring1", amulet_01 = "amulet",
}

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

Loot.DROP_CHANCE = 0.35

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

function Loot:SpawnDrop(playerId, item, position)
  local p = State.byPlayer[playerId]
  if p then
    table.insert(p.bag, item)
    State:Sync(playerId)
  end
  local drop = CreateUnitByName("npc_dota_creature", position, false, nil, nil, DOTA_TEAM_NEUTRALS)
  if drop then
    drop:AddNewModifier(drop, nil, "modifier_phased", { duration = 5 })
    Timers:CreateTimer(5, function() if not drop:IsNull() then drop:RemoveSelf() end end)
  end
  print(string.format("[Loot] %s dropped (%s ilvl %d)", item.base_id or "?", item.rarity or "?", item.ilvl or 0))
end

return Loot
