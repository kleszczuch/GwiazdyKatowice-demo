import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Plus } from './placeholderIcons';
import SwordsLoader from './SwordsLoader';

export default function ClubInvitationsPanel({
  client,
  language,
  canRotate,
}: {
  client: SupabaseClient;
  language: 'pl' | 'en';
  canRotate: boolean;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  const mutating = useRef(false);
  const revision = useRef(0);
  const en = language === 'en';
  const read = useCallback(
    async (force = false) => {
      if (!mounted.current || (mutating.current && !force)) return;
      const request = ++revision.current;
      try {
        const { data, error } = await client.rpc('get_club_invitation');
        if (
          error ||
          !data ||
          !(
            (data.code === null && data.code_hash === null) ||
            (typeof data.code === 'string' &&
              /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(data.code) &&
              typeof data.code_hash === 'string' &&
              /^[a-f0-9]{64}$/.test(data.code_hash))
          )
        )
          throw new Error('Invalid club code response');
        if (mounted.current && request === revision.current) {
          setCode(data.code);
          setFailed(false);
        }
      } catch {
        if (mounted.current && request === revision.current) {
          setCode(null);
          setFailed(true);
        }
      } finally {
        if (mounted.current && request === revision.current) setLoading(false);
      }
    },
    [client],
  );
  useEffect(() => {
    mounted.current = true;
    const requestRevision = revision;
    const refresh = () => {
      void read();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    // Ukryta karta nie odpytuje serwera; powrót do niej odświeża kod (visible).
    const interval = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      ++requestRevision.current;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [read]);
  const rotate = async () => {
    if (!canRotate || loading || mutating.current || !mounted.current) return;
    if (
      !window.confirm(
        en
          ? 'Do you want to generate a new club code?'
          : 'Czy chcesz wygenerować nowy kod klubu?',
      )
    )
      return;
    if (
      !window.confirm(
        en
          ? 'Confirm generating a new code. The previous code will stop working immediately. Current members will keep their access.'
          : 'Potwierdź wygenerowanie nowego kodu. Poprzedni kod natychmiast przestanie działać. Obecni klubowicze zachowają dostęp.',
      )
    )
      return;
    mutating.current = true;
    ++revision.current;
    setBusy(true);
    setCode(null);
    setLoading(true);
    setFailed(false);
    try {
      const { error } = await client.rpc('rotate_club_invitation');
      if (error) throw error;
      await read(true);
    } catch {
      if (mounted.current) {
        setCode(null);
        setFailed(true);
      }
    } finally {
      mutating.current = false;
      if (mounted.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  };
  return (
    <section className="settings-content club-invitation">
      <h3>{en ? 'Club code' : 'Kod klubu'}</h3>
      <p className="muted">
        {en
          ? 'Share this code with new members. An administrator approves their access.'
          : 'Udostępnij kod nowym członkom. Ich dostęp zatwierdza administrator.'}
      </p>
      {loading && (
        <SwordsLoader
          language={language}
          label={en ? 'Loading code…' : 'Wczytuję kod…'}
        />
      )}
      <div className="club-invitation__actions">
        {code && (
          <output
            className="club-invitation__code"
            aria-label={en ? 'Club code' : 'Kod klubu'}
          >
            <strong>{code}</strong>
          </output>
        )}
        {canRotate && (
          <button
            className="button"
            disabled={busy || loading}
            onClick={() => void rotate()}
          >
            <Plus size={16} />
            {en ? 'Generate new code' : 'Wygeneruj nowy kod'}
          </button>
        )}
      </div>
      {!loading && !failed && !code && (
        <p>
          {en
            ? 'An administrator has not generated a club code yet.'
            : 'Administrator nie wygenerował jeszcze kodu klubu.'}
        </p>
      )}
      {failed && (
        <p role="alert" className="notice">
          {en
            ? 'Could not load the current club code. Try again.'
            : 'Nie udało się wczytać aktualnego kodu klubu. Spróbuj ponownie.'}
        </p>
      )}
      {failed && (
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() => void read()}
        >
          {en ? 'Try again' : 'Ponów'}
        </button>
      )}
      {canRotate && (
        <>
          <p className="muted">
            {en
              ? 'The new code also appears for coaches. The previous code stops working; current members keep access.'
              : 'Nowy kod pojawi się również trenerom. Poprzedni przestanie działać; obecni klubowicze zachowają dostęp.'}
          </p>
        </>
      )}
    </section>
  );
}
