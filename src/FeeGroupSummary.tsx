import type { ClubSettings, ProfileParticipant } from './types/club';
import { feeGroup, feeGroupName, groupFee } from './domain/profile';

export default function FeeGroupSummary({
  person,
  settings,
  language,
}: {
  person: Pick<ProfileParticipant, 'tier' | 'level' | 'azs_paid'>;
  settings: ClubSettings | null;
  language: 'pl' | 'en';
}) {
  const group = feeGroup(person);
  const fee = groupFee(settings, group);
  return (
    <p className="fee-group-summary">
      <strong>{language === 'en' ? 'Fee group' : 'Grupa składki'}:</strong>{' '}
      {feeGroupName(group, language)}
      {fee !== null && ` · ${fee} zł`}
    </p>
  );
}
