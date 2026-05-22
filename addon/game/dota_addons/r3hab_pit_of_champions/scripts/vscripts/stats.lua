-- stats.lua — pure aggregation of equipped item affixes into a flat stat map.
Stats = Stats or {}

-- The 10 affix keys the backend rolls. Keep in sync with backend/src/loot.ts AFFIX_POOL.
Stats.KEYS = {
  "strength", "agility", "intellect", "armor", "health", "mana",
  "attack_damage", "attack_speed", "crit_chance", "lifesteal",
}

--- Sum affixes across a list of equipped item tables → { stat = total }.
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
