export function logNonFatalError(context: string, error: unknown): void {
  if (!import.meta.env.DEV) return;
  console.warn(`[bangs.fast] ${context}`, error);
}
