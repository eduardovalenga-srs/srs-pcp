import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

export interface TestDb {
  db: PGlite;
  close: () => Promise<void>;
}

/**
 * Sobe um Postgres real (PGlite/WASM) replicando o ambiente Supabase:
 *  - roles anon/authenticated/service_role
 *  - schema auth (auth.users + auth.uid())
 *  - default privileges equivalentes ao projeto Supabase
 * e aplica as migrations em ordem.
 */
export async function createTestDatabase(): Promise<TestDb> {
  const db = new PGlite();

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin noreplication bypassrls;

    create schema if not exists auth;

    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz default now()
    );

    -- Réplica da função auth.uid() do Supabase
    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Falha ao aplicar migration ${file}: ${(error as Error).message}`, { cause: error });
    }
  }

  return { db, close: () => db.close() };
}

/** Executa SQL como um usuário específico (simula JWT + RLS). */
export async function asUser(db: PGlite, role: "anon" | "authenticated", userId: string | null): Promise<void> {
  await db.exec("reset role");
  if (userId) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  } else {
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
  await db.exec(`set role ${role}`);
}

/** Volta ao superusuário (dono das tabelas). */
export async function asSuperUser(db: PGlite): Promise<void> {
  await db.exec("reset role");
}

/** Cria um usuário no auth.users (o trigger cria o profile). */
export async function createUser(
  db: PGlite,
  email: string,
  role?: "ADMIN" | "GESTOR" | "OPERADOR" | "VISUALIZADOR",
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into auth.users (id, email, raw_user_meta_data)
     values (gen_random_uuid(), $1::text, jsonb_build_object('name', $2::text))
     returning id`,
    [email, email.split("@")[0]],
  );
  const id = rows[0]?.id as string;
  if (role) {
    await db.query(`update public.profiles set role = $1 where id = $2`, [role, id]);
  }
  return id;
}
