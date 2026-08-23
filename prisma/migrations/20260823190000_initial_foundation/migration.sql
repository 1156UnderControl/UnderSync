-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "PartKind" AS ENUM ('MANUFACTURED', 'COTS');

-- CreateEnum
CREATE TYPE "PartStatus" AS ENUM ('DRAFT', 'IN_DEVELOPMENT', 'READY_FOR_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'READY_FOR_MANUFACTURING', 'IN_MANUFACTURING', 'COMPLETED', 'ACTIVE', 'DISCONTINUED', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CadContextKind" AS ENUM ('WORKSPACE', 'VERSION');

-- CreateEnum
CREATE TYPE "PartUserRole" AS ENUM ('OWNER', 'CONTRIBUTOR');

-- CreateEnum
CREATE TYPE "CustomFieldEntityType" AS ENUM ('USER', 'TASK', 'PART');

-- CreateEnum
CREATE TYPE "CustomFieldValueType" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT');

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "code" VARCHAR(8) NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subsystems" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subsystems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "manufacturing_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(16) NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_method_file_requirements" (
    "manufacturing_method_id" UUID NOT NULL,
    "file_type_id" UUID NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "manufacturing_method_file_requirements_pkey" PRIMARY KEY ("manufacturing_method_id","file_type_id")
);

-- CreateTable
CREATE TABLE "part_number_sequences" (
    "team_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "part_number_sequences_pkey" PRIMARY KEY ("team_id","season_id")
);

-- CreateTable
CREATE TABLE "parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "subsystem_id" UUID NOT NULL,
    "manufacturing_method_id" UUID,
    "material_id" UUID,
    "tracking_code" TEXT NOT NULL,
    "sequence_value" INTEGER NOT NULL,
    "origin_team_number" INTEGER NOT NULL,
    "origin_season_code" VARCHAR(8) NOT NULL,
    "origin_subsystem_code" VARCHAR(12) NOT NULL,
    "origin_manufacturing_code" VARCHAR(12) NOT NULL,
    "origin_material_code" VARCHAR(12) NOT NULL,
    "kind" "PartKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "PartStatus" NOT NULL,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "manufacturing_info" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cots_part_details" (
    "part_id" UUID NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "manufacturer_part_number" TEXT NOT NULL,
    "supplier" TEXT,
    "purchase_url" TEXT,

    CONSTRAINT "cots_part_details_pkey" PRIMARY KEY ("part_id")
);

-- CreateTable
CREATE TABLE "part_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "part_id" UUID NOT NULL,
    "context" TEXT NOT NULL,
    "required_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "part_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturing_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "part_id" UUID NOT NULL,
    "file_type_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "original_file_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manufacturing_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "creator_id" UUID NOT NULL,
    "assignee_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "creation_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_parts" (
    "task_id" UUID NOT NULL,
    "part_id" UUID NOT NULL,

    CONSTRAINT "task_parts_pkey" PRIMARY KEY ("task_id","part_id")
);

-- CreateTable
CREATE TABLE "part_user_assignments" (
    "part_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "PartUserRole" NOT NULL DEFAULT 'CONTRIBUTOR',

    CONSTRAINT "part_user_assignments_pkey" PRIMARY KEY ("part_id","user_id")
);

-- CreateTable
CREATE TABLE "cad_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "part_id" UUID NOT NULL,
    "server" TEXT NOT NULL DEFAULT 'https://cad.onshape.com',
    "document_id" TEXT NOT NULL,
    "context_kind" "CadContextKind" NOT NULL,
    "workspace_or_version_id" TEXT NOT NULL,
    "element_id" TEXT NOT NULL,
    "microversion_id" TEXT NOT NULL,
    "onshape_part_id" TEXT NOT NULL,
    "configuration" TEXT NOT NULL DEFAULT '',
    "geometry_selection_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cad_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "entity_type" "CustomFieldEntityType" NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "label" TEXT NOT NULL,
    "value_type" "CustomFieldValueType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "definition_id" UUID NOT NULL,
    "user_id" UUID,
    "task_id" UUID,
    "part_id" UUID,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_number_key" ON "teams"("number");

