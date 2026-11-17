import { profileEquipmentCatalog } from '../lib/equipment-catalog.ts';
import { warsawMidnight } from '../lib/pagination.ts';

export type Row = Record<string, unknown>;

export const uid = (prefix: number, n: number) =>
  `00000000-0000-4000-8${String(prefix).padStart(3, '0')}-${String(n).padStart(12, '0')}`;

export const DEMO_ACCOUNT = uid(1, 0);
export const DEMO_EMAIL = 'aleksandra.nowak@example.com';
// Dopisek przy każdym imieniu i nazwisku, żeby nikt nie wziął ich za prawdziwe osoby.
export const fictional = (name: string) => `${name} (dane fikcyjne)`;

const todayInWarsaw = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

export const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export const warsawInstant = (date: string, time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(
    Date.parse(warsawMidnight(date)) + (hours * 60 + minutes) * 60000,
  ).toISOString();
};

const today = todayInWarsaw();
const isoWeekday = (date: string) =>
  ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const thisMonday = addDays(today, 1 - isoWeekday(today));

const equipment = (
  ownership: (item: string) => 'own' | 'club' | 'none',
  sizeIndex: number,
) =>
  profileEquipmentCatalog.map((entry) => {
    const options = entry.sizes as readonly string[];
    const owned = ownership(entry.item);
    return {
      item: entry.item,
      ownership: owned,
      size:
        owned === 'none' || !options.length
          ? null
          : (options[Math.min(sizeIndex, options.length - 1)] ?? null),
    };
  });
const fullKit = (sizeIndex: number) => equipment(() => 'own', sizeIndex);
const borrowedKit = (sizeIndex: number) =>
  equipment(
    (item) =>
      ['sabre', 'sword_buckler', 'longsword'].includes(item)
        ? 'none'
        : ['gloves', 'mask'].includes(item)
          ? 'own'
          : 'club',
    sizeIndex,
  );
const childKit = () =>
  equipment(
    (item) =>
      ['mask', 'jacket', 'gloves', 'longsword'].includes(item)
        ? 'club'
        : 'none',
    0,
  );

type Person = {
  name: string;
  tier: 'adult-beginner' | 'adult-advanced' | 'child';
  level: 'beginner' | 'advanced' | 'coach';
  status?: 'pending' | 'active';
  sections: string[];
  kit: ReturnType<typeof equipment>;
  dues?: number;
  azs?: boolean;
  membership?: 'azs' | 'association';
  guardian?: string;
  roles?: string[];
};

const people: Person[] = [
  {
    name: 'Aleksandra Nowak',
    tier: 'adult-advanced',
    level: 'coach',
    sections: ['longsword', 'sabre'],
    kit: fullKit(1),
    azs: true,
    roles: ['admin', 'coach'],
  },
  {
    name: 'Tomasz Wiśniewski',
    tier: 'adult-advanced',
    level: 'coach',
    sections: ['sabre', 'sword-buckler'],
    kit: fullKit(2),
    roles: ['coach'],
  },
  {
    name: 'Karolina Zielińska',
    tier: 'adult-advanced',
    level: 'coach',
    sections: ['children', 'longsword'],
    kit: fullKit(1),
    roles: ['coach'],
  },
  {
    name: 'Michał Kowalczyk',
    tier: 'adult-advanced',
    level: 'advanced',
    sections: ['longsword'],
    kit: fullKit(2),
    azs: true,
  },
  {
    name: 'Julia Lewandowska',
    tier: 'adult-advanced',
    level: 'advanced',
    sections: ['sabre'],
    kit: fullKit(0),
    dues: -30000,
  },
  {
    name: 'Piotr Kamiński',
    tier: 'adult-beginner',
    level: 'beginner',
    sections: ['longsword'],
    kit: borrowedKit(2),
    membership: 'azs',
  },
  {
    name: 'Natalia Wójcik',
    tier: 'adult-beginner',
    level: 'beginner',
    sections: ['sword-buckler'],
    kit: borrowedKit(1),
    membership: 'association',
    dues: -13000,
  },
  {
    name: 'Jakub Szymański',
    tier: 'adult-advanced',
    level: 'advanced',
    sections: ['longsword', 'sword-buckler'],
    kit: fullKit(3),
  },
  {
    name: 'Zuzanna Dąbrowska',
    tier: 'adult-beginner',
    level: 'beginner',
    sections: ['sabre'],
    kit: borrowedKit(0),
    membership: 'association',
  },
  {
    name: 'Kacper Mazur',
    tier: 'adult-advanced',
    level: 'advanced',
    sections: ['sabre'],
    kit: fullKit(2),
    azs: true,
  },
  {
    name: 'Maja Krawczyk',
    tier: 'child',
    level: 'beginner',
    sections: ['children'],
    kit: childKit(),
    guardian: 'Ewa Krawczyk',
  },
  {
    name: 'Antoni Piotrowski',
    tier: 'child',
    level: 'beginner',
    sections: ['children'],
    kit: childKit(),
    guardian: 'Marek Piotrowski',
    dues: -13000,
  },
  {
    name: 'Lena Grabowska',
    tier: 'child',
    level: 'beginner',
    sections: ['children'],
    kit: childKit(),
    guardian: 'Anna Grabowska',
  },
  {
    name: 'Filip Pawłowski',
    tier: 'adult-beginner',
    level: 'beginner',
    status: 'pending',
    sections: [],
    kit: equipment(() => 'none', 1),
  },
];

