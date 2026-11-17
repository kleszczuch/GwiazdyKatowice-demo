import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Check, Images } from './placeholderIcons';
import ProfileDialog from './ProfileDialog';
import SwordsLoader from './SwordsLoader';
import { resolveProfilePhoto } from './lib/profile-photo';

export const MAX_PROFILE_PHOTOS = 12;
const photoName = /^[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$/;

export async function listProfilePhotos(
  client: SupabaseClient,
  accountId: string,
): Promise<string[] | null> {
  try {
    const { data, error } = await client.storage
      .from('profile-photos')
      .list(accountId, {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      });
    if (error || !Array.isArray(data)) return null;
    return data
      .map((item: { name?: string }) => item.name ?? '')
      .filter((name) => photoName.test(name))
      .map((name) => `${accountId}/${name}`);
  } catch {
    return null;
  }
}

interface Photo {
  path: string;
  url: string;
}

export default function MyPhotosPanel({
  client,
  accountId,
  currentPath,
  language,
  disabled = false,
  onUse,
  onCurrentRemoved,
}: {
  client: SupabaseClient;
  accountId: string;
  currentPath: string | null;
  language: 'pl' | 'en';
  disabled?: boolean;
  onUse: (path: string, url: string) => Promise<boolean>;
  onCurrentRemoved: () => Promise<boolean>;
}) {
  const en = language === 'en';
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const paths = await listProfilePhotos(client, accountId);
      if (!active) return;
      if (!paths) {
        setFailed(true);
        setPhotos([]);
        return;
      }
      const resolved = await Promise.all(
        paths.map(async (path) => ({
          path,
          url: (await resolveProfilePhoto(client, accountId, path)).url,
        })),
      );
      if (active) setPhotos(resolved.filter((photo) => photo.url));
    })();
    return () => {
      active = false;
    };
  }, [open, client, accountId, revision]);

  const use = async (photo: Photo) => {
    if (busyPath) return;
    setBusyPath(photo.path);
    setMessage('');
    const ok = await onUse(photo.path, photo.url);
    setMessage(
      ok
        ? en
          ? 'Profile photo changed.'
          : 'Zmieniono zdjęcie profilowe.'
        : en
          ? 'Could not change the photo. Try again.'
          : 'Nie udało się zmienić zdjęcia. Spróbuj ponownie.',
    );
    setBusyPath(null);
  };

  const remove = async (photo: Photo) => {
    if (busyPath) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        en ? 'Delete this photo permanently?' : 'Usunąć to zdjęcie na stałe?',
      )
    )
      return;
    setBusyPath(photo.path);
    setMessage('');
    try {
      if (photo.path === currentPath && !(await onCurrentRemoved()))
        throw new Error('Could not clear the current photo');
      const { error } = await client.storage
        .from('profile-photos')
        .remove([photo.path]);
      if (error) throw error;
      setPhotos((current) =>
        (current ?? []).filter((item) => item.path !== photo.path),
      );
      setMessage(en ? 'Photo deleted.' : 'Usunięto zdjęcie.');
    } catch {
      setMessage(
        en
          ? 'Could not delete the photo. Try again.'
          : 'Nie udało się usunąć zdjęcia. Spróbuj ponownie.',
      );
      setRevision((value) => value + 1);
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <>
      <button
        type="button"
        className="button secondary small"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => {
          setMessage('');
          setPhotos(null);
          setFailed(false);
          setOpen(true);
        }}
      >
        <Images size={15} />
        {en ? 'My photos' : 'Moje zdjęcia'}
      </button>
      {open && (
        <ProfileDialog
          title={en ? 'My photos' : 'Moje zdjęcia'}
          closeLabel={en ? 'Close' : 'Zamknij'}
          onClose={() => {
            if (!busyPath) setOpen(false);
          }}
        >
          <p className="muted">
            {en
              ? `Keep up to ${MAX_PROFILE_PHOTOS} photos. Choose one as your profile photo or delete the ones you no longer need.`
              : `Możesz mieć do ${MAX_PROFILE_PHOTOS} zdjęć. Wybierz jedno jako profilowe albo usuń niepotrzebne.`}
          </p>
          {photos === null ? (
            <SwordsLoader
              language={language}
              label={en ? 'Loading photos…' : 'Wczytuję zdjęcia…'}
            />
          ) : failed ? (
            <p role="alert" className="notice">
              {en
                ? 'Could not load your photos.'
                : 'Nie udało się wczytać zdjęć.'}{' '}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setPhotos(null);
                  setFailed(false);
                  setRevision((value) => value + 1);
                }}
              >
                {en ? 'Try again' : 'Spróbuj ponownie'}
              </button>
            </p>
          ) : photos.length === 0 ? (
            <p className="muted">
              {en
                ? 'You have no uploaded photos yet.'
                : 'Nie masz jeszcze własnych zdjęć.'}
            </p>
          ) : (
            <ul className="my-photos">
              {photos.map((photo) => {
                const current = photo.path === currentPath;
                return (
                  <li
                    key={photo.path}
                    className={`my-photos__item ${current ? 'is-current' : ''}`}
                  >
                    <img src={photo.url} alt="" />
                    {current ? (
                      <span className="my-photos__current">
                        <Check size={14} strokeWidth={3} />
                        {en ? 'Current' : 'Aktualne'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={busyPath !== null}
                        onClick={() => void use(photo)}
                      >
                        {en ? 'Set as profile' : 'Ustaw jako profilowe'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="button danger small"
                      disabled={busyPath !== null}
                      onClick={() => void remove(photo)}
                    >
                      {busyPath === photo.path
                        ? en
                          ? 'Deleting…'
                          : 'Usuwam…'
                        : en
                          ? 'Delete'
                          : 'Usuń'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
        </ProfileDialog>
      )}
    </>
  );
}
