export type PortalView =
  | 'home'
  | 'calendar'
  | 'trainings'
  | 'fees'
  | 'equipment'
  | 'participants'
  | 'settings'
  | 'profile';

export type SettingsSection = 'general' | 'profile' | 'personalization';

export interface PortalRoute {
  view: PortalView;
  week: string;
  section: SettingsSection;
}

type NavigationBrowser = Pick<Window, 'location' | 'history'>;
type StorageBrowser = Pick<Window, 'location' | 'sessionStorage'>;

const views: readonly string[] = [
  'home',
  'calendar',
  'trainings',
  'fees',
  'equipment',
  'participants',
  'settings',
  'profile',
];
const sections: readonly string[] = ['general', 'profile', 'personalization'];
const returnRouteKey = 'club.portal.return-route';

// Tydzień w adresie to data poniedziałku (RRRR-MM-DD). Porównanie z
// toISOString odrzuca daty „przetaczane” przez Date, np. 2026-02-31.
function validWeek(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCDay() === 1
  );
}

// Bieżący tydzień liczony według daty w Warszawie, nie strefy urządzenia;
// (dzień + 6) % 7 to liczba dni od poniedziałku.
export function defaultPortalRoute(now = new Date()): PortalRoute {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  const monday = new Date(
    `${part('year')}-${part('month')}-${part('day')}T00:00:00Z`,
  );
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return {
    view: 'home',
    week: monday.toISOString().slice(0, 10),
    section: 'general',
  };
}

export function readPortalRoute(url: URL): PortalRoute {
  const route = defaultPortalRoute();
  const view = url.searchParams.get('view');
  const week = url.searchParams.get('week');
  const section = url.searchParams.get('section');
  if (view && views.includes(view)) route.view = view as PortalView;
  if (validWeek(week)) route.week = week;
  if (section && sections.includes(section))
    route.section = section as SettingsSection;
  if (route.view === 'profile') route.section = 'profile';
  return route;
}

// Zapisuje widok w query. week i section trafiają do adresu tylko dla
// widoków, które z nich korzystają, więc adresy pozostają krótkie.
export function writePortalRoute(
  route: PortalRoute,
  mode: 'push' | 'replace',
  browser: NavigationBrowser = window,
): void {
  const url = new URL(browser.location.href);
  url.searchParams.set('view', route.view);
  url.searchParams.delete('week');
  url.searchParams.delete('section');
  if (route.view === 'calendar') url.searchParams.set('week', route.week);
  if (route.view === 'settings' || route.view === 'profile')
    url.searchParams.set(
      'section',
      route.view === 'profile' ? 'profile' : route.section,
    );
  if (url.href === browser.location.href) return;
  browser.history[mode === 'push' ? 'pushState' : 'replaceState'](
    browser.history.state,
    '',
    url.href,
  );
}

// Sprowadza trasę do widoku dostępnego dla roli. „profile” istnieje jako
// osobny widok tylko dla konta przed aktywacją; aktywne konto trafia do
// Ustawienia → Profil.
export function allowedPortalRoute(
  route: PortalRoute,
  allowed: readonly PortalView[],
): PortalRoute {
  if (allowed.includes(route.view)) return { ...route };
  if (route.view === 'profile' && allowed.includes('settings'))
    return { ...route, view: 'settings', section: 'profile' };
  return { ...route, view: 'home' };
}

// Logowanie OAuth przeładowuje stronę, więc bieżący widok zapisujemy w
// sessionStorage i odtwarzamy po powrocie (takeRememberedPortalRoute).
// Błędy storage (np. tryb prywatny) są ignorowane.
export function rememberPortalRoute(browser: StorageBrowser = window): void {
  try {
    browser.sessionStorage.setItem(
      returnRouteKey,
      JSON.stringify(readPortalRoute(new URL(browser.location.href))),
    );
  } catch {
    return;
  }
}

export function takeRememberedPortalRoute(
  browser: Pick<Window, 'sessionStorage'> = window,
): PortalRoute | null {
  try {
    const stored = browser.sessionStorage.getItem(returnRouteKey);
    browser.sessionStorage.removeItem(returnRouteKey);
    if (!stored) return null;
    const route: unknown = JSON.parse(stored);
    if (!route || typeof route !== 'object') return null;
    const value = route as Partial<PortalRoute>;
    if (
      !views.includes(value.view ?? '') ||
      !sections.includes(value.section ?? '') ||
      !validWeek(value.week)
    )
      return null;
    return {
      view: value.view as PortalView,
      week: value.week,
      section:
        value.view === 'profile'
          ? 'profile'
          : (value.section as SettingsSection),
    };
  } catch {
    return null;
  }
}
