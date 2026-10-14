import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/base.css';
import './styles/cards.css';
import { App } from './App';
import { ThemeProvider } from './lib/useTheme';
import { ToastProvider } from './lib/Toast';
import { CatalogueProvider } from './state/catalogue';
import { LibraryProvider } from './state/library';

const BASE = import.meta.env.BASE_URL;

/* Hosted as static files the entry can arrive as ".../index.html"; the router only knows the directory. */
if (/\/index\.html?$/.test(window.location.pathname)) {
  window.history.replaceState(null, '', BASE);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <CatalogueProvider>
          <LibraryProvider>
            <BrowserRouter
              basename={BASE}
              future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
            >
              <App />
            </BrowserRouter>
          </LibraryProvider>
        </CatalogueProvider>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
