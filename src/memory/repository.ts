import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  Id,
  Session,
  MemoryRecord,
  MemoryKind,
  Effectiveness,
  QualityTrendReport,
  QualityTrendPoint,
  Domain,
  DimensionScores,
} from "../types/index.js";
import { newId } from "../infrastructure/telemetry.js";

/**
 * Repository interfaces for the memory seam. MVP: file-backed JSON. Production
 * (roadmap): Postgres (history) + pgvector (memory) — same interfaces.
 *
 * History = intra-session timeline (append-only per session).
 * Memory = cross-session durable observations with effectiveness stats.
 */

export interface IHistoryRepository {
  save(session: Session): Promise<void>;
  get(id: Id): Promise<Session | undefined>;
  recent(limit: number): Promise<Session[]>;
  search(query: string, limit: number): Promise<Session[]>;
}

export interface IMemoryRepository {
  record(m: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt" | "effectiveness"> & {
    effectiveness?: Effectiveness;
  }): Promise<MemoryRecord>;
  get(id: Id): Promise<MemoryRecord | undefined>;
  byKey(kind: MemoryKind, key: string): Promise<MemoryRecord | undefined>;
  list(kind?: MemoryKind): Promise<MemoryRecord[]>;
  updateEffectiveness(id: Id, eff: Effectiveness): Promise<void>;
  effectivenessFor(kind: MemoryKind, key: string): Effectiveness | undefined;
}

export interface IAnalyticsRepository {
  recordSession(session: Session): Promise<void>;
  qualityTrends(since: Date, domain?: Domain): Promise<QualityTrendReport>;
  topPatterns(limit: number): Promise<{ patternId: string; uses: number; avgUplift: number }[]>;
}

// ---------------------------------------------------------------------------
// File-backed implementations
// ---------------------------------------------------------------------------

export class FileHistoryRepository implements IHistoryRepository {
  constructor(private readonly dir: string) {}

  private file(id: Id): string {
    return path.join(this.dir, `${id}.session.json`);
  }

  async save(session: Session): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(session.id), JSON.stringify(session, null, 2), "utf8");
  }

  async get(id: Id): Promise<Session | undefined> {
    try {
      const raw = await fs.readFile(this.file(id), "utf8");
      return JSON.parse(raw) as Session;
    } catch {
      return undefined;
    }
  }

  async recent(limit: number): Promise<Session[]> {
    const sessions = await this.loadAll();
    sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return sessions.slice(0, limit);
  }

  async search(query: string, limit: number): Promise<Session[]> {
    const q = query.toLowerCase();
    const sessions = await this.loadAll();
    const matched = sessions.filter(
      (s) => s.id.toLowerCase().includes(q) || s.patternIds.some((p) => p.includes(q)),
    );
    matched.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return matched.slice(0, limit);
  }

  private async loadAll(): Promise<Session[]> {
    try {
      const entries = await fs.readdir(this.dir);
      const out: Session[] = [];
      for (const f of entries.filter((e) => e.endsWith(".session.json"))) {
        try {
          const raw = await fs.readFile(path.join(this.dir, f), "utf8");
          out.push(JSON.parse(raw) as Session);
        } catch {
          // skip corrupt file
        }
      }
      return out;
    } catch {
      return [];
    }
  }
}

export class FileMemoryRepository implements IMemoryRepository {
  private readonly index = new Map<string, MemoryRecord>();

  constructor(private readonly dir: string) {}

  async load(): Promise<void> {
    this.index.clear();
    try {
      const entries = await fs.readdir(this.dir);
      for (const f of entries.filter((e) => e.endsWith(".memory.json"))) {
        try {
          const raw = await fs.readFile(path.join(this.dir, f), "utf8");
          const rec = JSON.parse(raw) as MemoryRecord;
          this.index.set(rec.id, rec);
        } catch {
          // skip
        }
      }
    } catch {
      // no dir yet
    }
  }

