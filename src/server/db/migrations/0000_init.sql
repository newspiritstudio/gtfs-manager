CREATE TABLE "agency" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agency_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"agency_id" text,
	"agency_name" text,
	"agency_url" text,
	"agency_timezone" text,
	"agency_lang" text,
	"agency_phone" text,
	"agency_fare_url" text,
	"agency_email" text,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "calendar" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "calendar_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"service_id" text NOT NULL,
	"monday" integer NOT NULL,
	"tuesday" integer NOT NULL,
	"wednesday" integer NOT NULL,
	"thursday" integer NOT NULL,
	"friday" integer NOT NULL,
	"saturday" integer NOT NULL,
	"sunday" integer NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "calendar_dates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "calendar_dates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"service_id" text NOT NULL,
	"date" text NOT NULL,
	"exception_type" integer NOT NULL,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "extra_files" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "extra_files_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_info" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feed_info_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"feed_publisher_name" text,
	"feed_publisher_url" text,
	"feed_lang" text,
	"default_lang" text,
	"feed_start_date" text,
	"feed_end_date" text,
	"feed_version" text,
	"feed_contact_email" text,
	"feed_contact_url" text,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"origin" text DEFAULT 'blank' NOT NULL,
	"import_report" jsonb,
	"stats" jsonb,
	"stats_stale" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frequencies" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "frequencies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"trip_id" text NOT NULL,
	"start_time" integer NOT NULL,
	"end_time" integer NOT NULL,
	"headway_secs" integer NOT NULL,
	"exact_times" integer,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "routes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"route_id" text NOT NULL,
	"agency_id" text,
	"route_short_name" text,
	"route_long_name" text,
	"route_desc" text,
	"route_type" integer,
	"route_url" text,
	"route_color" text,
	"route_text_color" text,
	"route_sort_order" integer,
	"continuous_pickup" integer,
	"continuous_drop_off" integer,
	"network_id" text,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "shapes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "shapes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"shape_id" text NOT NULL,
	"shape_pt_lat" double precision NOT NULL,
	"shape_pt_lon" double precision NOT NULL,
	"shape_pt_sequence" integer NOT NULL,
	"shape_dist_traveled" double precision,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "stop_times" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stop_times_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"trip_id" text NOT NULL,
	"arrival_time" integer,
	"departure_time" integer,
	"stop_id" text NOT NULL,
	"stop_sequence" integer NOT NULL,
	"stop_headsign" text,
	"pickup_type" integer,
	"drop_off_type" integer,
	"continuous_pickup" integer,
	"continuous_drop_off" integer,
	"shape_dist_traveled" double precision,
	"timepoint" integer,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stops_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"stop_id" text NOT NULL,
	"stop_code" text,
	"stop_name" text,
	"tts_stop_name" text,
	"stop_desc" text,
	"stop_lat" double precision,
	"stop_lon" double precision,
	"zone_id" text,
	"stop_url" text,
	"location_type" integer,
	"parent_station" text,
	"stop_timezone" text,
	"wheelchair_boarding" integer,
	"level_id" text,
	"platform_code" text,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"from_stop_id" text,
	"to_stop_id" text,
	"from_route_id" text,
	"to_route_id" text,
	"from_trip_id" text,
	"to_trip_id" text,
	"transfer_type" integer,
	"min_transfer_time" integer,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trips_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feed_id" uuid NOT NULL,
	"route_id" text NOT NULL,
	"service_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"trip_headsign" text,
	"trip_short_name" text,
	"direction_id" integer,
	"block_id" text,
	"shape_id" text,
	"wheelchair_accessible" integer,
	"bikes_allowed" integer,
	"extra" jsonb
);
--> statement-breakpoint
ALTER TABLE "agency" ADD CONSTRAINT "agency_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar" ADD CONSTRAINT "calendar_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_dates" ADD CONSTRAINT "calendar_dates_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_files" ADD CONSTRAINT "extra_files_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_info" ADD CONSTRAINT "feed_info_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frequencies" ADD CONSTRAINT "frequencies_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shapes" ADD CONSTRAINT "shapes_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_times" ADD CONSTRAINT "stop_times_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_feed_id_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_key" ON "agency" USING btree ("feed_id",coalesce("agency_id", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_key" ON "calendar" USING btree ("feed_id","service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_dates_key" ON "calendar_dates" USING btree ("feed_id","service_id","date");--> statement-breakpoint
CREATE INDEX "calendar_dates_date" ON "calendar_dates" USING btree ("feed_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "extra_files_key" ON "extra_files" USING btree ("feed_id","file_name");--> statement-breakpoint
CREATE INDEX "feed_info_feed" ON "feed_info" USING btree ("feed_id");--> statement-breakpoint
CREATE UNIQUE INDEX "frequencies_key" ON "frequencies" USING btree ("feed_id","trip_id","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "routes_key" ON "routes" USING btree ("feed_id","route_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shapes_key" ON "shapes" USING btree ("feed_id","shape_id","shape_pt_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "stop_times_key" ON "stop_times" USING btree ("feed_id","trip_id","stop_sequence");--> statement-breakpoint
CREATE INDEX "stop_times_stop" ON "stop_times" USING btree ("feed_id","stop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stops_key" ON "stops" USING btree ("feed_id","stop_id");--> statement-breakpoint
CREATE INDEX "transfers_feed" ON "transfers" USING btree ("feed_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_key" ON "trips" USING btree ("feed_id","trip_id");--> statement-breakpoint
CREATE INDEX "trips_route" ON "trips" USING btree ("feed_id","route_id");--> statement-breakpoint
CREATE INDEX "trips_service" ON "trips" USING btree ("feed_id","service_id");