import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './theme/tokens.css';
import './styles.css';
import { loadPrefs } from './model/profile';
import { applyTheme } from './theme/theme';

// ?lvds-export: the hidden window of the command line's export (electron/headlessExport.cjs), not the app.
if (new URLSearchParams(window.location.search).has('lvds-export')) {
  import('./headless/rendererExport').then((m) => m.install());
} else {
  // Before the first paint, so a light-theme user never sees a dark flash.
  applyTheme(loadPrefs().app.theme);
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
