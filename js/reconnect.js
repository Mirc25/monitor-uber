import { showToast } from './ui.js';

export class RobustReconnectManager {
  constructor() {
    this.peerRef = null;
    this.backoff = { attempt: 0, initialDelay: 1000, maxDelay: 30000, factor: 2 };
    this.watchdogInterval = null;
    this.heartbeatInterval = null;
    this.lastHeartbeatAt = Date.now();
    this.onlineStatusWatch = null;
    this.offlineHandler = null;
    this.onlineHandler = null;
    this.connectionChangeHandler = null;
  }

  init(peerRefFn, onReconnect) {
    this.peerRef = peerRefFn;
    this.onReconnect = onReconnect;

    this.offlineHandler = () => this.handleOffline();
    this.onlineHandler = () => this.handleOnline();
    this.connectionChangeHandler = () => this.handleConnectionChange();

    window.addEventListener('offline', this.offlineHandler);
    window.addEventListener('online', this.onlineHandler);
    navigator.connection?.addEventListener?.('change', this.connectionChangeHandler);

    this.startHeartbeat();
    this.startWatchdog();
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.lastHeartbeatAt = Date.now();
      if (typeof window.AppMetrics !== 'undefined') {
        // Enviar heartbeat a backend si es necesario
      }
    }, 12000);
  }

  startWatchdog() {
    this.watchdogInterval = setInterval(() => {
      const peer = this.peerRef?.();
      if (!peer || peer.destroyed) return;

      const now = Date.now();
      const timeSinceHeartbeat = now - this.lastHeartbeatAt;

      // Si pasaron más de 30s sin heartbeat, reconectar
      if (timeSinceHeartbeat > 30000) {
        showToast('Heartbeat timeout - reconectando...', 'warn');
        this.triggerReconnect('heartbeat_timeout');
        return;
      }

      // Si peer está desconectado, reconectar
      if (peer.disconnected) {
        if (!peer.destroyed) {
          peer.reconnect();
        }
        this.triggerReconnect('peer_disconnected');
      }
    }, 5000);
  }

  handleOffline() {
    showToast('SIN INTERNET - esperando reconexión...', 'error');
    this.clearIntervals();
  }

  handleOnline() {
    showToast('RED RECUPERADA - reconectando...', 'info');
    this.backoff.attempt = 0;
    this.startHeartbeat();
    this.startWatchdog();
    this.triggerReconnect('network_online');
  }

  handleConnectionChange() {
    const effectiveType = navigator.connection?.effectiveType || 'unknown';
    showToast(`Cambio de red detectado (${effectiveType})`, 'info');
    this.backoff.attempt = 0;
    this.triggerReconnect('network_change');
  }

  triggerReconnect(reason) {
    const delay = Math.min(
      this.backoff.initialDelay * Math.pow(this.backoff.factor, this.backoff.attempt),
      this.backoff.maxDelay
    );
    this.backoff.attempt += 1;

    setTimeout(() => {
      if (navigator.onLine && this.onReconnect) {
        this.onReconnect(reason);
      }
    }, delay);
  }

  clearIntervals() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  destroy() {
    this.clearIntervals();
    if (this.offlineHandler) {
      window.removeEventListener('offline', this.offlineHandler);
    }
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
    }
    if (this.connectionChangeHandler) {
      navigator.connection?.removeEventListener?.('change', this.connectionChangeHandler);
    }
    this.offlineHandler = null;
    this.onlineHandler = null;
    this.connectionChangeHandler = null;
  }
}

export const reconnectManager = new RobustReconnectManager();
