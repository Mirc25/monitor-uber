import { showToast } from './ui.js';
import { lazyLoadFaceApi } from './faceapi-loader.js';
import { JWTManager } from './jwt-manager.js';

const jwt = new JWTManager(window.AppConfig?.apiBaseUrl || 'http://localhost:8080');
await jwt.init();

const CENTRAL_ID = 'PABLO-CENTRAL-MASTER-2026';
let peer = null;
let units = {};
let iaActiva = false;
let dbIndexed = null;
let centralConnecting = false;
let centralReconnectTimer = null;
let peerEndpointIndex = 0;

const PEER_ENDPOINTS = [
  { host: '1.peerjs.com', port: 443, secure: true, path: '/' },
  { host: 'asia.peerjs.com', port: 443, secure: true, path: '/' }
];

const PEER_BASE_CONFIG = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  }
};

function setStatusCentral(online, text) {
  const el = document.getElementById('statusCentral');
  if (el) {
    el.textContent = '● ' + text;
    el.className = online ? 'online' : '';
  }
}

function scheduleCentralReconnect(delayMs, statusText) {
  if (statusText) setStatusCentral(false, statusText);
  if (centralReconnectTimer) return;
  centralReconnectTimer = setTimeout(() => {
    centralReconnectTimer = null;
    centralConnecting = false;
    conectarCentral();
  }, delayMs);
}

function conectarCentral() {
  if (centralConnecting) return;
  centralConnecting = true;
  if (centralReconnectTimer) {
    clearTimeout(centralReconnectTimer);
    centralReconnectTimer = null;
  }

  if (peer && !peer.destroyed) {
    try { peer.destroy(); } catch (e) {}
  }

  const endpoint = PEER_ENDPOINTS[peerEndpointIndex % PEER_ENDPOINTS.length];
  const peerOpts = {
    ...PEER_BASE_CONFIG,
    host: endpoint.host,
    port: endpoint.port,
    secure: endpoint.secure,
    path: endpoint.path
  };

  setStatusCentral(false, `CONECTANDO ${endpoint.secure ? 'WSS' : 'WS'}...`);

  peer = new Peer(CENTRAL_ID, peerOpts);
  const activePeer = peer;

  peer.on('open', (id) => {
    if (peer !== activePeer) return;
    centralConnecting = false;
    setStatusCentral(true, 'EN LÍNEA - ' + id + ` (${endpoint.secure ? 'WSS' : 'WS'})`);
  });

  peer.on('connection', (conn) => {
    if (peer !== activePeer) return;
    if (!units[conn.peer]) units[conn.peer] = { lat: 0, lng: 0 };
    units[conn.peer].conn = conn;

    conn.on('data', (data) => {
      if (data.tipo === 'login') manejarLogin(conn, data);
      if (data.tipo === 'gps') actualizarPosicion(conn.peer, data.lat, data.lng);
    });

    conn.on('close', () => {
      const card = document.getElementById('card-' + conn.peer);
      if (card) card.style.opacity = '0.4';
    });
  });

  peer.on('call', (call) => {
    if (peer !== activePeer) return;
    call.answer();
    call.on('stream', (s) => {
      adjuntarStream(call.peer, s);
    });
  });

  peer.on('error', (err) => {
    if (peer !== activePeer) return;
    centralConnecting = false;

    if (err.type === 'unavailable-id') {
      scheduleCentralReconnect(10000, 'ID OCUPADO - ESPERANDO 10s...');
    } else {
      peerEndpointIndex = (peerEndpointIndex + 1) % PEER_ENDPOINTS.length;
      scheduleCentralReconnect(5000, 'ERROR: ' + err.type);
    }
  });

  peer.on('disconnected', () => {
    if (peer !== activePeer) return;
    centralConnecting = false;
    peerEndpointIndex = (peerEndpointIndex + 1) % PEER_ENDPOINTS.length;
    scheduleCentralReconnect(5000, 'DESCONECTADA - RECONECTANDO...');
  });

  peer.on('close', () => {
    if (peer !== activePeer) return;
    centralConnecting = false;
    scheduleCentralReconnect(5000, 'CERRADA - RECONECTANDO...');
  });
}

function manejarLogin(conn, data) {
  const db = JSON.parse(localStorage.getItem('pablo_db') || '[]');
  const usuario = db.find(x => x.nombre === data.nombre?.toUpperCase() && x.token === data.token);

  if (usuario && Date.now() < usuario.vence) {
    crearOActualizarCelda(conn.peer, data.nombre);
    conn.send({ tipo: 'auth_ok' });
  } else {
    conn.send({ tipo: 'auth_fail', msg: 'ACCESO DENEGADO O VENCIDO' });
  }
}

function crearOActualizarCelda(peerId, nombre) {
  const grid = document.getElementById('monitorGrid');
  if (!grid) return;

  let card = document.getElementById('card-' + peerId);
  if (!card) {
    card = document.createElement('div');
    card.id = 'card-' + peerId;
    card.className = 'unit-card';
    card.innerHTML = `
      <div class="unit-header" id="header-${peerId}">${nombre}</div>
      <div class="video-box">
        <video id="v-${peerId}" playsinline autoplay></video>
      </div>
      <div class="unit-actions"></div>
    `;
    grid.appendChild(card);
  }
  card.style.opacity = '1';
}

function adjuntarStream(peerId, stream) {
  const video = document.getElementById('v-' + peerId);
  if (video) {
    video.srcObject = stream;
    video.play().catch(e => console.error('Video play error:', e));
  }
}

function actualizarPosicion(peerId, lat, lng) {
  if (units[peerId]) {
    units[peerId].lat = lat;
    units[peerId].lng = lng;
  }
}

async function escanearIA() {
  if (!iaActiva) return;
  
  // Lazy load de face-api para no bloquear al inicio
  try {
    const faceapi = await lazyLoadFaceApi();
    if (!faceapi) return;

    const vids = document.querySelectorAll('video');
    for (let v of vids) {
      if (v.paused || v.ended || v.readyState < 3) continue;
      try {
        const detections = await faceapi.detectAllFaces(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 }))
          .withFaceLandmarks()
          .withFaceDescriptors();
        // Aquí iría lógica de matching con banco de delincuentes
      } catch (e) {
        console.error('Face-api error:', e);
      }
    }
  } catch (err) {
    console.error('IA scan error:', err);
  }
}

// Iniciar
conectarCentral();
setInterval(escanearIA, 2000);

// Exportar para uso global
window.CentralApp = {
  conectar: conectarCentral,
  getPeer: () => peer,
  getUnits: () => units,
  activarIA: (val) => { iaActiva = val; }
};
