import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Participant } from './types/club';
import { readRpcPages } from './lib/pagination';
import { formatDues, parseDues } from './lib/dues';
import { matchesNameSearch } from './lib/search.ts';
import SwordsLoader from './SwordsLoader';
import ProfileDisclosure from './ProfileDisclosure';

type Balance = { participant_id: string; balance_grosze: number };
const valid = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) <= 0 && Number(value) >= -2147483648;

export function ParticipantArrearsSummary({
  client,
  participantId,
  language,
  readVersion = 0,
  bare = false,
}: {
  client: SupabaseClient;
  participantId: string;
  language: 'pl' | 'en';
  readVersion?: number;
  bare?: boolean;
}) {
  const [result, setResult] = useState<{
    id: string;
    amount: number | null;
    error: boolean;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const { data, error } = await client.rpc(
          'get_participant_dues_balance',
          { p_participant_id: participantId },
        );
        if (current)
          setResult({
            id: participantId,
            amount: !error && valid(data) ? data : null,
            error: Boolean(error) || !valid(data),
          });
      } catch {
        if (current)
          setResult({ id: participantId, amount: null, error: true });
      }
    })();
    return () => {
      current = false;
    };
  }, [client, participantId, retry, readVersion]);
  const en = language === 'en';
  const content =
    !result || result.id !== participantId ? (
      <SwordsLoader size="small" label={en ? 'Loading…' : 'Wczytywanie…'} />
    ) : result.error ? (
      <p role="status">
        {en ? 'Could not load arrears.' : 'Nie udało się wczytać zaległości.'}{' '}
        <button className="text-button" onClick={() => setRetry((v) => v + 1)}>
          {en ? 'Retry' : 'Ponów'}
        </button>
      </p>
    ) : (
      <span
        className={`dues-amount ${result.amount === 0 ? 'dues-amount--clear' : 'dues-amount--owed'}`}
      >
        {formatDues(result.amount!, language)}
      </span>
    );
  if (bare) return content;
  return (
    <div className="dues-summary">
      <strong>{en ? 'Membership arrears' : 'Zaległości w składkach'}</strong>
      {content}
    </div>
  );
}

