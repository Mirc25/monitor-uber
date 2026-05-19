import { Filesystem, Directory } from './capacitor-shim.js';

export class RecordingStore {
  constructor() {
    this.uploadQueue = [];
  }

  async saveRecording({ blob, unitId, reason, timestamp }) {
    try {
      const filename = `recording_${timestamp}_${unitId}.webm`;
      const path = `recordings/${filename}`;

      // Guardar en Capacitor FileSystem
      const base64 = await this.blobToBase64(blob);
      await Filesystem.writeFile({
        path,
        data: base64,
        directory: Directory.Documents,
        recursive: true
      });

      const queueItem = {
        id: `${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
        filename,
        path,
        unitId,
        reason,
        size: blob.size,
        createdAt: timestamp,
        retryCount: 0,
        status: 'pending'
      };

      this.uploadQueue.push(queueItem);
      return queueItem;
    } catch (err) {
      console.error('Error saving recording:', err);
      throw err;
    }
  }

  async listRecordings() {
    try {
      const result = await Filesystem.readdir({
        path: 'recordings',
        directory: Directory.Documents
      });
      return result.files;
    } catch (err) {
      console.error('Error listing recordings:', err);
      return [];
    }
  }

  async deleteRecording(path) {
    try {
      await Filesystem.deleteFile({
        path,
        directory: Directory.Documents
      });
    } catch (err) {
      console.error('Error deleting recording:', err);
    }
  }

  getUploadQueue() {
    return this.uploadQueue.filter(item => item.status === 'pending' || item.status === 'retry');
  }

  markAsUploading(id) {
    const item = this.uploadQueue.find(i => i.id === id);
    if (item) item.status = 'uploading';
  }

  markAsUploaded(id) {
    const item = this.uploadQueue.find(i => i.id === id);
    if (item) item.status = 'uploaded';
  }

  markAsRetry(id) {
    const item = this.uploadQueue.find(i => i.id === id);
    if (item) {
      item.retryCount += 1;
      item.status = item.retryCount >= 3 ? 'failed' : 'retry';
      item.nextRetryAt = Date.now() + (item.retryCount * 5000);
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

export const recordingStore = new RecordingStore();
