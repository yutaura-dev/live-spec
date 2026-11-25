import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { generateProject } from "./generate.ts";

// 正規化モデル（--json の出力）のうち、差分に使う部分だけの型。古い形式（availability を 1 件ずつ並べたもの）も受け付ける。
interface Model {
  readonly actors?: ReadonlyArray<{ readonly name: string }>;
  readonly inputs?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly actions?: ReadonlyArray<string | { readonly name: string }>;
  readonly states: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly transitions: ReadonlyArray<{ readonly from: string; readonly to: string; readonly action: string }>;
  readonly availability: ReadonlyArray<FlatAvailability | CompactAvailability>;
  readonly findings: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly surfaces?: ReadonlyArray<{ readonly state: string; readonly actor: string; readonly surface: unknown }>;
}

interface FlatAvailability {
  readonly state: string;
  readonly action: string;
  readonly actor: string;
  readonly input: string | null;
  readonly enabled: boolean;
  readonly to: string | null;
  readonly reason: string | null;
}

interface CompactAvailability {
  readonly state: string;
  readonly action: string;
  readonly outcomes: ReadonlyArray<{
    readonly enabled: boolean;
    readonly to: string | null;
    readonly reason: string | null;
    readonly cases: "*" | Readonly<Record<string, "*" | ReadonlyArray<string>>>;
  }>;
}

export interface ModelDiff {
  readonly actions: { readonly added: ReadonlyArray<string>; readonly removed: ReadonlyArray<string> };
  readonly states: { readonly added: ReadonlyArray<string>; readonly removed: ReadonlyArray<string> };
  readonly transitions: { readonly added: ReadonlyArray<string>; readonly removed: ReadonlyArray<string> };
  readonly availability: ReadonlyArray<{
    readonly state: string;
    readonly action: string;
    readonly actor: string;
    readonly input: string | null;
    readonly before: string;
    readonly after: string;
  }>;
  readonly findings: { readonly added: ReadonlyArray<unknown>; readonly removed: ReadonlyArray<unknown> };
  readonly surfaces: ReadonlyArray<{ readonly state: string; readonly actor: string }>;
}

const EMPTY: Model = { states: [], transitions: [], availability: [], findings: [], surfaces: [] };

// 状態 ID（s0, s1…）ではなくラベルで比べる理由: ID は幅優先探索で見つけた順に振られるので、
// 状態が 1 つ増えるだけで後ろの ID がずれ、何も変わっていない状態まで「変わった」ことになるため。
const labeler = (model: Model) => {
  const labels = new Map(model.states.map((s) => [s.id, s.label]));
  return (id: string | null) => (id === null ? "" : (labels.get(id) ?? id));
};

const setDiff = (before: ReadonlyArray<string>, after: ReadonlyArray<string>) => ({
  added: after.filter((x) => !before.includes(x)),
  removed: before.filter((x) => !after.includes(x)),
});

// 1 件ずつに戻してから比べる理由: まとめ方は結果の分かれ方で変わるので、まとめた形のまま比べると、
// 振る舞いが同じでも差分が出てしまうため。"*" は全員（登場人物 × その操作の入力の例）。
const expandAvailability = (m: Model): Array<FlatAvailability> =>
  m.availability.flatMap((a) => {
    if (!("outcomes" in a)) return [a];
    const inputsOf = (): ReadonlyArray<string | null> => m.inputs?.[a.action] ?? [null];
    const everyone = () => (m.actors ?? []).flatMap((actor) => inputsOf().map((input) => ({ actor: actor.name, input })));
    const expand = (cases: Readonly<Record<string, "*" | ReadonlyArray<string>>>) =>
      Object.entries(cases).flatMap(([actor, inputs]) => (inputs === "*" ? inputsOf() : inputs).map((input) => ({ actor, input })));
    return a.outcomes.flatMap((o) =>
      (o.cases === "*" ? everyone() : expand(o.cases)).map((c) => ({
        state: a.state,
        action: a.action,
        actor: c.actor,
        input: c.input,
        enabled: o.enabled,
        to: o.to,
        reason: o.reason,
      })),
    );
  });

