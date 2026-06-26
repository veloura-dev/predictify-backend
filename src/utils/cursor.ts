/**
 * Shared keyset (cursor) pagination helper.
 *
 * Keyset pagination is preferred over OFFSET/LIMIT for operator-facing listings:
 * it stays correct and fast even as rows are inserted/removed between page loads,
 * which matters for a DLQ that is actively being written to and drained.
 *
 * A cursor encodes the sort key of the last row on the previous page. Callers
 * sort by a stable, unique composite `(sortValue, id)` and ask for rows strictly
 * "after" the cursor. We expose generic encode/decode helpers plus a small
 * `paginate` utility that slices an already-sorted, already-filtered array — the
 * in-memory store uses it directly, and the drizzle store uses
 * `decodeCursor` to build its WHERE clause.
 */

export interface CursorKey {
  /** ISO timestamp (or any lexicographically-ordered string) of the sort column. */
  sortValue: string;
  /** Tie-breaker, unique per row. */
  id: string;
}

export interface Page<T> {
  data: T[];
  /** Opaque cursor to pass as `?cursor=` for the next page, or null if last page. */
  nextCursor: string | null;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Clamp a user-supplied limit into a safe range. */
export function clampLimit(raw: unknown, fallback = DEFAULT_PAGE_SIZE): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_PAGE_SIZE);
}

/** Encode a cursor key to an opaque, URL-safe string. */
export function encodeCursor(key: CursorKey): string {
  return Buffer.from(`${key.sortValue}|${key.id}`, "utf8").toString("base64url");
}

/**
 * Decode an opaque cursor. Returns null for missing/invalid cursors rather than
 * throwing, so a tampered `?cursor=` value simply starts from the first page
 * instead of 500-ing.
 */
export function decodeCursor(raw: unknown): CursorKey | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const sep = decoded.indexOf("|");
    if (sep === -1) return null;
    const sortValue = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!sortValue || !id) return null;
    return { sortValue, id };
  } catch {
    return null;
  }
}

/** True when `row` sorts strictly after `cursor` under DESC `(sortValue, id)` ordering. */
export function isAfter(cursor: CursorKey, row: CursorKey): boolean {
  if (row.sortValue !== cursor.sortValue) return row.sortValue < cursor.sortValue;
  return row.id < cursor.id;
}

/**
 * Slice an already-sorted (DESC by sortValue then id) array into one page.
 * Used by the in-memory store; the drizzle store pushes the same logic into SQL.
 */
export function paginate<T>(
  rowsSortedDesc: T[],
  toKey: (row: T) => CursorKey,
  rawCursor: unknown,
  rawLimit: unknown,
): Page<T> {
  const limit = clampLimit(rawLimit);
  const cursor = decodeCursor(rawCursor);

  const start = cursor
    ? rowsSortedDesc.findIndex((r) => isAfter(cursor, toKey(r)))
    : 0;
  const from = start === -1 ? rowsSortedDesc.length : start;

  const slice = rowsSortedDesc.slice(from, from + limit);
  const hasMore = from + limit < rowsSortedDesc.length;
  const last = slice[slice.length - 1];
  return {
    data: slice,
    nextCursor: hasMore && last ? encodeCursor(toKey(last)) : null,
  };
}
