import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  DEMO_ACCOUNT,
  DEMO_EMAIL,
  addDays,
  fictional,
  createDemoDatabase,
  uid,
  warsawInstant,
  type Row,
} from './data.ts';

type Result = { data: unknown; error: unknown; count?: number | null };
type Failure = { message: string; code?: string; hint?: string };

class DemoError extends Error {
  constructor(public failure: Failure) {
    super(failure.message);
  }
}
const fail = (message: string, extra: Partial<Failure> = {}): never => {
  throw new DemoError({ message, code: 'P0001', ...extra });
};

const db = createDemoDatabase();
const t = db.tables;
const latency = () => new Promise((resolve) => setTimeout(resolve, 120));
const now = () => new Date().toISOString();
let sequence = 1000;
const nextId = (prefix: number) => uid(prefix, sequence++);
const hash = (value: string) =>
  Array.from({ length: 64 }, (_, index) =>
    ((value.charCodeAt(index % value.length) + index * 7) % 16).toString(16),
  ).join('');

class Query implements PromiseLike<Result> {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private start = 0;
  private end = Number.POSITIVE_INFINITY;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private returning = false;
  private counting = false;
  private write?: (rows: Row[]) => Row[];

  constructor(
    private table: string | null,
    private produce?: () => unknown,
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (this.write) this.returning = true;
    if (options?.count) this.counting = true;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  gte(column: string, value: string) {
    this.filters.push((row) => String(row[column]) >= value);
    return this;
  }
  gt(column: string, value: string) {
    this.filters.push((row) => String(row[column]) > value);
    return this;
  }
  lte(column: string, value: string) {
    this.filters.push((row) => String(row[column]) <= value);
    return this;
  }
  lt(column: string, value: string) {
    this.filters.push((row) => String(row[column]) < value);
    return this;
  }
  filter(column: string, operator: string, value: unknown) {
    if (operator === 'eq') return this.eq(column, value);
    if (operator === 'neq') return this.neq(column, value);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }
  range(from: number, to: number) {
    this.start = from;
    this.end = to;
    return this;
  }
  limit(count: number) {
    this.end = this.start + count - 1;
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }
  maybeSingle() {
    this.mode = 'maybe';
    return this;
  }
  returns() {
    return this;
  }
  abortSignal() {
    return this;
  }
  throwOnError() {
    return this;
  }

  insert(values: Row | Row[]) {
    this.write = () => {
      const rows = (Array.isArray(values) ? values : [values]).map((row) => ({
        ...row,
      }));
      this.rows().push(...rows);
      return rows;
    };
    return this;
  }
  update(values: Row) {
    this.write = (matched) => {
      for (const row of matched) Object.assign(row, values);
      return matched;
    };
    return this;
  }
  upsert(
    values: Row | Row[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    const keys = (options?.onConflict ?? 'id').split(',');
    this.write = () =>
      (Array.isArray(values) ? values : [values]).map((value) => {
        const existing = this.rows().find((row) =>
          keys.every((key) => row[key] === value[key]),
        );
        if (!existing) {
          const row = { ...value };
          this.rows().push(row);
          return row;
        }
        if (!options?.ignoreDuplicates) Object.assign(existing, value);
        return existing;
      });
    return this;
  }
  delete() {
    this.write = (matched) => {
      const rows = this.rows();
      for (const row of matched) rows.splice(rows.indexOf(row), 1);
      return matched;
    };
    return this;
  }

  private rows() {
    if (!this.table) return [];
    return (t[this.table] ??= []);
  }

  private execute(): Result {
    try {
      const source = this.produce ? this.produce() : this.rows();
      if (!Array.isArray(source)) return { data: source ?? null, error: null };
      let rows = (source as Row[]).filter((row) =>
        this.filters.every((test) => test(row)),
      );
      if (this.write) {
        rows = this.write(rows);
        if (!this.returning) return { data: null, error: null };
      }
      const sorted = [...rows].sort((left, right) => {
        for (const { column, ascending } of this.orders) {
          const a = left[column];
          const b = right[column];
          const result =
            typeof a === 'number' && typeof b === 'number'
              ? a - b
              : String(a ?? '').localeCompare(String(b ?? ''));
          if (result) return ascending ? result : -result;
        }
        return 0;
      });
      const page = sorted
        .slice(this.start, this.end + 1)
        .map((row) => structuredClone(row));
      const count = this.counting ? sorted.length : null;
      if (this.mode === 'single')
        return page.length === 1
          ? { data: page[0], error: null, count }
          : {
              data: null,
              error: { message: 'Row not found', code: 'PGRST116' },
            };
      if (this.mode === 'maybe')
        return { data: page[0] ?? null, error: null, count };
      return { data: page, error: null, count };
    } catch (error) {
      if (error instanceof DemoError)
        return { data: null, error: error.failure };
      throw error;
    }
  }

  then<A = Result, B = never>(
    resolve?: ((value: Result) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return latency()
      .then(() => this.execute())
      .then(resolve, reject);
  }
}

const participant = (id: unknown) =>
  t.participants.find((row) => row.id === id) ?? fail('Participant not found');
const training = (id: unknown) =>
  t.trainings.find((row) => row.id === id) ?? fail('Training not found');
const section = (id: unknown) => t.sections.find((row) => row.id === id);
const accountName = (id: unknown) =>
  String(
    t.account_profiles.find((row) => row.account_id === id)?.display_name ??
      'Konto',
  );
const roles = (account: unknown) =>
  t.account_roles
    .filter((row) => row.account_id === account)
    .map((row) => String(row.role));
const sectionsOf = (participantId: unknown) =>
  t.participant_sections
    .filter((row) => row.participant_id === participantId)
    .map((row) => String(row.section_id));
const ownParticipant = () =>
  String(
    t.participant_accounts.find((row) => row.account_id === DEMO_ACCOUNT)
      ?.participant_id,
  );
const settings = () => t.club_settings[0];

function duesStatus(participantId: unknown) {
  const person = participant(participantId);
  const fees = settings();
  const group =
    person.tier === 'child'
      ? 'youth'
      : person.level === 'beginner'
        ? person.beginner_membership === 'azs'
          ? 'beginner_azs'
          : 'beginner_association'
        : 'steel';
  const fee = Number(
    group === 'steel'
      ? fees.monthly_fee
      : group === 'beginner_azs'
        ? fees.fee_beginner_azs
        : fees.fee_youth,
  );
  const balance = db.dues.get(String(participantId)) ?? 0;
  const coach = person.level === 'coach';
  const limit = coach ? null : 2 * (fee || Number(fees.monthly_fee)) * 100;
  return {
    balance_grosze: balance,
    fee_group: group,
    group_fee: fee,
    coach_exempt: coach,
    limit_grosze: limit,
    blocked: limit !== null && -balance >= limit,
  };
}

function bookedWithEquipment(trainingId: unknown) {
  return t.training_bookings
    .filter((row) => row.training_id === trainingId && row.response === 'yes')
    .map((row) => {
      const person = participant(row.participant_id);
      return {
        participant_id: person.id,
        name: person.name,
        equipment: person.equipment,
      };
    });
}

function regularTrainings() {
  return t.training_series.map((series) => {
    const future = t.trainings.filter(
      (row) => row.series_id === series.id && String(row.starts_at) > now(),
    );
    return {
      ...series,
      coach_name: series.coach_account_id
        ? accountName(series.coach_account_id)
        : null,
      coach_available: true,
      future_count: future.length,
      generated_until: future.length
        ? String(future[future.length - 1].starts_at).slice(0, 10)
        : null,
      generation_error: null,
    };
  });
}

function generateSeries(series: Row) {
  const monday = addDays(String(series.starts_on), 0);
  for (let week = 0; week < 8; week += 1) {
    const date = addDays(monday, week * 7);
    const startsAt = warsawInstant(date, String(series.local_start));
    if (startsAt < now()) continue;
    t.trainings.push({
      id: nextId(4),
      section_id: series.section_id,
      starts_at: startsAt,
      ends_at: warsawInstant(date, String(series.local_end)),
      group_label: series.group_label,
      location: series.location,
      coach_label: series.coach_account_id
        ? accountName(series.coach_account_id)
        : '',
      coach_account_id: series.coach_account_id,
      series_id: series.id,
      canceled: false,
      icon: series.icon,
      updated_at: now(),
    });
  }
}

function applySeriesChanges(series: Row, changes: Row) {
  Object.assign(series, changes);
  series.revision = Number(series.revision) + 1;
  let updated = 0;
  for (const row of t.trainings) {
    if (row.series_id !== series.id || String(row.starts_at) <= now()) continue;
    const date = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Warsaw',
    }).format(new Date(String(row.starts_at)));
    Object.assign(row, {
      section_id: series.section_id,
      starts_at: warsawInstant(date, String(series.local_start)),
      ends_at: warsawInstant(date, String(series.local_end)),
      group_label: series.group_label,
      location: series.location,
      coach_account_id: series.coach_account_id,
      coach_label: series.coach_account_id
        ? accountName(series.coach_account_id)
        : '',
      icon: series.icon,
      updated_at: now(),
    });
    updated += 1;
  }
  return updated;
}

function equipmentShortage(trainingId: unknown, participantId: unknown) {
  const target = training(trainingId);
  const series = t.training_series.find((row) => row.id === target.series_id);
  const required = (item: string) =>
    !series ||
    series.required_equipment === null ||
    (series.required_equipment as string[]).includes(item);
  const club = (person: Row) =>
    (person.equipment as Row[]).filter(
      (entry) => entry.ownership === 'club' && required(String(entry.item)),
    );
  for (const need of club(participant(participantId))) {
    const size = String(need.size ?? '');
    const stock = t.club_equipment_stock.find(
      (row) => row.item === need.item && row.size === size,
    );
    if (!stock) continue;
    const used = t.training_bookings.filter((row) => {
      if (
        row.response !== 'yes' ||
        row.participant_id === participantId ||
        row.training_id !== trainingId
      )
        return false;
      return club(participant(row.participant_id)).some(
        (entry) =>
          entry.item === need.item && String(entry.size ?? '') === size,
      );
    }).length;
    if (Number(stock.quantity) <= used)
      return `${need.item}${size ? `:${size}` : ''}`;
  }
  return null;
}

let invitation = 'K7M2QX';
let feedRevision: string | null = null;
let feedSections: string[] | null = null;
const visibleSections = () => t.sections.map((row) => String(row.id));
const ownSections = () =>
  roles(DEMO_ACCOUNT).includes('coach')
    ? visibleSections()
    : sectionsOf(ownParticipant());

const rpcs: Record<string, (args: Row) => unknown> = {
  get_my_portal_access: () => {
    const person = participant(ownParticipant());
    const [first, last] = String(person.name).split(' ');
    return {
      profile: {
        account_id: DEMO_ACCOUNT,
        first_name: first,
        last_name: last,
        birth_date: '1991-04-12',
        phone: '+48 600 000 000',
        preferred_weapons: [],
        training_group: 'advanced',
        weapons_used: ['longsword', 'sabre'],
        registration_requires_approval: false,
        updated_at: '2026-01-10T10:00:00Z',
      },
      profile_request: null,
      registration_participant: null,
      registered: true,
      profile_complete: true,
      club_access: true,
      can_self_activate: false,
      pending: false,
      access_scope: {
        roles: roles(DEMO_ACCOUNT),
        section_ids: sectionsOf(person.id),
      },
    };
  },
  get_my_section_choices: () => ({
    available: true,
    sections: t.sections
      .filter((row) => row.audience === 'adult')
      .map((row) => ({ id: row.id, name: row.name })),
    assigned_section_ids: sectionsOf(ownParticipant()),
    request: null,
  }),
  submit_my_profile: () => ({ status: 'saved' }),
  submit_my_section_request: ({ p_section_ids }) => {
    const ids = p_section_ids as string[];
    const own = ownParticipant();
    t.participant_sections = t.participant_sections.filter(
      (row) => row.participant_id !== own,
    );
    for (const id of ids)
      t.participant_sections.push({ participant_id: own, section_id: id });
    return { status: 'unchanged' };
  },
  activate_my_admin_profile: () => ({ status: 'active' }),
  get_club_invitation: () => ({
    code: invitation,
    code_hash: hash(invitation),
  }),
  rotate_club_invitation: () => {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    invitation = Array.from(
      { length: 6 },
      () => letters[Math.floor(Math.random() * letters.length)],
    ).join('');
    return { code: invitation, code_hash: hash(invitation) };
  },
  coach_role_sync_enabled: () => true,
  list_club_account_roles: () =>
    t.account_profiles.map((profile) => ({
      account_id: profile.account_id,
      display_name: profile.display_name,
      email: db.emails.get(String(profile.account_id)) ?? null,
      club_access: t.participant_accounts.some(
        (row) => row.account_id === profile.account_id && row.active,
      ),
      roles: roles(profile.account_id),
      section_ids: t.coach_sections
        .filter((row) => row.account_id === profile.account_id)
        .map((row) => row.section_id),
    })),
  set_club_account_roles: ({ p_account_id, p_roles, p_section_ids }) => {
    t.account_roles = t.account_roles.filter(
      (row) => row.account_id !== p_account_id,
    );
    for (const role of p_roles as string[])
      t.account_roles.push({ account_id: p_account_id, role });
    t.coach_sections = t.coach_sections.filter(
      (row) => row.account_id !== p_account_id,
    );
    for (const id of p_section_ids as string[])
      t.coach_sections.push({ account_id: p_account_id, section_id: id });
    return true;
  },
  get_training_coaches: () =>
    [
      ...new Set(
        t.account_roles
          .filter((row) => row.role === 'coach')
          .map((row) => String(row.account_id)),
      ),
    ].map((account) => ({ account_id: account, name: accountName(account) })),
  list_participant_account_access: () =>
    t.participant_accounts.map((link) => {
      const person = participant(link.participant_id);
      return {
        participant_id: link.participant_id,
        account_id: link.account_id,
        display_name: accountName(link.account_id),
        email: db.emails.get(String(link.account_id)) ?? null,
        email_confirmed: true,
        approval_pending: person.status === 'pending',
        relationship: link.relationship,
        active: link.active,
        is_registration: person.status === 'pending',
        age_years: person.tier === 'child' ? 10 : 29,
      };
    }),
  set_participant_account_access: ({
    p_participant_id,
    p_account_id,
    p_active,
  }) => {
    const link = t.participant_accounts.find(
      (row) =>
        row.participant_id === p_participant_id &&
        row.account_id === p_account_id,
    );
    if (link) link.active = p_active;
    return true;
  },
  approve_club_registration: ({
    p_participant_id,
    p_account_id,
    p_category,
  }) => {
    const person = participant(p_participant_id);
    person.status = 'active';
    person.tier = p_category === 'child' ? 'child' : 'adult-beginner';
    const link = t.participant_accounts.find(
      (row) => row.account_id === p_account_id,
    );
    if (link) link.active = true;
    return true;
  },
  set_participant_assignments: ({
    p_participant_id,
    p_tier,
    p_level,
    p_section_ids,
  }) => {
    const person = participant(p_participant_id);
    Object.assign(person, { tier: p_tier, level: p_level });
    t.participant_sections = t.participant_sections.filter(
      (row) => row.participant_id !== p_participant_id,
    );
    for (const id of p_section_ids as string[])
      t.participant_sections.push({
        participant_id: p_participant_id,
        section_id: id,
      });
    return true;
  },
  set_participant_category: ({ p_participant_id, p_category }) => {
    participant(p_participant_id).tier = p_category;
    return true;
  },
  delete_club_participant: ({ p_participant_id }) => {
    t.participants = t.participants.filter(
      (row) => row.id !== p_participant_id,
    );
    t.participant_sections = t.participant_sections.filter(
      (row) => row.participant_id !== p_participant_id,
    );
    t.participant_accounts = t.participant_accounts.filter(
      (row) => row.participant_id !== p_participant_id,
    );
    return true;
  },
  set_azs_paid: ({ p_participant_id, p_paid }) => {
    Object.assign(participant(p_participant_id), {
      azs_paid: p_paid,
      azs_marked_by: p_paid ? DEMO_ACCOUNT : null,
      azs_marked_at: p_paid ? now() : null,
    });
    return true;
  },
  save_participant_clothing_sizes: ({ p_participant_id, p_sizes }) => {
    participant(p_participant_id).clothing_sizes = p_sizes;
    return true;
  },
  save_participant_profile_equipment_if_current: ({
    p_participant_id,
    p_equipment,
    p_clothing_sizes,
  }) => {
    const person = participant(p_participant_id);
    person.equipment = p_equipment;
    if (p_clothing_sizes) person.clothing_sizes = p_clothing_sizes;
    person.full_gear = (p_equipment as Row[]).every(
      (entry) => entry.ownership === 'own',
    );
    return true;
  },
  get_participant_dues_status: ({ p_participant_id }) =>
    duesStatus(p_participant_id),
  get_participant_dues_balance: ({ p_participant_id }) =>
    db.dues.get(String(p_participant_id)) ?? 0,
  get_participant_dues_balances: () =>
    t.participants.map((row) => ({
      participant_id: row.id,
      balance_grosze: db.dues.get(String(row.id)) ?? 0,
    })),
  set_participant_dues_balance: ({ p_participant_id, p_balance_grosze }) => {
    db.dues.set(String(p_participant_id), Number(p_balance_grosze));
    return p_balance_grosze;
  },
  set_training_booking: ({ p_training_id, p_participant_id, p_response }) => {
    const target = training(p_training_id);
    if (target.canceled || String(target.starts_at) <= now())
      fail('Training is canceled or already started');
    t.training_bookings = t.training_bookings.filter(
      (row) =>
        !(
          row.training_id === p_training_id &&
          row.participant_id === p_participant_id
        ),
    );
    if (p_response === null) return null;
    if (p_response === 'yes') {
      if (duesStatus(p_participant_id).blocked)
        fail('Dues limit exceeded', { hint: 'dues_limit' });
      const shortage = equipmentShortage(p_training_id, p_participant_id);
      if (shortage)
        throw new DemoError({
          message: 'Club equipment unavailable',
          code: 'P0001',
          hint: 'equipment_unavailable',
          details: shortage,
        } as Failure);
    }
    t.training_bookings.push({
      training_id: p_training_id,
      participant_id: p_participant_id,
      response: p_response,
      updated_at: now(),
    });
    return p_response;
  },
  set_coach_training_booking: ({ p_training_id, p_active }) => {
    const existing = t.coach_training_bookings.find(
      (row) =>
        row.training_id === p_training_id && row.account_id === DEMO_ACCOUNT,
    );
    if (existing) existing.active = p_active;
    else
      t.coach_training_bookings.push({
        training_id: p_training_id,
        account_id: DEMO_ACCOUNT,
        active: p_active,
      });
    return true;
  },
  get_training_coach_bookings: ({ p_training_ids }) =>
    t.coach_training_bookings
      .filter((row) =>
        (p_training_ids as string[]).includes(String(row.training_id)),
      )
      .map((row) => ({
        training_id: row.training_id,
        coach_name: accountName(row.account_id),
        is_self: row.account_id === DEMO_ACCOUNT,
        active: row.active,
      })),
  get_training_role_responses: ({ p_training_id }) =>
    roleResponses(p_training_id),
  get_training_role_responses_with_avatars: ({ p_training_id }) =>
    roleResponses(p_training_id).map((row, index) => ({
      ...row,
      person_key: `person-${index}`,
      avatar_key: null,
    })),
  get_training_equipment: ({ p_training_id }) =>
    bookedWithEquipment(p_training_id),
  get_training_coach_equipment: ({ p_training_id }) =>
    bookedWithEquipment(p_training_id),
  get_training_required_equipment: ({ p_training_id, p_participant_id }) => {
    const target = training(p_training_id);
    const series = t.training_series.find((row) => row.id === target.series_id);
    const required = series?.required_equipment as string[] | null | undefined;
    if (!required) return { configured: false, items: [] };
    const person = p_participant_id ? participant(p_participant_id) : null;
    return {
      configured: true,
      items: required.map((item) => ({
        item,
        ownership:
          ((person?.equipment as Row[] | undefined)?.find(
            (entry) => entry.item === item,
          )?.ownership as string | undefined) ?? null,
      })),
    };
  },
  cancel_training: ({ p_training_id }) => {
    Object.assign(training(p_training_id), {
      canceled: true,
      updated_at: now(),
    });
    return p_training_id;
  },
  update_training: ({
    p_training_id,
    p_date,
    p_start,
    p_end,
    p_group,
    p_location,
    p_icon,
  }) => {
    Object.assign(training(p_training_id), {
      starts_at: warsawInstant(String(p_date), String(p_start)),
      ends_at: warsawInstant(String(p_date), String(p_end)),
      group_label: p_group,
      location: p_location,
      ...(p_icon !== undefined ? { icon: p_icon } : {}),
      updated_at: now(),
    });
    return p_training_id;
  },
  list_regular_trainings: () => regularTrainings(),
  preview_regular_training_update: ({ p_series_id }) => ({
    fingerprint: `demo-${p_series_id}`,
    affected_count: t.trainings.filter(
      (row) => row.series_id === p_series_id && String(row.starts_at) > now(),
    ).length,
    skipped_count: 0,
  }),
  update_regular_training: ({ p_series_id, p_changes }) => {
    const series =
      t.training_series.find((row) => row.id === p_series_id) ??
      fail('Series not found');
    const updated = applySeriesChanges(series, p_changes as Row);
    return { updated_count: updated, revision: series.revision };
  },
  create_regular_training: (args) => {
    const series: Row = {
      id: nextId(3),
      section_id: args.p_section_id,
      starts_on: args.p_starts_on,
      ends_on: null,
      weekday: args.p_weekday,
      local_start: args.p_start,
      local_end: args.p_end,
      group_label: args.p_group,
      location: args.p_location,
      coach_account_id: args.p_coach_account_id ?? null,
      is_active: true,
      icon: args.p_icon ?? null,
      color: args.p_color ?? null,
      required_equipment: args.p_required_equipment ?? null,
      revision: 1,
    };
    t.training_series.push(series);
    generateSeries(series);
    return series.id;
  },
  list_profile_requests: () => [],
  review_profile_request: () => true,
  list_section_requests: () => [],
  review_section_request: () => true,
  create_club_section: ({ p_name, p_audience }) => {
    const row = {
      id: String(p_name)
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, '-'),
      name: p_name,
      audience: p_audience,
      revision: 1,
    };
    t.sections.push(row);
    return row;
  },
  rename_club_section: ({ p_section_id, p_name }) => {
    const row = section(p_section_id) ?? fail('Section not found');
    Object.assign(row, { name: p_name, revision: Number(row.revision) + 1 });
    return row;
  },
  set_club_equipment_stock: ({ p_stock }) => {
    t.club_equipment_stock = (p_stock as Row[]).map((row) => ({ ...row }));
    return t.club_equipment_stock.length;
  },
  create_club_event: (args) => {
    const id = nextId(5);
    t.club_events.push({
      id,
      name: args.p_name,
      starts_at: warsawInstant(String(args.p_date), String(args.p_start)),
      ends_at: warsawInstant(String(args.p_date), String(args.p_end)),
      location: args.p_location,
      canceled: false,
      created_by: DEMO_ACCOUNT,
      updated_at: now(),
    });
    return id;
  },
  update_club_event: (args) => {
    const event =
      t.club_events.find((row) => row.id === args.p_event_id) ??
      fail('Event not found');
    Object.assign(event, {
      name: args.p_name,
      starts_at: warsawInstant(String(args.p_date), String(args.p_start)),
      ends_at: warsawInstant(String(args.p_date), String(args.p_end)),
      location: args.p_location,
      updated_at: now(),
    });
    return true;
  },
  cancel_club_event: ({ p_event_id }) => {
    const event = t.club_events.find((row) => row.id === p_event_id);
    if (event) event.canceled = true;
    return true;
  },
  set_club_event_booking: ({ p_event_id, p_participant_id, p_response }) => {
    t.club_event_bookings = t.club_event_bookings.filter(
      (row) =>
        !(
          row.event_id === p_event_id && row.participant_id === p_participant_id
        ),
    );
    if (p_response)
      t.club_event_bookings.push({
        event_id: p_event_id,
        participant_id: p_participant_id,
        response: p_response,
      });
    return true;
  },
  get_my_calendar_feed_sections: () => ({
    visible: t.sections.map((row) => ({ id: row.id, name: row.name })),
    own: ownSections(),
    selected: feedSections,
  }),
  set_my_calendar_feed_sections: ({ p_section_ids }) => {
    feedSections = (p_section_ids as string[] | null) ?? null;
    return feedSections;
  },
};

