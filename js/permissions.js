import { App } from '@capacitor/app';
import { Camera } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';

export class PermissionsManager {
  static async requestCorePermissions() {
    const results = {
      camera: false,
      microphone: false,
      location: false,
      notifications: false
    };

    try {
      // Camera
      const camResult = await Camera.requestPermissions();
      results.camera = camResult?.camera === 'granted' || camResult?.camera === 'prompt-only';
    } catch (err) {
      console.error('Camera permission error:', err);
    }

    try {
      // Geolocation
      const locResult = await Geolocation.requestPermissions();
      results.location = locResult?.location === 'granted' || locResult?.location === 'prompt-only';
    } catch (err) {
      console.error('Location permission error:', err);
    }

    try {
      // Notifications
      const notifResult = await LocalNotifications.requestPermissions();
      results.notifications = notifResult?.notifications === 'granted';
    } catch (err) {
      console.error('Notifications permission error:', err);
    }

    return results;
  }

  static async verifyPermissions() {
    const status = {};

    try {
      status.camera = await Camera.requestPermissions();
    } catch (err) {
      status.camera = 'error';
    }

    try {
      status.geolocation = await Geolocation.requestPermissions();
    } catch (err) {
      status.geolocation = 'error';
    }

    return status;
  }
}

// Inicializar en app startup
export async function initPermissionsOnStartup() {
  if (!window.Capacitor?.isNativePlatform?.()) {
    return;
  }

  const perms = await PermissionsManager.requestCorePermissions();
  console.log('Permissions granted:', perms);

  if (!perms.camera) {
    console.warn('Camera permission not granted');
  }
  if (!perms.location) {
    console.warn('Location permission not granted');
  }
}
