import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Participant } from './types/club';
import type { WeekEvent } from './WeekGrid';
import { readAllPages, warsawMidnight } from './lib/pagination';
import SwordsLoader from './SwordsLoader';

type ClubEvent = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  location: string;
  canceled: boolean;
};
type EventBooking = {
  event_id: string;
  participant_id: string;
  response: 'yes' | 'no';
};
const parts = (iso: string) => {
  const fields = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (name: string) =>
    fields.find((part) => part.type === name)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
};
const nextWeek = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 7);
  return day.toISOString().slice(0, 10);
};

export default function ClubEventsPanel({
  client,
  startDate,
  participants,
  isAdmin,
  language,
  onEventsChange,
  selectedEventId,
}: {
  client: SupabaseClient;
  startDate: string;
  participants: Participant[];
  isAdmin: boolean;
  language: 'pl' | 'en';
  onEventsChange?: (events: WeekEvent[]) => void;
  selectedEventId?: string | null;
}) {
  const en = language === 'en';
  const tr = (pl: string, english: string) => (en ? english : pl);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [bookings, setBookings] = useState<EventBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ClubEvent | 'new' | null>(null);
  const [participantId, setParticipantId] = useState('');
  const revision = useRef(0);
  const pending = useRef(false);
  const eventElements = useRef<Record<string, HTMLElement | null>>({});
  const requestId = useRef<string | null>(null);
  const ids = participants
    .map((person) => person.id)
    .sort()
    .join(',');
  const read = useCallback(async () => {
    const version = ++revision.current;
    const current = () => version === revision.current;
    setLoading(true);
    setError('');
    setEvents([]);
    setBookings([]);
    try {
      const eventResult = await readAllPages(
        (from, to) =>
          client
            .from('club_events')
            .select('id,name,starts_at,ends_at,location,canceled')
            .gte('starts_at', warsawMidnight(startDate))
            .lt('starts_at', warsawMidnight(nextWeek(startDate)))
            .order('starts_at')
            .order('id')
            .range(from, to)
            .returns<ClubEvent[]>(),
        current,
        (row) => row.id,
      );
      if (eventResult.error) throw eventResult.error;
      const bookingResult = ids
        ? await readAllPages(
            (from, to) =>
              client
                .from('club_event_bookings')
                .select('event_id,participant_id,response')
                .in('participant_id', ids.split(','))
                .order('event_id')
                .order('participant_id')
                .range(from, to)
                .returns<EventBooking[]>(),
            current,
            (row) => `${row.event_id}:${row.participant_id}`,
          )
        : { data: [], error: null };
      if (bookingResult.error) throw bookingResult.error;
      if (current()) {
        setNow(Date.now());
        setEvents(eventResult.data ?? []);
        setBookings(bookingResult.data ?? []);
      }
    } catch {
      if (current()) {
        setEvents([]);
        setBookings([]);
        setError(
          en ? 'Could not load events.' : 'Nie udało się wczytać wydarzeń.',
        );
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [client, startDate, ids, en]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return read();
    });
    const generation = revision;
    return () => {
      active = false;
      ++generation.current;
    };
  }, [read]);
  useEffect(() => {
    if (!onEventsChange) return;
    const start = Date.parse(`${startDate}T12:00:00Z`);
    onEventsChange(
      events.map((event) => {
        const begin = parts(event.starts_at);
        const end = parts(event.ends_at);
        const [startHour, startMinute] = begin.time.split(':').map(Number);
        const [endHour, endMinute] = end.time.split(':').map(Number);
        return {
          id: `club-event:${event.id}`,
          dayIndex: Math.round(
            (Date.parse(`${begin.date}T12:00:00Z`) - start) / 86400000,
          ),
          startMin: startHour * 60 + startMinute,
          endMin: endHour * 60 + endMinute,
          title: event.name,
          subtitle: `${begin.time}–${end.time} · ${event.location}`,
          variant: 'event',
          canceled: event.canceled,
          booked: bookings.some(
            (booking) =>
              booking.event_id === event.id && booking.response === 'yes',
          ),
        };
      }),
    );
  }, [events, bookings, startDate, onEventsChange]);
  useEffect(() => {
    if (!selectedEventId) return;
    const item = eventElements.current[selectedEventId];
    item?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    item?.focus();
  }, [selectedEventId, events]);
  const act = async (
    name: string,
    params: Record<string, unknown>,
    close = false,
  ) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const { error: failure } = await client.rpc(name, params);
      if (failure) throw failure;
      if (close) {
        setEditing(null);
        requestId.current = null;
      }
      await read();
    } catch {
      setError(
        en
          ? 'Could not save event. Check access and try again.'
          : 'Nie udało się zapisać wydarzenia. Sprawdź dostęp i spróbuj ponownie.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = {
      p_name: String(form.get('name') ?? '').trim(),
      p_date: String(form.get('date') ?? ''),
      p_start: String(form.get('start') ?? ''),
      p_end: String(form.get('end') ?? ''),
      p_location: String(form.get('location') ?? '').trim(),
    };
    if (
      !values.p_name ||
      !values.p_location ||
      !values.p_date ||
      !values.p_start ||
      !values.p_end ||
      values.p_end <= values.p_start
    ) {
      setError(
        tr(
          'Sprawdź dane i godziny wydarzenia.',
          'Check event details and times.',
        ),
      );
      return;
    }
    if (editing === 'new')
      void act(
        'create_club_event',
        {
          ...values,
          p_request_id:
            requestId.current ?? (requestId.current = crypto.randomUUID()),
        },
        true,
      );
    else if (editing)
      void act(
        'update_club_event',
        { ...values, p_event_id: editing.id },
        true,
      );
  };
  const selected =
    participants.find((person) => person.id === participantId) ??
    participants[0];
  return (
    <section className="club-events" aria-label={tr('Wydarzenia', 'Events')}>
      <div className="panel-heading">
        <h3>{tr('Wydarzenia w tym tygodniu', 'Events this week')}</h3>
        {isAdmin && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              requestId.current = crypto.randomUUID();
              setEditing('new');
            }}
          >
            {tr('Dodaj wydarzenie', 'Add event')}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}{' '}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void read()}
          >
            {tr('Ponów', 'Retry')}
          </button>
        </p>
      )}
      {loading && (
        <SwordsLoader
          language={language}
          label={tr('Wczytuję wydarzenia…', 'Loading events…')}
        />
      )}
      {!loading && !error && events.length === 0 && (
        <p className="muted">
          {tr('Brak wydarzeń w tym tygodniu.', 'No events this week.')}
        </p>
      )}
      {editing && (
        <form
          key={editing === 'new' ? 'new' : editing.id}
          onSubmit={submit}
          className="panel"
        >
          <h4>
            {editing === 'new'
              ? tr('Nowe wydarzenie', 'New event')
              : tr('Edytuj wydarzenie', 'Edit event')}
          </h4>
          <fieldset disabled={busy}>
            <label>
              {tr('Nazwa', 'Name')}
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={editing === 'new' ? '' : editing.name}
              />
            </label>
            <label>
              {tr('Data', 'Date')}
              <input
                name="date"
                type="date"
                required
                defaultValue={
                  editing === 'new' ? startDate : parts(editing.starts_at).date
                }
              />
            </label>
            <label>
              {tr('Początek', 'Start')}
              <input
                name="start"
                type="time"
                required
                defaultValue={
                  editing === 'new' ? '' : parts(editing.starts_at).time
                }
              />
            </label>
            <label>
              {tr('Koniec', 'End')}
              <input
                name="end"
                type="time"
                required
                defaultValue={
                  editing === 'new' ? '' : parts(editing.ends_at).time
                }
              />
            </label>
            <label>
              {tr('Miejsce', 'Location')}
              <input
                name="location"
                required
                maxLength={200}
                defaultValue={editing === 'new' ? '' : editing.location}
              />
            </label>
            <button className="button" type="submit">
              {tr('Zapisz wydarzenie', 'Save event')}
            </button>{' '}
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setEditing(null);
                requestId.current = null;
              }}
            >
              {tr('Anuluj', 'Cancel')}
            </button>
          </fieldset>
        </form>
      )}
      {!loading &&
        events.map((event) => {
          const start = parts(event.starts_at);
          const end = parts(event.ends_at);
          const response = bookings.find(
            (row) =>
              row.event_id === event.id && row.participant_id === selected?.id,
          )?.response;
          const closed = event.canceled || Date.parse(event.starts_at) <= now;
          return (
            <article
              key={event.id}
              className="training-row"
              tabIndex={-1}
              ref={(element) => {
                eventElements.current[event.id] = element;
              }}
            >
              <div>
                <h4>{event.name}</h4>
                <p>
                  {start.date} · {start.time}–{end.time} · {event.location}
                </p>
                {event.canceled && (
                  <strong>{tr('Odwołane', 'Canceled')}</strong>
                )}
              </div>
              {participants.length > 1 && (
                <label>
                  {tr('Uczestnik', 'Participant')}
                  <select
                    value={selected?.id ?? ''}
                    onChange={(e) => setParticipantId(e.target.value)}
                  >
                    {participants.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selected && (
                <div>
                  <p>
                    {tr('Twoja odpowiedź', 'Your response')}:{' '}
                    {response === 'yes'
                      ? tr('Będę', 'Attending')
                      : response === 'no'
                        ? tr('Nie będę', 'Not attending')
                        : tr('Bez odpowiedzi', 'No response')}
                  </p>
                  {(['yes', 'no', null] as const).map((answer) => (
                    <button
                      type="button"
                      key={answer ?? 'clear'}
                      className="button secondary small"
                      disabled={
                        busy || closed || (answer === null && !response)
                      }
                      onClick={() =>
                        void act('set_club_event_booking', {
                          p_event_id: event.id,
                          p_participant_id: selected.id,
                          p_response: answer,
                        })
                      }
                    >
                      {answer === 'yes'
                        ? tr('Będę', 'Attending')
                        : answer === 'no'
                          ? tr('Nie będę', 'Not attending')
                          : tr('Anuluj zapis', 'Withdraw')}
                    </button>
                  ))}
                </div>
              )}
              {isAdmin && !closed && (
                <div>
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={busy}
                    onClick={() => setEditing(event)}
                  >
                    {tr('Edytuj', 'Edit')}
                  </button>{' '}
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          tr('Odwołać wydarzenie?', 'Cancel this event?'),
                        )
                      )
                        void act('cancel_club_event', { p_event_id: event.id });
                    }}
                  >
                    {tr('Odwołaj', 'Cancel event')}
                  </button>
                </div>
              )}
            </article>
          );
        })}
    </section>
  );
}
