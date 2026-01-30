import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

function setupLiveReload(): void {
  const host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return;
  if (!('EventSource' in window)) return;
  try {
    const source = new EventSource('/__dev/reload');
    source.addEventListener('reload', () => {
      window.location.reload();
    });
  } catch {
    // ignore live reload errors
  }
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

setupLiveReload();

const root = createRoot(container);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
