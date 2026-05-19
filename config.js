// __API_URL__ se inyecta en build time por Vite (VITE_API_URL env var).
// En desarrollo cae al valor de localStorage o localhost.
const _buildTimeApi = typeof __API_URL__ !== 'undefined' ? __API_URL__ : '';

window.AppConfig = {
  apiBaseUrl: _buildTimeApi || localStorage.getItem('apiBaseUrl') || 'http://localhost:8080',
  signalingPath: '/ws',
  turnUsername: localStorage.getItem('turnUsername') || '',
  turnCredential: localStorage.getItem('turnCredential') || '',
  heartbeatMs: 12000,
  reconnect: {
    initialDelay: 1000,
    maxDelay: 30000,
    factor: 2
  }
};
