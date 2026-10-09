import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/500.css';
import '@fontsource/eb-garamond/400-italic.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/jetbrains-mono/400.css';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

window.addEventListener('dragover', (event) => {
  event.preventDefault();
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
});

async function boot() {
  if (!window.folio && import.meta.env.DEV && window.location.hash.includes('preview')) {
    const { installPreview } = await import('./preview.js');
    await installPreview();
  }
  createRoot(document.getElementById('root')).render(<App />);
}

boot();
