import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import { App, ErrorBoundary } from './App';
import { PocketProvider } from './store/PocketProvider';
import './styles.css';

createRoot(document.getElementById('root')!).render(<ErrorBoundary><PocketProvider><App/></PocketProvider></ErrorBoundary>);
