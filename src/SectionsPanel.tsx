import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Pencil, Plus } from './placeholderIcons';
import SwordsLoader from './SwordsLoader';
import type { Section } from './types/club';
import {
  SECTION_NAME_MAX_LENGTH,
  compareSections,
  normalizeSectionName,
  sectionAudienceLabel,
  sectionNameKey,
  sectionNameProblem,
  sectionNameTaken,
} from './lib/sections.ts';
import './sections-panel.css';

type Language = 'pl' | 'en';
type Audience = Section['audience'];
type ManagedSection = Section & { revision: number };
type LoadProblem = 'backend' | 'permission' | 'load';
type Failure =
  | 'permission'
  | 'conflict'
  | 'taken'
  | 'invalid'
  | 'missing'
  | 'backend'
  | 'network'
  | 'unknown';
type Notice = { tone: 'success' | 'error'; text: string };
type RpcError = { code?: string; message?: string } | null;
type RpcResult = { data: unknown; error: RpcError; status?: number };

const REQUEST_TIMEOUT_MS = 15000;

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const managedSection = (value: unknown): value is ManagedSection =>
  record(value) &&
  typeof value.id === 'string' &&
  Boolean(value.id) &&
  typeof value.name === 'string' &&
  (value.audience === 'adult' || value.audience === 'child') &&
  Number.isInteger(value.revision) &&
  Number(value.revision) >= 1;

function failure(result: RpcResult): Failure {
  const { error } = result;
  if (!error || result.status === 0 || !error.code) return 'network';
  const message = error.message ?? '';
  if (error.code === '42501') return 'permission';
  if (error.code === '40001' || message.includes('SECTION_REVISION_CONFLICT'))
    return 'conflict';
  if (error.code === '23505' || message.includes('SECTION_NAME_TAKEN'))
    return 'taken';
  if (error.code === 'P0002' || message.includes('SECTION_NOT_FOUND'))
    return 'missing';
  if (error.code === 'PGRST202' || error.code === '42883') return 'backend';
  if (error.code === '22023' || error.code === '23514') return 'invalid';
  return 'unknown';
}

