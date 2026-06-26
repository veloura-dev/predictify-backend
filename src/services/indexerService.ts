import type { rpc } from "@stellar/stellar-sdk";

/**
 * A normalized contract event ready to be persisted. Decoupled from the raw
 * `@stellar/stellar-sdk` shape so the persistence layer and tests do not depend
 * on XDR types.
 */
export interface IndexedEvent {
  id: string;
  ledger: number;
  contractId: string | null;
  type: string;
  txHash: string;
  ledgerClosedAt: Date;
  topic: string[];
  value: string;
}

/**
 * Transactional persistence boundary for the indexer. Implementations MUST
 * insert the events and advance the cursor to `newLedger` atomically — either
 * both are committed or neither is. This is what guarantees the cursor never
 * advances past events that were not persisted.
 */
export interface CursorStore {
  /** Returns the last fully-ingested ledger, or null if the indexer has never run. */
  loadLedger(): Promise<number | null>;
  /**
   * Persist `events` and set the cursor to `newLedger` in a single transaction.
   * Inserting an event whose id already exists is a no-op (idempotent).
   */
  commit(events: IndexedEvent[], newLedger: number): Promise<void>;
}

/** The slice of `rpc.Server` the indexer actually uses, so it is trivial to mock. */
export type EventSource = Pick<rpc.Server, "getEvents">;

export interface PollDeps {
  rpc: EventSource;
  store: CursorStore;
  contractId: string;
  /** Ledger to begin from on the very first run, when no cursor exists yet. */
  startLedger: number;
  /** Upper bound on RPC pages fetched per tick, to bound work and memory. */
  maxPagesPerTick?: number;
  /** Page size passed to getEvents. */
  pageSize?: number;
  logger?: { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void };
}

export interface PollResult {
  /** Ledger the cursor pointed at before this tick. */
  fromLedger: number;
  /** Ledger the cursor was advanced to (unchanged if nothing to do). */
  toLedger: number;
  /** Number of events persisted this tick. */
  eventCount: number;
  /** True when the per-tick page cap was hit and more events likely remain. */
  truncated: boolean;
}

const DEFAULT_MAX_PAGES = 10;
const DEFAULT_PAGE_SIZE = 100;

function toIndexedEvent(raw: rpc.Api.EventResponse): IndexedEvent {
  return {
    id: raw.id,
    ledger: raw.ledger,
    // `contractId` is a Contract instance; normalize to its string form.
    contractId: raw.contractId ? raw.contractId.toString() : null,
    type: raw.type,
    txHash: raw.txHash,
    ledgerClosedAt: new Date(raw.ledgerClosedAt),
    topic: raw.topic.map((t) => t.toXDR("base64")),
    value: raw.value.toXDR("base64"),
  };
}

/**
 * Perform exactly one indexing tick: read the cursor, drain matching events from
 * the Soroban RPC up to the per-tick page cap, then persist the events and
 * advance the cursor transactionally.
 *
 * Failures (RPC or persistence) propagate to the caller and leave the cursor
 * untouched, so the next tick safely retries the same range.
 */
export async function pollOnce(deps: PollDeps): Promise<PollResult> {
  const maxPages = deps.maxPagesPerTick ?? DEFAULT_MAX_PAGES;
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;

  const last = await deps.store.loadLedger();
  // First run starts at startLedger; subsequent runs resume just after the
  // last fully-ingested ledger.
  const fromLedger = last === null ? deps.startLedger : last + 1;

  const filters = [{ type: "contract" as const, contractIds: [deps.contractId] }];

  const events: IndexedEvent[] = [];
  let cursorToken: string | undefined;
  let latestLedger = last ?? deps.startLedger;
  let pages = 0;
  let truncated = false;

  // Page through getEvents. The first request anchors on `startLedger`; later
  // pages continue from the previous page's last pagingToken.
  for (;;) {
    const request = cursorToken
      ? { filters, cursor: cursorToken, limit: pageSize }
      : { startLedger: fromLedger, filters, limit: pageSize };

    const res = await deps.rpc.getEvents(request);
    latestLedger = res.latestLedger;

    for (const raw of res.events) {
      events.push(toIndexedEvent(raw));
    }

    pages += 1;

    // A short page means we have drained everything available for this range.
    if (res.events.length < pageSize) {
      break;
    }
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    cursorToken = res.events[res.events.length - 1].pagingToken;
  }

  // When truncated, resume *at* the last persisted event's ledger (not past it):
  // that ledger may hold further events beyond the page cap, so we re-scan it
  // next tick — the unique event id makes the overlapping re-fetch idempotent.
  // Otherwise we have drained everything up to latestLedger. `fromLedger - 1`
  // is the previous cursor, so the value can never move backwards.
  const newLedger = truncated
    ? Math.max(fromLedger - 1, events[events.length - 1].ledger - 1)
    : Math.max(latestLedger, fromLedger - 1);

  await deps.store.commit(events, newLedger);

  deps.logger?.info(
    { fromLedger, toLedger: newLedger, eventCount: events.length, truncated },
    "indexer tick complete",
  );

  return { fromLedger, toLedger: newLedger, eventCount: events.length, truncated };
}
