import { readRpcPages } from './lib/pagination';
import { downloadXlsx } from './lib/xlsx';
import { participantExportRows } from './lib/participant-export';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AccountLink,
  Participant,
  ParticipantLevel,
  ParticipantSection,
  Section,
  ProfileParticipant,
} from './types/club';
import SwordsLoader from './SwordsLoader';
import { feeGroup, feeGroupName } from './domain/profile';
import { matchesNameSearch } from './lib/search.ts';

interface ManagedLink extends AccountLink {
  relationship: 'self' | 'guardian';
  approval_pending: boolean;
  display_name: string | null;
  email: string | null;
  email_confirmed: boolean;
  is_registration?: boolean;
  age_years?: number | null;
}
interface Props {
  client: SupabaseClient;
  participants: Participant[];
  sections?: Section[];
  assignments?: ParticipantSection[];
  canManage: boolean;
  accountId?: string;
  renderAssignments?: (participant: Participant) => ReactNode;
  renderAccountRoles?: (accountId: string) => ReactNode;
  renderAdditionalRows?: (linkedAccountIds: string[]) => ReactNode;
  language?: 'pl' | 'en';
  onChanged: () => Promise<void>;
  onAssignmentsChanged?: (saved: {
    participantId: string;
    tier: Participant['category'];
    level: ParticipantLevel;
    sectionIds: string[];
  }) => void;
  refreshRevision?: number;
  suspended?: boolean;
}

