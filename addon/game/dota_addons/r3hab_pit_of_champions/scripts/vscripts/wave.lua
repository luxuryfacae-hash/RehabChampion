function SpawnEnemyWave()
    print("SPAWNING WAVE")

    local spawn = Entities:FindByName(nil, "spawn_forest")

    if spawn then
        for i = 1, 5 do
            local unit = CreateUnitByName(
                "npc_dota_creature_basic_zombie",
                spawn:GetAbsOrigin() + RandomVector(200),
                true,
                nil,
                nil,
                DOTA_TEAM_BADGUYS
            )
        end
    end
end