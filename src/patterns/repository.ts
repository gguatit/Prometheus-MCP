import { promises as fs } from "node:fs";
import path from "node:path";
import type { Pattern, TrustLevel, Domain } from "../types/index.js";
import { validatePattern } from "./validator.js";

/**
 * IPatternRepository — the pattern storage seam. MVP: FilePatternRepository
 * scans a directory of *.pattern.json. Production (roadmap): DB/vector store
 * with the same interface. Capacity (1000+) is a data concern, not code.
 *
 * The repository loads an in-memory index eagerly and lazily fetches full
 * bodies on demand (preserved by the cache).
 */

export interface PatternSummary {
  id: string;
  name: string;
  category: string;
  domain: Domain;
  trust: TrustLevel;
  version: string;
  description: string;
  requiredElementCount: number;
  ruleCount: number;
}

export interface IPatternRepository {
  load(): Promise<void>;
  list(category?: string): PatternSummary[];
  search(query: string): PatternSummary[];
  get(id: string): Promise<Pattern | undefined>;
  all(): Promise<Pattern[]>;
  byDomain(domain: Domain): PatternSummary[];
  trustFilter: (t: TrustLevel) => boolean;
}

export class FilePatternRepository implements IPatternRepository {
  private summaries = new Map<string, PatternSummary>();
  private full = new Map<string, Pattern>();
  private loadErrors: string[] = [];

  constructor(
    private readonly dir: string,
    private readonly allowCommunity: boolean = false,
  ) {}

  get trustFilter(): (t: TrustLevel) => boolean {
    return (t: TrustLevel) => t === "internal" || t === "verified" || (this.allowCommunity && t === "community");
  }

  async load(): Promise<void> {
    this.summaries.clear();
    this.full.clear();
    this.loadErrors = [];
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.dir);
    } catch {
      // no patterns dir -> empty library (not a crash)
      return;
    }
    const files = entries.filter((f) => f.endsWith(".pattern.json") && !f.includes("..") && !f.includes(path.sep));
    for (const f of files) {
      try {
        const full = path.resolve(this.dir, f);
        if (!full.startsWith(path.resolve(this.dir))) {
          this.loadErrors.push(`${f}: path traversal rejected`);
          continue;
        }
        const raw = await fs.readFile(full, "utf8");
        const p = JSON.parse(raw) as Pattern;
        const report = validatePattern(p);
        if (!report.valid) {
          this.loadErrors.push(`${f}: ${report.errors.join("; ")}`);
          continue;
        }
        this.full.set(p.id, p);
        this.summaries.set(p.id, toSummary(p));
      } catch (e) {
        this.loadErrors.push(`${f}: ${(e as Error).message}`);
      }
    }
  }

  loadErrorsList(): string[] {
    return [...this.loadErrors];
  }

  /** Browsing methods (list/search/byDomain) return ALL trust levels for discovery.
   * Use all() for internal pipeline use where trust filtering is enforced. */
  list(category?: string): PatternSummary[] {
    const all = [...this.summaries.values()];
    return category ? all.filter((s) => s.category === category) : all;
  }

  search(query: string): PatternSummary[] {
    const q = query.toLowerCase();
    return [...this.summaries.values()].filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.category.toLowerCase().includes(q),
    );
  }

  byDomain(domain: Domain): PatternSummary[] {
    return [...this.summaries.values()].filter((s) => s.domain === domain);
  }

  async get(id: string): Promise<Pattern | undefined> {
    return this.full.get(id);
  }

  async all(): Promise<Pattern[]> {
    return [...this.full.values()].filter((p) => this.trustFilter(p.provenance.trust));
  }
}

function toSummary(p: Pattern): PatternSummary {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    domain: p.domain,
    trust: p.provenance.trust,
    version: p.version,
    description: p.description,
    requiredElementCount: p.requiredElements.length,
    ruleCount: p.qualityRules.length,
  };
}
