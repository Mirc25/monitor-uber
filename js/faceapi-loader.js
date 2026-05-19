let faceApiLoaded = false;
let faceApiPromise = null;

export async function lazyLoadFaceApi() {
  if (faceApiLoaded) {
    return window.faceapi;
  }

  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      try {
        // Script ya está en vendor, solo esperar a que esté disponible
        if (window.faceapi) {
          faceApiLoaded = true;
          return window.faceapi;
        }

        // Si no está disponible, cargar dinámicamente
        return new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = './vendor/face-api.js';
          script.onload = () => {
            faceApiLoaded = true;
            resolve(window.faceapi);
          };
          script.onerror = () => reject(new Error('Failed to load face-api'));
          document.head.appendChild(script);
        });
      } catch (err) {
        console.error('Error loading face-api:', err);
        faceApiLoaded = false;
        throw err;
      }
    })();
  }

  return faceApiPromise;
}

export function isFaceApiLoaded() {
  return faceApiLoaded;
}
