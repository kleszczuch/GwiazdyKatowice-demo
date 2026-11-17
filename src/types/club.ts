export interface Participant {
  id: string;
  name: string;
  level: ParticipantLevel;
  category: 'adult-beginner' | 'adult-advanced' | 'child';
  beginner_membership?: 'azs' | 'association';
  clothing_sizes?: ClothingSizes;
  clothing_sizes_requested?: boolean;
}
export type ClothingSizeKey =
  'jacket' | 'mask' | 'pants' | 'gloves' | 'gloves_heavy' | 'overlay';
export type ClothingSizes = Partial<Record<ClothingSizeKey, string>>;
export type ParticipantLevel = 'beginner' | 'advanced' | 'coach';
export type ParticipantTier = 'adult-beginner' | 'adult-advanced' | 'child';
export type EquipmentCatalogKey =
  | 'jacket'
  | 'mask'
  | 'pants'
  | 'gloves'
  | 'gloves_heavy'
  | 'forearm'
  | 'knee'
  | 'groin'
  | 'overlay'
  | 'gorget'
  | 'sabre'
  | 'sword_buckler'
  | 'longsword';
export type EquipmentOwnership = 'own' | 'club' | 'none' | 'unknown';
export interface ParticipantEquipmentEntry {
  item: EquipmentCatalogKey;
  ownership: EquipmentOwnership;
  size: string | null;
}
export interface ProfileParticipant extends Participant {
  tier: ParticipantTier;
  status: 'pending' | 'active' | 'suspended' | 'left';
  azs_paid: boolean;
  azs_marked_by: string | null;
  azs_marked_at: string | null;
  equipment: ParticipantEquipmentEntry[];
  full_gear: boolean;
}
export interface ClubSettings {
  monthly_fee: number;
  fulgir_discount: number;
  fee_youth?: number;
  fee_beginner_azs?: number;
}
export type FeeGroup =
  'steel' | 'beginner_association' | 'youth' | 'beginner_azs';
export interface DuesStatus {
  balance_grosze: number;
  fee_group: FeeGroup;
  group_fee: number | null;
  coach_exempt: boolean;
  limit_grosze: number | null;
  blocked: boolean;
}
export interface Section {
  id: string;
  name: string;
  audience: 'adult' | 'child';
  revision?: number;
}
export interface ParticipantSection {
  participant_id: string;
  section_id: string;
}
export interface CoachSection {
  section_id: string;
}
export interface CoachTrainingBooking {
  training_id: string;
  coach_name: string;
  is_self: boolean;
  active: boolean;
}
export interface Attendance {
  training_id: string;
  participant_id: string;
  status: 'present' | 'absent';
  marked_at?: string;
}
export interface AccountLink {
  relationship: 'self' | 'guardian';
  account_id: string;
  participant_id: string;
  active: boolean;
}
export interface Training {
  icon?: string | null;
  id: string;
  section_id: string;
  starts_at: string;
  ends_at: string;
  group_label: string;
  location: string;
  coach_label: string;
  coach_account_id?: string | null;
  series_id: string | null;
  canceled: boolean;
}
export interface Booking {
  training_id: string;
  participant_id: string;
  active: boolean;
}
export type ClubRole = 'admin' | 'board' | 'coach';
