import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import SwordsLoader from './SwordsLoader';

type SectionRequest = {
  id: string;
  participant_id: string;
  participant_name: string;
  section_names: string[];
  submitted_at: string;
};
export default function SectionRequestsPanel({
  client,
  participantId,
  language,
  onChanged,
}: {
  client: SupabaseClient;
  participantId: string;
  language: 'pl' | 'en';
  onChanged: () => Promise<void>;
}) {
  const en = language === 'en';
  const [items, setItems] = useState<SectionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const revision = useRef(0);
  const mutation = useRef(false);
  const load = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    setError(false);
    try {
      const { data, error: failure } = await client.rpc(
        'list_section_requests',
      );
      if (failure || !Array.isArray(data)) throw failure;
      if (request !== revision.current) return false;
      setItems(
        data.filter(
          (item: SectionRequest) => item.participant_id === participantId,
        ),
      );
      return true;
    } catch {
      if (request === revision.current) {
        setItems([]);
        setError(true);
      }
      return false;
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [client, participantId]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return load();
    });
    const generation = revision;
    return () => {
      active = false;
      ++generation.current;
    };
  }, [load]);
  const review = async (id: string, approve: boolean) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setMessage('');
    let saved = false;
    try {
      const { data, error: failure } = await client.rpc(
        'review_section_request',
        { p_request_id: id, p_approve: approve },
      );
      if (failure || data !== true) throw failure;
      saved = true;
      const [loaded] = await Promise.all([load(), onChanged()]);
      if (!loaded) throw new Error('Refresh failed');
      setMessage(en ? 'Decision saved.' : 'Decyzja zapisana.');
    } catch {
      setMessage(
        saved
          ? en
            ? 'Decision saved, but refresh failed. Reload the page.'
            : 'Decyzja zapisana, ale odświeżenie nie powiodło się. Odśwież stronę.'
          : en
            ? 'Could not complete the request. Refresh and try again.'
            : 'Nie udało się rozpatrzyć zgłoszenia. Odśwież dane i spróbuj ponownie.',
      );
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="section-requests">
      <h4>{en ? 'Section requests' : 'Zgłoszenia sekcji'}</h4>
      {loading && (
        <SwordsLoader
          language={language}
          label={en ? 'Loading…' : 'Wczytywanie…'}
        />
      )}
      {error && (
        <p role="alert">
          {en ? 'Could not load requests.' : 'Nie udało się wczytać zgłoszeń.'}{' '}
          <button
            type="button"
            className="text-button"
            onClick={() => void load()}
          >
            {en ? 'Retry' : 'Ponów'}
          </button>
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="muted">
          {en
            ? 'No pending section requests.'
            : 'Brak oczekujących zgłoszeń sekcji.'}
        </p>
      )}
      {items.map((item) => (
        <div key={item.id}>
          <p>
            {item.section_names.join(', ') ||
              (en ? 'No sections' : 'Bez sekcji')}
          </p>
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() => void review(item.id, true)}
          >
            {en ? 'Approve' : 'Zatwierdź'}
          </button>{' '}
          <button
            type="button"
            className="button secondary small"
            disabled={busy}
            onClick={() => void review(item.id, false)}
          >
            {en ? 'Reject' : 'Odrzuć'}
          </button>
        </div>
      ))}
    </section>
  );
}
