import { useState } from 'react';
import type { ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Building2, LogOut, Palette, UserRound } from './placeholderIcons';
import { useTheme } from './lib/theme';
import AppVersion from './AppVersion';

type Language = 'pl' | 'en';
import type { SettingsSection as Section } from './lib/portal-navigation';
interface Props {
  client: SupabaseClient;
  accountId: string;
  language: Language;
  onLanguageChange: (language: Language) => void;
  onSignOut: () => Promise<void>;
  managementContent?: ReactNode;
  personalDetailsContent?: ReactNode;
  initialSection?: Section;
  section?: Section;
  onSectionChange?: (section: Section) => void;
}

export default function SettingsPanel({
  client,
  accountId,
  language,
  onLanguageChange,
  onSignOut,
  managementContent,
  personalDetailsContent,
  initialSection = 'general',
  section: controlledSection,
  onSectionChange,
}: Props) {
  const [localSection, setLocalSection] = useState<Section>(initialSection);
  const section = controlledSection ?? localSection;
  const setSection = (value: Section) => {
    setLocalSection(value);
    onSectionChange?.(value);
  };
  const [message, setMessage] = useState('');
  const { theme, setTheme, navBottom, setNavBottom } = useTheme();
  const en = language === 'en';
  const saveLanguage = async (value: Language) => {
    onLanguageChange(value);
    try {
      const { error } = await client
        .from('account_preferences')
        .upsert(
          { account_id: accountId, language: value },
          { onConflict: 'account_id' },
        );
      if (error) throw error;
      setMessage('');
    } catch {
      setMessage(
        value === 'en'
          ? 'Could not save your language preference.'
          : 'Nie udało się zapisać preferencji języka.',
      );
    }
  };
  const tabs: { id: Section; label: string; icon: typeof Building2 }[] = [
    { id: 'general', label: en ? 'General' : 'Ogólne', icon: Building2 },
    ...(personalDetailsContent
      ? [
          {
            id: 'profile' as const,
            label: en ? 'Profile' : 'Profil',
            icon: UserRound,
          },
        ]
      : []),
    {
      id: 'personalization',
      label: en ? 'Personalization' : 'Personalizacja',
      icon: Palette,
    },
  ];
  return (
    <>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">
              {en ? 'CLUB SETTINGS' : 'USTAWIENIA KLUBU'}
            </span>
            <h2>{en ? 'Settings' : 'Ustawienia'}</h2>
          </div>
        </div>
        <div
          className="settings-tabs"
          role="tablist"
          aria-label={en ? 'Settings sections' : 'Sekcje ustawień'}
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={section === id}
              className={`settings-tab ${section === id ? 'active' : ''}`}
              onClick={() => setSection(id)}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </div>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {section === 'general' && (
          <div className="settings-general">
            {managementContent && (
              <div className="settings-management">{managementContent}</div>
            )}
            <section className="settings-session">
              <div>
                <h3>{en ? 'Your account' : 'Twoje konto'}</h3>
                <p className="muted">
                  {en
                    ? 'Sign out when you finish using a shared device.'
                    : 'Wyloguj się po zakończeniu pracy na wspólnym urządzeniu.'}
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => void onSignOut()}
              >
                <LogOut size={16} />
                {en ? 'Sign out' : 'Wyloguj się'}
              </button>
            </section>
            <AppVersion language={language} />
          </div>
        )}
        {section === 'profile' && personalDetailsContent}
        {section === 'personalization' && (
          <div className="settings-content">
            <h3>{en ? 'Personalization' : 'Personalizacja'}</h3>
            <label>
              {en ? 'App language' : 'Język aplikacji'}
              <select
                value={language}
                onChange={(event) =>
                  void saveLanguage(event.target.value as Language)
                }
              >
                <option value="pl">Polski</option>
                <option value="en">English</option>
              </select>
            </label>
            <label>
              {en ? 'Appearance' : 'Wygląd'}
              <select
                value={theme}
                onChange={(event) =>
                  setTheme(event.target.value === 'dark' ? 'dark' : 'light')
                }
              >
                <option value="light">
                  {en ? 'Light mode' : 'Tryb jasny'}
                </option>
                <option value="dark">{en ? 'Dark mode' : 'Tryb ciemny'}</option>
              </select>
            </label>
            <label>
              {en ? 'Menu bar on phones' : 'Pasek menu na telefonie'}
              <select
                value={navBottom ? 'bottom' : 'top'}
                onChange={(event) =>
                  setNavBottom(event.target.value === 'bottom')
                }
              >
                <option value="top">{en ? 'At the top' : 'Na górze'}</option>
                <option value="bottom">
                  {en ? 'At the bottom' : 'Na dole'}
                </option>
              </select>
            </label>
            <p className="muted">
              {en
                ? 'Appearance and menu bar position are saved on this device.'
                : 'Wygląd i położenie paska menu są zapamiętywane na tym urządzeniu.'}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
