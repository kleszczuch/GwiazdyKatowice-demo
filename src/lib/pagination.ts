import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoachTrainingBooking } from '../types/club';

export interface PageError {
  message: string;
  code?: string;
}
export interface PageResult<T> {
  data: T[] | null;
  error: PageError | null;
}
// Czyta całą listę stronami po 250 wierszy, aż serwer zwróci pustą stronę.
// - isCurrent: gdy zwróci false, odczyt jest porzucany i kończy się błędem
//   „superseded” zamiast częściowej listy (komponent zdążył się odmontować
//   albo ruszyło nowsze odświeżenie).
// - key: wykrywa ten sam wiersz na dwóch stronach. Zdarza się to, gdy dane
//   zmienią się między żądaniami; wtedy lepiej zgłosić błąd niż pokazać
//   listę z duplikatami lub lukami.
// Funkcja nigdy nie rzuca wyjątku: wynik to { data, error }.
export async function readAllPages<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: unknown;
  }>,
  isCurrent: () => boolean = () => true,
  key?: (row: T) => string,
): Promise<PageResult<T>> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let offset = 0;
  try {
    while (isCurrent()) {
      const result = await page(offset, offset + 249);
      if (!isCurrent()) break;
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) throw new Error('Invalid list response');
      if (!result.data.length) return { data: rows, error: null };
      if (key) {
        for (const row of result.data) {
          const identity = key(row);
          if (seen.has(identity)) throw new Error('Overlapping list pages');
          seen.add(identity);
        }
      }
      rows.push(...result.data);
      offset += result.data.length;
    }
    throw new Error('List read superseded');
  } catch (error) {
    const value = error as { message?: unknown; code?: unknown } | null;
    return {
      data: null,
      error: {
        message:
          typeof value?.message === 'string'
            ? value.message
            : 'List read failed',
        ...(typeof value?.code === 'string' ? { code: value.code } : {}),
      },
    };
  }
}

// Odczyt treningów z kolumną icon. Jeśli baza jej jeszcze nie ma (42703 z
// Postgresa lub PGRST204 z PostgREST), odczyt jest powtarzany bez niej,
// a iconAvailable=false pozwala ukryć wybór ikonki w interfejsie.
export async function readTrainingPages<T>(
  page: (
    from: number,
    to: number,
    includeIcon: boolean,
  ) => PromiseLike<{
    data: T[] | null;
    error: unknown;
  }>,
  isCurrent: () => boolean,
  key: (row: T) => string,
): Promise<PageResult<T> & { iconAvailable: boolean }> {
  const result = await readAllPages(
    (from, to) => page(from, to, true),
    isCurrent,
    key,
  );
  if (
    isCurrent() &&
    (result.error?.code === '42703' || result.error?.code === 'PGRST204') &&
    /\bicon\b/i.test(result.error.message)
  ) {
    const legacy = await readAllPages(
      (from, to) => page(from, to, false),
      isCurrent,
      key,
    );
    return { ...legacy, iconAvailable: false };
  }
  return { ...result, iconAvailable: true };
}

// To samo dla funkcji RPC, których wynik nie ma typu tablicy; odpowiedź
// inna niż tablica jest traktowana jako błąd.
export function readRpcPages<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown; error: unknown }>,
  isCurrent: () => boolean = () => true,
  key?: (row: T) => string,
): Promise<PageResult<T>> {
  return readAllPages<T>(
    async (from, to) => {
      const result = await page(from, to);
      return {
        data: Array.isArray(result.data) ? (result.data as T[]) : null,
        error: result.error,
      };
    },
    isCurrent,
    key,
  );
}

// Identyfikatory treningów idą w paczkach po 500, żeby tablica parametrów
// RPC nie rosła bez ograniczeń.
export async function readCoachBookings(
  client: SupabaseClient,
  trainingIds: string[],
  isCurrent: () => boolean = () => true,
): Promise<PageResult<CoachTrainingBooking>> {
  const rows: CoachTrainingBooking[] = [];
  for (let offset = 0; offset < trainingIds.length; offset += 500) {
    if (!isCurrent())
      return { data: null, error: { message: 'List read superseded' } };
    const ids = trainingIds.slice(offset, offset + 500);
    const result = await readRpcPages<CoachTrainingBooking>(
      (from, to) =>
        client
          .rpc('get_training_coach_bookings', { p_training_ids: ids })
          .range(from, to),
      isCurrent,
    );
    if (result.error) return result;
    rows.push(...(result.data ?? []));
  }
  return isCurrent()
    ? { data: rows, error: null }
    : { data: null, error: { message: 'List read superseded' } };
}

// Zwraca chwilę (ISO, UTC), w której w Warszawie zaczyna się podany dzień.
// Przesunięcie strefy zależy od daty (czas letni/zimowy), więc zaczynamy od
// północy UTC i korygujemy o różnicę między czasem lokalnym a docelowym;
// trzy przebiegi wystarczają także w dniu zmiany czasu.
export function warsawMidnight(date: string): string {
  const target = Date.parse(`${date}T00:00:00Z`);
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '';
    const local = Date.parse(
      `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`,
    );
    instant += target - local;
  }
  return new Date(instant).toISOString();
}
