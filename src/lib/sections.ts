import type { Section } from '../types/club';

export const SECTION_NAME_MAX_LENGTH = 80;

// Normalizacja nazw sekcji: każdy ciąg białych
// znaków Unicode staje się jedną spacją, a znaki sterujące i niewidoczne
// (np. zmiana kierunku tekstu) są odrzucane.
const whitespace =
  /[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;
const forbidden =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f]/;
const styledSections = new Set([
  'longsword',
  'sword-buckler',
  'sabre',
  'children',
]);

export type SectionNameProblem = 'empty' | 'long' | 'control';

export function normalizeSectionName(value: string) {
  return value.replace(whitespace, ' ').replace(/^ +| +$/g, '');
}

export function sectionNameKey(value: string) {
  return normalizeSectionName(value).toLocaleLowerCase('pl-PL');
}

export function sectionNameProblem(value: string): SectionNameProblem | null {
  const name = normalizeSectionName(value);
  if (!name) return 'empty';
  if (forbidden.test(name)) return 'control';
  if ([...name].length > SECTION_NAME_MAX_LENGTH) return 'long';
  return null;
}

export function sectionNameTaken(
  sections: readonly Pick<Section, 'id' | 'name' | 'audience'>[],
  name: string,
  audience: Section['audience'],
  exceptId?: string,
) {
  const key = sectionNameKey(name);
  return sections.some(
    (section) =>
      section.id !== exceptId &&
      section.audience === audience &&
      sectionNameKey(section.name) === key,
  );
}

export function sectionAudienceLabel(
  audience: Section['audience'],
  language: 'pl' | 'en',
) {
  if (audience === 'child') return language === 'en' ? 'Children' : 'Dzieci';
  return language === 'en' ? 'Adults' : 'Dorośli';
}

// Ta sama nazwa może istnieć osobno dla dorosłych i dzieci; dopisek grupy
// pojawia się tylko wtedy, gdy bez niego etykiety byłyby nie do odróżnienia.
export function sectionLabel(
  section: Pick<Section, 'id' | 'name' | 'audience'>,
  sections: readonly Pick<Section, 'id' | 'name' | 'audience'>[],
  language: 'pl' | 'en',
) {
  const key = sectionNameKey(section.name);
  const shared = sections.some(
    (other) =>
      other.id !== section.id &&
      other.audience !== section.audience &&
      sectionNameKey(other.name) === key,
  );
  return shared
    ? `${section.name} (${sectionAudienceLabel(section.audience, language)})`
    : section.name;
}

// Własny kolor w CSS mają tylko cztery pierwotne sekcje; pozostałe
// (np. dodane przez administratora) dostają wariant neutralny.
export function sectionVariant(sectionId: string) {
  return styledSections.has(sectionId) ? sectionId : 'neutral';
}

export function compareSections(
  left: Pick<Section, 'id' | 'name' | 'audience'>,
  right: Pick<Section, 'id' | 'name' | 'audience'>,
) {
  if (left.audience !== right.audience)
    return left.audience === 'adult' ? -1 : 1;
  return (
    left.name.localeCompare(right.name, 'pl-PL', { sensitivity: 'base' }) ||
    left.id.localeCompare(right.id)
  );
}
