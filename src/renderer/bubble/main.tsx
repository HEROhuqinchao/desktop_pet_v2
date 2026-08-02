import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BubbleApp } from './BubbleApp';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <BubbleApp />
    </StrictMode>,
  );
}
