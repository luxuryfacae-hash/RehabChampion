if Timers == nil then
    Timers = class({})
end

function Timers:CreateTimer(delay, callback)
    return GameRules:GetGameModeEntity():SetContextThink(DoUniqueString("timer"), callback, delay)
end