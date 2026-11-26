import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import type { Spec } from "./load.ts";
import type { Finding } from "./model.ts";

const LOCATION = /^(.*?)(?::(\d+)(?:-(\d+))?)?$/;

interface Location {
  readonly path: string;
  readonly start: number | null;
  readonly end: number | null;
  readonly last: number;
  /** 根拠の文の中での書き方（「a.ts:2-4」「:877-879」）。行がずれたときに書き換えるのに使う */
  readonly raw: string;
}

// 1 行に並べた複数の場所を読む（「a.ts:1-2、b.ts:4」「a.ts:186、:877-879」）。補足の括弧の中に「、」や
// 「server.listen(port, ...)」のような文字列があっても場所と取り違えないよう、括弧を取り除いてから区切る。
// 2 つ目以降は、場所らしいもの（「:数字」の省略形か、/ や拡張子を含むもの）だけを読む。
export const evidenceLocations = (text: string): Array<Location> => {
  let body = text;
  for (let previous = ""; previous !== body; ) {
    previous = body;
    body = body.replace(/（[^（）]*）/g, " ").replace(/\([^()]*\)/g, " ");
  }
  const locations: Array<Location> = [];
  let currentPath: string | null = null;
  for (const [i, segment] of body.split(/[、,]/).entries()) {
    const token = segment.trim().split(/\s+/)[0] ?? "";
    const looksLikeLocation = /^:\d/.test(token) || token.includes("/") || /\.[A-Za-z][A-Za-z0-9]*(?::\d|$)/.test(token);
    if (token === "" || (i > 0 && !looksLikeLocation)) continue;
    const m = LOCATION.exec(token);
    if (m === null) continue;
    const [, rawPath, start, end] = m;
    const path: string | null = rawPath === "" ? currentPath : (rawPath ?? null);
    if (path === null) continue;
    currentPath = path;
    locations.push({
      path,
      start: start === undefined ? null : Number(start),
      end: end === undefined ? null : Number(end),
      last: Number(end ?? start ?? 0),
      raw: token,
    });
  }
  return locations;
};

const gitRoot = (dir: string): string | null => {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

// 起点の候補を順に試す理由: 既存のコードから書き起こした spec は、根拠のコードとは別の場所（別のリポジトリなど）に
// 置かれることがある。evidenceRoot を書けばそこを、書かなければ spec のある git のルート、spec の上のディレクトリを探す。
const rootsFor = (spec: Spec, specPath: string): Array<string> => {
  const specDir = dirname(resolve(specPath));
  const ancestors: Array<string> = [];
  for (let dir = specDir; ; dir = dirname(dir)) {
    ancestors.push(dir);
    if (dir === parse(dir).root) break;
  }
  if (spec.evidenceRoot !== null) return [resolve(specDir, spec.evidenceRoot)];
  const git = gitRoot(specDir);
  return git === null ? ancestors : [git, ...ancestors];
};

const lineCount = (path: string) => readFileSync(path, "utf8").replace(/\n$/, "").split("\n").length;

export const LOCK_FILE = "live-spec.evidence.lock";
const lockPathOf = (specPath: string) => join(dirname(resolve(specPath)), LOCK_FILE);

const readLock = (path: string): Record<string, string> | null => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : null);

