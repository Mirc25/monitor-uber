    // --- Obtener token desde URL ---
    const params = new URLSearchParams(location.search);
    const token = params.get('v');
    const UNIT_PEER_ID = params.get('u');
    const PEER_OPTS = {
        host: '1.peerjs.com',
        port: 443,
        secure: true,
        path: '/',
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                {
                    urls: [
                        'turn:openrelay.metered.ca:80',
                        'turn:openrelay.metered.ca:443',
                        'turn:openrelay.metered.ca:443?transport=tcp'
                    ],
                    username: window.AppConfig?.turnUsername || '',
                    credential: window.AppConfig?.turnCredential || ''
                }
            ]
        }
    };

    const dot       = document.getElementById('dot');
    const statusTxt = document.getElementById('statusText');
    const video     = document.getElementById('remoteVideo');
    const placeholder = document.getElementById('placeholder');
    const endMsg    = document.getElementById('endMsg');
    const audioHint = document.getElementById('audioHint');

    function setStatus(online, texto) {
        dot.className = online ? 'on' : '';
        statusTxt.textContent = texto;
    }

    // --- Mapa ---
    const map = L.map('map', { zoomControl: true }).setView([-31.5375, -68.5364], 14);
    const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles Â© Esri'
    });
    const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: 'Â© OpenStreetMap contributors Â© CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    });
    esri.addTo(map);
    L.control.layers({ 'Esri Streets + POI': esri, 'Carto Voyager': carto }, null, { position: 'bottomright' }).addTo(map);

    // Ãcono de mundo profesional
    const carIcon = L.icon({
        iconUrl: 'https://cdn-icons-png.flaticon.com/512/854/854878.png', // Mundo
        iconSize: [28, 28]
    });
    let marker = null;

    function moverMarcador(lat, lng) {
        const pos = [lat, lng];
        if (!marker) {
            marker = L.marker(pos, { icon: carIcon }).addTo(map);
        } else {
            marker.setLatLng(pos);
        }
        map.panTo(pos);
    }

    // --- Sin token vÃ¡lido ---
    if (!token || token.length < 4 || !UNIT_PEER_ID) {
        setStatus(false, 'Link invÃ¡lido o expirado.');
        endMsg.style.display = 'flex';
    } else {
        iniciarViewer();
    }

    function iniciarViewer(retryCount = 0) {
        // Peer con ID aleatorio para el viewer
        const viewerPeerId = 'VWR-' + Math.random().toString(36).substr(2, 8).toUpperCase();
        let peerV = new Peer(viewerPeerId, PEER_OPTS);
        let streamReceived = false;

        peerV.on('open', () => {
            setStatus(false, 'Conectando con unidad...');

            // 1. ConexiÃ³n de datos para GPS
            const conn = peerV.connect(UNIT_PEER_ID, { reliable: true });
            conn.on('open', () => {
                // Avisar que el viewer estÃ¡ listo para recibir stream
                conn.send({ tipo: 'viewer_ready', token: token });
            });
            conn.on('data', (data) => {
                if (data.tipo === 'gps') moverMarcador(data.lat, data.lng);
                if (data.tipo === 'viewer_denied') {
                    setStatus(false, 'Link invÃ¡lido o expirado.');
                    endMsg.style.display = 'flex';
                }
                if (data.tipo === 'viewer_ok') {
                    setStatus(false, 'Conectado, esperando video...');
                }
            });
            conn.on('error', () => {}); // GPS no crÃ­tico
        });

        // 2. La unidad inicia la llamada de video/audio cuando recibe viewer_ready
        peerV.on('call', (call) => {
            call.answer();
            call.on('stream', (s) => {
                streamReceived = true;
                video.srcObject = s;
                video.muted = true;
                video.style.display = 'block';
                placeholder.style.display = 'none';
                setStatus(true, 'EN VIVO');
                video.play()
                    .then(() => { audioHint.style.display = 'block'; })
                    .catch(() => { audioHint.style.display = 'block'; setStatus(true, 'EN VIVO (tocÃ¡ para activar audio)'); });
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
                        try { peerV.destroy(); } catch(e) {}
                        iniciarViewer(retryCount + 1);
                    }, 2000);
                } else {
                    setStatus(false, 'Unidad no disponible. Â¿El link ya expirÃ³?');
                    endMsg.style.display = 'flex';
                }
            } else if (err.type === 'network' || err.type === 'socket-error' || err.type === 'socket-closed') {
                setStatus(false, 'Sin conexiÃ³n - reintentando...');
                setTimeout(() => { peerV.destroy(); iniciarViewer(retryCount + 1); }, 5000);
            }
        });

        peerV.on('disconnected', () => {
            if (!peerV.destroyed) peerV.reconnect();
        });

        peerV.on('close', () => {
            if (streamReceived) mostrarFin();
            else {
                setStatus(false, 'Reintentando conexiÃ³n de video...');
                setTimeout(() => iniciarViewer(retryCount + 1), 3000);
            }
        });
    }

    function mostrarFin() {
        setStatus(false, 'SesiÃ³n finalizada');
        video.pause();
        video.srcObject = null;
        endMsg.style.display = 'flex';
    }

    audioHint.addEventListener('click', async () => {
        try {
            video.muted = false;
            await video.play();
            audioHint.style.display = 'none';
            setStatus(true, 'EN VIVO');
        } catch (e) {
            setStatus(true, 'EN VIVO (audio bloqueado)');
        }
    });
