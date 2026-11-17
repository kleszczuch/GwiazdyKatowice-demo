import { warsawToday } from './lib/warsaw-date.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Section } from './types/club';
import type {
  RegularTraining,
  RegularTrainingChanges,
} from './types/regular-training';
import { readRpcPages } from './lib/pagination';
import TrainingCoachSelect from './TrainingCoachSelect';
import TrainingIconPicker from './TrainingIconPicker';
import { trainingIcon } from './lib/training-icons';
import './regular-trainings.css';
import SwordsLoader from './SwordsLoader';
import { sectionLabel } from './lib/sections.ts';
import { modalKeys } from './lib/modal-keys.ts';
import { EQUIPMENT_ITEMS, equipmentLabel } from './lib/equipment-catalog.ts';
import {
  normalizeRequiredSelection,
  requiredEquipmentText,
} from './lib/required-equipment.ts';
import {
  TRAINING_COLORS,
  trainingColor,
  trainingColorLabel,
} from './lib/training-colors.ts';

interface Props {
  client: SupabaseClient;
  sections: Section[];
  language: 'pl' | 'en';
  onChanged: () => Promise<void>;
}
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const day = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const time = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?$/.test(value);
// Pełna walidacja odpowiedzi RPC. Pola icon, required_equipment i color są
// opcjonalne, bo starsza baza ich nie zwraca; jeśli są, muszą być poprawne.
function readRows(value: unknown): RegularTraining[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (row: unknown) =>
        record(row) &&
        typeof row.id === 'string' &&
        row.id &&
        typeof row.section_id === 'string' &&
        day(row.starts_on) &&
        Number.isInteger(row.weekday) &&
        Number(row.weekday) >= 1 &&
        Number(row.weekday) <= 7 &&
        time(row.local_start) &&
        time(row.local_end) &&
        typeof row.group_label === 'string' &&
        typeof row.location === 'string' &&
        (!Object.hasOwn(row, 'icon') ||
          row.icon === null ||
          (typeof row.icon === 'string' &&
            trainingIcon(row.icon) === row.icon)) &&
        (!Object.hasOwn(row, 'required_equipment') ||
          row.required_equipment === null ||
          (Array.isArray(row.required_equipment) &&
            row.required_equipment.every(
              (item: unknown) =>
                typeof item === 'string' &&
                (EQUIPMENT_ITEMS as readonly string[]).includes(item),
            ))) &&
        (!Object.hasOwn(row, 'color') ||
          row.color === null ||
          trainingColor(row.color) === row.color) &&
        (row.coach_account_id === null ||
          typeof row.coach_account_id === 'string') &&
        (row.coach_name === null || typeof row.coach_name === 'string') &&
        typeof row.coach_available === 'boolean' &&
        typeof row.is_active === 'boolean' &&
        Number.isInteger(row.revision) &&
        Number(row.revision) >= 0 &&
        Number.isInteger(row.future_count) &&
        Number(row.future_count) >= 0 &&
        (row.ends_on === null || day(row.ends_on)) &&
        (row.generated_until === null || day(row.generated_until)) &&
        (row.generation_error === undefined ||
          row.generation_error === null ||
          typeof row.generation_error === 'string'),
    )
  )
    throw new Error('Invalid regular trainings');
  return value as RegularTraining[];
}
export default function RegularTrainingsPanel({
  client,
  sections,
  language,
  onChanged,
}: Props) {
  const en = language === 'en';
  const tr = (pl: string, english: string) => (en ? english : pl);
  const days = en
    ? [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ]
    : [
        'Poniedziałek',
        'Wtorek',
        'Środa',
        'Czwartek',
        'Piątek',
        'Sobota',
        'Niedziela',
      ];
  const [rows, setRows] = useState<RegularTraining[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [missing, setMissing] = useState(false);
  const [icons, setIcons] = useState<'available' | 'unavailable' | 'unknown'>(
    'unknown',
  );
  const [equipment, setEquipment] = useState<
    'available' | 'unavailable' | 'unknown'
  >('unknown');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [editor, setEditor] = useState<{
    training: RegularTraining | null;
    activate: boolean;
  } | null>(null);
  const [coachId, setCoachId] = useState('');
  const [recovery, setRecovery] = useState<
    'saved' | 'unknown' | 'conflict' | null
  >(null);
  // Zabezpieczenia operacji asynchronicznych:
  // - mounted / lifetime: rozpoznają odmontowanie i ponowne zamontowanie, żeby
  //   spóźniona odpowiedź nie zmieniła stanu nowej instancji,
  // - epoch: numer odczytu listy; liczy się tylko najnowszy,
  // - locked: synchroniczna blokada drugiej operacji (stan `busy` działa
  //   dopiero po renderze).
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const epoch = useRef(0);
  const locked = useRef(false);
  const editorElement = useRef<HTMLElement>(null);
  const read = useCallback(async () => {
    const request = ++epoch.current;
    setLoading(true);
    const result = await readRpcPages<RegularTraining>(
      (from, to) =>
        client
          .rpc('list_regular_trainings')
          .order('section_id')
          .order('weekday')
          .order('local_start')
          .order('id')
          .range(from, to),
      () => mounted.current && request === epoch.current,
      (row) => row.id,
    );
    if (!mounted.current || request !== epoch.current) return false;
    try {
      if (result.error) throw result.error;
      const nextRows = readRows(result.data);
      let nextIcons: 'available' | 'unavailable' | 'unknown';
      if (nextRows.length) {
        // Dostępność ikon rozpoznajemy po obecności pola w wierszach; przy pustej
        // liście pytamy bazę próbnym odczytem kolumny.
        const flags = nextRows.map((row) => Object.hasOwn(row, 'icon'));
        if (flags.some(Boolean) && !flags.every(Boolean))
          throw new Error('Inconsistent training icons');
        nextIcons = flags[0] ? 'available' : 'unavailable';
      } else {
        try {
          const probe = await client.from('trainings').select('icon').limit(1);
          if (probe.error) {
            const error = probe.error;
            nextIcons =
              (error.code === '42703' || error.code === 'PGRST204') &&
              /\bicon\b/i.test(error.message)
                ? 'unavailable'
                : 'unknown';
          } else
            nextIcons = Array.isArray(probe.data) ? 'available' : 'unknown';
        } catch {
          nextIcons = 'unknown';
        }
      }
      let nextEquipment: 'available' | 'unavailable' | 'unknown';
      if (nextRows.length) {
        const flags = nextRows.map(
          (row) =>
            Object.hasOwn(row, 'required_equipment') &&
            Object.hasOwn(row, 'color'),
        );
        if (flags.some(Boolean) && !flags.every(Boolean))
          throw new Error('Inconsistent regular training options');
        nextEquipment = flags[0] ? 'available' : 'unavailable';
      } else {
        try {
          const probe = await client
            .from('training_series')
            .select('required_equipment,color')
            .limit(1);
          if (probe.error) {
            const error = probe.error;
            nextEquipment =
              (error.code === '42703' || error.code === 'PGRST204') &&
              /\b(required_equipment|color)\b/i.test(error.message)
                ? 'unavailable'
                : 'unknown';
          } else
            nextEquipment = Array.isArray(probe.data) ? 'available' : 'unknown';
        } catch {
          nextEquipment = 'unknown';
        }
      }
      if (!mounted.current || request !== epoch.current) return false;
      setIcons(nextIcons);
      setEquipment(nextEquipment);
      setRows(nextRows);
      setLoadError(false);
      setMissing(false);
      return true;
    } catch (error) {
      setRows([]);
      setIcons('unknown');
      setEquipment('unknown');
      setLoadError(true);
      setMissing(
        record(error) && (error.code === 'PGRST202' || error.code === '42883'),
      );
      return false;
    } finally {
      if (mounted.current && request === epoch.current) setLoading(false);
    }
  }, [client]);
  useEffect(() => {
    mounted.current = true;
    // Odczyt startuje w mikrozadaniu i tylko wtedy, gdy ta instancja nadal
    // żyje; efekt sprzątnięty od razu po uruchomieniu nie wysyła żądania.
    const identity = ++lifetime.current;
    void Promise.resolve().then(() => {
      if (mounted.current && identity === lifetime.current) void read();
    });
    const generation = epoch,
      lifecycle = lifetime;
    return () => {
      mounted.current = false;
      generation.current++;
      lifecycle.current++;
    };
  }, [read]);
  useEffect(() => {
    if (editor) editorElement.current?.focus();
  }, [editor]);

  // Po zapisie odświeżamy listę serii i obszar roboczy. Gdy któreś zawiedzie,
  // `recovery` zatrzymuje dalsze zmiany do udanego odświeżenia, bo ekran może
  // pokazywać nieaktualny stan.
  async function refresh(saved: boolean, note = '') {
    const identity = lifetime.current;
    const results = await Promise.allSettled([read(), onChanged()]);
    if (!mounted.current || identity !== lifetime.current) return;
    const ok = results.every(
      (result) => result.status === 'fulfilled' && result.value !== false,
    );
    setRecovery(ok ? null : saved ? 'saved' : 'unknown');
    if (ok) {
      setEditor(null);
      setMessage(
        saved
          ? tr('Zapisano regularny trening.', 'Regular training saved.') + note
          : tr(
              'Odświeżono dane. Sprawdź aktualny stan przed kolejną zmianą.',
              'Data refreshed. Check current state before another change.',
            ),
      );
    }
  }
  const failed = (changes: Record<string, unknown>) =>
    setMessage(
      tr(
        'Nie udało się zapisać treningu. Sprawdź dane i uprawnienia.',
        'Could not save training. Check details and permissions.',
      ) +
        (changes.section_id
          ? tr(
              ' Zmiana sekcji wymaga aktualizacji bazy.',
              ' Changing the section requires a database update.',
            )
          : ''),
    );
  // Jedno kliknięcie zapisuje. Przy zmianie serii baza najpierw liczy objęte
  // terminy i zwraca fingerprint, z którym od razu wysyłamy zapis; błąd 40001
  // oznacza, że seria zmieniła się między tymi krokami.
  async function save(
    training: RegularTraining | null,
    payload: Record<string, unknown>,
  ) {
    if (!mounted.current || locked.current || loading || loadError || recovery)
      return;
    locked.current = true;
    setBusy(true);
    setMessage('');
    const identity = lifetime.current;
    const alive = () => mounted.current && identity === lifetime.current;
    let sent = false;
    let saved = false;
    try {
      let args = payload;
      let note = '';
      if (training) {
        const preview = await client.rpc('preview_regular_training_update', {
          p_series_id: training.id,
          p_changes: payload,
        });
        if (!alive()) return;
        const counted: unknown = preview.data;
        if (
          preview.error ||
          !record(counted) ||
          typeof counted.fingerprint !== 'string' ||
          !counted.fingerprint ||
          !Number.isInteger(counted.affected_count) ||
          Number(counted.affected_count) < 0 ||
          !Number.isInteger(counted.skipped_count) ||
          Number(counted.skipped_count) < 0
        ) {
          failed(payload);
          return;
        }
        args = {
          p_series_id: training.id,
          p_changes: payload,
          p_expected_fingerprint: counted.fingerprint,
        };
        note = tr(
          ` Zmienione terminy: ${counted.affected_count}, pominięte: ${counted.skipped_count}.`,
          ` Occurrences changed: ${counted.affected_count}, skipped: ${counted.skipped_count}.`,
        );
      }
      sent = true;
      const { data, error } = await client.rpc(
        training ? 'update_regular_training' : 'create_regular_training',
        args,
      );
      if (error) {
        if (alive()) {
          if (record(error) && error.code === '40001') setRecovery('conflict');
          else failed(payload);
        }
        return;
      }
      const valid = training
        ? record(data) &&
          Number.isInteger(data.updated_count) &&
          Number(data.updated_count) >= 0 &&
          Number.isInteger(data.revision) &&
          Number(data.revision) >= 0
        : typeof data === 'string' && Boolean(data);
      // Odpowiedź o nieznanym kształcie nie potwierdza zapisu: traktujemy wynik
      // jako niepewny i każemy odświeżyć dane.
      if (!valid) throw new Error('Uncertain mutation response');
      saved = true;
      if (!alive()) {
        await onChanged();
        return;
      }
      setEditor(null);
      await refresh(true, note);
    } catch {
      if (alive()) {
        if (sent) setRecovery(saved ? 'saved' : 'unknown');
        else failed(payload);
      }
    } finally {
      if (alive()) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  async function retry() {
    if (!mounted.current || locked.current) return;
    locked.current = true;
    setBusy(true);
    const identity = lifetime.current;
    try {
      if (recovery) await refresh(recovery === 'saved');
      else await read();
    } finally {
      if (mounted.current && identity === lifetime.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  // Zapis wyłączonego bloku od razu go uruchamia (decyzja właściciela z 16.11.2026).
  const open = (training: RegularTraining | null) => {
    if (locked.current || recovery) return;
    setMessage('');
    setCoachId(training?.coach_account_id ?? '');
    setEditor({ training, activate: Boolean(training && !training.is_active) });
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || locked.current || recovery) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const values = {
      section_id: text('section'),
      weekday: Number(text('weekday')),
      local_start: text('start'),
      local_end: text('end'),
      group_label: text('group'),
      location: text('location'),
      coach_account_id: text('coach_account_id'),
      ...(icons === 'available'
        ? { icon: trainingIcon(form.get('icon')) }
        : {}),
    };
    if (
      !values.coach_account_id ||
      !values.group_label ||
      !values.location ||
      !time(values.local_start) ||
      !time(values.local_end) ||
      values.local_end <= values.local_start
    ) {
      setMessage(
        tr(
          'Wybierz trenera i poprawne godziny; koniec musi być późniejszy od początku.',
          'Choose a coach and valid times; end must be after start.',
        ),
      );
      return;
    }
    const requiredEquipment =
      equipment === 'available'
        ? normalizeRequiredSelection(
            form.getAll('required_equipment').map(String),
          )
        : undefined;
    const color =
      equipment === 'available' ? trainingColor(form.get('color')) : undefined;
    if (!editor.training) {
      await save(null, {
        p_section_id: values.section_id,
        p_starts_on: text('date'),
        p_weekday: values.weekday,
        p_start: values.local_start,
        p_end: values.local_end,
        p_group: values.group_label,
        p_location: values.location,
        p_coach_account_id: values.coach_account_id,
        ...(icons === 'available' ? { p_icon: values.icon } : {}),
        ...(requiredEquipment !== undefined
          ? {
              p_icon: icons === 'available' ? values.icon : null,
              p_required_equipment: requiredEquipment,
              p_color: color ?? null,
            }
          : {}),
      });
      return;
    }
    const training = editor.training;
    const changes: RegularTrainingChanges = {};
    for (const key of Object.keys(values) as (keyof typeof values)[]) {
      const before =
        key === 'local_start' || key === 'local_end'
          ? training[key].slice(0, 5)
          : training[key];
      if (values[key] !== before)
        Object.assign(changes, { [key]: values[key] });
    }
    if (
      requiredEquipment !== undefined &&
      JSON.stringify(requiredEquipment) !==
        JSON.stringify(training.required_equipment ?? null)
    )
      changes.required_equipment = requiredEquipment;
    if (color !== undefined && color !== (training.color ?? null))
      changes.color = color;
    if (editor.activate) changes.is_active = true;
    if (!Object.keys(changes).length) {
      setMessage(tr('Brak zmian do zapisania.', 'No changes to save.'));
      return;
    }
    await save(training, changes);
  }
  const editing = editor?.training;
  const sectionName = (id: string) => {
    const section = sections.find((entry) => entry.id === id);
    return section ? sectionLabel(section, sections, language) : id;
  };
  const close = () => {
    setMessage('');
    setEditor(null);
  };
  const disable = (training: RegularTraining) => {
    if (
      window.confirm(
        tr(
          'Wyłączyć ten regularny trening? Przyszłe terminy zostaną odwołane. Historia i odpowiedzi pozostaną zachowane.',
          'Disable this regular training? Future occurrences will be canceled. History and responses will be preserved.',
        ),
      )
    )
      void save(training, { is_active: false });
  };
  const editorForm = editor && !recovery && (
    <div className="week-modal-backdrop">
      <section
        ref={editorElement}
        tabIndex={-1}
        className="week-modal week-modal--editor regular-trainings__editor"
        role="dialog"
        aria-modal="true"
        aria-label={
          editing
            ? tr('Edycja regularnego treningu', 'Edit regular training')
            : tr('Nowy regularny trening', 'New regular training')
        }
        onKeyDown={(event) => modalKeys(event, busy ? null : close)}
      >
        <div className="panel-heading">
          <h2>
            {editing
              ? `${sectionName(editing.section_id)} · ${editing.group_label}`
              : tr('Nowy regularny trening', 'New regular training')}
          </h2>
          <button className="text-button" disabled={busy} onClick={close}>
            {tr('Zamknij', 'Close')}
          </button>
        </div>
        <p className="muted">
          {editor.activate
            ? tr(
                'Ten trening jest wyłączony. Zapis włączy go: będzie powtarzał się co tydzień bez daty końca.',
                'This training is disabled. Saving turns it on: it will repeat weekly without an end date.',
              )
            : editing
              ? tr(
                  `Zmiany obejmą przyszłe terminy (${editing.future_count}). Historia i odpowiedzi zostają.`,
                  `Changes apply to future occurrences (${editing.future_count}). History and responses stay.`,
                )
              : tr(
                  'Blok powtarza się co tydzień, aż go wyłączysz.',
                  'The block repeats weekly until you disable it.',
                )}
        </p>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <form
          key={`${editing?.id ?? 'new'}:${editor.activate}`}
          onSubmit={submit}
          onChange={() => setMessage('')}
        >
          <fieldset disabled={busy}>
            <div className="form-grid">
              <h3 className="regular-trainings__group">
                {tr('Termin', 'When')}
              </h3>
              <label>
                {tr('Dzień tygodnia', 'Weekday')}
                <select
                  name="weekday"
                  defaultValue={editing?.weekday ?? 1}
                  required
                >
                  {days.map((name, index) => (
                    <option key={index} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              {!editing && (
                <label>
                  {tr('Data rozpoczęcia', 'Start date')}
                  <input
                    name="date"
                    type="date"
                    min={warsawToday()}
                    defaultValue={warsawToday()}
                    required
                  />
                </label>
              )}
              <label>
                {tr('Od', 'From')}
                <input
                  name="start"
                  type="time"
                  defaultValue={editing?.local_start.slice(0, 5) ?? '18:00'}
                  required
                />
              </label>
              <label>
                {tr('Do', 'To')}
                <input
                  name="end"
                  type="time"
                  defaultValue={editing?.local_end.slice(0, 5) ?? '19:30'}
                  required
                />
              </label>
              <h3 className="regular-trainings__group">
                {tr('Zajęcia', 'Training')}
              </h3>
              <label>
                {tr('Sekcja', 'Section')}
                <select
                  name="section"
                  defaultValue={editing?.section_id ?? sections[0]?.id}
                  required
                >
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {sectionLabel(section, sections, language)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr('Grupa / poziom', 'Group / level')}
                <input
                  name="group"
                  maxLength={120}
                  defaultValue={editing?.group_label ?? ''}
                  required
                />
              </label>
              <label>
                {tr('Sala / miejsce', 'Location')}
                <input
                  name="location"
                  maxLength={200}
                  defaultValue={editing?.location ?? ''}
                  required
                />
              </label>
              <TrainingCoachSelect
                client={client}
                value={coachId}
                disabled={busy}
                language={language}
                onChange={(id) => setCoachId(id)}
              />
              {(icons === 'available' || equipment === 'available') && (
                <h3 className="regular-trainings__group">
                  {tr('Wygląd w kalendarzu', 'Calendar look')}
                </h3>
              )}
              {icons === 'available' && (
                <TrainingIconPicker language={language} value={editing?.icon} />
              )}
              {equipment === 'available' && (
                <fieldset className="regular-trainings__colors">
                  <legend>{tr('Kolor w kalendarzu', 'Calendar color')}</legend>
                  <div className="choice-chips">
                    {[null, ...TRAINING_COLORS.map((entry) => entry.key)].map(
                      (key) => (
                        <label
                          key={key ?? 'default'}
                          className={`choice-chip regular-trainings__color regular-trainings__color--${key ?? 'default'}`}
                        >
                          <input
                            type="radio"
                            name="color"
                            value={key ?? ''}
                            defaultChecked={(editing?.color ?? null) === key}
                          />
                          <span aria-hidden="true" />
                          {trainingColorLabel(key, language)}
                        </label>
                      ),
                    )}
                  </div>
                </fieldset>
              )}
              {equipment === 'available' && (
                <fieldset className="regular-trainings__equipment">
                  <legend>
                    {tr('Potrzebny sprzęt', 'Required equipment')}
                  </legend>
                  <p className="muted">
                    {tr(
                      'Zaznacz, co jest potrzebne. Zawodnik widzi tę listę w szczegółach treningu, a kadra liczy sprzęt klubowy tylko dla zaznaczonych pozycji.',
                      'Select what is needed. Participants see this list in training details, and staff count club equipment only for selected items.',
                    )}
                  </p>
                  <div className="choice-chips">
                    {EQUIPMENT_ITEMS.map((item) => (
                      <label className="choice-chip" key={item}>
                        <input
                          type="checkbox"
                          name="required_equipment"
                          value={item}
                          defaultChecked={(
                            editing?.required_equipment ?? EQUIPMENT_ITEMS
                          ).includes(item)}
                        />
                        {equipmentLabel(item, language)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
            <div className="regular-trainings__actions regular-trainings__footer">
              {editing?.is_active && (
                <button
                  type="button"
                  className="button danger"
                  onClick={() => disable(editing)}
                >
                  {tr('Wyłącz trening', 'Disable training')}
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                onClick={close}
              >
                {tr('Anuluj', 'Cancel')}
              </button>
              <button className="button" type="submit">
                {busy
                  ? tr('Zapisuję…', 'Saving…')
                  : editor.activate
                    ? tr('Zapisz i uruchom', 'Save and activate')
                    : editing
                      ? tr('Zapisz zmiany', 'Save changes')
                      : tr('Utwórz trening', 'Create training')}
              </button>
            </div>
          </fieldset>
        </form>
      </section>
    </div>
  );
  return (
    <section className="panel regular-trainings">
      <div className="regular-trainings__heading">
        <h2>{tr('Regularne treningi', 'Regular trainings')}</h2>
        <button
          className="button"
          disabled={
            busy ||
            loading ||
            loadError ||
            Boolean(recovery) ||
            !sections.length
          }
          onClick={() => open(null)}
        >
          {tr('Dodaj trening', 'Add training')}
        </button>
      </div>
      <p className="muted">
        {tr(
          'Każdy blok powtarza się co tydzień do wyłączenia i ma jednego głównego trenera. Godziny według Europe/Warsaw.',
          'Each block repeats weekly until disabled and has one main coach. Times use Europe/Warsaw.',
        )}
      </p>
      {message && !editor && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {loading && (
        <SwordsLoader
          language={language}
          label={tr('Wczytywanie treningów…', 'Loading trainings…')}
        />
      )}
      {loadError && (
        <p role="alert">
          {missing
            ? tr(
                'Serwer nie obsługuje jeszcze regularnych treningów. Potrzebna jest aktualizacja bazy.',
                'The server does not support regular trainings yet. A database update is required.',
              )
            : tr(
                'Nie udało się wczytać treningów.',
                'Could not load trainings.',
              )}
        </p>
      )}
      {recovery && (
        <p className="notice" role="alert">
          {recovery === 'conflict'
            ? tr(
                'Trening zmienił się w międzyczasie. Odśwież dane i wprowadź zmianę ponownie.',
                'Training changed in the meantime. Refresh data and make the change again.',
              )
            : recovery === 'saved'
              ? tr(
                  'Zmiany zapisane, ale odświeżenie nie powiodło się. Ponów odczyt, bez ponownego zapisu.',
                  'Changes saved, but refresh failed. Retry reading without saving again.',
                )
              : tr(
                  'Wynik zapisu jest niepewny. Odśwież dane przed kolejną zmianą; zapis nie będzie ponawiany automatycznie.',
                  'Save outcome is uncertain. Refresh data before another change; saving will not be retried automatically.',
                )}
        </p>
      )}
      {(loadError || recovery) && (
        <button
          className="button secondary"
          disabled={busy || loading}
          onClick={() => void retry()}
        >
          {tr('Odśwież dane', 'Refresh data')}
        </button>
      )}
      {!loading && !loadError && (
        <>
          {!rows.length && (
            <p>{tr('Brak regularnych treningów.', 'No regular trainings.')}</p>
          )}
          {icons !== 'available' && (
            <p className="notice" role="status">
              {icons === 'unavailable'
                ? tr(
                    'Ikonki treningów nie są jeszcze dostępne w bazie. Pozostałe zmiany można zapisać.',
                    'Training icons are not available in the database yet. Other changes can be saved.',
                  )
                : tr(
                    'Nie udało się sprawdzić dostępności ikonek. Pozostałe zmiany można zapisać.',
                    'Could not check training icon availability. Other changes can be saved.',
                  )}
              {icons === 'unknown' && (
                <button
                  className="button secondary small"
                  disabled={busy || loading}
                  onClick={() => void retry()}
                >
                  {tr('Sprawdź ponownie', 'Check again')}
                </button>
              )}
            </p>
          )}
          <div className="regular-trainings__days">
            {days.map((name, index) => {
              const weekdayRows = rows
                .filter((training) => training.weekday === index + 1)
                .sort((first, second) =>
                  first.local_start.localeCompare(second.local_start),
                );
              if (!weekdayRows.length) return null;
              return (
                <details
                  className="regular-trainings__day"
                  key={index + 1}
                  open
                >
                  <summary className="regular-trainings__day-summary">
                    <span>{name}</span>
                    <span className="muted">
                      {weekdayRows.length}{' '}
                      {en
                        ? weekdayRows.length === 1
                          ? 'training'
                          : 'trainings'
                        : weekdayRows.length % 10 >= 2 &&
                            weekdayRows.length % 10 <= 4 &&
                            (weekdayRows.length % 100 < 12 ||
                              weekdayRows.length % 100 > 14)
                          ? 'treningi'
                          : weekdayRows.length === 1
                            ? 'trening'
                            : 'treningów'}
                    </span>
                  </summary>
                  <ul className="regular-trainings__list">
                    {weekdayRows.map((training) => (
                      <li
                        className={`regular-trainings__item regular-trainings__color--${training.color ?? 'default'}${training.is_active ? '' : ' is-off'}`}
                        key={training.id}
                        data-training-id={training.id}
                      >
                        <strong className="regular-trainings__time">
                          {training.local_start.slice(0, 5)}–
                          {training.local_end.slice(0, 5)}
                        </strong>
                        <div className="regular-trainings__info">
                          <h3>
                            {sectionName(training.section_id)} ·{' '}
                            {training.group_label}
                          </h3>
                          <p className="muted">
                            {training.location} ·{' '}
                            {tr('Główny trener', 'Main coach')}:{' '}
                            {training.coach_account_id
                              ? training.coach_name ||
                                tr('Trener niedostępny', 'Coach unavailable')
                              : tr('Nie przypisano', 'Not assigned')}
                          </p>
                          {equipment === 'available' && (
                            <p className="muted">
                              {tr('Potrzebny sprzęt', 'Required equipment')}:{' '}
                              {requiredEquipmentText(
                                training.required_equipment,
                                language,
                              )}
                            </p>
                          )}
                          {!training.is_active && (
                            <span className="badge">
                              {training.ends_on
                                ? tr(
                                    'Skończony cykl — nie powtarza się',
                                    'Bounded series — not repeating',
                                  )
                                : tr('Wyłączony', 'Disabled')}
                            </span>
                          )}
                          {!training.coach_available && (
                            <p role="status">
                              {tr(
                                'Wybierz aktywnego głównego trenera.',
                                'Choose an active main coach.',
                              )}
                            </p>
                          )}
                          {training.generation_error && (
                            <p role="alert">
                              {tr(
                                'Nie udało się przedłużyć harmonogramu. Sprawdź dzień i godziny treningu.',
                                'Could not extend the schedule. Check the training day and times.',
                              )}
                            </p>
                          )}
                        </div>
                        <div className="regular-trainings__actions">
                          <button
                            className="button secondary small"
                            disabled={busy || Boolean(recovery)}
                            onClick={() => open(training)}
                          >
                            {tr('Edytuj trening', 'Edit training')}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
      {editorForm}
    </section>
  );
}
