import { useState } from 'react';
import type { Section, Training } from './types/club';
import { CalendarDays } from './placeholderIcons';
import './coach-trainings.css';

interface Props {
  trainings: Training[];
  sections: Section[];
  accountId: string;
  language: 'pl' | 'en';
  onOpenCalendar: () => void;
}

export default function CoachTrainingsPanel({
  trainings,
  sections,
  accountId,
  language,
  onOpenCalendar,
}: Props) {
  const [pagination, setPagination] = useState({ key: '', page: 0 });
  const leading = trainings
    .filter(
      (training) =>
        !training.canceled &&
        new Date(training.starts_at) > new Date() &&
        Boolean(accountId) &&
        training.coach_account_id === accountId,
    )
    .sort((first, second) => first.starts_at.localeCompare(second.starts_at));
  const listKey = leading.map((training) => training.id).join('|');
  const pageCount = Math.ceil(leading.length / 4);
  const page =
    pagination.key === listKey
      ? Math.min(pagination.page, Math.max(0, pageCount - 1))
      : 0;
  const visibleTrainings = leading.slice(page * 4, page * 4 + 4);
  const formatter = new Intl.DateTimeFormat(
    language === 'en' ? 'en-GB' : 'pl-PL',
    {
      timeZone: 'Europe/Warsaw',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    },
  );

  return (
    <section className="panel next-training">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            {language === 'en' ? 'YOUR TRAININGS' : 'TWOJE TRENINGI'}
          </span>
          <h2>
            {language === 'en'
              ? 'Trainings you lead'
              : 'Treningi, które prowadzisz'}
          </h2>
        </div>
        <CalendarDays aria-hidden="true" />
      </div>
      {leading.length ? (
        <ul className="coach-leading-trainings">
          {visibleTrainings.map((training) => (
            <li key={training.id}>
              <button className="text-button" onClick={onOpenCalendar}>
                <strong>
                  {sections.find(
                    (section) => section.id === training.section_id,
                  )?.name ?? training.section_id}
                  {' · '}
                  {training.group_label}
                </strong>
              </button>
              <p>{formatter.format(new Date(training.starts_at))}</p>
              <p className="muted">
                {training.location} ·{' '}
                {training.coach_account_id
                  ? training.coach_label
                  : language === 'en'
                    ? 'No main coach assigned'
                    : 'Brak przypisanego trenera głównego'}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {language === 'en'
            ? 'You are not assigned to lead any upcoming trainings.'
            : 'Nie masz przypisanych nadchodzących treningów do prowadzenia.'}
        </p>
      )}
      {pageCount > 1 && (
        <nav
          className="coach-training-pagination"
          aria-label={
            language === 'en'
              ? 'Coach training pages'
              : 'Strony treningów trenera'
          }
        >
          <button
            type="button"
            className="button secondary small"
            disabled={page === 0}
            onClick={() => setPagination({ key: listKey, page: page - 1 })}
          >
            {language === 'en' ? 'Previous' : 'Poprzednie'}
          </button>
          <span role="status">
            {language === 'en'
              ? `Page ${page + 1} of ${pageCount}`
              : `Strona ${page + 1} z ${pageCount}`}
          </span>
          <button
            type="button"
            className="button secondary small"
            disabled={page === pageCount - 1}
            onClick={() => setPagination({ key: listKey, page: page + 1 })}
          >
            {language === 'en' ? 'Next' : 'Następne'}
          </button>
        </nav>
      )}
    </section>
  );
}
