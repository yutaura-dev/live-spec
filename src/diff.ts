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
  readonly scenarios?: ReadonlyArray<{ readonly name: string; readonly passed: boolean }>;
  readonly questions?: ReadonlyArray<{ readonly ask: string }>;
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
  readonly scenarios: {
    readonly added: ReadonlyArray<string>;
    readonly removed: ReadonlyArray<string>;
    readonly changed: ReadonlyArray<{ readonly name: string; readonly before: boolean; readonly after: boolean }>;
  };
  readonly questions: { readonly added: ReadonlyArray<string>; readonly removed: ReadonlyArray<string> };
}

export const EMPTY_MODEL: Model = { states: [], transitions: [], availability: [], findings: [], surfaces: [] };

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

  // 最短の手順（path）を除いて突き合わせる理由: 違反そのものが同じでも、権限を変えると探索の順が変わり、
  // 手順に出てくる人が入れ替わることがある。それを「違反が消えて別の違反が出た」と見せると誤解を招く。
  const findingKeyOf = (f: Readonly<Record<string, unknown>>, l: (id: string | null) => string) => {
    const { path: _path, ...rest } = f;
    return JSON.stringify(typeof rest.state === "string" ? { ...rest, state: l(rest.state) } : rest);
  };
  const findingsOf = (m: Model, l: (id: string | null) => string) =>
    new Map(m.findings.map((f) => [findingKeyOf(f, l), typeof f.state === "string" ? { ...f, state: l(f.state) } : f]));
  const fb = findingsOf(before, lb);
  const fa = findingsOf(after, la);
  const fd = setDiff([...fb.keys()], [...fa.keys()]);

  const surfacesOf = (m: Model, l: (id: string | null) => string) =>
    new Map((m.surfaces ?? []).map((s) => [JSON.stringify([l(s.state), s.actor]), JSON.stringify(s.surface)]));
  const sb = surfacesOf(before, lb);
  const sa = surfacesOf(after, la);
  const surfaces: Array<ModelDiff["surfaces"][number]> = [];
  const afterLabels = new Set(after.states.map((s) => s.label));
  for (const key of new Set([...sb.keys(), ...sa.keys()])) {
    if (sb.get(key) === sa.get(key)) continue;
    const [state, actor] = JSON.parse(key) as [string, string];
    // 消えた状態の画面は出さない（状態ごと消えたことは「状態」の差分と図でわかる）。増えた状態の画面は、レビューで見たいので出す。
    if (!afterLabels.has(state)) continue;
    surfaces.push({ state, actor });
  }

  const actionNames = (m: Model) => (m.actions ?? []).map((a) => (typeof a === "string" ? a : a.name));
  const scenarioNames = (m: Model) => (m.scenarios ?? []).map((s) => s.name);
  const passedOf = (m: Model, name: string) => m.scenarios?.find((s) => s.name === name)?.passed;
  const sd = setDiff(scenarioNames(before), scenarioNames(after));
  return {
    scenarios: {
      ...sd,
      changed: scenarioNames(after)
        .filter((n) => scenarioNames(before).includes(n) && passedOf(before, n) !== passedOf(after, n))
        .map((name) => ({ name, before: passedOf(before, name) ?? false, after: passedOf(after, name) ?? false })),
    },
    questions: setDiff(
      (before.questions ?? []).map((q) => q.ask),
      (after.questions ?? []).map((q) => q.ask),
    ),
    actions: setDiff(actionNames(before), actionNames(after)),
    states: setDiff(
      before.states.map((s) => s.label),
      after.states.map((s) => s.label),
    ),
    transitions: setDiff(transitionKeys(before, lb), transitionKeys(after, la)),
    availability,
    findings: { added: fd.added.map((k) => fa.get(k) as unknown), removed: fd.removed.map((k) => fb.get(k) as unknown) },
    surfaces,
  };
};

const isStep = (v: unknown): v is { readonly action: string; readonly actor: string } =>
  typeof v === "object" && v !== null && "action" in v && "actor" in v;

export const describeFinding = (f: unknown): string => {
  const { kind, ...rest } = f as Record<string, unknown>;
  return `${String(kind)}: ${Object.entries(rest)
    .map(([k, v]) =>
      Array.isArray(v) && v.every(isStep)
        ? `${k}=${v.map((s) => `${s.action}（${s.actor}）`).join(" → ")}`
        : `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`,
    )
    .join(", ")}`;
};

type AvailabilityChange = ModelDiff["availability"][number];

export interface ReasonOnlyGroup {
  readonly action: string;
  readonly before: string;
  readonly after: string;
  readonly count: number;
  readonly cases: ReadonlyArray<AvailabilityChange>;
}

