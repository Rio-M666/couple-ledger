import { createSupabaseAuthenticator } from "./auth";
import { PostgresDatabase } from "./db-postgres";
import { createApp } from "./index";

type Bindings = {
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
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

    const dbUrl = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (!dbUrl || !env.INVITE_HMAC_SECRET?.trim() || !env.SUPABASE_URL) {
      return Response.json({ error: { code: "configuration_error", message: "Backend configuration is incomplete" } }, { status: 500 });
    }
    if (database?.url !== dbUrl) {
      // Hyperdrive terminates TLS to the origin itself; the Worker-to-Hyperdrive
      // leg is internal, so the driver must not negotiate TLS with it.
      database = { url: dbUrl, client: new PostgresDatabase(dbUrl, true, env.HYPERDRIVE ? false : "require") };
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
