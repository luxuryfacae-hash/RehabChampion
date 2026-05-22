require("wave")
require("timers")

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

    ListenToGameEvent("game_rules_state_change", Dynamic_Wrap(GameMode, "OnGameStart"), self)
end

function GameMode:OnGameStart()
    if GameRules:State_Get() == DOTA_GAMERULES_STATE_GAME_IN_PROGRESS then
        print("GAME STARTED")

        Timers:CreateTimer(5, function()
            SpawnEnemyWave()
        end)
    end
end