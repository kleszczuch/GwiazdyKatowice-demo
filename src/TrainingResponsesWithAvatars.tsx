import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readRpcPages } from './lib/pagination';
import TrainingResponses from './TrainingResponses';
import type { TrainingResponsePerson } from './TrainingResponses';

type AvatarRow = {
  name: string;
  role: 'coach' | 'participant';
  response: 'yes' | 'no' | null;
  person_key: string;
  avatar_key: string | null;
};

interface Props {
  client: SupabaseClient;
  trainingId: string;
  language: 'pl' | 'en';
  people: TrainingResponsePerson[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

// Lista z avatarami pochodzi z osobnego RPC; używamy jej tylko wtedy, gdy
// opisuje dokładnie te same osoby i odpowiedzi co lista podstawowa.
const rosterSignature = (people: TrainingResponsePerson[]) =>
  people
    .map(({ name, role, response }) => JSON.stringify([name, role, response]))
    .sort()
    .join('\n');

export default function TrainingResponsesWithAvatars({
  client,
  trainingId,
  language,
  people,
  loading,
  error,
  onRetry,
}: Props) {
  const [loaded, setLoaded] = useState<{
    trainingId: string;
    original: TrainingResponsePerson[];
    people: TrainingResponsePerson[];
  } | null>(null);

  useEffect(() => {
    if (!trainingId || loading || error) return;
    let active = true;
    const controller = new AbortController();
    const urls: string[] = [];
    void (async () => {
      try {
        const result = await readRpcPages<AvatarRow>(
          (from, to) =>
            client.rpc('get_training_role_responses_with_avatars', {
              p_training_id: trainingId,
              p_offset: from,
              p_limit: to - from + 1,
            }),
          () => active,
          (person) => person.person_key,
        );
        if (!active || result.error || !result.data) return;
        const rows = result.data;
        if (
          !rows.every(
            (row) =>
              typeof row.name === 'string' &&
              (row.role === 'coach' || row.role === 'participant') &&
              (row.response === 'yes' ||
                row.response === 'no' ||
                row.response === null) &&
              /^[a-f0-9]{32}$/.test(row.person_key) &&
              (row.avatar_key === null ||
                (typeof row.avatar_key === 'string' &&
                  /^[a-f0-9]{32}$/.test(row.avatar_key))),
          ) ||
          rosterSignature(rows) !== rosterSignature(people)
        )
          return;

        const enriched: TrainingResponsePerson[] = rows.map((row) => ({
          name: row.name,
          role: row.role,
          response: row.response,
          personKey: row.person_key,
        }));
        // Lista pojawia się od razu, a zdjęcia są dokładane w miarę pobierania.
        const publish = () => {
          if (active)
            setLoaded({
              trainingId,
              original: people,
              people: enriched.map((person) => ({ ...person })),
            });
        };
        publish();
        let index = 0;
        // Zdjęcia pobierają cztery równoległe „kolejki” ze wspólnym indeksem.
        // Funkcja Edge zwraca plik, a jego typ w nagłówku x-avatar-content-type;
        // przyjmujemy tylko obrazy JPG/PNG/WebP do 5 MB.
        const worker = async () => {
          while (active && index < rows.length) {
            const current = index++;
            const key = rows[current].avatar_key;
            if (!key) continue;
            try {
              const {
                data,
                error: fetchError,
                response,
              } = await client.functions.invoke<Blob>('training-avatar', {
                body: { training_id: trainingId, avatar_key: key },
                signal: controller.signal,
                timeout: 10_000,
              });
              const type = response?.headers.get('x-avatar-content-type') ?? '';
              if (
                !active ||
                fetchError ||
                !(data instanceof Blob) ||
                data.size > 5 * 1024 * 1024 ||
                !['image/jpeg', 'image/png', 'image/webp'].includes(type)
              )
                continue;
              const url = URL.createObjectURL(new Blob([data], { type }));
              urls.push(url);
              enriched[current].avatarUrl = url;
              publish();
            } catch {}
          }
        };
        await Promise.all(Array.from({ length: 4 }, () => worker()));
      } catch {}
    })();
    return () => {
      active = false;
      controller.abort();
      // Adresy blob: trzeba zwolnić ręcznie, inaczej zdjęcia zostają w pamięci.
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [client, trainingId, people, loading, error]);

  const visiblePeople =
    !loading &&
    !error &&
    loaded?.trainingId === trainingId &&
    loaded.original === people
      ? loaded.people
      : people;
  return (
    <TrainingResponses
      language={language}
      people={visiblePeople}
      loading={loading}
      error={error}
      onRetry={onRetry}
    />
  );
}
