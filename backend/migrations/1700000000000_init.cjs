/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("accounts", {
    steamid64: { type: "text", primaryKey: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    last_seen: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("characters", {
    id: "id",
    steamid64: { type: "text", notNull: true, references: "accounts", onDelete: "CASCADE" },
    hero_name: { type: "text" },
    level: { type: "integer", notNull: true, default: 1 },
    xp: { type: "bigint", notNull: true, default: 0 },
    paragon_points: { type: "integer", notNull: true, default: 0 },
    gold: { type: "bigint", notNull: true, default: 0 },
    essence: { type: "bigint", notNull: true, default: 0 },
    ascension_unlocked: { type: "integer", notNull: true, default: 1 },
    allocated_stats: { type: "jsonb", notNull: true, default: "{}" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("items", {
    id: "id",
    owner_steamid64: { type: "text", notNull: true, references: "accounts", onDelete: "CASCADE" },
    character_id: { type: "integer", references: "characters", onDelete: "SET NULL" },
    base_id: { type: "text" },
    rarity: { type: "text" },
    ilvl: { type: "integer" },
    affixes: { type: "jsonb" },
    sockets: { type: "jsonb", notNull: true, default: "[]" },
    location: {
      type: "text",
      notNull: true,
      default: "bag",
      check: "location IN ('equipped','bag','stash')",
    },
    slot: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("items", "owner_steamid64");
  pgm.createIndex("items", "character_id");
  pgm.createIndex("items", "location");
};

exports.down = (pgm) => {
  pgm.dropTable("items");
  pgm.dropTable("characters");
  pgm.dropTable("accounts");
};
