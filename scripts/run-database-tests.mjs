import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required. Copy the database values from .env.example into .env.");
}

const testUrl = new URL(testDatabaseUrl);
const databaseName = decodeURIComponent(testUrl.pathname.slice(1));
if (!["localhost", "127.0.0.1"].includes(testUrl.hostname)) {
  throw new Error("Database tests may reset only a local PostgreSQL server.");
}
if (!/^[a-zA-Z0-9_]+_test$/.test(databaseName)) {
  throw new Error(`Refusing to reset database '${databaseName}'; its name must end in _test.`);
}

const adminUrl = new URL(testUrl);
adminUrl.pathname = "/postgres";
adminUrl.search = "";
const quotedDatabaseName = `"${databaseName.replaceAll('"', '""')}"`;
const admin = new Client({ connectionString: adminUrl.toString() });

await admin.connect();
try {
  await admin.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName}`);
  await admin.query(`CREATE DATABASE ${quotedDatabaseName}`);
} finally {
  await admin.end();
}

const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");

function requireSuccessful(result, label) {
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const build = spawnSync(process.execPath, [npmCli, "run", "build"], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
  stdio: "inherit",
});
requireSuccessful(build, "TypeScript build");

const migration = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: testDatabaseUrl },
  encoding: "utf8",
  stdio: "inherit",
});
requireSuccessful(migration, "Prisma migration");

const tests = spawnSync(process.execPath, ["--test", "test/database.test.mjs", "test/auth.integration.test.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: testDatabaseUrl },
  encoding: "utf8",
  stdio: "inherit",
});
requireSuccessful(tests, "Database tests");
