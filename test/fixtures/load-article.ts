import { readFileSync } from "node:fs";
import { loadSpec } from "../../src/load.ts";
import * as Article from "./article.spec.ts";

export const loadArticle = () =>
  loadSpec("article", Article, { source: readFileSync(new URL("./article.spec.ts", import.meta.url), "utf8") });