const series = [
  {
    section_id: 'longsword',
    weekday: 1,
    start: '18:00',
    end: '19:30',
    group: 'Zaawansowani',
    coach: 0,
    icon: 'swords',
    color: 'blue',
    required: null,
  },
  {
    section_id: 'sabre',
    weekday: 2,
    start: '18:30',
    end: '20:00',
    group: 'Wszyscy',
    coach: 1,
    icon: 'target',
    color: 'red',
    required: ['jacket', 'mask', 'gloves', 'gorget', 'sabre'],
  },
  {
    section_id: 'sword-buckler',
    weekday: 3,
    start: '19:00',
    end: '20:30',
    group: 'Wszyscy',
    coach: 1,
    icon: 'shield',
    color: 'green',
    required: null,
  },
  {
    section_id: 'children',
    weekday: 4,
    start: '17:00',
    end: '18:00',
    group: 'Dzieci 8–12 lat',
    coach: 2,
    icon: 'star',
    color: 'yellow',
    required: ['mask', 'jacket', 'gloves'],
  },
  {
    section_id: 'longsword',
    weekday: 5,
    start: '18:00',
    end: '19:30',
    group: 'Początkujący',
    coach: 2,
    icon: 'swords',
    color: 'purple',
    required: null,
  },
  {
    section_id: 'longsword',
    weekday: 6,
    start: '10:00',
    end: '11:30',
    group: 'Przygotowanie ogólne',
    coach: 0,
    icon: 'fitness',
    color: 'orange',
    required: [],
  },
];

const locations = ['Sala gimnastyczna A', 'Hala sportowa B'];

