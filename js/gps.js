export function startGpsWatch(onUpdate, onError) {
  if (!navigator.geolocation) {
    onError?.(new Error('GEOLOCATION_NOT_SUPPORTED'));
    return null;
  }

  return navigator.geolocation.watchPosition(
    (p) => onUpdate?.({ lat: p.coords.latitude, lng: p.coords.longitude, ts: Date.now() }),
    (e) => onError?.(e),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
  );
}

export function stopGpsWatch(watchId) {
  if (watchId == null) return;
  navigator.geolocation.clearWatch(watchId);
}
