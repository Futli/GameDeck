CREATE TABLE "skin_equipment" (
	"player_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"skin_id" uuid NOT NULL,
	CONSTRAINT "skin_equipment_player_id_kind_pk" PRIMARY KEY("player_id","kind"),
	CONSTRAINT "skin_equipment_skin_id_unique" UNIQUE("skin_id")
);
--> statement-breakpoint
CREATE TABLE "skin_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skin_id" uuid NOT NULL,
	"from_player_id" uuid,
	"to_player_id" uuid,
	"reason" text NOT NULL,
	"price_coins" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"serial" integer GENERATED ALWAYS AS IDENTITY (sequence name "skins_serial_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"seed" integer NOT NULL,
	"rarity" text NOT NULL,
	"version" smallint NOT NULL,
	"owner_id" uuid NOT NULL,
	"source" text NOT NULL,
	"tradable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skins_kind_seed_version_unique" UNIQUE("kind","seed","version")
);
--> statement-breakpoint
ALTER TABLE "skin_equipment" ADD CONSTRAINT "skin_equipment_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_equipment" ADD CONSTRAINT "skin_equipment_skin_id_skins_id_fk" FOREIGN KEY ("skin_id") REFERENCES "public"."skins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_transfers" ADD CONSTRAINT "skin_transfers_skin_id_skins_id_fk" FOREIGN KEY ("skin_id") REFERENCES "public"."skins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_transfers" ADD CONSTRAINT "skin_transfers_from_player_id_players_id_fk" FOREIGN KEY ("from_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skin_transfers" ADD CONSTRAINT "skin_transfers_to_player_id_players_id_fk" FOREIGN KEY ("to_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skins" ADD CONSTRAINT "skins_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skin_transfers_skin_idx" ON "skin_transfers" USING btree ("skin_id","created_at");--> statement-breakpoint
CREATE INDEX "skins_owner_idx" ON "skins" USING btree ("owner_id");