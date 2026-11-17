import type { Participant } from './club';

export interface PersonalProfile {
  account_id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  phone: string | null;
  preferred_weapons: string[];
  training_group?: 'beginner' | 'advanced';
  weapons_used?: string[];
  registration_requires_approval?: boolean;
  updated_at: string;
}

export interface ProfileRequest {
  participant_id?: string | null;
  id: string;
  account_id: string;
  first_name?: string;
  last_name?: string;
  training_group: 'beginner' | 'advanced';
  status: 'pending' | 'approved' | 'rejected';
  review_note?: string | null;
}

export interface PortalAccess {
  access_scope?: { roles: string[]; section_ids: string[] };
  profile: PersonalProfile | null;
  profile_request?: ProfileRequest | null;
  registration_participant?: Participant | null;
  registered?: boolean;
  profile_complete: boolean;
  club_access: boolean;
  can_self_activate: boolean;
  pending: boolean;
}

export function validBirthDate(value: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value &&
    value <=
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  );
}
