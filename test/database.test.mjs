import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const { Client } = pg;

async function expectPostgresError(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

test("UnderSync PostgreSQL foundation", async (t) => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be set by the isolated test runner");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const fixture = {
    season: randomUUID(),
    subsystem: randomUUID(),
    method: randomUUID(),
    material: randomUUID(),
    creator: randomUUID(),
    assignee: randomUUID(),
  };

  try {
    await t.test("migrations build the complete schema from an empty database", async () => {
      const migrations = await client.query(
        `SELECT migration_name, finished_at
           FROM _prisma_migrations
          WHERE rolled_back_at IS NULL
          ORDER BY migration_name`,
      );
      assert.equal(migrations.rowCount, 8);
      assert.deepEqual(migrations.rows.map((row) => row.migration_name), [
        "20260823190000_initial_foundation",
        "20260823210000_authentication",
        "20260823223000_single_team_and_admin_controls",
        "20260823231500_external_account_links",
        "20260823234500_onshape_parts_tracking",
        "20260824003000_admin_parts_tracking_configuration",
        "20260824010000_method_material_compatibility",
        "20260824011500_enforce_method_material_compatibility",
      ]);
      assert.ok(migrations.rows.every((row) => row.finished_at));

      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public'`,
      );
      const names = new Set(tables.rows.map((row) => row.table_name));
      for (const required of ["users", "sessions", "tasks", "parts", "cad_references", "custom_field_definitions", "integration_connections", "external_identities", "oauth_authorization_states", "onshape_oauth_grants", "parts_tracking_form_settings", "manufacturing_method_materials"]) {
        assert.ok(names.has(required), `missing migrated table ${required}`);
      }
      assert.equal(names.has("teams"), false);
    });

    await t.test("primary, foreign, and unique constraints are active", async () => {
      await client.query(
        `INSERT INTO users (id, name, email, display_name, role) VALUES
          ($1, 'Creator User', 'creator@example.test', 'Creator', 'ADMIN'),
          ($2, 'Assigned User', 'assigned@example.test', 'Assigned', 'MEMBER')`,
        [fixture.creator, fixture.assignee],
      );
      await expectPostgresError(
        client.query("INSERT INTO users (id, name, email, display_name) VALUES ($1, 'Duplicate ID', 'duplicate-id@example.test', 'Duplicate')", [fixture.creator]),
        "23505",
      );
      await expectPostgresError(
        client.query(
          `INSERT INTO users (name, email, display_name)
           VALUES ('Duplicate Email', 'CREATOR@example.test', 'Duplicate')`,
        ),
        "23505",
      );
      await expectPostgresError(
        client.query("INSERT INTO tasks (creator_id, title) VALUES ($1, 'Invalid creator')", [randomUUID()]),
        "23503",
      );
    });

    await t.test("a user can create tasks and another user can be assigned", async () => {
      const task = await client.query(
        `INSERT INTO tasks (creator_id, assignee_id, title, description, priority, due_date)
         VALUES ($1, $2, 'Database relationship test', 'Created by automated test', 'HIGH', CURRENT_DATE + 3)
         RETURNING id`,
        [fixture.creator, fixture.assignee],
      );
      fixture.task = task.rows[0].id;

      const joined = await client.query(
        `SELECT creator.email AS creator_email, assignee.email AS assignee_email
           FROM tasks t
           JOIN users creator ON creator.id = t.creator_id
           JOIN users assignee ON assignee.id = t.assignee_id
          WHERE t.id = $1`,
        [fixture.task],
      );
      assert.deepEqual(joined.rows[0], {
        creator_email: "creator@example.test",
        assignee_email: "assigned@example.test",
      });
    });

    await t.test("manufactured and COTS parts have valid, generated tracking identities", async () => {
      await client.query("INSERT INTO seasons (id, code, name) VALUES ($1, '26', '2026')", [fixture.season]);
      await client.query("INSERT INTO subsystems (id, code, name) VALUES ($1, 'S', 'Shooter')", [fixture.subsystem]);
      await client.query("INSERT INTO manufacturing_methods (id, code, name) VALUES ($1, '3D', '3D Printing')", [fixture.method]);
      await client.query("INSERT INTO materials (id, code, name) VALUES ($1, 'PLA', 'PLA')", [fixture.material]);
      await client.query("INSERT INTO manufacturing_method_materials (manufacturing_method_id, material_id) VALUES ($1, $2)", [fixture.method, fixture.material]);

      const manufactured = await client.query(
        `INSERT INTO parts
          (season_id, subsystem_id, manufacturing_method_id, material_id,
           kind, name, status, manufacturing_info)
         VALUES ($1, $2, $3, $4, 'MANUFACTURED', 'Printed Mount', 'IN_DEVELOPMENT', '40% infill')
         RETURNING id, tracking_code, kind, manufacturing_method_id, material_id`,
        [fixture.season, fixture.subsystem, fixture.method, fixture.material],
      );
      fixture.manufacturedPart = manufactured.rows[0].id;
      assert.equal(manufactured.rows[0].tracking_code, "1156-26-S-3D-PLA-001");
      assert.equal(manufactured.rows[0].kind, "MANUFACTURED");
      assert.equal(manufactured.rows[0].manufacturing_method_id, fixture.method);

      const incompatibleMaterial = randomUUID();
      await client.query("INSERT INTO materials (id, code, name) VALUES ($1, 'BAD', 'Incompatible')", [incompatibleMaterial]);
      await expectPostgresError(
        client.query(
          `INSERT INTO parts (season_id, subsystem_id, manufacturing_method_id, material_id, kind, name, status)
           VALUES ($1, $2, $3, $4, 'MANUFACTURED', 'Invalid combination', 'IN_DEVELOPMENT')`,
          [fixture.season, fixture.subsystem, fixture.method, incompatibleMaterial],
        ),
        "P0001",
      );

      await client.query("BEGIN");
      try {
        const cots = await client.query(
          `INSERT INTO parts (season_id, subsystem_id, kind, name, status)
           VALUES ($1, $2, 'COTS', 'Purchased Motor', 'ACTIVE')
           RETURNING id, tracking_code, manufacturing_method_id, material_id`,
          [fixture.season, fixture.subsystem],
        );
        fixture.cotsPart = cots.rows[0].id;
        await client.query(
          `INSERT INTO cots_part_details (part_id, manufacturer, manufacturer_part_number)
           VALUES ($1, 'Test Manufacturer', 'TEST-001')`,
          [fixture.cotsPart],
        );
        await client.query("COMMIT");
        assert.equal(cots.rows[0].tracking_code, "1156-26-S-COTS-NA-002");
        assert.equal(cots.rows[0].manufacturing_method_id, null);
        assert.equal(cots.rows[0].material_id, null);
        assert.notEqual(cots.rows[0].tracking_code, manufactured.rows[0].tracking_code);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      await expectPostgresError(
        client.query("UPDATE parts SET tracking_code = '1156-26-S-3D-PLA-999' WHERE id = $1", [fixture.manufacturedPart]),
        "P0001",
      );
    });

    await t.test("parts connect to requirements, users, tasks, files, and CAD references", async () => {
      const fileType = randomUUID();
      await client.query("INSERT INTO file_types (id, code, name) VALUES ($1, 'STEP', 'STEP')", [fileType]);
      await client.query(
        `INSERT INTO manufacturing_method_file_requirements
          (manufacturing_method_id, file_type_id, required) VALUES ($1, $2, true)`,
        [fixture.method, fileType],
      );
      await client.query(
        `INSERT INTO manufacturing_files (part_id, file_type_id, reference, original_file_name)
         VALUES ($1, $2, 'local://seed/camera-mount.step', 'camera-mount.step')`,
        [fixture.manufacturedPart, fileType],
      );
      await client.query(
        "INSERT INTO part_requirements (part_id, context, required_quantity) VALUES ($1, 'Test robot', 4)",
        [fixture.manufacturedPart],
      );
      await client.query(
        "INSERT INTO part_user_assignments (part_id, user_id, role) VALUES ($1, $2, 'OWNER')",
        [fixture.manufacturedPart, fixture.assignee],
      );
      await client.query("INSERT INTO task_parts (task_id, part_id) VALUES ($1, $2)", [fixture.task, fixture.manufacturedPart]);

      const cad = await client.query(
        `INSERT INTO cad_references
          (part_id, document_id, context_kind, workspace_or_version_id, element_id,
           microversion_id, onshape_part_id, configuration, geometry_selection_id)
         VALUES ($1, 'doc-test', 'WORKSPACE', 'workspace-test', 'element-test',
           'microversion-test', 'part-test', 'default', 'selection-test')
         RETURNING id`,
        [fixture.manufacturedPart],
      );
      const linked = await client.query("SELECT part_id FROM cad_references WHERE id = $1", [cad.rows[0].id]);
      assert.equal(linked.rows[0].part_id, fixture.manufacturedPart);
    });

    await t.test("controlled custom fields can be added or retired without changing core tables", async () => {
      const definition = await client.query(
        `INSERT INTO custom_field_definitions
          (entity_type, key, label, value_type)
         VALUES ('PART', 'finish_color', 'Finish color', 'TEXT')
         RETURNING id`,
      );
      await client.query(
        `INSERT INTO custom_field_values (definition_id, part_id, value)
         VALUES ($1, $2, to_jsonb('black'::text))`,
        [definition.rows[0].id, fixture.manufacturedPart],
      );
      const value = await client.query(
        "SELECT value FROM custom_field_values WHERE definition_id = $1 AND part_id = $2",
        [definition.rows[0].id, fixture.manufacturedPart],
      );
      assert.equal(value.rows[0].value, "black");
      await client.query("UPDATE custom_field_definitions SET active = false WHERE id = $1", [definition.rows[0].id]);
    });

    await t.test("UnderSync users can hold unique Onshape and Notion identity links", async () => {
      const onshapeConnection = randomUUID();
      const notionConnection = randomUUID();
      await client.query(
        `INSERT INTO integration_connections (id, provider, key, display_name, auth_mode, status) VALUES
          ($1, 'ONSHAPE', 'database-test', 'Onshape test', 'OAUTH', 'ACTIVE'),
          ($2, 'NOTION', 'database-test', 'Notion test', 'INTERNAL_TOKEN', 'ACTIVE')`,
        [onshapeConnection, notionConnection],
      );
      await client.query(
        `INSERT INTO external_identities
          (user_id, connection_id, external_user_id, external_display_name, external_email, status, verified_at) VALUES
          ($1, $2, 'onshape-user-1', 'Onshape User', 'onshape@example.test', 'VERIFIED', CURRENT_TIMESTAMP),
          ($1, $3, 'notion-user-1', 'Notion User', 'notion@example.test', 'VERIFIED', CURRENT_TIMESTAMP)`,
        [fixture.creator, onshapeConnection, notionConnection],
      );
      const links = await client.query(
        `SELECT c.provider, e.external_user_id FROM external_identities e
          JOIN integration_connections c ON c.id = e.connection_id
         WHERE e.user_id = $1 ORDER BY c.provider`,
        [fixture.creator],
      );
      assert.deepEqual(links.rows, [
        { provider: "ONSHAPE", external_user_id: "onshape-user-1" },
        { provider: "NOTION", external_user_id: "notion-user-1" },
      ]);
      await expectPostgresError(
        client.query(
          `INSERT INTO external_identities
            (user_id, connection_id, external_user_id, status, verified_at)
           VALUES ($1, $2, 'another-onshape-id', 'VERIFIED', CURRENT_TIMESTAMP)`,
          [fixture.creator, onshapeConnection],
        ),
        "23505",
      );
    });
  } finally {
    await client.end();
  }
});