-- CreateIndex
CREATE INDEX "users_team_id_status_idx" ON "users"("team_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_team_id_code_key" ON "seasons"("team_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "subsystems_team_id_code_key" ON "subsystems"("team_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "manufacturing_methods_team_id_code_key" ON "manufacturing_methods"("team_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "materials_team_id_code_key" ON "materials"("team_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "file_types_code_key" ON "file_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "parts_tracking_code_key" ON "parts"("tracking_code");

-- CreateIndex
CREATE INDEX "parts_team_id_kind_status_idx" ON "parts"("team_id", "kind", "status");

-- CreateIndex
CREATE INDEX "parts_subsystem_id_status_idx" ON "parts"("subsystem_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "parts_team_id_season_id_sequence_value_key" ON "parts"("team_id", "season_id", "sequence_value");

-- CreateIndex
CREATE UNIQUE INDEX "cots_part_details_manufacturer_manufacturer_part_number_key" ON "cots_part_details"("manufacturer", "manufacturer_part_number");

-- CreateIndex
CREATE INDEX "part_requirements_part_id_idx" ON "part_requirements"("part_id");

-- CreateIndex
CREATE INDEX "manufacturing_files_part_id_file_type_id_idx" ON "manufacturing_files"("part_id", "file_type_id");

-- CreateIndex
CREATE INDEX "tasks_creator_id_idx" ON "tasks"("creator_id");

-- CreateIndex
CREATE INDEX "tasks_assignee_id_status_idx" ON "tasks"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "tasks_status_due_date_idx" ON "tasks"("status", "due_date");

-- CreateIndex
CREATE INDEX "part_user_assignments_user_id_idx" ON "part_user_assignments"("user_id");

-- CreateIndex
CREATE INDEX "cad_references_part_id_idx" ON "cad_references"("part_id");

-- CreateIndex
CREATE INDEX "cad_references_document_id_element_id_idx" ON "cad_references"("document_id", "element_id");

-- CreateIndex
CREATE UNIQUE INDEX "cad_references_server_document_id_context_kind_workspace_or_key" ON "cad_references"("server", "document_id", "context_kind", "workspace_or_version_id", "element_id", "microversion_id", "onshape_part_id", "configuration");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_team_id_entity_type_key_key" ON "custom_field_definitions"("team_id", "entity_type", "key");

-- CreateIndex
CREATE INDEX "custom_field_values_definition_id_idx" ON "custom_field_values"("definition_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subsystems" ADD CONSTRAINT "subsystems_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_methods" ADD CONSTRAINT "manufacturing_methods_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_method_file_requirements" ADD CONSTRAINT "manufacturing_method_file_requirements_manufacturing_metho_fkey" FOREIGN KEY ("manufacturing_method_id") REFERENCES "manufacturing_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_method_file_requirements" ADD CONSTRAINT "manufacturing_method_file_requirements_file_type_id_fkey" FOREIGN KEY ("file_type_id") REFERENCES "file_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_number_sequences" ADD CONSTRAINT "part_number_sequences_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_number_sequences" ADD CONSTRAINT "part_number_sequences_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_subsystem_id_fkey" FOREIGN KEY ("subsystem_id") REFERENCES "subsystems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_manufacturing_method_id_fkey" FOREIGN KEY ("manufacturing_method_id") REFERENCES "manufacturing_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts" ADD CONSTRAINT "parts_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cots_part_details" ADD CONSTRAINT "cots_part_details_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_requirements" ADD CONSTRAINT "part_requirements_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_files" ADD CONSTRAINT "manufacturing_files_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturing_files" ADD CONSTRAINT "manufacturing_files_file_type_id_fkey" FOREIGN KEY ("file_type_id") REFERENCES "file_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_parts" ADD CONSTRAINT "task_parts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_parts" ADD CONSTRAINT "task_parts_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_user_assignments" ADD CONSTRAINT "part_user_assignments_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_user_assignments" ADD CONSTRAINT "part_user_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cad_references" ADD CONSTRAINT "cad_references_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reviewed domain constraints not expressible in the Prisma schema.
CREATE UNIQUE INDEX "users_email_ci_key" ON "users" (lower("email"));
CREATE UNIQUE INDEX "part_requirements_part_id_context_key" ON "part_requirements" ("part_id", "context");
CREATE UNIQUE INDEX "custom_field_values_definition_user_key" ON "custom_field_values" ("definition_id", "user_id") WHERE "user_id" IS NOT NULL;
CREATE UNIQUE INDEX "custom_field_values_definition_task_key" ON "custom_field_values" ("definition_id", "task_id") WHERE "task_id" IS NOT NULL;
CREATE UNIQUE INDEX "custom_field_values_definition_part_key" ON "custom_field_values" ("definition_id", "part_id") WHERE "part_id" IS NOT NULL;

ALTER TABLE "teams" ADD CONSTRAINT "teams_number_positive" CHECK ("number" > 0);
ALTER TABLE "users" ADD CONSTRAINT "users_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "users" ADD CONSTRAINT "users_email_not_blank" CHECK (btrim("email") <> '');
ALTER TABLE "users" ADD CONSTRAINT "users_display_name_not_blank" CHECK (btrim("display_name") <> '');
ALTER TABLE "users" ADD CONSTRAINT "users_password_hash_not_blank" CHECK ("password_hash" IS NULL OR btrim("password_hash") <> '');
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_code_format" CHECK ("code" ~ '^[A-Z0-9]+$');
ALTER TABLE "subsystems" ADD CONSTRAINT "subsystems_code_format" CHECK ("code" ~ '^[A-Z0-9]+$');
ALTER TABLE "manufacturing_methods" ADD CONSTRAINT "manufacturing_methods_code_format" CHECK ("code" ~ '^[A-Z0-9]+$');
ALTER TABLE "materials" ADD CONSTRAINT "materials_code_format" CHECK ("code" ~ '^[A-Z0-9]+$');
ALTER TABLE "part_number_sequences" ADD CONSTRAINT "part_number_sequences_next_positive" CHECK ("next_value" > 0);
ALTER TABLE "part_requirements" ADD CONSTRAINT "part_requirements_quantity_positive" CHECK ("required_quantity" > 0);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_title_not_blank" CHECK (btrim("title") <> '');
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_timestamp" CHECK ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL);
ALTER TABLE "parts" ADD CONSTRAINT "parts_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "parts" ADD CONSTRAINT "parts_kind_fields" CHECK (
  ("kind" = 'MANUFACTURED' AND "manufacturing_method_id" IS NOT NULL AND "material_id" IS NOT NULL)
  OR
  ("kind" = 'COTS' AND "manufacturing_method_id" IS NULL AND "material_id" IS NULL AND "manufacturing_info" IS NULL)
);
ALTER TABLE "parts" ADD CONSTRAINT "parts_status_by_kind" CHECK (
  ("kind" = 'MANUFACTURED' AND "status" IN ('DRAFT', 'IN_DEVELOPMENT', 'READY_FOR_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'READY_FOR_MANUFACTURING', 'IN_MANUFACTURING', 'COMPLETED', 'ARCHIVED', 'CANCELLED'))
  OR
  ("kind" = 'COTS' AND "status" IN ('DRAFT', 'ACTIVE', 'DISCONTINUED', 'ARCHIVED', 'CANCELLED'))
);
ALTER TABLE "parts" ADD CONSTRAINT "parts_tracking_code_format" CHECK ("tracking_code" ~ '^[0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[0-9]{3,}$');
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_key_format" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,63}$');
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_one_target" CHECK (num_nonnulls("user_id", "task_id", "part_id") = 1);

CREATE OR REPLACE FUNCTION undersync_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'teams', 'users', 'seasons', 'subsystems', 'manufacturing_methods',
    'materials', 'parts', 'part_requirements', 'tasks', 'cad_references',
    'custom_field_definitions', 'custom_field_values'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP',
      table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION undersync_set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION undersync_generate_part_tracking_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  team_number integer;
  season_code text;
  season_team_id uuid;
  subsystem_code text;
  subsystem_team_id uuid;
  method_code text;
  method_team_id uuid;
  material_code text;
  material_team_id uuid;
  allocated_sequence integer;
BEGIN
  IF NEW.tracking_code IS NOT NULL
     OR NEW.sequence_value IS NOT NULL
     OR NEW.origin_team_number IS NOT NULL
     OR NEW.origin_season_code IS NOT NULL
     OR NEW.origin_subsystem_code IS NOT NULL
     OR NEW.origin_manufacturing_code IS NOT NULL
     OR NEW.origin_material_code IS NOT NULL THEN
    RAISE EXCEPTION 'Parts Tracking IDs and origin fields are generated by UnderSync';
  END IF;

  SELECT "number" INTO STRICT team_number FROM "teams" WHERE "id" = NEW.team_id;
  SELECT "code", "team_id" INTO STRICT season_code, season_team_id FROM "seasons" WHERE "id" = NEW.season_id;
  SELECT "code", "team_id" INTO STRICT subsystem_code, subsystem_team_id FROM "subsystems" WHERE "id" = NEW.subsystem_id;

  IF season_team_id <> NEW.team_id OR subsystem_team_id <> NEW.team_id THEN
    RAISE EXCEPTION 'Part season and subsystem must belong to its team';
  END IF;

  IF NEW.kind = 'MANUFACTURED' THEN
    SELECT "code", "team_id" INTO STRICT method_code, method_team_id
      FROM "manufacturing_methods" WHERE "id" = NEW.manufacturing_method_id;
    SELECT "code", "team_id" INTO STRICT material_code, material_team_id
      FROM "materials" WHERE "id" = NEW.material_id;
    IF method_team_id <> NEW.team_id OR material_team_id <> NEW.team_id THEN
      RAISE EXCEPTION 'Manufacturing method and material must belong to the part team';
    END IF;
  ELSE
    method_code := 'COTS';
    material_code := 'NA';
  END IF;

  INSERT INTO "part_number_sequences" ("team_id", "season_id", "next_value")
  VALUES (NEW.team_id, NEW.season_id, 2)
  ON CONFLICT ("team_id", "season_id")
  DO UPDATE SET "next_value" = "part_number_sequences"."next_value" + 1
  RETURNING "next_value" - 1 INTO allocated_sequence;

  NEW.sequence_value := allocated_sequence;
  NEW.origin_team_number := team_number;
  NEW.origin_season_code := season_code;
  NEW.origin_subsystem_code := subsystem_code;
  NEW.origin_manufacturing_code := method_code;
  NEW.origin_material_code := material_code;
  NEW.tracking_code := team_number::text || '-' || season_code || '-' || subsystem_code || '-' || method_code || '-' || material_code || '-' || lpad(allocated_sequence::text, 3, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "parts_generate_tracking_code"
BEFORE INSERT ON "parts"
FOR EACH ROW EXECUTE FUNCTION undersync_generate_part_tracking_code();

CREATE OR REPLACE FUNCTION undersync_protect_part_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.tracking_code, NEW.sequence_value, NEW.origin_team_number,
    NEW.origin_season_code, NEW.origin_subsystem_code,
    NEW.origin_manufacturing_code, NEW.origin_material_code
  ) IS DISTINCT FROM ROW(
    OLD.tracking_code, OLD.sequence_value, OLD.origin_team_number,
    OLD.origin_season_code, OLD.origin_subsystem_code,
    OLD.origin_manufacturing_code, OLD.origin_material_code
  ) THEN
    RAISE EXCEPTION 'Parts Tracking ID allocation is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "parts_protect_identity"
BEFORE UPDATE ON "parts"
FOR EACH ROW EXECUTE FUNCTION undersync_protect_part_identity();

CREATE OR REPLACE FUNCTION undersync_check_part_subtype()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  checked_part_id uuid;
  checked_kind "PartKind";
  cots_count integer;
BEGIN
  IF TG_TABLE_NAME = 'parts' THEN
    checked_part_id := COALESCE(NEW.id, OLD.id);
  ELSE
    checked_part_id := COALESCE(NEW.part_id, OLD.part_id);
  END IF;
  SELECT "kind" INTO checked_kind FROM "parts" WHERE "id" = checked_part_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO cots_count FROM "cots_part_details" WHERE "part_id" = checked_part_id;
  IF (checked_kind = 'COTS' AND cots_count <> 1) OR (checked_kind = 'MANUFACTURED' AND cots_count <> 0) THEN
    RAISE EXCEPTION 'Part % must have exactly the subtype data required by kind %', checked_part_id, checked_kind;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "parts_check_subtype"
AFTER INSERT OR UPDATE OF "kind" ON "parts"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION undersync_check_part_subtype();

CREATE CONSTRAINT TRIGGER "cots_part_details_check_subtype"
AFTER INSERT OR UPDATE OR DELETE ON "cots_part_details"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION undersync_check_part_subtype();

CREATE OR REPLACE FUNCTION undersync_check_task_people()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  creator_team uuid;
  assignee_team uuid;
BEGIN
  SELECT "team_id" INTO STRICT creator_team FROM "users" WHERE "id" = NEW.creator_id;
  IF NEW.assignee_id IS NOT NULL THEN
    SELECT "team_id" INTO STRICT assignee_team FROM "users" WHERE "id" = NEW.assignee_id;
    IF creator_team <> assignee_team THEN
      RAISE EXCEPTION 'Task creator and assignee must belong to the same team';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tasks_check_people"
BEFORE INSERT OR UPDATE OF "creator_id", "assignee_id" ON "tasks"
FOR EACH ROW EXECUTE FUNCTION undersync_check_task_people();

CREATE OR REPLACE FUNCTION undersync_check_part_relation_team()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  part_team uuid;
  related_team uuid;
BEGIN
  SELECT "team_id" INTO STRICT part_team FROM "parts" WHERE "id" = NEW.part_id;
  IF TG_TABLE_NAME = 'part_user_assignments' THEN
    SELECT "team_id" INTO STRICT related_team FROM "users" WHERE "id" = NEW.user_id;
  ELSE
    SELECT u."team_id" INTO STRICT related_team
      FROM "tasks" t JOIN "users" u ON u."id" = t."creator_id"
      WHERE t."id" = NEW.task_id;
  END IF;
  IF part_team <> related_team THEN
    RAISE EXCEPTION 'Related user/task and part must belong to the same team';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "part_user_assignments_check_team"
BEFORE INSERT OR UPDATE ON "part_user_assignments"
FOR EACH ROW EXECUTE FUNCTION undersync_check_part_relation_team();

CREATE TRIGGER "task_parts_check_team"
BEFORE INSERT OR UPDATE ON "task_parts"
FOR EACH ROW EXECUTE FUNCTION undersync_check_part_relation_team();

CREATE OR REPLACE FUNCTION undersync_check_custom_field_value()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  defined_entity "CustomFieldEntityType";
  defined_type "CustomFieldValueType";
  definition_team uuid;
  target_team uuid;
BEGIN
  SELECT "entity_type", "value_type", "team_id"
    INTO STRICT defined_entity, defined_type, definition_team
    FROM "custom_field_definitions" WHERE "id" = NEW.definition_id AND "active" = true;

  IF NEW.user_id IS NOT NULL THEN
    IF defined_entity <> 'USER' THEN RAISE EXCEPTION 'Custom field target type does not match definition'; END IF;
    SELECT "team_id" INTO STRICT target_team FROM "users" WHERE "id" = NEW.user_id;
  ELSIF NEW.task_id IS NOT NULL THEN
    IF defined_entity <> 'TASK' THEN RAISE EXCEPTION 'Custom field target type does not match definition'; END IF;
    SELECT u."team_id" INTO STRICT target_team FROM "tasks" t JOIN "users" u ON u."id" = t."creator_id" WHERE t."id" = NEW.task_id;
  ELSE
    IF defined_entity <> 'PART' THEN RAISE EXCEPTION 'Custom field target type does not match definition'; END IF;
    SELECT "team_id" INTO STRICT target_team FROM "parts" WHERE "id" = NEW.part_id;
  END IF;

  IF target_team <> definition_team THEN
    RAISE EXCEPTION 'Custom field definition and target must belong to the same team';
  END IF;

  IF (defined_type IN ('TEXT', 'DATE', 'SELECT') AND jsonb_typeof(NEW.value) <> 'string')
     OR (defined_type = 'NUMBER' AND jsonb_typeof(NEW.value) <> 'number')
     OR (defined_type = 'BOOLEAN' AND jsonb_typeof(NEW.value) <> 'boolean') THEN
    RAISE EXCEPTION 'Custom field value JSON type does not match definition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "custom_field_values_check_definition"
BEFORE INSERT OR UPDATE ON "custom_field_values"
FOR EACH ROW EXECUTE FUNCTION undersync_check_custom_field_value();
