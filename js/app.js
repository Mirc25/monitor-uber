import { showToast } from './ui.js';
import { makeBackoff } from './peer.js';
import { APP_STATE, setAppState } from './state.js';

const metrics = {
  connectionsOpened: 0,
  connectionsDropped: 0,
  reconnectAttempts: 0,
  recordingFailures: 0,
  lastError: null
};

window.AppMetrics = metrics;
window.AppBackoff = makeBackoff();
window.AppState = APP_STATE;

let lastClientLogAt = 0;

async function sendClientLog(level, message, extra = {}) {
  const now = Date.now();
  if (now - lastClientLogAt < 1000) return;
  lastClientLogAt = now;

  const apiBase = window.AppConfig?.apiBaseUrl || 'http://localhost:8080';
  try {
    await fetch(`${apiBase}/client-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, extra })
    });
  } catch (_err) {
    // Avoid recursive logging loops when network is down.
  }
}

window.addEventListener('error', (event) => {
  metrics.lastError = String(event.message || 'unknown_error');
  sendClientLog('error', metrics.lastError, {
    filename: event.filename,
    line: event.lineno,
    column: event.colno
  });
  showToast('Error global capturado: ' + metrics.lastError, 'error');
});

window.addEventListener('unhandledrejection', (event) => {
  metrics.lastError = String(event.reason || 'unhandled_rejection');
  sendClientLog('error', metrics.lastError, { type: 'unhandledrejection' });
  showToast('Promesa rechazada: ' + metrics.lastError, 'warn');
});

window.addEventListener('online', () => {
  setAppState({ network: { online: true, lastChangeAt: Date.now() } });
  sendClientLog('info', 'network_online');
  showToast('Conexion recuperada, reintentando...', 'info');
});

window.addEventListener('offline', () => {
  setAppState({ network: { online: false, lastChangeAt: Date.now() } });
  sendClientLog('warn', 'network_offline');
  showToast('Sin internet, esperando reconexion...', 'warn');
});

window.AppLogger = {
  debug: (...args) => console.debug('[APP]', ...args),
  info: (...args) => console.info('[APP]', ...args),
  warn: (...args) => console.warn('[APP]', ...args),
  error: (...args) => console.error('[APP]', ...args)
};