export const diffModels = (beforeRaw: unknown, afterRaw: unknown): ModelDiff => {
  const before = beforeRaw as Model;
  const after = afterRaw as Model;
  const lb = labeler(before);
  const la = labeler(after);
  const cellOf = (a: FlatAvailability, l: (id: string | null) => string) => (a.enabled ? `✅ → ${l(a.to)}` : `❌ ${a.reason ?? "エラー"}`);

  const transitionKeys = (m: Model, l: (id: string | null) => string) => m.transitions.map((t) => `${l(t.from)} -${t.action}-> ${l(t.to)}`);
  const availabilityOf = (m: Model, l: (id: string | null) => string) =>
    new Map(expandAvailability(m).map((a) => [JSON.stringify([l(a.state), a.action, a.actor, a.input]), cellOf(a, l)]));
  const ab = availabilityOf(before, lb);
  const aa = availabilityOf(after, la);
  const availability: Array<ModelDiff["availability"][number]> = [];
  for (const [key, cell] of aa) {
    const old = ab.get(key);
    if (old === undefined || old === cell) continue;
    const [state, action, actor, input] = JSON.parse(key) as [string, string, string, string | null];
    availability.push({ state, action, actor, input, before: old, after: cell });
  }

  const findingKeys = (m: Model, l: (id: string | null) => string) =>
    m.findings.map((f) => JSON.stringify(typeof f.state === "string" ? { ...f, state: l(f.state) } : f));
  const fd = setDiff(findingKeys(before, lb), findingKeys(after, la));

  const surfacesOf = (m: Model, l: (id: string | null) => string) =>
    new Map((m.surfaces ?? []).map((s) => [JSON.stringify([l(s.state), s.actor]), JSON.stringify(s.surface)]));
  const sb = surfacesOf(before, lb);
  const sa = surfacesOf(after, la);
  const surfaces: Array<ModelDiff["surfaces"][number]> = [];
  for (const key of new Set([...sb.keys(), ...sa.keys()])) {
    if (sb.get(key) === sa.get(key)) continue;
    const [state, actor] = JSON.parse(key) as [string, string];
    surfaces.push({ state, actor });
  }

  const actionNames = (m: Model) => (m.actions ?? []).map((a) => (typeof a === "string" ? a : a.name));
  return {
    actions: setDiff(actionNames(before), actionNames(after)),
    states: setDiff(
      before.states.map((s) => s.label),
      after.states.map((s) => s.label),
    ),
    transitions: setDiff(transitionKeys(before, lb), transitionKeys(after, la)),
    availability,
    findings: { added: fd.added.map((s) => JSON.parse(s) as unknown), removed: fd.removed.map((s) => JSON.parse(s) as unknown) },
    surfaces,
  };
};

const describeFinding = (f: unknown) => {
  const { kind, ...rest } = f as Record<string, unknown>;
  return `${String(kind)}: ${Object.entries(rest)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ")}`;
};

export const renderDiff = (d: ModelDiff): string => {
  const count =
    d.actions.added.length + d.actions.removed.length + d.states.added.length + d.states.removed.length +
    d.transitions.added.length + d.transitions.removed.length + d.availability.length +
    d.findings.added.length + d.findings.removed.length + d.surfaces.length;
  if (count === 0) return "振る舞いの変化はありません。\n";

  const lines = ["## 振る舞いの変化", ""];
  const addRemove = <A>(title: string, diff: { readonly added: ReadonlyArray<A>; readonly removed: ReadonlyArray<A> }, show: (x: A) => string) => {
    if (diff.added.length + diff.removed.length === 0) return;
    lines.push(`### ${title}`, "", ...diff.added.map((x) => `- ＋ ${show(x)}`), ...diff.removed.map((x) => `- － ${show(x)}`), "");
  };
  addRemove("操作", d.actions, String);
  addRemove("状態", d.states, String);
  addRemove("遷移", d.transitions, String);
  if (d.availability.length > 0) {
    lines.push("### できる／できないの変化", "", "| 状態 | 操作 | 登場人物 | 変更前 | 変更後 |", "|---|---|---|---|---|");
    for (const a of d.availability) {
      const who = a.input === null ? a.actor : `${a.actor}（${a.input}）`;
      lines.push(`| ${a.state} | ${a.action} | ${who} | ${a.before} | ${a.after} |`);
    }
    lines.push("");
  }
  addRemove("検査結果", d.findings, describeFinding);
  if (d.surfaces.length > 0) lines.push("### 画面が変わったところ", "", ...d.surfaces.map((s) => `- ${s.state}（${s.actor}）`), "");
  return lines.join("\n");
};

const modelOf = async (path: string): Promise<Model> => {
  const out = await generateProject([path], "json");
  if (out.kind !== "text") throw new Error("1 つの spec からは 1 つの JSON が生成されるはず");
  return JSON.parse(out.content) as Model;
};

export const diffSpec = async (specPath: string, base = "HEAD"): Promise<string> => {
  const spec = resolve(specPath);
  const root = execFileSync("git", ["-C", dirname(spec), "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  let baseSource: string | undefined;
  try {
    baseSource = execFileSync("git", ["-C", root, "show", `${base}:${relative(root, spec)}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    baseSource = undefined; // base には spec がない（新しく作った spec）
  }
  let before = EMPTY;
  if (baseSource !== undefined) {
    // 元の spec と同じディレクトリに置く理由: spec が相対パスで import しているファイルを、
    // 変更前の spec からも同じように解決できるようにするため。
    const tmp = join(dirname(spec), `.${basename(spec).replace(/\.ts$/, "")}.base.ts`);
    writeFileSync(tmp, baseSource);
    try {
      before = await modelOf(tmp);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  return renderDiff(diffModels(before, await modelOf(spec)));
};
