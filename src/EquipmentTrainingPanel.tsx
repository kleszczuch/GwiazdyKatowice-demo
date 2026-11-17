import { readRpcPages } from './lib/pagination';
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ParticipantEquipmentEntry,
  Section,
  Training,
} from './types/club';
import { equipmentIcons, profileEquipmentCatalog } from './equipmentIcons';
import {
  loadTrainingRequirement,
  requiredEquipmentText,
} from './lib/required-equipment.ts';
import type { RequirementResult } from './lib/required-equipment.ts';
import './equipment.css';
import SwordsLoader from './SwordsLoader';
import { warsawToday } from './lib/warsaw-date.ts';

interface Props {
  client: SupabaseClient;
  trainings: Training[];
  sections: Section[];
  language: 'pl' | 'en';
}

interface EquipmentRoster {
  participant_id: string;
  name: string;
  equipment: ParticipantEquipmentEntry[];
}

// Błędny wiersz osoby unieważnia całą odpowiedź, ale nieznane pozycje sprzętu
// są tylko pomijane (np. pozycja usunięta z katalogu).
function readRoster(data: unknown): EquipmentRoster[] {
  if (!Array.isArray(data)) throw new Error('Invalid equipment roster');
  return data.map((person: unknown) => {
    if (!person || typeof person !== 'object')
      throw new Error('Invalid participant');
    const row = person as Record<string, unknown>;
    if (
      typeof row.participant_id !== 'string' ||
      typeof row.name !== 'string' ||
      !Array.isArray(row.equipment)
    ) {
      throw new Error('Invalid participant equipment');
    }
    const equipment = row.equipment.filter(
      (value: unknown): value is ParticipantEquipmentEntry => {
        if (!value || typeof value !== 'object') return false;
        const entry = value as Record<string, unknown>;
        return (
          profileEquipmentCatalog.some((item) => item.item === entry.item) &&
          ['own', 'club', 'none', 'unknown'].includes(
            String(entry.ownership),
          ) &&
          (entry.size === null || typeof entry.size === 'string')
        );
      },
    );
    return { participant_id: row.participant_id, name: row.name, equipment };
  });
}