function roleResponses(trainingId: unknown) {
  const coaches = t.coach_training_bookings
    .filter((row) => row.training_id === trainingId && row.active)
    .map((row) => ({
      name: accountName(row.account_id),
      role: 'coach',
      response: 'yes',
    }));
  const athletes = t.training_bookings
    .filter((row) => row.training_id === trainingId)
    .map((row) => ({
      name: String(participant(row.participant_id).name),
      role: 'participant',
      response: row.response,
    }));
  return [...coaches, ...athletes];
}

const session = {
  access_token: 'demo-access-token',
  refresh_token: 'demo-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: DEMO_ACCOUNT,
    aud: 'authenticated',
    role: 'authenticated',
    email: DEMO_EMAIL,
    app_metadata: { provider: 'google' },
    user_metadata: {
      full_name: fictional('Aleksandra Nowak'),
      given_name: 'Aleksandra',
      family_name: 'Nowak',
    },
    created_at: '2026-01-10T10:00:00Z',
    is_anonymous: false,
  },
} as unknown as Session;

const SESSION_KEY = 'gwiazdy-demo-session';
const signedIn = () => {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
};
let current: Session | null = signedIn() ? session : null;
type Listener = (event: string, next: Session | null) => void;
const listeners = new Set<Listener>();
const emit = (event: string) => {
  try {
    if (current) sessionStorage.setItem(SESSION_KEY, '1');
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Prywatny tryb przeglądarki: demo działa bez zapamiętania sesji.
  }
  for (const listener of listeners) listener(event, current);
};
const signIn = () => {
  current = session;
  emit('SIGNED_IN');
};

