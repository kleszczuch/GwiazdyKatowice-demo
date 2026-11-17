import { isMinor } from './lib/warsaw-date.ts';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validBirthDate } from './types/personal-profile';
import type { PersonalProfile, ProfileRequest } from './types/personal-profile';
import { Pencil, UserRound } from './placeholderIcons';
import ProfileDialog from './ProfileDialog';

interface Props {
  client: SupabaseClient;
  profile: PersonalProfile | null;
  request?: ProfileRequest | null;
  language: 'pl' | 'en';
  guardianMode?: boolean;
  onSaved: () => void;
}

interface SectionChoice {
  id: string;
  name: string;
}

interface SectionChoices {
  available: boolean;
  sections: SectionChoice[];
  assigned_section_ids: string[];
  request: { section_ids: string[]; status: string } | null;
}

export default function AccountPersonalProfile({
  client,
  profile,
  request,
  language,
  guardianMode = false,
  onSaved,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sectionChoices, setSectionChoices] = useState<SectionChoices | null>(
    null,
  );
  const [sectionDraft, setSectionDraft] = useState<string[]>([]);
  const [sectionBusy, setSectionBusy] = useState(false);
  const [sectionMessage, setSectionMessage] = useState('');
  const [sectionReload, setSectionReload] = useState(0);
  const [dialog, setDialog] = useState<'personal' | 'sections' | null>(null);
  const mounted = useRef(true);
  const saving = useRef(false);
  const en = language === 'en';
  const draft = profile;
  const complete = Boolean(
    profile?.first_name?.trim() &&
    profile.last_name?.trim() &&
    validBirthDate(profile.birth_date),
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    if (!complete) {
      return () => {
        current = false;
      };
    }
    void Promise.resolve(client.rpc('get_my_section_choices'))
      .then(({ data, error }) => {
        if (!current) return;
        if (error || !data || typeof data !== 'object') {
          setSectionChoices(null);
          setSectionMessage(
            en
              ? 'Could not load your sections. Try again.'
              : 'Nie udało się wczytać sekcji. Spróbuj ponownie.',
          );
          return;
        }
        const choices = data as SectionChoices;
        setSectionChoices(choices);
        setSectionDraft(
          choices.request?.status === 'pending'
            ? choices.request.section_ids
            : choices.assigned_section_ids,
        );
        setSectionMessage('');
      })
      .catch(() => {
        if (current) {
          setSectionChoices(null);
          setSectionMessage(
            en
              ? 'Could not load your sections. Try again.'
              : 'Nie udało się wczytać sekcji. Spróbuj ponownie.',
          );
        }
      });
    return () => {
      current = false;
    };
  }, [
    client,
    complete,
    en,
    profile?.account_id,
    profile?.updated_at,
    sectionReload,
  ]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    const form = new FormData(event.currentTarget);
    const first = String(form.get('first_name') ?? '').trim();
    const last = String(form.get('last_name') ?? '').trim();
    const birth = String(form.get('birth_date') ?? '');
    if (!first || !last || !validBirthDate(birth)) {
      setMessage(
        en
          ? guardianMode
            ? 'Enter your child’s first name, last name and a valid date of birth.'
            : 'Enter your first name, last name and a valid date of birth.'
          : guardianMode
            ? 'Podaj imię i nazwisko dziecka oraz jego prawidłową datę urodzenia.'
            : 'Podaj imię, nazwisko i prawidłową datę urodzenia.',
      );
      return;
    }
    if (guardianMode) {
      if (!isMinor(birth)) {
        setMessage(
          en
            ? 'Enter the date of birth of a child under 18.'
            : 'Podaj datę urodzenia dziecka poniżej 18 lat.',
        );
        return;
      }
    }
    saving.current = true;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await client.rpc('submit_my_profile', {
        p_first_name: first,
        p_last_name: last,
        p_birth_date: birth,
        p_phone: String(form.get('phone') ?? '').trim() || null,
        p_training_group:
          request?.status === 'pending'
            ? request.training_group
            : (profile?.training_group ?? 'beginner'),
        p_weapons_used: draft?.weapons_used ?? draft?.preferred_weapons ?? [],
      });
      if (error) throw error;
      if (mounted.current) {
        setMessage(
          en
            ? complete
              ? 'Personal details saved.'
              : 'Profile saved.'
            : complete
              ? 'Dane osobowe zapisane.'
              : 'Profil zapisany.',
        );
        setDialog(null);
        onSaved();
      }
    } catch {
      if (mounted.current)
        setMessage(
          en
            ? 'Could not save personal details. Try again.'
            : 'Nie udało się zapisać danych osoby. Spróbuj ponownie.',
        );
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const personalTitle = guardianMode
    ? en
      ? 'Child’s details'
      : 'Dane dziecka'
    : en
      ? 'Personal details'
      : 'Dane osobowe';
  const personalForm = (
    <form className="personal-form" onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy}>
        <div className="personal-form__grid">
          <label className="personal-form__field">
            {en ? 'First name' : 'Imię'}
            {guardianMode && (en ? ' (child)' : ' dziecka')}
            <input
              name="first_name"
              autoComplete={guardianMode ? 'off' : 'given-name'}
              maxLength={60}
              required
              defaultValue={draft?.first_name ?? ''}
            />
          </label>
          <label className="personal-form__field">
            {en ? 'Last name' : 'Nazwisko'}
            {guardianMode && (en ? ' (child)' : ' dziecka')}
            <input
              name="last_name"
              autoComplete={guardianMode ? 'off' : 'family-name'}
              maxLength={60}
              required
              defaultValue={draft?.last_name ?? ''}
            />
          </label>
          <label className="personal-form__field">
            {en ? 'Date of birth' : 'Data urodzenia'}
            {guardianMode && (en ? ' (child)' : ' dziecka')}
            <input
              name="birth_date"
              type="date"
              autoComplete={guardianMode ? 'off' : 'bday'}
              required
              defaultValue={draft?.birth_date ?? ''}
            />
          </label>
          <label className="personal-form__field">
            {en ? 'Phone' : 'Telefon'}
            <span className="personal-form__optional">
              {en ? 'optional' : 'opcjonalnie'}
            </span>
            <input
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={40}
              defaultValue={draft?.phone ?? ''}
            />
          </label>
        </div>
        <button
          type="submit"
          className="button personal-form__submit"
          disabled={busy}
        >
          {busy
            ? en
              ? 'Saving…'
              : 'Zapisuję…'
            : complete
              ? en
                ? 'Save details'
                : 'Zapisz dane'
              : en
                ? 'Save profile'
                : 'Zapisz profil'}
        </button>
      </fieldset>
    </form>
  );
  if (!complete)
    return (
      <section className="profile-weapons">
        <h3 className="profile-overview__heading">
          <UserRound size={18} />
          {en ? 'Complete your profile' : 'Uzupełnij profil'}
        </h3>
        <p className="muted">
          {en
            ? guardianMode
              ? 'Complete your child’s name and date of birth before using an invitation.'
              : 'Complete your first name, last name and date of birth before using an invitation.'
            : guardianMode
              ? 'Uzupełnij imię, nazwisko i datę urodzenia dziecka przed użyciem zaproszenia.'
              : 'Uzupełnij imię, nazwisko i datę urodzenia przed użyciem zaproszenia.'}
        </p>
        {personalForm}
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
      </section>
    );
  const sectionContent = (
    <div className="profile-section-request">
      <h4>
        {guardianMode
          ? en
            ? 'Which section does your child attend?'
            : 'Na jaką sekcję uczęszcza dziecko?'
          : en
            ? 'Which section do you attend?'
            : 'Na jaką sekcję uczęszczasz?'}
      </h4>
      <p className="muted">
        {en
          ? guardianMode
            ? 'Choose the sections your child attends. An administrator must approve any change before it affects training access.'
            : 'Choose the sections you attend. An administrator must approve any change before it affects training access.'
          : guardianMode
            ? 'Wybierz sekcje, na które uczęszcza dziecko. Zmiana wymaga zatwierdzenia przez administratora i nie zmienia samodzielnie dostępu do treningów.'
            : 'Wybierz sekcje, na które uczęszczasz. Zmiana wymaga zatwierdzenia przez administratora i nie zmienia samodzielnie dostępu do treningów.'}
      </p>
      {sectionChoices?.available ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (sectionBusy || sectionDraft.length === 0) return;
            setSectionBusy(true);
            setSectionMessage('');
            void Promise.resolve(
              client.rpc('submit_my_section_request', {
                p_section_ids: sectionDraft,
              }),
            )
              .then(({ data, error }) => {
                if (
                  error ||
                  !data ||
                  !['unchanged', 'pending'].includes(data.status)
                )
                  throw error ?? new Error('Invalid section request result');
                if (data?.status === 'unchanged') {
                  setSectionMessage(
                    en
                      ? 'Your current sections are unchanged.'
                      : 'Nie zmieniono przypisanych sekcji.',
                  );
                } else {
                  setSectionMessage(
                    en
                      ? 'Section request sent for administrator approval.'
                      : 'Wniosek o zmianę sekcji wysłano do administratora.',
                  );
                }
                return client.rpc('get_my_section_choices');
              })
              .then((result) => {
                if (!result || !('data' in result)) return;
                if (result.error || !result.data) throw result.error;
                const choices = result.data as SectionChoices;
                setSectionChoices(choices);
                setSectionDraft(
                  choices.request?.status === 'pending'
                    ? choices.request.section_ids
                    : choices.assigned_section_ids,
                );
              })
              .catch(() =>
                setSectionMessage(
                  en
                    ? 'Could not submit your section request. Try again.'
                    : 'Nie udało się wysłać wniosku. Spróbuj ponownie.',
                ),
              )
              .finally(() => setSectionBusy(false));
          }}
        >
          <fieldset disabled={sectionBusy}>
            <legend>{en ? 'Sections' : 'Sekcje'}</legend>
            {sectionChoices.sections.map((section) => (
              <label key={section.id}>
                <input
                  type="checkbox"
                  checked={sectionDraft.includes(section.id)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSectionDraft((current) =>
                      checked
                        ? [...current, section.id]
                        : current.filter((id) => id !== section.id),
                    );
                  }}
                />
                {section.name}
              </label>
            ))}
          </fieldset>
          <button
            type="submit"
            className="button"
            disabled={sectionBusy || sectionDraft.length === 0}
          >
            {sectionBusy
              ? en
                ? 'Sending…'
                : 'Wysyłam…'
              : en
                ? 'Request section change'
                : 'Wyślij wniosek o zmianę sekcji'}
          </button>
        </form>
      ) : (
        sectionChoices && (
          <p className="muted">
            {en
              ? 'Section selection is available after your club profile is linked.'
              : 'Wybór sekcji będzie dostępny po powiązaniu profilu z klubem.'}
          </p>
        )
      )}
      {sectionMessage && (
        <div>
          <p role="status" className="notice">
            {sectionMessage}
          </p>
          {sectionChoices === null && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setSectionReload((revision) => revision + 1)}
            >
              {en ? 'Try again' : 'Spróbuj ponownie'}
            </button>
          )}
        </div>
      )}
    </div>
  );
  return (
    <div className="profile-account-actions">
      <div className="profile-account-actions__buttons">
        <button
          type="button"
          className="button secondary small"
          aria-haspopup="dialog"
          onClick={() => setDialog('personal')}
        >
          <Pencil size={15} />
          {guardianMode
            ? en
              ? 'Edit child’s details'
              : 'Edytuj dane dziecka'
            : en
              ? 'Edit personal details'
              : 'Edytuj dane osobowe'}
        </button>
        <button
          type="button"
          className="button secondary small"
          aria-haspopup="dialog"
          onClick={() => setDialog('sections')}
        >
          <Pencil size={15} />
          {en ? 'Edit sections' : 'Edytuj sekcje'}
        </button>
      </div>
      {sectionChoices?.request?.status === 'pending' && (
        <p className="muted">
          {en
            ? 'Your section request is awaiting administrator approval.'
            : 'Twój wniosek o sekcje czeka na zatwierdzenie administratora.'}
        </p>
      )}
      {message && !dialog && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {dialog && (
        <ProfileDialog
          title={
            dialog === 'personal'
              ? personalTitle
              : en
                ? 'Training sections'
                : 'Sekcje treningowe'
          }
          closeLabel={en ? 'Close' : 'Zamknij'}
          onClose={() => {
            if (!busy && !sectionBusy) setDialog(null);
          }}
        >
          {dialog === 'personal' ? (
            <>
              {personalForm}
              {message && (
                <p role="status" className="notice">
                  {message}
                </p>
              )}
            </>
          ) : (
            sectionContent
          )}
        </ProfileDialog>
      )}
    </div>
  );
}
