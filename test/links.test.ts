import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateProject } from "../src/cli.ts";

const project = (orderLinks: string) => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-links-"));
  writeFileSync(
    join(dir, "order.spec.ts"),
    `/** 注文 */
export type Order = { status: "cart" | "placed" };
export const initial: Order = { status: "cart" };
export const actors = { 客: {} };
/** 注文する */
export function place(o: Order): Order { return { status: "placed" }; }
export const links = ${orderLinks};
`,
  );
  writeFileSync(
    join(dir, "payment.spec.ts"),
    `/** 支払い */
export type Payment = { status: "unpaid" | "paid" };
export const initial: Payment = { status: "unpaid" };
export const actors = { 決済代行: {} };
/** 支払いを確定する */
export function pay(p: Payment): Payment { return { status: "paid" }; }
`,
  );
  return [join(dir, "order.spec.ts"), join(dir, "payment.spec.ts")];
};
const valid = '[{ from: place, to: "payment", action: "pay", label: "注文したら支払いを確定する" }]';

describe("links: ドメインオブジェクトどうしのつながり", { timeout: 30_000 }, () => {
  it("一覧ページに、ドメインオブジェクトのつながりの図を描く", async () => {
    const out = await generateProject(project(valid), "html");
    const html = out.kind === "text" ? out.content : "";
    const overview = html.slice(html.indexOf('data-page=""'), html.indexOf('data-page="order"'));

    expect(overview).toContain('class="diagram relations"');
    expect(overview).toContain("注文したら支払いを確定する");
  });

  it("各ページに、出ていくつながりと入ってくるつながりを並べる", async () => {
    const out = await generateProject(project(valid), "html");
    const html = out.kind === "text" ? out.content : "";
    const paymentPage = html.slice(html.indexOf('data-page="payment"'));

    expect(paymentPage).toContain('href="#/order"');
    expect(paymentPage).toContain("注文したら支払いを確定する");
  });

  it("Markdown の一覧と各ページに、つながりを書く", async () => {
    const out = await generateProject(project(valid), "markdown");
    const files = out.kind === "files" ? out.files : {};

    expect(files["README.md"]).toContain("- [order](order.md) の 注文する（place） → [payment](payment.md) の 支払いを確定する（pay）: 注文したら支払いを確定する");
    expect(files["order.md"]).toContain("## つながり");
    expect(files["payment.md"]).toContain("[order](order.md) の 注文する（place）から: 注文したら支払いを確定する");
  });

  it("存在しないドメインオブジェクトや操作へのつながりを検出する", async () => {
    const out = await generateProject(project('[{ from: place, to: "paymnt", action: "pay", label: "x" }, { to: "payment", action: "refund", label: "y" }]'), "json");
    const order = out.kind === "text" ? JSON.parse(out.content).objects[0] : null;

    expect(order.findings).toContainEqual({ kind: "link-unresolved", to: "paymnt", action: "pay" });
    expect(order.findings).toContainEqual({ kind: "link-unresolved", to: "payment", action: "refund" });
  });
});
