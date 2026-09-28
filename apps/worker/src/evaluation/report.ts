import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where an evaluation run is written, and in what shape.
 *
 * **Every case is appended the moment it finishes**, as one JSON object per
 * line. A full run is 40+ model calls over tens of minutes on one 8GB card; a
 * run that only wrote its results at the end would lose all of them to a
 * crash, a timeout, or a closed laptop, and the temptation would then be to
 * report the partial run from memory.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../evaluation");

export interface CaseRecord {
  component: string;
  /** Stable across runs, so two models can be compared case by case. */
  caseId: string;
  ok: boolean;
  attempts?: number;
  durationMs?: number;
  promptVersion?: number;
  /** Why each rejected attempt was rejected — the grounding, measured. */
  rejections?: string[];
  error?: string;
  /** Whatever the component's own evaluation counted for this case. */
  metrics?: Record<string, unknown>;
  /** The output a human scores, and the answer they score it against. */
  scoring?: Record<string, unknown>;
}

export class Recorder {
  readonly dir: string;
  private readonly cases: CaseRecord[] = [];

  constructor(
    readonly model: string,
    readonly jsonMode: string,
  ) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    this.dir = resolve(ROOT, `${stamp}-${model.replace(/[:/]/g, "-")}`);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      resolve(this.dir, "run.json"),
      JSON.stringify({ model, jsonMode, startedAt: new Date().toISOString() }, null, 2),
    );
  }

  add(record: CaseRecord): void {
    this.cases.push(record);
    appendFileSync(resolve(this.dir, "cases.jsonl"), `${JSON.stringify(record)}\n`);
  }

  of(component: string): CaseRecord[] {
    return this.cases.filter((c) => c.component === component);
  }

  /** Records what Ollama reports about placement, which §13's table turns on. */
  gpu(placement: string): void {
    writeFileSync(resolve(this.dir, "ollama-ps.txt"), placement);
  }

  write(name: string, body: string): string {
    const path = resolve(this.dir, name);
    writeFileSync(path, body);
    return path;
  }
}

/** A percentage, or "—" when nothing was measured, so an empty run cannot read as 0%. */
export function rate(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${((part / whole) * 100).toFixed(0)}% (${part}/${whole})`;
}

export function ms(values: number[]): string {
  if (values.length === 0) return "—";
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return `${(mean / 1000).toFixed(1)}s`;
}
