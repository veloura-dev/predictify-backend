import { pollOnce, type CursorStore, type EventSource, type IndexedEvent } from "../src/services/indexerService";
import type { rpc } from "@stellar/stellar-sdk";

const CONTRACT_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** Build a minimal object that satisfies the bits of EventResponse the service reads. */
function fakeEvent(id: string, ledger: number): rpc.Api.EventResponse {
  const scVal = (v: string) => ({ toXDR: (_fmt: "base64") => `xdr:${v}` });
  return {
    id,
    type: "contract",
    ledger,
    ledgerClosedAt: "2024-01-01T00:00:00Z",
    pagingToken: id,
    inSuccessfulContractCall: true,
    txHash: `tx-${id}`,
    contractId: { toString: () => CONTRACT_ID },
    topic: [scVal(`topic-${id}`)],
    value: scVal(`value-${id}`),
  } as unknown as rpc.Api.EventResponse;
}

/**
 * In-memory transactional store. `commit` mutates state atomically and can be
 * configured to throw, simulating a failed transaction that must NOT advance
 * the cursor.
 */
function makeStore(initialLedger: number | null): CursorStore & {
  ledger: number | null;
  events: IndexedEvent[];
  failNextCommit: boolean;
} {
  return {
    ledger: initialLedger,
    events: [],
    failNextCommit: false,
    async loadLedger() {
      return this.ledger;
    },
    async commit(events: IndexedEvent[], newLedger: number) {
      if (this.failNextCommit) {
        // Atomic failure: neither events nor cursor change.
        throw new Error("commit failed");
      }
      this.events.push(...events);
      this.ledger = newLedger;
    },
  };
}

/** RPC stub returning the given pages in order. */
function makeRpc(pages: rpc.Api.GetEventsResponse[]): EventSource & { calls: unknown[] } {
  let i = 0;
  return {
    calls: [],
    async getEvents(request) {
      this.calls.push(request);
      const page = pages[Math.min(i, pages.length - 1)];
      i += 1;
      return page;
    },
  };
}

const page = (events: rpc.Api.EventResponse[], latestLedger: number): rpc.Api.GetEventsResponse => ({
  events,
  latestLedger,
});

describe("pollOnce", () => {
  it("starts from startLedger on the first run and advances the cursor", async () => {
    const store = makeStore(null);
    const rpcStub = makeRpc([page([fakeEvent("a", 105)], 110)]);

    const result = await pollOnce({
      rpc: rpcStub,
      store,
      contractId: CONTRACT_ID,
      startLedger: 100,
    });

    expect((rpcStub.calls[0] as { startLedger: number }).startLedger).toBe(100);
    expect(result.fromLedger).toBe(100);
    expect(result.toLedger).toBe(110);
    expect(result.eventCount).toBe(1);
    expect(store.ledger).toBe(110);
    expect(store.events.map((e) => e.id)).toEqual(["a"]);
  });

  it("resumes from lastLedger + 1 on subsequent runs", async () => {
    const store = makeStore(200);
    const rpcStub = makeRpc([page([], 205)]);

    const result = await pollOnce({ rpc: rpcStub, store, contractId: CONTRACT_ID, startLedger: 0 });

    expect((rpcStub.calls[0] as { startLedger: number }).startLedger).toBe(201);
    expect(result.fromLedger).toBe(201);
    // No events: advance to the latest observed ledger so empty ranges are skipped.
    expect(store.ledger).toBe(205);
  });

  it("normalizes event fields for persistence", async () => {
    const store = makeStore(null);
    const rpcStub = makeRpc([page([fakeEvent("a", 105)], 110)]);

    await pollOnce({ rpc: rpcStub, store, contractId: CONTRACT_ID, startLedger: 100 });

    expect(store.events[0]).toEqual({
      id: "a",
      ledger: 105,
      contractId: CONTRACT_ID,
      type: "contract",
      txHash: "tx-a",
      ledgerClosedAt: new Date("2024-01-01T00:00:00Z"),
      topic: ["xdr:topic-a"],
      value: "xdr:value-a",
    });
  });

  it("does NOT advance the cursor when the RPC call fails", async () => {
    const store = makeStore(300);
    const rpcStub: EventSource = {
      async getEvents() {
        throw new Error("rpc down");
      },
    };

    await expect(
      pollOnce({ rpc: rpcStub, store, contractId: CONTRACT_ID, startLedger: 0 }),
    ).rejects.toThrow("rpc down");
    expect(store.ledger).toBe(300);
    expect(store.events).toHaveLength(0);
  });

  it("does NOT advance the cursor past events that fail to persist", async () => {
    const store = makeStore(300);
    store.failNextCommit = true;
    const rpcStub = makeRpc([page([fakeEvent("a", 305)], 310)]);

    await expect(
      pollOnce({ rpc: rpcStub, store, contractId: CONTRACT_ID, startLedger: 0 }),
    ).rejects.toThrow("commit failed");
    // Cursor unchanged and no events committed — the failed range is retried next tick.
    expect(store.ledger).toBe(300);
    expect(store.events).toHaveLength(0);
  });

  it("pages through multiple full pages until drained", async () => {
    const store = makeStore(null);
    const full = Array.from({ length: 2 }, (_, i) => fakeEvent(`p1-${i}`, 100 + i));
    const rpcStub = makeRpc([
      page(full, 150), // full page (== pageSize) -> fetch another
      page([fakeEvent("p2-0", 120)], 150), // short page -> stop
    ]);

    const result = await pollOnce({
      rpc: rpcStub,
      store,
      contractId: CONTRACT_ID,
      startLedger: 100,
      pageSize: 2,
    });

    expect(rpcStub.calls).toHaveLength(2);
    // Second call paginates via the previous page's last pagingToken.
    expect((rpcStub.calls[1] as { cursor?: string }).cursor).toBe("p1-1");
    expect(result.eventCount).toBe(3);
    expect(store.ledger).toBe(150);
    expect(result.truncated).toBe(false);
  });

  it("stops at maxPagesPerTick and advances only to the last persisted event", async () => {
    const store = makeStore(null);
    const rpcStub = makeRpc([
      page([fakeEvent("a", 101)], 999),
      page([fakeEvent("b", 102)], 999),
    ]);

    const result = await pollOnce({
      rpc: rpcStub,
      store,
      contractId: CONTRACT_ID,
      startLedger: 100,
      pageSize: 1,
      maxPagesPerTick: 2,
    });

    expect(result.truncated).toBe(true);
    expect(result.eventCount).toBe(2);
    // Does not jump to latestLedger (999). Resumes AT the last event's ledger
    // (102) next tick, so the cursor is left at 102 - 1 = 101.
    expect(store.ledger).toBe(101);
  });
});
