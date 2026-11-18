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
  private readonly sql: postgres.Sql;
  private queued = Promise.resolve();

  constructor(connectionString: string, private readonly workerMode = false) {
    this.sql = postgres(connectionString, {
      prepare: false,
      ...(workerMode && { ssl: "require" }),
    });
  }

  query<Row>(text: string, params?: unknown[]) {
    return this.run(() => queryable(this.sql).query<Row>(text, params));
  }

  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.run(async () => {
      const { result } = await this.sql.begin("isolation level read committed", async (sql) => ({
        result: await run(queryable(sql)),
      }));
      return result;
    });
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.workerMode) return operation();
    // A Worker can reuse this client, but each TCP socket belongs to its request.
    const result = this.queued.then(async () => {
      try {
        return await operation();
      } finally {
        await this.sql.close();
      }
    });
    this.queued = result.then(() => undefined, () => undefined);
    return result;
  }
}
