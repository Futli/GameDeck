-- Короткий реферальный код. Уже зарегистрированным игрокам выдаём случайный; ссылка на внешнюю
-- строку (players.id) внутри подзапроса заставляет Postgres считать его заново для каждого игрока.
ALTER TABLE "players" ADD COLUMN "referral_code" text;--> statement-breakpoint
UPDATE "players" SET "referral_code" = (
  SELECT string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', 1 + floor(random() * 36)::int, 1), '')
  FROM generate_series(1, 8)
  WHERE "players"."id" IS NOT NULL
);--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "referral_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_referral_code_unique" UNIQUE("referral_code");
