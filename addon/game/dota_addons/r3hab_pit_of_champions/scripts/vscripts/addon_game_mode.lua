require("wave")
require("timers")
require("stats")

LinkLuaModifier("modifier_rehab_stats", "modifiers/modifier_rehab_stats", LUA_MODIFIER_MOTION_NONE)

if GameMode == nil then
    GameMode = class({})
end

function Precache(context)
end

function Activate()
    GameRules.GameMode = GameMode()
    GameRules.GameMode:InitGameMode()
end

function GameMode:InitGameMode()
    print("R3HAB PIT OF CHAMPIONS LOADED")
    require("state")
    require("loot")
    require("inventory")
    Inventory:Register()
    ListenToGameEvent("game_rules_state_change", Dynamic_Wrap(GameMode, "OnGameStart"), self)
    ListenToGameEvent("npc_spawned", Dynamic_Wrap(GameMode, "OnNpcSpawned"), self)
    ListenToGameEvent("entity_killed", Dynamic_Wrap(GameMode, "OnEntityKilled"), self)
end

function GameMode:OnGameStart()
    if GameRules:State_Get() == DOTA_GAMERULES_STATE_GAME_IN_PROGRESS then
        print("GAME STARTED")
        Timers:CreateTimer(5, function()
            SpawnEnemyWave()
        end)
    end
end

function GameMode:OnNpcSpawned(event)
    local unit = EntIndexToHScript(event.entindex)
    if unit and unit:IsRealHero() and not unit.rehab_started then
        unit.rehab_started = true
        State:Start(unit:GetPlayerOwnerID(), unit)
    end
end

function GameMode:OnEntityKilled(event)
    local killed = EntIndexToHScript(event.entindex_killed)
    local attacker = event.entindex_attacker and EntIndexToHScript(event.entindex_attacker)
    if not killed or killed:GetTeamNumber() ~= DOTA_TEAM_BADGUYS then return end
    local playerId = (attacker and attacker.GetPlayerOwnerID and attacker:GetPlayerOwnerID()) or 0
    if playerId < 0 then playerId = 0 end
    Loot:OnEnemyKilled(playerId, Wave.current or 1, killed:GetAbsOrigin())
    Wave:OnEnemyDied()
end
