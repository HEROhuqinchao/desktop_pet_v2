import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelApp } from './PanelApp';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <PanelApp />
    </StrictMode>,
  );
}