  async record(m: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt" | "effectiveness"> & {
    effectiveness?: Effectiveness;
  }): Promise<MemoryRecord> {
    const now = new Date().toISOString();
    const rec: MemoryRecord = {
      id: newId("mem"),
      kind: m.kind,
      patternCategory: m.patternCategory,
      key: m.key,
      value: m.value,
      effectiveness: m.effectiveness ?? { attempts: 0, successes: 0, avgUplift: 0 },
      createdAt: now,
      updatedAt: now,
    };
    this.index.set(rec.id, rec);
    await this.persist(rec);
    return rec;
  }

  async get(id: Id): Promise<MemoryRecord | undefined> {
    return this.index.get(id);
  }

  async byKey(kind: MemoryKind, key: string): Promise<MemoryRecord | undefined> {
    for (const r of this.index.values()) {
      if (r.kind === kind && r.key === key) return r;
    }
    return undefined;
  }

  async list(kind?: MemoryKind): Promise<MemoryRecord[]> {
    const all = [...this.index.values()];
    return kind ? all.filter((r) => r.kind === kind) : all;
  }

  async updateEffectiveness(id: Id, eff: Effectiveness): Promise<void> {
    const rec = this.index.get(id);
    if (!rec) return;
    rec.effectiveness = eff;
    rec.updatedAt = new Date().toISOString();
    await this.persist(rec);
  }

  effectivenessFor(kind: MemoryKind, key: string): Effectiveness | undefined {
    for (const r of this.index.values()) {
      if (r.kind === kind && r.key === key) return r.effectiveness;
    }
    return undefined;
  }

  private async persist(rec: MemoryRecord): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, `${rec.id}.memory.json`), JSON.stringify(rec, null, 2), "utf8");
  }
}

/**
 * In-memory analytics computed from the history repository. Production roadmap:
 * materialized into a warehouse; the interface stays.
 */
export class AnalyticsService implements IAnalyticsRepository {
  constructor(private readonly history: IHistoryRepository) {}

  async recordSession(session: Session): Promise<void> {
    // history.save is the source of truth; analytics reads from it on demand.
    // (kept in interface for future pre-computation / event emit)
    void session;
  }

  async qualityTrends(since: Date, domain?: Domain): Promise<QualityTrendReport> {
    const sessions = await this.history.recent(1000);
    const filtered = sessions.filter(
      (s) => s.startedAt >= since.toISOString() && (domain === undefined || true) && s.finalScore !== undefined,
    );
    const byBucket = new Map<string, Session[]>();
    for (const s of filtered) {
      const bucket = s.startedAt.slice(0, 10); // day bucket
      const key = `${bucket}|${s.briefId}`;
      const arr = byBucket.get(key) ?? [];
      arr.push(s);
      byBucket.set(key, arr);
    }

    const points: QualityTrendPoint[] = [];
    for (const [key, group] of byBucket) {
      const bucket = key.split("|")[0] ?? key;
      const scores = group.map((g) => g.finalScore ?? 0);
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const dimSums: Partial<DimensionScores> = {};
      for (const g of group) {
        for (const it of g.iterations) {
          if (!it.critique) continue;
          for (const [d, v] of Object.entries(it.critique.dimensionScores)) {
            dimSums[d as keyof DimensionScores] = ((dimSums[d as keyof DimensionScores] ?? 0) + v) as number;
          }
        }
      }
      points.push({
        bucket,
        domain: (domain ?? "creative-coding") as Domain,
        avgAggregateScore: avg,
        avgDimensionScores: dimSums,
        sessionCount: group.length,
      });
    }
    points.sort((a, b) => a.bucket.localeCompare(b.bucket));

    return {
      generatedAt: new Date().toISOString(),
      since: since.toISOString(),
      points,
      topPatterns: await this.topPatterns(5),
    };
  }

  async topPatterns(limit: number): Promise<{ patternId: string; uses: number; avgUplift: number }[]> {
    const sessions = await this.history.recent(1000);
    const agg = new Map<string, { uses: number; upliftSum: number }>();
    for (const s of sessions) {
      for (const pid of s.patternIds) {
        const a = agg.get(pid) ?? { uses: 0, upliftSum: 0 };
        a.uses += 1;
        if (s.finalScore !== undefined && s.iterations.length > 0) {
          const first = s.iterations[0]!.critique?.aggregateScore ?? 0;
          a.upliftSum += s.finalScore - first;
        }
        agg.set(pid, a);
      }
    }
    return [...agg.entries()]
      .map(([patternId, a]) => ({ patternId, uses: a.uses, avgUplift: a.uses > 0 ? a.upliftSum / a.uses : 0 }))
      .sort((a, b) => b.uses - a.uses)
      .slice(0, limit);
  }
}