export default function EquipmentTrainingPanel({
  client,
  trainings: upcoming,
  sections,
  language,
}: Props) {
  const [earlier, setEarlier] = useState<Training[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [chosenMode, setChosenMode] = useState<'today' | 'single' | null>(null);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    entries: {
      roster: EquipmentRoster[];
      coaches: EquipmentRoster[];
      requirement: RequirementResult;
    }[];
    error: 'permission' | 'load' | null;
  }>({ key: '', entries: [], error: null });
  const today = warsawToday();
  // Obszar roboczy wczytuje tylko niezakończone treningi; zakończone z ostatniej
  // doby dociągamy tutaj, żeby „Dzisiaj” obejmowało cały dzień.
  useEffect(() => {
    let active = true;
    void (async () => {
      const now = Date.now();
      const { data } = await client
        .from('trainings')
        .select(
          'id,section_id,starts_at,ends_at,group_label,location,coach_label,series_id,canceled',
        )
        .gte('starts_at', new Date(now - 86400000).toISOString())
        .lt('ends_at', new Date(now).toISOString())
        .eq('canceled', false)
        .order('starts_at')
        .returns<Training[]>();
      if (active && Array.isArray(data)) setEarlier(data);
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client, today]);
  const trainings = [
    ...earlier.filter(
      (training) => !upcoming.some((other) => other.id === training.id),
    ),
    ...upcoming,
  ];
  const todayTrainings = trainings.filter(
    (training) =>
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(
        new Date(training.starts_at),
      ) === today,
  );
  const mode = chosenMode ?? (todayTrainings.length ? 'today' : 'single');
  const selected =
    trainings.find((training) => training.id === selectedId) ??
    upcoming[0] ??
    trainings[0];
  const ids = (mode === 'today' ? todayTrainings : selected ? [selected] : [])
    .map((training) => training.id)
    .join(',');
  const requestKey = `${ids}:${reload}`;
  const loading = Boolean(ids) && result.key !== requestKey;
  const ready = Boolean(ids) && result.key === requestKey && !result.error;
  const en = language === 'en';

  useEffect(() => {
    let active = true;
    if (!ids) return;
    void (async () => {
      const loaded = await Promise.all(
        ids.split(',').map(async (trainingId) => {
          const [{ data, error }, coaches, requirement] = await Promise.all([
            readRpcPages<EquipmentRoster>(
              (from, to) =>
                client
                  .rpc('get_training_equipment', { p_training_id: trainingId })
                  .order('name')
                  .order('participant_id')
                  .range(from, to),
              () => active,
              (row) => row.participant_id,
            ),
            // Starsza baza nie ma tej funkcji; wtedy panel liczy samych zawodników.
            readRpcPages<EquipmentRoster>(
              (from, to) =>
                client
                  .rpc('get_training_coach_equipment', {
                    p_training_id: trainingId,
                  })
                  .order('name')
                  .order('participant_id')
                  .range(from, to),
              () => active,
              (row) => row.participant_id,
            ),
            loadTrainingRequirement(client, trainingId),
          ]);
          return { data, error, coaches: coaches.data ?? [], requirement };
        }),
      );
      if (!active) return;
      const error = loaded.find((entry) => entry.error)?.error;
      setResult({
        key: requestKey,
        entries: error
          ? []
          : loaded.map((entry) => ({
              roster: readRoster(entry.data ?? []),
              coaches: readRoster(entry.coaches),
              requirement: entry.requirement,
            })),
        error: error ? (error.code === '42501' ? 'permission' : 'load') : null,
      });
    })().catch(() => {
      if (active) setResult({ key: requestKey, entries: [], error: 'load' });
    });
    return () => {
      active = false;
    };
  }, [client, ids, requestKey]);

  // Osoba zapisana na kilka treningów liczy się raz; potrzebuje sumy sprzętu
  // tych treningów, a trening bez ustawionej listy oznacza cały sprzęt (null).
  // Trener zgłoszony tylko jako trener jest dopiskiem: nie zajmuje zasobów klubu.
  const people = new Map<
    string,
    { person: EquipmentRoster; needs: Set<string> | null; coach: boolean }
  >();
  const entryItems = result.entries.map(({ requirement }) =>
    requirement.status === 'ready' && requirement.requirement.configured
      ? requirement.requirement.items.map((entry) => entry.item)
      : null,
  );
  result.entries.forEach((entry, index) => {
    const items = entryItems[index];
    for (const [list, coach] of [
      [entry.roster, false],
      [entry.coaches, true],
    ] as const)
      for (const person of list) {
        const known = people.get(person.participant_id);
        if (!known)
          people.set(person.participant_id, {
            person,
            needs: items && new Set(items),
            coach,
          });
        else {
          if (!coach) known.coach = false;
          if (!items) known.needs = null;
          else for (const item of items) known.needs?.add(item);
        }
      }
  });
  const roster = [...people.values()].sort((left, right) =>
    left.person.name.localeCompare(right.person.name, en ? 'en' : 'pl'),
  );
  const coachCount = roster.filter((entry) => entry.coach).length;
  const forCoach = (count: number) =>
    count ? ` + ${count} ${en ? 'for the coach' : 'dla trenera'}` : '';
  const allConfigured = entryItems.every((items) => items !== null);
  const catalogRows = allConfigured
    ? profileEquipmentCatalog.filter((catalog) =>
        entryItems.some((items) => items?.includes(catalog.item)),
      )
    : profileEquipmentCatalog;
  const requirement = allConfigured
    ? catalogRows.map((catalog) => catalog.item)
    : null;
  const summary = catalogRows.map((catalog) => {
    const sizes = new Map<string, { count: number; coach: number }>();
    let total = 0;
    let coachTotal = 0;
    let unknown = 0;
    let missingOwn = 0;
    for (const { person, needs, coach } of roster) {
      if (needs && !needs.has(catalog.item)) continue;
      const entry = person.equipment.find((item) => item.item === catalog.item);
      if (!entry || entry.ownership === 'unknown') unknown += 1;
      if (catalog.item === 'groin') {
        if (entry?.ownership !== 'own') missingOwn += 1;
      } else if (entry?.ownership === 'club') {
        if (coach) coachTotal += 1;
        else total += 1;
        if (catalog.sizes.length) {
          const size =
            entry.size && catalog.sizes.some((value) => value === entry.size)
              ? entry.size
              : en
                ? 'Size not provided'
                : 'Rozmiar do uzupełnienia';
          const counted = sizes.get(size) ?? { count: 0, coach: 0 };
          counted[coach ? 'coach' : 'count'] += 1;
          sizes.set(size, counted);
        }
      }
    }
    return { catalog, sizes, total, coachTotal, unknown, missingOwn };
  });
  const groups = [
    {
      title: en
        ? 'Clothing and protective gear sizes'
        : 'Odzież i ochraniacze — rozmiary',
      rows: summary.filter(({ catalog }) => catalog.sizes.length > 0),
    },
    {
      title: en ? 'One-size protection' : 'Ochraniacze — jeden rozmiar, unisex',
      rows: summary.filter(
        ({ catalog }) =>
          !catalog.sizes.length &&
          !['sabre', 'sword_buckler', 'longsword'].includes(catalog.item),
      ),
    },
    {
      title: en ? 'Weapons' : 'Broń',
      rows: summary.filter(({ catalog }) =>
        ['sabre', 'sword_buckler', 'longsword'].includes(catalog.item),
      ),
    },
  ];
  const ownershipLabel = (entry: ParticipantEquipmentEntry | undefined) => {
    if (!entry || entry.ownership === 'unknown')
      return en ? 'Needs completion' : 'Do uzupełnienia';
    if (entry.ownership === 'own')
      return en ? 'Own equipment' : 'Własny sprzęt';
    if (entry.ownership === 'club')
      return en
        ? 'Does not have it — needs club equipment'
        : 'Nie ma — potrzebuje klubowego';
    return en ? 'Does not have it' : 'Nie ma';
  };
  const date = (value: string) =>
    new Intl.DateTimeFormat(en ? 'en-GB' : 'pl-PL', {
      timeZone: 'Europe/Warsaw',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));

  return (
    <section className="panel equipment-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            {en ? 'COACH TOOLS' : 'NARZĘDZIA KADRY'}
          </span>
          <h2>{en ? 'Training equipment' : 'Sprzęt na trening'}</h2>
        </div>
      </div>
      <p className="muted">
        {en
          ? 'Club equipment needed by booked participants, based on their current declarations. Coaches who will attend are added separately and do not use the club stock limit.'
          : 'Zapotrzebowanie na sprzęt klubowy osób zapisanych na trening, na podstawie ich aktualnych deklaracji. Trenerzy, którzy zgłosili udział, są doliczani osobno i nie zajmują limitu zasobów.'}
      </p>
      {!trainings.length && (
        <p className="muted">
          {en ? 'No available trainings.' : 'Brak dostępnych treningów.'}
        </p>
      )}
      {trainings.length > 0 && (
        <div
          className="equipment-panel__modes"
          role="group"
          aria-label={en ? 'Scope' : 'Zakres'}
        >
          <button
            type="button"
            className={`button small${mode === 'today' ? '' : ' secondary'}`}
            aria-pressed={mode === 'today'}
            onClick={() => setChosenMode('today')}
          >
            {en ? 'Today' : 'Dzisiaj'} · {todayTrainings.length}
          </button>
          <button
            type="button"
            className={`button small${mode === 'single' ? '' : ' secondary'}`}
            aria-pressed={mode === 'single'}
            onClick={() => setChosenMode('single')}
          >
            {en ? 'Selected training' : 'Wybrany trening'}
          </button>
        </div>
      )}
      {mode === 'today' &&
        (todayTrainings.length ? (
          <ul className="equipment-panel__today muted">
            {todayTrainings.map((training) => (
              <li key={training.id}>
                {date(training.starts_at)} ·{' '}
                {
                  sections.find((section) => section.id === training.section_id)
                    ?.name
                }{' '}
                · {training.group_label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            {en ? 'No trainings today.' : 'Dziś nie ma treningów.'}
          </p>
        ))}
      {mode === 'single' && selected && (
        <label>
          {en ? 'Training' : 'Trening'}
          <select
            value={selected.id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {trainings.map((training) => (
              <option key={training.id} value={training.id}>
                {date(training.starts_at)} ·{' '}
                {
                  sections.find((section) => section.id === training.section_id)
                    ?.name
                }{' '}
                · {training.group_label}
              </option>
            ))}
          </select>
        </label>
      )}
      {loading && (
        <SwordsLoader
          language={language}
          label={en ? 'Loading declarations…' : 'Wczytuję deklaracje…'}
        />
      )}
      {Boolean(ids) && result.key === requestKey && result.error && (
        <div className="notice" role="status">
          <p>
            {result.error === 'permission'
              ? en
                ? 'An active administrator or coach account is required to view equipment declarations.'
                : 'Do podglądu deklaracji sprzętu wymagane jest aktywne konto administratora lub trenera.'
              : en
                ? 'Could not load equipment declarations. Check your connection and database deployment.'
                : 'Nie udało się wczytać deklaracji sprzętu. Sprawdź połączenie i wdrożenie bazy.'}
          </p>
          <button
            className="button secondary small"
            onClick={() => setReload((value) => value + 1)}
          >
            {en ? 'Retry' : 'Ponów'}
          </button>
        </div>
      )}
      {ready && (
        <>
          <h3>
            {en
              ? 'Club equipment to prepare'
              : 'Sprzęt klubowy do przygotowania'}{' '}
            · {roster.length - coachCount} {en ? 'booked' : 'zapisanych'}
            {coachCount > 0 &&
              ` + ${coachCount} ${en ? (coachCount === 1 ? 'coach' : 'coaches') : coachCount === 1 ? 'trener' : 'trenerów'}`}
          </h3>
          <p className="muted" role="status">
            {requirement
              ? `${
                  mode === 'today'
                    ? en
                      ? "Required for today's trainings"
                      : 'Potrzebny na dzisiejszych treningach'
                    : en
                      ? 'Required for this training'
                      : 'Potrzebny na ten trening'
                }: ${requiredEquipmentText(requirement, language)}.`
              : mode === 'today'
                ? en
                  ? 'At least one of today’s trainings has no required equipment set — all equipment is counted for its participants.'
                  : 'Co najmniej jeden dzisiejszy trening nie ma ustawionego potrzebnego sprzętu — dla jego uczestników liczony jest cały sprzęt.'
                : result.entries[0]?.requirement.status === 'error'
                  ? en
                    ? 'Could not read the equipment required for this training — all equipment is counted.'
                    : 'Nie udało się odczytać sprzętu potrzebnego na ten trening — liczony jest cały sprzęt.'
                  : en
                    ? 'Required equipment is not set for this training — all equipment is counted.'
                    : 'Na tym treningu nie ustawiono potrzebnego sprzętu — liczony jest cały sprzęt.'}
          </p>
          {!roster.length ? (
            <p className="muted">
              {mode === 'today'
                ? en
                  ? 'No active bookings for today’s trainings.'
                  : 'Brak aktywnych zapisów na dzisiejsze treningi.'
                : en
                  ? 'No active bookings for this training.'
                  : 'Brak aktywnych zapisów na ten trening.'}
            </p>
          ) : (
            <>
              {groups.map((group) => (
                <div className="equipment-summary-group" key={group.title}>
                  <h4>{group.title}</h4>
                  <div
                    className="equipment-table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label={group.title}
                  >
                    <table className="equipment-demand-table">
                      <thead>
                        <tr>
                          <th scope="col">{en ? 'Equipment' : 'Sprzęt'}</th>
                          <th scope="col">
                            {en ? 'Total needed' : 'Łącznie potrzebne'}
                          </th>
                          <th scope="col">
                            {en
                              ? 'Size breakdown / notes'
                              : 'Podział rozmiarowy / uwagi'}
                          </th>
                          <th scope="col">
                            {en ? 'Needs completion' : 'Do uzupełnienia'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map(
                          ({
                            catalog,
                            total,
                            coachTotal,
                            sizes,
                            unknown,
                            missingOwn,
                          }) => {
                            const Icon = equipmentIcons[catalog.item];
                            return (
                              <tr key={catalog.item}>
                                <th scope="row">
                                  <span className="equipment-table-label">
                                    <Icon />
                                    {en ? catalog.en : catalog.pl}
                                  </span>
                                </th>
                                <td className="equipment-quantity">
                                  {catalog.item === 'groin'
                                    ? '—'
                                    : `${total}${forCoach(coachTotal)}`}
                                </td>
                                <td>
                                  {catalog.item === 'groin' ? (
                                    <>
                                      <span>
                                        {en
                                          ? 'Own protector required; cannot be borrowed.'
                                          : 'Wymagany własny ochraniacz; nie można wypożyczyć.'}
                                      </span>
                                      {missingOwn > 0 && (
                                        <strong className="equipment-own-warning">
                                          {en
                                            ? 'Own protector not declared'
                                            : 'Brak deklaracji własnego'}
                                          : {missingOwn}
                                        </strong>
                                      )}
                                    </>
                                  ) : catalog.sizes.length ? (
                                    <div className="equipment-size-breakdown">
                                      {[...sizes]
                                        .sort(
                                          ([a], [b]) =>
                                            catalog.sizes.findIndex(
                                              (size) => size === a,
                                            ) -
                                            catalog.sizes.findIndex(
                                              (size) => size === b,
                                            ),
                                        )
                                        .map(([size, { count, coach }]) => (
                                          <span
                                            className="equipment-size-count"
                                            key={size}
                                          >
                                            {size}: <strong>{count}</strong>
                                            {forCoach(coach)}
                                          </span>
                                        ))}
                                      {!sizes.size && (
                                        <span className="muted">—</span>
                                      )}
                                    </div>
                                  ) : [
                                      'sabre',
                                      'sword_buckler',
                                      'longsword',
                                    ].includes(catalog.item) ? (
                                    '—'
                                  ) : en ? (
                                    'One size, unisex'
                                  ) : (
                                    'Jeden rozmiar, unisex'
                                  )}
                                </td>
                                <td>{unknown}</td>
                              </tr>
                            );
                          },
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <h3>
                {en ? 'Participant declarations' : 'Deklaracje uczestników'}
              </h3>
              {roster.map(({ person, needs, coach }) => (
                <details
                  key={person.participant_id}
                  className="equipment-person"
                >
                  <summary>
                    {person.name}
                    {coach && ` (${en ? 'coach' : 'trener'})`}
                  </summary>
                  <div
                    className="equipment-table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label={`${en ? 'Equipment' : 'Sprzęt'}: ${person.name}`}
                  >
                    <table className="equipment-declaration-table">
                      <thead>
                        <tr>
                          <th scope="col">{en ? 'Equipment' : 'Sprzęt'}</th>
                          <th scope="col">
                            {en ? 'Declaration' : 'Deklaracja'}
                          </th>
                          <th scope="col">{en ? 'Size' : 'Rozmiar'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {catalogRows
                          .filter(
                            (catalog) => !needs || needs.has(catalog.item),
                          )
                          .map((catalog) => {
                            const entry = person.equipment.find(
                              (item) => item.item === catalog.item,
                            );
                            const Icon = equipmentIcons[catalog.item];
                            return (
                              <tr key={catalog.item}>
                                <th scope="row">
                                  <span className="equipment-table-label">
                                    <Icon />
                                    {en ? catalog.en : catalog.pl}
                                  </span>
                                </th>
                                <td>
                                  {ownershipLabel(entry)}
                                  {catalog.item === 'groin' &&
                                    entry?.ownership !== 'own' && (
                                      <strong className="equipment-own-warning">
                                        {en
                                          ? 'Own protector required'
                                          : 'Wymagany własny ochraniacz'}
                                      </strong>
                                    )}
                                </td>
                                <td>
                                  {catalog.sizes.length &&
                                  (entry?.ownership === 'own' ||
                                    entry?.ownership === 'club')
                                    ? (entry.size ??
                                      (en
                                        ? 'Needs completion'
                                        : 'Do uzupełnienia'))
                                    : '—'}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
