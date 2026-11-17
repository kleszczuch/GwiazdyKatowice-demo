import type { ReactNode } from 'react';
import { Check, Lock } from './placeholderIcons';

export type StepState = 'current' | 'done' | 'locked';

interface Props {
  id: string;
  number: number;
  title: string;
  state: StepState;
  language: 'pl' | 'en';
  note?: ReactNode;
  children?: ReactNode;
}

export default function OnboardingStep({
  id,
  number,
  title,
  state,
  language,
  note,
  children,
}: Props) {
  const en = language === 'en';
  const stateLabel =
    state === 'done'
      ? en
        ? 'Done'
        : 'Gotowe'
      : state === 'locked'
        ? en
          ? 'Locked'
          : 'Zablokowane'
        : en
          ? 'Current step'
          : 'Bieżący krok';
  return (
    <section
      className={`onboarding-step is-${state}`}
      aria-labelledby={`${id}-title`}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      <span className="onboarding-step__marker" aria-hidden="true">
        {state === 'done' ? (
          <Check size={16} strokeWidth={3} />
        ) : state === 'locked' ? (
          <Lock size={15} />
        ) : (
          number
        )}
      </span>
      <div className="onboarding-step__card">
        <header className="onboarding-step__head">
          <h2 id={`${id}-title`} className="onboarding-step__title">
            <span className="visually-hidden">
              {en ? `Step ${number}: ` : `Krok ${number}: `}
            </span>
            {title}
          </h2>
          <span
            className={
              state === 'current'
                ? 'visually-hidden'
                : `onboarding-step__state is-${state}`
            }
          >
            {stateLabel}
          </span>
        </header>
        {note && <p className="onboarding-step__note">{note}</p>}
        {children}
      </div>
    </section>
  );
}
