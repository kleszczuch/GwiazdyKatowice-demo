import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Camera, Check, Swords } from './placeholderIcons';
import ProfileDisclosure from './ProfileDisclosure';
import type {
  ClothingSizes,
  ClothingSizeKey,
  ClubSettings,
  ParticipantEquipmentEntry,
  ParticipantSection,
  ProfileParticipant,
  Section,
} from './types/club';
import { assetUrl } from './lib/asset-url';
import { resolveProfilePhoto } from './lib/profile-photo';
import { ParticipantArrearsSummary } from './ParticipantArrearsPanel';
import MyPhotosPanel, {
  listProfilePhotos,
  MAX_PROFILE_PHOTOS,
} from './MyPhotosPanel';
import { equipmentIcons, profileEquipmentCatalog } from './equipmentIcons';
import EquipmentChoice from './EquipmentChoice';
import './profile-equipment.css';
import { hasFullGear } from './domain/equipment';
import {
  calculateGroupContribution,
  feeGroup,
  feeGroupName,
  groupHasFullGearDiscount,
} from './domain/profile';

type Language = 'pl' | 'en';
const PROTECTIVE_SLOTS = 9;
const REQUIRED_SIZE_ITEMS = ['jacket', 'mask', 'pants', 'gloves', 'overlay'];
const GLOVE_ITEMS = ['gloves', 'gloves_heavy'];
const WEAPON_ITEMS = ['sabre', 'sword_buckler', 'longsword'];
const isWeapon = (item: string) =>
  (WEAPON_ITEMS as readonly string[]).includes(item);
const isGlove = (item: string) =>
  (GLOVE_ITEMS as readonly string[]).includes(item);
