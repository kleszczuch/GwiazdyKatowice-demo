import type { SupabaseClient } from '@supabase/supabase-js';

interface PhotoResult {
  url: string;
  missing: boolean;
}
const cache = new WeakMap<
  SupabaseClient,
  Map<
    string,
    {
      expires: number;
      result: Promise<PhotoResult>;
    }
  >
>();

// Zwraca podpisany adres zdjęcia profilowego z pamięcią podręczną. Podpis
// jest ważny 60 min, wpis 50 min, żeby nie oddać adresu tuż przed
// wygaśnięciem. Gdy pliku nie ma w Storage, czyścimy avatar_path w bazie
// i przez 5 min nie pytamy ponownie. Inne błędy nie są zapamiętywane.
export function resolveProfilePhoto(
  client: SupabaseClient,
  accountId: string,
  path: string,
): Promise<PhotoResult> {
  // Ścieżka spoza katalogu konta nie jest w ogóle odczytywana.
  if (!path.startsWith(`${accountId}/`))
    return Promise.resolve({ url: '', missing: false });
  let entries = cache.get(client);
  if (!entries) {
    entries = new Map();
    cache.set(client, entries);
  }
  const key = `${accountId}:${path}`;
  const previous = entries.get(key);
  if (previous && previous.expires > Date.now()) return previous.result;
  const entry = {
    expires: Date.now() + 50 * 60 * 1000,
    result: Promise.resolve<PhotoResult>({ url: '', missing: false }),
  };
  entries.set(key, entry);
  entry.result = (async () => {
    try {
      const { data, error } = await client.storage
        .from('profile-photos')
        .createSignedUrl(path, 3600);
      if (!error && data?.signedUrl)
        return { url: data.signedUrl, missing: false };
      const missing =
        error &&
        (error.message === 'Object not found' ||
          ('code' in error &&
            (error.code === 'NoSuchKey' || error.code === 'NoSuchObject')));
      if (!missing) {
        entries.delete(key);
        return { url: '', missing: false };
      }
      entry.expires = Date.now() + 5 * 60 * 1000;
      try {
        await client
          .from('account_preferences')
          .update({ avatar_path: null })
          .eq('account_id', accountId)
          .eq('avatar_path', path);
      } catch {}
      return { url: '', missing: true };
    } catch {
      entries.delete(key);
      return { url: '', missing: false };
    }
  })();
  return entry.result;
}
