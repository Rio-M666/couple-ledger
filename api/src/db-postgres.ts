import postgres from "postgres";

import type { Database, Queryable } from "./db";

function queryable(sql: postgres.Sql | postgres.TransactionSql): Queryable {
  return {
    async query<Row>(text: string, params: unknown[] = []) {
      const rows = await sql.unsafe<Row[]>(text, params as postgres.ParameterOrJSON<never>[]);
      return { rows };
    },
  };
}

export class PostgresDatabase implements Database {
  private readonly shared: postgres.Sql;
  private queued = Promise.resolve();

  constructor(
    private readonly connectionString: string,
    private readonly workerMode = false,
    private readonly sslMode: "require" | false = "require",
  ) {
    this.shared = postgres(connectionString, {
      prepare: false,
      ...(workerMode && { ssl: sslMode }),
    });
  }

  query<Row>(text: string, params?: unknown[]) {
    return this.run((sql) => queryable(sql).query<Row>(text, params));
  }

  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.run(async (sql) => {
      const { result } = await sql.begin("isolation level read committed", async (tx) => ({
        result: await run(queryable(tx)),
      }));
      return result;
    });
  }

  private run<T>(operation: (sql: postgres.Sql) => Promise<T>): Promise<T> {
    if (!this.workerMode) return operation(this.shared);
    // Workers: a TCP socket cannot outlive the request that opened it, so each
    // operation gets a fresh client and ends it afterwards. (Ending the shared
    // client instead would brick every later operation in the isolate.)
    // Operations are serialized; Hyperdrive pools the real connections.
    const result = this.queued.then(async () => {
      const sql = postgres(this.connectionString, { prepare: false, max: 1, ssl: this.sslMode });
      try {
        return await operation(sql);
      } finally {
        await sql.end();
      }
    });
    this.queued = result.then(() => undefined, () => undefined);
    return result;
  }
}
