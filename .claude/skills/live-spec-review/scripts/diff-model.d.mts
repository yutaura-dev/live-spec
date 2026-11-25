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

export declare function diffModels(before: unknown, after: unknown): ModelDiff;
export declare function renderDiff(diff: ModelDiff): string;
