import { isMinor, warsawToday } from './lib/warsaw-date.ts';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validBirthDate } from './types/personal-profile';
import type { PersonalProfile, ProfileRequest } from './types/personal-profile';
import OnboardingStep from './OnboardingStep';
import { Baby, ChevronRight, ShieldCheck, UserRound } from './placeholderIcons';

export type Mode = 'adult' | 'guardian';
export type DetailField = 'first' | 'last' | 'birth';
type Field = DetailField | 'code';
type Errors = Partial<Record<Field | 'form', string>>;
type Intent = 'code' | 'admin' | 'profile';

const CODE_LENGTH = 6;
const FIELDS: Field[] = ['first', 'last', 'birth', 'code'];
const FIELD_IDS: Record<Field, string> = {
  first: 'registration-first-name',
  last: 'registration-last-name',
  birth: 'registration-birth-date',
  code: 'registration-code',
};

export const normalizeClubCode = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 128);

export { isMinor };

export const missingDetails = (
  values: { first: string; last: string; birth: string },
  mode: Mode,
  today = warsawToday(),
): DetailField[] => {
  const missing: DetailField[] = [];
  if (!values.first.trim()) missing.push('first');
  if (!values.last.trim()) missing.push('last');
  if (
    !validBirthDate(values.birth) ||
    (mode === 'guardian' && !isMinor(values.birth, today))
  )
    missing.push('birth');
  return missing;
};

const focusField = (field: Field) => {
  if (typeof document === 'undefined') return;
  document.getElementById(FIELD_IDS[field])?.focus();
};

interface Props {
  client: SupabaseClient;
  profile: PersonalProfile | null;
  request?: ProfileRequest | null;
  needsCode: boolean;
  canSelfActivate: boolean;
  suggestedName: { first: string; last: string } | null;
  siteLinks?: boolean;
  language: 'pl' | 'en';
  onChanged: () => void;
}

