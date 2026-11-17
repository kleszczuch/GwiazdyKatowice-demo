const clothingSizes = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const regularSizes = ['S', 'M', 'L', 'XL'];
const gloveSizes = ['XS', 'S', 'M', 'L', 'XL'];

export const profileEquipmentCatalog = [
  {
    item: 'jacket',
    pl: 'Kurtka',
    en: 'Jacket',
    sizes: clothingSizes,
  },
  { item: 'mask', pl: 'Maska', en: 'Mask', sizes: regularSizes },
  {
    item: 'pants',
    pl: 'Spodnie',
    en: 'Pants',
    sizes: clothingSizes,
  },
  {
    item: 'gloves',
    pl: 'Rękawice miękkie',
    en: 'Soft gloves',
    sizes: gloveSizes,
  },
  {
    item: 'gloves_heavy',
    pl: 'Rękawice twarde',
    en: 'Hard gloves',
    sizes: gloveSizes,
  },
  {
    item: 'forearm',
    pl: 'Karwasze',
    en: 'Forearm protectors',
    sizes: [],
  },
  {
    item: 'knee',
    pl: 'Nakolanniki',
    en: 'Knee protectors',
    sizes: [],
  },
  {
    item: 'groin',
    pl: 'Suspensor',
    en: 'Groin protector',
    sizes: [],
  },
  {
    item: 'overlay',
    pl: 'Nakładka',
    en: 'Overlay',
    sizes: regularSizes,
  },
  {
    item: 'gorget',
    pl: 'Ryngraf',
    en: 'Gorget',
    sizes: [],
  },
  { item: 'sabre', pl: 'Szabla', en: 'Sabre', sizes: [] },
  {
    item: 'sword_buckler',
    pl: 'Miecz i puklerz',
    en: 'Sword and buckler',
    sizes: [],
  },
  {
    item: 'longsword',
    pl: 'Miecz długi',
    en: 'Longsword',
    sizes: [],
  },
] as const;

export type EquipmentCatalogItem =
  (typeof profileEquipmentCatalog)[number]['item'];

export const EQUIPMENT_ITEMS: readonly EquipmentCatalogItem[] =
  profileEquipmentCatalog.map((entry) => entry.item);

export function equipmentLabel(item: string, language: 'pl' | 'en') {
  const entry = profileEquipmentCatalog.find((value) => value.item === item);
  return entry ? (language === 'en' ? entry.en : entry.pl) : item;
}
