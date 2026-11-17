export interface RegularTraining {
  id: string;
  section_id: string;
  starts_on: string;
  weekday: number;
  local_start: string;
  local_end: string;
  group_label: string;
  location: string;
  coach_account_id: string | null;
  coach_name: string | null;
  coach_available: boolean;
  is_active: boolean;
  icon?: string | null;
  required_equipment?: string[] | null;
  color?: string | null;
  revision: number;
  future_count: number;
  ends_on: string | null;
  generated_until: string | null;
  generation_error?: string | null;
}

export type RegularTrainingChanges = Partial<
  Pick<
    RegularTraining,
    | 'section_id'
    | 'weekday'
    | 'local_start'
    | 'local_end'
    | 'group_label'
    | 'location'
    | 'coach_account_id'
    | 'is_active'
    | 'icon'
    | 'required_equipment'
    | 'color'
  >
>;
