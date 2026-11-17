import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { equipmentIcons, profileEquipmentCatalog } from './equipmentIcons';
import ProfileDisclosure from './ProfileDisclosure';
import './equipment.css';

// Ochraniacza krocza klub nie wypożycza, więc nie ma on stanu.
const categories = [
  { pl: 'Strój', en: 'Clothing', items: ['jacket', 'pants', 'overlay'] },
  {
    pl: 'Ochrona',
    en: 'Protection',
    items: ['mask', 'gloves', 'gloves_heavy', 'forearm', 'knee', 'gorget'],
  },
  { pl: 'Broń', en: 'Weapons', items: ['sabre', 'sword_buckler', 'longsword'] },
];

// Puste pole oznacza brak limitu; wpisana liczba to stan pozycji w rozmiarze.
export function stockRows(values: Record<string, string>) {
  const rows = Object.entries(values)
    .filter(([, value]) => value.trim() !== '')
    .map(([key, value]) => {
      const [item, size = ''] = key.split(':');
      return { item, size, quantity: Number(value) };
    });
  return rows.every(
    (row) =>
      Number.isInteger(row.quantity) &&
      row.quantity >= 0 &&
      row.quantity <= 9999,
  )
    ? rows
    : null;
}

export default function ClubEquipmentStock({
  client,
  language,
}: {
  client: SupabaseClient;
  language: 'pl' | 'en';
}) {
  const en = language === 'en';
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await client
        .from('club_equipment_stock')
        .select('item,size,quantity');
      if (!active) return;
      if (error || !Array.isArray(data)) {
        setMessage(
          en
            ? 'Could not read club stock. The database may need updating.'
            : 'Nie udało się odczytać zasobów klubu. Baza może wymagać aktualizacji.',
        );
        return;
      }
      setValues(
        Object.fromEntries(
          data.map((row) => [`${row.item}:${row.size}`, String(row.quantity)]),
        ),
      );
    })();
    return () => {
      active = false;
    };
  }, [client, en]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rows = values && stockRows(values);
    if (!rows) {
      setMessage(
        en
          ? 'Enter whole numbers from 0 to 9999 or leave a field empty.'
          : 'Wpisz liczby całkowite od 0 do 9999 albo zostaw pole puste.',
      );
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const { error } = await client.rpc('set_club_equipment_stock', {
        p_stock: rows,
      });
      if (error) throw error;
      setMessage(en ? 'Club stock saved.' : 'Zapisano zasoby klubu.');
    } catch {
      setMessage(
        en ? 'Could not save club stock.' : 'Nie udało się zapisać zasobów.',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <ProfileDisclosure title={en ? 'Club stock' : 'Zasoby klubu'}>
      <p className="muted">
        {en
          ? 'Number of items the club lends. A member who borrows an item cannot sign up when every piece in their size is already reserved for that training. An empty field means no limit.'
          : 'Liczba sztuk, które klub pożycza. Zawodnik pożyczający pozycję nie zapisze się na trening, gdy wszystkie sztuki w jego rozmiarze są już zarezerwowane na ten termin. Puste pole oznacza brak limitu.'}
      </p>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {values && (
        <form className="club-stock" onSubmit={(event) => void save(event)}>
          {categories.map((category) => (
            <fieldset key={category.pl}>
              <legend>{en ? category.en : category.pl}</legend>
              {profileEquipmentCatalog
                .filter((entry) => category.items.includes(entry.item))
                .map((entry) => {
                  const Icon = equipmentIcons[entry.item];
                  const name = en ? entry.en : entry.pl;
                  return (
                    <div className="club-stock__item" key={entry.item}>
                      <span className="equipment-table-label">
                        <Icon />
                        {name}
                      </span>
                      <div className="club-stock__sizes">
                        {(entry.sizes.length ? entry.sizes : ['']).map(
                          (size) => {
                            const key = `${entry.item}:${size}`;
                            return (
                              <label key={key}>
                                {size || (en ? 'Pieces' : 'Sztuk')}
                                <input
                                  type="number"
                                  min="0"
                                  max="9999"
                                  step="1"
                                  placeholder="—"
                                  aria-label={`${name} ${size}`.trim()}
                                  value={values[key] ?? ''}
                                  onChange={(event) =>
                                    setValues({
                                      ...values,
                                      [key]: event.target.value,
                                    })
                                  }
                                />
                              </label>
                            );
                          },
                        )}
                      </div>
                    </div>
                  );
                })}
            </fieldset>
          ))}
          <button className="button" disabled={saving} type="submit">
            {saving
              ? en
                ? 'Saving…'
                : 'Zapisuję…'
              : en
                ? 'Save stock'
                : 'Zapisz zasoby'}
          </button>
        </form>
      )}
    </ProfileDisclosure>
  );
}
