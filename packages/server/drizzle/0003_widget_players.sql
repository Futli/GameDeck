CREATE TABLE "widget_players" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"rolls" smallint NOT NULL,
	"next_at" timestamp with time zone,
	"last_dice" text,
	"modifiers" integer DEFAULT 0 NOT NULL,
	"chat_id" bigint,
	"message_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "widget_players" ADD CONSTRAINT "widget_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;