export function createDemoDatabase() {
  const tables: Record<string, Row[]> = {
    sections: [
      { id: 'longsword', name: 'Miecz długi', audience: 'adult', revision: 1 },
      {
        id: 'sword-buckler',
        name: 'Miecz i puklerz',
        audience: 'adult',
        revision: 1,
      },
      { id: 'sabre', name: 'Szabla', audience: 'adult', revision: 1 },
      { id: 'children', name: 'Sekcja dzieci', audience: 'child', revision: 1 },
    ],
    participants: [],
    participant_sections: [],
    participant_accounts: [],
    account_profiles: [],
    account_roles: [],
    coach_sections: [],
    account_preferences: [
      { account_id: DEMO_ACCOUNT, language: 'pl', avatar_path: null },
    ],
    training_series: [],
    trainings: [],
    training_bookings: [],
    training_attendance: [],
    coach_training_bookings: [],
    club_events: [],
    club_event_bookings: [],
    club_settings: [
      {
        id: 1,
        monthly_fee: 150,
        fulgir_discount: 20,
        fee_youth: 130,
        fee_beginner_azs: 100,
      },
    ],
    club_equipment_stock: [
      { item: 'jacket', size: 'M', quantity: 3 },
      { item: 'jacket', size: 'L', quantity: 2 },
      { item: 'pants', size: 'L', quantity: 2 },
      { item: 'gorget', size: '', quantity: 4 },
      { item: 'sabre', size: '', quantity: 6 },
    ],
  };
  const emails = new Map<string, string>();
  const dues = new Map<string, number>();

  people.forEach((person, index) => {
    const participant = uid(2, index);
    const account = uid(1, index);
    const accountName = person.guardian ?? person.name;
    tables.participants.push({
      id: participant,
      name: fictional(person.name),
      tier: person.tier,
      level: person.level,
      status: person.status ?? 'active',
      azs_paid: Boolean(person.azs),
      azs_marked_by: person.azs ? DEMO_ACCOUNT : null,
      azs_marked_at: person.azs ? `${addDays(today, -20)}T10:00:00Z` : null,
      equipment: person.kit,
      full_gear: person.kit.every((entry) => entry.ownership === 'own'),
      clothing_sizes:
        person.tier === 'child'
          ? {}
          : { jacket: 'M', mask: 'M', pants: 'L', gloves: 'L', overlay: 'M' },
      clothing_sizes_requested: false,
      beginner_membership: person.membership ?? null,
    });
    for (const section of person.sections)
      tables.participant_sections.push({
        participant_id: participant,
        section_id: section,
      });
    tables.participant_accounts.push({
      account_id: account,
      participant_id: participant,
      relationship: person.guardian ? 'guardian' : 'self',
      active: person.status !== 'pending',
    });
    tables.account_profiles.push({
      account_id: account,
      display_name: fictional(accountName),
    });
    emails.set(
      account,
      `${accountName
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replaceAll('ł', 'l')
        .replace(/\s+/g, '.')}@example.com`,
    );
    for (const role of person.roles ?? [])
      tables.account_roles.push({ account_id: account, role });
    if (person.roles?.includes('coach'))
      for (const section of person.sections)
        tables.coach_sections.push({
          account_id: account,
          section_id: section,
        });
    if (person.dues) dues.set(participant, person.dues);
  });

  let counter = 0;
  series.forEach((entry, index) => {
    const id = uid(3, index);
    const coach = uid(1, entry.coach);
    const startsOn = addDays(thisMonday, -14 + entry.weekday - 1);
    tables.training_series.push({
      id,
      section_id: entry.section_id,
      starts_on: startsOn,
      ends_on: null,
      weekday: entry.weekday,
      local_start: `${entry.start}:00`,
      local_end: `${entry.end}:00`,
      group_label: entry.group,
      location: locations[index % 2],
      coach_account_id: coach,
      is_active: true,
      icon: entry.icon,
      color: entry.color,
      required_equipment: entry.required,
      revision: 1,
    });
    for (let week = -2; week <= 6; week += 1) {
      const date = addDays(thisMonday, week * 7 + entry.weekday - 1);
      const training = uid(4, counter++);
      tables.trainings.push({
        id: training,
        section_id: entry.section_id,
        starts_at: warsawInstant(date, entry.start),
        ends_at: warsawInstant(date, entry.end),
        group_label: entry.group,
        location: locations[index % 2],
        coach_label: fictional(people[entry.coach].name),
        coach_account_id: coach,
        series_id: id,
        canceled: week === 2 && index === 2,
        icon: entry.icon,
        updated_at: `${addDays(today, -3)}T09:00:00Z`,
      });
      tables.coach_training_bookings.push({
        account_id: coach,
        training_id: training,
        active: true,
      });
      tables.participant_sections
        .filter((link) => link.section_id === entry.section_id)
        .forEach((link, position) => {
          const roll = (counter * 7 + position * 3) % 5;
          if (week > 1 || roll === 4) return;
          const participant = String(link.participant_id);
          if (participant === uid(2, entry.coach)) return;
          tables.training_bookings.push({
            training_id: training,
            participant_id: participant,
            response: roll === 3 ? 'no' : 'yes',
            updated_at: `${addDays(today, -1)}T12:00:00Z`,
          });
          if (week < 0 && roll !== 3)
            tables.training_attendance.push({
              training_id: training,
              participant_id: participant,
              status: roll === 2 ? 'absent' : 'present',
              marked_at: `${date}T20:00:00Z`,
            });
        });
    }
  });

  const tournament = addDays(thisMonday, 12);
  tables.club_events.push(
    {
      id: uid(5, 1),
      name: 'Turniej klubowy – miecz długi',
      starts_at: warsawInstant(tournament, '09:00'),
      ends_at: warsawInstant(tournament, '16:00'),
      location: 'Hala sportowa B',
      canceled: false,
      created_by: DEMO_ACCOUNT,
      updated_at: `${today}T08:00:00Z`,
    },
    {
      id: uid(5, 2),
      name: 'Pokaz szermierki na festynie',
      starts_at: warsawInstant(addDays(thisMonday, 20), '11:00'),
      ends_at: warsawInstant(addDays(thisMonday, 20), '14:00'),
      location: 'Park miejski',
      canceled: false,
      created_by: DEMO_ACCOUNT,
      updated_at: `${today}T08:00:00Z`,
    },
  );
  for (const n of [0, 3, 7, 9])
    tables.club_event_bookings.push({
      event_id: uid(5, 1),
      participant_id: uid(2, n),
      response: 'yes',
    });

  return { tables, emails, dues, people };
}
