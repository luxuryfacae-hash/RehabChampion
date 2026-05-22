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
