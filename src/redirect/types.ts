export type DefaultEngine = "google" | "ddg" | "bing" | "kagi" | "brave" | "bang";

export type CompiledBang = {
  d: string;
  u: string;
  a?: string;
  x?: string;
  f?: string[];
};

export type CompiledRedirectIndex = {
  v: 1;
  s: string;
  e: DefaultEngine;
  b: string;
  bs: CompiledBang[];
  m: Record<string, number>;
};
