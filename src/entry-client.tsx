import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/react-router'

import { getRouter } from './router'
import { attemptRecovery } from './lib/recovery'

const router = getRouter()

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event: any) => {
    event.preventDefault();
    attemptRecovery(new Error('Vite preload error'), 'vite_preload_error');
  });

  window.addEventListener('error', (event) => {
    const error = event.error;
    if (error && (
      error.message?.includes('chunk') || 
      error.message?.includes('dynamically imported') ||
      error.message?.includes('module script failed')
    )) {
      attemptRecovery(error, 'chunk_load_error');
    }
  });
}

hydrateRoot(document, <StartClient router={router} />)

