CREATE TYPE "IntegrationProvider" AS ENUM ('ONSHAPE', 'NOTION');
CREATE TYPE "IntegrationAuthMode" AS ENUM ('OAUTH', 'INTERNAL_TOKEN');
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'ACTIVE', 'ERROR', 'DISABLED');
CREATE TYPE "ExternalIdentityStatus" AS ENUM ('PENDING', 'VERIFIED', 'REVOKED');

CREATE TABLE "integration_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" "IntegrationProvider" NOT NULL,
  "key" VARCHAR(64) NOT NULL,
  "display_name" TEXT NOT NULL,
  "auth_mode" "IntegrationAuthMode" NOT NULL,
  "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  "external_tenant_id" TEXT,
  "config" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_identities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "external_user_id" TEXT NOT NULL,
  "external_display_name" TEXT,
  "external_email" TEXT,
  "status" "ExternalIdentityStatus" NOT NULL DEFAULT 'PENDING',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_connections_provider_key_key" ON "integration_connections"("provider", "key");
CREATE UNIQUE INDEX "external_identities_connection_id_user_id_key" ON "external_identities"("connection_id", "user_id");
CREATE UNIQUE INDEX "external_identities_connection_id_external_user_id_key" ON "external_identities"("connection_id", "external_user_id");
CREATE INDEX "external_identities_user_id_status_idx" ON "external_identities"("user_id", "status");

ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_key_format"
  CHECK ("key" ~ '^[a-z][a-z0-9_-]{0,63}$');
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_external_user_not_blank"
  CHECK (btrim("external_user_id") <> '');
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_verified_timestamp"
  CHECK ("status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);

CREATE TRIGGER "integration_connections_set_updated_at"
BEFORE UPDATE ON "integration_connections"
FOR EACH ROW EXECUTE FUNCTION undersync_set_updated_at();
CREATE TRIGGER "external_identities_set_updated_at"
BEFORE UPDATE ON "external_identities"
FOR EACH ROW EXECUTE FUNCTION undersync_set_updated_at();