export default function SectionsPanel({
  client,
  language,
  onChanged,
}: {
  client: SupabaseClient;
  language: Language;
  onChanged?: () => Promise<unknown> | void;
}) {
  const en = language === 'en';
  const tr = (pl: string, english: string) => (en ? english : pl);
  const [sections, setSections] = useState<ManagedSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadProblem, setLoadProblem] = useState<LoadProblem | null>(null);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(
    null,
  );
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAudience, setNewAudience] = useState<Audience | ''>('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [createUnconfirmed, setCreateUnconfirmed] = useState(false);
  // mounted i readRevision odrzucają spóźnione odpowiedzi, locked blokuje
  // równoległe zapisy, a controllers pozwala przerwać trwające żądania przy
  // odmontowaniu panelu.
  const mounted = useRef(false);
  const locked = useRef(false);
  const readRevision = useRef(0);
  const controllers = useRef(new Set<AbortController>());

  // Każde żądanie panelu ma limit czasu; po jego przekroczeniu jest przerywane.
  const withTimeout = useCallback(
    async <T,>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> => {
      const controller = new AbortController();
      controllers.current.add(controller);
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await run(controller.signal);
      } finally {
        clearTimeout(timer);
        controllers.current.delete(controller);
      }
    },
    [],
  );

  const read = useCallback(async (): Promise<ManagedSection[] | null> => {
    const request = ++readRevision.current;
    try {
      const result = (await withTimeout((signal) =>
        client
          .from('sections')
          .select('id,name,audience,revision')
          .order('name')
          .order('id')
          .abortSignal(signal),
      )) as RpcResult;
      if (!mounted.current || request !== readRevision.current) return null;
      if (result.error) {
        const code = result.error.code;
        setLoadProblem(
          code === '42703' || code === 'PGRST204'
            ? 'backend'
            : code === '42501'
              ? 'permission'
              : 'load',
        );
        return null;
      }
      if (!Array.isArray(result.data) || !result.data.every(managedSection))
        throw new Error('Invalid sections response');
      const rows = [...result.data].sort(compareSections);
      setSections(rows);
      setLoadProblem(null);
      return rows;
    } catch {
      if (mounted.current && request === readRevision.current)
        setLoadProblem('load');
      return null;
    } finally {
      if (mounted.current && request === readRevision.current)
        setLoading(false);
    }
  }, [client, withTimeout]);

  useEffect(() => {
    mounted.current = true;
    const active = controllers.current;
    const revision = readRevision;
    const identity = revision.current;
    void Promise.resolve().then(() => {
      if (mounted.current && identity === revision.current) void read();
    });
    return () => {
      mounted.current = false;
      ++revision.current;
      for (const controller of active) controller.abort();
      active.clear();
    };
  }, [read]);

  const refreshShared = async () => {
    try {
      await onChanged?.();
    } catch {
      return false;
    }
    return true;
  };

  const failureText = (kind: Failure, current?: ManagedSection) => {
    switch (kind) {
      case 'permission':
        return tr(
          'Nie masz już uprawnień administratora do zarządzania sekcjami. Odśwież portal.',
          'You no longer have administrator permission to manage sections. Refresh the portal.',
        );
      case 'conflict':
        return current
          ? tr(
              `Ktoś w międzyczasie zmienił tę sekcję. Aktualna nazwa to „${current.name}”. Sprawdź ją i zapisz ponownie.`,
              `Someone changed this section in the meantime. Its current name is “${current.name}”. Review it and save again.`,
            )
          : tr(
              'Ktoś w międzyczasie zmienił tę sekcję, a listy nie udało się odświeżyć. Odśwież listę przed ponownym zapisem.',
              'Someone changed this section in the meantime and the list could not be refreshed. Refresh the list before saving again.',
            );
      case 'taken':
        return tr(
          'Sekcja o tej nazwie już istnieje dla tej grupy odbiorców.',
          'A section with this name already exists for this audience.',
        );
      case 'invalid':
        return tr(
          'Serwer odrzucił nazwę lub odbiorców. Popraw dane i spróbuj ponownie.',
          'The server rejected the name or audience. Correct the details and try again.',
        );
      case 'missing':
        return tr(
          'Ta sekcja już nie istnieje. Lista została odświeżona.',
          'This section no longer exists. The list has been refreshed.',
        );
      case 'backend':
        return tr(
          'Zarządzanie sekcjami wymaga aktualizacji bazy danych.',
          'Section management requires a database update.',
        );
      case 'network':
        return tr(
          'Brak połączenia lub przekroczono czas oczekiwania. Zmiana nie została potwierdzona.',
          'No connection or the request timed out. The change was not confirmed.',
        );
      default:
        return tr(
          'Nie udało się zapisać sekcji. Spróbuj ponownie.',
          'Could not save the section. Try again.',
        );
    }
  };

  const savedText = (base: string, refreshed: boolean) =>
    refreshed
      ? base
      : `${base} ${tr(
          'Nie udało się jednak odświeżyć listy sekcji — użyj „Odśwież listę”.',
          'However, the section list could not be refreshed — use “Refresh list”.',
        )}`;

  const call = async (name: string, args: Record<string, unknown>) => {
    try {
      return (await withTimeout((signal) =>
        client.rpc(name, args).abortSignal(signal),
      )) as RpcResult;
    } catch {
      return { data: null, error: null, status: 0 } satisfies RpcResult;
    }
  };

  const begin = () => {
    if (!mounted.current || locked.current) return false;
    locked.current = true;
    setBusy(true);
    setNotice(null);
    return true;
  };
  const finish = () => {
    locked.current = false;
    if (mounted.current) setBusy(false);
  };

  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = editing && sections.find((row) => row.id === editing.id);
    if (!editing || !current) return;
    const name = normalizeSectionName(editing.draft);
    if (
      sectionNameProblem(name) ||
      name === current.name ||
      sectionNameTaken(sections, name, current.audience, current.id) ||
      !begin()
    )
      return;
    try {
      const result = await call('rename_club_section', {
        p_section_id: current.id,
        p_name: name,
        p_expected_revision: current.revision,
      });
      if (!mounted.current) return;
      if (!result.error && managedSection(result.data)) {
        const rows = await read();
        const shared = await refreshShared();
        if (!mounted.current) return;
        setEditing(null);
        setNotice({
          tone: 'success',
          text: savedText(
            tr(
              `Zapisano nową nazwę sekcji: „${result.data.name}”.`,
              `Saved the new section name: “${result.data.name}”.`,
            ),
            Boolean(rows) && shared,
          ),
        });
        return;
      }
      const kind = result.error ? failure(result) : 'unknown';
      const rows =
        kind === 'permission' || kind === 'backend' ? null : await read();
      if (kind === 'permission') await refreshShared();
      if (!mounted.current) return;
      const latest = rows?.find((row) => row.id === current.id);
      if (kind === 'network' && latest && latest.name === name) {
        await refreshShared();
        if (!mounted.current) return;
        setEditing(null);
        setNotice({
          tone: 'success',
          text: tr(
            'Połączenie zostało przerwane, ale nowa nazwa jest już zapisana.',
            'The connection was interrupted, but the new name is already saved.',
          ),
        });
        return;
      }
      if (kind === 'missing') setEditing(null);
      setNotice({
        tone: 'error',
        text:
          kind === 'network' && rows
            ? `${failureText(kind)} ${tr('Lista została odświeżona — spróbuj ponownie.', 'The list has been refreshed — try again.')}`
            : failureText(kind, latest),
      });
    } finally {
      finish();
    }
  };

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = normalizeSectionName(newName);
    if (
      !newAudience ||
      createUnconfirmed ||
      sectionNameProblem(name) ||
      sectionNameTaken(sections, name, newAudience) ||
      !begin()
    )
      return;
    const audience = newAudience;
    try {
      const result = await call('create_club_section', {
        p_name: name,
        p_audience: audience,
      });
      if (!mounted.current) return;
      if (!result.error && managedSection(result.data)) {
        const rows = await read();
        const shared = await refreshShared();
        if (!mounted.current) return;
        setNewName('');
        setNewAudience('');
        setAdding(false);
        setNotice({
          tone: 'success',
          text: savedText(
            tr(
              `Dodano sekcję „${result.data.name}”.`,
              `Added the section “${result.data.name}”.`,
            ),
            Boolean(rows) && shared,
          ),
        });
        return;
      }
      const kind = result.error ? failure(result) : 'network';
      const rows =
        kind === 'permission' || kind === 'backend' ? null : await read();
      if (kind === 'permission') await refreshShared();
      if (!mounted.current) return;
      if (kind === 'network') {
        const key = sectionNameKey(name);
        const created = rows?.find(
          (row) =>
            row.audience === audience && sectionNameKey(row.name) === key,
        );
        if (created) {
          await refreshShared();
          if (!mounted.current) return;
          setNewName('');
          setNewAudience('');
          setAdding(false);
          setNotice({
            tone: 'success',
            text: tr(
              `Połączenie zostało przerwane, ale sekcja „${created.name}” jest już na liście.`,
              `The connection was interrupted, but the section “${created.name}” is already on the list.`,
            ),
          });
          return;
        }
        if (!rows) setCreateUnconfirmed(true);
        setNotice({
          tone: 'error',
          text: rows
            ? tr(
                'Nie udało się dodać sekcji — połączenie zostało przerwane. Lista została sprawdzona; możesz spróbować ponownie.',
                'Could not add the section — the connection was interrupted. The list was checked; you can try again.',
              )
            : tr(
                'Nie można potwierdzić, czy sekcja została dodana. Odśwież listę przed ponowieniem.',
                'Could not confirm whether the section was added. Refresh the list before trying again.',
              ),
        });
        return;
      }
      setNotice({ tone: 'error', text: failureText(kind) });
    } finally {
      finish();
    }
  };

  const refreshList = async () => {
    if (!begin()) return;
    try {
      const rows = await read();
      if (!mounted.current) return;
      if (rows) {
        setCreateUnconfirmed(false);
        await refreshShared();
      } else
        setNotice({
          tone: 'error',
          text: tr(
            'Nie udało się odświeżyć listy sekcji.',
            'Could not refresh the section list.',
          ),
        });
    } finally {
      finish();
    }
  };

  const problemText = (
    name: string,
    audience: Audience | '',
    exceptId?: string,
  ) => {
    const problem = sectionNameProblem(name);
    if (problem === 'long')
      return tr(
        `Nazwa może mieć najwyżej ${SECTION_NAME_MAX_LENGTH} znaków.`,
        `The name can have at most ${SECTION_NAME_MAX_LENGTH} characters.`,
      );
    if (problem === 'control')
      return tr(
        'Nazwa zawiera niedozwolone znaki sterujące.',
        'The name contains disallowed control characters.',
      );
    if (
      !problem &&
      audience &&
      sectionNameTaken(sections, name, audience, exceptId)
    )
      return failureText('taken');
    return '';
  };

  const editingSection = editing
    ? sections.find((row) => row.id === editing.id)
    : undefined;
  const renameProblem =
    editing && editingSection
      ? problemText(editing.draft, editingSection.audience, editingSection.id)
      : '';
  const renameReady = Boolean(
    editing &&
    editingSection &&
    !busy &&
    !renameProblem &&
    !sectionNameProblem(editing.draft) &&
    normalizeSectionName(editing.draft) !== editingSection.name,
  );
  const createProblem = problemText(newName, newAudience);
  const createReady =
    !busy &&
    !createUnconfirmed &&
    Boolean(newAudience) &&
    !createProblem &&
    !sectionNameProblem(newName);
  const hint = tr(
    `Od 1 do ${SECTION_NAME_MAX_LENGTH} znaków. Nazwa jest wspólna dla wersji polskiej i angielskiej.`,
    `From 1 to ${SECTION_NAME_MAX_LENGTH} characters. The name is shared by the Polish and English versions.`,
  );

  return (
    <section
      className="settings-content section-manager"
      aria-labelledby="section-manager-title"
      aria-busy={busy || loading}
    >
      <div className="section-manager__heading">
        <div>
          <h3 id="section-manager-title">{tr('Sekcje', 'Sections')}</h3>
          <p className="muted">
            {tr(
              'Zmieniaj nazwy sekcji i dodawaj nowe. Nowa sekcja nie tworzy treningów, przypisań ani uprawnień.',
              'Rename sections and add new ones. A new section does not create trainings, assignments or permissions.',
            )}
          </p>
        </div>
        {!adding && !loading && !loadProblem && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              setAdding(true);
              setNotice(null);
            }}
          >
            <Plus size={16} />
            {tr('Dodaj sekcję', 'Add section')}
          </button>
        )}
      </div>
      {loading && (
        <SwordsLoader
          language={language}
          label={tr('Wczytuję sekcje…', 'Loading sections…')}
        />
      )}
      {notice && (
        <p
          className={`notice section-manager__notice section-manager__notice--${notice.tone}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
      {!loading && loadProblem && (
        <div className="section-manager__problem" role="alert">
          <p>
            {loadProblem === 'backend'
              ? failureText('backend')
              : loadProblem === 'permission'
                ? failureText('permission')
                : tr(
                    'Nie udało się wczytać sekcji.',
                    'Could not load sections.',
                  )}
          </p>
          {loadProblem === 'load' && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => void refreshList()}
            >
              {tr('Odśwież listę', 'Refresh list')}
            </button>
          )}
        </div>
      )}
      {adding && (
        <form
          className="section-manager__form"
          onSubmit={(event) => void submitCreate(event)}
          noValidate
        >
          <fieldset disabled={busy}>
            <legend>{tr('Nowa sekcja', 'New section')}</legend>
            <label htmlFor="section-manager-new-name">
              {tr('Nazwa sekcji', 'Section name')}
            </label>
            <input
              id="section-manager-new-name"
              value={newName}
              autoComplete="off"
              autoFocus
              aria-invalid={Boolean(createProblem)}
              aria-describedby="section-manager-new-hint section-manager-new-problem"
              onChange={(event) => setNewName(event.target.value)}
            />
            <p id="section-manager-new-hint" className="muted">
              {hint}
            </p>
            <p
              id="section-manager-new-problem"
              className="section-manager__field-error"
              aria-live="polite"
            >
              {createProblem}
            </p>
            <fieldset className="section-manager__audience">
              <legend>{tr('Odbiorcy', 'Audience')}</legend>
              {(['adult', 'child'] as const).map((audience) => (
                <label className="checkbox-label" key={audience}>
                  <input
                    type="radio"
                    name="section-audience"
                    value={audience}
                    checked={newAudience === audience}
                    onChange={() => setNewAudience(audience)}
                  />
                  {sectionAudienceLabel(audience, language)}
                </label>
              ))}
            </fieldset>
            <div className="section-manager__actions">
              <button type="submit" className="button" disabled={!createReady}>
                {tr('Dodaj', 'Add')}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setAdding(false);
                  setNewName('');
                  setNewAudience('');
                }}
              >
                {tr('Anuluj', 'Cancel')}
              </button>
              {createUnconfirmed && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void refreshList()}
                >
                  {tr('Odśwież listę', 'Refresh list')}
                </button>
              )}
            </div>
          </fieldset>
        </form>
      )}
      {!loading && !loadProblem && (
        <>
          {!sections.length ? (
            <p className="muted">{tr('Brak sekcji.', 'No sections.')}</p>
          ) : (
            <ul className="section-manager__list">
              {sections.map((section) =>
                editing?.id === section.id ? (
                  <li className="section-manager__item" key={section.id}>
                    <form
                      className="section-manager__rename"
                      onSubmit={(event) => void submitRename(event)}
                      noValidate
                    >
                      <fieldset disabled={busy}>
                        <legend className="visually-hidden">
                          {tr(
                            `Zmiana nazwy sekcji „${section.name}”`,
                            `Rename section “${section.name}”`,
                          )}
                        </legend>
                        <div className="section-manager__summary">
                          <strong>{section.name}</strong>
                          <span className="badge">
                            {sectionAudienceLabel(section.audience, language)}
                          </span>
                        </div>
                        <label htmlFor="section-manager-rename">
                          {tr('Nowa nazwa sekcji', 'New section name')}
                        </label>
                        <input
                          id="section-manager-rename"
                          value={editing.draft}
                          autoComplete="off"
                          autoFocus
                          aria-invalid={Boolean(renameProblem)}
                          aria-describedby="section-manager-rename-hint section-manager-rename-problem"
                          onChange={(event) =>
                            setEditing({
                              id: section.id,
                              draft: event.target.value,
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') setEditing(null);
                          }}
                        />
                        <p id="section-manager-rename-hint" className="muted">
                          {hint}
                        </p>
                        <p
                          id="section-manager-rename-problem"
                          className="section-manager__field-error"
                          aria-live="polite"
                        >
                          {renameProblem}
                        </p>
                        <div className="section-manager__actions">
                          <button
                            type="submit"
                            className="button"
                            disabled={!renameReady}
                          >
                            {tr('Zapisz', 'Save')}
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => setEditing(null)}
                          >
                            {tr('Anuluj', 'Cancel')}
                          </button>
                        </div>
                      </fieldset>
                    </form>
                  </li>
                ) : (
                  <li className="section-manager__item" key={section.id}>
                    <div className="section-manager__summary">
                      <strong>{section.name}</strong>
                      <span className="badge">
                        {sectionAudienceLabel(section.audience, language)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      aria-label={tr(
                        `Zmień nazwę sekcji „${section.name}”`,
                        `Rename section “${section.name}”`,
                      )}
                      onClick={() => {
                        setEditing({ id: section.id, draft: section.name });
                        setNotice(null);
                      }}
                    >
                      <Pencil size={15} />
                      {tr('Zmień nazwę', 'Rename')}
                    </button>
                  </li>
                ),
              )}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