// キーを並べて 1 行 1 件で書く理由: lock は spec と同じ PR で動くので、差分とマージの衝突を読みやすくするため。
const writeLock = (path: string, entries: Record<string, string>) => {
  const keys = Object.keys(entries).sort();
  writeFileSync(path, keys.length === 0 ? "{}\n" : `{\n${keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(entries[k])}`).join(",\n")}\n}\n`);
};

// 空白をすべて除いてからハッシュを取る理由: formatter の変更（インデントや空白）で全件が「変わった」と出るのを防ぐため。
const normalizedLines = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, ""));
const blockHash = (lines: ReadonlyArray<string>, start: number, end: number) =>
  createHash("sha256").update(lines.slice(start - 1, end).join("\n")).digest("hex").slice(0, 16);

// 行番号は無関係な変更（上に import を足す、など）でもずれるので、中身が同じなら「行がずれた」として
// 機械的に直せるようにし、中身が変わったものだけ人に見直してもらう。
const findMoved = (lines: ReadonlyArray<string>, hash: string, start: number, length: number): number | null => {
  const candidates: Array<number> = [];
  for (let p = 1; p + length - 1 <= lines.length; p++) if (blockHash(lines, p, p + length - 1) === hash) candidates.push(p);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => Math.abs(a - start) - Math.abs(b - start))[0]!;
};

const rangeText = (start: number, end: number | null) => (end === null ? `${start}` : `${start}-${end}`);
const lockKey = (spec: Spec, action: string, path: string, start: number, end: number | null) => `${spec.name} ${action} ${path}:${rangeText(start, end)}`;

// 0.4.0 は 1 行の根拠も「66-66」と書いていた。その lock を作り直さずに照合できるよう、古いキーも引く。
const recordedHash = (lock: Record<string, string>, spec: Spec, action: string, path: string, start: number, end: number | null) =>
  lock[lockKey(spec, action, path, start, end)] ?? (end === null ? lock[lockKey(spec, action, path, start, start)] : undefined);

interface ResolvedLocation extends Location {
  readonly action: string;
  readonly evidence: string;
  /** spec のソースの中で、根拠の文の直前に書かれている文字列（行番号を書き換えるときに、根拠の文を探すのに使う） */
  readonly prefix: string;
  readonly file: string | undefined;
}

export const QUESTION_EVIDENCE = "未決事項";

// note は自由な文なので、根拠のコメントと違って先頭を場所とみなさず、「path.ext:行」の形のものだけを拾う。
// 行番号のないファイル名は、文の中で触れているだけのことが多いので拾わない。
const locationsInNote = (text: string): Array<Location> =>
  [...text.matchAll(/[\w./-]+\.[A-Za-z][\w]*:(\d+)(?:-(\d+))?/g)].map((m) => ({
    path: m[0].slice(0, m[0].indexOf(":")),
    start: Number(m[1]),
    end: m[2] === undefined ? null : Number(m[2]),
    last: Number(m[2] ?? m[1]),
    raw: m[0],
  }));

const resolvedLocations = (spec: Spec, specPath: string): Array<ResolvedLocation> => {
  const roots = rootsFor(spec, specPath);
  const fileOf = (path: string) => roots.map((root) => join(root, path)).find((p) => existsSync(p));
  const fromActions = Object.entries(spec.evidence).flatMap(([action, items]) =>
    items.flatMap((evidence) => evidenceLocations(evidence).map((loc) => ({ ...loc, action, evidence, prefix: "根拠: ", file: fileOf(loc.path) }))),
  );
  const fromNotes = spec.questions.flatMap((q) =>
    q.note === undefined
      ? []
      : locationsInNote(q.note).map((loc) => ({ ...loc, action: QUESTION_EVIDENCE, evidence: q.note!, prefix: "", file: fileOf(loc.path) })),
  );
  return [...fromActions, ...fromNotes];
};

export interface CheckEvidenceOptions {
  /** false にすると lock と照合しない（差分の比較では、変更前の spec の根拠も作業ツリーのコードと比べることになるため） */
  readonly lock?: boolean;
}

export const checkEvidence = (spec: Spec, specPath: string, options: CheckEvidenceOptions = {}): Array<Finding> => {
  const lock = options.lock === false ? null : readLock(lockPathOf(specPath));
  return resolvedLocations(spec, specPath).flatMap((loc): Array<Finding> => {
    const { action, evidence, file, start, end, last, path } = loc;
    if (file === undefined) return [{ kind: "evidence-missing", action, evidence }];
    if (start === null) return [];
    const location = `${path}:${rangeText(start, end)}`;
    if (lock !== null) {
      const recorded = recordedHash(lock, spec, action, path, start, end);
      if (recorded === undefined) return [{ kind: "evidence-unlocked", action, evidence, location }];
      const lines = normalizedLines(file);
      const length = (end ?? start) - start + 1;
      if (last <= lines.length && blockHash(lines, start, end ?? start) === recorded) return [];
      const moved = findMoved(lines, recorded, start, length);
      if (moved !== null) return [{ kind: "evidence-moved", action, evidence, location, moved: rangeText(moved, end === null ? null : moved + length - 1) }];
      return [{ kind: "evidence-changed", action, evidence, location }];
    }
    const lines = lineCount(file);
    return last > lines ? [{ kind: "evidence-out-of-range", action, evidence, lines }] : [];
  });
};

export interface EvidenceUpdate {
  readonly lockPath: string;
  readonly recorded: number;
  readonly moved: number;
  readonly changed: number;
}

// 行がずれた根拠は、spec の「// 根拠:」の行番号を書き換え、中身が変わった根拠は今の中身で記録し直す
// （人が spec を見直したうえで実行する前提）。同じディレクトリのほかの spec の記録は残す。
export const updateEvidenceLock = (spec: Spec, specPath: string): EvidenceUpdate => {
  const lockPath = lockPathOf(specPath);
  const previous = readLock(lockPath) ?? {};
  const entries = Object.fromEntries(Object.entries(previous).filter(([k]) => !k.startsWith(`${spec.name} `)));
  let source = readFileSync(specPath, "utf8");
  const rewrites = new Map<string, string>();
  let recorded = 0;
  let moved = 0;
  let changed = 0;
  for (const loc of resolvedLocations(spec, specPath)) {
    if (loc.file === undefined || loc.start === null) continue;
    const lines = normalizedLines(loc.file);
    const length = (loc.end ?? loc.start) - loc.start + 1;
    let start = loc.start;
    const old = recordedHash(previous, spec, loc.action, loc.path, loc.start, loc.end);
    const current = loc.last <= lines.length ? blockHash(lines, loc.start, loc.end ?? loc.start) : null;
    if (old !== undefined && old !== current) {
      const to = findMoved(lines, old, loc.start, length);
      // spec のソースに根拠の文がそのまま見つからない（エスケープした文字列など）ときは、行番号を書き換えられないので、
      // 新しい位置で記録しない。記録すると、spec の行番号と lock がずれたままになるため。
      const written = `${loc.prefix}${loc.evidence}`;
      if (to !== null && source.includes(written)) {
        start = to;
        moved++;
        const end = loc.end === null ? null : to + length - 1;
        const raw = loc.raw.startsWith(":") ? `:${rangeText(to, end)}` : `${loc.path}:${rangeText(to, end)}`;
        const text = rewrites.get(written) ?? written;
        rewrites.set(written, text.replace(loc.raw, raw));
      } else {
        changed++;
      }
    }
    const end = loc.end === null ? null : start + length - 1;
    if (start + length - 1 > lines.length) continue;
    entries[lockKey(spec, loc.action, loc.path, start, end)] = blockHash(lines, start, start + length - 1);
    recorded++;
  }
  for (const [before, after] of rewrites) source = source.split(before).join(after);
  if (rewrites.size > 0) writeFileSync(specPath, source);
  writeLock(lockPath, entries);
  return { lockPath, recorded, moved, changed };
};