export default function RegistrationForm({
  client,
  profile,
  request = null,
  needsCode,
  canSelfActivate,
  suggestedName,
  siteLinks = false,
  language,
  onChanged,
}: Props) {
  const en = language === 'en';
  const tr = (pl: string, english: string) => (en ? english : pl);
  const complete = Boolean(
    profile?.first_name?.trim() &&
    profile.last_name?.trim() &&
    validBirthDate(profile.birth_date ?? ''),
  );
  const [mode, setMode] = useState<Mode>(() =>
    complete && profile && isMinor(profile.birth_date) ? 'guardian' : 'adult',
  );
  const [values, setValues] = useState(() => {
    const named = Boolean(
      profile?.first_name?.trim() || profile?.last_name?.trim(),
    );
    return {
      first: named ? (profile?.first_name ?? '') : (suggestedName?.first ?? ''),
      last: named ? (profile?.last_name ?? '') : (suggestedName?.last ?? ''),
      birth: profile?.birth_date ?? '',
      phone: profile?.phone ?? '',
    };
  });
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const child = mode === 'guardian';
  const today = warsawToday();
  const disabled = busy || sent;
  const fieldLabels: Record<Field, string> = {
    first: child
      ? tr('Imię dziecka', 'Child’s first name')
      : tr('Imię', 'First name'),
    last: child
      ? tr('Nazwisko dziecka', 'Child’s last name')
      : tr('Nazwisko', 'Last name'),
    birth: child
      ? tr('Data urodzenia dziecka', 'Child’s date of birth')
      : tr('Data urodzenia', 'Date of birth'),
    code: tr('Kod klubowy', 'Club code'),
  };

  const clearError = (field: Field) =>
    setErrors((current) =>
      current[field] || current.form
        ? { ...current, [field]: undefined, form: undefined }
        : current,
    );
  const update = (
    field: 'first' | 'last' | 'birth' | 'phone',
    value: string,
  ) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (field !== 'phone') clearError(field);
  };
  const chooseMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setValues((current) => {
      if (
        next === 'guardian' &&
        suggestedName &&
        current.first === suggestedName.first &&
        current.last === suggestedName.last
      )
        return { ...current, first: '', last: '' };
      if (
        next === 'adult' &&
        suggestedName &&
        !complete &&
        !current.first.trim() &&
        !current.last.trim()
      )
        return {
          ...current,
          first: suggestedName.first,
          last: suggestedName.last,
        };
      return current;
    });
    setErrors((current) => ({
      ...current,
      first: undefined,
      last: undefined,
      birth: undefined,
      form: undefined,
    }));
  };

  const validate = (withCode: boolean): Errors => {
    const found: Errors = {};
    const absent = missingDetails(values, mode, today);
    if (absent.includes('first'))
      found.first = child
        ? tr('Wpisz imię dziecka.', 'Enter your child’s first name.')
        : tr('Wpisz imię.', 'Enter your first name.');
    if (absent.includes('last'))
      found.last = child
        ? tr('Wpisz nazwisko dziecka.', 'Enter your child’s last name.')
        : tr('Wpisz nazwisko.', 'Enter your last name.');
    if (!absent.includes('birth')) found.birth = undefined;
    else if (!values.birth)
      found.birth = tr('Wybierz datę urodzenia.', 'Choose the date of birth.');
    else if (!validBirthDate(values.birth))
      found.birth = tr(
        'Podaj prawidłową datę urodzenia (nie z przyszłości).',
        'Enter a valid date of birth (not in the future).',
      );
    else
      found.birth = tr(
        'Dziecko musi mieć mniej niż 18 lat. Jeśli zapisujesz siebie, wybierz „Siebie”.',
        'The child must be under 18. If you are registering yourself, choose “Myself”.',
      );
    if (withCode) {
      if (!code) found.code = tr('Wpisz kod klubowy.', 'Enter the club code.');
      else if (code.length < CODE_LENGTH)
        found.code = tr(
          `Kod ma ${CODE_LENGTH} znaków, a wpisano ${code.length}.`,
          `The code has ${CODE_LENGTH} characters; you entered ${code.length}.`,
        );
    }
    return found;
  };

  const register = async (intent: Intent) => {
    if (submitting.current || sent) return;
    const found = validate(intent === 'code');
    const invalid = FIELDS.filter((field) => found[field]);
    if (invalid.length) {
      setErrors(found);
      focusField(invalid[0]);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setErrors({});
    const first = values.first.trim();
    const last = values.last.trim();
    const phone = values.phone.trim();
    const changed =
      !complete ||
      first !== profile?.first_name?.trim() ||
      last !== profile?.last_name?.trim() ||
      values.birth !== profile?.birth_date ||
      (phone || null) !== (profile?.phone?.trim() || null);
    try {
      if (changed) {
        let saved = false;
        try {
          const { error } = await client.rpc('submit_my_profile', {
            p_first_name: first,
            p_last_name: last,
            p_birth_date: values.birth,
            p_phone: phone || null,
            p_training_group:
              request?.status === 'pending'
                ? request.training_group
                : (profile?.training_group ?? 'beginner'),
            p_weapons_used:
              profile?.weapons_used ?? profile?.preferred_weapons ?? [],
          });
          saved = !error;
        } catch {
          saved = false;
        }
        if (!mounted.current) return;
        if (!saved) {
          setErrors({
            form: tr(
              'Nie udało się zapisać danych. Sprawdź połączenie i spróbuj ponownie.',
              'Could not save the details. Check your connection and try again.',
            ),
          });
          return;
        }
      }
      if (intent === 'profile') {
        setSent(true);
        onChanged();
        return;
      }
      if (intent === 'admin') {
        const { error } = await client.rpc('activate_my_admin_profile');
        if (error) throw error;
        if (!mounted.current) return;
        setSent(true);
        onChanged();
        return;
      }
      const { data, error } = await client.rpc(
        isMinor(values.birth, today)
          ? 'redeem_guardian_child_invitation'
          : 'redeem_portal_invitation',
        { p_code: code },
      );
      if (error) throw error;
      if (!mounted.current) return;
      const status = (data as { status?: string } | null)?.status;
      if (
        status === 'pending' ||
        status === 'linked' ||
        status === 'already_registered'
      ) {
        setSent(true);
        onChanged();
        return;
      }
      if (changed) onChanged();
      if (status === 'profile_incomplete') {
        setErrors({
          form: tr(
            'Nie udało się potwierdzić danych. Sprawdź je i spróbuj ponownie.',
            'Could not confirm the details. Check them and try again.',
          ),
        });
        return;
      }
      setErrors({
        code:
          status === 'rate_limited'
            ? tr(
                'Zbyt wiele nieudanych prób. Odczekaj 15 minut i spróbuj ponownie.',
                'Too many failed attempts. Wait 15 minutes and try again.',
              )
            : status === 'guardian_registration_required'
              ? tr(
                  'Ten kod nie pasuje do rejestracji dziecka. Poproś trenera o aktualny kod klubowy.',
                  'This code cannot be used to register a child. Ask a coach for the current club code.',
                )
              : tr(
                  'Ten kod nie działa. Sprawdź go u trenera lub administratora i wpisz ponownie.',
                  'This code does not work. Check it with a coach or an administrator and enter it again.',
                ),
      });
      focusField('code');
    } catch {
      if (mounted.current) {
        if (changed) onChanged();
        setErrors({
          form:
            intent === 'admin'
              ? tr(
                  'Nie udało się utworzyć profilu administratora. Spróbuj ponownie.',
                  'Could not create the administrator profile. Try again.',
                )
              : tr(
                  'Nie udało się wysłać zgłoszenia. Sprawdź połączenie i spróbuj ponownie.',
                  'Could not send the application. Check your connection and try again.',
                ),
        });
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const missing = missingDetails(values, mode, today);
  const detailsDone = missing.length === 0;
  const locked = needsCode && !detailsDone;
  const codeReady = code.length >= CODE_LENGTH;
  const missingNames: Record<DetailField, string> = {
    first: tr('imię', 'first name'),
    last: tr('nazwisko', 'last name'),
    birth: tr('datę urodzenia', 'date of birth'),
  };
  const missingList = missing.map((field) => missingNames[field]).join(', ');
  const reason = !detailsDone
    ? child
      ? tr(
          `Uzupełnij dane dziecka: ${missingList}.`,
          `Complete your child’s details: ${missingList}.`,
        )
      : tr(
          `Uzupełnij dane osobowe: ${missingList}.`,
          `Complete your personal details: ${missingList}.`,
        )
    : needsCode && !codeReady
      ? tr(
          `Wpisz ${CODE_LENGTH}-znakowy kod klubowy.`,
          `Enter the ${CODE_LENGTH}-character club code.`,
        )
      : '';
  const adultChild =
    child && validBirthDate(values.birth) && !isMinor(values.birth, today);
  const birthError =
    errors.birth ??
    (adultChild
      ? tr(
          'Dziecko musi mieć mniej niż 18 lat. Jeśli zapisujesz siebie, wybierz „Siebie”.',
          'The child must be under 18. If you are registering yourself, choose “Myself”.',
        )
      : undefined);
  const minorSelf =
    !child && validBirthDate(values.birth) && isMinor(values.birth, today);
  const nameSuggested = Boolean(
    !child &&
    !complete &&
    suggestedName &&
    values.first === suggestedName.first &&
    values.last === suggestedName.last,
  );
  const longCode = code.length > CODE_LENGTH;
  const ambiguousCode = !longCode && /[IO01]/.test(code);
  const shownErrors: Errors = { ...errors, birth: birthError };
  const describedBy = (field: Field, hint?: string) =>
    [hint, shownErrors[field] ? `${FIELD_IDS[field]}-error` : '']
      .filter(Boolean)
      .join(' ') || undefined;
  const fieldError = (field: Field) =>
    shownErrors[field] && (
      <p id={`${FIELD_IDS[field]}-error`} className="onboarding-field__error">
        {shownErrors[field]}
      </p>
    );
  const touch = (field: DetailField) => {
    const found = validate(false)[field];
    setErrors((current) =>
      current[field] === found ? current : { ...current, [field]: found },
    );
  };
  const textField = (
    field: 'first' | 'last',
    name: string,
    autoComplete: string,
  ) => (
    <div className={`onboarding-field${errors[field] ? ' is-invalid' : ''}`}>
      <label className="onboarding-field__label" htmlFor={FIELD_IDS[field]}>
        {fieldLabels[field]}
      </label>
      <input
        id={FIELD_IDS[field]}
        name={name}
        className="onboarding-input"
        value={values[field]}
        onChange={(event) => update(field, event.currentTarget.value)}
        onBlur={() => touch(field)}
        autoComplete={child ? 'off' : autoComplete}
        maxLength={60}
        required
        aria-invalid={errors[field] ? true : undefined}
        aria-describedby={describedBy(field)}
      />
      {fieldError(field)}
    </div>
  );
  const choices = [
    [
      'adult',
      UserRound,
      tr('Siebie', 'Myself'),
      tr('Mam ukończone 18 lat', 'I am 18 or older'),
    ],
    [
      'guardian',
      Baby,
      tr('Moje dziecko', 'My child'),
      tr('Poniżej 18 lat, jestem opiekunem', 'Under 18, I am the guardian'),
    ],
  ] as const;

  return (
    <form
      className="onboarding-form"
      noValidate
      aria-busy={busy}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void register(needsCode ? 'code' : 'profile');
      }}
    >
      <fieldset className="onboarding-form__body" disabled={disabled}>
        <OnboardingStep
          id="onboarding-details"
          number={2}
          title={
            child
              ? tr('Dane dziecka', 'Child’s details')
              : tr('Dane osobowe', 'Personal details')
          }
          state={detailsDone ? 'done' : 'current'}
          language={language}
        >
          <fieldset className="onboarding-choice">
            <legend className="onboarding-field__label">
              {tr('Kogo rejestrujesz?', 'Who are you registering?')}
            </legend>
            <div className="onboarding-choice__options">
              {choices.map(([value, Icon, title, description]) => (
                <label
                  key={value}
                  className={`onboarding-choice__option${mode === value ? ' is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    className="onboarding-choice__input"
                    name="registration-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => chooseMode(value)}
                  />
                  <Icon
                    size={22}
                    className="onboarding-choice__icon"
                    aria-hidden="true"
                  />
                  <span className="onboarding-choice__text">
                    <strong>{title}</strong>
                    <small>{description}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {child && (
            <p className="onboarding-step__text">
              {tr(
                'Dziecko nie potrzebuje własnego konta. Zostajesz zalogowany jako opiekun i to Ty zapisujesz je na treningi.',
                'Your child does not need an account. You stay signed in as the guardian and sign them up for training.',
              )}
            </p>
          )}
          {nameSuggested && (
            <p className="onboarding-step__text">
              {tr(
                'Imię i nazwisko podpowiedzieliśmy z konta Google. Popraw je, jeśli trzeba.',
                'We filled in the name from your Google account. Correct it if needed.',
              )}
            </p>
          )}
          <div className="onboarding-form__grid">
            {textField('first', 'first_name', 'given-name')}
            {textField('last', 'last_name', 'family-name')}
            <div
              className={`onboarding-field${shownErrors.birth ? ' is-invalid' : ''}`}
            >
              <label
                className="onboarding-field__label"
                htmlFor={FIELD_IDS.birth}
              >
                {fieldLabels.birth}
              </label>
              <input
                id={FIELD_IDS.birth}
                name="birth_date"
                type="date"
                className="onboarding-input"
                value={values.birth}
                onChange={(event) => update('birth', event.currentTarget.value)}
                onBlur={() => touch('birth')}
                min="1900-01-01"
                max={today}
                autoComplete={child ? 'off' : 'bday'}
                required
                aria-invalid={shownErrors.birth ? true : undefined}
                aria-describedby={describedBy('birth')}
              />
              {fieldError('birth')}
            </div>
            <div className="onboarding-field">
              <label
                className="onboarding-field__label"
                htmlFor="registration-phone"
              >
                {child
                  ? tr('Telefon opiekuna', 'Guardian’s phone')
                  : tr('Telefon', 'Phone')}
                <span className="onboarding-field__optional">
                  {tr('opcjonalnie', 'optional')}
                </span>
              </label>
              <input
                id="registration-phone"
                name="phone"
                type="tel"
                className="onboarding-input"
                value={values.phone}
                onChange={(event) => update('phone', event.currentTarget.value)}
                autoComplete="tel"
                maxLength={40}
              />
            </div>
          </div>
          {minorSelf && (
            <p className="onboarding-notice" role="status">
              {tr(
                'Ta data oznacza osobę poniżej 18 lat. Zgłoszenie trafi do klubu jako dziecko z opiekunem, dlatego najlepiej, żeby formularz wypełnił rodzic na swoim koncie.',
                'This date means a person under 18. The application will reach the club as a child with a guardian, so ideally a parent should fill in the form on their own account.',
              )}
            </p>
          )}
        </OnboardingStep>

        {needsCode && (
          <OnboardingStep
            id="onboarding-code"
            number={3}
            title={tr('Kod klubowy', 'Club code')}
            state={locked ? 'locked' : 'current'}
            language={language}
            note={
              locked
                ? tr(
                    `Odblokuje się, gdy w kroku 2 uzupełnisz: ${missingList}.`,
                    `Unlocks when you complete in step 2: ${missingList}.`,
                  )
                : tr(
                    'Sześć znaków od trenera lub administratora klubu.',
                    'Six characters from a club coach or administrator.',
                  )
            }
          >
            <p className="visually-hidden" role="status">
              {locked ? '' : tr('Krok 3 odblokowany.', 'Step 3 unlocked.')}
            </p>
            <fieldset className="onboarding-form__lockable" disabled={locked}>
              <div
                className={`onboarding-code${longCode ? ' is-long' : ''}${codeFocused && !locked ? ' is-focused' : ''}${errors.code ? ' is-invalid' : ''}${locked ? ' is-locked' : ''}`}
              >
                <label className="visually-hidden" htmlFor={FIELD_IDS.code}>
                  {fieldLabels.code}
                </label>
                <input
                  id={FIELD_IDS.code}
                  name="code"
                  className="onboarding-code__input"
                  value={code}
                  onChange={(event) => {
                    setCode(normalizeClubCode(event.currentTarget.value));
                    clearError('code');
                  }}
                  onFocus={() => setCodeFocused(true)}
                  onBlur={() => setCodeFocused(false)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={128}
                  aria-invalid={errors.code ? true : undefined}
                  aria-describedby={describedBy(
                    'code',
                    'registration-code-hint',
                  )}
                />
                {!longCode && (
                  <span className="onboarding-code__cells" aria-hidden="true">
                    {Array.from({ length: CODE_LENGTH }, (_, index) => (
                      <span
                        key={index}
                        className={`onboarding-code__cell${code[index] ? ' is-filled' : ''}${index === Math.min(code.length, CODE_LENGTH - 1) ? ' is-current' : ''}`}
                      >
                        {code[index] ?? ''}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <p
                id="registration-code-hint"
                className="onboarding-field__hint"
                hidden={locked}
              >
                {tr(
                  'Wielkość liter nie ma znaczenia. Możesz wkleić cały kod.',
                  'Capitalisation does not matter. You can paste the whole code.',
                )}
              </p>
              {ambiguousCode && (
                <p className="onboarding-field__hint is-warning">
                  {tr(
                    'Kody klubowe nie zawierają liter I i O ani cyfr 0 i 1. Sprawdź, czy to nie podobny znak.',
                    'Club codes do not contain the letters I and O or the digits 0 and 1. Check for a similar character.',
                  )}
                </p>
              )}
              {fieldError('code')}
              {canSelfActivate && (
                <div className="onboarding-admin">
                  <ShieldCheck size={20} aria-hidden="true" />
                  <div>
                    <strong>
                      {tr(
                        'Masz rolę administratora',
                        'You have the administrator role',
                      )}
                    </strong>
                    <p>
                      {tr(
                        'Możesz utworzyć własny profil bez kodu klubowego.',
                        'You can create your own profile without a club code.',
                      )}
                    </p>
                    <button
                      type="button"
                      className="onboarding-button onboarding-button--quiet"
                      disabled={disabled || locked}
                      onClick={() => void register('admin')}
                    >
                      {tr(
                        'Utwórz profil administratora bez kodu',
                        'Create administrator profile without a code',
                      )}
                    </button>
                  </div>
                </div>
              )}
            </fieldset>
            {siteLinks && (
              <p className="onboarding-step__aside">
                {tr('Nie masz kodu? ', 'No code yet? ')}
                <a href={`/${language}/membership`}>
                  {tr(
                    'Zobacz, jak dołączyć do klubu',
                    'See how to join the club',
                  )}
                </a>
              </p>
            )}
          </OnboardingStep>
        )}
      </fieldset>

      <div className="onboarding-form__footer">
        {errors.form && (
          <p className="onboarding-notice is-error" role="alert">
            {errors.form}
          </p>
        )}
        <button
          type="submit"
          className="onboarding-button onboarding-button--primary"
          disabled={disabled || Boolean(reason)}
          aria-describedby="registration-submit-note"
        >
          <span>
            {busy
              ? tr('Wysyłam…', 'Sending…')
              : sent
                ? tr('Wysłano', 'Sent')
                : needsCode
                  ? tr('Dokończ rejestrację', 'Complete registration')
                  : tr('Zapisz dane i przejdź dalej', 'Save and continue')}
          </span>
          {!busy && !sent && <ChevronRight size={18} aria-hidden="true" />}
        </button>
        <p id="registration-submit-note" className="onboarding-form__note">
          {reason ||
            (needsCode
              ? tr(
                  'Po wysłaniu administrator klubu zatwierdzi dostęp. Wtedy zobaczysz kalendarz treningów i zapisy.',
                  'After you send it, a club administrator approves access. Then you will see the training calendar and sign-ups.',
                )
              : tr(
                  'Po zapisaniu od razu przejdziesz do portalu.',
                  'After saving you go straight to the portal.',
                ))}
        </p>
      </div>
    </form>
  );
}
