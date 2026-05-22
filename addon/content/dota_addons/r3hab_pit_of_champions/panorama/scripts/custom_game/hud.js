"use strict";

var STATE = { player: null, wave: null };
var SLOTS = ["weapon", "offhand", "helm", "chest", "gloves", "boots", "belt", "amulet", "ring1", "ring2"];
var STAT_KEYS = ["strength", "agility", "intellect", "armor", "health", "mana", "attack_damage", "attack_speed", "crit_chance", "lifesteal"];
var RARITY_COLOR = { Common: "#9d9d9d", Uncommon: "#1eff00", Rare: "#0070dd", Epic: "#a335ee", Legendary: "#ff8000", Mythic: "#e6cc80" };
var ACTIVE_TAB = "bag";

var BASE_TO_SLOT = { weapon_axe: "weapon", helm_01: "helm", chest_01: "chest", boots_01: "boots", ring_01: "ring1", amulet_01: "amulet" };
function SlotForBase(baseId) { return BASE_TO_SLOT[baseId] || "weapon"; }

function ItemTooltip(item) {
  var lines = item.base_id + " (" + item.rarity + " ilvl " + item.ilvl + ")";
  var affixes = item.affixes || [];
  for (var i = 0; i < affixes.length; i++) { lines += "\n+" + affixes[i].value + " " + affixes[i].stat; }
  return lines;
}

function MakeDraggable(panel, item) {
  panel.SetDraggable(true);
  $.RegisterEventHandler("DragStart", panel, function (id, dragCallbacks) {
    var img = $.CreatePanel("Panel", $.GetContextPanel(), "");
    img.AddClass("ItemCell");
    img.style.borderColor = RARITY_COLOR[item.rarity] || "#666";
    dragCallbacks.displayPanel = img;
    dragCallbacks.offsetX = 0;
    dragCallbacks.offsetY = 0;
    panel.itemData = item;
    return true;
  });
}

function MakeItemButton(item, onActivate) {
  var btn = $.CreatePanel("Button", $("#ItemGrid"), "");
  btn.AddClass("ItemCell");
  btn.style.borderColor = RARITY_COLOR[item.rarity] || "#666";
  btn.SetPanelEvent("onactivate", onActivate);
  btn.SetPanelEvent("onmouseover", function () { $.DispatchEvent("DOTAShowTextTooltip", btn, ItemTooltip(item)); });
  btn.SetPanelEvent("onmouseout", function () { $.DispatchEvent("DOTAHideTextTooltip"); });
  MakeDraggable(btn, item);
  return btn;
}

function RegisterSlotDrop(cell, slot) {
  $.RegisterEventHandler("DragDrop", cell, function (id, dragged) {
    if (dragged && dragged.itemData) {
      GameEvents.SendCustomGameEventToServer("rehab_equip", { itemId: dragged.itemData.id, slot: slot });
    }
    return true;
  });
}

function RenderCharacter(data) {
  if (!data) { return; }
  var eq = $("#EquipSlots");
  eq.RemoveAndDeleteChildren();
  var bySlot = {};
  var equipped = data.equipped || [];
  for (var i = 0; i < equipped.length; i++) { bySlot[equipped[i].slot] = equipped[i]; }
  for (var j = 0; j < SLOTS.length; j++) {
    var slot = SLOTS[j];
    var cell = $.CreatePanel("Button", eq, "");
    cell.AddClass("SlotCell");
    RegisterSlotDrop(cell, slot);
    var it = bySlot[slot];
    if (it) {
      cell.style.borderColor = RARITY_COLOR[it.rarity] || "#666";
      (function (item) {
        cell.SetPanelEvent("onactivate", function () { GameEvents.SendCustomGameEventToServer("rehab_unequip", { itemId: item.id }); });
        cell.SetPanelEvent("onmouseover", function () { $.DispatchEvent("DOTAShowTextTooltip", cell, ItemTooltip(item)); });
        cell.SetPanelEvent("onmouseout", function () { $.DispatchEvent("DOTAHideTextTooltip"); });
      })(it);
    }
  }
  var totals = {};
  for (var k = 0; k < STAT_KEYS.length; k++) { totals[STAT_KEYS[k]] = 0; }
  for (var e = 0; e < equipped.length; e++) {
    var affs = equipped[e].affixes || [];
    for (var a = 0; a < affs.length; a++) { totals[affs[a].stat] = (totals[affs[a].stat] || 0) + affs[a].value; }
  }
  var sheet = $("#StatSheet");
  sheet.RemoveAndDeleteChildren();
  for (var s = 0; s < STAT_KEYS.length; s++) {
    var row = $.CreatePanel("Label", sheet, "");
    row.AddClass("StatRow");
    row.text = STAT_KEYS[s] + ": " + (Math.round((totals[STAT_KEYS[s]] || 0) * 100) / 100);
  }
  RenderGrid(data);
}

function RenderGrid(data) {
  var grid = $("#ItemGrid");
  grid.RemoveAndDeleteChildren();
  var items = (ACTIVE_TAB === "stash") ? (data.stash || []) : (data.bag || []);
  for (var i = 0; i < items.length; i++) {
    (function (it) {
      MakeItemButton(it, function () {
        if (ACTIVE_TAB === "stash") {
          GameEvents.SendCustomGameEventToServer("rehab_move", { itemId: it.id, location: "bag" });
        } else {
          GameEvents.SendCustomGameEventToServer("rehab_equip", { itemId: it.id, slot: SlotForBase(it.base_id) });
        }
      });
    })(items[i]);
  }
}

function ShowBag() { ACTIVE_TAB = "bag"; if (STATE.player) { RenderGrid(STATE.player); } }
function ShowStash() { ACTIVE_TAB = "stash"; if (STATE.player) { RenderGrid(STATE.player); } }

function OnPlayerChanged() {
  var pid = Game.GetLocalPlayerID();
  STATE.player = CustomNetTables.GetTableValue("rehab_player", pid.toString());
  RenderCharacter(STATE.player);
}

function OnWaveChanged() {
  var w = CustomNetTables.GetTableValue("rehab_wave", "state") || { wave: 0, remaining: 0 };
  STATE.wave = w;
  $("#WaveCounter").text = "Wave " + w.wave + "  (" + w.remaining + " left)";
}

function ToggleCharacter() {
  var p = $("#CharacterPanel");
  p.visible = !p.visible;
}

(function () {
  CustomNetTables.SubscribeNetTableListener("rehab_player", OnPlayerChanged);
  CustomNetTables.SubscribeNetTableListener("rehab_wave", OnWaveChanged);
  Game.AddCommand("ToggleCharacter", ToggleCharacter, "", 0);
  Game.AddCommand("ShowBag", ShowBag, "", 0);
  Game.AddCommand("ShowStash", ShowStash, "", 0);
  Game.CreateCustomKeyBind("c", "ToggleCharacter");
  OnWaveChanged();
})();
