import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PetApp } from './PetApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PetApp />
  </StrictMode>,
);