// Zamienia wybór w formularzu na wpis deklaracji. Bez własnego egzemplarza
// pozycja jest „z klubu”, o ile nie wymaga rozmiaru albo rozmiar podano;
// w przeciwnym razie „brak”. Suspensora klub nie wypożycza.
const declaredEquipment = (
  item: ParticipantEquipmentEntry['item'],
  owns: boolean,
  size: string | null,
): ParticipantEquipmentEntry => {
  if (owns) return { item, ownership: 'own', size };
  const sized = profileEquipmentCatalog.some(
    (entry) => entry.item === item && entry.sizes.length > 0,
  );
  return item !== 'groin' && (!sized || size)
    ? { item, ownership: 'club', size }
    : { item, ownership: 'none', size: null };
};
interface Props {
  client: SupabaseClient;
  session: Session;
  guardianMode?: boolean;
  participants: ProfileParticipant[];
  sections: Section[];
  assignments: ParticipantSection[];
  settings?: ClubSettings | null;
  coachParticipantIds?: string[];
  language: Language;
  onAvatarChanged?: (url: string) => void;
  personalDetailsContent?: ReactNode;
  onChanged: () => void | Promise<void>;
  participantReadVersion: number;
  getReadVersion: () => number;
}
export default function ProfilePanel({
  client,
  session,
  guardianMode = false,
  participants,
  sections,
  assignments,
  settings = null,
  coachParticipantIds = [],
  language,
  onAvatarChanged,
  personalDetailsContent,
  onChanged,
  participantReadVersion,
  getReadVersion,
}: Props) {
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const googlePhoto = guardianMode
    ? ''
    : String(
        session.user.user_metadata.avatar_url ??
          session.user.user_metadata.picture ??
          '',
      );
  const en = language === 'en';
  useEffect(() => {
    let active = true;
    void (async () => {
      const preferences = await client
        .from('account_preferences')
        .select('avatar_path')
        .eq('account_id', session.user.id)
        .maybeSingle();
      if (!active) return;
      if (preferences.data) {
        const row = preferences.data as { avatar_path?: string | null };
        setAvatarPath(row.avatar_path ?? null);
        if (row.avatar_path) {
          const photo = await resolveProfilePhoto(
            client,
            session.user.id,
            row.avatar_path,
          );
          if (active) {
            setAvatarUrl(photo.url);
            if (photo.missing) setAvatarPath(null);
            onAvatarChanged?.(photo.url);
          }
        }
      }
    })().catch(() => {
      if (active)
        setMessage(
          en
            ? 'Profile data could not be loaded.'
            : 'Nie udało się wczytać profilu.',
        );
    });
    return () => {
      active = false;
    };
  }, [client, en, onAvatarChanged, session.user.id]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setMessage(
        en
          ? 'Choose a JPG, PNG, or WebP image smaller than 5 MB.'
          : 'Wybierz zdjęcie JPG, PNG lub WebP mniejsze niż 5 MB.',
      );
      return;
    }
    setBusy(true);
    setMessage('');
    const existing = await listProfilePhotos(client, session.user.id);
    if (existing && existing.length >= MAX_PROFILE_PHOTOS) {
      setMessage(
        en
          ? `You already have ${MAX_PROFILE_PHOTOS} photos. Delete unneeded ones in My photos to add a new one.`
          : `Masz już ${MAX_PROFILE_PHOTOS} zdjęć. Usuń niepotrzebne w „Moje zdjęcia”, aby dodać nowe.`,
      );
      setBusy(false);
      return;
    }
    const extension =
      file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
    const nextPath = `${session.user.id}/${crypto.randomUUID()}.${extension}`;
    try {
      const { error: uploadError } = await client.storage
        .from('profile-photos')
        .upload(nextPath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: saveError } = await client
        .from('account_preferences')
        .upsert(
          { account_id: session.user.id, avatar_path: nextPath },
          { onConflict: 'account_id' },
        );
      if (saveError) throw saveError;
      const photo = await resolveProfilePhoto(
        client,
        session.user.id,
        nextPath,
      );
      setAvatarPath(nextPath);
      setAvatarUrl(photo.url);
      onAvatarChanged?.(photo.url);
      setMessage(
        en ? 'Profile photo updated.' : 'Zaktualizowano zdjęcie profilowe.',
      );
    } catch {
      setMessage(
        en
          ? 'Could not save the photo. Check the connection and try again.'
          : 'Nie udało się zapisać zdjęcia. Sprawdź połączenie i spróbuj ponownie.',
      );
    } finally {
      setBusy(false);
    }
  };

  const saveAvatarPath = async (path: string | null, url: string) => {
    try {
      const { error } = await client
        .from('account_preferences')
        .upsert(
          { account_id: session.user.id, avatar_path: path },
          { onConflict: 'account_id' },
        );
      if (error) return false;
      setAvatarPath(path);
      setAvatarUrl(url);
      onAvatarChanged?.(url);
      return true;
    } catch {
      return false;
    }
  };

  const removeCustomPhoto = async () => {
    if (!avatarPath || busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (!(await saveAvatarPath(null, '')))
        throw new Error('Could not clear the photo');
      setMessage(
        googlePhoto
          ? en
            ? 'Google photo restored. Your photo stays in My photos.'
            : 'Przywrócono zdjęcie z Google. Twoje zdjęcie zostaje w „Moje zdjęcia”.'
          : en
            ? 'Photo removed from the profile. It stays in My photos.'
            : 'Zdjęcie zdjęte z profilu. Zostaje w „Moje zdjęcia”.',
      );
    } catch {
      setMessage(
        en
          ? 'Could not change the photo. Check the connection and try again.'
          : 'Nie udało się zmienić zdjęcia. Sprawdź połączenie i spróbuj ponownie.',
      );
    } finally {
      setBusy(false);
    }
  };

  const photoContent = (
    <section className="profile-overview__photo">
      <h3 className="profile-overview__heading">
        <Camera size={18} />
        {en ? 'Profile photo' : 'Zdjęcie profilowe'}
      </h3>
      <div className="profile-photo-row">
        <img
          className="profile-photo"
          src={avatarUrl || googlePhoto || assetUrl('logo.webp')}
          alt={en ? 'Profile photo' : 'Zdjęcie profilowe'}
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.src = assetUrl('logo.webp');
          }}
        />
        <div>
          <strong>
            {participants[0]?.name ??
              session.user.user_metadata.full_name ??
              session.user.email}
          </strong>
          <span>
            {guardianMode
              ? en
                ? 'Add a photo of the child if you wish.'
                : 'Możesz dodać zdjęcie dziecka.'
              : en
                ? 'Google photo is used by default. You can add a personal photo.'
                : 'Domyślnie używane jest zdjęcie z Google. Możesz dodać własne.'}
          </span>
          <div className="profile-photo-actions">
            <label className="button secondary small profile-upload">
              <Camera size={15} />
              {avatarPath
                ? en
                  ? 'Change photo'
                  : 'Zmień zdjęcie'
                : en
                  ? 'Add your photo'
                  : 'Dodaj własne zdjęcie'}
              <input
                aria-label={
                  en ? 'Upload a profile photo' : 'Dodaj zdjęcie profilowe'
                }
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(event) => {
                  void upload(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
            </label>
            {avatarPath && (
              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                onClick={() => void removeCustomPhoto()}
              >
                {googlePhoto
                  ? en
                    ? 'Use Google photo'
                    : 'Wróć do zdjęcia z Google'
                  : en
                    ? 'Use default photo'
                    : 'Użyj domyślnego zdjęcia'}
              </button>
            )}
            <MyPhotosPanel
              client={client}
              accountId={session.user.id}
              currentPath={avatarPath}
              language={language}
              disabled={busy}
              onUse={(path, url) => saveAvatarPath(path, url)}
              onCurrentRemoved={() => saveAvatarPath(null, '')}
            />
          </div>
          {personalDetailsContent}
        </div>
      </div>
    </section>
  );
  return (
    <>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {participants.length === 0 && (
        <section className="panel profile-overview">{photoContent}</section>
      )}
      {participants.map((person, index) => (
        <ParticipantProfile
          key={person.id}
          person={person}
          photoContent={index === 0 ? photoContent : undefined}
          sectionNames={sections
            .filter((section) =>
              assignments.some(
                (assignment) =>
                  assignment.participant_id === person.id &&
                  assignment.section_id === section.id,
              ),
            )
            .map((section) => section.name)}
          client={client}
          language={language}
          settings={settings}
          isCoach={coachParticipantIds.includes(person.id)}
          onChanged={onChanged}
          participantReadVersion={participantReadVersion}
          getReadVersion={getReadVersion}
        />
      ))}
    </>
  );
}

