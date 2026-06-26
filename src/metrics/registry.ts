export type MetricLabels = Record<string, string | number>;

export interface Counter {
  name: string;
  help: string;
  labelNames: string[];
  inc(labels?: MetricLabels, value?: number): void;
  get(labels?: MetricLabels): number;
  reset(): void;
}

class CounterImpl implements Counter {
  private values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: string[],
  ) {}

  private key(labels: MetricLabels = {}): string {
    return this.labelNames.map((name) => String(labels[name] ?? "")).join("|");
  }

  inc(labels: MetricLabels = {}, value = 1): void {
    const k = this.key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + value);
  }

  get(labels: MetricLabels = {}): number {
    return this.values.get(this.key(labels)) ?? 0;
  }

  reset(): void {
    this.values.clear();
  }
}

const counters = new Map<string, Counter>();

export function createCounter(name: string, labelNames: string[] = [], help = ""): Counter {
  const existing = counters.get(name);
  if (existing) {
    return existing;
  }
  const counter = new CounterImpl(name, help, labelNames);
  counters.set(name, counter);
  return counter;
}

export function getCounter(name: string): Counter | undefined {
  return counters.get(name);
}

export function resetMetrics(): void {
  for (const counter of counters.values()) {
    counter.reset();
  }
}

/** Increments once per detected gap range with `from` and `to` ledger labels. */
export const indexerGapDetectedTotal = createCounter(
  "indexer_gap_detected_total",
  ["from", "to"],
  "Total number of indexer ledger gaps detected",
);
