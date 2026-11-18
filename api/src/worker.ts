import { createSupabaseAuthenticator } from "./auth";
import { PostgresDatabase } from "./db-postgres";
import { createApp } from "./index";

type Bindings = {
  DATABASE_URL: string;
  INVITE_HMAC_SECRET: string;
  SUPABASE_URL: string;
};

let database: { url: string; client: PostgresDatabase } | undefined;
let auth: { url: string; verify: ReturnType<typeof createSupabaseAuthenticator> } | undefined;

export default {
  fetch(request: Request, env: Bindings) {
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (!env.DATABASE_URL || !env.INVITE_HMAC_SECRET?.trim() || !env.SUPABASE_URL) {
      return Response.json({ error: { code: "configuration_error", message: "Backend configuration is incomplete" } }, { status: 500 });
    }
    if (database?.url !== env.DATABASE_URL) {
      database = { url: env.DATABASE_URL, client: new PostgresDatabase(env.DATABASE_URL, true) };
    }
    if (auth?.url !== env.SUPABASE_URL) {
      auth = { url: env.SUPABASE_URL, verify: createSupabaseAuthenticator(env.SUPABASE_URL) };
    }
    const verify = auth.verify;
    return createApp(database.client, {
      inviteSecret: env.INVITE_HMAC_SECRET,
      authenticate: (c) => verify(c.req.header("Authorization")),
    }).fetch(request);
  },
};
