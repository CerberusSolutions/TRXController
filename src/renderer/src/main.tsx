import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import MapApp from './components/MapApp';
import ProgrammingApp from './components/ProgrammingApp';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.hash === '#map' ? <MapApp /> : window.location.hash === '#programming' ? <ProgrammingApp /> : <App />}
  </React.StrictMode>,
);
