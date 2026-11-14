-- До PR #34 тройка в виджете «Кубик удачи» выдавала предмет каталога магазина (player_items,
-- source = 'reward'), а не сгенерированный скин. Такие предметы нигде в Mini App не видны,
-- поэтому игроки не находили выпавший скин в «Моих скинах». Каждый такой выигрыш становится
-- сгенерированным скином того же вида и редкости, с датой выигрыша и записью о выпуске в журнале.
-- Строки player_items остаются как были: на что-то надетое они могут влиять, а в интерфейсе их нет.
-- 2147483647 — верхняя граница randomSkinSeed; 1 — SKIN_GENERATOR_VERSION на момент миграции.
WITH legacy AS (
  SELECT pi.player_id, i.kind, i.rarity, pi.acquired_at
  FROM player_items pi
  JOIN items i ON i.id = pi.item_id
  WHERE pi.source = 'reward'
    AND i.kind IN ('mat', 'dice')
    AND i.rarity IN ('common', 'rare', 'epic')
),
minted AS (
  INSERT INTO skins (kind, seed, rarity, version, owner_id, source, tradable, created_at)
  SELECT kind, floor(random() * 2147483647)::integer, rarity, 1, player_id, 'reward', true, acquired_at
  FROM legacy
  ORDER BY acquired_at
  ON CONFLICT DO NOTHING
  RETURNING id, owner_id, created_at
)
INSERT INTO skin_transfers (skin_id, to_player_id, reason, created_at)
SELECT id, owner_id, 'mint', created_at FROM minted;
