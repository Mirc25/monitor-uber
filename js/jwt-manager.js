import { Preferences } from './capacitor-shim.js';

export class JWTManager {
  constructor(apiBaseUrl) {
    this.apiBaseUrl = apiBaseUrl || 'http://localhost:8080';
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
  }

  async init() {
    try {
      const { value: access } = await Preferences.get({ key: 'accessToken' });
      const { value: refresh } = await Preferences.get({ key: 'refreshToken' });
      const { value: expires } = await Preferences.get({ key: 'expiresAt' });

      this.accessToken = access || null;
      this.refreshToken = refresh || null;
      this.expiresAt = expires ? Number(expires) : null;

      if (this.isExpired()) {
        await this.clearTokens();
      }
    } catch (err) {
      console.error('Error initializing JWT manager:', err);
    }
  }

  async login(username, password) {
    try {
      const res = await fetch(`${this.apiBaseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        throw new Error(`Login failed: ${res.status}`);
      }

      const data = await res.json();
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.expiresAt = Date.now() + (data.expiresIn * 1000);

      await Preferences.set({ key: 'accessToken', value: this.accessToken });
      await Preferences.set({ key: 'refreshToken', value: this.refreshToken });
      await Preferences.set({ key: 'expiresAt', value: String(this.expiresAt) });

      return { ok: true, user: data.user };
    } catch (err) {
      console.error('Login error:', err);
      return { ok: false, error: err.message };
    }
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      return { ok: false, error: 'NO_REFRESH_TOKEN' };
    }

    try {
      const res = await fetch(`${this.apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken })
      });

      if (!res.ok) {
        await this.clearTokens();
        throw new Error(`Refresh failed: ${res.status}`);
      }

      const data = await res.json();
      this.accessToken = data.accessToken;
      this.refreshToken = data.refreshToken;
      this.expiresAt = Date.now() + (data.expiresIn * 1000);

      await Preferences.set({ key: 'accessToken', value: this.accessToken });
      await Preferences.set({ key: 'refreshToken', value: this.refreshToken });
      await Preferences.set({ key: 'expiresAt', value: String(this.expiresAt) });

      return { ok: true };
    } catch (err) {
      console.error('Refresh error:', err);
      return { ok: false, error: err.message };
    }
  }

  getAccessToken() {
    if (this.isExpired()) {
      return null;
    }
    return this.accessToken;
  }

  async getValidAccessToken() {
    if (this.isExpired()) {
      const result = await this.refreshAccessToken();
      if (!result.ok) {
        return null;
      }
    }
    return this.accessToken;
  }

  isExpired() {
    if (!this.expiresAt) return true;
    return Date.now() >= this.expiresAt - 60000; // 1 minuto antes de expirar
  }

  async clearTokens() {
    await Preferences.remove({ key: 'accessToken' });
    await Preferences.remove({ key: 'refreshToken' });
    await Preferences.remove({ key: 'expiresAt' });

    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
  }

  async logout() {
    if (this.refreshToken) {
      try {
        await fetch(`${this.apiBaseUrl}/auth/logout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken })
        });
      } catch (err) {
        console.error('Logout error:', err);
      }
    }
    await this.clearTokens();
  }
}
