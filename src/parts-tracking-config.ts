import type { DatabasePool } from "./db.js";
import type { PartsTrackingFormSettings } from "./pages.js";

export const defaultPartsTrackingFormSettings: PartsTrackingFormSettings = {
  formTitle: "Create the tracking record",
  nameLabel: "Name",
  namePlaceholder: "Human-readable UnderSync name",
  quantityLabel: "How many?",
  subsystemLabel: "Subsystem",
  designerLabel: "Designer",
  fabricationMethodLabel: "Fabrication method",
  materialLabel: "Material",
  submitLabel: "Generate Parts Tracking ID",
};

export async function loadPartsTrackingFormSettings(database: DatabasePool): Promise<PartsTrackingFormSettings> {
  const result = await database.query("SELECT * FROM parts_tracking_form_settings WHERE id = 1");
  const row = result.rows[0];
  if (!row) return defaultPartsTrackingFormSettings;
  return {
    formTitle: row.form_title,
    nameLabel: row.name_label,
    namePlaceholder: row.name_placeholder,
    quantityLabel: row.quantity_label,
    subsystemLabel: row.subsystem_label,
    designerLabel: row.designer_label,
    fabricationMethodLabel: row.fabrication_method_label,
    materialLabel: row.material_label,
    submitLabel: row.submit_label,
  };
}
