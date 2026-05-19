export async function openLocalStream() {
  return navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 640, max: 960 },
      height: { ideal: 360, max: 540 },
      frameRate: { ideal: 15, max: 20 }
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
}

export function closeStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
}

export function hasLiveVideoTrack(stream) {
  if (!stream) return false;
  return stream.getVideoTracks().some((t) => t.readyState === 'live');
}