function ParticipantProfile({
  person,
  photoContent,
  sectionNames,
  client,
  language,
  settings,
  isCoach,
  onChanged,
  participantReadVersion,
  getReadVersion,
}: {
  person: ProfileParticipant;
  photoContent?: ReactNode;
  sectionNames: string[];
  client: SupabaseClient;
  language: Language;
  settings: ClubSettings | null;
  isCoach: boolean;
  onChanged: () => void | Promise<void>;
  participantReadVersion: number;
  getReadVersion: () => number;
}) {
  const en = language === 'en';
  const normalize = (
    values: ParticipantEquipmentEntry[],
  ): ParticipantEquipmentEntry[] =>
    profileEquipmentCatalog.map((entry) => {
      const saved = values.find((item) => item.item === entry.item);
      const candidate =
        person.clothing_sizes?.[entry.item as ClothingSizeKey] ?? saved?.size;
      const size = entry.sizes.some((allowed) => allowed === candidate)
        ? (candidate ?? null)
        : null;
      return declaredEquipment(entry.item, saved?.ownership === 'own', size);
    });
  const normalizeSizes = (): ClothingSizes =>
    Object.fromEntries(
      profileEquipmentCatalog.flatMap((entry) => {
        if (!entry.sizes.length) return [];
        const key = entry.item as ClothingSizeKey;
        const size =
          person.clothing_sizes?.[key] ??
          person.equipment.find((item) => item.item === entry.item)?.size;
        return size && entry.sizes.some((allowed) => allowed === size)
          ? [[key, size]]
          : [];
      }),
    );
  const serverEquipment = JSON.stringify(person.equipment);
  const serverClothingSizes = JSON.stringify(person.clothing_sizes ?? {});
  // Wersja robocza zgodna z danymi z serwera, bez lokalnych zmian.
  const serverDraft = () => ({
    equipment: normalize(person.equipment),
    clothingSizes: normalizeSizes(),
    clothingBaseline: serverClothingSizes,
    baseline: serverEquipment,
    dirty: false,
    rejected: false,
    fullGear: person.full_gear,
    pending: null,
  });
  const [draft, setDraft] = useState(() => ({
    equipment: normalize(person.equipment),
    clothingSizes: normalizeSizes(),
    clothingBaseline: serverClothingSizes,
    baseline: serverEquipment,
    dirty: false,
    rejected: false,
    fullGear: person.full_gear,
    pending: null as {
      afterReadVersion: number;
    } | null,
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // Uzgadnianie wersji roboczej z serwerem, wykonywane podczas renderu:
  // - po zapisie czekamy (pending), aż rodzic dostarczy odczyt nowszy niż
  //   chwila zapisu; dopiero wtedy formularz przechodzi na dane z serwera,
  // - bez lokalnych zmian formularz po prostu podąża za serwerem,
  // - lokalne zmiany przy zmienionych danych serwera to konflikt (niżej):
  //   szkic zostaje, a zapis jest zablokowany do wczytania aktualnej wersji.
  const savedSnapshotConfirmed =
    draft.pending && participantReadVersion > draft.pending.afterReadVersion;
  if (savedSnapshotConfirmed) {
    setDraft(serverDraft());
    setMessage(
      en
        ? 'Equipment saved. Profile data refreshed.'
        : 'Sprzęt zapisany. Dane profilu odświeżone.',
    );
  } else if (
    !draft.dirty &&
    !draft.pending &&
    (draft.baseline !== serverEquipment ||
      draft.clothingBaseline !== serverClothingSizes)
  ) {
    setDraft(serverDraft());
  }
  const { equipment, clothingSizes, dirty } = draft;
  const fullGear = dirty || draft.pending ? draft.fullGear : person.full_gear;
  const conflict =
    draft.rejected ||
    (dirty &&
      (draft.baseline !== serverEquipment ||
        draft.clothingBaseline !== serverClothingSizes));
  const protectiveRows = profileEquipmentCatalog.filter(
    (entry) => !isWeapon(entry.item),
  ).length;
  const ownGloves = equipment.some(
    (entry) => isGlove(entry.item) && entry.ownership === 'own',
  );
  const ownProtective =
    equipment.filter(
      (entry) =>
        !isWeapon(entry.item) &&
        !isGlove(entry.item) &&
        entry.ownership === 'own',
    ).length + (ownGloves ? 1 : 0);
  const ownWeapon = equipment.some(
    (entry) => isWeapon(entry.item) && entry.ownership === 'own',
  );
  // Rękawice miękkie i twarde liczą się razem jako jedna pozycja ochronna.
  const draftFullGear = ownProtective === PROTECTIVE_SLOTS && ownWeapon;
  const missingForFullGear = [
    ...profileEquipmentCatalog
      .filter(
        (entry, index) =>
          !isWeapon(entry.item) &&
          !isGlove(entry.item) &&
          equipment[index].ownership !== 'own',
      )
      .map((entry) => (en ? entry.en : entry.pl).toLowerCase()),
    ...(ownGloves
      ? []
      : [en ? 'gloves (soft or hard)' : 'rękawice (miękkie lub twarde)']),
    ...(ownWeapon ? [] : [en ? 'a weapon of your own' : 'własna broń']),
  ];
  const levelName = {
    beginner: en ? 'Beginner' : 'Początkujący',
    advanced: en ? 'Advanced' : 'Zaawansowany',
    coach: en ? 'Coach' : 'Trener',
  }[person.level];
  const group = feeGroup(person);
  const monthlyFee = calculateGroupContribution(
    settings,
    person,
    fullGear,
    isCoach,
  );

  const updateEquipment = (
    index: number,
    patch: Partial<ParticipantEquipmentEntry>,
  ) => {
    if (busy || draft.pending) return;
    setDraft((current) => {
      const item = current.equipment[index].item;
      const isClothing = profileEquipmentCatalog[index].sizes.length > 0;
      const nextClothing = { ...current.clothingSizes };
      if (isClothing && 'size' in patch) {
        if (patch.size) nextClothing[item as ClothingSizeKey] = patch.size;
        else delete nextClothing[item as ClothingSizeKey];
      }
      return {
        ...current,
        dirty: true,
        clothingSizes: nextClothing,
        equipment: current.equipment.map((entry, entryIndex) => {
          if (entryIndex !== index) return entry;
          const owns =
            'ownership' in patch
              ? patch.ownership === 'own'
              : entry.ownership === 'own';
          return declaredEquipment(
            item,
            owns,
            isClothing ? (nextClothing[item as ClothingSizeKey] ?? null) : null,
          );
        }),
      };
    });
    setMessage('');
  };
  const markProtectiveOwn = () => {
    if (busy || draft.pending) return;
    setDraft((current) => ({
      ...current,
      dirty: true,
      equipment: current.equipment.map((entry, entryIndex) => {
        if (isWeapon(entry.item)) return entry;
        if (
          // „Mam cały sprzęt ochronny” zaznacza rękawice miękkie tylko wtedy, gdy
          // żadne rękawice nie są jeszcze własne; twardych nie zaznacza nigdy.
          isGlove(entry.item) &&
          (entry.item !== 'gloves' ||
            current.equipment.some(
              (other) => isGlove(other.item) && other.ownership === 'own',
            ))
        )
          return entry;
        const sized = profileEquipmentCatalog[entryIndex].sizes.length > 0;
        return {
          ...entry,
          ownership: 'own',
          size: sized
            ? (current.clothingSizes[entry.item as ClothingSizeKey] ?? null)
            : entry.size,
        };
      }),
    }));
    setMessage('');
  };
  const saveEquipment = async () => {
    if (busy || conflict || draft.pending) return;
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await client.rpc(
        // Zapis warunkowy: baza przyjmuje zmianę tylko wtedy, gdy jej dane nadal
        // odpowiadają wersji, od której zaczęto edycję. false oznacza konflikt.
        'save_participant_profile_equipment_if_current',
        {
          p_participant_id: person.id,
          p_equipment: equipment,
          p_clothing_sizes: clothingSizes,
          p_expected_clothing_sizes: JSON.parse(draft.clothingBaseline),
          p_expected_equipment: JSON.parse(draft.baseline),
        },
      );
      if (error || typeof data !== 'boolean')
        throw error ?? new Error('Invalid equipment response');
      if (!data) {
        setDraft((current) => ({ ...current, rejected: true }));
        await onChanged();
        return;
      }
      // Zapamiętujemy numer ostatniego odczytu; stan z serwera uznamy za
      // potwierdzony dopiero po odczycie o wyższym numerze.
      const afterReadVersion = getReadVersion();
      setDraft((current) => ({
        ...current,
        dirty: false,
        baseline: JSON.stringify(current.equipment),
        clothingBaseline: JSON.stringify(current.clothingSizes),
        fullGear: hasFullGear(current.equipment),
        pending: {
          afterReadVersion,
        },
      }));
      setMessage(
        en
          ? 'Equipment saved. Your monthly fee is up to date.'
          : 'Sprzęt zapisany. Kwota składki jest aktualna.',
      );
      try {
        await onChanged();
      } catch {
        setMessage(
          en
            ? 'Equipment saved. Reopen your profile to refresh the remaining data.'
            : 'Sprzęt zapisany. Otwórz profil ponownie, aby odświeżyć pozostałe dane.',
        );
      }
    } catch (error) {
      setMessage(
        (error as { hint?: string } | null)?.hint === 'equipment_unavailable'
          ? en
            ? 'You are signed up for a training where every club piece of this equipment is already reserved. Cancel that signup or keep your own equipment.'
            : 'Jesteś zapisany na trening, na którym wszystkie klubowe sztuki tego sprzętu są już zarezerwowane. Anuluj ten zapis albo zostaw własny sprzęt.'
          : en
            ? 'Could not save equipment. Check the sizes and try again.'
            : 'Nie udało się zapisać sprzętu. Sprawdź rozmiary i spróbuj ponownie.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="panel athlete-profile profile-overview">
        {photoContent}
        <section className="profile-overview__club">
          <dl className="athlete-profile__summary">
            <div>
              <dt>Full Gear</dt>
              <dd>
                <span
                  className={`full-gear-check ${fullGear ? 'is-checked' : ''}`}
                  role="img"
                  aria-label={
                    fullGear
                      ? en
                        ? 'Full Gear: yes'
                        : 'Full Gear: tak'
                      : en
                        ? 'Full Gear: no'
                        : 'Full Gear: nie'
                  }
                >
                  <span className="full-gear-check__box" aria-hidden="true">
                    {fullGear && <Check size={14} strokeWidth={3} />}
                  </span>
                  <span aria-hidden="true">
                    {fullGear ? (en ? 'Yes' : 'Tak') : en ? 'No' : 'Nie'}
                  </span>
                </span>
              </dd>
            </div>
            <div>
              <dt>{en ? 'Sections' : 'Sekcje'}</dt>
              <dd>
                {sectionNames.length
                  ? sectionNames.join(', ')
                  : en
                    ? 'No section assigned'
                    : 'Brak przypisanej sekcji'}
              </dd>
            </div>
            <div>
              <dt>{en ? 'Level' : 'Poziom'}</dt>
              <dd>{levelName}</dd>
            </div>
          </dl>
          <table className="profile-fees">
            <caption>{en ? 'Fees' : 'Opłaty'}</caption>
            <tbody>
              <tr>
                <th scope="row">{en ? 'Fee group' : 'Grupa składki'}</th>
                <td>{feeGroupName(group, language)}</td>
              </tr>
              <tr>
                <th scope="row">
                  {en ? 'Monthly membership fee' : 'Składka miesięczna'}
                </th>
                <td>
                  {monthlyFee === null ? (
                    en ? (
                      'Club fee is not configured yet'
                    ) : (
                      'Składka klubu nie jest jeszcze ustawiona'
                    )
                  ) : (
                    <>
                      <strong>
                        {new Intl.NumberFormat(en ? 'en-GB' : 'pl-PL', {
                          style: 'currency',
                          currency: 'PLN',
                          maximumFractionDigits: 0,
                        }).format(monthlyFee)}
                      </strong>
                      {isCoach ? (
                        <small className="profile-fees__note">
                          {en
                            ? 'Coaches do not pay the monthly fee.'
                            : 'Trenerzy nie płacą składki miesięcznej.'}
                        </small>
                      ) : (
                        fullGear &&
                        settings &&
                        groupHasFullGearDiscount(group) && (
                          <small className="profile-fees__note">
                            {en ? 'Full Gear discount: ' : 'Zniżka Full Gear: '}
                            {settings.fulgir_discount} zł
                          </small>
                        )
                      )}
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <th scope="row">AZS</th>
                <td>
                  <span
                    className={`badge ${person.tier === 'child' ? '' : person.azs_paid ? 'azs-confirmed' : 'azs-unconfirmed'}`}
                  >
                    {person.tier === 'child'
                      ? en
                        ? 'Not applicable'
                        : 'Nie dotyczy'
                      : person.azs_paid
                        ? en
                          ? 'Paid'
                          : 'Opłacone'
                        : en
                          ? 'Not paid'
                          : 'Nieopłacone'}
                  </span>
                </td>
              </tr>
              <tr>
                <th scope="row">
                  {en ? 'Membership arrears' : 'Zaległości w składkach'}
                </th>
                <td>
                  <ParticipantArrearsSummary
                    client={client}
                    participantId={person.id}
                    language={language}
                    readVersion={participantReadVersion}
                    bare
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
      <ProfileDisclosure
        title={
          <>
            <Swords size={18} />
            {en ? 'Equipment' : 'Sprzęt'} · {person.name}
          </>
        }
      >
        <p className="muted">
          {en
            ? 'Mark what you own, what you borrow from the club and your sizes. Full Gear needs your own protective gear (either pair of gloves is enough) and at least one weapon of your own.'
            : 'Zaznacz, co masz własne, co pożyczasz z klubu i jakie nosisz rozmiary. Full Gear wymaga własnej ochrony (wystarczy jedna para rękawic) i przynajmniej jednej własnej broni.'}
        </p>
        {(person.level === 'advanced' || person.clothing_sizes_requested) && (
          <p className="muted">
            {en
              ? 'Choose all five clothing sizes, including equipment you do not own or use.'
              : 'Wybierz wszystkie pięć rozmiarów stroju, także dla sprzętu, którego nie masz lub nie używasz.'}
          </p>
        )}
        <div
          className={`equipment-progress${draftFullGear ? ' is-complete' : ''}`}
        >
          <div className="equipment-progress__head">
            <strong>Full Gear</strong>
            <span>
              {en
                ? `${ownProtective} of ${PROTECTIVE_SLOTS} protective items · ${ownWeapon ? 'own weapon ✓' : 'no own weapon yet'}`
                : `${ownProtective} z ${PROTECTIVE_SLOTS} elementów ochrony · ${ownWeapon ? 'własna broń ✓' : 'brak własnej broni'}`}
            </span>
          </div>
          <div className="equipment-progress__bar" aria-hidden="true">
            <span
              style={{
                width: `${Math.round(((ownProtective + (ownWeapon ? 1 : 0)) / (PROTECTIVE_SLOTS + 1)) * 100)}%`,
              }}
            />
          </div>
          <p className="equipment-progress__missing">
            {draftFullGear
              ? en
                ? 'You have the full set.'
                : 'Masz komplet.'
              : `${en ? 'Still missing: ' : 'Brakuje: '}${missingForFullGear.join(', ')}`}
          </p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveEquipment();
          }}
        >
          <fieldset
            className="athlete-equipment"
            disabled={busy || Boolean(draft.pending)}
          >
            <legend className="athlete-equipment__legend">
              {en
                ? 'Equipment ownership and sizes'
                : 'Posiadanie sprzętu i rozmiary'}
            </legend>
            {[
              {
                key: 'protective',
                title: en ? 'Protective gear' : 'Ochrona',
                from: 0,
                to: protectiveRows,
              },
              {
                key: 'weapons',
                title: en ? 'Weapons' : 'Broń',
                from: protectiveRows,
                to: profileEquipmentCatalog.length,
              },
            ].map((group) => (
              <section className="equipment-group" key={group.key}>
                <header className="equipment-group__head">
                  <h4>{group.title}</h4>
                  {group.key === 'protective' &&
                    ownProtective < PROTECTIVE_SLOTS && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={markProtectiveOwn}
                      >
                        {en
                          ? 'I own all protective gear'
                          : 'Mam całą ochronę własną'}
                      </button>
                    )}
                </header>
                {profileEquipmentCatalog
                  .slice(group.from, group.to)
                  .map((entry, offset) => {
                    const index = group.from + offset;
                    const Icon = equipmentIcons[entry.item];
                    const value = equipment[index];
                    const itemName = en ? entry.en : entry.pl;
                    const needsSize =
                      entry.sizes.length > 0 &&
                      (value.ownership === 'own' ||
                        ((REQUIRED_SIZE_ITEMS as readonly string[]).includes(
                          entry.item,
                        ) &&
                          (person.level === 'advanced' ||
                            person.clothing_sizes_requested === true)));
                    const size =
                      clothingSizes[entry.item as ClothingSizeKey] ??
                      value.size ??
                      '';
                    return (
                      <div
                        className={`equipment-row is-${value.ownership}`}
                        key={entry.item}
                      >
                        <div className="equipment-row__name">
                          <Icon />
                          <span>
                            <strong>{itemName}</strong>
                            {entry.item === 'groin' && (
                              <small>
                                {en
                                  ? 'Must be your own — the club does not lend it.'
                                  : 'Tylko własny — klub go nie wypożycza.'}
                              </small>
                            )}
                            {needsSize && !size && (
                              <small className="equipment-row__warning">
                                {en ? 'Choose a size' : 'Wybierz rozmiar'}
                              </small>
                            )}
                            {!needsSize &&
                              !size &&
                              entry.sizes.length > 0 &&
                              value.ownership !== 'own' && (
                                <small>
                                  {en
                                    ? 'Choose a size if you need club equipment.'
                                    : 'Wybierz rozmiar, jeśli potrzebujesz sprzętu klubowego.'}
                                </small>
                              )}
                          </span>
                        </div>
                        <div className="equipment-row__controls">
                          <EquipmentChoice
                            name={`${person.id}-${entry.item}-ownership`}
                            legend={
                              en
                                ? `${itemName}: ownership`
                                : `${itemName}: posiadanie`
                            }
                            variant="ownership"
                            value={value.ownership === 'own' ? 'own' : 'none'}
                            options={[
                              {
                                value: 'own',
                                label: en ? 'I have my own' : 'Mam własny',
                              },
                              {
                                value: 'none',
                                label: en ? "I don't have it" : 'Nie mam',
                              },
                            ]}
                            onChange={(ownership: string) =>
                              updateEquipment(index, {
                                ownership: ownership === 'own' ? 'own' : 'none',
                              })
                            }
                          />
                          {entry.sizes.length > 0 && (
                            <EquipmentChoice
                              name={`${person.id}-${entry.item}-size`}
                              legend={
                                en
                                  ? `${itemName}: size`
                                  : `${itemName}: rozmiar`
                              }
                              variant="size"
                              value={size}
                              required={needsSize}
                              disabled={busy || Boolean(draft.pending)}
                              options={entry.sizes.map((allowed) => ({
                                value: allowed,
                                label: allowed,
                              }))}
                              onChange={(next: string) =>
                                updateEquipment(index, {
                                  size: (next ||
                                    null) as ParticipantEquipmentEntry['size'],
                                })
                              }
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
              </section>
            ))}
          </fieldset>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          {conflict && (
            <p className="notice" role="alert">
              {en
                ? 'Equipment changed on the server. Your draft is preserved. Load the current server version before editing again.'
                : 'Sprzęt zmieniono na serwerze. Twój szkic jest zachowany. Wczytaj aktualną wersję serwera przed dalszą edycją.'}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setDraft(serverDraft());
                  setMessage('');
                }}
              >
                {en ? 'Load server version' : 'Wczytaj wersję serwera'}
              </button>
            </p>
          )}
          {draft.pending && (
            <p className="notice" role="status">
              {en
                ? 'Equipment saved, but profile refresh is pending. Your accepted equipment remains shown.'
                : 'Sprzęt zapisany, ale odświeżenie profilu oczekuje. Wyświetlamy zaakceptowany sprzęt.'}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void Promise.resolve()
                    .then(onChanged)
                    .catch(() => {})
                    .finally(() => setBusy(false));
                }}
              >
                {en ? 'Refresh saved equipment' : 'Odśwież zapisany sprzęt'}
              </button>
            </p>
          )}
          <div className={`equipment-save${dirty ? ' is-dirty' : ''}`}>
            <span className="equipment-save__state" role="status">
              {dirty
                ? en
                  ? 'Unsaved changes. Full Gear and the fee update after saving.'
                  : 'Niezapisane zmiany. Full Gear i składka zaktualizują się po zapisaniu.'
                : ''}
            </span>
            {dirty && !conflict && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setDraft(serverDraft());
                  setMessage('');
                }}
              >
                {en ? 'Discard changes' : 'Cofnij zmiany'}
              </button>
            )}
            <button
              className="button"
              disabled={busy || conflict || Boolean(draft.pending)}
              type="submit"
            >
              {busy
                ? en
                  ? 'Saving…'
                  : 'Zapisuję…'
                : en
                  ? 'Save equipment'
                  : 'Zapisz sprzęt'}
            </button>
          </div>
        </form>
      </ProfileDisclosure>
    </>
  );
}