export default function ParticipantsPanel({
  client,
  participants,
  sections = [],
  assignments = [],
  canManage,
  accountId,
  renderAssignments,
  renderAccountRoles,
  renderAdditionalRows,
  language = 'pl',
  onChanged,
  onAssignmentsChanged,
  refreshRevision,
  suspended = false,
}: Props) {
  const [search, setSearch] = useState('');
  const searching = search.trim() !== '';
  const visibleParticipants = participants.filter((person) =>
    matchesNameSearch(person.name, search),
  );
  const [busy, setBusy] = useState(false);
  const [expandedParticipant, setExpandedParticipant] = useState<string | null>(
    null,
  );
  const [mobile, setMobile] = useState(
    () =>
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(max-width: 760px)').matches),
  );
  const editorRef = useRef<HTMLDivElement>(null);
  const editorTrigger = useRef<HTMLElement | null>(null);
  const mobileSelection = participants.find(
    (person) => person.id === expandedParticipant,
  );
  // Na telefonie szczegóły zawodnika otwierają się jako okno na całym ekranie.
  const editorOpen =
    canManage &&
    mobile &&
    Boolean(mobileSelection || expandedParticipant === 'unlinked-accounts');
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 760px)');
    if (!media) return;
    const changed = () => setMobile(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editorOpen || !editor || suspended) return;
    editor.focus();
    // Pułapka fokusu okna: Tab i Shift+Tab krążą po widocznych kontrolkach,
    // Escape zamyka okno.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setExpandedParticipant(null);
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        editor.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) {
        event.preventDefault();
        editor.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === editor)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    editor.addEventListener('keydown', onKeyDown);
    return () => {
      editor.removeEventListener('keydown', onKeyDown);
      // Po zamknięciu fokus wraca na przycisk, który otworzył okno. Jeśli lista
      // została w tym czasie przebudowana, szukamy przycisku tej samej osoby,
      // a w ostateczności pola wyszukiwania.
      if (editorTrigger.current?.isConnected) editorTrigger.current.focus();
      else {
        const roster = editor.closest('.participant-roster');
        const trigger = Array.from(
          roster?.querySelectorAll<HTMLElement>('[data-participant-manage]') ??
            [],
        ).find(
          (element) =>
            element.dataset.participantManage === expandedParticipant,
        );
        if (trigger) trigger.focus();
        else
          roster
            ?.querySelector<HTMLInputElement>('input[type="search"]')
            ?.focus();
      }
    };
  }, [editorOpen, expandedParticipant, suspended]);
  const [sizeOverrideFor, setSizeOverrideFor] = useState<string | null>(null);
  const sizeDialogRef = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState('');
  const [links, setLinks] = useState<ManagedLink[]>([]);
  const [registrationCategories, setRegistrationCategories] = useState<
    Record<string, 'adult' | 'child'>
  >({});
  // Ref blokuje drugą operację od razu; stan `busy` zmieni się dopiero po
  // kolejnym renderze, więc szybkie podwójne kliknięcie mogłoby go ominąć.
  const operationPending = useRef(false);
  // Zapisy poziomu i sekcji idą w tle, kolejno dla danej osoby; numer
  // ostatniego kliknięcia decyduje, który zapis kończy wersję roboczą.
  const assignmentQueue = useRef<Record<string, Promise<void>>>({});
  const assignmentClick = useRef<Record<string, number>>({});
  const [assignmentDrafts, setAssignmentDrafts] = useState<
    Record<
      string,
      {
        category: Participant['category'];
        level: ParticipantLevel;
        sectionIds: string[];
      }
    >
  >({});
  // Pięć rozmiarów wymaganych przed awansem na poziom zaawansowany.
  const sizesComplete = (person: Participant) =>
    (['jacket', 'mask', 'pants', 'gloves', 'overlay'] as const).every(
      (key) => !!person.clothing_sizes?.[key]?.trim(),
    );
  // Wersja robocza pokazuje wybór administratora w trakcie zapisu; po zapisie
  // albo anulowaniu jest usuwana i kontrolki wracają do danych z serwera.
  const assignmentValues = (person: Participant) =>
    assignmentDrafts[person.id] ?? {
      category: person.category,
      level: person.level ?? 'beginner',
      sectionIds: assignments
        .filter((assignment) => assignment.participant_id === person.id)
        .map((assignment) => assignment.section_id),
    };
  const clearAssignmentDraft = (personId: string) =>
    setAssignmentDrafts((current) => {
      if (!(personId in current)) return current;
      const next = { ...current };
      delete next[personId];
      return next;
    });
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const say = (pl: string, en: string) => (language === 'en' ? en : pl);
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void (async () => {
      // Odroczenie o mikrozadanie: szybkie odmontowanie anuluje odczyt przed
      // pierwszą zmianą stanu.
      await Promise.resolve();
      if (!active) return;
      setLoading(true);
      setLoadError(false);
      try {
        const relations = await readRpcPages<ManagedLink>(
          (from, to) =>
            client
              .rpc('list_participant_account_access')
              .order('participant_id')
              .order('account_id')
              .range(from, to),
          () => active,
          (row) => `${row.participant_id}:${row.account_id}`,
        );
        if (relations.error) throw relations.error;
        if (active) setLinks(relations.data ?? []);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client, canManage, revision, refreshRevision]);
  // Wspólna obsługa każdej operacji administratora: blokada równoległych
  // zapisów, odświeżenie listy kont, opcjonalne odświeżenie obszaru roboczego
  // i tłumaczenie kodów błędów z bazy na komunikaty.
  const run = async (
    operation: () => Promise<void>,
    success: string,
    refreshWorkspace: boolean | (() => Promise<void>) = false,
  ) => {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setMessage('');
    setSizeOverrideFor(null);
    try {
      // Operacja blokująca czeka na zapisy poziomu i sekcji wysłane w tle.
      await Promise.all(Object.values(assignmentQueue.current));
      await operation();
      setRevision((value) => value + 1);
      if (refreshWorkspace) {
        try {
          await (
            typeof refreshWorkspace === 'function'
              ? refreshWorkspace
              : onChanged
          )();
        } catch {
          setMessage(
            say(
              'Zapisano zmianę. Odśwież stronę, aby pobrać aktualne dane.',
              'Change saved. Refresh the page to load current data.',
            ),
          );
          return;
        }
      }
      setMessage(success);
    } catch (error) {
      const detail =
        typeof error === 'object' && error && 'message' in error
          ? String(error.message)
          : '';
      setMessage(
        detail.includes('COACH_SYNC_UNAVAILABLE')
          ? say(
              'Synchronizacja trenera nie jest dostępna na serwerze. Baza wymaga aktualizacji.',
              'Coach synchronization is not available on the server. The database needs updating.',
            )
          : detail.includes('COACH_RECONCILE_FIRST')
            ? say(
                'Przed aktywacją uzgodnij poziom i rolę trenera: odbierz rolę, wybierz poziom, a po aktywacji ponownie nadaj trenera.',
                'Before activation reconcile the coach level and role: remove the role, choose a level, then grant coach again after activation.',
              )
            : detail.includes('COACH_REVOKE_FIRST')
              ? say(
                  'Najpierw odbierz rolę trenera i wybierz nowy poziom zawodnika.',
                  'First remove the coach role and choose a new participant level.',
                )
              : detail.includes('COACH_SELF_LINK_REQUIRED') ||
                  detail.includes('COACH_SELF_LINK_AMBIGUOUS')
                ? say(
                    'Trener musi mieć jedno aktywne, kompletne konto powiązane z własnym profilem.',
                    'A coach needs exactly one active, complete account linked to their own profile.',
                  )
                : say(
                    'Nie udało się wykonać operacji. Sprawdź połączenie i uprawnienia.',
                    'Could not complete the operation. Check your connection and permissions.',
                  ),
      );
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  };
  const saveAssignments = (
    person: Participant,
    change: { level?: ParticipantLevel; sectionIds?: string[] },
    withoutSizes = false,
  ) => {
    if (!canManage || busy || operationPending.current) return;
    setSizeOverrideFor(null);
    const shown = assignmentValues(person);
    const draft = { ...shown, ...change };
    const { level, sectionIds } = draft;
    setAssignmentDrafts((current) => ({ ...current, [person.id]: draft }));
    // Brak rozmiarów pomijamy tylko po świadomym „Przepisz mimo to” albo gdy
    // zawodnik już jest zaawansowany (zmiana dotyczy wtedy samych sekcji).
    const waiveSizes =
      level === 'advanced' &&
      !sizesComplete(person) &&
      (withoutSizes || shown.level === 'advanced');
    if (level === 'advanced' && !waiveSizes && !sizesComplete(person)) {
      setMessage('');
      setSizeOverrideFor(person.id);
      return;
    }
    if (
      !['beginner', 'advanced', 'coach'].includes(level) ||
      sectionIds.some(
        (id) =>
          !sections.some(
            (section) =>
              section.id === id &&
              section.audience ===
                (person.category === 'child' ? 'child' : 'adult'),
          ),
      )
    ) {
      clearAssignmentDraft(person.id);
      setMessage(
        say(
          'Wybierz sekcje odpowiednie dla kategorii uczestnika.',
          'Choose sections appropriate for the participant category.',
        ),
      );
      return;
    }
    if (
      (level === 'coach') !== (person.level === 'coach') &&
      !window.confirm(
        say(
          `Zmiana poziomu ${person.name} ${level === 'coach' ? 'na Trener nada' : 'z Trener odbierze'} także uprawnienia konta trenera. Zapisać?`,
          `Changing ${person.name} ${level === 'coach' ? 'to Coach grants' : 'from Coach removes'} coach account permissions too. Save?`,
        ),
      )
    ) {
      clearAssignmentDraft(person.id);
      return;
    }
    // Kategoria dorosłego wynika z poziomu; dziecko zostaje dzieckiem, a przy
    // poziomie Trener kategoria się nie zmienia.
    const tier: Participant['category'] =
      person.category === 'child'
        ? 'child'
        : level === 'coach'
          ? person.category
          : level === 'advanced'
            ? 'adult-advanced'
            : 'adult-beginner';
    const write = async () => {
      const { error } = await client.rpc(
        waiveSizes
          ? 'set_participant_assignments_without_sizes'
          : 'set_participant_assignments',
        {
          p_participant_id: person.id,
          p_tier: tier,
          p_level: level,
          p_section_ids: sectionIds,
        },
      );
      if (error) throw error;
    };
    const success = say(
      'Zapisano sekcje i poziom uczestnika.',
      'Participant sections and level saved.',
    );
    const queued = assignmentQueue.current[person.id] ?? Promise.resolve();
    if (level === 'coach' || person.level === 'coach') {
      void (async () => {
        await run(
          async () => {
            // Zmiana poziomu Trener wymaga synchronizacji roli konta po stronie bazy;
            // bez niej zapis rozjechałby poziom i rolę.
            const capability = await client.rpc('coach_role_sync_enabled');
            if (capability.error || capability.data !== true)
              throw new Error('COACH_SYNC_UNAVAILABLE');
            await write();
          },
          success,
          true,
        );
        clearAssignmentDraft(person.id);
      })();
      return;
    }
    // Zapis w tle: nie blokuje innych wierszy i nie odczytuje ponownie listy;
    // zapisane wartości trafiają do danych lokalnie.
    const click = (assignmentClick.current[person.id] ?? 0) + 1;
    assignmentClick.current[person.id] = click;
    setMessage('');
    assignmentQueue.current[person.id] = queued.then(async () => {
      const latest = () => assignmentClick.current[person.id] === click;
      try {
        await write();
        if (onAssignmentsChanged)
          onAssignmentsChanged({
            participantId: person.id,
            tier,
            level,
            sectionIds,
          });
        else await onChanged();
        if (latest()) setMessage(success);
      } catch {
        if (latest())
          setMessage(
            say(
              'Nie udało się zapisać zmiany. Przywrócono zapisane wartości.',
              'Could not save the change. Saved values were restored.',
            ),
          );
      } finally {
        if (latest()) clearAssignmentDraft(person.id);
      }
    });
  };
  const revokeLink = (link: ManagedLink) => {
    if (
      !canManage ||
      busy ||
      !window.confirm(
        say(
          'Cofnąć dostęp tego konta do uczestnika?',
          'Revoke this account’s access to the participant?',
        ),
      )
    )
      return;
    void run(
      async () => {
        const { data, error } = await client.rpc(
          'set_participant_account_access',
          {
            p_account_id: link.account_id,
            p_participant_id: link.participant_id,
            p_active: false,
          },
        );
        if (error || data !== true)
          throw error ?? new Error('Access not changed');
      },
      say('Cofnięto dostęp konta.', 'Account access revoked.'),
      true,
    );
  };
  const approveLink = (link: ManagedLink) => {
    const person = participants.find(
      (entry) => entry.id === link.participant_id,
    );
    if (
      !canManage ||
      busy ||
      !link.email_confirmed ||
      !link.email ||
      !window.confirm(
        say(
          `Potwierdź tożsamość odbiorcy. Nadać dostęp do ${person?.name ?? link.participant_id} kontu ${link.email} (${link.account_id})?`,
          `Verify the recipient's identity. Grant access to ${person?.name ?? link.participant_id} for ${link.email} (${link.account_id})?`,
        ),
      )
    )
      return;
    void run(
      async () => {
        const { data, error } = await client.rpc(
          link.is_registration
            ? 'approve_club_registration'
            : 'set_participant_account_access',
          link.is_registration
            ? {
                p_account_id: link.account_id,
                p_participant_id: link.participant_id,
                p_category:
                  registrationCategories[link.participant_id] ??
                  (person?.category === 'child' ? 'child' : 'adult'),
              }
            : {
                p_account_id: link.account_id,
                p_participant_id: link.participant_id,
                p_active: true,
              },
        );
        if (error || data !== true)
          throw error ?? new Error('Access not changed');
      },
      say('Zatwierdzono dostęp konta.', 'Account access approved.'),
      true,
    );
  };
  const changeCategory = (person: Participant, category: string) => {
    if (!canManage || busy || !['adult', 'child'].includes(category)) return;
    void run(
      async () => {
        const { data, error } = await client.rpc('set_participant_category', {
          p_participant_id: person.id,
          p_category: category,
        });
        if (error || data !== true)
          throw error ?? new Error('Category not changed');
      },
      say('Zapisano kategorię uczestnika.', 'Participant category saved.'),
      true,
    );
  };
  const changeStatus = (person: Participant, status: string) => {
    if (
      !canManage ||
      busy ||
      !['pending', 'active', 'suspended', 'left'].includes(status)
    )
      return;
    void run(
      async () => {
        const { data, error } = await client
          .from('participants')
          .update({ status })
          .eq('id', person.id)
          .select('id')
          .single();
        if (error || data?.id !== person.id)
          throw error ?? new Error('Status not changed');
      },
      say('Zapisano status uczestnika.', 'Participant status saved.'),
      true,
    );
  };
  const sizeOverridePerson = participants.find(
    (person) => person.id === sizeOverrideFor,
  );
  const closeSizeDialog = () => {
    if (operationPending.current) return;
    if (sizeOverrideFor) clearAssignmentDraft(sizeOverrideFor);
    setSizeOverrideFor(null);
  };
  const showSizeDialog = Boolean(
    sizeOverridePerson &&
    canManage &&
    assignmentValues(sizeOverridePerson).level === 'advanced',
  );
  const scrollLocked = !suspended && (editorOpen || showSizeDialog);
  useEffect(() => {
    if (!scrollLocked) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [scrollLocked]);
  useEffect(() => {
    const dialog = sizeDialogRef.current;
    if (!showSizeDialog || !dialog || suspended) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    dialog.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [showSizeDialog, sizeOverrideFor, suspended]);
  const sizeDialog = showSizeDialog && sizeOverridePerson && (
    <dialog
      ref={sizeDialogRef}
      className="week-modal size-override-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="size-override-title"
      aria-describedby="size-override-text"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        closeSizeDialog();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          closeSizeDialog();
      }}
    >
      <h2 id="size-override-title">
        {say('Brak rozmiarów stroju', 'Missing clothing sizes')}
      </h2>
      <p id="size-override-text">
        {say(
          `${sizeOverridePerson.name}: przed zmianą na poziom zaawansowany zawodnik musi uzupełnić rozmiary kurtki, maski, spodni, rękawic i nakładki. Zawodnik może zapisać rozmiary w Ustawienia → Profil. Możesz też przepisać go mimo to.`,
          `${sizeOverridePerson.name}: before moving to advanced level, the participant must complete jacket, mask, pants, glove and overlay sizes. The participant can save sizes in Settings → Profile. You can also move them anyway.`,
        )}
      </p>
      <div className="size-override-dialog__actions">
        <button
          type="button"
          className="button"
          aria-label={`${say('Przepisz mimo to', 'Move anyway')}: ${sizeOverridePerson.name}`}
          disabled={busy}
          onClick={() => saveAssignments(sizeOverridePerson, {}, true)}
        >
          {say('Przepisz mimo to', 'Move anyway')}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={closeSizeDialog}
        >
          {say('Anuluj', 'Cancel')}
        </button>
      </div>
    </dialog>
  );
  // Starsza baza nie ma pola beginner_membership; wtedy grupa wynika z flagi AZS.
  const membershipOf = (person: Participant) =>
    person.beginner_membership ??
    ((person as Partial<ProfileParticipant>).azs_paid ? 'azs' : 'association');
  const changeMembership = (person: Participant, membership: string) => {
    if (
      !canManage ||
      busy ||
      (membership !== 'azs' && membership !== 'association')
    )
      return;
    void run(
      async () => {
        const { data, error } = await client
          .from('participants')
          .update({ beginner_membership: membership })
          .eq('id', person.id)
          .select('id')
          .single();
        if (error || data?.id !== person.id)
          throw error ?? new Error('Fee group not changed');
      },
      say('Zapisano grupę składki.', 'Fee group saved.'),
      true,
    );
  };
  const deleteParticipant = (person: Participant) => {
    if (
      !canManage ||
      busy ||
      operationPending.current ||
      !window.confirm(
        say(
          `Czy chcesz usunąć zawodnika ${person.name}?`,
          `Do you want to delete participant ${person.name}?`,
        ),
      ) ||
      !window.confirm(
        say(
          `Potwierdź trwałe usunięcie zawodnika ${person.name}. Usunięte zostaną jego przypisania do grup, dostęp kont i odpowiedzi na treningi. Tej operacji nie można cofnąć. Konto logowania pozostanie.`,
          `Confirm permanently deleting participant ${person.name}. Their group assignments, account access and training responses will be removed. This cannot be undone. The sign-in account will remain.`,
        ),
      )
    )
      return;
    void run(
      async () => {
        const { data, error } = await client.rpc('delete_club_participant', {
          p_participant_id: person.id,
        });
        if (error || data !== true)
          throw error ?? new Error('Participant not deleted');
      },
      say('Usunięto zawodnika.', 'Participant deleted.'),
      true,
    );
  };
  const registrationCategoryField = (link: ManagedLink) => (
    <label>
      {say('Kategoria do zatwierdzenia', 'Category to approve')}
      {typeof link.age_years === 'number' && (
        <span className="muted">
          {say(`${link.age_years} lat`, `Age: ${link.age_years}`)}
        </span>
      )}
      <select
        aria-label={`${say('Kategoria rejestracji', 'Registration category')}: ${link.account_id}`}
        value={
          registrationCategories[link.participant_id] ??
          (participants.find((person) => person.id === link.participant_id)
            ?.category === 'child'
            ? 'child'
            : 'adult')
        }
        disabled={busy}
        onChange={(event) => {
          const category = event.target.value;
          if (category === 'adult' || category === 'child')
            setRegistrationCategories((current) => ({
              ...current,
              [link.participant_id]: category,
            }));
        }}
      >
        <option value="adult">{say('Dorosły', 'Adult')}</option>
        <option value="child">
          {say('Dziecko z opiekunem', 'Child with a guardian')}
        </option>
      </select>
    </label>
  );
  const pendingLinks = links.filter(
    (link) => link.approval_pending && !link.active,
  );
  const pendingApprovals = (
    <section
      className="panel pending-approvals"
      aria-labelledby="pending-approvals-heading"
    >
      <h2 id="pending-approvals-heading">
        {say('Oczekujący na akceptację', 'Awaiting approval')}{' '}
        {!loading && !loadError && <span>({pendingLinks.length})</span>}
      </h2>
      {loading ? (
        <SwordsLoader
          language={language}
          label={say('Wczytuję wnioski…', 'Loading requests…')}
        />
      ) : loadError ? (
        <p className="notice" role="alert">
          {say(
            'Nie udało się pobrać wniosków o dostęp.',
            'Could not load access requests.',
          )}{' '}
          <button
            type="button"
            className="text-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            {say('Ponów', 'Retry')}
          </button>
        </p>
      ) : pendingLinks.length ? (
        <div className="table-wrap">
          <table className="pending-approvals__table">
            <thead>
              <tr>
                <th>{say('Zawodnik', 'Participant')}</th>
                <th>{say('Konto', 'Account')}</th>
                <th>{say('Relacja', 'Relationship')}</th>
                <th>{say('Kategoria', 'Category')}</th>
                <th>{say('Działania', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pendingLinks.map((link) => {
                const name =
                  participants.find(
                    (person) => person.id === link.participant_id,
                  )?.name ?? say('Nowy zawodnik', 'New participant');
                return (
                  <tr key={`${link.participant_id}:${link.account_id}`}>
                    <td data-label={say('Zawodnik', 'Participant')}>{name}</td>
                    <td data-label={say('Konto', 'Account')}>
                      {link.display_name ??
                        say('Konto klubowe', 'Club account')}
                      <div>{link.email ?? say('Brak e-maila', 'No email')}</div>
                      <div className="muted">
                        {link.email_confirmed
                          ? say('E-mail potwierdzony', 'Email verified')
                          : say(
                              'E-mail niepotwierdzony — sprawdź konto',
                              'Email unverified — check the account',
                            )}
                      </div>
                    </td>
                    <td data-label={say('Relacja', 'Relationship')}>
                      {link.relationship === 'guardian'
                        ? say('Opiekun', 'Guardian')
                        : say('Własne konto', 'Self')}
                    </td>
                    <td data-label={say('Kategoria', 'Category')}>
                      {link.is_registration
                        ? registrationCategoryField(link)
                        : participants.find(
                              (person) => person.id === link.participant_id,
                            )?.category === 'child'
                          ? say('Dziecko z opiekunem', 'Child with a guardian')
                          : say('Dorosły', 'Adult')}
                    </td>
                    <td data-label={say('Działania', 'Actions')}>
                      <div className="pending-approvals__actions">
                        <button
                          type="button"
                          className="button small"
                          aria-label={`${say('Zatwierdź dostęp', 'Approve access')}: ${name}`}
                          disabled={
                            busy || !link.email_confirmed || !link.email
                          }
                          onClick={() => approveLink(link)}
                        >
                          {say('Zatwierdź', 'Approve')}
                        </button>
                        <button
                          type="button"
                          className="button secondary small"
                          aria-label={`${say('Odrzuć wniosek', 'Reject request')}: ${name}`}
                          disabled={busy}
                          onClick={() => revokeLink(link)}
                        >
                          {say('Odrzuć', 'Reject')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">
          {say('Nikt nie czeka na akceptację.', 'Nobody is awaiting approval.')}
        </p>
      )}
    </section>
  );
  if (!canManage) return null;
  return (
    <>
      {pendingApprovals}
      <section className="panel participant-roster">
        <div className="panel-heading">
          <h2>{say('Zawodnicy', 'Participants')}</h2>
          <button
            className="button secondary small"
            disabled={!visibleParticipants.length}
            onClick={() =>
              downloadXlsx(
                'zawodnicy.xlsx',
                say('Zawodnicy', 'Participants'),
                participantExportRows(
                  visibleParticipants,
                  sections,
                  assignments,
                  language,
                ),
              )
            }
          >
            {say('Pobierz Excel (.xlsx)', 'Download Excel (.xlsx)')}
          </button>
        </div>
        {searching && (
          <p className="muted">
            {say(
              'Eksport obejmuje wyniki wyszukiwania.',
              'Export includes search results.',
            )}
          </p>
        )}
        <label>
          {say('Szukaj zawodnika', 'Search participants')}
          <input
            type="search"
            aria-label={say('Szukaj zawodnika', 'Search participants')}
            placeholder={say('Imię i nazwisko', 'First and last name')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {searching && (
          <p className="muted" role="status">
            {visibleParticipants.length
              ? say(
                  `Znaleziono: ${visibleParticipants.length} z ${participants.length}`,
                  `Found: ${visibleParticipants.length} of ${participants.length}`,
                )
              : say('Nie znaleziono zawodników.', 'No matching participants.')}
          </p>
        )}
        {message && !editorOpen && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {!participants.length && (
          <p className="muted">{say('Brak zawodników.', 'No participants.')}</p>
        )}
        {mobile && (
          <ul
            className="participant-mobile-list"
            aria-label={say('Zawodnicy', 'Participants')}
          >
            {visibleParticipants.map((person) => (
              <li key={person.id}>
                <span className="participant-mobile-list__name">
                  {person.name}
                </span>
                <button
                  type="button"
                  className="button secondary"
                  aria-label={`${say('Edytuj zawodnika', 'Edit participant')}: ${person.name}`}
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    editorTrigger.current = event.currentTarget;
                    setExpandedParticipant(person.id);
                  }}
                >
                  {say('Edytuj', 'Edit')}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div
          className={`table-wrap participant-roster__table${editorOpen ? ' participant-roster__editor' : ''}`}
          hidden={mobile && !editorOpen}
          role={editorOpen ? 'dialog' : undefined}
          aria-modal={editorOpen ? true : undefined}
          aria-labelledby={
            editorOpen ? 'participant-editor-heading' : undefined
          }
          tabIndex={editorOpen ? -1 : undefined}
          ref={editorRef}
        >
          {editorOpen && (
            <div className="participant-roster__editor-heading">
              <h2 id="participant-editor-heading">
                {mobileSelection?.name ??
                  say('Konta bez zawodnika', 'Accounts without a participant')}
              </h2>
              <button
                type="button"
                className="button secondary"
                aria-label={say(
                  'Zamknij edycję zawodnika',
                  'Close participant editor',
                )}
                onClick={() => setExpandedParticipant(null)}
              >
                {say('Wróć do listy', 'Back to list')}
              </button>
            </div>
          )}
          {editorOpen && message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          <table role={editorOpen ? 'presentation' : undefined}>
            <thead>
              <tr>
                <th>{say('Uczestnik', 'Participant')}</th>
                <th>{say('Kategoria', 'Category')}</th>
                <th>{say('Poziom', 'Level')}</th>
                <th>{say('Grupa składki', 'Fee group')}</th>
                <th>{say('Grupy', 'Groups')}</th>
                <th>{say('Status', 'Status')}</th>
                <th>{say('Działania', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(mobile
                ? participants.filter(
                    (person) => person.id === expandedParticipant,
                  )
                : visibleParticipants
              ).map((person) => (
                <Fragment key={person.id}>
                  <tr>
                    <td>
                      {mobile ? (
                        <h3>{person.name}</h3>
                      ) : (
                        <button
                          type="button"
                          className="text-button"
                          data-participant-manage={person.id}
                          aria-label={`${say('Zarządzaj zawodnikiem', 'Manage participant')}: ${person.name}`}
                          aria-expanded={expandedParticipant === person.id}
                          aria-controls={`participant-details-${person.id}`}
                          onClick={() =>
                            setExpandedParticipant((current) =>
                              current === person.id ? null : person.id,
                            )
                          }
                        >
                          {person.name}{' '}
                          {expandedParticipant === person.id ? '−' : '+'}
                        </button>
                      )}
                    </td>
                    <td>
                      {mobile && (
                        <span className="participant-roster__field-label">
                          {say('Kategoria', 'Category')}
                        </span>
                      )}
                      <select
                        aria-label={`${say('Kategoria', 'Category')}: ${person.name}`}
                        value={person.category === 'child' ? 'child' : 'adult'}
                        disabled={busy}
                        onChange={(event) =>
                          changeCategory(person, event.target.value)
                        }
                      >
                        <option value="adult">{say('Dorosły', 'Adult')}</option>
                        <option value="child">
                          {say('Dziecko z opiekunem', 'Child with a guardian')}
                        </option>
                      </select>
                    </td>
                    <td>
                      {mobile && (
                        <span className="participant-roster__field-label">
                          {say('Poziom', 'Level')}
                        </span>
                      )}
                      <select
                        aria-label={`${say('Poziom', 'Level')}: ${person.name}`}
                        value={assignmentValues(person).level}
                        disabled={busy}
                        onChange={(event) => {
                          const level = event.target.value;
                          if (
                            level === 'beginner' ||
                            level === 'advanced' ||
                            level === 'coach'
                          )
                            saveAssignments(person, { level });
                        }}
                      >
                        <option value="beginner">
                          {say('Początkujący', 'Beginner')}
                        </option>
                        <option value="advanced">
                          {say('Zaawansowany', 'Advanced')}
                        </option>
                        <option value="coach">{say('Trener', 'Coach')}</option>
                      </select>
                    </td>
                    <td>
                      {mobile && (
                        <span className="participant-roster__field-label">
                          {say('Grupa składki', 'Fee group')}
                        </span>
                      )}
                      {person.category !== 'child' &&
                      person.level === 'beginner' ? (
                        <select
                          aria-label={`${say('Grupa składki', 'Fee group')}: ${person.name}`}
                          value={membershipOf(person)}
                          disabled={busy || !canManage}
                          onChange={(event) =>
                            changeMembership(person, event.target.value)
                          }
                        >
                          <option value="azs">
                            {feeGroupName('beginner_azs', language)}
                          </option>
                          <option value="association">
                            {feeGroupName('beginner_association', language)}
                          </option>
                        </select>
                      ) : person.level === 'coach' ? (
                        <span>{say('Zwolniony', 'Exempt')}</span>
                      ) : (
                        <span>
                          {feeGroupName(
                            feeGroup({
                              tier: person.category,
                              level: person.level,
                              azs_paid: Boolean(
                                (person as Partial<ProfileParticipant>)
                                  .azs_paid,
                              ),
                              beginner_membership: person.beginner_membership,
                            }),
                            language,
                          )}
                        </span>
                      )}
                    </td>
                    <td>
                      {mobile && (
                        <span className="participant-roster__field-label">
                          {say('Grupy', 'Groups')}
                        </span>
                      )}
                      <div
                        className="participant-groups__options choice-chips"
                        role="group"
                        aria-label={`${say('Grupy', 'Groups')}: ${person.name}`}
                      >
                        {sections
                          .filter(
                            (section) =>
                              section.audience ===
                              (person.category === 'child' ? 'child' : 'adult'),
                          )
                          .map((section) => (
                            <label className="choice-chip" key={section.id}>
                              <input
                                type="checkbox"
                                aria-label={`${say('Grupa', 'Group')}: ${section.name} — ${person.name}`}
                                checked={assignmentValues(
                                  person,
                                ).sectionIds.includes(section.id)}
                                disabled={busy}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  const current =
                                    assignmentValues(person).sectionIds;
                                  saveAssignments(person, {
                                    sectionIds: checked
                                      ? [...new Set([...current, section.id])]
                                      : current.filter(
                                          (id) => id !== section.id,
                                        ),
                                  });
                                }}
                              />
                              {section.name}
                            </label>
                          ))}
                      </div>
                    </td>
                    <td>
                      {mobile && (
                        <span className="participant-roster__field-label">
                          {say('Status', 'Status')}
                        </span>
                      )}
                      <select
                        aria-label={`${say('Status', 'Status')}: ${person.name}`}
                        value={
                          (person as Partial<ProfileParticipant>).status ??
                          'pending'
                        }
                        disabled={busy}
                        onChange={(event) =>
                          changeStatus(person, event.target.value)
                        }
                      >
                        <option value="pending">
                          {say('Oczekujący', 'Pending')}
                        </option>
                        <option value="active">
                          {say('Aktywny', 'Active')}
                        </option>
                        <option value="suspended">
                          {say('Zawieszony', 'Suspended')}
                        </option>
                        <option value="left">{say('Odszedł', 'Left')}</option>
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button secondary small"
                        aria-label={`${say('Usuń zawodnika', 'Delete participant')}: ${person.name}`}
                        disabled={busy}
                        onClick={() => deleteParticipant(person)}
                      >
                        {say('Usuń', 'Delete')}
                      </button>
                    </td>
                  </tr>

                  {expandedParticipant === person.id && (
                    <tr id={`participant-details-${person.id}`}>
                      <td colSpan={7}>
                        <div className="participant-details">
                          {renderAssignments?.(person)}
                          <h3>
                            {say(
                              'Powiązane konta i role',
                              'Linked accounts and roles',
                            )}
                          </h3>
                          <p className="muted">
                            {say(
                              'Sprawdź tożsamość i kategorię przed zatwierdzeniem dostępu. Rola trenera jest powiązana z poziomem Trener.',
                              'Verify identity and category before approving access. Coach role is synchronized with coach level.',
                            )}
                          </p>
                          {loading && (
                            <SwordsLoader
                              language={language}
                              label={say(
                                'Wczytuję dane dostępu…',
                                'Loading access data…',
                              )}
                            />
                          )}
                          {loadError && (
                            <p className="notice" role="alert">
                              {say(
                                'Nie udało się pobrać danych dostępu.',
                                'Could not load access data.',
                              )}{' '}
                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  setRevision((value) => value + 1)
                                }
                              >
                                {say('Ponów', 'Retry')}
                              </button>
                            </p>
                          )}
                          {!loading && !loadError && (
                            <>
                              {links
                                .filter(
                                  (link) => link.participant_id === person.id,
                                )
                                .map((link) => (
                                  <div
                                    className="participant-account"
                                    key={`${link.account_id}-${link.participant_id}`}
                                  >
                                    <div>
                                      {link.display_name ??
                                        say('Konto klubowe', 'Club account')}
                                      <div>
                                        {link.email ??
                                          say('Brak e-maila', 'No email')}
                                      </div>
                                      {link.account_id === accountId && (
                                        <span className="muted">
                                          {say('Twoje konto', 'Your account')}
                                        </span>
                                      )}
                                      <div className="muted">
                                        {link.email_confirmed
                                          ? say(
                                              'E-mail potwierdzony',
                                              'Email verified',
                                            )
                                          : say(
                                              'E-mail niepotwierdzony — sprawdź konto',
                                              'Email unverified — check the account',
                                            )}
                                      </div>
                                    </div>
                                    <div>
                                      {link.relationship === 'guardian'
                                        ? say('Opiekun', 'Guardian')
                                        : say('Własne konto', 'Self')}
                                    </div>
                                    <div>
                                      {link.active ? (
                                        <button
                                          className="button secondary small"
                                          disabled={busy}
                                          onClick={() => revokeLink(link)}
                                        >
                                          {say(
                                            'Cofnij dostęp',
                                            'Revoke access',
                                          )}
                                        </button>
                                      ) : (
                                        <>
                                          <span>
                                            {link.approval_pending
                                              ? say(
                                                  'Oczekuje na zatwierdzenie',
                                                  'Awaiting approval',
                                                )
                                              : say('Cofnięty', 'Revoked')}
                                          </span>{' '}
                                          {link.is_registration &&
                                            registrationCategoryField(link)}
                                          <button
                                            className="button secondary small"
                                            disabled={
                                              busy ||
                                              !link.email_confirmed ||
                                              !link.email
                                            }
                                            onClick={() => approveLink(link)}
                                          >
                                            {link.approval_pending
                                              ? say(
                                                  'Zatwierdź dostęp',
                                                  'Approve access',
                                                )
                                              : say(
                                                  'Przywróć dostęp',
                                                  'Restore access',
                                                )}
                                          </button>{' '}
                                          {link.approval_pending && (
                                            <button
                                              className="button secondary small"
                                              disabled={busy}
                                              onClick={() => revokeLink(link)}
                                            >
                                              {say(
                                                'Odrzuć wniosek',
                                                'Reject request',
                                              )}
                                            </button>
                                          )}
                                        </>
                                      )}
                                    </div>
                                    {renderAccountRoles?.(link.account_id)}
                                  </div>
                                ))}
                              {!links.some(
                                (link) => link.participant_id === person.id,
                              ) && (
                                <p className="muted">
                                  {say(
                                    'Brak powiązań kont.',
                                    'No account links.',
                                  )}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!loading &&
                !loadError &&
                !searching &&
                (!mobile || expandedParticipant === 'unlinked-accounts') &&
                renderAdditionalRows?.([
                  ...new Set(links.map((link) => link.account_id)),
                ])}
            </tbody>
          </table>
        </div>
      </section>
      {sizeDialog}
    </>
  );
}
