import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProfileRequest } from './types/personal-profile';
import { UserRound, Check, X } from './placeholderIcons';
import SwordsLoader from './SwordsLoader';

export default function ProfileRequestsPanel({
  client,
  language,
  onChanged,
  accountId,
  embedded = false,
  participantId,
  refreshRevision,
}: {
  client: SupabaseClient;
  language: 'pl' | 'en';
  onChanged: () => void | Promise<void>;
  accountId?: string;
  embedded?: boolean;
  participantId?: string;
  refreshRevision?: number;
}) {
  const [requests, setRequests] = useState<ProfileRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const en = language === 'en';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        const { data, error } = await client.rpc('list_profile_requests');
        if (error || !Array.isArray(data))
          throw error ?? new Error('Invalid response');
        if (!canceled) {
          setRequests(
            (data as ProfileRequest[]).filter((request) =>
              participantId
                ? request.participant_id === participantId
                : !accountId || request.account_id === accountId,
            ),
          );
          setMessage('');
        }
      } catch {
        if (!canceled)
          setMessage(
            en
              ? 'Could not load group change requests.'
              : 'Nie udało się wczytać zgłoszeń zmiany grupy.',
          );
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [client, revision, en, accountId, participantId, refreshRevision]);
  const review = async (id: string, approve: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await client.rpc('review_profile_request', {
        p_request_id: id,
        p_approve: approve,
      });
      if (error) throw error;
      if (data !== true) throw new Error('Stale request');
      if (mounted.current) {
        setRevision((value) => value + 1);
      }
      await onChanged();
    } catch {
      if (mounted.current)
        setMessage(
          en
            ? 'Could not review this request. Refresh the list. Advanced group approval requires all five clothing sizes.'
            : 'Nie udało się rozpatrzyć zgłoszenia. Odśwież listę. Zatwierdzenie grupy zaawansowanej wymaga pięciu rozmiarów stroju.',
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (embedded && !loading && requests.length === 0 && !message) return null;
  return (
    <section className="settings-content">
      <h3>
        <UserRound size={18} />{' '}
        {en
          ? 'Group changes awaiting approval'
          : 'Zmiany grupy do zatwierdzenia'}
      </h3>
      {loading && (
        <SwordsLoader
          language={language}
          label={en ? 'Loading…' : 'Wczytuję…'}
        />
      )}
      {message && (
        <p role="alert" className="notice">
          {message}
        </p>
      )}
      <button
        className="button secondary small"
        disabled={busy || loading}
        onClick={() => {
          setLoading(true);
          setRevision((value) => value + 1);
        }}
      >
        {en ? 'Refresh requests' : 'Odśwież zgłoszenia'}
      </button>
      {!loading && requests.length === 0 && !message && (
        <p>{en ? 'No pending requests.' : 'Brak oczekujących zgłoszeń.'}</p>
      )}
      {requests.map((request) => (
        <article
          className={embedded ? 'settings-content' : 'panel'}
          key={request.id}
        >
          <h4>
            {request.first_name} {request.last_name}
          </h4>
          <dl>
            <dt>{en ? 'Group' : 'Grupa'}</dt>
            <dd>
              {request.training_group === 'advanced'
                ? en
                  ? 'Advanced'
                  : 'Zaawansowana'
                : en
                  ? 'Beginner'
                  : 'Początkująca'}
            </dd>
          </dl>
          <button
            className="button small"
            disabled={busy}
            onClick={() => void review(request.id, true)}
          >
            <Check size={16} />
            {en ? 'Approve' : 'Zatwierdź'}
          </button>
          <button
            className="button secondary small"
            disabled={busy}
            onClick={() => void review(request.id, false)}
          >
            <X size={16} />
            {en ? 'Reject' : 'Odrzuć'}
          </button>
        </article>
      ))}
    </section>
  );
}
