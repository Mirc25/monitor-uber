import { showToast } from './ui.js';

const params = new URLSearchParams(location.search);
const token = params.get('v');
const UNIT_PEER_ID = params.get('u');

const statusBar = document.getElementById('statusBar');
const dot = document.getElementById('dot');
const statusTxt = document.getElementById('statusText');
const video = document.getElementById('remoteVideo');
const placeholder = document.getElementById('placeholder');
const endMsg = document.getElementById('endMsg');
const audioHint = document.getElementById('audioHint');

function setStatus(online, text) {
  if (dot) dot.className = online ? 'on' : '';
  if (statusTxt) statusTxt.textContent = text;
}

// Mapa
const map = window.L?.map('map', { zoomControl: true }).setView([-31.5375, -68.5364], 14);
const esri = window.L?.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles © Esri'
});
if (esri) esri.addTo(map);

const carIcon = window.L?.icon({
  iconUrl: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
  iconSize: [28, 28]
});
let marker = null;

function moverMarcador(lat, lng) {
  const pos = [lat, lng];
  if (!marker) {
    marker = window.L?.marker(pos, { icon: carIcon }).addTo(map);
  } else {
    marker?.setLatLng(pos);
  }
  map?.panTo(pos);
}

// Validación inicial
if (!token || token.length < 4 || !UNIT_PEER_ID) {
  setStatus(false, 'Link inválido o expirado.');
  if (endMsg) endMsg.style.display = 'flex';
} else {
  iniciarViewer();
}

function iniciarViewer(retryCount = 0) {
  const viewerPeerId = 'VWR-' + Math.random().toString(36).substr(2, 8).toUpperCase();
  let peerV = new Peer(viewerPeerId, {
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

  let streamReceived = false;

  peerV.on('open', () => {
    setStatus(false, 'Conectando con unidad...');

    const conn = peerV.connect(UNIT_PEER_ID, { reliable: true });
    conn.on('open', () => {
      conn.send({ tipo: 'viewer_ready', token: token });
    });
    conn.on('data', (data) => {
      if (data.tipo === 'gps') moverMarcador(data.lat, data.lng);
      if (data.tipo === 'viewer_denied') {
        setStatus(false, 'Link inválido o expirado.');
        if (endMsg) endMsg.style.display = 'flex';
      }
      if (data.tipo === 'viewer_ok') {
        setStatus(false, 'Conectado, esperando video...');
      }
    });
    conn.on('error', () => {});
  });

  peerV.on('call', (call) => {
    call.answer();
    call.on('stream', (s) => {
      streamReceived = true;
      if (video) {
        video.srcObject = s;
        video.muted = true;
        video.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
        setStatus(true, 'EN VIVO');
        video.play()
          .then(() => {
            if (audioHint) audioHint.style.display = 'block';
          })
          .catch(() => {
            setStatus(true, 'EN VIVO (tocá para activar audio)');
          });
      }
    });
    call.on('close', () => {
      if (streamReceived) mostrarFin();
    });
    call.on('error', () => {
      if (!streamReceived) setStatus(false, 'Sin video - reintentando...');
    });
  });

  peerV.on('error', (err) => {
    if (err.type === 'peer-unavailable') {
      if (retryCount < 30) {
        setStatus(false, 'Unidad preparando enlace... reintentando (' + (retryCount + 1) + '/30)');
        setTimeout(() => {
          try { peerV.destroy(); } catch (e) {}
          iniciarViewer(retryCount + 1);
        }, 2000);
      } else {
        setStatus(false, 'Unidad no disponible. ¿El link ya expiró?');
        if (endMsg) endMsg.style.display = 'flex';
      }
    } else if (err.type === 'network' || err.type === 'socket-error' || err.type === 'socket-closed') {
      setStatus(false, 'Sin conexión - reintentando...');
      setTimeout(() => { peerV.destroy(); iniciarViewer(retryCount + 1); }, 5000);
    }
  });

  peerV.on('disconnected', () => {
    if (!peerV.destroyed) peerV.reconnect();
  });

  peerV.on('close', () => {
    if (streamReceived) mostrarFin();
    else {
      setStatus(false, 'Reintentando conexión de video...');
      setTimeout(() => iniciarViewer(retryCount + 1), 3000);
    }
  });
}

function mostrarFin() {
  setStatus(false, 'Sesión finalizada');
  if (video) {
    video.pause();
    video.srcObject = null;
  }
  if (endMsg) endMsg.style.display = 'flex';
}

if (audioHint) {
  audioHint.addEventListener('click', async () => {
    try {
      if (video) {
        video.muted = false;
        await video.play();
        audioHint.style.display = 'none';
        setStatus(true, 'EN VIVO');
      }
    } catch (e) {
      setStatus(true, 'EN VIVO (audio bloqueado)');
    }
  });
}
