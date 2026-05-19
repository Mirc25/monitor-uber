import { Preferences } from '@capacitor/preferences';

/**
 * Supabase Storage adapter para grabaciones
 * Configurar env vars: SUPABASE_URL, SUPABASE_ANON_KEY
 */
export class SupabaseStorageAdapter {
  constructor(supabaseUrl, anonKey) {
    this.supabaseUrl = supabaseUrl;
    this.anonKey = anonKey;
    this.bucket = 'grabaciones';
  }

  async init() {
    // Verificar que Supabase esté configurado
    if (!this.supabaseUrl || !this.anonKey) {
      console.warn('Supabase no configurado, usando almacenamiento local');
      return false;
    }
    return true;
  }

  async uploadRecording(blob, fileName, unitId) {
    if (!this.supabaseUrl || !this.anonKey) {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    }

    const base64 = await this.blobToBase64(blob);
    const filePath = `${unitId}/${fileName}`;

    try {
      const response = await fetch(
        `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${filePath}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.anonKey}`,
            'content-type': blob.type
          },
          body: base64
        }
      );

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status}`);
      }

      return {
        ok: true,
        path: filePath,
        url: `${this.supabaseUrl}/storage/v1/object/public/${this.bucket}/${filePath}`
      };
    } catch (err) {
      console.error('Upload error:', err);
      throw err;
    }
  }

  async deleteRecording(filePath) {
    if (!this.supabaseUrl || !this.anonKey) return;

    try {
      await fetch(
        `${this.supabaseUrl}/storage/v1/object/${this.bucket}/${filePath}`,
        {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${this.anonKey}`
          }
        }
      );
    } catch (err) {
      console.error('Delete error:', err);
    }
  }

  async blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export async function initSupabaseStorage() {
  const supabaseUrl = await Preferences.get({ key: 'supabaseUrl' }).then(r => r.value);
  const supabaseKey = await Preferences.get({ key: 'supabaseAnonKey' }).then(r => r.value);

  return new SupabaseStorageAdapter(supabaseUrl, supabaseKey);
}
