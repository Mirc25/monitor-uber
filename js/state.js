const state = {
  session: {
    active: false,
    unitId: null
  },
  network: {
    online: navigator.onLine,
    lastChangeAt: Date.now(),
    connectionType: navigator.connection?.effectiveType || 'unknown'
  },
  media: {
    localStreamReady: false,
    peerConnected: false
  }
};

const subscribers = new Set();

export const APP_STATE = state;
window.APP_STATE = state;

export function setAppState(patch) {
  if (!patch || typeof patch !== 'object') return;

  Object.keys(patch).forEach((key) => {
    const incoming = patch[key];
    if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
      state[key] = { ...(state[key] || {}), ...incoming };
    } else {
      state[key] = incoming;
    }
  });

  subscribers.forEach((fn) => {
    try {
      fn(state);
    } catch (_err) {
      // Keep state updates resilient even if one subscriber fails.
    }
  });
}

export function subscribeState(fn) {
  if (typeof fn !== 'function') return () => {};
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
