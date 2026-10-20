import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// ?lvds-export: the hidden window of the command line's export (electron/headlessExport.cjs), not the app.
if (new URLSearchParams(window.location.search).has('lvds-export')) {
  import('./headless/rendererExport').then((m) => m.install());
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
