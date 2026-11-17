import type { SupabaseClient } from '@supabase/supabase-js';
import { EQUIPMENT_ITEMS, equipmentLabel } from './equipment-catalog.ts';

export type RequiredEquipmentOwnership =
  'own' | 'club' | 'none' | 'unknown' | null;
export interface TrainingRequirement {
  configured: boolean;
  items: { item: string; ownership: RequiredEquipmentOwnership }[];
}
export type RequirementResult =
  | { status: 'ready'; requirement: TrainingRequirement }
  | { status: 'unsupported' }
  | { status: 'error' };

const ownerships = new Set(['own', 'club', 'none', 'unknown']);
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Waliduje odpowiedź RPC przed użyciem w interfejsie. configured=false
// oznacza „nie ustawiono wymagań” i nie może nieść listy pozycji.
export function readRequirement(value: unknown): TrainingRequirement {
  if (
    !record(value) ||
    typeof value.configured !== 'boolean' ||
    !Array.isArray(value.items) ||
    !value.items.every(
      (entry: unknown) =>
        record(entry) &&
        typeof entry.item === 'string' &&
        (EQUIPMENT_ITEMS as readonly string[]).includes(entry.item) &&
        (entry.ownership === null ||
          (typeof entry.ownership === 'string' &&
            ownerships.has(entry.ownership))),
    ) ||
    (!value.configured && value.items.length > 0)
  )
    throw new Error('Invalid training requirement');
  return value as unknown as TrainingRequirement;
}

export async function loadTrainingRequirement(
  client: SupabaseClient,
  trainingId: string,
  participantId?: string | null,
): Promise<RequirementResult> {
  try {
    const { data, error } = await client.rpc(
      'get_training_required_equipment',
      { p_training_id: trainingId, p_participant_id: participantId || null },
    );
    if (error)
      // Brak funkcji w bazie (starsza migracja) to „unsupported”, a nie błąd.
      return error.code === 'PGRST202' || error.code === '42883'
        ? { status: 'unsupported' }
        : { status: 'error' };
    return { status: 'ready', requirement: readRequirement(data) };
  } catch {
    return { status: 'error' };
  }
}

// null oznacza „cały sprzęt”; zaznaczenie wszystkich pozycji zapisujemy jako
// null, żeby nowe pozycje katalogu były wymagane automatycznie.
export function normalizeRequiredSelection(selected: readonly string[]) {
  const items = EQUIPMENT_ITEMS.filter((item) => selected.includes(item));
  return items.length === EQUIPMENT_ITEMS.length ? null : items;
}

export function requiredEquipmentText(
  items: readonly string[] | null | undefined,
  language: 'pl' | 'en',
) {
  if (!items)
    return language === 'en'
      ? 'All equipment (not set)'
      : 'Cały sprzęt (nie ustawiono)';
  if (!items.length) return language === 'en' ? 'No equipment' : 'Bez sprzętu';
  return items.map((item) => equipmentLabel(item, language)).join(', ');
}
