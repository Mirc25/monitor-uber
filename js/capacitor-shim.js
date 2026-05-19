const plugins = window.Capacitor?.Plugins || {};
const STORAGE_PREFIX = 'cap_pref:';
const FS_PREFIX = 'cap_fs:';

function hasMethod(obj, method) {
  return !!obj && typeof obj[method] === 'function';
}

export const Preferences = {
  async get({ key }) {
    if (hasMethod(plugins.Preferences, 'get')) {
      return plugins.Preferences.get({ key });
    }
    return { value: localStorage.getItem(STORAGE_PREFIX + key) };
  },

  async set({ key, value }) {
    if (hasMethod(plugins.Preferences, 'set')) {
      return plugins.Preferences.set({ key, value });
    }
    localStorage.setItem(STORAGE_PREFIX + key, value ?? '');
    return {};
  },

  async remove({ key }) {
    if (hasMethod(plugins.Preferences, 'remove')) {
      return plugins.Preferences.remove({ key });
    }
    localStorage.removeItem(STORAGE_PREFIX + key);
    return {};
  }
};

export const Directory = {
  Documents: 'DOCUMENTS'
};

export const Filesystem = {
  async writeFile({ path, data }) {
    if (hasMethod(plugins.Filesystem, 'writeFile')) {
      return plugins.Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true });
    }
    localStorage.setItem(FS_PREFIX + path, data || '');
    return {};
  },

  async readdir({ path }) {
    if (hasMethod(plugins.Filesystem, 'readdir')) {
      return plugins.Filesystem.readdir({ path, directory: Directory.Documents });
    }

    const prefix = FS_PREFIX + path.replace(/\\/g, '/') + '/';
    const files = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      files.push({ name: key.slice(prefix.length) });
    }
    return { files };
  },

  async deleteFile({ path }) {
    if (hasMethod(plugins.Filesystem, 'deleteFile')) {
      return plugins.Filesystem.deleteFile({ path, directory: Directory.Documents });
    }
    localStorage.removeItem(FS_PREFIX + path);
    return {};
  }
};

export const Camera = {
  async requestPermissions() {
    if (hasMethod(plugins.Camera, 'requestPermissions')) {
      return plugins.Camera.requestPermissions();
    }
    return { camera: 'granted' };
  }
};

export const Geolocation = {
  async requestPermissions() {
    if (hasMethod(plugins.Geolocation, 'requestPermissions')) {
      return plugins.Geolocation.requestPermissions();
    }
    return { location: 'granted' };
  }
};

export const LocalNotifications = {
  async requestPermissions() {
    if (hasMethod(plugins.LocalNotifications, 'requestPermissions')) {
      return plugins.LocalNotifications.requestPermissions();
    }
    return { notifications: 'granted' };
  }
};

export const App = {
  async addListener(eventName, listenerFunc) {
    if (hasMethod(plugins.App, 'addListener')) {
      return plugins.App.addListener(eventName, listenerFunc);
    }
    return { remove: async () => {} };
  }
};
