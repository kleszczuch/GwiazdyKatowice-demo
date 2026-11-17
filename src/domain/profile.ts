export const calculateMonthlyContribution = (
  monthlyFee: number | null,
  fulgirDiscount: number | null,
  fullGear: boolean,
  isCoach = false,
): number | null => {
  if (isCoach) return 0;
  if (
    monthlyFee === null ||
    fulgirDiscount === null ||
    !Number.isFinite(monthlyFee) ||
    !Number.isFinite(fulgirDiscount)
  )
    return null;
  return Math.max(0, monthlyFee - (fullGear ? fulgirDiscount : 0));
};

export type BeginnerMembership = 'azs' | 'association';
type FeeGroupInput = {
  tier: 'adult-beginner' | 'adult-advanced' | 'child';
  level: 'beginner' | 'advanced' | 'coach';
  azs_paid: boolean;
  beginner_membership?: BeginnerMembership;
};
type FeeSettings = {
  monthly_fee: number;
  fulgir_discount: number;
  fee_youth?: number;
  fee_beginner_azs?: number;
};
export type FeeGroupKey =
  'steel' | 'beginner_association' | 'youth' | 'beginner_azs';

// Grupa składki: dziecko → Młodzież; zaawansowany lub trener → Stal;
// dorosły początkujący → AZS albo Stowarzyszenie. Gdy baza nie ma jeszcze
// pola beginner_membership, przypisanie wynika z flagi AZS.
export const feeGroup = (person: FeeGroupInput): FeeGroupKey =>
  person.tier === 'child'
    ? 'youth'
    : person.level === 'advanced' || person.level === 'coach'
      ? 'steel'
      : (person.beginner_membership ??
            (person.azs_paid ? 'azs' : 'association')) === 'azs'
        ? 'beginner_azs'
        : 'beginner_association';

// Stowarzyszenie i Młodzież mają wspólną kwotę (fee_youth). Brak kwoty
// grupy w starszej bazie oznacza składkę Stali.
export const groupFee = (
  settings: FeeSettings | null,
  group: FeeGroupKey,
): number | null => {
  if (!settings) return null;
  const value =
    group === 'steel'
      ? settings.monthly_fee
      : ((group === 'beginner_azs'
          ? settings.fee_beginner_azs
          : settings.fee_youth) ?? settings.monthly_fee);
  return Number.isFinite(value) ? value : null;
};

export const groupHasFullGearDiscount = (group: FeeGroupKey) =>
  group !== 'beginner_association';

export const calculateGroupContribution = (
  settings: FeeSettings | null,
  person: FeeGroupInput,
  fullGear: boolean,
  isCoach = false,
): number | null => {
  const group = feeGroup(person);
  return calculateMonthlyContribution(
    groupFee(settings, group),
    settings?.fulgir_discount ?? null,
    fullGear && groupHasFullGearDiscount(group),
    isCoach,
  );
};

export const feeGroupName = (group: FeeGroupKey, language: 'pl' | 'en') =>
  ({
    steel: language === 'en' ? 'Steel' : 'Stal',
    beginner_association:
      language === 'en'
        ? 'Beginners (Association)'
        : 'Początkujący Stowarzyszenie',
    youth: language === 'en' ? 'Youth' : 'Młodzież',
    beginner_azs: language === 'en' ? 'Beginners (AZS)' : 'Początkujący AZS',
  })[group];
