/**
 * OfflineQueue — opera primero en memoria, persiste en localStorage.
 * Cuando recupera conexión, vacía la cola automáticamente.
 */

const STORAGE_KEY = 'offline_event_queue';
const MAX_QUEUE = 200;

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch (_e) {
    return [];
  }
}

function save(queue) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch (_e) {
    // Storage full — drop oldest, keep newest.
  }
}

let queue = load();
let flushing = false;

/**
 * Push an event to the offline queue.
 * @param {string} type  - e.g. 'alert', 'log', 'location'
 * @param {object} payload
 */
export function enqueue(type, payload) {
  queue.push({ type, payload, ts: Date.now(), attempts: 0 });
  save(queue);
}

/**
 * Flush pending events to the backend.
 * Safe to call multiple times; prevents concurrent flushes.
 */
export async function flushQueue() {
  if (flushing || queue.length === 0) return;
  if (!navigator.onLine) return;

  flushing = true;
  const apiBase = window.AppConfig?.apiBaseUrl || 'http://localhost:8080';
  const token = window.AppConfig?.getToken?.();

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const remaining = [];

  for (const item of queue) {
    try {
      const endpoint = item.type === 'alert' ? '/api/alerts'
        : item.type === 'location' ? '/api/location'
        : '/api/logs';

      const res = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(item.payload)
      });

      if (!res.ok && res.status !== 422) {
        item.attempts = (item.attempts || 0) + 1;
        if (item.attempts < 5) remaining.push(item);
      }
    } catch (_err) {
      item.attempts = (item.attempts || 0) + 1;
      if (item.attempts < 5) remaining.push(item);
    }
  }

  queue = remaining;
  save(queue);
  flushing = false;

  if (queue.length === 0) {
    window.AppLogger?.info('offline queue flushed');
  }
}

export function queueSize() {
  return queue.length;
}

// Auto-flush on network recovery.
window.addEventListener('online', () => {
  setTimeout(flushQueue, 1500);
});
