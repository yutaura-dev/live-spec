import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { diffModels, EMPTY_MODEL, isEmptyDiff, type ModelDiff } from "./diff.ts";
import { expandSpecPaths, loadObject, specNameOf } from "./generate.ts";
import { normalize } from "./model.ts";
import type { DomainObject } from "./render/html.ts";

export interface ProjectDiffOptions {
  readonly cwd?: string;
  readonly paths: ReadonlyArray<string>;
  readonly base: string;
  /** 省くと作業ツリーと比べる */
  readonly head?: string;
}

export type ObjectStatus = "added" | "removed" | "changed" | "unchanged";

export interface ObjectDiff {
  readonly name: string;
  readonly status: ObjectStatus;
  readonly before: DomainObject | null;
  readonly after: DomainObject | null;
  readonly diff: ModelDiff;
}

export interface ProjectDiff {
  readonly base: string;
  readonly head: string;
  readonly objects: ReadonlyArray<ObjectDiff>;
}

export const WORKING_TREE = "作業ツリー";

const git = (root: string, args: ReadonlyArray<string>) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const isSpec = (path: string) => path.endsWith(".spec.ts") && !basename(path).startsWith(".");

// git のリビジョンから取り出した spec を、元の spec と同じディレクトリの一時ファイルに書いて読み込む理由:
// spec が import する live-spec を、利用者のプロジェクトの node_modules から解決させるため。
// そのため spec が相対パスで import している別ファイルは、作業ツリーの版が使われる（git から取り出さない）。
const loadAtRevision = async (root: string, rel: string, ref: string, tag: string): Promise<DomainObject> => {
  const source = git(root, ["show", `${ref}:${rel}`]);
  const target = join(root, rel);
  let created: string | null = null;
  for (let dir = dirname(target); !existsSync(dir); dir = dirname(dir)) created = dir;
  if (created !== null) mkdirSync(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `.${basename(rel).replace(/\.ts$/, "")}.live-spec-${tag}.ts`);
  writeFileSync(tmp, source);
  try {
    return await loadObject(tmp, { name: specNameOf(rel), source, evidenceLock: false });
  } finally {
    rmSync(tmp, { force: true });
    if (created !== null) rmSync(created, { recursive: true, force: true });
  }
};

export const diffProject = async (options: ProjectDiffOptions): Promise<ProjectDiff> => {
  const cwd = resolve(options.cwd ?? ".");
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  for (const ref of [options.base, options.head]) {
    if (ref === undefined) continue;
    try {
      git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    } catch {
      throw new Error(`リビジョン ${ref} が見つかりません`);
    }
  }
  // パスを git に cwd から相対で解釈させ、--full-name でリポジトリのルートからのパスを受け取る理由:
  // 自分で relative(root, path) を計算すると、macOS の /var → /private/var のようなシンボリックリンクで
  // パスがリポジトリの外に見えてしまうため。
  const listAt = (ref: string) =>
    git(cwd, ["ls-tree", "-r", "--name-only", "--full-name", ref, "--", ...options.paths])
      .split("\n")
      .filter(isSpec);
  const baseFiles = listAt(options.base);
  const headFiles =
    options.head === undefined
      ? expandSpecPaths(options.paths.map((p) => resolve(cwd, p)))
          .map((p) => relative(root, realpathSync(p)))
          .filter(isSpec)
      : listAt(options.head);

  const load = async (files: ReadonlyArray<string>, ref: string | undefined, tag: string) => {
    const objects = new Map<string, DomainObject>();
    for (const rel of files) {
      const o = ref === undefined ? await loadObject(join(root, rel), { evidenceLock: false }) : await loadAtRevision(root, rel, ref, tag);
      objects.set(o.spec.name, o);
    }
    return objects;
  };
  const before = await load(baseFiles, options.base, "base");
  const after = await load(headFiles, options.head, "head");

  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  const objects = names.map((name): ObjectDiff => {
    const b = before.get(name) ?? null;
    const a = after.get(name) ?? null;
    const diff = diffModels(b === null ? EMPTY_MODEL : normalize(b.spec, b.graph), a === null ? EMPTY_MODEL : normalize(a.spec, a.graph));
    const status: ObjectStatus = b === null ? "added" : a === null ? "removed" : isEmptyDiff(diff) ? "unchanged" : "changed";
    return { name, status, before: b, after: a, diff };
  });
  return { base: options.base, head: options.head ?? WORKING_TREE, objects };
};
