import { Component } from 'react';
import type { ReactNode } from 'react';
import './onboarding.css';

// Ostatnia linia obrony: nieobsłużony wyjątek podczas renderu dowolnego panelu
// pokazuje komunikat z przyciskiem przeładowania zamiast pustej strony.
// Tekst nie korzysta z ustawień konta, bo błąd mógł wystąpić przed ich odczytem.
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Portal render failed:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const en =
      typeof navigator !== 'undefined' && navigator.language.startsWith('en');
    return (
      <main className="onboarding onboarding--loading">
        <section className="panel" role="alert">
          <h1>{en ? 'Something went wrong' : 'Coś poszło nie tak'}</h1>
          <p>
            {en
              ? 'The portal hit an unexpected error. Reload the page; your saved data is safe.'
              : 'Portal napotkał nieoczekiwany błąd. Przeładuj stronę; zapisane dane są bezpieczne.'}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => window.location.reload()}
          >
            {en ? 'Reload' : 'Przeładuj'}
          </button>
        </section>
      </main>
    );
  }
}
