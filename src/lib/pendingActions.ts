const pendingActions = new Map<string, Promise<unknown>>();

export function actionKey(...parts: Array<string | number | null | undefined>) {
  return parts.map(part => String(part ?? "")).join(":");
}

export function isActionPending(key: string) {
  return pendingActions.has(key);
}

export function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const pending = pendingActions.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = task().finally(() => {
    if (pendingActions.get(key) === promise) pendingActions.delete(key);
  });
  pendingActions.set(key, promise);
  return promise;
}

export function createIdempotencyKey(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
}

export function clearPendingActionsForTest() {
  pendingActions.clear();
}
