export const TRAINING_COLORS = [
  { key: 'red', pl: 'Czerwony', en: 'Red' },
  { key: 'orange', pl: 'Pomarańczowy', en: 'Orange' },
  { key: 'yellow', pl: 'Żółty', en: 'Yellow' },
  { key: 'green', pl: 'Zielony', en: 'Green' },
  { key: 'teal', pl: 'Morski', en: 'Teal' },
  { key: 'blue', pl: 'Niebieski', en: 'Blue' },
  { key: 'purple', pl: 'Fioletowy', en: 'Purple' },
  { key: 'pink', pl: 'Różowy', en: 'Pink' },
  { key: 'gray', pl: 'Szary', en: 'Gray' },
] as const;

export type TrainingColor = (typeof TRAINING_COLORS)[number]['key'];

export function trainingColor(value: unknown): TrainingColor | null {
  return TRAINING_COLORS.some((color) => color.key === value)
    ? (value as TrainingColor)
    : null;
}

export function trainingColorLabel(value: unknown, language: 'pl' | 'en') {
  const color = TRAINING_COLORS.find((entry) => entry.key === value);
  if (!color)
    return language === 'en'
      ? 'Default (section color)'
      : 'Domyślny (kolor sekcji)';
  return language === 'en' ? color.en : color.pl;
}
