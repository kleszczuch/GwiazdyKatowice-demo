export const APP_VERSION = '1.1.0';

export default function AppVersion({ language }: { language: 'pl' | 'en' }) {
  return (
    <p className="muted">
      {language === 'en' ? 'Version' : 'Wersja'}: {APP_VERSION}
    </p>
  );
}
