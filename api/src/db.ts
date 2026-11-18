/** One connection, or a database capable of running a single query. */
export interface Queryable {
  query<Row>(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface Database extends Queryable {
  /** Run on one connection at READ COMMITTED, committing or rolling back as a unit. */
  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T>;
}

export function safeInteger(value: number | string | bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError("Database value exceeds the safe integer range");
  }
  return parsed;
}
