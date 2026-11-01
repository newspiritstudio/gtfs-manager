import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './app/App';
import { preloadLocale, resolveLocale } from './lib/i18n/client';
import './index.css';
import './gtfs.css';
import { registerServiceWorker } from './lib/pwa';
import './outputs.css';

const container = document.getElementById('root')!;
const app = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

registerServiceWorker();

// The texts first, so the first render (or the hydration of a prerendered page) has them.
preloadLocale(resolveLocale(location.pathname)).then(() => {
  if (container.firstElementChild) hydrateRoot(container, app);
  else createRoot(container).render(app);
});