const enabledOf = (cell: string) => cell.startsWith("✅");

// できない理由の文言だけが変わったものを、操作 × 変更前 × 変更後でまとめる。権限の条件を 1 つ変えると、
// 「できない」のままの組み合わせの理由がまとめて書き換わり、本当に変わった行（できる／できないの入れ替わり）が埋もれるため。
export const groupAvailability = (changes: ReadonlyArray<AvailabilityChange>) => {
  const flipped = changes.filter((a) => enabledOf(a.before) || enabledOf(a.after));
  const groups = new Map<string, Array<AvailabilityChange>>();
  for (const a of changes.filter((x) => !enabledOf(x.before) && !enabledOf(x.after))) {
    const key = JSON.stringify([a.action, a.before, a.after]);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const reasonOnly: Array<ReasonOnlyGroup> = [...groups.values()].map((cases) => ({
    action: cases[0]!.action,
    before: cases[0]!.before,
    after: cases[0]!.after,
    count: cases.length,
    cases,
  }));
  return { flipped, reasonOnly };
};

export const whoOf = (a: AvailabilityChange): string => (a.input === null ? a.actor : `${a.actor}（${a.input}）`);

export const isEmptyDiff = (d: ModelDiff): boolean =>
  d.actions.added.length + d.actions.removed.length + d.states.added.length + d.states.removed.length +
    d.transitions.added.length + d.transitions.removed.length + d.availability.length +
    d.findings.added.length + d.findings.removed.length + d.surfaces.length +
    d.scenarios.added.length + d.scenarios.removed.length + d.scenarios.changed.length +
    d.questions.added.length + d.questions.removed.length ===
  0;

const passed = (p: boolean) => (p ? "通る" : "止まる");

// heading を外から切り替えられるようにしている理由: 1 つの spec の差分では「## 振る舞いの変化」を見出しにし、
// プロジェクト全体の差分ではドメインオブジェクトの見出しの下に節だけを並べたいため。
export const renderDiff = (d: ModelDiff, options: { readonly heading?: boolean } = {}): string => {
  if (isEmptyDiff(d)) return "振る舞いの変化はありません。\n";

  const lines = options.heading === false ? [] : ["## 振る舞いの変化", ""];
  const addRemove = <A>(title: string, diff: { readonly added: ReadonlyArray<A>; readonly removed: ReadonlyArray<A> }, show: (x: A) => string) => {
    if (diff.added.length + diff.removed.length === 0) return;
    lines.push(`### ${title}`, "", ...diff.added.map((x) => `- ＋ ${show(x)}`), ...diff.removed.map((x) => `- － ${show(x)}`), "");
  };
  addRemove("操作", d.actions, String);
  addRemove("状態", d.states, String);
  addRemove("遷移", d.transitions, String);
  const g = groupAvailability(d.availability);
  if (g.flipped.length > 0) {
    lines.push("### できる／できないの変化", "", "| 状態 | 操作 | 登場人物 | 変更前 | 変更後 |", "|---|---|---|---|---|");
    for (const a of g.flipped) lines.push(`| ${a.state} | ${a.action} | ${whoOf(a)} | ${a.before} | ${a.after} |`);
    lines.push("");
  }
  if (g.reasonOnly.length > 0) {
    lines.push("### できない理由の言い方だけが変わったもの", "", "| 操作 | 変更前 | 変更後 | 件数 |", "|---|---|---|---|");
    for (const r of g.reasonOnly) lines.push(`| ${r.action} | ${r.before} | ${r.after} | ${r.count} |`);
    lines.push("");
  }
  if (d.scenarios.added.length + d.scenarios.removed.length + d.scenarios.changed.length > 0) {
    lines.push(
      "### シナリオ",
      "",
      ...d.scenarios.added.map((n) => `- ＋ ${n}`),
      ...d.scenarios.removed.map((n) => `- － ${n}`),
      ...d.scenarios.changed.map((c) => `- ${c.name}: ${passed(c.before)} → ${passed(c.after)}`),
      "",
    );
  }
  if (d.questions.added.length + d.questions.removed.length > 0) {
    lines.push(
      "### 未決事項",
      "",
      ...d.questions.added.map((q) => `- ＋ ${q}`),
      ...d.questions.removed.map((q) => `- － ${q}（解決したか、取り下げた）`),
      "",
    );
  }
  addRemove("検査結果", d.findings, describeFinding);
  if (d.surfaces.length > 0) lines.push("### 画面が変わったところ", "", ...d.surfaces.map((s) => `- ${s.state}（${s.actor}）`), "");
  return lines.join("\n");
};
