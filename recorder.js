export function pickRecorderMimeType() {
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

export function createRecorder(stream, onChunk) {
  const mimeType = pickRecorderMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) onChunk?.(e.data);
  };
  return recorder;
}

export function buildUploadQueueItem({ blob, unitId, reason }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    unitId,
    reason,
    createdAt: Date.now(),
    retryCount: 0,
    blobSize: blob.size,
    status: 'pending'
  };
}
