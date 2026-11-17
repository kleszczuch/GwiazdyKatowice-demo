import type {
  ClothingSizeKey,
  Participant,
  ProfileParticipant,
} from './types/club';
import { profileEquipmentCatalog } from './equipmentIcons';

export default function ParticipantEquipmentSummary({
  person,
  language,
}: {
  person: Participant;
  language: 'pl' | 'en';
}) {
  const profile = person as Partial<ProfileParticipant>;
  const en = language === 'en';
  const labels = {
    own: en ? 'Own equipment' : 'Własny sprzęt',
    club: en
      ? 'Does not have it — needs club equipment'
      : 'Nie ma — potrzebuje klubowego',
    none: en ? 'Does not have it' : 'Nie ma',
    unknown: en ? 'Not provided' : 'Nie podano',
  };
  return (
    <section
      className="participant-equipment"
      aria-label={en ? 'Equipment and sizes' : 'Sprzęt i rozmiary'}
    >
      <h3>{en ? 'Equipment and sizes' : 'Sprzęt i rozmiary'}</h3>
      {typeof profile.full_gear === 'boolean' && (
        <p>
          Full Gear:{' '}
          <strong>
            {profile.full_gear ? (en ? 'Yes' : 'Tak') : en ? 'No' : 'Nie'}
          </strong>
        </p>
      )}
      <dl className="participant-equipment__grid">
        {profileEquipmentCatalog.map((catalog) => {
          const entry = profile.equipment?.find(
            (item) => item.item === catalog.item,
          );
          const size =
            profile.clothing_sizes?.[catalog.item as ClothingSizeKey] ||
            entry?.size;
          return (
            <div className="participant-equipment__item" key={catalog.item}>
              <dt>{en ? catalog.en : catalog.pl}</dt>
              <dd>{labels[entry?.ownership ?? 'unknown']}</dd>
              {catalog.sizes.length > 0 && (
                <dd>
                  {en ? 'Size' : 'Rozmiar'}:{' '}
                  {size || (en ? 'Not provided' : 'Nie podano')}
                </dd>
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
