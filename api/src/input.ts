export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410,
    readonly code: string,
    message: string,
    readonly latest?: object,
  ) {
    super(message);
  }
}

export function invalid(message: string): never {
  throw new ApiError(400, "validation_error", message);
}

export function notFound(): never {
  throw new ApiError(404, "not_found", "Resource not found");
}

export function normalizeUuid(value: unknown): string | undefined {
  if (typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    return value.toLowerCase();
  }
}

export function uuid(value: unknown, field: string): string {
  return normalizeUuid(value) ?? invalid(`${field} must be a UUID`);
}

export function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function integer(value: unknown, field: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    invalid(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || /[\u0000\uD800-\uDFFF]/u.test(value)) {
    invalid(`${field} must be valid text`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || [...trimmed].length > max) {
    invalid(`${field} must contain 1 to ${max} characters`);
  }
  return trimmed;
}

export function oneOf<const T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  const choice = choices.find((item) => item === value);
  return choice ?? invalid(`${field} must be one of ${choices.join(", ")}`);
}

export function todayInTokyo(): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts();
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}

export function date(value: unknown, field: string, latest?: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) {
    invalid(`${field} must be a date in YYYY-MM-DD format`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    invalid(`${field} must be a valid calendar date`);
  }
  if (latest && value > latest) invalid(`${field} cannot be in the future`);
  return value;
}
