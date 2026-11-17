import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClothingSizeKey, ClothingSizes, Participant } from './types/club';
import { equipmentIcons, profileEquipmentCatalog } from './equipmentIcons';
import ProfileDisclosure from './ProfileDisclosure';
import { ShieldCheck } from './placeholderIcons';

const catalog = profileEquipmentCatalog.filter((item) =>
  ['jacket', 'mask', 'pants', 'gloves', 'overlay'].includes(item.item),
);

export default function ClothingSizesPanel({
  client,
  person,
  language,
  onChanged,
}: {
  client: SupabaseClient;
  person: Participant;
  language: 'pl' | 'en';
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const en = language === 'en';
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current || !mounted.current) return;
    const values = new FormData(event.currentTarget);
    const sizes: ClothingSizes = {};
    for (const item of catalog) {
      const size = String(values.get(item.item) ?? '');
      if (!(item.sizes as readonly string[]).includes(size)) {
        setMessage(
          en
            ? 'Complete all five sizes.'
            : 'Uzupełnij wszystkie pięć rozmiarów.',
        );
        return;
      }
      sizes[item.item as ClothingSizeKey] = size;
    }
    pending.current = true;
    setBusy(true);
    setMessage('');
    let saved = false;
    try {
      const { data, error } = await client.rpc(
        'save_participant_clothing_sizes',
        {
          p_participant_id: person.id,
          p_sizes: sizes,
          p_expected_sizes: person.clothing_sizes ?? {},
        },
      );
      if (error) throw error;
      if (data !== true) {
        if (mounted.current)
          setMessage(
            en
              ? 'Sizes have changed. Reload the profile before saving again.'
              : 'Rozmiary zostały zmienione. Odśwież profil przed kolejnym zapisem.',
          );
        return;
      }
      saved = true;
      await onChanged();
      if (mounted.current)
        setMessage(en ? 'Clothing sizes saved.' : 'Zapisano rozmiary stroju.');
    } catch {
      if (mounted.current)
        setMessage(
          saved
            ? en
              ? 'Sizes saved, but the profile could not be refreshed. Reload the page.'
              : 'Zapisano rozmiary, ale nie udało się odświeżyć profilu. Odśwież stronę.'
            : en
              ? 'Could not save sizes. Check your connection and access.'
              : 'Nie udało się zapisać rozmiarów. Sprawdź połączenie i dostęp.',
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (person.level !== 'advanced' && !person.clothing_sizes_requested)
    return null;
  return (
    <ProfileDisclosure
      title={
        <>
          <ShieldCheck size={18} />
          {en ? 'Clothing sizes' : 'Rozmiary stroju'} · {person.name}
        </>
      }
    >
      <p className="muted">
        {en
          ? 'Complete these sizes before joining the advanced group. Sizes do not declare equipment ownership.'
          : 'Uzupełnij rozmiary przed przejściem do grupy zaawansowanej. Rozmiary nie oznaczają deklaracji posiadania sprzętu.'}
      </p>
      <form
        key={JSON.stringify(person.clothing_sizes ?? {})}
        onSubmit={(event) => void save(event)}
      >
        <fieldset disabled={busy}>
          <legend>
            {en ? 'Required clothing sizes' : 'Wymagane rozmiary stroju'}
          </legend>
          {catalog.map((item) => {
            const Icon = equipmentIcons[item.item];
            return (
              <label key={item.item}>
                <Icon />
                {en ? item.en : item.pl}
                <select
                  name={item.item}
                  required
                  defaultValue={
                    person.clothing_sizes?.[item.item as ClothingSizeKey] ?? ''
                  }
                >
                  <option value="">
                    {en ? 'Select size' : 'Wybierz rozmiar'}
                  </option>
                  {item.sizes.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          <button className="button" type="submit">
            {busy
              ? en
                ? 'Saving…'
                : 'Zapisuję…'
              : en
                ? 'Save sizes'
                : 'Zapisz rozmiary'}
          </button>
        </fieldset>
      </form>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </ProfileDisclosure>
  );
}
