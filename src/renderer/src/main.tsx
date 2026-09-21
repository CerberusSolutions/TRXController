import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import MapApp from './components/MapApp';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.hash === '#map' ? <MapApp /> : <App />}
  </React.StrictMode>,
);
