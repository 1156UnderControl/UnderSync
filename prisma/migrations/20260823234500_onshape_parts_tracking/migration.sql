DO $$ BEGIN
  CREATE TYPE "OnshapeRenameStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "oauth_authorization_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "state_hash" CHAR(64) NOT NULL,
    "return_to" TEXT NOT NULL DEFAULT '/account',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_authorization_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "onshape_oauth_grants" (
    "external_identity_id" UUID NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT,
    "token_type" TEXT NOT NULL DEFAULT 'Bearer',
    "scope" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onshape_oauth_grants_pkey" PRIMARY KEY ("external_identity_id")
);

ALTER TABLE "cad_references"
  ADD COLUMN IF NOT EXISTS "onshape_name_before" TEXT,
  ADD COLUMN IF NOT EXISTS "onshape_name_after" TEXT,
  ADD COLUMN IF NOT EXISTS "rename_status" "OnshapeRenameStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "rename_error" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_authorization_states_state_hash_key" ON "oauth_authorization_states"("state_hash");
CREATE INDEX IF NOT EXISTS "oauth_authorization_states_expires_at_idx" ON "oauth_authorization_states"("expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "cad_references_active_onshape_part_key"
  ON "cad_references"("server", "document_id", "element_id", "onshape_part_id", "configuration");

ALTER TABLE "oauth_authorization_states" DROP CONSTRAINT IF EXISTS "oauth_authorization_states_user_id_fkey";
ALTER TABLE "oauth_authorization_states" ADD CONSTRAINT "oauth_authorization_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_states" DROP CONSTRAINT IF EXISTS "oauth_authorization_states_connection_id_fkey";
ALTER TABLE "oauth_authorization_states" ADD CONSTRAINT "oauth_authorization_states_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "onshape_oauth_grants" DROP CONSTRAINT IF EXISTS "onshape_oauth_grants_external_identity_id_fkey";
ALTER TABLE "onshape_oauth_grants" ADD CONSTRAINT "onshape_oauth_grants_external_identity_id_fkey"
  FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TRIGGER IF EXISTS set_onshape_oauth_grants_updated_at ON "onshape_oauth_grants";
CREATE TRIGGER set_onshape_oauth_grants_updated_at
BEFORE UPDATE ON "onshape_oauth_grants"
FOR EACH ROW EXECUTE FUNCTION undersync_set_updated_at();