export default function ParticipantArrearsPanel({
  client,
  participants,
  language,
  onChanged,
}: {
  client: SupabaseClient;
  participants: Participant[];
  language: 'pl' | 'en';
  onChanged: () => Promise<void>;
}) {
  const en = language === 'en';
  const [rows, setRows] = useState<Balance[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const locked = useRef(false),
    active = useRef(true);
  const generation = useRef(0);
  const matches = participants.filter((person) =>
    matchesNameSearch(person.name, search),
  );
  const pageCount = Math.ceil(matches.length / 10);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visibleParticipants = matches.slice(
    currentPage * 10,
    (currentPage + 1) * 10,
  );
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    const request = ++generation.current;
    const isCurrent = () => current && request === generation.current;
    void (async () => {
      try {
        const result = await readRpcPages<Balance>(
          (from, to) =>
            client.rpc('get_participant_dues_balances', {
              p_offset: from,
              p_limit: to - from + 1,
            }),
          isCurrent,
        );
        if (!isCurrent()) return;
        if (
          result.error ||
          !Array.isArray(result.data) ||
          !result.data.every(
            (row) =>
              typeof row.participant_id === 'string' &&
              valid(row.balance_grosze),
          )
        )
          throw Error('Invalid balances');
        setRows(result.data);
        setError(false);
      } catch {
        if (isCurrent()) {
          setError(true);
          setRows(null);
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [client, retry, participants]);
  async function save(id: string, amount: number, expected: number) {
    if (locked.current || !valid(amount)) return;
    locked.current = true;
    generation.current++;
    setBusy(id);
    setMessage('');
    let confirmed = false;
    try {
      const result = await client.rpc('set_participant_dues_balance', {
        p_participant_id: id,
        p_balance_grosze: amount,
        p_expected_balance_grosze: expected,
      });
      generation.current++;
      if (result.error || result.data !== amount)
        throw result.error ?? Error('Invalid save result');
      confirmed = true;
      if (active.current)
        setRows(
          (previous) =>
            previous?.map((row) =>
              row.participant_id === id
                ? { ...row, balance_grosze: amount }
                : row,
            ) ?? null,
        );
      await onChanged();
      if (active.current)
        setMessage(en ? 'Arrears saved.' : 'Zapisano zaległości.');
    } catch {
      generation.current++;
      if (active.current) {
        setMessage(
          confirmed
            ? en
              ? 'Saved. Refresh data to verify the current amount.'
              : 'Zapisano. Odśwież dane, aby potwierdzić aktualną kwotę.'
            : en
              ? 'Could not save. Refresh amounts before trying again.'
              : 'Nie udało się zapisać. Odśwież kwoty przed ponowieniem.',
        );
        if (!confirmed) {
          setRows(null);
          setError(true);
        }
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(null);
    }
  }
  return (
    <ProfileDisclosure
      title={en ? 'Membership arrears' : 'Zaległości w składkach'}
    >
      <p className="muted">
        {en
          ? 'Enter a negative amount in PLN or reset it to zero.'
          : 'Wpisz ujemną kwotę w złotych albo wyzeruj zaległość.'}
      </p>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <label>
        {en ? 'Search participants' : 'Szukaj zawodnika'}
        <input
          type="search"
          aria-label={en ? 'Search participants' : 'Szukaj zawodnika'}
          placeholder={en ? 'First and last name' : 'Imię i nazwisko'}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      </label>
      {search.trim() && (
        <p className="muted" role="status">
          {matches.length
            ? en
              ? `Found: ${matches.length} of ${participants.length}`
              : `Znaleziono: ${matches.length} z ${participants.length}`
            : en
              ? 'No matching participants.'
              : 'Nie znaleziono zawodników.'}
        </p>
      )}
      {error ? (
        <p className="notice" role="status">
          {en
            ? 'Arrears are unavailable. Check server setup and access.'
            : 'Zaległości są niedostępne. Sprawdź konfigurację serwera i uprawnienia.'}{' '}
          <button
            className="text-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            {en ? 'Refresh amounts' : 'Odśwież kwoty'}
          </button>
        </p>
      ) : rows === null ? (
        <SwordsLoader
          language={language}
          label={en ? 'Loading…' : 'Wczytywanie…'}
        />
      ) : (
        <div className="table-wrap">
          <table className="finance-cards finance-cards--dues">
            <thead>
              <tr>
                <th>{en ? 'Participant' : 'Zawodnik'}</th>
                <th>{en ? 'Arrears' : 'Zaległość'}</th>
                <th>{en ? 'Change amount' : 'Zmień kwotę'}</th>
              </tr>
            </thead>
            <tbody>
              {visibleParticipants.map((person) => {
                const row = rows.find(
                  (item) => item.participant_id === person.id,
                );
                return (
                  <tr key={person.id}>
                    <td>{person.name}</td>
                    <td>
                      {row ? (
                        <span
                          className={`dues-amount ${row.balance_grosze === 0 ? 'dues-amount--clear' : 'dues-amount--owed'}`}
                        >
                          {formatDues(row.balance_grosze, language)}
                        </span>
                      ) : (
                        <span>{en ? 'Unavailable' : 'Niedostępne'}</span>
                      )}
                    </td>
                    <td>
                      {row && (
                        <form
                          key={`${person.id}:${row.balance_grosze}`}
                          className="dues-editor"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = new FormData(event.currentTarget);
                            const amount = parseDues(
                              String(form.get('amount') ?? ''),
                            );
                            if (amount === null) {
                              setMessage(
                                en
                                  ? 'Enter zero or a negative amount with up to two decimal places.'
                                  : 'Wpisz zero lub ujemną kwotę z maksymalnie dwoma miejscami po przecinku.',
                              );
                              return;
                            }
                            void save(person.id, amount, row.balance_grosze);
                          }}
                        >
                          <input
                            name="amount"
                            type="text"
                            inputMode="decimal"
                            aria-label={`${en ? 'Arrears' : 'Zaległość'}: ${person.name}`}
                            defaultValue={String(row.balance_grosze / 100)}
                            required
                            disabled={Boolean(busy)}
                          />
                          <button
                            className="button secondary small"
                            disabled={Boolean(busy)}
                          >
                            {busy === person.id
                              ? en
                                ? 'Saving…'
                                : 'Zapisuję…'
                              : en
                                ? 'Save'
                                : 'Zapisz'}
                          </button>
                          <button
                            type="button"
                            className="button secondary small"
                            disabled={Boolean(busy) || row.balance_grosze === 0}
                            onClick={() =>
                              void save(person.id, 0, row.balance_grosze)
                            }
                          >
                            {en ? 'Reset' : 'Zeruj'}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!error && rows !== null && pageCount > 1 && (
        <nav
          className="coach-training-pagination"
          aria-label={en ? 'Arrears pages' : 'Strony zaległości'}
        >
          <button
            type="button"
            className="button secondary small"
            disabled={currentPage === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            {en ? 'Previous' : 'Poprzednie'}
          </button>
          <span role="status">
            {en
              ? `Page ${currentPage + 1} of ${pageCount}`
              : `Strona ${currentPage + 1} z ${pageCount}`}
          </span>
          <button
            type="button"
            className="button secondary small"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage((value) => value + 1)}
          >
            {en ? 'Next' : 'Następne'}
          </button>
        </nav>
      )}
    </ProfileDisclosure>
  );
}
