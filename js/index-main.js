import { showToast, updateConnectionBadge } from './ui.js';
import { openLocalStream, closeStream, hasLiveVideoTrack } from './camera.js';
import { startGpsWatch, stopGpsWatch } from './gps.js';
import { createRecorder, buildUploadQueueItem } from './recorder.js';
import { reconnectManager } from './reconnect.js';
import { recordingStore } from './storage.js';
import { JWTManager } from './jwt-manager.js';
import { initPermissionsOnStartup } from './permissions.js';
import { initSupabaseStorage } from './supabase-storage.js';

// Inicialización

// Permisos Android
await initPermissionsOnStartup();

// Cloud storage
const supabaseStorage = await initSupabaseStorage(); global
const jwt = new JWTManager(window.AppConfig?.apiBaseUrl || 'http://localhost:8080');
await jwt.init();

let sessionActive = false;
let miStream = null;
let peer = null;
let connCentral = null;
let watchId = null;

const setupForm = document.getElementById('setup');
const monitorActivo = document.getElementById('monitor-activo');
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('dot');
const localVideo = document.getElementById('localVideo');

function setStatus(text, online) {
  statusText.textContent = text;
  statusDot.className = 'status-dot' + (online ? ' status-on' : '');
}

// Botón ACTIVAR
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.querySelector('button[onclick="validarYActivar()"]');
  if (btn) {
    btn.onclick = async () => {
      const unitIdInput = document.getElementById('unidadId');
      const tokenInput = document.getElementById('tokenAcceso');

      const unitId = (unitIdInput?.value || '').trim();
      const token = (tokenInput?.value || '').trim();

      if (!unitId || !token) {
        showToast('Completá ID y TOKEN', 'warn');
        return;
      }

      if (token.length < 4) {
        showToast('TOKEN debe tener al menos 4 caracteres', 'warn');
        return;
      }

      await activarSesion(unitId, token);
    };
  }

  const cerrarBtn = document.querySelector('button[onclick="cerrarSesionYSalir()"]');
  if (cerrarBtn) {
    cerrarBtn.onclick = cerrarSesion;
  }

  const videoBtn = document.querySelector('button[onclick="toggleMisVideos()"]');
  if (videoBtn) {
    videoBtn.onclick = togglMisVideos;
  }

  const qrBtn = document.querySelector('button[onclick="abrirQrViaje()"]');
  if (qrBtn) {
    qrBtn.onclick = abrirQrViaje;
  }
});

async function activarSesion(unitId, token) {
  try {
    sessionActive = true;
    setStatus('INICIALIZANDO...', false);

    // Obtener stream de cámara
    miStream = await openLocalStream();
    if (!miStream) {
      showToast('No se pudo acceder a cámara/micrófono', 'error');
      sessionActive = false;
      return;
    }

    if (localVideo) {
      localVideo.srcObject = miStream;
      localVideo.play().catch(e => console.error('Video play error:', e));
    }

    // Iniciar GPS
    watchId = startGpsWatch(
      (pos) => {
        if (connCentral?.open) {
          connCentral.send({ tipo: 'gps', lat: pos.lat, lng: pos.lng });
        }
      },
      (err) => console.error('GPS error:', err)
    );

    // Conectar con central
    await conectarCentral(unitId, token);

    // Mostrar UI activa
    if (setupForm) setupForm.style.display = 'none';
    if (monitorActivo) monitorActivo.style.display = 'block';

    // Iniciar procesamiento de cola de grabaciones
    procesarColaGrabaciones();

    // Iniciar reconexión robusta
    reconnectManager.init(
      () => peer,
      (reason) => conectarCentral(unitId, token)
    );

    setStatus('EN LÍNEA', true);
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    sessionActive = false;
    closeStream(miStream);
    stopGpsWatch(watchId);
  }
}