const photos = new Map<string, string>();

export function createDemoClient(): SupabaseClient {
  const client = {
    from: (table: string) => new Query(table),
    rpc: (name: string, args: Row = {}) =>
      new Query(null, () => {
        const handler = rpcs[name];
        if (!handler)
          throw new DemoError({
            message: `Function ${name} is not available in the demo`,
            code: 'PGRST202',
          });
        const result = handler(args);
        return Array.isArray(result) && typeof args.p_offset === 'number'
          ? result.slice(
              args.p_offset,
              args.p_offset + Number(args.p_limit ?? result.length),
            )
          : result;
      }),
    auth: {
      onAuthStateChange: (listener: Listener) => {
        listeners.add(listener);
        queueMicrotask(() => listener('INITIAL_SESSION', current));
        return {
          data: {
            subscription: { unsubscribe: () => listeners.delete(listener) },
          },
        };
      },
      getSession: async () => ({ data: { session: current }, error: null }),
      signInWithOAuth: async () => {
        await latency();
        signIn();
        return { data: { provider: 'google', url: null }, error: null };
      },
      signInWithOtp: async () => {
        await latency();
        return { data: {}, error: null };
      },
      verifyOtp: async () => {
        await latency();
        signIn();
        return { data: { session: current }, error: null };
      },
      exchangeCodeForSession: async () => ({ data: {}, error: null }),
      signOut: async () => {
        current = null;
        emit('SIGNED_OUT');
        return { error: null };
      },
    },
    functions: {
      invoke: async (
        name: string,
        options: { method?: string; body?: { action?: string } } = {},
      ) => {
        await latency();
        if (name !== 'calendar-feed-token')
          return {
            data: null,
            error: { message: 'Not available in the demo' },
          };
        const action = options.body?.action;
        if (action === 'revoke') feedRevision = null;
        else if (action === 'create' || action === 'rotate')
          feedRevision = hash(`feed-${Date.now()}`);
        return {
          data: {
            protocol: 2,
            active: Boolean(feedRevision),
            revision: feedRevision,
            ...(action && action !== 'revoke'
              ? {
                  url: `https://demo.invalid/functions/v1/calendar-feed?token=${feedRevision}`,
                }
              : {}),
            ...(action === 'revoke' ? { revoked: true } : {}),
          },
          error: null,
        };
      },
    },
    storage: {
      from: () => ({
        upload: async (path: string, file: Blob) => {
          photos.set(path, URL.createObjectURL(file));
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path: string) =>
          photos.has(path)
            ? { data: { signedUrl: photos.get(path) }, error: null }
            : { data: null, error: { message: 'Not found' } },
        list: async (prefix: string) => ({
          data: [...photos.keys()]
            .filter((path) => path.startsWith(`${prefix}/`))
            .map((path) => ({
              name: path.slice(prefix.length + 1),
              created_at: now(),
              updated_at: now(),
              metadata: {},
            })),
          error: null,
        }),
        remove: async (paths: string[]) => {
          for (const path of paths) photos.delete(path);
          return { data: [], error: null };
        },
      }),
    },
  };
  return client as unknown as SupabaseClient;
}
