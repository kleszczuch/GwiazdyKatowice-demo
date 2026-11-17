import { Check } from './placeholderIcons';

export type RegistrationStage = 'details' | 'approval';

interface Props {
  stage: RegistrationStage;
  language: 'pl' | 'en';
  email?: string | null;
}

export default function RegistrationProgress({
  stage,
  language,
  email = null,
}: Props) {
  const en = language === 'en';
  const steps = [
    [en ? 'Account' : 'Konto', email ?? (en ? 'Signed in' : 'Zalogowano')],
    [
      en ? 'Details and code' : 'Dane i kod',
      stage === 'details'
        ? en
          ? 'Fill in the form'
          : 'Wypełnij formularz'
        : en
          ? 'Sent to the club'
          : 'Wysłane do klubu',
    ],
    [
      en ? 'Club approval' : 'Akceptacja klubu',
      en
        ? 'An administrator approves access'
        : 'Administrator zatwierdzi dostęp',
    ],
  ] as const;
  const current = stage === 'details' ? 1 : 2;
  return (
    <ol
      className="registration-progress"
      aria-label={en ? 'Registration progress' : 'Postęp rejestracji'}
    >
      {steps.map(([label, detail], index) => {
        const state =
          index < current ? 'done' : index === current ? 'current' : 'next';
        return (
          <li
            key={label}
            className={`registration-progress__step is-${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="registration-progress__marker" aria-hidden="true">
              {state === 'done' ? (
                <Check size={14} strokeWidth={3} />
              ) : (
                index + 1
              )}
            </span>
            <span className="registration-progress__text">
              <span className="registration-progress__label">
                {label}
                <span className="visually-hidden">
                  {state === 'done'
                    ? en
                      ? ' (done)'
                      : ' (gotowe)'
                    : state === 'current'
                      ? en
                        ? ' (current step)'
                        : ' (bieżący krok)'
                      : ''}
                </span>
              </span>
              <span className="registration-progress__detail">{detail}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
