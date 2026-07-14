import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertLoopbackUrl,
  buildLocalAppEnv,
  localSupabasePaths,
  parseSupabaseStatus,
  prepareLocalSupabaseWorkdir,
} from "../scripts/local-supabase.mjs";
import { parseEnvFile } from "../scripts/run-with-local-supabase-env.mjs";

test("only loopback Supabase URLs are accepted", () => {
  assert.doesNotThrow(() => assertLoopbackUrl("http://127.0.0.1:54321"));
  assert.doesNotThrow(() => assertLoopbackUrl("http://localhost:54321"));
  assert.throws(
    () => assertLoopbackUrl("https://example.supabase.co"),
    /不是本机回环地址/,
  );
});

test("legacy and current local key names are parsed", () => {
  assert.deepEqual(
    parseSupabaseStatus(
      JSON.stringify({
        API_URL: "http://127.0.0.1:54321",
        ANON_KEY: "anon",
        SERVICE_ROLE_KEY: "service",
      }),
    ),
    {
      apiUrl: "http://127.0.0.1:54321",
      publicKey: "anon",
      serviceKey: "service",
      studioUrl: null,
      mailUrl: null,
    },
  );

  const current = parseSupabaseStatus(
    JSON.stringify({
      api: { url: "http://localhost:54321" },
      PUBLISHABLE_KEY: "publishable",
      SECRET_KEY: "secret",
      SERVICE_ROLE_KEY: "legacy-service-role",
    }),
  );
  assert.equal(current.publicKey, "publishable");
  assert.equal(current.serviceKey, "legacy-service-role");
});

test("generated app env contains only the local endpoint", () => {
  const env = parseEnvFile(
    buildLocalAppEnv({
      apiUrl: "http://127.0.0.1:54321",
      publicKey: "public-key",
      serviceKey: "service-key",
    }),
  );
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:54321");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "public-key");
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, "service-key");
  assert.equal(env.NEXT_PUBLIC_SITE_URL, "http://localhost:3000");
});

test("local workdir is rebuilt from the base schema and every migration", () => {
  const prepared = prepareLocalSupabaseWorkdir();
  const generatedNames = readdirSync(localSupabasePaths.generatedMigrations)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.equal(generatedNames[0], localSupabasePaths.baselineMigration);
  assert.deepEqual(generatedNames.slice(1), prepared.migrationNames);

  const baselinePath = path.join(
    localSupabasePaths.generatedMigrations,
    localSupabasePaths.baselineMigration,
  );
  assert.equal(existsSync(baselinePath), true);
  assert.match(readFileSync(baselinePath, "utf8"), /create table if not exists public\.profiles/);
  assert.equal(
    existsSync(
      path.join(
        localSupabasePaths.generatedRoot,
        "supabase",
        "service-role.sql",
      ),
    ),
    true,
  );
});
