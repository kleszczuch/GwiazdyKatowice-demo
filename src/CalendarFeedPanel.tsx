import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CalendarFeedController } from './lib/calendar-feed';
import './calendar.css';
import SwordsLoader from './SwordsLoader';
import CalendarFeedSections from './CalendarFeedSections';

export default function CalendarFeedPanel({
  client,
  language,
  suspended = false,
}: {
  client: SupabaseClient;
  language: 'pl' | 'en';
  suspended?: boolean;
}) {
  const controller = useMemo(
    () =>
      new CalendarFeedController((name, options) =>
        client.functions.invoke(name, options),
      ),
    [client],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const mounted = useRef(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open || suspended || typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    const opener = trigger.current;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      opener?.focus();
    };
  }, [open, suspended]);
  const [copy, setCopy] = useState<{ url: string; success: boolean } | null>(
    null,
  );
  useEffect(() => {
    mounted.current = true;
    void controller.start();
    return () => {
      mounted.current = false;
      controller.dispose();
    };
  }, [controller]);
  const en = language === 'en';
  const say = (pl: string, english: string) => (en ? english : pl);
  const copyUrl = async () => {
    const url = state.url;
    if (!url) return;
    let success = false;
    try {
      await navigator.clipboard.writeText(url);
      success = true;
    } catch {
      success = false;
    }
    if (mounted.current && controller.getSnapshot().url === url)
      setCopy({ url, success });
  };
  const notice = state.notice
    ? {
        created: say(
          'Utworzono prywatny kanał. Nie udostępniaj jego adresu innym osobom.',
          'Private feed created. Keep its URL private.',
        ),
        rotated: say(
          'Zmieniono adres. Stara subskrypcja przestała działać. Dodaj nowy adres do Google Calendar.',
          'URL changed. The old subscription no longer works. Add the new URL to Google Calendar.',
        ),
        revoked: say(
          'Unieważniono kanał kalendarza.',
          'Calendar feed revoked.',
        ),
        conflict: say(
          'Kanał zmienił się w innym oknie. Sprawdź status przed kolejną operacją.',
          'The feed changed in another window. Check its status before another action.',
        ),
        uncertain: say(
          'Nie udało się potwierdzić wyniku. Kanał mógł się zmienić. Sprawdź status; operacja nie zostanie ponowiona automatycznie.',
          'The result could not be confirmed. The feed may have changed. Check its status; the action will not be retried automatically.',
        ),
      }[state.notice]
    : null;

  return (
    <>
      <button
        ref={trigger}
        className="button secondary small"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {say('Synchronizuj', 'Synchronize')}
      </button>
      {open && (
        <div className="week-modal-backdrop">
          <section
            ref={dialog}
            className="week-modal calendar-feed-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Google Calendar"
            aria-busy={state.busy}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                if (!state.busy) setOpen(false);
              }
              if (event.key !== 'Tab') return;
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
                ),
              );
              const first = controls[0];
              const last = controls.at(-1);
              if (
                event.shiftKey &&
                (document.activeElement === first ||
                  document.activeElement === event.currentTarget)
              ) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="calendar-feed-dialog__heading">
              <h2>Google Calendar</h2>
              <button
                className="button secondary small"
                disabled={state.busy}
                onClick={() => setOpen(false)}
              >
                {say('Zamknij', 'Close')}
              </button>
            </div>
            <div className="calendar-sync">
              <div>
                <span>
                  {say(
                    'Dodaj subskrypcję raz; zmiany i odwołania pojawią się po odświeżeniu przez Google.',
                    'Subscribe once; changes and cancellations appear on Google’s refresh cycle.',
                  )}
                </span>
              </div>
              {state.status === 'loading' && (
                <SwordsLoader
                  language={language}
                  label={say(
                    'Sprawdzam status kanału…',
                    'Checking feed status…',
                  )}
                />
              )}
              {state.status === 'unavailable' && (
                <>
                  <p role="status">
                    {say(
                      'Status kanału jest niedostępny. Sprawdź połączenie lub wdrożenie funkcji kanału. Zarządzanie kanałem wymaga poprawnego odczytu statusu.',
                      'Feed status is unavailable. Check the connection or feed function deployment. A successful status check is required to manage the feed.',
                    )}
                  </p>
                  <button
                    className="button secondary small"
                    disabled={state.busy}
                    onClick={() => void controller.read()}
                  >
                    {say('Sprawdź status ponownie', 'Check status again')}
                  </button>
                </>
              )}
              {state.status === 'inactive' && (
                <>
                  <p>{say('Kanał nieaktywny.', 'Feed inactive.')}</p>
                  <button
                    className="button small"
                    disabled={state.busy}
                    onClick={() => void controller.mutate('create')}
                  >
                    {state.busy
                      ? say('Tworzę…', 'Creating…')
                      : say('Utwórz kanał', 'Create feed')}
                  </button>
                </>
              )}
              {state.status === 'active' && (
                <>
                  <p>{say('Kanał aktywny.', 'Feed active.')}</p>
                  {state.url && !state.busy && (
                    <>
                      <button
                        className="button secondary small"
                        onClick={() => void copyUrl()}
                      >
                        {say('Kopiuj adres kanału', 'Copy feed URL')}
                      </button>
                      <a
                        className="button small"
                        href={`https://calendar.google.com/calendar/u/0/r/settings/addbyurl?url=${encodeURIComponent(state.url)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {say('Dodaj do Google', 'Add to Google')}
                      </a>
                    </>
                  )}
                  <button
                    className="button secondary small"
                    disabled={state.busy || state.confirmRotate}
                    onClick={controller.requestRotation}
                  >
                    {say('Zmień adres kanału', 'Change feed URL')}
                  </button>
                  <button
                    className="text-button"
                    disabled={state.busy}
                    onClick={() => void controller.mutate('revoke')}
                  >
                    {say('Unieważnij kanał', 'Revoke feed')}
                  </button>
                </>
              )}
            </div>
            {state.status === 'active' && (
              <CalendarFeedSections client={client} language={language} />
            )}
            {state.status === 'active' && !state.url && !state.busy && (
              <p className="muted">
                {say(
                  'Dotychczasowa subskrypcja nadal działa. Adres był pokazany tylko podczas tworzenia i nie można go odczytać ponownie. Aby dodać kolejną subskrypcję po utracie adresu, trzeba świadomie zmienić adres kanału.',
                  'Your existing subscription still works. The URL was shown only when created and cannot be retrieved again. To add another subscription after losing the URL, you must explicitly change the feed URL.',
                )}
              </p>
            )}
            {state.confirmRotate && (
              <div
                className="notice"
                role="group"
                aria-label={say(
                  'Potwierdzenie zmiany adresu',
                  'Confirm URL change',
                )}
              >
                <p>
                  {say(
                    'Zmiana adresu przerwie dotychczasową subskrypcję Google Calendar. Po zmianie musisz dodać nowy adres w Google. Czy chcesz kontynuować?',
                    'Changing the URL will break your existing Google Calendar subscription. You must add the new URL in Google afterwards. Do you want to continue?',
                  )}
                </p>
                <button
                  className="button small"
                  onClick={() => void controller.mutate('rotate')}
                  disabled={state.busy}
                >
                  {say('Potwierdzam zmianę adresu', 'Confirm URL change')}
                </button>
                <button
                  className="text-button"
                  onClick={controller.cancelRotation}
                  disabled={state.busy}
                >
                  {say('Anuluj', 'Cancel')}
                </button>
              </div>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {state.url && copy?.url === state.url && (
              <p role="status">
                {copy.success
                  ? say('Skopiowano adres kalendarza.', 'Feed URL copied.')
                  : say(
                      'Nie udało się skopiować adresu. Spróbuj ponownie.',
                      'Could not copy the URL. Try again.',
                    )}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
