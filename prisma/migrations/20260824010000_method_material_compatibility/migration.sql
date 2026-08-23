ALTER TABLE "materials" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "parts_tracking_form_settings" ADD COLUMN "material_label" TEXT NOT NULL DEFAULT 'Material';
ALTER TABLE "parts_tracking_form_settings" DROP CONSTRAINT "parts_tracking_form_settings_nonempty";
ALTER TABLE "parts_tracking_form_settings" ADD CONSTRAINT "parts_tracking_form_settings_nonempty" CHECK (
  length(btrim("form_title")) BETWEEN 1 AND 120 AND
  length(btrim("name_label")) BETWEEN 1 AND 80 AND
  length(btrim("name_placeholder")) BETWEEN 1 AND 160 AND
  length(btrim("quantity_label")) BETWEEN 1 AND 80 AND
  length(btrim("subsystem_label")) BETWEEN 1 AND 80 AND
  length(btrim("designer_label")) BETWEEN 1 AND 80 AND
  length(btrim("fabrication_method_label")) BETWEEN 1 AND 80 AND
  length(btrim("material_label")) BETWEEN 1 AND 80 AND
  length(btrim("submit_label")) BETWEEN 1 AND 100
);

CREATE TABLE "manufacturing_method_materials" (
  "manufacturing_method_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  CONSTRAINT "manufacturing_method_materials_pkey" PRIMARY KEY ("manufacturing_method_id", "material_id")
);
CREATE INDEX "manufacturing_method_materials_material_id_idx" ON "manufacturing_method_materials"("material_id");
ALTER TABLE "manufacturing_method_materials" ADD CONSTRAINT "manufacturing_method_materials_method_fkey"
  FOREIGN KEY ("manufacturing_method_id") REFERENCES "manufacturing_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manufacturing_method_materials" ADD CONSTRAINT "manufacturing_method_materials_material_fkey"
  FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
