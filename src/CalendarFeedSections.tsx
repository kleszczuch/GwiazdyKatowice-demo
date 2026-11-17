import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type Choice = {
  visible: { id: string; name: string }[];
  own: string[];
};

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

function parse(value: unknown): (Choice & { selected: string[] }) | null {
  if (!value || typeof value !== 'object') return null;
  const { visible, own, selected } = value as Record<string, unknown>;
  if (
    !Array.isArray(visible) ||
    !visible.every(
      (item) =>
        item && typeof item.id === 'string' && typeof item.name === 'string',
    ) ||
    !strings(own) ||
    (selected !== null && !strings(selected))
  )
    return null;
  return { visible, own, selected: selected ?? own };
}

const same = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id) => right.includes(id));

export default function CalendarFeedSections({
  client,
  language,
}: {
  client: SupabaseClient;
  language: 'pl' | 'en';
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [status, setStatus] = useState<
    'loading' | 'loadError' | 'ready' | 'saving' | 'saved' | 'saveError'
  >('loading');
  const say = (pl: string, english: string) =>
    language === 'en' ? english : pl;
  useEffect(() => {
    let alive = true;
    void (async () => {
      let parsed = null;
      try {
        const { data, error } = await client.rpc(
          'get_my_calendar_feed_sections',
        );
        parsed = error ? null : parse(data);
      } catch {
        parsed = null;
      }
      if (!alive) return;
      if (!parsed) return setStatus('loadError');
      setChoice(parsed);
      setChecked(parsed.selected);
      setStatus('ready');
    })();
    return () => {
      alive = false;
    };
  }, [client]);
  if (status === 'loading') return null;
  if (!choice)
    return (
      <p role="status">
        {say(
          'Nie udało się wczytać wyboru sekcji. Kanał działa z dotychczasowym wyborem.',
          'Could not load the section choice. The feed keeps its current choice.',
        )}
      </p>
    );
  const all = choice.visible.map((section) => section.id);
  const save = async (next: string[]) => {
    const previous = checked;
    setChecked(next);
    setStatus('saving');
    let failed = true;
    try {
      const { error } = await client.rpc('set_my_calendar_feed_sections', {
        p_section_ids: same(next, choice.own) ? null : next,
      });
      failed = Boolean(error);
    } catch {
      failed = true;
    }
    if (failed) setChecked(previous);
    setStatus(failed ? 'saveError' : 'saved');
  };
  return (
    <fieldset className="calendar-feed-sections" disabled={status === 'saving'}>
      <legend>{say('Sekcje w kalendarzu', 'Sections in the calendar')}</legend>
      <div className="calendar-feed-sections__presets">
        <button
          type="button"
          className="button secondary small"
          aria-pressed={same(checked, all)}
          onClick={() => void save(all)}
        >
          {say('Wszystko', 'Everything')}
        </button>
        <button
          type="button"
          className="button secondary small"
          aria-pressed={same(checked, choice.own)}
          onClick={() => void save(choice.own)}
        >
          {say('Moje sekcje', 'My sections')}
        </button>
      </div>
      {choice.visible.map((section) => (
        <label key={section.id} className="calendar-feed-sections__item">
          <input
            type="checkbox"
            checked={checked.includes(section.id)}
            onChange={() =>
              void save(
                checked.includes(section.id)
                  ? checked.filter((id) => id !== section.id)
                  : [...checked, section.id],
              )
            }
          />
          {section.name}
        </label>
      ))}
      {status === 'saved' && (
        <p role="status">
          {say(
            'Zapisano. Google pokaże zmianę po odświeżeniu subskrypcji.',
            'Saved. Google shows the change after it refreshes the subscription.',
          )}
        </p>
      )}
      {status === 'saveError' && (
        <p role="status">
          {say(
            'Nie zapisano wyboru. Spróbuj ponownie.',
            'The choice was not saved. Try again.',
          )}
        </p>
      )}
    </fieldset>
  );
}
