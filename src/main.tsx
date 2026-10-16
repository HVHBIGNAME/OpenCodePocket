import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { App, ErrorBoundary } from './App';
import { PocketProvider } from './store/PocketProvider';
import './styles.css';
import { installDiagnosticHandlers } from './lib/diagnostics';
import { initializeAppearance } from './lib/appearance';

installDiagnosticHandlers();
await initializeAppearance();
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <PocketProvider>
      <App />
    </PocketProvider>
  </ErrorBoundary>,
);
