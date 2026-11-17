import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Section } from './types/club';
import { readRpcPages } from './lib/pagination';
import SwordsLoader from './SwordsLoader';
import { sectionLabel } from './lib/sections.ts';

interface ManagedAccount {
  account_id: string;
  display_name: string | null;
  email: string | null;
  club_access: boolean;
  roles: string[];
  section_ids: string[];
}

interface Props {
  client: SupabaseClient;
  accountId: string;
  canManage: boolean;
  sections: Section[];
  language: 'pl' | 'en';
  onChanged: () => Promise<void>;
  targetAccountId?: string;
  embedded?: boolean;
  asRows?: boolean;
  excludedAccountIds?: string[];
  refreshRevision?: number;
}

export default function AccountRolesPanel({
  client,
  accountId,
  canManage,
  sections,
  language,
  onChanged,
  targetAccountId,
  embedded = false,
  asRows = false,
  excludedAccountIds = [],
  refreshRevision,
}: Props) {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [missingBackend, setMissingBackend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [formRevision, setFormRevision] = useState(0);
  const mounted = useRef(false);
  const revision = useRef(0);
  const mutating = useRef(false);
  const en = language === 'en';
  const read = useCallback(async () => {
    const request = ++revision.current;
    if (!canManage || !mounted.current) return false;
    setLoading(true);
    const result = await readRpcPages<ManagedAccount>(
      (from, to) => {
        const query = client.rpc('list_club_account_roles').order('account_id');
        return (
          targetAccountId ? query.eq('account_id', targetAccountId) : query
        ).range(from, to);
      },
      () => mounted.current && request === revision.current,
      (account) => account.account_id,
    );
    if (!mounted.current || request !== revision.current) return false;
    setLoading(false);
    setFailed(Boolean(result.error));
    setMissingBackend(result.error?.code === 'PGRST202');
    setAccounts(result.data ?? []);
    if (!result.error) setFormRevision((value) => value + 1);
    return !result.error;
  }, [client, canManage, targetAccountId]);
  useEffect(() => {
    mounted.current = true;
    void read();
    const generation = revision;
    return () => {
      mounted.current = false;
      ++generation.current;
    };
  }, [read, refreshRevision]);
  const selected =
    accounts.find((account) => account.account_id === selectedId) ??
    accounts[0];
  const save = async (
    account: ManagedAccount,
    roles: string[],
    sectionIds: string[],
    nonCoachLevel: 'beginner' | 'advanced' | null,
  ) => {
    if (!canManage || !mounted.current || mutating.current || loading || failed)
      return;
    const roleNames = roles.map((role) =>
      role === 'admin' ? 'Administrator' : en ? 'Coach' : 'Trener',
    );
    const sectionNames = sections
      .filter((section) => sectionIds.includes(section.id))
      .map((section) => sectionLabel(section, sections, language));
    const levelNotice = nonCoachLevel
      ? en
        ? ` New participant level: ${nonCoachLevel === 'advanced' ? 'Advanced' : 'Beginner'}.`
        : ` Nowy poziom zawodnika: ${nonCoachLevel === 'advanced' ? 'Zaawansowany' : 'Początkujący'}.`
      : '';
    if (
      !window.confirm(
        en
          ? `Save permissions for ${account.email ?? account.display_name ?? account.account_id}? Roles: ${roleNames.join(', ') || 'Member'}. Coached sections: ${sectionNames.join(', ') || 'None'}.${levelNotice}`
          : `Zapisać uprawnienia dla ${account.email ?? account.display_name ?? account.account_id}? Role: ${roleNames.join(', ') || 'Uczestnik'}. Prowadzone sekcje: ${sectionNames.join(', ') || 'Brak'}.${levelNotice}`,
      )
    )
      return;
    mutating.current = true;
    setBusy(true);
    setMessage('');
    let saved = false;
    try {
      if (roles.includes('coach') || account.roles.includes('coach')) {
        const capability = await client.rpc('coach_role_sync_enabled');
        if (capability.error || capability.data !== true)
          throw new Error('COACH_SYNC_UNAVAILABLE');
      }
      const { data, error } = await client.rpc('set_club_account_roles', {
        p_account_id: account.account_id,
        p_roles: roles,
        p_section_ids: sectionIds,
        ...(nonCoachLevel ? { p_non_coach_level: nonCoachLevel } : {}),
      });
      if (error) throw error;
      if (data !== true) throw new Error('Role update failed');
      saved = true;
      if (!mounted.current) {
        await onChanged();
        return;
      }
      const results = await Promise.allSettled([read(), onChanged()]);
      if (
        results.some(
          (result) => result.status === 'rejected' || result.value === false,
        )
      )
        throw new Error('Refresh failed');
      if (mounted.current)
        setMessage(
          en
            ? 'Account roles and coached sections saved.'
            : 'Zapisano role konta i prowadzone sekcje.',
        );
    } catch (error) {
      const detail =
        typeof error === 'object' && error && 'message' in error
          ? String(error.message)
          : '';
      if (mounted.current)
        setMessage(
          detail.includes('COACH_SYNC_UNAVAILABLE')
            ? en
              ? 'Coach synchronization is not available on the server. Ask an administrator to update the database.'
              : 'Synchronizacja trenera nie jest dostępna na serwerze. Baza wymaga aktualizacji.'
            : detail.includes('COACH_SELF_LINK_REQUIRED') ||
                detail.includes('COACH_SELF_LINK_AMBIGUOUS')
              ? en
                ? 'A coach needs exactly one active, complete account linked to their own profile.'
                : 'Trener musi mieć jedno aktywne, kompletne konto powiązane z własnym profilem.'
              : detail.includes('COACH_ADVANCED_SIZES_REQUIRED')
                ? en
                  ? 'The participant must complete all five clothing sizes before selecting advanced.'
                  : 'Przed wyborem poziomu zaawansowanego zawodnik musi uzupełnić pięć rozmiarów.'
                : saved
                  ? en
                    ? 'Permissions saved, but data could not be refreshed. Reload the page.'
                    : 'Uprawnienia zapisano, ale nie udało się odświeżyć danych. Odśwież stronę.'
                  : en
                    ? 'Could not save permissions. Check your administrator access and try again.'
                    : 'Nie udało się zapisać uprawnień. Sprawdź dostęp administratora i spróbuj ponownie.',
        );
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (!canManage) return null;
  const errorMessage = missingBackend
    ? en
      ? 'Account role management is not available on the server yet.'
      : 'Zarządzanie rolami kont nie jest jeszcze dostępne na serwerze.'
    : en
      ? 'Could not load account roles.'
      : 'Nie udało się wczytać ról kont.';
  if (asRows)
    return (
      <>
        {(loading || failed || message) && (
          <tr>
            <td colSpan={6}>
              {loading && (
                <SwordsLoader
                  language={language}
                  label={en ? 'Loading accounts…' : 'Wczytuję konta…'}
                />
              )}
              {failed && <p role="alert">{errorMessage}</p>}
              {message && <p role="status">{message}</p>}
              {failed && (
                <button
                  className="button secondary small"
                  disabled={busy || loading}
                  onClick={() => void read()}
                >
                  {en ? 'Retry' : 'Ponów'}
                </button>
              )}
            </td>
          </tr>
        )}
        {!loading &&
          !failed &&
          accounts
            .filter(
              (account) => !excludedAccountIds.includes(account.account_id),
            )
            .map((account) => (
              <tr key={`account:${account.account_id}`}>
                <td colSpan={6}>
                  <details>
                    <summary>
                      {account.display_name || account.email} ·{' '}
                      {en
                        ? 'Account without a participant'
                        : 'Konto bez zawodnika'}
                    </summary>
                    <AccountRoleEditor
                      key={`${account.account_id}:${formRevision}`}
                      account={account}
                      own={account.account_id === accountId}
                      sections={sections}
                      language={language}
                      busy={busy}
                      onSave={save}
                    />
                  </details>
                </td>
              </tr>
            ))}
      </>
    );
  return (
    <section className={embedded ? 'settings-content' : 'panel'}>
      <h2>{en ? 'Account roles' : 'Role kont'}</h2>
      {!embedded && (
        <p className="muted">
          {en
            ? 'Coach role and participant level are synchronized. Assign coached sections separately.'
            : 'Rola trenera i poziom zawodnika są synchronizowane. Prowadzone sekcje przypisz osobno.'}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {loading && (
        <SwordsLoader
          language={language}
          label={en ? 'Loading accounts…' : 'Wczytuję konta…'}
        />
      )}
      {failed && (
        <p role="alert" className="notice">
          {errorMessage}
        </p>
      )}
      <button
        type="button"
        className="button secondary small"
        disabled={busy || loading}
        onClick={() => void read()}
      >
        {en ? 'Refresh accounts' : 'Odśwież konta'}
      </button>
      {!loading && !failed && !selected && (
        <p>{en ? 'No club accounts.' : 'Brak kont klubowych.'}</p>
      )}
      {!loading && !failed && selected && (
        <>
          {!embedded && (
            <label>
              {en ? 'Account' : 'Konto'}
              <select
                aria-label={en ? 'Account' : 'Konto'}
                value={selected.account_id}
                disabled={busy}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.account_id} value={account.account_id}>
                    {account.display_name ??
                      account.email ??
                      account.account_id}
                    {account.email && account.display_name
                      ? ` — ${account.email}`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <AccountRoleEditor
            key={`${selected.account_id}:${formRevision}`}
            account={selected}
            own={selected.account_id === accountId}
            sections={sections}
            language={language}
            busy={busy}
            onSave={save}
          />
        </>
      )}
    </section>
  );
}

function AccountRoleEditor({
  account,
  own,
  sections,
  language,
  busy,
  onSave,
}: {
  account: ManagedAccount;
  own: boolean;
  sections: Section[];
  language: 'pl' | 'en';
  busy: boolean;
  onSave: (
    account: ManagedAccount,
    roles: string[],
    sectionIds: string[],
    nonCoachLevel: 'beginner' | 'advanced' | null,
  ) => Promise<void>;
}) {
  const [roles, setRoles] = useState(
    account.roles.filter((role) => role === 'admin' || role === 'coach'),
  );
  const [nonCoachLevel, setNonCoachLevel] = useState<
    'beginner' | 'advanced' | ''
  >('');
  const en = language === 'en';
  const coach = roles.includes('coach');
  const removingCoach = account.roles.includes('coach') && !coach;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (removingCoach && !nonCoachLevel) return;
    void onSave(
      account,
      roles,
      coach ? values.getAll('sections').map(String) : [],
      removingCoach ? nonCoachLevel || null : null,
    );
  };
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>
          {account.email ?? account.display_name ?? account.account_id}
        </legend>
        {!account.club_access && (
          <p className="notice">
            {en
              ? 'Approve club access before granting new roles or coached sections. Existing permissions can be revoked.'
              : 'Przed nadaniem nowych ról i prowadzonych sekcji zatwierdź dostęp klubowy. Istniejące uprawnienia można odebrać.'}
          </p>
        )}
        {(['admin', 'coach'] as const).map((role) => (
          <label className="checkbox-label" key={role}>
            <input
              type="checkbox"
              name="roles"
              value={role}
              checked={roles.includes(role)}
              disabled={
                (own && role === 'admin') ||
                (!account.club_access && !account.roles.includes(role))
              }
              onChange={(event) =>
                setRoles((current) =>
                  event.target.checked
                    ? [...current, role]
                    : current.filter((value) => value !== role),
                )
              }
            />
            {role === 'admin' ? 'Administrator' : en ? 'Coach' : 'Trener'}
          </label>
        ))}
        {own && (
          <p className="muted">
            {en
              ? 'You cannot remove your own administrator role.'
              : 'Nie możesz odebrać sobie roli administratora.'}
          </p>
        )}
        {removingCoach && (
          <label>
            {en
              ? 'Participant level after removing coach'
              : 'Poziom zawodnika po odebraniu roli trenera'}
            <select
              required
              value={nonCoachLevel}
              onChange={(event) =>
                setNonCoachLevel(
                  event.target.value as 'beginner' | 'advanced' | '',
                )
              }
            >
              <option value="">{en ? 'Choose level' : 'Wybierz poziom'}</option>
              <option value="beginner">
                {en ? 'Beginner' : 'Początkujący'}
              </option>
              <option value="advanced">
                {en ? 'Advanced' : 'Zaawansowany'}
              </option>
            </select>
          </label>
        )}
        <fieldset disabled={!coach}>
          <legend>{en ? 'Coached sections' : 'Prowadzone sekcje'}</legend>
          {sections.map((section) => (
            <label className="checkbox-label" key={section.id}>
              <input
                name="sections"
                type="checkbox"
                value={section.id}
                defaultChecked={account.section_ids.includes(section.id)}
                disabled={
                  !account.club_access &&
                  !account.section_ids.includes(section.id)
                }
              />
              {sectionLabel(section, sections, language)}
            </label>
          ))}
        </fieldset>
        <button className="button" type="submit" disabled={busy}>
          {en ? 'Save roles' : 'Zapisz role'}
        </button>
      </fieldset>
    </form>
  );
}
