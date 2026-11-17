import { useEffect, useState } from 'react';
import {
  allowedPortalRoute,
  defaultPortalRoute,
  readPortalRoute,
  writePortalRoute,
} from './portal-navigation';
import type { PortalRoute, PortalView } from './portal-navigation';

const browser = () =>
  typeof window !== 'undefined' && window.location?.href && window.history
    ? window
    : undefined;
const currentRoute = () => {
  const target = browser();
  return target
    ? readPortalRoute(new URL(target.location.href))
    : defaultPortalRoute();
};

// Trzyma trasę portalu w adresie URL. `enabled` jest false do czasu
// potwierdzenia uprawnień, żeby adres nie został przepisany na „home”,
// zanim wiadomo, które widoki są dozwolone.
export function usePortalNavigation(
  allowed: readonly PortalView[],
  enabled = true,
) {
  const [route, setRoute] = useState(currentRoute);
  // Tablica `allowed` jest tworzona przy każdym renderze; efekt zależy od jej
  // tekstowej postaci, żeby nie uruchamiał się bez potrzeby.
  const allowedKey = allowed.join(',');
  useEffect(() => {
    if (!enabled) return;
    const permitted = allowedKey.split(',') as PortalView[];
    const target = browser();
    const restore = () => {
      const next = allowedPortalRoute(currentRoute(), permitted);
      if (target) writePortalRoute(next, 'replace', target);
      setRoute((previous) =>
        previous.view === next.view &&
        previous.week === next.week &&
        previous.section === next.section
          ? previous
          : next,
      );
    };
    if (target) restore();
    target?.addEventListener('popstate', restore);
    return () => target?.removeEventListener('popstate', restore);
  }, [allowedKey, enabled]);
  const navigate = (change: Partial<PortalRoute>) => {
    const next = allowedPortalRoute({ ...route, ...change }, allowed);
    const target = browser();
    if (target) writePortalRoute(next, 'push', target);
    setRoute(next);
  };
  return {
    route: enabled ? allowedPortalRoute(route, allowed) : route,
    navigate,
  };
}
