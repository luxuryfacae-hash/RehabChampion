function SpawnEnemyWave()
    print("SPAWNING WAVE")

    local spawn = Entities:FindByName(nil, "spawn_forest")

    if not spawn then
        print("ERROR: spawn entity 'spawn_forest' not found in map")
        return
    end

    for i = 1, 5 do
        local unit = CreateUnitByName(
            "npc_rehab_zombie",
            spawn:GetAbsOrigin() + RandomVector(200),
            true,
            nil,
            nil,
            DOTA_TEAM_BADGUYS
        )

        if not unit then
            print("ERROR: CreateUnitByName returned nil for 'npc_rehab_zombie' (is it defined in npc_units_custom.txt?)")
        end
    end
end
