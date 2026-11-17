import { TrainingBadge } from './TrainingIconPicker';
import { trainingIconLabel } from './lib/training-icons.ts';
import './calendar.css';

// Kafelek tygodnia. variant to kolor sekcji, color to opcjonalny kolor bloku
// regularnego, który go nadpisuje. startMin/endMin to minuty od północy.
export interface WeekEvent {
  icon?: string | null;
  id: string;
  dayIndex: number;
  startMin: number;
  endMin: number;
  title: string;
  subtitle: string;
  variant: string;
  color?: string | null;
  canceled: boolean;
  booked: boolean;
  coachSection?: boolean;
  coachBooked?: boolean;
  past?: boolean;
  leading?: boolean;
}

// Kafelek pokazuje jeden status; kolejność to decyzja właściciela z 16.11.2026.
export function eventStatus(event: WeekEvent) {
  if (event.canceled) return 'canceled';
  if (event.past) return 'past';
  if (event.booked || event.coachBooked) return 'booked';
  return event.leading ? 'leading' : null;
}

export interface WeekDay {
  weekday: string;
  date: string;
  isToday: boolean;
}

interface Props {
  days: WeekDay[];
  events: WeekEvent[];
  onSelect: (id: string) => void;
  language?: 'pl' | 'en';
  weekLabel?: string;
}

export default function WeekGrid({
  days,
  events,
  onSelect,
  language = 'pl',
  weekLabel,
}: Props) {
  const en = language === 'en';
  const statusLabels = {
    canceled: en ? 'Canceled' : 'Odwołany',
    past: en ? 'Past' : 'Miniony',
    booked: en ? 'Booked' : 'Zapisany',
    leading: en ? 'Your training block' : 'Twój blok treningowy',
  };
  const coachSectionLabel = en ? 'Your section' : 'Twoja sekcja';
  return (
    <>
      {weekLabel && <p className="weekly-calendar__range">{weekLabel}</p>}
      <div
        className="weekly-calendar"
        aria-label={
          language === 'en'
            ? 'Weekly training schedule'
            : 'Tygodniowy harmonogram treningów'
        }
      >
        {days.map((day, dayIndex) => {
          const dayEvents = events
            .filter((event) => event.dayIndex === dayIndex)
            .sort((first, second) => first.startMin - second.startMin);
          return (
            <section
              key={day.date}
              className={`weekly-calendar__day ${day.isToday ? 'is-today' : ''}`}
              aria-label={`${day.weekday}, ${day.date}`}
            >
              <h3>{day.weekday}</h3>
              <div className="weekly-calendar__events">
                {dayEvents.map((event) => {
                  const status = eventStatus(event);
                  return (
                    <button
                      key={event.id}
                      type="button"
                      className={`weekly-calendar__event weekly-calendar__event--${event.variant} ${event.color ? `weekly-calendar__event--color-${event.color}` : ''} ${event.canceled ? 'is-canceled' : ''} ${status === 'past' ? 'is-past' : ''} ${event.booked ? 'is-booked' : ''} ${event.coachSection ? 'is-coach-section' : ''} ${event.coachBooked ? 'is-coach-booked' : ''}`}
                      aria-label={`${day.weekday}, ${trainingIconLabel(event.icon, language)}, ${event.title}, ${event.subtitle}${status ? `, ${statusLabels[status]}` : ''}${event.coachSection ? `, ${coachSectionLabel}` : ''}`}
                      onClick={() => onSelect(event.id)}
                    >
                      {status && (
                        <small
                          className={`weekly-calendar__status weekly-calendar__status--${status}`}
                        >
                          {statusLabels[status]}
                        </small>
                      )}
                      <TrainingBadge icon={event.icon} language={language} />
                      <strong>{event.title}</strong>
                      <span>{event.subtitle}</span>
                    </button>
                  );
                })}
                {!dayEvents.length && (
                  <p className="weekly-calendar__empty">
                    {language === 'en' ? 'No training' : 'Brak treningów'}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
