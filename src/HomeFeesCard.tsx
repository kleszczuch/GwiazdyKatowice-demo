import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProfileParticipant } from './types/club';
import { ChevronRight, Wallet } from './placeholderIcons';
import { ParticipantArrearsSummary } from './ParticipantArrearsPanel';
import './home-fees.css';

export default function HomeFeesCard({
  client,
  participants,
  language,
  readVersion,
  onOpen,
}: {
  client: SupabaseClient;
  participants: ProfileParticipant[];
  language: 'pl' | 'en';
  readVersion: number;
  onOpen: () => void;
}) {
  const en = language === 'en';
  return (
    <section
      className="stat-card home-fees"
      aria-label={en ? 'Fees' : 'Opłaty'}
    >
      <span className="stat-label">
        <Wallet size={18} /> {en ? 'Fees' : 'Opłaty'}
      </span>
      {participants.length ? (
        participants.map((person) => (
          <div className="home-fees__person" key={person.id}>
            {participants.length > 1 && (
              <strong className="home-fees__name">{person.name}</strong>
            )}
            <div className="home-fees__columns">
              <div>
                <strong>AZS</strong>
                <span className="status-text">
                  {person.tier === 'child'
                    ? en
                      ? 'Not applicable'
                      : 'Nie dotyczy'
                    : person.azs_paid
                      ? en
                        ? 'Paid'
                        : 'Opłacone'
                      : en
                        ? 'Not confirmed'
                        : 'Brak potwierdzenia'}
                </span>
              </div>
              <ParticipantArrearsSummary
                client={client}
                participantId={person.id}
                language={language}
                readVersion={readVersion}
              />
            </div>
          </div>
        ))
      ) : (
        <p>{en ? 'Profile data unavailable' : 'Brak danych profilu'}</p>
      )}
      <button type="button" className="home-fees__link" onClick={onOpen}>
        {en ? 'In your profile' : 'W Twoim profilu'} <ChevronRight size={16} />
      </button>
    </section>
  );
}
