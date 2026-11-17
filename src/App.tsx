import ConnectedAccount from './ConnectedAccount';
import ErrorBoundary from './ErrorBoundary';
import { ThemeProvider } from './lib/theme';
import './theme.css';

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <ConnectedAccount />
      </ErrorBoundary>
      <p className="demo-badge" role="note">
        Demo · dane fikcyjne
      </p>
    </ThemeProvider>
  );
}
