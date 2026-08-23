ALTER TABLE "manufacturing_methods" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "parts_tracking_form_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "form_title" TEXT NOT NULL DEFAULT 'Create the tracking record',
    "name_label" TEXT NOT NULL DEFAULT 'Name',
    "name_placeholder" TEXT NOT NULL DEFAULT 'Human-readable UnderSync name',
    "quantity_label" TEXT NOT NULL DEFAULT 'How many?',
    "subsystem_label" TEXT NOT NULL DEFAULT 'Subsystem',
    "designer_label" TEXT NOT NULL DEFAULT 'Designer',
    "fabrication_method_label" TEXT NOT NULL DEFAULT 'Fabrication method',
    "submit_label" TEXT NOT NULL DEFAULT 'Generate Parts Tracking ID',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "parts_tracking_form_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "parts_tracking_form_settings_singleton" CHECK ("id" = 1),
    CONSTRAINT "parts_tracking_form_settings_nonempty" CHECK (
      length(btrim("form_title")) BETWEEN 1 AND 120 AND
      length(btrim("name_label")) BETWEEN 1 AND 80 AND
      length(btrim("name_placeholder")) BETWEEN 1 AND 160 AND
      length(btrim("quantity_label")) BETWEEN 1 AND 80 AND
      length(btrim("subsystem_label")) BETWEEN 1 AND 80 AND
      length(btrim("designer_label")) BETWEEN 1 AND 80 AND
      length(btrim("fabrication_method_label")) BETWEEN 1 AND 80 AND
      length(btrim("submit_label")) BETWEEN 1 AND 100
    )
);

INSERT INTO "parts_tracking_form_settings" ("id") VALUES (1);

CREATE TRIGGER set_parts_tracking_form_settings_updated_at
BEFORE UPDATE ON "parts_tracking_form_settings"
FOR EACH ROW EXECUTE FUNCTION undersync_set_updated_at();
