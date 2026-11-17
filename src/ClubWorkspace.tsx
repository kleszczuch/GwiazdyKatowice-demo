import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  Home,
  Hourglass,
  Menu,
  SlidersHorizontal,
  Star,
  Swords,
  Users,
  UserRound,
  Wallet,
  X,
} from './placeholderIcons';
import type { LucideIcon } from './placeholderIcons';
import type {
  AccountLink,
  Attendance,
  Booking,
  CoachSection,
  ClubSettings,
  ClubRole,
  CoachTrainingBooking,
  ProfileParticipant,
  ParticipantSection,
  Section,
  Training,
} from './types/club';
import CalendarPanel from './CalendarPanel';
import RegularTrainingsPanel from './RegularTrainingsPanel';
import ParticipantsPanel from './ParticipantsPanel';
import ParticipantEquipmentSummary from './ParticipantEquipmentSummary';
import AccountRolesPanel from './AccountRolesPanel';
import FinancePanel from './FinancePanel';
import ProfilePanel from './ProfilePanel';
import FeeGroupSummary from './FeeGroupSummary';
import HomeFeesCard from './HomeFeesCard';
import SectionRequestsPanel from './SectionRequestsPanel';
import ProfileRequestsPanel from './ProfileRequestsPanel';
import SettingsPanel from './SettingsPanel';
import SectionsPanel from './SectionsPanel';
import { TrainingBadge } from './TrainingIconPicker';
import { warsawDay } from './lib/warsaw-date.ts';
import ClubInvitationsPanel from './ClubInvitationsPanel';
import EquipmentTrainingPanel from './EquipmentTrainingPanel';
import ClubEquipmentStock from './ClubEquipmentStock';
import CoachTrainingsPanel from './CoachTrainingsPanel';
import RegistrationProgress from './RegistrationProgress';
import { assetUrl } from './lib/asset-url';
import { resolveProfilePhoto } from './lib/profile-photo';
import {
  readAllPages,
  readCoachBookings,
  readTrainingPages,
} from './lib/pagination';

import { usePortalNavigation } from './lib/use-portal-navigation';
import type {
  PortalView as View,
  SettingsSection,
} from './lib/portal-navigation';
import SwordsLoader from './SwordsLoader';
type Language = 'pl' | 'en';
const items: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Start', icon: Home },
  { id: 'calendar', label: 'Kalendarz', icon: CalendarDays },
  { id: 'trainings', label: 'Treningi', icon: CalendarDays },
  { id: 'fees', label: 'Opłaty', icon: Wallet },
  { id: 'equipment', label: 'Sprzęt', icon: Swords },
  { id: 'participants', label: 'Zawodnicy', icon: Users },
  { id: 'settings', label: 'Ustawienia', icon: SlidersHorizontal },
  { id: 'profile', label: 'Profil', icon: UserRound },
];
// Kolumny uczestnika czytane przez pełne odświeżenie i przez szybkie
// odświeżenie po zmianie przypisań; oba odczyty muszą zwracać ten sam kształt.
const PARTICIPANT_COLUMNS =
  'id,name,tier,level,status,azs_paid,azs_marked_by,azs_marked_at,equipment,full_gear,clothing_sizes,clothing_sizes_requested,beginner_membership';
interface ClubData {
  rosterLoaded: boolean;
  participants: ProfileParticipant[];
  participantReadVersion: number;
  links: AccountLink[];
  roles: ClubRole[];
  sections: Section[];
  trainings: Training[];
  bookings: Booking[];
  attendance: Attendance[];
  assignments: ParticipantSection[];
  coachSections: CoachSection[];
  coachBookings: CoachTrainingBooking[];
  clubSettings: ClubSettings | null;
}
const empty: ClubData = {
  rosterLoaded: false,
  participants: [],
  participantReadVersion: 0,
  links: [],
  roles: [],
  sections: [],
  trainings: [],
  bookings: [],
  attendance: [],
  assignments: [],
  coachSections: [],
  coachBookings: [],
  clubSettings: null,
};

