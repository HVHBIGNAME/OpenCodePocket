import { createRoot } from 'react-dom/client';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { App, ErrorBoundary } from './App';
import { PocketProvider } from './store/PocketProvider';
import './styles.css';
import { installDiagnosticHandlers } from './lib/diagnostics';
import { initializeAppearance } from './lib/appearance';

initializeAppearance();
installDiagnosticHandlers();
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <PocketProvider>
      <App />
    </PocketProvider>
  </ErrorBoundary>,
);
