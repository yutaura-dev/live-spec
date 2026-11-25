#!/usr/bin/env node
// live-spec の正規化モデル（--json の出力）を 2 つ比べ、振る舞いの違いを Markdown で出す。
// 使い方: node diff-model.mjs <before.json> <after.json>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 状態 ID（s0, s1…）ではなくラベルで比べる理由: ID は幅優先探索で見つけた順に振られるので、
// 状態が 1 つ増えるだけで後ろの ID がずれ、何も変わっていない状態まで「変わった」ことになるため。
const labeler = (model) => {
  const labels = new Map(model.states.map((s) => [s.id, s.label]));
  return (id) => labels.get(id) ?? id;
};

const setDiff = (before, after) => ({
  added: after.filter((x) => !before.includes(x)),
  removed: before.filter((x) => !after.includes(x)),
});

const cellOf = (a, labelOf) => (a.enabled ? `✅ → ${labelOf(a.to)}` : `❌ ${a.reason ?? "エラー"}`);

const normalizeFinding = (f, labelOf) => (typeof f.state === "string" ? { ...f, state: labelOf(f.state) } : f);

// まとめた形式（outcomes / cases）を 1 件ずつに戻す。"*" は全員（登場人物 × その操作の入力の例）。
const expandAvailability = (m) =>
  m.availability.flatMap((a) => {
    if (!Array.isArray(a.outcomes)) return [a];
    const inputsOf = () => m.inputs?.[a.action] ?? [null];
    const everyone = () => (m.actors ?? []).flatMap((actor) => inputsOf().map((input) => ({ actor: actor.name, input })));
    const expand = (cases) =>
      Object.entries(cases).flatMap(([actor, inputs]) =>
        (inputs === "*" ? inputsOf() : inputs).map((input) => ({ actor, input })),
      );
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

export function diffModels(before, after) {
  const lb = labeler(before);
  const la = labeler(after);

  const transitionKeys = (m, l) => m.transitions.map((t) => `${l(t.from)} -${t.action}-> ${l(t.to)}`);

  const availabilityOf = (m, l) =>
    new Map(expandAvailability(m).map((a) => [JSON.stringify([l(a.state), a.action, a.actor, a.input]), cellOf(a, l)]));
  const ab = availabilityOf(before, lb);
  const aa = availabilityOf(after, la);
  const availability = [];
  for (const [key, cell] of aa) {
    const old = ab.get(key);
    if (old === undefined || old === cell) continue;
    const [state, action, actor, input] = JSON.parse(key);
    availability.push({ state, action, actor, input, before: old, after: cell });
  }

  const findingKeys = (m, l) => m.findings.map((f) => JSON.stringify(normalizeFinding(f, l)));
  const fd = setDiff(findingKeys(before, lb), findingKeys(after, la));

  const surfacesOf = (m, l) => new Map((m.surfaces ?? []).map((s) => [JSON.stringify([l(s.state), s.actor]), JSON.stringify(s.surface)]));
  const sb = surfacesOf(before, lb);
  const sa = surfacesOf(after, la);
  const surfaces = [];
  for (const key of new Set([...sb.keys(), ...sa.keys()])) {
    if (sb.get(key) === sa.get(key)) continue;
    const [state, actor] = JSON.parse(key);
    surfaces.push({ state, actor });
  }

  const actionNames = (m) => (m.actions ?? []).map((a) => (typeof a === "string" ? a : a.name));
  return {
    actions: setDiff(actionNames(before), actionNames(after)),
    states: setDiff(before.states.map((s) => s.label), after.states.map((s) => s.label)),
    transitions: setDiff(transitionKeys(before, lb), transitionKeys(after, la)),
    availability,
    findings: { added: fd.added.map((s) => JSON.parse(s)), removed: fd.removed.map((s) => JSON.parse(s)) },
    surfaces,
  };
}

const describeFinding = (f) => {
  const { kind, ...rest } = f;
  return `${kind}: ${Object.entries(rest)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ")}`;
};

export function renderDiff(d) {
  const empty =
    d.actions.added.length + d.actions.removed.length + d.states.added.length + d.states.removed.length + d.transitions.added.length + d.transitions.removed.length +
      d.availability.length + d.findings.added.length + d.findings.removed.length + d.surfaces.length === 0;
  if (empty) return "振る舞いの変化はありません。\n";

  const lines = ["## 振る舞いの変化", ""];
  const addRemove = (title, diff, show = (x) => x) => {
    if (diff.added.length + diff.removed.length === 0) return;
    lines.push(`### ${title}`, "", ...diff.added.map((x) => `- ＋ ${show(x)}`), ...diff.removed.map((x) => `- － ${show(x)}`), "");
  };
  addRemove("操作", d.actions);
  addRemove("状態", d.states);
  addRemove("遷移", d.transitions);
  if (d.availability.length > 0) {
    lines.push("### できる／できないの変化", "", "| 状態 | 操作 | 登場人物 | 変更前 | 変更後 |", "|---|---|---|---|---|");
    for (const a of d.availability) {
      const who = a.input === null ? a.actor : `${a.actor}（${a.input}）`;
      lines.push(`| ${a.state} | ${a.action} | ${who} | ${a.before} | ${a.after} |`);
    }
    lines.push("");
  }
  addRemove("検査結果", d.findings, describeFinding);
  if (d.surfaces.length > 0) {
    lines.push("### 画面が変わったところ", "", ...d.surfaces.map((s) => `- ${s.state}（${s.actor}）`), "");
  }
  return lines.join("\n");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (beforePath === undefined || afterPath === undefined) {
    console.error("usage: node diff-model.mjs <before.json> <after.json>");
    process.exit(2);
  }
  const read = (p) => JSON.parse(readFileSync(p, "utf8"));
  process.stdout.write(renderDiff(diffModels(read(beforePath), read(afterPath))));
}
