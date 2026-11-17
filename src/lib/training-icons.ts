export const TRAINING_ICONS = [
  'swords',
  'shield',
  'target',
  'fitness',
  'star',
] as const;
export type TrainingIcon = (typeof TRAINING_ICONS)[number];
export const TRAINING_ICON_IMAGES: Record<TrainingIcon, string> = {
  swords: 'icons/trainings/miecz-dlugi.webp',
  shield: 'icons/trainings/miecz-i-puklerz.webp',
  target: 'icons/trainings/szabla.webp',
  fitness: 'icons/trainings/wf.webp',
  star: 'icons/trainings/sekcja-dzieci.webp',
};
export function trainingIcon(value: unknown): TrainingIcon | null {
  return typeof value === 'string' &&
    (TRAINING_ICONS as readonly string[]).includes(value)
    ? (value as TrainingIcon)
    : null;
}
export function trainingIconLabel(
  value: unknown,
  language: 'pl' | 'en',
): string {
  const icon = trainingIcon(value);
  const labels = {
    swords: language === 'en' ? 'Longsword' : 'Miecz długi',
    shield: language === 'en' ? 'Sword and buckler' : 'Miecz i puklerz',
    target: language === 'en' ? 'Sabre' : 'Szabla',
    fitness: language === 'en' ? 'Physical training' : 'WF',
    star: language === 'en' ? 'Children’s section' : 'Sekcja dzieci',
  };
  return icon ? labels[icon] : language === 'en' ? 'Training' : 'Trening';
}
