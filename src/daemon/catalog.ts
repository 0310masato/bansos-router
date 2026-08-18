import type { Logger } from "../logger";
import type { ModelDef, Upstream, UpstreamSource } from "../upstreams/types";

export interface RefreshReport {
  checked: number;
  alive: number;
  dead: number;
  degraded: string[];
}

export class RuntimeCatalog {
  private byId = new Map<string, ModelDef>();
  private readonly bySource = new Map<string, Upstream>();
  private readonly upstreams: Upstream[];

  constructor(upstreams: Upstream[], private readonly log: Logger) {
    this.upstreams = upstreams;
    for (const u of upstreams) {
      this.bySource.set(u.id, u);
      if (u.kind === "local-openai") this.bySource.set("local", u);
    }
  }

  // upstream that serves a model source (zen/kilo/llm7/local)
  upstreamBySource(source: UpstreamSource): Upstream | undefined {
    return this.bySource.get(source);
  }

  // seed the pinned registry so the daemon works before any network call
  seed(models: ModelDef[]): void {
    for (const m of models) this.byId.set(m.id, m);
  }

  get models(): ModelDef[] {
    return [...this.byId.values()];
  }

  resolve(id: string): ModelDef | undefined {
    return this.byId.get(id);
  }

  // health-check: unreachable upstream keeps last-known models;
  // a model missing from a reachable catalog is dropped
  async refresh(): Promise<RefreshReport> {
    const report: RefreshReport = { checked: 0, alive: 0, dead: 0, degraded: [] };

    for (const upstream of this.upstreams) {
      const catalog = await upstream.fetchCatalog();
      if (catalog === null) {
        report.degraded.push(upstream.id);
        this.log.warn(`upstream ${upstream.id} unreachable — keeping last-known models`);
        continue;
      }
      // TODO(M0): reconcile catalog against byId per upstream:
      //   alive = present in live catalog; drop missing; keep existing metadata
      report.checked += catalog.length;
    }

    report.alive = this.byId.size;
    this.log.info(`catalog refresh: ${report.alive} model(s) alive`);
    return report;
  }
}