export default function ClubWorkspace({
  client,
  session,
  onSignOut,
  personalDetailsContent,
  onProfileReviewed,
  personalProfileRevision,
  personalName,
  guardianMode = false,
  restricted = false,
  awaitingApproval = false,
  suspended = false,
  siteLinks = false,
}: {
  client: SupabaseClient;
  session: Session;
  onSignOut: () => Promise<void>;
  personalDetailsContent?: ReactNode | ((language: Language) => ReactNode);
  onProfileReviewed?: () => void;
  personalProfileRevision?: string;
  personalName?: string;
  guardianMode?: boolean;
  restricted?: boolean;
  awaitingApproval?: boolean;
  suspended?: boolean;
  siteLinks?: boolean;
}) {
  const [data, setData] = useState<ClubData>(empty);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [menu, setMenu] = useState(false);
  const [customAvatar, setCustomAvatar] = useState('');
  const [language, setLanguageState] = useState<Language>('pl');
  const googlePhoto = guardianMode
    ? ''
    : String(
        session.user.user_metadata.avatar_url ??
          session.user.user_metadata.picture ??
          '',
      );
  const setLanguage = useCallback(
    (value: Language) => setLanguageState(value),
    [],
  );
  const [loaded, setLoaded] = useState(false);
  const [accessVerified, setAccessVerified] = useState(false);
  // accessVerified: role i powiązania konta zostały odczytane bez błędu; bez
  // tego prywatne panele nie są renderowane. accessEpoch rośnie, gdy zmieni
  // się zakres uprawnień, i jako `key` wymusza zbudowanie paneli od nowa,
  // żeby nie zachowały stanu z poprzedniego zakresu.
  const [accessEpoch, setAccessEpoch] = useState(0);
  const accessSnapshot = useRef<string | null>(null);
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  // Liczniki chroniące przed wyścigami odczytów:
  // - revision: numer pełnego odświeżenia; starsze, wolniejsze odświeżenie
  //   nie może nadpisać wyniku nowszego,
  // - assignmentRevision: numer lokalnej zmiany poziomu i sekcji po zapisie;
  //   pełne odświeżenie rozpoczęte wcześniej nie może cofnąć tych danych,
  // - workspaceActive: false po odmontowaniu komponentu.
  const revision = useRef(0);
  const assignmentRevision = useRef(0);
  const workspaceActive = useRef(true);
  // Pełne odświeżenie danych klubu. Najpierw role, powiązania konta i sekcje
  // trenera, dopiero potem dane zależne od zakresu uprawnień. Realny dostęp
  // egzekwuje RLS w bazie; filtrowanie tutaj tylko dopasowuje widok.
  const load = useCallback(async () => {
    if (!workspaceActive.current) return;
    const version = ++revision.current;
    const assignmentVersion = assignmentRevision.current;
    const isCurrent = () => version === revision.current;
    const now = new Date().toISOString();
    setLoading(true);
    setMessage('');
    try {
      // Konto przed aktywacją nie czyta danych klubu, tylko własne preferencje.
      if (restricted) {
        setAccessVerified(false);
        setData(empty);
        const preferences = await client
          .from('account_preferences')
          .select('language,avatar_path')
          .eq('account_id', session.user.id)
          .maybeSingle();
        if (!isCurrent()) return;
        const locale = preferences.data?.language;
        if (locale === 'pl' || locale === 'en') setLanguageState(locale);
        if (preferences.data?.avatar_path) {
          const photo = await resolveProfilePhoto(
            client,
            session.user.id,
            preferences.data.avatar_path,
          );
          if (!isCurrent()) return;
          setCustomAvatar(photo.url);
        } else if (!preferences.error) setCustomAvatar('');
        setLoaded(true);
        setAccessVerified(true);
        return;
      }
      const [links, roles, coachSections] = await Promise.all([
        readAllPages(
          (from, to) =>
            client
              .from('participant_accounts')
              .select('account_id,participant_id,active,relationship')
              .eq('account_id', session.user.id)
              .eq('active', true)
              .order('participant_id')
              .order('account_id')
              .range(from, to)
              .returns<AccountLink[]>(),
          isCurrent,
          (row) => `${row.participant_id}:${row.account_id}`,
        ),
        readAllPages(
          (from, to) =>
            client
              .from('account_roles')
              .select('role')
              .eq('account_id', session.user.id)
              .order('role')
              .range(from, to)
              .returns<{ role: ClubRole }[]>(),
          isCurrent,
          (row) => row.role,
        ),
        readAllPages(
          (from, to) =>
            client
              .from('coach_sections')
              .select('section_id')
              .eq('account_id', session.user.id)
              .order('section_id')
              .range(from, to)
              .returns<CoachSection[]>(),
          isCurrent,
          (row) => row.section_id,
        ),
      ]);
      if (version !== revision.current) return;
      if (links.error || roles.error || coachSections.error) {
        setAccessVerified(false);
        setMessage(
          languageRef.current === 'en'
            ? 'Could not verify access. Private panels are hidden. Retry the refresh.'
            : 'Nie udało się sprawdzić dostępu. Prywatne panele są ukryte. Ponów odświeżenie.',
        );
        return;
      }
      // Zmiana ról, powiązań lub sekcji trenera między odświeżeniami: czyścimy
      // dane pobrane w starym zakresie i przebudowujemy panele (accessEpoch).
      const scope = JSON.stringify({
        roles: roles.data,
        links: links.data,
        sections: coachSections.data,
      });
      if (accessSnapshot.current !== null && accessSnapshot.current !== scope) {
        setData(empty);
        setAccessEpoch((value) => value + 1);
      }
      accessSnapshot.current = scope;
      const currentAdmin = roles.data?.some((row) => row.role === 'admin');
      const currentCoach = roles.data?.some((row) => row.role === 'coach');
      const ownIds = [
        ...new Set((links.data ?? []).map((row) => row.participant_id)),
      ];
      const [
        people,
        sections,
        trainings,
        bookings,
        attendance,
        assignments,
        clubSettings,
        preferences,
      ] = await Promise.all([
        readAllPages(
          (from, to) =>
            client
              .from('participants')
              .select(PARTICIPANT_COLUMNS)
              .order('name')
              .order('id')
              .range(from, to)
              .returns<Omit<ProfileParticipant, 'category'>[]>(),
          isCurrent,
          (row) => row.id,
        ),
        readAllPages(
          (from, to) =>
            client
              .from('sections')
              .select('id,name,audience')
              .order('name')
              .order('id')
              .range(from, to)
              .returns<Section[]>(),
          isCurrent,
          (row) => row.id,
        ),
        readTrainingPages(
          (from, to, includeIcon) =>
            client
              .from('trainings')
              .select(
                `id,section_id,starts_at,ends_at,group_label,location,coach_label,coach_account_id,series_id,canceled${includeIcon ? ',icon' : ''}`,
              )
              .gte('ends_at', now)
              .order('starts_at')
              .order('id')
              .range(from, to)
              .returns<Training[]>(),
          isCurrent,
          (row) => row.id,
        ),
        ownIds.length
          ? readAllPages(
              (from, to) =>
                client
                  .from('training_bookings')
                  .select('training_id,participant_id,response')
                  .eq('response', 'yes')
                  .in('participant_id', ownIds)
                  .order('training_id')
                  .order('participant_id')
                  .range(from, to)
                  .returns<
                    {
                      training_id: string;
                      participant_id: string;
                      response: 'yes';
                    }[]
                  >(),
              isCurrent,
              (row) => `${row.training_id}:${row.participant_id}`,
            )
          : { data: [], error: null },
        ownIds.length
          ? readAllPages(
              (from, to) =>
                client
                  .from('training_attendance')
                  .select('training_id,participant_id,status')
                  .in('participant_id', ownIds)
                  .order('training_id')
                  .order('participant_id')
                  .range(from, to)
                  .returns<Attendance[]>(),
              isCurrent,
              (row) => `${row.training_id}:${row.participant_id}`,
            )
          : { data: [], error: null },
        readAllPages(
          (from, to) =>
            client
              .from('participant_sections')
              .select('participant_id,section_id')
              .order('participant_id')
              .order('section_id')
              .range(from, to)
              .returns<ParticipantSection[]>(),
          isCurrent,
          (row) => `${row.participant_id}:${row.section_id}`,
        ),
        client
          .from('club_settings')
          .select('monthly_fee,fulgir_discount,fee_youth,fee_beginner_azs')
          .eq('id', 1)
          .maybeSingle()
          // Starsza baza nie ma kwot grup składek; wtedy czytamy same kwoty podstawowe.
          .then((result) =>
            result.error
              ? client
                  .from('club_settings')
                  .select('monthly_fee,fulgir_discount')
                  .eq('id', 1)
                  .maybeSingle()
              : result,
          ),
        client
          .from('account_preferences')
          .select('language,avatar_path')
          .eq('account_id', session.user.id)
          .maybeSingle(),
      ]);
      if (!isCurrent()) return;
      const coachBookingsResult = currentCoach
        ? await readCoachBookings(
            client,
            (trainings.data ?? []).map((training) => training.id),
            isCurrent,
          )
        : { data: [], error: null };
      if (version !== revision.current) return;
      const coreResults = [
        people,
        links,
        roles,
        sections,
        trainings,
        bookings,
        attendance,
        assignments,
        coachSections,
        clubSettings,
        coachBookingsResult,
      ];
      // Błąd pojedynczego odczytu nie czyści ekranu: w setData niżej każde pole
      // zachowuje poprzednią wartość, jeśli jego odczyt się nie powiódł.
      const hasCoreError = coreResults.some((result) => result.error);
      const linkedIds = new Set(
        (links.data ?? []).map((row) => row.participant_id),
      );
      const currentCoachSections = new Set(
        (coachSections.data ?? []).map((row) => row.section_id),
      );
      const allowedAssignments = assignments.data?.filter(
        (row) =>
          currentAdmin ||
          linkedIds.has(row.participant_id) ||
          currentCoachSections.has(row.section_id),
      );
      const profileParticipants = people.data
        ?.filter((person) => currentAdmin || linkedIds.has(person.id))
        .map((person) => ({
          ...person,
          category: person.tier,
        }));
      setAccessVerified(true);
      setLoaded(true);
      // participants i assignments pomijamy, jeśli w trakcie tego odczytu
      // wykonało się szybkie odświeżenie po zapisie (nowszy stan już jest w data).
      // participantReadVersion mówi panelom, z którego odczytu pochodzą dane.
      setData((previous) => ({
        rosterLoaded:
          (!people.error && !assignments.error && !sections.error) ||
          previous.rosterLoaded,
        participantReadVersion:
          assignmentVersion === assignmentRevision.current &&
          !people.error &&
          !assignments.error
            ? version
            : previous.participantReadVersion,
        participants:
          assignmentVersion !== assignmentRevision.current
            ? previous.participants
            : (profileParticipants ??
              (people.error ? previous.participants : [])),
        links: links.data ?? (links.error ? previous.links : []),
        roles: roles.data
          ? roles.data.map((row) => row.role)
          : roles.error
            ? previous.roles
            : [],
        sections: sections.data ?? (sections.error ? previous.sections : []),
        trainings:
          trainings.data ?? (trainings.error ? previous.trainings : []),
        bookings:
          bookings.data?.map((booking) => ({
            training_id: booking.training_id,
            participant_id: booking.participant_id,
            active: true,
          })) ?? (bookings.error ? previous.bookings : []),
        attendance:
          attendance.data ?? (attendance.error ? previous.attendance : []),
        assignments:
          assignmentVersion !== assignmentRevision.current
            ? previous.assignments
            : (allowedAssignments ??
              (assignments.error ? previous.assignments : [])),
        coachSections:
          coachSections.data ??
          (coachSections.error ? previous.coachSections : []),
        coachBookings:
          (coachBookingsResult.data as unknown as
            CoachTrainingBooking[] | null) ??
          (coachBookingsResult.error ? previous.coachBookings : []),
        clubSettings:
          (clubSettings.data as ClubSettings | null) ??
          (clubSettings.error ? previous.clubSettings : null),
      }));
      setMessage(
        hasCoreError
          ? languageRef.current === 'en'
            ? 'Could not refresh some club data. The last complete data remains visible.'
            : 'Nie udało się odświeżyć części danych klubu. Poprzednie kompletne dane pozostają widoczne.'
          : '',
      );
      const preference = preferences.data as {
        language?: Language;
        avatar_path?: string | null;
      } | null;
      const locale = preference?.language;
      if (locale === 'pl' || locale === 'en') setLanguageState(locale);
      if (preference?.avatar_path) {
        const photo = await resolveProfilePhoto(
          client,
          session.user.id,
          preference.avatar_path,
        );
        if (version === revision.current) setCustomAvatar(photo.url);
      } else if (!preferences.error) setCustomAvatar('');
    } catch {
      if (version === revision.current) {
        setAccessVerified(false);
        setMessage(
          languageRef.current === 'en'
            ? 'Connection lost. Private panels are hidden until access can be verified.'
            : 'Brak połączenia. Prywatne panele są ukryte do czasu sprawdzenia dostępu.',
        );
      }
    } finally {
      if (version === revision.current) setLoading(false);
    }
  }, [client, session.user.id, restricted]);
  // Szybkie odświeżenie po zmianie poziomu lub sekcji: tylko uczestnicy
  // i przypisania, bez przeładowania całego obszaru roboczego. Błąd lub
  // wyprzedzenie przez nowszy odczyt kończy się wyjątkiem, a dane zostają.
  // Zapis poziomu i sekcji jednej osoby trafia do danych lokalnie, bez
  // ponownego odczytu listy; licznik chroni go przed starszym pełnym odczytem.
  const applyParticipantAssignments = useCallback(
    (saved: {
      participantId: string;
      tier: ProfileParticipant['tier'];
      level: ProfileParticipant['level'];
      sectionIds: string[];
    }) => {
      ++assignmentRevision.current;
      setData((previous) => ({
        ...previous,
        participants: previous.participants.map((person) =>
          person.id === saved.participantId
            ? {
                ...person,
                tier: saved.tier,
                category: saved.tier,
                level: saved.level,
              }
            : person,
        ),
        assignments: [
          ...previous.assignments.filter(
            (row) => row.participant_id !== saved.participantId,
          ),
          ...saved.sectionIds.map((section_id) => ({
            participant_id: saved.participantId,
            section_id,
          })),
        ],
      }));
    },
    [],
  );
  useEffect(() => {
    let alive = true;
    workspaceActive.current = true;
    // Podbicie licznika przy sprzątaniu unieważnia odczyt będący w toku.
    const guard = revision;
    void (async () => {
      if (alive) await load();
    })();
    return () => {
      alive = false;
      workspaceActive.current = false;
      ++guard.current;
    };
  }, [load, personalProfileRevision]);
  const admin = !restricted && accessVerified && data.roles.includes('admin');
  const board = !restricted && accessVerified && data.roles.includes('board');
  const coach = !restricted && accessVerified && data.roles.includes('coach');
  const own = data.participants.filter((person) =>
    data.links.some((link) => link.participant_id === person.id),
  );
  const ownBookings = data.bookings.filter((booking) =>
    own.some((person) => person.id === booking.participant_id),
  );
  const ownAttendance = data.attendance.filter(
    (row) =>
      own.some((person) => person.id === row.participant_id) &&
      row.status === 'present',
  );
  const upcomingById = new Map(
    data.trainings
      .filter((training) => !training.canceled)
      .map((training) => [training.id, training]),
  );
  const upcomingTrainingIds = new Set([
    ...ownBookings.map((booking) => booking.training_id),
    ...(coach
      ? data.coachBookings
          .filter((booking) => booking.is_self && booking.active)
          .map((booking) => booking.training_id)
      : []),
  ]);
  const upcomingTrainings = [...upcomingTrainingIds]
    .map((id) => upcomingById.get(id))
    .filter((training): training is Training => Boolean(training))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nextDay = [...upcomingById.values()].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  );
  const nextDayTrainings = nextDay.filter(
    (training) =>
      warsawDay(new Date(training.starts_at)) ===
      warsawDay(new Date(nextDay[0].starts_at)),
  );
  // Widoki dostępne dla roli. „profile” jest osobną pozycją tylko przed
  // aktywacją konta; aktywne konto ma profil w Ustawieniach.
  const visible = items.filter((item) =>
    restricted
      ? ['home', 'settings', 'profile'].includes(item.id)
      : item.id === 'profile'
        ? false
        : item.id === 'fees' ||
            item.id === 'participants' ||
            item.id === 'trainings'
          ? admin
          : item.id === 'equipment'
            ? admin || coach
            : true,
  );
  const { route, navigate: changeRoute } = usePortalNavigation(
    visible.map((item) => item.id),
    loaded && accessVerified,
  );
  const view = route.view;
  const settingsSection = route.section;
  const navigate = (next: View, section: SettingsSection = 'general') => {
    changeRoute({ view: next, section });
    setMenu(false);
  };
  const unlinked =
    !restricted && !admin && !board && !coach && data.links.length === 0;
  const labelFor = (id: View) =>
    language === 'en'
      ? (
          {
            home: 'Home',
            calendar: 'Calendar',
            trainings: 'Trainings',
            fees: 'Fees',
            equipment: 'Equipment',
            participants: 'Participants',
            settings: 'Settings',
            profile: 'Profile',
          } as Record<View, string>
        )[id]
      : items.find((item) => item.id === id)?.label;

  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${menu ? 'is-open' : ''}`}
        aria-label={language === 'en' ? 'Main menu' : 'Menu główne'}
      >
        <button className="brand brand-button" onClick={() => navigate('home')}>
          <img className="brand-logo" src={assetUrl('logo.webp')} alt="" />
          <div>
            GWIAZDY<span>KATOWICE · DESW</span>
          </div>
        </button>
        <button
          className="mobile-close icon-button"
          aria-label={language === 'en' ? 'Close menu' : 'Zamknij menu'}
          onClick={() => setMenu(false)}
        >
          <X />
        </button>
        <div className="club-caption">
          {language === 'en'
            ? 'Your place in the club'
            : 'Twoje miejsce w klubie'}
        </div>
        <nav>
          {visible.map(({ id, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? 'active' : ''}`}
              aria-current={view === id ? 'page' : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{labelFor(id)}</span>
              {view === id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="club-motto">
            {language === 'en' ? (
              <>
                Together at training.
                <br />
                Together as a club.
              </>
            ) : (
              <>
                Razem na treningu.
                <br />
                Razem w klubie.
              </>
            )}
          </div>
          <div className="profile">
            <button
              type="button"
              className="avatar profile-avatar-button"
              aria-label={
                language === 'en'
                  ? 'Open profile settings'
                  : 'Otwórz ustawienia profilu'
              }
              onClick={() => navigate('settings', 'profile')}
            >
              {(customAvatar || googlePhoto) && (
                <img
                  src={customAvatar || googlePhoto}
                  alt=""
                  referrerPolicy="no-referrer"
                  onLoad={(event) => {
                    event.currentTarget.style.display = '';
                  }}
                  onError={(event) => {
                    if (
                      customAvatar &&
                      googlePhoto &&
                      event.currentTarget.src === customAvatar
                    )
                      event.currentTarget.src = googlePhoto;
                    else event.currentTarget.style.display = 'none';
                  }}
                />
              )}
              {String(
                personalName ||
                  session.user.user_metadata.full_name ||
                  session.user.email ||
                  'GK',
              ).slice(0, 1)}
            </button>
            <span>
              <strong>
                {personalName ||
                  session.user.user_metadata.full_name ||
                  (language === 'en' ? 'Club account' : 'Konto klubowe')}
              </strong>
              <small>
                {language === 'en' ? 'Club account' : 'Konto klubowe'}
              </small>
            </span>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="menu-backdrop"
          aria-label={language === 'en' ? 'Close menu' : 'Zamknij menu'}
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-shell">
        {siteLinks && (
          <a
            className="website-return website-return--workspace"
            href={`/${language}`}
          >
            <span className="website-return__icon" aria-hidden="true">
              ←
            </span>
            <span>
              {language === 'en'
                ? 'Back to the website'
                : 'Powrót do strony internetowej'}
            </span>
          </a>
        )}
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu icon-button"
              aria-label={language === 'en' ? 'Open menu' : 'Otwórz menu'}
              aria-expanded={menu}
              onClick={() => setMenu(true)}
            >
              <Menu />
            </button>
            <span>
              {language === 'en' ? 'Club /' : 'Klub /'}{' '}
              <strong>{labelFor(view)}</strong>
            </span>
          </div>
          <span className="account-pill">
            <span />
            {language === 'en' ? 'Club account' : 'Konto klubowe'}
          </span>
        </header>
        <main>
          <div
            className={`page-heading ${view === 'home' ? 'page-heading--home' : ''}`}
          >
            <div>
              {view !== 'home' && (
                <span className="eyebrow">GWIAZDY KATOWICE</span>
              )}
              <h1 className={view === 'home' ? 'visually-hidden' : undefined}>
                {labelFor(view)}
              </h1>
            </div>
            <button
              className="button secondary small"
              onClick={() => {
                void load();
                onProfileReviewed?.();
              }}
              disabled={loading}
            >
              {loading ? (
                <SwordsLoader
                  size="small"
                  announce={false}
                  label={language === 'en' ? 'Loading…' : 'Wczytuję…'}
                />
              ) : language === 'en' ? (
                'Refresh data'
              ) : (
                'Odśwież dane'
              )}
            </button>
          </div>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          {!loaded || !accessVerified ? (
            <SwordsLoader
              language={language}
              size="large"
              label={
                language === 'en'
                  ? 'Verifying club access…'
                  : 'Sprawdzam dostęp do klubu…'
              }
            />
          ) : (
            <div key={accessEpoch} aria-busy={loading}>
              {unlinked && (
                <p className="notice" role="status">
                  {language === 'en'
                    ? 'Your account is not linked to a club participant. Contact the club for an invitation and approval.'
                    : 'Twoje konto nie jest jeszcze powiązane z uczestnikiem klubu. Skontaktuj się z klubem w sprawie zaproszenia i zatwierdzenia.'}
                </p>
              )}
              {view === 'home' && restricted && awaitingApproval && (
                <>
                  <section
                    className="registration-hero registration-hero--pending"
                    aria-labelledby="registration-pending-title"
                  >
                    <span className="registration-hero__eyebrow">
                      <Check size={14} strokeWidth={3} aria-hidden="true" />
                      {language === 'en'
                        ? 'Application sent'
                        : 'Zgłoszenie wysłane'}
                    </span>
                    <h2
                      id="registration-pending-title"
                      className="registration-hero__title"
                    >
                      {language === 'en'
                        ? 'Waiting for administrator approval'
                        : 'Czekasz na akceptację administratora'}
                    </h2>
                    <p className="registration-hero__lead">
                      {language === 'en'
                        ? guardianMode
                          ? 'Your child’s details and the club code have reached the club. An administrator will confirm the category and approve access.'
                          : 'Your details and the club code have reached the club. An administrator will confirm your category and approve access.'
                        : guardianMode
                          ? 'Dane dziecka i kod klubowy dotarły do klubu. Administrator potwierdzi kategorię i zatwierdzi dostęp.'
                          : 'Twoje dane i kod klubowy dotarły do klubu. Administrator potwierdzi kategorię i zatwierdzi dostęp.'}
                    </p>
                    <RegistrationProgress
                      stage="approval"
                      language={language}
                    />
                  </section>
                  <section className="panel registration-status">
                    <span
                      className="registration-status__icon"
                      aria-hidden="true"
                    >
                      <Hourglass size={22} />
                    </span>
                    <div className="registration-status__body">
                      <h3>
                        {language === 'en'
                          ? 'You do not need to do anything else'
                          : 'Nie musisz już nic robić'}
                      </h3>
                      <p role="status">
                        {language === 'en'
                          ? 'We check the status automatically every 30 seconds. The training calendar, sign-ups and fees appear here right after approval.'
                          : 'Status sprawdzamy automatycznie co 30 sekund. Kalendarz treningów, zapisy i opłaty pojawią się tutaj zaraz po akceptacji.'}
                      </p>
                      <div className="registration-status__actions">
                        <button
                          type="button"
                          className="button"
                          onClick={() => {
                            void load();
                            onProfileReviewed?.();
                          }}
                          disabled={loading}
                        >
                          {language === 'en'
                            ? 'Check status now'
                            : 'Sprawdź status teraz'}
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => navigate('profile')}
                        >
                          {guardianMode
                            ? language === 'en'
                              ? 'View child’s details'
                              : 'Zobacz dane dziecka'
                            : language === 'en'
                              ? 'View your details'
                              : 'Zobacz swoje dane'}
                        </button>
                      </div>
                    </div>
                  </section>
                </>
              )}
              {view === 'home' && restricted && !awaitingApproval && (
                <section className="panel">
                  <h2>
                    {language === 'en'
                      ? 'Welcome to the club portal'
                      : 'Witaj w portalu klubu'}
                  </h2>
                  <p role="status">
                    {language === 'en'
                      ? 'Club access requires administrator approval. You can use Home, Settings and Profile. Training sessions and fees will appear after your access is approved.'
                      : 'Dostęp klubowy wymaga zatwierdzenia przez administratora. Możesz korzystać ze Startu, Ustawień i Profilu. Treningi i opłaty pojawią się po zatwierdzeniu dostępu.'}
                  </p>
                  <button
                    className="button"
                    onClick={() => navigate('profile')}
                  >
                    {language === 'en' ? 'Open profile' : 'Otwórz profil'}
                  </button>
                </section>
              )}
              {view === 'home' && !restricted && (
                <>
                  <section className="welcome-banner">
                    <div>
                      <span className="eyebrow">
                        {language === 'en'
                          ? 'SEE YOU AT TRAINING'
                          : 'DO ZOBACZENIA NA TRENINGU'}
                      </span>
                      <h2>
                        {language === 'en' ? (
                          <>
                            Every session
                            <br />
                            moves you forward.
                          </>
                        ) : (
                          <>
                            Każdy trening
                            <br />
                            to kolejny krok.
                          </>
                        )}
                      </h2>
                      <p>
                        {language === 'en'
                          ? 'Check the schedule and find your next session.'
                          : 'Sprawdź terminy i wybierz swoje zajęcia.'}
                      </p>
                      <button
                        className="button light"
                        onClick={() => navigate('calendar')}
                      >
                        {language === 'en'
                          ? 'Open calendar'
                          : 'Otwórz kalendarz'}{' '}
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <div className="banner-graphic" aria-hidden="true">
                      <div className="graphic-orbit" />
                      <Swords strokeWidth={0.8} />
                      <Star className="graphic-star" />
                    </div>
                  </section>
                  <section className="panel next-training">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow">
                          {language === 'en'
                            ? 'NEXT SESSION'
                            : 'NAJBLIŻSZY TRENING'}
                        </span>
                        <h2>
                          {language === 'en'
                            ? 'Your next training'
                            : 'Najbliższy trening'}
                        </h2>
                      </div>
                      <CalendarDays />
                    </div>
                    {nextDayTrainings.length ? (
                      <>
                        <p className="muted">
                          {new Intl.DateTimeFormat(
                            language === 'en' ? 'en-GB' : 'pl-PL',
                            {
                              timeZone: 'Europe/Warsaw',
                              weekday: 'long',
                              day: 'numeric',
                              month: 'long',
                            },
                          ).format(new Date(nextDayTrainings[0].starts_at))}
                        </p>
                        {nextDayTrainings.map((training) => {
                          const section =
                            data.sections.find(
                              (item) => item.id === training.section_id,
                            )?.name ?? '';
                          const time = (iso: string) =>
                            new Intl.DateTimeFormat('pl-PL', {
                              timeZone: 'Europe/Warsaw',
                              hour: '2-digit',
                              minute: '2-digit',
                            }).format(new Date(iso));
                          return (
                            <div className="training-row" key={training.id}>
                              <TrainingBadge
                                icon={training.icon}
                                language={language}
                              />
                              <div className="training-detail">
                                <strong>
                                  {section || 'Trening'} ·{' '}
                                  {training.group_label}
                                </strong>
                                <span>
                                  {time(training.starts_at)}–
                                  {time(training.ends_at)}
                                  {upcomingTrainingIds.has(training.id) && (
                                    <>
                                      {' '}
                                      <span className="badge">
                                        {language === 'en'
                                          ? 'Booked'
                                          : 'Zapisano'}
                                      </span>
                                    </>
                                  )}
                                </span>
                                <small>
                                  {training.location} ·{' '}
                                  {training.coach_account_id
                                    ? training.coach_label
                                    : language === 'en'
                                      ? 'No main coach assigned'
                                      : 'Brak przypisanego trenera głównego'}
                                </small>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <p className="muted">
                        {language === 'en'
                          ? 'No upcoming trainings.'
                          : 'Brak nadchodzących treningów.'}
                      </p>
                    )}
                  </section>
                  {coach && (
                    <CoachTrainingsPanel
                      trainings={data.trainings}
                      sections={data.sections}
                      accountId={session.user.id}
                      language={language}
                      onOpenCalendar={() => navigate('calendar')}
                    />
                  )}
                  <div className="stat-grid">
                    <button
                      className="stat-card"
                      onClick={() => navigate('calendar')}
                    >
                      <span className="stat-label">
                        <CalendarDays size={18} />{' '}
                        {language === 'en' ? 'My bookings' : 'Moje zapisy'}
                      </span>
                      <strong>{upcomingTrainings.length}</strong>
                      <span className="stat-foot">
                        {language === 'en'
                          ? 'upcoming sessions'
                          : 'nadchodzące treningi'}{' '}
                        <ChevronRight size={16} />
                      </span>
                    </button>
                    <button className="stat-card">
                      <span className="stat-label">
                        <Users size={18} />{' '}
                        {language === 'en' ? 'Attended' : 'Odbyte treningi'}
                      </span>
                      <strong>{ownAttendance.length}</strong>
                      <span className="stat-foot">
                        {language === 'en'
                          ? 'confirmed attendance'
                          : 'potwierdzona obecność'}
                      </span>
                    </button>
                    <HomeFeesCard
                      client={client}
                      participants={own}
                      language={language}
                      readVersion={data.participantReadVersion}
                      onOpen={() => navigate('settings', 'profile')}
                    />
                  </div>
                </>
              )}
              {view === 'calendar' && !restricted && (
                <CalendarPanel
                  suspended={suspended}
                  client={client}
                  canManage={admin || board}
                  isAdmin={admin}
                  accountId={session.user.id}
                  isCoach={coach}
                  sections={data.sections}
                  participants={own}
                  trainings={data.trainings}
                  bookings={data.bookings}
                  assignedSections={data.assignments}
                  coachSectionIds={data.coachSections.map(
                    (item) => item.section_id,
                  )}
                  coachBookings={data.coachBookings}
                  language={language}
                  onChanged={load}
                  weekStart={route.week}
                  onWeekChange={(week) => changeRoute({ week })}
                  onManageTrainings={
                    admin ? () => navigate('trainings') : undefined
                  }
                />
              )}
              {view === 'trainings' && admin && (
                <RegularTrainingsPanel
                  client={client}
                  sections={data.sections}
                  language={language}
                  onChanged={load}
                />
              )}
              {view === 'fees' && admin && (
                <FinancePanel
                  language={language}
                  client={client}
                  participants={data.participants}
                  roles={data.roles}
                  clubSettings={data.clubSettings}
                  onChanged={load}
                />
              )}
              {view === 'equipment' && (admin || coach) && (
                <>
                  <EquipmentTrainingPanel
                    client={client}
                    trainings={data.trainings.filter(
                      (training) => !training.canceled,
                    )}
                    sections={data.sections}
                    language={language}
                  />
                  {admin && (
                    <ClubEquipmentStock client={client} language={language} />
                  )}
                </>
              )}
              {view === 'participants' && admin && !data.rosterLoaded && (
                <p role="alert" className="notice">
                  {language === 'en'
                    ? 'The participant list could not be loaded. Refresh data to retry.'
                    : 'Nie udało się wczytać listy zawodników. Ponów odświeżenie danych.'}
                </p>
              )}
              {view === 'participants' && admin && data.rosterLoaded && (
                <ParticipantsPanel
                  suspended={suspended}
                  client={client}
                  participants={data.participants}
                  sections={data.sections}
                  assignments={data.assignments}
                  canManage={admin}
                  language={language}
                  onChanged={load}
                  onAssignmentsChanged={applyParticipantAssignments}
                  accountId={session.user.id}
                  refreshRevision={data.participantReadVersion}
                  renderAssignments={(person) => (
                    <>
                      {(() => {
                        const profile = data.participants.find(
                          (item) => item.id === person.id,
                        );
                        return profile ? (
                          <FeeGroupSummary
                            person={profile}
                            settings={data.clubSettings}
                            language={language}
                          />
                        ) : null;
                      })()}
                      <ParticipantEquipmentSummary
                        person={person}
                        language={language}
                      />
                      <SectionRequestsPanel
                        client={client}
                        participantId={person.id}
                        language={language}
                        onChanged={load}
                      />
                      <ProfileRequestsPanel
                        participantId={person.id}
                        refreshRevision={data.participantReadVersion}
                        embedded
                        client={client}
                        language={language}
                        onChanged={async () => {
                          if (!workspaceActive.current) return;
                          await load();
                          onProfileReviewed?.();
                        }}
                      />
                    </>
                  )}
                  renderAccountRoles={(accountId) => (
                    <AccountRolesPanel
                      client={client}
                      accountId={session.user.id}
                      targetAccountId={accountId}
                      refreshRevision={data.participantReadVersion}
                      embedded
                      canManage={admin}
                      sections={data.sections}
                      language={language}
                      onChanged={load}
                    />
                  )}
                  renderAdditionalRows={(linkedAccountIds) => (
                    <AccountRolesPanel
                      client={client}
                      accountId={session.user.id}
                      canManage={admin}
                      sections={data.sections}
                      language={language}
                      onChanged={load}
                      asRows
                      refreshRevision={data.participantReadVersion}
                      excludedAccountIds={linkedAccountIds}
                    />
                  )}
                />
              )}
              {(view === 'settings' || (view === 'profile' && restricted)) && (
                <SettingsPanel
                  key={view}
                  client={client}
                  accountId={session.user.id}
                  language={language}
                  onLanguageChange={setLanguage}
                  onSignOut={onSignOut}
                  section={view === 'profile' ? 'profile' : settingsSection}
                  onSectionChange={(section) =>
                    changeRoute({ view: 'settings', section })
                  }
                  personalDetailsContent={
                    <ProfilePanel
                      participantReadVersion={data.participantReadVersion}
                      getReadVersion={() => revision.current}
                      client={client}
                      session={session}
                      guardianMode={guardianMode}
                      participants={own}
                      sections={data.sections}
                      assignments={data.assignments}
                      {...(restricted
                        ? {}
                        : {
                            settings: data.clubSettings,
                            coachParticipantIds: coach
                              ? data.links
                                  .filter(
                                    (link) => link.relationship === 'self',
                                  )
                                  .map((link) => link.participant_id)
                              : [],
                          })}
                      language={language}
                      personalDetailsContent={
                        typeof personalDetailsContent === 'function'
                          ? personalDetailsContent(language)
                          : personalDetailsContent
                      }
                      onAvatarChanged={setCustomAvatar}
                      onChanged={load}
                    />
                  }
                  managementContent={
                    (admin || coach) && (
                      <>
                        <ClubInvitationsPanel
                          client={client}
                          language={language}
                          canRotate={admin}
                        />
                        {admin && (
                          <SectionsPanel
                            client={client}
                            language={language}
                            onChanged={load}
                          />
                        )}
                      </>
                    )
                  }
                />
              )}
            </div>
          )}
          <footer className="page-footer">
            <span>
              Gwiazdy Katowice ·{' '}
              {language === 'en'
                ? 'Historical European Martial Arts'
                : 'Historyczne Europejskie Sztuki Walki'}
            </span>
            <span>
              {language === 'en' ? 'Account' : 'Konto'}: {session.user.email}
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
