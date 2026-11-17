import { warsawToday } from './lib/warsaw-date.ts';
import TrainingIconPicker from './TrainingIconPicker';
import { trainingIcon } from './lib/training-icons.ts';
import {
  readRpcPages,
  readAllPages,
  readTrainingPages,
  readCoachBookings,
  warsawMidnight,
} from './lib/pagination';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  X,
} from './placeholderIcons';
import type {
  Booking,
  CoachTrainingBooking,
  Participant,
  Section,
  Training,
} from './types/club';
import WeekGrid from './WeekGrid';
import { modalKeys } from './lib/modal-keys.ts';
import ClubEventsPanel from './ClubEventsPanel';
import CalendarFeedPanel from './CalendarFeedPanel';
import TrainingResponsesWithAvatars from './TrainingResponsesWithAvatars';
import {
  DuesBlockDialog,
  DuesNotice,
  isDuesLimitError,
  useDuesStatus,
} from './DuesBooking';
import type { TrainingResponsePerson } from './TrainingResponses';
import type { WeekDay, WeekEvent } from './WeekGrid';
import SwordsLoader from './SwordsLoader';
import {
  compareSections,
  sectionLabel,
  sectionVariant,
} from './lib/sections.ts';
import { equipmentLabel } from './lib/equipment-catalog.ts';
import { trainingColor } from './lib/training-colors.ts';
import { loadTrainingRequirement } from './lib/required-equipment.ts';
import type { RequirementResult } from './lib/required-equipment.ts';

const SECTION_FILTER_PREFIX = 'section:';
const COMPACT_SECTION_FILTER_LIMIT = 6;

// Data i godzina chwili w strefie Europe/Warsaw. Locale sv-SE daje format
// RRRR-MM-DD, który można porównywać jak tekst.
const localParts = (value: string) => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
};
// Arytmetyka na samych datach kalendarzowych; południe UTC sprawia, że
// zmiana czasu nie przesunie wyniku na sąsiedni dzień.
const dateAt = (date: string, dayIndex: number) => {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + dayIndex);
  return day.toISOString().slice(0, 10);
};

interface Props {
  client: SupabaseClient;
  canManage: boolean;
  isAdmin?: boolean;
  accountId?: string;
  isCoach: boolean;
  sections: Section[];
  participants: Participant[];
  trainings: Training[];
  bookings: Booking[];
  assignedSections: { participant_id: string; section_id: string }[];
  coachSectionIds: string[];
  coachBookings: CoachTrainingBooking[];
  language: 'pl' | 'en';
  onChanged: () => Promise<void>;
  weekStart?: string;
  onWeekChange?: (week: string) => void;
  onManageTrainings?: () => void;
  suspended?: boolean;
}

