ALTER TABLE "widget_players" ADD COLUMN "widget_version" text;--> statement-breakpoint
ALTER TABLE "widget_players" ADD COLUMN "keyboard_version" smallint DEFAULT 0 NOT NULL;