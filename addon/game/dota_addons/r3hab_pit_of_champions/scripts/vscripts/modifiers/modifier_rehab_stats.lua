-- modifier_rehab_stats — master ARPG stat modifier. One per hero.
modifier_rehab_stats = class({})

function modifier_rehab_stats:IsHidden() return true end
function modifier_rehab_stats:IsPurgable() return false end
function modifier_rehab_stats:RemoveOnDeath() return false end

function modifier_rehab_stats:OnCreated()
  self.stats = {}
end

function modifier_rehab_stats:SetStatMap(map)
  self.stats = map or {}
  if IsServer() then self:ForceRefresh() end
end

local function s(self, key) return self.stats and self.stats[key] or 0 end

function modifier_rehab_stats:DeclareFunctions()
  return {
    MODIFIER_PROPERTY_STATS_STRENGTH_BONUS,
    MODIFIER_PROPERTY_STATS_AGILITY_BONUS,
    MODIFIER_PROPERTY_STATS_INTELLECT_BONUS,
    MODIFIER_PROPERTY_PHYSICAL_ARMOR_BONUS,
    MODIFIER_PROPERTY_HEALTH_BONUS,
    MODIFIER_PROPERTY_MANA_BONUS,
    MODIFIER_PROPERTY_PREATTACK_BONUS_DAMAGE,
    MODIFIER_PROPERTY_ATTACKSPEED_BONUS_CONSTANT,
    MODIFIER_PROPERTY_PREATTACK_CRITICALSTRIKE,
    MODIFIER_EVENT_ON_ATTACK_LANDED,
  }
end

function modifier_rehab_stats:GetModifierBonusStats_Strength() return s(self, "strength") end
function modifier_rehab_stats:GetModifierBonusStats_Agility() return s(self, "agility") end
function modifier_rehab_stats:GetModifierBonusStats_Intellect() return s(self, "intellect") end
function modifier_rehab_stats:GetModifierPhysicalArmorBonus() return s(self, "armor") end
function modifier_rehab_stats:GetModifierHealthBonus() return s(self, "health") end
function modifier_rehab_stats:GetModifierManaBonus() return s(self, "mana") end
function modifier_rehab_stats:GetModifierPreAttack_BonusDamage() return s(self, "attack_damage") end
function modifier_rehab_stats:GetModifierAttackSpeedBonus_Constant() return s(self, "attack_speed") end

function modifier_rehab_stats:GetModifierPreAttack_CriticalStrike()
  local chance = s(self, "crit_chance")
  if chance > 0 and RandomFloat(0, 100) <= chance then
    return 150
  end
  return nil
end

function modifier_rehab_stats:OnAttackLanded(params)
  if not IsServer() then return end
  if params.attacker ~= self:GetParent() then return end
  local pct = s(self, "lifesteal")
  if pct > 0 and params.damage and params.damage > 0 then
    self:GetParent():Heal(params.damage * pct / 100, self:GetParent())
  end
end

return modifier_rehab_stats