export default function CalendarPanel({
  client,
  canManage,
  isAdmin = false,
  accountId = '',
  isCoach,
  sections,
  participants,
  trainings: refreshTrainings,
  bookings,
  assignedSections,
  coachSectionIds,
  coachBookings: refreshCoachBookings,
  language,
  onChanged,
  weekStart,
  onWeekChange,
  onManageTrainings,
  suspended = false,
}: Props) {
  const [roster, setRoster] = useState<{
    trainingId: string;
    people: TrainingResponsePerson[];
    ownResponses?: { participant_id: string; response: 'yes' | 'no' }[];
    ownError?: boolean;
    error: boolean;
  } | null>(null);
  const en = language === 'en';
  const tr = (pl: string, english: string) => (en ? english : pl);
  // Tekstowy klucz listy uczestników: zależność efektów, która nie zmienia
  // się, gdy rodzic poda nową tablicę z tymi samymi osobami.
  const participantIds = participants
    .map((person) => person.id)
    .sort()
    .join(',');
  const [rosterRetry, setRosterRetry] = useState(0);
  // Kalendarz sam czyta wybrany tydzień (także miniony), niezależnie od listy
  // nadchodzących treningów z obszaru roboczego. weekGeneration odrzuca
  // odpowiedzi dla tygodnia, który przestał być wyświetlany.
  const weekGeneration = useRef(0);
  const [weekResult, setWeekResult] = useState<{
    key: string;
    trainings: Training[];
    coachBookings: CoachTrainingBooking[];
    error: boolean;
    iconAvailable: boolean;
  }>({
    iconAvailable: false,
    key: '',
    trainings: [],
    coachBookings: [],
    error: false,
  });
  const [weekRetry, setWeekRetry] = useState(0);
  const [participantId, setParticipantId] = useState('');
  const [editor, setEditor] = useState<Training | null>(null);
  const editorElement = useRef<HTMLElement>(null);
  const schedulePending = useRef(false);
  useEffect(() => {
    if (editor && !suspended) {
      editorElement.current?.focus();
    }
  }, [editor, suspended]);
  useEffect(() => {
    if (!editor || suspended || typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [editor, suspended]);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const coachBookingPending = useRef(false);
  const [message, setMessage] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [clubEvents, setClubEvents] = useState<WeekEvent[]>([]);
  const [selectedClubEvent, setSelectedClubEvent] = useState<string | null>(
    null,
  );
  const [selectedTraining, setSelectedTraining] = useState<Training | null>(
    null,
  );
  const calendarActive = useRef(true);
  useEffect(() => {
    calendarActive.current = true;
    return () => {
      calendarActive.current = false;
    };
  }, []);
  const selectedTrainingId = selectedTraining?.id ?? '';
  useEffect(() => {
    if (!selectedTrainingId) return;
    let current = true;
    void (async () => {
      try {
        const [responses, own] = await Promise.all([
          readRpcPages<TrainingResponsePerson>(
            (from, to) =>
              client.rpc('get_training_role_responses', {
                p_training_id: selectedTrainingId,
                p_offset: from,
                p_limit: to - from + 1,
              }),
            () => current,
          ),
          participantIds
            ? readAllPages(
                (from, to) =>
                  client
                    .from('training_bookings')
                    .select('participant_id,response')
                    .eq('training_id', selectedTrainingId)
                    .in('participant_id', participantIds.split(','))
                    .order('participant_id')
                    .range(from, to)
                    .returns<
                      { participant_id: string; response: 'yes' | 'no' }[]
                    >(),
                () => current,
                (row) => row.participant_id,
              )
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (current)
          setRoster({
            trainingId: selectedTrainingId,
            people: responses.data ?? [],
            ownResponses: own.data ?? [],
            ownError: Boolean(own.error),
            error:
              Boolean(responses.error) ||
              !(responses.data ?? []).every(
                (person) =>
                  typeof person.name === 'string' &&
                  (person.role === 'coach' || person.role === 'participant') &&
                  (person.response === 'yes' ||
                    person.response === 'no' ||
                    person.response === null),
              ),
          });
      } catch {
        if (current)
          setRoster({
            trainingId: selectedTrainingId,
            people: [],
            error: true,
          });
      }
    })();
    return () => {
      current = false;
    };
  }, [
    client,
    rosterRetry,
    selectedTrainingId,
    participantIds,
    refreshTrainings,
  ]);
  // Wybrany uczestnik; gdy zniknie z listy (np. po odświeżeniu), pierwszy.
  const selectedId = participants.some((person) => person.id === participantId)
    ? participantId
    : (participants[0]?.id ?? '');
  // Dla trenera wymagany sprzęt jest czytany bez wskazania uczestnika.
  const requirementParticipant = isCoach ? '' : selectedId;
  const requirementKey = selectedTrainingId
    ? `${selectedTrainingId}:${requirementParticipant}`
    : '';
  const [requirement, setRequirement] = useState<{
    key: string;
    result: RequirementResult;
  } | null>(null);
  useEffect(() => {
    if (!selectedTrainingId) return;
    let current = true;
    const key = `${selectedTrainingId}:${requirementParticipant}`;
    void loadTrainingRequirement(
      client,
      selectedTrainingId,
      requirementParticipant || null,
    ).then((result) => {
      if (current) setRequirement({ key, result });
    });
    return () => {
      current = false;
    };
  }, [client, selectedTrainingId, requirementParticipant, refreshTrainings]);
  const chosenRequirement =
    requirement && requirement.key === requirementKey
      ? requirement.result
      : null;
  const [duesRefresh, setDuesRefresh] = useState(0);
  const [duesBlocked, setDuesBlocked] = useState(false);
  const duesStatus = useDuesStatus(
    client,
    selectedId,
    Boolean(selectedTrainingId) && !isCoach,
    duesRefresh,
  );
  const selectedChild =
    participants.find((person) => person.id === selectedId)?.category ===
    'child';
  const editing = editor;
  const today = warsawToday();
  const mondayOffset = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const currentMonday = dateAt(today, -mondayOffset);
  // Tydzień pochodzi z adresu URL (weekStart); lokalny weekOffset działa
  // tylko wtedy, gdy rodzic nie steruje tygodniem.
  const startDate = weekStart ?? dateAt(currentMonday, weekOffset * 7);
  const changeWeek = (date: string) => {
    if (onWeekChange) onWeekChange(date);
    else
      setWeekOffset(
        Math.round((Date.parse(date) - Date.parse(currentMonday)) / 604800000),
      );
  };
  const weekDates = Array.from({ length: 7 }, (_, index) =>
    dateAt(startDate, index),
  );
  const endDate = dateAt(startDate, 7);
  // weekRetry w kluczu wymusza ponowny odczyt tego samego tygodnia po zapisie.
  const weekKey = `${startDate}:${weekRetry}`;
  useEffect(() => {
    const generation = ++weekGeneration.current;
    let active = true;
    const isCurrent = () => active && generation === weekGeneration.current;
    void (async () => {
      const trainings = await readTrainingPages(
        (from, to, includeIcon) =>
          client
            .from('trainings')
            .select(
              `id,section_id,starts_at,ends_at,group_label,location,coach_label,coach_account_id,series_id,canceled${includeIcon ? ',icon' : ''}`,
            )
            .gte('starts_at', warsawMidnight(startDate))
            .lt('starts_at', warsawMidnight(endDate))
            .order('starts_at')
            .order('id')
            .range(from, to)
            .returns<Training[]>(),
        isCurrent,
        (row) => row.id,
      );
      if (!isCurrent()) return;
      const coaches = trainings.error
        ? { data: null, error: trainings.error }
        : await readCoachBookings(
            client,
            (trainings.data ?? []).map((training) => training.id),
            isCurrent,
          );
      if (!isCurrent()) return;
      if (!trainings.error && !coaches.error)
        setSelectedTraining((current) =>
          current
            ? ((trainings.data ?? []).find(
                (training) => training.id === current.id,
              ) ?? null)
            : null,
        );
      setWeekResult({
        key: weekKey,
        trainings:
          trainings.error || coaches.error ? [] : (trainings.data ?? []),
        coachBookings: coaches.data ?? [],
        error: Boolean(trainings.error || coaches.error),
        iconAvailable: trainings.iconAvailable,
      });
    })();
    return () => {
      active = false;
    };
  }, [
    client,
    startDate,
    endDate,
    weekKey,
    refreshTrainings,
    refreshCoachBookings,
  ]);
  // Wynik innego klucza to dane poprzedniego tygodnia: zamiast nich pokazujemy
  // stan ładowania.
  const weekLoading = weekResult.key !== weekKey;
  const weekTrainings = weekLoading ? [] : weekResult.trainings;
  const coachBookings = weekLoading ? [] : weekResult.coachBookings;
  // Kolor bloku jest zapisany w serii, nie w pojedynczym terminie, więc
  // doczytujemy go osobno dla serii widocznych w tym tygodniu.
  const seriesKey = [
    ...new Set(
      weekTrainings
        .map((training) => training.series_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
    .sort()
    .join(',');
  const [seriesColors, setSeriesColors] = useState<{
    key: string;
    colors: Record<string, string | null>;
  }>({ key: '', colors: {} });
  useEffect(() => {
    if (!seriesKey) return;
    let current = true;
    void Promise.resolve(
      client
        .from('training_series')
        .select('id,color')
        .in('id', seriesKey.split(',')),
    )
      .then(({ data, error }) => {
        if (!current || error || !Array.isArray(data)) return;
        setSeriesColors({
          key: seriesKey,
          colors: Object.fromEntries(
            (data as { id: unknown; color: unknown }[])
              .filter((row) => typeof row.id === 'string')
              .map((row) => [row.id as string, trainingColor(row.color)]),
          ),
        });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [client, seriesKey, refreshTrainings]);
  const occurrenceColor = (training: Training) =>
    training.series_id && seriesColors.key === seriesKey
      ? (seriesColors.colors[training.series_id] ?? null)
      : null;
  const sectionFilters = [...sections].sort(compareSections);
  const filteredSectionId = filter.startsWith(SECTION_FILTER_PREFIX)
    ? filter.slice(SECTION_FILTER_PREFIX.length)
    : null;
  const visibleTrainings = weekTrainings.filter((training) => {
    const group = training.group_label.toLocaleLowerCase('pl-PL');
    if (filteredSectionId !== null)
      return training.section_id === filteredSectionId;
    if (filter === 'leading') return training.coach_account_id === accountId;
    if (filter === 'available')
      return (
        !training.canceled &&
        new Date(training.starts_at) > new Date() &&
        (isCoach ||
          assignedSections.some(
            (item) =>
              item.participant_id === selectedId &&
              item.section_id === training.section_id,
          )) &&
        !(isCoach
          ? coachBookings.some(
              (item) =>
                item.training_id === training.id && item.is_self && item.active,
            )
          : bookings.some(
              (item) =>
                item.training_id === training.id &&
                item.participant_id === selectedId &&
                item.active,
            ))
      );
    // Filtry „wolne walki” i „początkujący” opierają się na nazwie grupy.
    if (filter === 'sparring')
      return group.includes('wolne walki') || group.includes('sparring');
    if (filter === 'beginner')
      return (
        group.includes('począt') ||
        group.includes('poczat') ||
        group.includes('beginner')
      );
    return true;
  });
  const weekLabel = `${new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'pl-PL', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${weekDates[0]}T12:00:00Z`))} – ${new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'pl-PL', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${weekDates[weekDates.length - 1]}T12:00:00Z`))}`;

  const weekdays =
    language === 'en'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'];
  const days: WeekDay[] = weekDates.map((date, index) => ({
    weekday: weekdays[index],
    date,
    isToday: date === today,
  }));
  const minutes = (time: string) => {
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + minute;
  };
  const events: WeekEvent[] = visibleTrainings.map((training) => {
    const start = localParts(training.starts_at);
    const end = localParts(training.ends_at);
    return {
      id: training.id,
      dayIndex: weekDates.indexOf(start.date),
      startMin: minutes(start.time),
      endMin: minutes(end.time),
      title:
        sections.find((section) => section.id === training.section_id)?.name ??
        (language === 'en' ? 'Section' : 'Sekcja'),
      subtitle: `${start.time}–${end.time} · ${training.group_label}`,
      icon: training.icon,
      variant: sectionVariant(training.section_id),
      color: occurrenceColor(training),
      canceled: training.canceled,
      booked: bookings.some(
        (item) =>
          item.training_id === training.id &&
          item.participant_id === selectedId &&
          item.active,
      ),
      coachSection: isCoach && coachSectionIds.includes(training.section_id),
      coachBooked: coachBookings.some(
        (item) =>
          item.training_id === training.id && item.is_self && item.active,
      ),
      past: new Date(training.ends_at) <= new Date(),
      leading: training.coach_account_id === accountId,
    };
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? '').trim();
    if (text('end') <= text('start')) {
      setMessage(
        tr(
          'Koniec treningu musi być późniejszy od początku.',
          'Training must end after it starts.',
        ),
      );
      return;
    }
    if (
      !editing ||
      !canManage ||
      editing.canceled ||
      new Date(editing.starts_at) <= new Date()
    )
      return;
    const payload = {
      p_training_id: editing.id,
      p_date: text('date'),
      p_start: text('start'),
      p_end: text('end'),
      p_group: text('group'),
      p_location: text('location'),
      p_coach: editing.coach_label,
      ...(isAdmin && weekResult.iconAvailable
        ? { p_icon: trainingIcon(text('icon')) }
        : {}),
    };
    await saveSchedule('update_training', payload);
  };
  // Wynik: 'saved' (zapis potwierdzony, nawet jeśli odświeżenie zawiodło),
  // 'rejected' (baza odmówiła) lub 'unknown' (połączenie zerwane przed
  // odpowiedzią, więc stan zapisu jest nieznany).
  const saveSchedule = async (
    rpc: string,
    payload: object,
  ): Promise<'saved' | 'rejected' | 'unknown'> => {
    if (schedulePending.current) return 'rejected';
    schedulePending.current = true;
    let saved = false;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await client.rpc(rpc, payload);
      if (error) {
        setMessage(
          tr(
            'Nie udało się zapisać treningu. Sprawdź dane i uprawnienia.',
            'Could not save the training. Check the details and permissions.',
          ),
        );
        return 'rejected';
      }
      saved = true;
      setEditor(null);
      setWeekRetry((value) => value + 1);
      await onChanged();
      setMessage(
        tr('Zapisano harmonogram w bazie klubu.', 'Club schedule saved.'),
      );
      return 'saved';
    } catch {
      setMessage(
        tr(
          saved
            ? 'Zapisano trening, ale odświeżenie nie powiodło się. Odśwież dane.'
            : 'Połączenie zostało przerwane. Odśwież harmonogram przed ponownym zapisem.',
          saved
            ? 'Training saved, but refresh failed. Reload the data.'
            : 'Connection lost. Refresh the schedule before saving again.',
        ),
      );
      return saved ? 'saved' : 'unknown';
    } finally {
      schedulePending.current = false;
      if (calendarActive.current) setBusy(false);
    }
  };
  const booking = async (training: Training, response: 'yes' | 'no' | null) => {
    if (!selectedId || busy) return;
    if (response === 'yes' && duesStatus?.blocked) {
      setDuesBlocked(true);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const { error } = await client.rpc('set_training_booking', {
        p_training_id: training.id,
        p_participant_id: selectedId,
        p_response: response,
      });
      // Limit zaległości egzekwuje baza; tu tylko pokazujemy okno z wyjaśnieniem.
      if (isDuesLimitError(error)) {
        setDuesBlocked(true);
        setDuesRefresh((value) => value + 1);
      } else if (error?.hint === 'equipment_unavailable') {
        // Baza odrzuca zapis, gdy pożyczany sprzęt klubu jest już zarezerwowany.
        const [item, size] = (error.details ?? '').split(':');
        const label = `${equipmentLabel(item, language)}${size ? ` ${size}` : ''}`;
        setMessage(
          tr(
            `Brak wolnego sprzętu klubowego na ten termin: ${label}. Wszystkie sztuki są już zarezerwowane.`,
            `No club equipment left for this session: ${label}. Every piece is already reserved.`,
          ),
        );
      } else if (error) {
        setMessage(
          error.message.includes('not assigned')
            ? tr(
                'Zapis jest możliwy na sekcje przypisane do uczestnika.',
                'You can sign up for sections assigned to this participant.',
              )
            : tr(
                'Nie udało się zmienić zapisu. Sprawdź, czy uczestnik ma aktywne powiązanie z kontem.',
                'Could not change the signup. Check that the participant is actively linked to this account.',
              ),
        );
      } else {
        setRosterRetry((value) => value + 1);
        setDuesRefresh((value) => value + 1);
        await onChanged();
        setMessage(
          response === 'yes'
            ? tr('Zgłoszono: będę.', 'Response saved: attending.')
            : response === 'no'
              ? tr('Zgłoszono: nie będę.', 'Response saved: not attending.')
              : tr('Wycofano odpowiedź.', 'Response withdrawn.'),
        );
      }
    } catch {
      setMessage(
        tr('Brak połączenia. Spróbuj ponownie.', 'Connection lost. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  };
  const coachBooking = async (
    training: Training,
    response: 'yes' | 'no' | null,
  ) => {
    if (!isCoach || busy || coachBookingPending.current) return;
    coachBookingPending.current = true;
    setBusy(true);
    setMessage('');
    let confirmed = false;
    const active = response === null ? null : response === 'yes';
    try {
      const { data, error } = await client.rpc('set_coach_training_booking', {
        p_training_id: training.id,
        p_active: active,
      });
      // RPC zwraca zapisany stan; inna wartość oznacza, że zapis nie doszedł.
      if (error || data !== active) {
        setMessage(
          tr(
            'Nie udało się zmienić odpowiedzi. Odśwież dane i spróbuj ponownie.',
            'Could not update your response. Refresh and try again.',
          ),
        );
        return;
      }
      confirmed = true;
      setRosterRetry((value) => value + 1);
      setWeekRetry((value) => value + 1);
      await onChanged();
      setMessage(
        response === null
          ? tr('Anulowano zapis.', 'Signup canceled.')
          : response === 'yes'
            ? tr('Zgłoszono: będę.', 'Response saved: attending.')
            : tr('Zgłoszono: nie będę.', 'Response saved: not attending.'),
      );
    } catch {
      setMessage(
        confirmed
          ? tr(
              'Odpowiedź zapisana. Odśwież dane, aby pobrać aktualny stan.',
              'Response saved. Refresh data to load the current state.',
            )
          : tr(
              'Brak połączenia. Odśwież dane przed ponowieniem.',
              'Connection lost. Refresh data before trying again.',
            ),
      );
    } finally {
      coachBookingPending.current = false;
      if (calendarActive.current) setBusy(false);
    }
  };
  const cancel = async (training: Training) => {
    if (
      busy ||
      !window.confirm(
        tr(
          'Odwołać ten trening? Aktywne zapisy zostaną anulowane.',
          'Cancel this training? Active signups will be canceled.',
        ),
      )
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await client.rpc('cancel_training', {
        p_training_id: training.id,
      });
      if (error)
        setMessage(
          tr(
            'Nie udało się odwołać treningu.',
            'Could not cancel the training.',
          ),
        );
      else {
        await onChanged();
        setSelectedTraining(null);
        setMessage(
          tr(
            'Trening odwołano wraz z zapisami.',
            'Training and signups canceled.',
          ),
        );
      }
    } catch {
      setMessage(
        tr('Brak połączenia. Spróbuj ponownie.', 'Connection lost. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const chosen = selectedTraining;
  const chosenSection = chosen
    ? sections.find((item) => item.id === chosen.section_id)
    : null;
  const chosenCoachBooking = chosen
    ? coachBookings.find(
        (item) => item.training_id === chosen.id && item.is_self,
      )
    : undefined;
  const rosterLoading = Boolean(chosen && roster?.trainingId !== chosen.id);
  const chosenRoster =
    chosen && roster?.trainingId === chosen.id ? roster : null;
  const chosenResponse = chosenRoster?.ownResponses?.find(
    (person) => person.participant_id === selectedId,
  )?.response;

  return (
    <>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <section className="panel">
        <div className="panel-heading calendar-heading">
          <div>
            <span className="eyebrow">
              {tr('HARMONOGRAM KLUBU', 'CLUB SCHEDULE')}
            </span>
            <h2>{tr('Kalendarz treningów', 'Training calendar')}</h2>
          </div>
          <div className="calendar-heading__actions">
            <CalendarFeedPanel
              client={client}
              language={language}
              suspended={suspended}
            />
            {canManage && onManageTrainings && (
              <button
                className="button secondary small"
                onClick={onManageTrainings}
              >
                <CalendarDays size={15} /> {tr('Treningi', 'Trainings')}
              </button>
            )}
          </div>
        </div>
        {!isCoach && participants.length > 0 && (
          <label>
            {tr('Uczestnik do zapisu', 'Participant to sign up')}
            <select
              value={selectedId}
              onChange={(event) => setParticipantId(event.target.value)}
            >
              {participants.map((person) => (
                <option value={person.id} key={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="calendar-toolbar">
          <button
            className="icon-button week-nav"
            aria-label={
              language === 'en' ? 'Previous week' : 'Poprzedni tydzień'
            }
            onClick={() => changeWeek(dateAt(startDate, -7))}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="text-button"
            disabled={startDate === currentMonday}
            onClick={() => changeWeek(currentMonday)}
          >
            {language === 'en' ? 'Today' : 'Dziś'}
          </button>
          <strong className="week-range">{weekLabel}</strong>
          <button
            className="icon-button week-nav"
            aria-label={language === 'en' ? 'Next week' : 'Następny tydzień'}
            onClick={() => changeWeek(dateAt(startDate, 7))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div
          className="calendar-filters"
          role="group"
          aria-label={
            language === 'en' ? 'Training filters' : 'Filtry treningów'
          }
        >
          {[
            ['all', language === 'en' ? 'All' : 'Wszystkie'],
            ...(isCoach
              ? [
                  [
                    'leading',
                    language === 'en'
                      ? 'Trainings I lead'
                      : 'Prowadzone przeze mnie',
                  ],
                ]
              : []),
            [
              'available',
              language === 'en' ? 'I can join' : 'Mogę się zapisać',
            ],
            ['sparring', language === 'en' ? 'Free sparring' : 'Wolne walki'],
            ['beginner', language === 'en' ? 'Beginners' : 'Początkujący'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={filter === key ? 'active' : ''}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
          {sectionFilters.length > 0 &&
            (sectionFilters.length <= COMPACT_SECTION_FILTER_LIMIT ? (
              <div
                className="calendar-filters__sections"
                role="group"
                aria-label={language === 'en' ? 'Sections' : 'Sekcje'}
              >
                {sectionFilters.map((section) => {
                  const key = SECTION_FILTER_PREFIX + section.id;
                  return (
                    <button
                      key={key}
                      className={filter === key ? 'active' : ''}
                      aria-pressed={filter === key}
                      onClick={() => setFilter(key)}
                    >
                      {sectionLabel(section, sections, language)}
                    </button>
                  );
                })}
              </div>
            ) : (
              <label className="calendar-filters__select">
                {language === 'en' ? 'Section' : 'Sekcja'}
                <select
                  value={filteredSectionId ?? ''}
                  onChange={(event) =>
                    setFilter(
                      event.target.value
                        ? SECTION_FILTER_PREFIX + event.target.value
                        : 'all',
                    )
                  }
                >
                  <option value="">
                    {language === 'en' ? 'All sections' : 'Wszystkie sekcje'}
                  </option>
                  {sectionFilters.map((section) => (
                    <option key={section.id} value={section.id}>
                      {sectionLabel(section, sections, language)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
        {!weekLoading && !weekResult.error && !weekTrainings.length && (
          <div className="empty-state">
            <CalendarDays size={33} />
            <h2>
              {language === 'en'
                ? 'No trainings this week.'
                : 'Brak treningów w tym tygodniu.'}
            </h2>
            <p>
              {tr(
                'Administrator lub zarząd może dodać pojedynczy termin albo cotygodniowy cykl.',
                'An administrator or board member can add a single training or a weekly series.',
              )}
            </p>
          </div>
        )}
        {weekLoading && (
          <SwordsLoader
            language={language}
            label={language === 'en' ? 'Loading week…' : 'Wczytuję tydzień…'}
          />
        )}
        {!weekLoading && weekResult.error && (
          <p className="notice" role="alert">
            {language === 'en'
              ? 'Could not load the complete week.'
              : 'Nie udało się wczytać całego tygodnia.'}
            <button
              className="text-button"
              onClick={() => setWeekRetry((value) => value + 1)}
            >
              {language === 'en' ? 'Retry' : 'Spróbuj ponownie'}
            </button>
          </p>
        )}
        <WeekGrid
          days={days}
          events={[...events, ...clubEvents]}
          language={language}
          onSelect={(id) => {
            if (id.startsWith('club-event:'))
              setSelectedClubEvent(id.slice('club-event:'.length));
            else
              setSelectedTraining(
                visibleTrainings.find((training) => training.id === id) ?? null,
              );
          }}
        />
        <ClubEventsPanel
          client={client}
          startDate={startDate}
          participants={participants}
          isAdmin={isAdmin}
          language={language}
          onEventsChange={setClubEvents}
          selectedEventId={selectedClubEvent}
        />
        {isCoach && (
          <p className="coach-calendar-legend">
            {language === 'en'
              ? 'Purple outline: your assigned section. Green edge: you are attending.'
              : 'Fioletowy obrys: Twoja przypisana sekcja. Zielona krawędź: zgłosiłeś udział.'}
          </p>
        )}
        {!weekLoading &&
          !weekResult.error &&
          weekTrainings.length > 0 &&
          !visibleTrainings.length && (
            <p className="muted">
              {language === 'en'
                ? 'No training matches this filter in the selected week.'
                : 'Brak treningów pasujących do filtra w wybranym tygodniu.'}
            </p>
          )}
        <p className="muted">
          <Clock3 size={12} /> Europe/Warsaw ·{' '}
          {isCoach
            ? tr(
                'Możesz zgłosić udział w dowolnym treningu.',
                'You can join any training.',
              )
            : tr(
                'Zapisy na przypisane sekcje.',
                'Signups for assigned sections.',
              )}{' '}
          {tr(
            'Kliknij trening, aby się zapisać.',
            'Select a training to sign up.',
          )}
        </p>
      </section>
      {chosen && (
        <div
          className="week-modal-backdrop"
          role="presentation"
          onClick={() => setSelectedTraining(null)}
        >
          <section
            className="week-modal"
            role="dialog"
            aria-modal="true"
            aria-label={tr('Szczegóły treningu', 'Training details')}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <span className="eyebrow">
                  {chosenSection?.name ?? tr('Sekcja', 'Section')}
                </span>
                <h2>{chosen.group_label}</h2>
              </div>
              <button
                className="icon-button"
                aria-label={tr('Zamknij szczegóły', 'Close details')}
                onClick={() => setSelectedTraining(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              <CalendarDays size={14} />{' '}
              {new Intl.DateTimeFormat(en ? 'en-GB' : 'pl-PL', {
                timeZone: 'Europe/Warsaw',
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              }).format(new Date(chosen.starts_at))}{' '}
              · {localParts(chosen.starts_at).time}–
              {localParts(chosen.ends_at).time}
            </p>
            <p className="muted">
              <MapPin size={13} /> {chosen.location} ·{' '}
              {chosen.coach_account_id
                ? `${tr('Główny trener', 'Main coach')}: ${chosen.coach_label}`
                : tr('Główny trener nieprzypisany', 'No main coach assigned')}
            </p>
            {chosenRequirement?.status === 'ready' &&
              chosenRequirement.requirement.configured && (
                <section
                  className="training-required-equipment"
                  aria-labelledby="training-required-equipment-title"
                >
                  <h3 id="training-required-equipment-title">
                    {tr('Potrzebny sprzęt', 'Required equipment')}
                  </h3>
                  {chosenRequirement.requirement.items.length ? (
                    <ul>
                      {chosenRequirement.requirement.items.map((entry) => (
                        <li key={entry.item}>
                          <span>{equipmentLabel(entry.item, language)}</span>
                          {entry.ownership && (
                            <small
                              className={
                                entry.ownership === 'own'
                                  ? 'is-own'
                                  : 'is-missing'
                              }
                            >
                              {entry.ownership === 'own'
                                ? tr('masz własny', 'you have your own')
                                : entry.item === 'groin'
                                  ? tr(
                                      'wymagany własny — klub nie wypożycza',
                                      'your own is required — not lent by the club',
                                    )
                                  : tr('sprzęt klubowy', 'club equipment')}
                            </small>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">
                      {tr(
                        'Na ten trening nie jest potrzebny sprzęt.',
                        'No equipment is needed for this training.',
                      )}
                    </p>
                  )}
                </section>
              )}
            {chosenRequirement?.status === 'error' && (
              <p className="muted">
                {tr(
                  'Nie udało się wczytać potrzebnego sprzętu.',
                  'Could not load the required equipment.',
                )}
              </p>
            )}
            {chosen.canceled && (
              <p className="badge">
                {tr('Trening odwołany', 'Training canceled')}
              </p>
            )}
            {isCoach && !chosen.canceled && (
              <div className="coach-booking-control">
                <p className="muted">
                  {chosenCoachBooking
                    ? chosenCoachBooking.active
                      ? tr('Zgłosiłeś: będę.', 'You are attending.')
                      : tr('Zgłosiłeś: nie będę.', 'You are not attending.')
                    : tr(
                        'Nie zgłosiłeś jeszcze odpowiedzi.',
                        'You have not responded yet.',
                      )}
                </p>
                <div className="training-actions">
                  {(['yes', 'no', null] as const).map((response) => {
                    const selected =
                      response === null
                        ? !chosenCoachBooking
                        : chosenCoachBooking?.active === (response === 'yes');
                    return (
                      <button
                        key={response ?? 'none'}
                        className={`button ${response === 'yes' && selected ? '' : 'secondary'}`}
                        aria-pressed={selected}
                        disabled={
                          busy ||
                          rosterLoading ||
                          weekLoading ||
                          Boolean(chosenRoster?.ownError) ||
                          new Date(chosen.starts_at) <= new Date() ||
                          (response === null && !chosenCoachBooking)
                        }
                        onClick={() => void coachBooking(chosen, response)}
                      >
                        {response === 'yes'
                          ? tr('Będę', 'I will attend')
                          : response === 'no'
                            ? tr('Nie będę', 'I will not attend')
                            : tr('Anuluj zapis', 'Cancel signup')}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {!isCoach && chosenRoster?.ownError && (
              <p role="alert">
                {tr(
                  'Nie udało się sprawdzić Twojej odpowiedzi. Odśwież listę.',
                  'Could not check your response. Reload the list.',
                )}
              </p>
            )}
            {!isCoach && !chosen.canceled && selectedId && (
              <DuesNotice
                status={duesStatus}
                child={selectedChild}
                language={language}
              />
            )}
            {!isCoach &&
              !chosen.canceled &&
              (selectedId ? (
                <div className="training-actions">
                  <button
                    className={`button ${chosenResponse === 'yes' ? '' : 'secondary'}`}
                    aria-pressed={chosenResponse === 'yes'}
                    disabled={
                      busy ||
                      rosterLoading ||
                      Boolean(chosenRoster?.ownError) ||
                      new Date(chosen.starts_at) <= new Date()
                    }
                    onClick={() => void booking(chosen, 'yes')}
                  >
                    <Check size={15} />{' '}
                    {language === 'en' ? 'I will attend' : 'Będę'}
                  </button>
                  <button
                    className={`button ${chosenResponse === 'no' ? '' : 'secondary'}`}
                    aria-pressed={chosenResponse === 'no'}
                    disabled={
                      busy ||
                      rosterLoading ||
                      Boolean(chosenRoster?.ownError) ||
                      new Date(chosen.starts_at) <= new Date()
                    }
                    onClick={() => void booking(chosen, 'no')}
                  >
                    {language === 'en' ? 'I will not attend' : 'Nie będę'}
                  </button>
                  <button
                    className="text-button"
                    aria-pressed={chosenResponse == null}
                    disabled={
                      busy ||
                      rosterLoading ||
                      chosenResponse == null ||
                      Boolean(chosenRoster?.ownError) ||
                      new Date(chosen.starts_at) <= new Date()
                    }
                    onClick={() => void booking(chosen, null)}
                  >
                    {language === 'en' ? 'Cancel signup' : 'Anuluj zapis'}
                  </button>
                </div>
              ) : (
                <p className="muted">
                  {tr(
                    'Konto nie jest powiązane z uczestnikiem — zapisu może dokonać administrator.',
                    'This account is not linked to a participant. An administrator can sign them up.',
                  )}
                </p>
              ))}
            <TrainingResponsesWithAvatars
              client={client}
              trainingId={chosen.id}
              language={language}
              people={chosenRoster?.people ?? []}
              loading={rosterLoading}
              error={Boolean(chosenRoster?.error)}
              onRetry={() => setRosterRetry((value) => value + 1)}
            />
            {canManage &&
              !chosen.canceled &&
              new Date(chosen.starts_at) > new Date() && (
                <div className="training-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setEditor(chosen);
                      setSelectedTraining(null);
                    }}
                  >
                    {tr('Edytuj', 'Edit')}
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void cancel(chosen)}
                  >
                    {tr('Odwołaj', 'Cancel training')}
                  </button>
                </div>
              )}
          </section>
        </div>
      )}
      {duesBlocked && (
        <DuesBlockDialog
          status={duesStatus}
          child={selectedChild}
          language={language}
          onClose={() => setDuesBlocked(false)}
        />
      )}
      {editing && (
        <div className="week-modal-backdrop">
          <section
            className="week-modal week-modal--editor"
            ref={editorElement}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={tr('Edytuj trening', 'Edit training')}
            onKeyDown={(event) =>
              modalKeys(event, busy ? null : () => setEditor(null))
            }
          >
            <div className="panel-heading">
              <h2>{tr('Edytuj trening', 'Edit training')}</h2>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                {tr('Zamknij', 'Close')}
              </button>
            </div>
            {message && (
              <p className="notice" role="status">
                {message}
              </p>
            )}
            <p className="muted">
              {editing.coach_account_id
                ? `${tr('Główny trener', 'Main coach')}: ${editing.coach_label}`
                : tr('Główny trener nieprzypisany', 'No main coach assigned')}
            </p>
            {onManageTrainings && (
              <button
                className="text-button"
                disabled={busy}
                onClick={onManageTrainings}
              >
                {tr(
                  'Zmień regularny trening w zakładce Treningi',
                  'Manage this regular training in Trainings',
                )}
              </button>
            )}
            <form key={editing.id} onSubmit={submit}>
              <fieldset disabled={busy}>
                <legend className="visually-hidden">
                  {tr('Dane tego terminu', 'Occurrence details')}
                </legend>
                <div className="form-grid">
                  <label>
                    {tr('Sekcja', 'Section')}
                    <input
                      disabled
                      value={
                        sections.find(
                          (section) => section.id === editing.section_id,
                        )?.name ?? editing.section_id
                      }
                    />
                  </label>
                  <label>
                    {tr('Grupa / poziom', 'Group / tier')}
                    <input
                      name="group"
                      maxLength={120}
                      defaultValue={editing.group_label}
                      required
                    />
                  </label>
                  <label>
                    {tr('Data', 'Date')}
                    <input
                      type="date"
                      name="date"
                      defaultValue={localParts(editing.starts_at).date}
                      required
                    />
                  </label>
                  <label>
                    {tr('Od', 'From')}
                    <input
                      type="time"
                      name="start"
                      defaultValue={localParts(editing.starts_at).time}
                      required
                    />
                  </label>
                  <label>
                    {tr('Do', 'Until')}
                    <input
                      type="time"
                      name="end"
                      defaultValue={localParts(editing.ends_at).time}
                      required
                    />
                  </label>
                  <label>
                    {tr('Sala / miejsce', 'Room / location')}
                    <input
                      name="location"
                      maxLength={200}
                      defaultValue={editing.location}
                      required
                    />
                  </label>
                </div>
                {isAdmin && weekResult.iconAvailable && (
                  <TrainingIconPicker
                    language={language}
                    value={editing.icon}
                  />
                )}
                <button className="button" disabled={busy}>
                  {busy
                    ? tr('Zapisuję…', 'Saving…')
                    : tr('Zapisz dla tego treningu', 'Save for this training')}
                </button>
              </fieldset>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
