import pg from "pg";
import argon2 from "argon2";

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to seed development data.");
}

const ids = {
  season: "20260000-0000-4000-8000-000000000001",
  subsystem: "50000000-0000-4000-8000-000000000001",
  method3d: "30000000-0000-4000-8000-000000000001",
  methodLaser: "30000000-0000-4000-8000-000000000002",
  methodMausCnc: "30000000-0000-4000-8000-000000000003",
  methodMausTorno: "30000000-0000-4000-8000-000000000004",
  methodCoferLaser: "30000000-0000-4000-8000-000000000005",
  methodLocalCnc: "30000000-0000-4000-8000-000000000006",
  methodManual: "30000000-0000-4000-8000-000000000007",
  methodRhino: "30000000-0000-4000-8000-000000000008",
  pla: "60000000-0000-4000-8000-000000000001",
  aluminum: "60000000-0000-4000-8000-000000000002",
  materialTbd: "60000000-0000-4000-8000-000000000003",
  dxf: "70000000-0000-4000-8000-000000000001",
  step: "70000000-0000-4000-8000-000000000002",
  admin: "a0000000-0000-4000-8000-000000000001",
  designer: "a0000000-0000-4000-8000-000000000002",
  builder: "a0000000-0000-4000-8000-000000000003",
  manufacturedPart: "b0000000-0000-4000-8000-000000000001",
  cotsPart: "b0000000-0000-4000-8000-000000000002",
  reviewTask: "c0000000-0000-4000-8000-000000000001",
  purchaseTask: "c0000000-0000-4000-8000-000000000002",
  onshapeConnection: "d0000000-0000-4000-8000-000000000001",
  notionConnection: "d0000000-0000-4000-8000-000000000002",
};

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const developmentAdminPasswordHash = await argon2.hash("admin", {
    type: argon2.argon2id,
  });
  await client.query("BEGIN");

  await client.query("INSERT INTO parts_tracking_form_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");

  await client.query(
    `INSERT INTO integration_connections
      (id, provider, key, display_name, auth_mode, status, config) VALUES
       ($1, 'ONSHAPE', 'default', 'Onshape', 'OAUTH', 'NOT_CONFIGURED', '{"server":"https://cad.onshape.com"}'::jsonb),
       ($2, 'NOTION', 'default', 'Notion workspace', 'INTERNAL_TOKEN', 'NOT_CONFIGURED', '{}'::jsonb)
     ON CONFLICT (provider, key) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       auth_mode = EXCLUDED.auth_mode,
       config = EXCLUDED.config`,
    [ids.onshapeConnection, ids.notionConnection],
  );

  await client.query(
    `INSERT INTO seasons (id, code, name)
     VALUES ($1, '26', '2026 Development Season')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [ids.season],
  );
  await client.query(
    `INSERT INTO subsystems (id, code, name)
     VALUES ($1, 'S', 'Shooter')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [ids.subsystem],
  );

  await client.query(
    `INSERT INTO manufacturing_methods (id, code, name) VALUES
       ($1, '3D', 'Impressora'),
       ($2, 'LLASER', 'Local-Laser'),
       ($3, 'MCNC', 'Maus CNC'),
       ($4, 'MTORNO', 'Maus Torno'),
       ($5, 'COFER', 'Cofer-Laser'),
       ($6, 'LCNC', 'Local-CNC'),
       ($7, 'MANUAL', 'Manual'),
       ($8, 'RHINO', 'Rhino-CNC-Laser')
     ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name`,
    [ids.method3d, ids.methodLaser, ids.methodMausCnc, ids.methodMausTorno, ids.methodCoferLaser, ids.methodLocalCnc, ids.methodManual, ids.methodRhino],
  );
  await client.query(
    `INSERT INTO materials (id, code, name) VALUES
       ($1, 'PLA', 'PLA'),
       ($2, 'AL', 'Aluminum'),
       ($3, 'TBD', 'To be determined')
     ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name`,
    [ids.pla, ids.aluminum, ids.materialTbd],
  );
  await client.query(
    `INSERT INTO manufacturing_method_materials (manufacturing_method_id, material_id)
     SELECT method_id, material_id FROM (VALUES
       ($1::uuid, $9::uuid), ($1::uuid, $11::uuid),
       ($2::uuid, $10::uuid), ($2::uuid, $11::uuid),
       ($3::uuid, $10::uuid), ($3::uuid, $11::uuid),
       ($4::uuid, $10::uuid), ($4::uuid, $11::uuid),
       ($5::uuid, $10::uuid), ($5::uuid, $11::uuid),
       ($6::uuid, $10::uuid), ($6::uuid, $11::uuid),
       ($7::uuid, $10::uuid), ($7::uuid, $11::uuid),
       ($8::uuid, $10::uuid), ($8::uuid, $11::uuid)
     ) AS compatibility(method_id, material_id)
     ON CONFLICT DO NOTHING`,
    [ids.method3d, ids.methodLaser, ids.methodMausCnc, ids.methodMausTorno, ids.methodCoferLaser, ids.methodLocalCnc, ids.methodManual, ids.methodRhino, ids.pla, ids.aluminum, ids.materialTbd],
  );
  await client.query(
    `INSERT INTO file_types (id, code, name) VALUES
       ($1, 'DXF', 'Drawing Exchange Format'),
       ($2, 'STEP', 'STEP CAD Exchange')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
    [ids.dxf, ids.step],
  );
  await client.query(
    `INSERT INTO manufacturing_method_file_requirements
       (manufacturing_method_id, file_type_id, required) VALUES
       ($1, $3, true),
       ($2, $4, true)
     ON CONFLICT (manufacturing_method_id, file_type_id)
     DO UPDATE SET required = EXCLUDED.required`,
    [ids.method3d, ids.methodLaser, ids.step, ids.dxf],
  );

  await client.query(
    `INSERT INTO users (id, name, email, display_name, password_hash, role, status) VALUES
       ($1, 'admin', 'admin@undersync.test', 'Administrator', $4, 'ADMIN', 'ACTIVE'),
       ($2, 'Development Designer', 'designer@undersync.test', 'Dev Designer', NULL, 'MEMBER', 'ACTIVE'),
       ($3, 'Development Builder', 'builder@undersync.test', 'Dev Builder', NULL, 'MEMBER', 'ACTIVE')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, display_name = EXCLUDED.display_name,
       password_hash = CASE WHEN users.id = $1 THEN EXCLUDED.password_hash ELSE users.password_hash END,
       role = EXCLUDED.role, status = EXCLUDED.status`,
    [ids.admin, ids.designer, ids.builder, developmentAdminPasswordHash],
  );

  const manufacturedExists = await client.query("SELECT 1 FROM parts WHERE id = $1", [ids.manufacturedPart]);
  if (manufacturedExists.rowCount === 0) {
    await client.query(
      `INSERT INTO parts
        (id, season_id, subsystem_id, manufacturing_method_id, material_id,
         kind, name, description, status, manufacturing_info)
       VALUES ($1, $2, $3, $4, $5, 'MANUFACTURED', 'Camera Mount',
         'Development manufactured part', 'IN_DEVELOPMENT', 'Print at 40% infill')`,
      [ids.manufacturedPart, ids.season, ids.subsystem, ids.method3d, ids.pla],
    );
  }

  const cotsExists = await client.query("SELECT 1 FROM parts WHERE id = $1", [ids.cotsPart]);
  if (cotsExists.rowCount === 0) {
    await client.query(
      `INSERT INTO parts
        (id, season_id, subsystem_id, kind, name, description, status)
       VALUES ($1, $2, $3, 'COTS', 'Example Motor',
         'Development purchased component', 'ACTIVE')`,
      [ids.cotsPart, ids.season, ids.subsystem],
    );
  }
  await client.query(
    `INSERT INTO cots_part_details
      (part_id, manufacturer, manufacturer_part_number, supplier, purchase_url)
     VALUES ($1, 'Example Manufacturer', 'DEV-MOTOR-001', 'Example Supplier', 'https://example.invalid/dev-motor')
     ON CONFLICT (part_id) DO UPDATE SET
       manufacturer = EXCLUDED.manufacturer,
       manufacturer_part_number = EXCLUDED.manufacturer_part_number,
       supplier = EXCLUDED.supplier,
       purchase_url = EXCLUDED.purchase_url`,
    [ids.cotsPart],
  );

  await client.query(
    `INSERT INTO part_requirements (part_id, context, required_quantity) VALUES
       ($1, 'Development robot', 4),
       ($2, 'Development robot', 2)
     ON CONFLICT DO NOTHING`,
    [ids.manufacturedPart, ids.cotsPart],
  );

  await client.query(
    `INSERT INTO tasks
      (id, creator_id, assignee_id, title, description, status, priority, due_date) VALUES
       ($1, $3, $4, 'Review camera mount', 'Development seed task', 'OPEN', 'HIGH', CURRENT_DATE + 3),
       ($2, $3, $5, 'Verify motor supplier', 'Development seed task', 'IN_PROGRESS', 'NORMAL', CURRENT_DATE + 7)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title, assignee_id = EXCLUDED.assignee_id,
       status = EXCLUDED.status, priority = EXCLUDED.priority`,
    [ids.reviewTask, ids.purchaseTask, ids.admin, ids.designer, ids.builder],
  );
  await client.query(
    `INSERT INTO task_parts (task_id, part_id) VALUES ($1, $3), ($2, $4)
     ON CONFLICT DO NOTHING`,
    [ids.reviewTask, ids.purchaseTask, ids.manufacturedPart, ids.cotsPart],
  );
  await client.query(
    `INSERT INTO part_user_assignments (part_id, user_id, role) VALUES
       ($1, $3, 'OWNER'), ($2, $4, 'CONTRIBUTOR')
     ON CONFLICT DO NOTHING`,
    [ids.manufacturedPart, ids.cotsPart, ids.designer, ids.builder],
  );

  await client.query("COMMIT");

  const summary = await client.query(
    `SELECT
       (SELECT count(*)::int FROM users) AS users,
       (SELECT count(*)::int FROM tasks) AS tasks,
       (SELECT count(*)::int FROM parts) AS parts`,
  );
  console.log("Development seed applied:", summary.rows[0]);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
