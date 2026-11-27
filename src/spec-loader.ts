import { registerHooks } from "node:module";

// ファイル名に .spec. を含む .ts。差分やミューテーションで書き出す一時ファイル（.order.spec.live-spec-base.ts など）も含む。
export const isSpecModuleUrl = (url: string): boolean => {
  if (!url.startsWith("file:")) return false;
  const path = new URL(url).pathname;
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.endsWith(".ts") && base.includes(".spec.");
};

let registered = false;

// spec を TypeScript の ES module として読むよう Node に伝える。
// 伝えないと、package.json に "type": "module" がないプロジェクト（pnpm workspace のルートなど）では、
// Node が CommonJS として読もうとして失敗し、spec ごとに MODULE_TYPELESS_PACKAGE_JSON の警告を出す。
// 利用者に package.json を足してもらう回避策にしない理由: ルートに "type" を足すと、既存の CommonJS の設定ファイルを壊しうる。
export const registerSpecLoader = (): void => {
  if (registered) return;
  registered = true;
  registerHooks({
    load(url, context, nextLoad) {
      return nextLoad(url, isSpecModuleUrl(url) ? { ...context, format: "module-typescript" } : context);
    },
  });
};
