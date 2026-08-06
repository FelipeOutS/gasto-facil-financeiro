import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/react-start'
import { createRouter } from './router'
import { attemptRecovery } from './lib/recovery'

const router = createRouter()

// Listen for Vite preload errors BEFORE anything else
window.addEventListener('vite:preloadError', (event: any) => {
  event.preventDefault();
  attemptRecovery(new Error('Vite preload error'), 'vite_preload_error');
});

// Global error listener
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

hydrateRoot(document, <StartClient router={router} />)
