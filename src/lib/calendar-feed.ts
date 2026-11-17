export type FeedState = {
  status: 'loading' | 'unavailable' | 'inactive' | 'active';
  busy: boolean;
  revision?: string;
  url?: string;
  confirmRotate: boolean;
  notice?: 'created' | 'rotated' | 'revoked' | 'conflict' | 'uncertain';
};

type Action = 'create' | 'rotate' | 'revoke';
export type FeedInvoke = (
  name: string,
  options: {
    method: 'GET' | 'PUT';
    body?: { action: Action; revision?: string };
    signal: AbortSignal;
  },
) => Promise<{ data: unknown; error: unknown }>;

class FeedError extends Error {
  readonly conflict: boolean;

  constructor(conflict = false) {
    super('Calendar feed unavailable');
    this.conflict = conflict;
  }
}

const parseStatus = (data: unknown) => {
  if (!data || typeof data !== 'object') throw new FeedError();
  const value = data as Record<string, unknown>;
  if (
    value.protocol !== 2 ||
    typeof value.active !== 'boolean' ||
    (value.active && (typeof value.revision !== 'string' || !value.revision))
  )
    throw new FeedError();
  return value;
};

// Stan subskrypcji kalendarza (iCalendar) poza Reactem, podłączany przez
// useSyncExternalStore. `generation` unieważnia odpowiedzi, które wróciły
// po nowszej operacji lub po dispose().
export class CalendarFeedController {
  private state: FeedState = {
    status: 'loading',
    busy: false,
    confirmRotate: false,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private request?: AbortController;
  private invoke: FeedInvoke;
  private timeoutMs: number;

  constructor(invoke: FeedInvoke, timeoutMs = 15_000) {
    this.invoke = invoke;
    this.timeoutMs = timeoutMs;
  }

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(state: FeedState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  start = () => {
    this.disposed = false;
    return this.read();
  };

  dispose = () => {
    this.disposed = true;
    this.generation += 1;
    this.request?.abort();
    this.state = { status: 'loading', busy: false, confirmRotate: false };
  };

  // Wywołuje funkcję Edge z limitem czasu. Promise.race z `aborted` kończy
  // oczekiwanie także wtedy, gdy klient zignoruje sygnał przerwania.
  private async send(action?: Action, revision?: string) {
    const request = new AbortController();
    this.request = request;
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new FeedError());
      request.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    const timeout = setTimeout(() => request.abort(), this.timeoutMs);
    try {
      const { data, error } = await Promise.race([
        this.invoke('calendar-feed-token', {
          method: action ? 'PUT' : 'GET',
          ...(action
            ? { body: { action, ...(revision ? { revision } : {}) } }
            : {}),
          signal: request.signal,
        }),
        aborted,
      ]);
      if (error) {
        const context =
          typeof error === 'object' && error !== null && 'context' in error
            ? error.context
            : null;
        throw new FeedError(
          context instanceof Response && context.status === 409,
        );
      }
      return parseStatus(data);
    } finally {
      clearTimeout(timeout);
      if (rejectAbort) request.signal.removeEventListener('abort', rejectAbort);
      if (this.request === request) this.request = undefined;
    }
  }

  read = async () => {
    if (this.disposed || this.state.busy) return;
    const generation = ++this.generation;
    this.update({ status: 'loading', busy: true, confirmRotate: false });
    try {
      const result = await this.send();
      if (this.disposed || generation !== this.generation) return;
      this.update({
        status: result.active ? 'active' : 'inactive',
        revision: result.active ? (result.revision as string) : undefined,
        busy: false,
        confirmRotate: false,
      });
    } catch {
      if (this.disposed || generation !== this.generation) return;
      this.update({ status: 'unavailable', busy: false, confirmRotate: false });
    }
  };

  requestRotation = () => {
    if (this.disposed || this.state.status !== 'active' || this.state.busy)
      return;
    this.update({ ...this.state, confirmRotate: true });
  };

  cancelRotation = () => {
    if (this.disposed || this.state.busy) return;
    this.update({ ...this.state, confirmRotate: false });
  };

  mutate = async (action: Action) => {
    const current = this.state;
    if (
      this.disposed ||
      current.busy ||
      (action === 'create'
        ? current.status !== 'inactive'
        : current.status !== 'active') ||
      (action === 'rotate' && !current.confirmRotate)
    )
      return;
    const generation = ++this.generation;
    this.update({
      ...current,
      busy: true,
      url: undefined,
      confirmRotate: false,
      notice: undefined,
    });
    try {
      const result = await this.send(
        action,
        action === 'create' ? undefined : current.revision,
      );
      if (action === 'revoke') {
        if (result.active !== false) throw new FeedError();
      } else {
        if (result.active !== true || typeof result.url !== 'string')
          throw new FeedError();
        // Adres subskrypcji zawiera tajny token: przyjmujemy tylko HTTPS (albo
        // lokalny HTTP przy developmencie) i tylko z niepustym tokenem.
        const url = new URL(result.url);
        const localHttp =
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (
          (url.protocol !== 'https:' && !localHttp) ||
          !url.searchParams.get('token')
        )
          throw new FeedError();
      }
      if (this.disposed || generation !== this.generation) return;
      this.update({
        status: action === 'revoke' ? 'inactive' : 'active',
        busy: false,
        confirmRotate: false,
        revision: action === 'revoke' ? undefined : (result.revision as string),
        url: action === 'revoke' ? undefined : (result.url as string),
        notice:
          action === 'create'
            ? 'created'
            : action === 'rotate'
              ? 'rotated'
              : 'revoked',
      });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.update({
        status: 'unavailable',
        busy: false,
        confirmRotate: false,
        notice:
          error instanceof FeedError && error.conflict
            ? 'conflict'
            : 'uncertain',
      });
    }
  };
}
