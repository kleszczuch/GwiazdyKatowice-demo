import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readRpcPages } from './lib/pagination';

interface Coach {
  account_id: string;
  name: string;
}

interface Props {
  client: SupabaseClient;
  value: string;
  disabled: boolean;
  language: 'pl' | 'en';
  onChange?: (accountId: string, name: string) => void;
}

export default function TrainingCoachSelect({
  client,
  value,
  disabled,
  language,
  onChange,
}: Props) {
  const [result, setResult] = useState<{
    coaches: Coach[];
    failed: boolean;
  } | null>(null);
  const [draft, setDraft] = useState(value);
  const [retry, setRetry] = useState(0);
  const en = language === 'en';

  useEffect(() => {
    let current = true;
    void (async () => {
      const result = await readRpcPages<Coach>(
        (from, to) =>
          client
            .rpc('get_training_coaches')
            .order('account_id')
            .range(from, to),
        () => current,
        (coach) => coach.account_id,
      );
      if (!current) return;
      const valid =
        !result.error &&
        (result.data ?? []).every(
          (coach) =>
            typeof coach.account_id === 'string' &&
            typeof coach.name === 'string' &&
            Boolean(coach.name.trim()),
        );
      setResult({
        coaches: valid
          ? (result.data ?? []).sort((a, b) =>
              a.name.localeCompare(b.name, 'pl'),
            )
          : [],
        failed: !valid,
      });
    })();
    return () => {
      current = false;
    };
  }, [client, retry]);

  const selected = onChange ? value : draft;
  return (
    <div>
      <label>
        {en ? 'Main coach' : 'Główny trener'}
        <select
          name="coach_account_id"
          value={
            result?.coaches.some((coach) => coach.account_id === selected)
              ? selected
              : ''
          }
          disabled={disabled}
          required
          aria-busy={!result}
          onChange={(event) => {
            setDraft(event.target.value);
            onChange?.(
              event.target.value,
              result?.coaches.find(
                (coach) => coach.account_id === event.target.value,
              )?.name ?? '',
            );
          }}
        >
          <option value="" disabled>
            {!result
              ? en
                ? 'Loading coaches…'
                : 'Wczytywanie trenerów…'
              : en
                ? 'Choose one coach'
                : 'Wybierz jednego trenera'}
          </option>
          {result?.coaches.map((coach) => (
            <option key={coach.account_id} value={coach.account_id}>
              {coach.name}
            </option>
          ))}
        </select>
      </label>
      {result?.failed && (
        <p className="notice" role="alert">
          {en ? 'Could not load coaches.' : 'Nie udało się wczytać trenerów.'}{' '}
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() => {
              setResult(null);
              setRetry((value) => value + 1);
            }}
          >
            {en ? 'Retry' : 'Spróbuj ponownie'}
          </button>
        </p>
      )}
      {result && !result.failed && !result.coaches.length && (
        <p className="muted" role="status">
          {en
            ? 'No active coaches available.'
            : 'Brak aktywnych trenerów do wyboru.'}
        </p>
      )}
    </div>
  );
}
