import type { ParticipantEquipmentEntry } from '../types/club';

// Full Gear = deklaracja wszystkich 13 pozycji katalogu, własne wszystkie
// ochraniacze, co najmniej jedne własne rękawice (miękkie lub twarde)
// i co najmniej jedna własna broń.
export function hasFullGear(
  equipment: readonly ParticipantEquipmentEntry[],
): boolean {
  if (
    equipment.length !== 13 ||
    new Set(equipment.map((entry) => entry.item)).size !== 13
  )
    return false;
  const protectiveItems = [
    'jacket',
    'mask',
    'pants',
    'forearm',
    'knee',
    'groin',
    'overlay',
    'gorget',
  ];
  const weapons = ['sabre', 'sword_buckler', 'longsword'];
  return (
    protectiveItems.every((item) =>
      equipment.some(
        (entry) => entry.item === item && entry.ownership === 'own',
      ),
    ) &&
    ['gloves', 'gloves_heavy'].some((item) =>
      equipment.some(
        (entry) => entry.item === item && entry.ownership === 'own',
      ),
    ) &&
    weapons.some((item) =>
      equipment.some(
        (entry) => entry.item === item && entry.ownership === 'own',
      ),
    )
  );
}
