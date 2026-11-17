import { useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ShieldCheck } from './placeholderIcons';
import type {
  ClubRole,
  ClubSettings,
  Participant,
  ProfileParticipant,
} from './types/club';
import { downloadXlsx } from './lib/xlsx';
import { matchesNameSearch } from './lib/search.ts';
import ParticipantArrearsPanel from './ParticipantArrearsPanel';
import ProfileDisclosure from './ProfileDisclosure';

interface Props {
  client: SupabaseClient;
  participants: Participant[];
  roles: ClubRole[];
  clubSettings?: ClubSettings | null;
  language?: 'pl' | 'en';
  onChanged: () => Promise<void>;
}

function azsDetails(person: Participant) {
  const profile = person as Partial<ProfileParticipant>;
  return {
    child: (profile.tier ?? person.category) === 'child',
    paid: profile.azs_paid === true,
    markedAt: profile.azs_marked_at ?? null,
  };
}

export default function FinancePanel({
  client,
  participants,
  roles,
  clubSettings,
  language = 'pl',
  onChanged,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [azsSearch, setAzsSearch] = useState('');
  const [azsPage, setAzsPage] = useState(0);
  const say = (pl: string, en: string) => (language === 'en' ? en : pl);
  const groupFeesEditable =
    !clubSettings || clubSettings.fee_youth !== undefined;
  const groupFeeFields = [
    {
      name: 'fee_youth',
      label: say(
        'Młodzież i Początkujący Stowarzyszenie (zł)',
        'Youth and Beginners (Association) (PLN)',
      ),
      rule: say(
        'Dzieci oraz dorośli początkujący przypisani w Zawodnikach do Stowarzyszenia. Stowarzyszenie nie ma zniżki Full Gear.',
        'Children and adult beginners assigned to the Association in Participants. The Association has no Full Gear discount.',
      ),
      fallback: 130,
    },
    {
      name: 'fee_beginner_azs',
      label: say('Początkujący AZS (zł)', 'Beginners (AZS) (PLN)'),
      rule: say(
        'Dorośli początkujący przypisani w Zawodnikach do AZS.',
        'Adult beginners assigned to AZS in Participants.',
      ),
      fallback: 0,
    },
  ] as const;
  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const fee = Number(values.get('monthly_fee'));
    const discount = Number(values.get('fulgir_discount'));
    const groupFees = groupFeesEditable
      ? Object.fromEntries(
          groupFeeFields.map(({ name }) => [name, Number(values.get(name))]),
        )
      : {};
    if (
      [fee, discount, ...Object.values(groupFees)].some(
        (value) => !Number.isInteger(value) || value < 0,
      ) ||
      discount > fee
    ) {
      setMessage(
        say(
          'Podaj poprawne kwoty (pełne złote, co najmniej 0). Zniżka nie może przekraczać składki Stali.',
          'Enter valid amounts (whole PLN, at least 0). The discount cannot exceed the Steel fee.',
        ),
      );
      return;
    }
    setSavingSettings(true);
    setMessage('');
    try {
      const { error } = await client.from('club_settings').upsert({
        id: 1,
        monthly_fee: fee,
        fulgir_discount: discount,
        ...groupFees,
      });
      if (error) throw error;
      await onChanged();
      setMessage(say('Zapisano składkę klubową.', 'Club fee saved.'));
    } catch {
      setMessage(
        say('Nie udało się zapisać składki.', 'Could not save the club fee.'),
      );
    } finally {
      setSavingSettings(false);
    }
  };
  const status = (person: Participant) => {
    const details = azsDetails(person);
    return details.child
      ? say('Nie dotyczy', 'Not applicable')
      : details.paid
        ? say('Potwierdzone', 'Confirmed')
        : say('Brak potwierdzenia', 'Unconfirmed');
  };
  const azsMatches = participants.filter((person) =>
    matchesNameSearch(person.name, azsSearch),
  );
  const azsPageCount = Math.ceil(azsMatches.length / 10);
  const visibleAzs = azsMatches.slice(
    Math.min(azsPage, Math.max(0, azsPageCount - 1)) * 10,
    (Math.min(azsPage, Math.max(0, azsPageCount - 1)) + 1) * 10,
  );
  const confirm = async (person: Participant) => {
    if (busyId || azsDetails(person).child || !roles.includes('admin')) return;
    setBusyId(person.id);
    setMessage('');
    try {
      const { error } = await client.rpc('set_azs_paid', {
        p_participant_id: person.id,
        p_paid: !azsDetails(person).paid,
      });
      if (error) throw error;
      try {
        await onChanged();
        setMessage(say('Zapisano status AZS.', 'AZS status saved.'));
      } catch {
        setMessage(
          say(
            'Zapisano status AZS. Odśwież stronę, aby pobrać aktualne dane.',
            'AZS status saved. Refresh the page to reload current data.',
          ),
        );
      }
    } catch {
      setMessage(
        say(
          'Nie udało się zapisać statusu AZS. Sprawdź połączenie i uprawnienia administratora.',
          'Could not save AZS status. Check your connection and administrator permissions.',
        ),
      );
    } finally {
      setBusyId(null);
    }
  };
  if (!roles.includes('admin')) return null;
  return (
    <>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <ProfileDisclosure
        title={
          <>
            <ShieldCheck size={18} />
            {say('Status AZS', 'AZS status')}
          </>
        }
      >
        <button
          className="button secondary small"
          onClick={() =>
            downloadXlsx('azs.xlsx', 'AZS', [
              [
                say('Uczestnik', 'Participant'),
                say('Status AZS', 'AZS status'),
                say('Ostatnia zmiana', 'Last change'),
              ],
              ...participants.map((person) => [
                person.name,
                status(person),
                azsDetails(person).markedAt ?? '',
              ]),
            ])
          }
        >
          {say('Pobierz Excel (.xlsx)', 'Download Excel (.xlsx)')}
        </button>
        <p className="muted">
          {say(
            'Administrator potwierdza opłacenie AZS. AZS nie dotyczy dzieci.',
            'The administrator confirms AZS payment. AZS does not apply to children.',
          )}
        </p>
        <label>
          {say('Szukaj zawodnika', 'Search participants')}
          <input
            type="search"
            aria-label={say('Szukaj zawodnika', 'Search participants')}
            placeholder={say('Imię i nazwisko', 'First and last name')}
            value={azsSearch}
            onChange={(event) => {
              setAzsSearch(event.target.value);
              setAzsPage(0);
            }}
          />
        </label>
        {azsSearch.trim() && (
          <p className="muted" role="status">
            {azsMatches.length
              ? say(
                  `Znaleziono: ${azsMatches.length} z ${participants.length}`,
                  `Found: ${azsMatches.length} of ${participants.length}`,
                )
              : say('Nie znaleziono zawodników.', 'No matching participants.')}
          </p>
        )}
        {!participants.length ? (
          <p className="muted">
            {say('Brak dostępnych uczestników.', 'No participants available.')}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="finance-cards finance-cards--azs">
              <thead>
                <tr>
                  <th>{say('Uczestnik', 'Participant')}</th>
                  <th>{say('Status AZS', 'AZS status')}</th>
                  <th>
                    {say(
                      'Potwierdzenie administratora',
                      'Administrator confirmation',
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleAzs.map((person) => {
                  const details = azsDetails(person);
                  return (
                    <tr key={person.id}>
                      <td>{person.name}</td>
                      <td>
                        <span
                          className={`badge ${details.child ? '' : details.paid ? 'azs-confirmed' : 'azs-unconfirmed'}`}
                        >
                          {status(person)}
                        </span>
                      </td>
                      <td>
                        {details.child ? (
                          '—'
                        ) : (
                          <button
                            className="button secondary small"
                            disabled={busyId !== null}
                            onClick={() => void confirm(person)}
                          >
                            {busyId === person.id
                              ? say('Zapisuję…', 'Saving…')
                              : details.paid
                                ? say(
                                    'Wycofaj potwierdzenie',
                                    'Withdraw confirmation',
                                  )
                                : say('Potwierdź AZS', 'Confirm AZS')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {azsPageCount > 1 && (
          <nav
            className="coach-training-pagination"
            aria-label={say('Strony statusu AZS', 'AZS status pages')}
          >
            <button
              type="button"
              className="button secondary small"
              disabled={azsPage === 0}
              onClick={() => setAzsPage((page) => page - 1)}
            >
              {say('Poprzednie', 'Previous')}
            </button>
            <span role="status">
              {say(
                `Strona ${Math.min(azsPage, azsPageCount - 1) + 1} z ${azsPageCount}`,
                `Page ${Math.min(azsPage, azsPageCount - 1) + 1} of ${azsPageCount}`,
              )}
            </span>
            <button
              type="button"
              className="button secondary small"
              disabled={azsPage >= azsPageCount - 1}
              onClick={() => setAzsPage((page) => page + 1)}
            >
              {say('Następne', 'Next')}
            </button>
          </nav>
        )}
      </ProfileDisclosure>
      <ParticipantArrearsPanel
        client={client}
        participants={participants}
        language={language}
        onChanged={onChanged}
      />
      <ProfileDisclosure title={say('Składka klubowa', 'Club monthly fee')}>
        <p className="muted">
          {say(
            'Kwoty wyświetlane w profilach zawodników. Grupa wynika z kategorii i poziomu: dziecko → Młodzież, zaawansowany lub trener → Stal, a dorosłego początkującego administrator przypisuje w Zawodnikach do Początkujących AZS albo Początkujących Stowarzyszenie (kwota jak Młodzież, bez zniżki Full Gear). Zaległość równa dwóm składkom grupy lub większa blokuje zapisy na treningi; grupa 0 zł liczy próg od składki Stali, a konta trenerów nie mają blokady. Zapis w bazie nie nalicza ani nie potwierdza wpłat.',
            'Amounts shown in participant profiles. The group follows category and level: child → Youth, advanced or coach → Steel, and the administrator assigns adult beginners in Participants to Beginners (AZS) or Beginners (Association) (Youth amount, no Full Gear discount). Arrears of two group fees or more block training signups; a 0 PLN group uses the Steel fee for the limit and coach accounts have no block. Saving does not charge or confirm payments.',
          )}
        </p>
        <form
          className="fee-settings"
          key={[
            clubSettings?.monthly_fee,
            clubSettings?.fulgir_discount,
            clubSettings?.fee_youth,
            clubSettings?.fee_beginner_azs,
          ].join(':')}
          onSubmit={(event) => void saveSettings(event)}
        >
          <label>
            {say('Stal (zł)', 'Steel (PLN)')}
            <small className="muted">
              {say(
                'Dorosły zaawansowany i trener. Ta kwota jest też składką w cenniku strony.',
                'Advanced adult and coach. This amount is also the fee in the public price list.',
              )}
            </small>
            <input
              type="number"
              min="0"
              step="1"
              required
              name="monthly_fee"
              defaultValue={clubSettings?.monthly_fee ?? ''}
            />
          </label>
          {groupFeesEditable ? (
            groupFeeFields.map((field) => (
              <label key={field.name}>
                {field.label}
                <small className="muted">{field.rule}</small>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  name={field.name}
                  defaultValue={clubSettings?.[field.name] ?? field.fallback}
                />
              </label>
            ))
          ) : (
            <p className="muted">
              {say(
                'Kwoty pozostałych grup będą dostępne po aktualizacji bazy.',
                'Other group amounts become available after the database update.',
              )}
            </p>
          )}
          <label>
            {say('Zniżka za Full Gear (zł)', 'Full Gear discount (PLN)')}
            <input
              type="number"
              min="0"
              step="1"
              required
              name="fulgir_discount"
              defaultValue={clubSettings?.fulgir_discount ?? 50}
            />
          </label>
          <button className="button" disabled={savingSettings} type="submit">
            {savingSettings
              ? say('Zapisuję…', 'Saving…')
              : say('Zapisz kwoty', 'Save amounts')}
          </button>
        </form>
      </ProfileDisclosure>
    </>
  );
}
