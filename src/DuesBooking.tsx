import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DuesStatus } from './types/club';
import { formatDues } from './lib/dues';

const groups = ['steel', 'beginner_association', 'youth', 'beginner_azs'];
const isStatus = (value: unknown): value is DuesStatus => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    Number.isInteger(row.balance_grosze) &&
    Number(row.balance_grosze) <= 0 &&
    groups.includes(String(row.fee_group)) &&
    (row.limit_grosze === null || Number.isInteger(row.limit_grosze)) &&
    typeof row.blocked === 'boolean'
  );
};

// Stan zaległości wybranego uczestnika. Wynik jest pamiętany razem z jego
// identyfikatorem, więc po zmianie osoby nie pokaże się cudza zaległość.
export function useDuesStatus(
  client: SupabaseClient,
  participantId: string,
  enabled: boolean,
  refreshKey: number,
) {
  const [result, setResult] = useState<{
    participantId: string;
    status: DuesStatus | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !participantId) return;
    let current = true;
    void (async () => {
      try {
        const { data, error } = await client.rpc(
          'get_participant_dues_status',
          { p_participant_id: participantId },
        );
        if (current)
          setResult({
            participantId,
            status: !error && isStatus(data) ? data : null,
          });
      } catch {
        if (current) setResult({ participantId, status: null });
      }
    })();
    return () => {
      current = false;
    };
  }, [client, participantId, enabled, refreshKey]);
  return enabled && participantId && result?.participantId === participantId
    ? result.status
    : null;
}

// Baza odrzuca zapis „Będę” z hint=dues_limit, gdy zaległość osiągnęła limit.
export const isDuesLimitError = (error: unknown) =>
  Boolean(
    error &&
    typeof error === 'object' &&
    (error as { hint?: unknown }).hint === 'dues_limit',
  );

const blockedText = (
  status: DuesStatus,
  child: boolean,
  language: 'pl' | 'en',
) => {
  const amount = formatDues(status.balance_grosze, language).replace('-', '');
  const limit = formatDues(status.limit_grosze ?? 0, language);
  return language === 'en'
    ? `${child ? "The child's training signups are blocked" : 'Training signups are blocked'}. ${child ? "The child's arrears" : 'Arrears'} of ${amount} reached the ${limit} limit. Settle the arrears to sign up again.`
    : `${child ? 'Zapisy dziecka na treningi są zablokowane' : 'Zapisy na treningi są zablokowane'}. ${child ? 'Zaległość dziecka' : 'Zaległość'} ${amount} osiągnęła limit ${limit}. Ureguluj zaległość, aby znów się zapisywać.`;
};

export function DuesNotice({
  status,
  child,
  language,
}: {
  status: DuesStatus | null;
  child: boolean;
  language: 'pl' | 'en';
}) {
  if (!status || status.balance_grosze >= 0) return null;
  const amount = formatDues(status.balance_grosze, language).replace('-', '');
  return (
    <p
      className={`dues-notice ${status.blocked ? 'dues-notice--blocked' : ''}`}
      role="status"
    >
      {status.blocked
        ? blockedText(status, child, language)
        : language === 'en'
          ? `${child ? 'The child has membership arrears' : 'You have membership arrears'}: ${amount}. Please settle them as soon as possible.`
          : `${child ? 'Dziecko ma zaległość w składkach' : 'Masz zaległość w składkach'}: ${amount}. Ureguluj ją jak najszybciej.`}
    </p>
  );
}

export function DuesBlockDialog({
  status,
  child,
  language,
  onClose,
}: {
  status: DuesStatus | null;
  child: boolean;
  language: 'pl' | 'en';
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    dialog.current?.focus();
  }, []);
  const en = language === 'en';
  return (
    <div className="week-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialog}
        className="week-modal dues-block-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dues-block-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <h2 id="dues-block-title">
          {en ? 'Signups blocked' : 'Zapisy zablokowane'}
        </h2>
        <p>
          {status?.blocked
            ? blockedText(status, child, language)
            : en
              ? `${child ? "The child's arrears reached" : 'Your arrears reached'} the limit for training signups. Settle the arrears to sign up again.`
              : `${child ? 'Zaległość dziecka osiągnęła' : 'Twoja zaległość osiągnęła'} limit zapisów na treningi. Ureguluj zaległość, aby znów się zapisywać.`}
        </p>
        <button type="button" className="button" onClick={onClose}>
          {en ? 'Close' : 'Zamknij'}
        </button>
      </section>
    </div>
  );
}
