CREATE OR REPLACE FUNCTION undersync_check_method_material_compatibility()
RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'MANUFACTURED' AND NOT EXISTS (
    SELECT 1 FROM manufacturing_method_materials
    WHERE manufacturing_method_id = NEW.manufacturing_method_id
      AND material_id = NEW.material_id
  ) THEN
    RAISE EXCEPTION 'material is not accepted by the selected manufacturing method';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_part_method_material_compatibility
BEFORE INSERT OR UPDATE OF kind, manufacturing_method_id, material_id ON parts
FOR EACH ROW EXECUTE FUNCTION undersync_check_method_material_compatibility();