async function conectarCentral(unitId, token) {
  try {
    setStatus('CONECTANDO...', false);

    if (peer && !peer.destroyed) {
      try { peer.destroy(); } catch (e) {}
    }

    const config = window.AppConfig || {};
    peer = new Peer('UNIT-' + unitId + '-' + Date.now(), {
      host: '1.peerjs.com',
      port: 443,
      secure: true,
      path: '/',
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });

    peer.on('open', () => {
      connCentral = peer.connect('PABLO-CENTRAL-MASTER-2026', { reliable: true });
      connCentral.on('open', () => {
        connCentral.send({
          tipo: 'login',
          unitId: unitId,
          token: token,
          peerId: peer.id
        });
        setStatus('EN LÍNEA', true);
      });

      connCentral.on('data', (data) => {
        if (data.tipo === 'auth_ok') {
          setStatus('AUTENTICADO', true);
        } else if (data.tipo === 'auth_fail') {
          showToast('Autenticación rechazada', 'error');
          cerrarSesion();
        }
      });
    });

    peer.on('call', (call) => {
      if (miStream && hasLiveVideoTrack(miStream)) {
        call.answer(miStream);
      }
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      showToast('Error de conexión: ' + err.type, 'error');
    });

    peer.on('disconnected', () => {
      if (sessionActive) {
        setStatus('DESCONECTADO - RECONECTANDO...', false);
      }
    });
  } catch (err) {
    console.error('Central connection error:', err);
    showToast('Error conectando: ' + err.message, 'error');
  }
}

async function cerrarSesion() {
  sessionActive = false;
  reconnectManager.destroy();

  if (connCentral?.open) {
    try { connCentral.close(); } catch (e) {}
  }

  if (peer && !peer.destroyed) {
    try { peer.destroy(); } catch (e) {}
  }

  stopGpsWatch(watchId);
  closeStream(miStream);

  await jwt.logout();

  if (setupForm) setupForm.style.display = 'block';
  if (monitorActivo) monitorActivo.style.display = 'none';

  setStatus('SESIÓN CERRADA', false);
  showToast('Sesión finalizada', 'info');
}

async function togglMisVideos() {
  const panel = document.getElementById('misVideosPanel');
  if (!panel) return;

  const isVisible = panel.style.display !== 'none';
  panel.style.display = isVisible ? 'none' : 'block';

  if (!isVisible) {
    const recordings = await recordingStore.listRecordings();
    const list = document.getElementById('misVideosList');
    if (list) {
      list.innerHTML = recordings.length
        ? recordings.map(r => `<div class="video-item"><strong>${r.name}</strong></div>`).join('')
        : 'No hay grabaciones aún.';
    }
  }
}

async function abrirQrViaje() {
  const modal = document.getElementById('qrModal');
  if (!modal) return;

  modal.style.display = 'flex';

  // Generar QR con token temporal
  const viajeToken = 'VIJ-' + Math.random().toString(36).slice(2, 9);
  const link = `${window.location.origin}/viewer.html?v=${viajeToken}&u=${peer?.id}`;

  const canvas = document.getElementById('qrCanvasWrap');
  if (canvas && window.QRCode) {
    canvas.innerHTML = '';
    new window.QRCode(canvas, { text: link, width: 260, height: 260, colorDark: '#000', colorLight: '#fff' });
  }

  const linkText = document.getElementById('qrLinkText');
  if (linkText) linkText.textContent = link;
}

// Exportar para uso global si es necesario
window.AppSession = {
  isActive: () => sessionActive,
  cerrar: cerrarSesion,
  getStream: () => miStream
};

async function procesarColaGrabaciones() {
  if (!sessionActive) return;

  const queue = recordingStore.getUploadQueue();
  for (const item of queue) {
    if (item.status !== 'pending' && item.status !== 'retry') continue;

    try {
      recordingStore.markAsUploading(item.id);

      // Intentar subir a Supabase si está configurado
      const result = await supabaseStorage.uploadRecording(item.blob, item.filename, item.unitId);
      if (result.ok) {
        recordingStore.markAsUploaded(item.id);
        showToast('Grabación subida: ' + item.filename, 'info');
      }
    } catch (err) {
      console.error('Upload error:', err);
      recordingStore.markAsRetry(item.id);
    }
  }

  // Reintentar en 30s
  setTimeout(procesarColaGrabaciones, 30000);
}
