export function getPeerIceConfig() {
  const turnUsername = window.AppConfig?.turnUsername || '';
  const turnCredential = window.AppConfig?.turnCredential || '';

  const turnBlock = turnUsername && turnCredential
    ? [{
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp'
        ],
        username: turnUsername,
        credential: turnCredential
      }]
    : [];

  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      ...turnBlock
    ]
  };
}

export function makeBackoff() {
  const cfg = window.AppConfig?.reconnect || { initialDelay: 1000, maxDelay: 30000, factor: 2 };
  let attempt = 0;
  return {
    reset() { attempt = 0; },
    next() {
      const delay = Math.min(cfg.initialDelay * Math.pow(cfg.factor, attempt), cfg.maxDelay);
      attempt += 1;
      return delay;
    }
  };
}
