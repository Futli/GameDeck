ALTER TABLE "widget_players" ADD COLUMN "last_roll_modified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_players" ADD COLUMN "bonus_rolls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "widget_players" ADD COLUMN "referred_by" uuid;--> statement-breakpoint
ALTER TABLE "widget_players" ADD COLUMN "referral_rewarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "widget_players" ADD CONSTRAINT "widget_players_referred_by_players_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;