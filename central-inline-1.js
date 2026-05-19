    let peer, mainMap, mainMapExpanded, dbIndexed, iaActiva = false;
    let centralReconnectTimer = null;
    let centralConnecting = false;
    let localStream = null, floatingMap = null, floatingMarker = null;
    let floatingTrackLine = null, floatingTrackPoints = [];
    let floatingCurrentPid = null, floatingCurrentNombre = '';
    let floatingFollow = true, floatingPoiOn = false;
    let floatingPoiLayer = null;
    let riskZonesLayer = null, riskZonesLayerExpanded = null;
    let poiLayerMain = null, poiLayerExpanded = null;
    let geocodeMarkerMain = null, geocodeMarkerExpanded = null;
    let riskZones = [];
    const units = {};
    const pendingUnitStreams = {};
    const CENTRAL_ID = 'PABLO-CENTRAL-MASTER-2026';
    const PEER_BASE_CONFIG = {
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
    const PEER_ENDPOINTS = [
        { host: '1.peerjs.com', port: 443, secure: true, path: '/' },
        { host: '0.peerjs.com', port: 443, secure: true, path: '/' },
        { host: '0.peerjs.com', port: 80, secure: false, path: '/' },
        { host: '1.peerjs.com', port: 80, secure: false, path: '/' }
    ];
    let peerEndpointIndex = 0;
    const RISK_ZONES_KEY = 'pablo_risk_zones_v1';
    const DEFAULT_ZONE_RADIUS_METERS = 700;
    const MIN_ZONE_RADIUS_METERS = 450;
    const MAX_ZONE_RADIUS_METERS = 2000;
    const alarmAudio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
    alarmAudio.loop = true;

    const carIcon = L.icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/3202/3202926.png', iconSize: [25, 25], className: 'fuchsia-car' });
    const sosIcon = L.icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/3202/3202926.png', iconSize: [30, 30], className: 'sos-car' });
    const riskIcon = L.icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/3202/3202926.png', iconSize: [30, 30], className: 'risk-car' });

    const request = indexedDB.open("PabloSecurity_Folder", 1);
    request.onupgradeneeded = (e) => { e.target.result.createObjectStore("delincuentes", { keyPath: "id", autoIncrement: true }); };
    request.onsuccess = (e) => { dbIndexed = e.target.result; cargarListaNegraVisual(); };

    function setStatusCentral(online, texto) {
        const el = document.getElementById('statusCentral');
        el.innerText = 'â— ' + texto;
        el.className = online ? 'online' : '';
    }

    function attachUnitStream(peerId, stream) {
        const v = document.getElementById('v-' + peerId);
        if (!v) {
            pendingUnitStreams[peerId] = stream;
            return;
        }
        v.srcObject = stream;
        v.muted = true;
        v.play().catch(() => {});
        delete pendingUnitStreams[peerId];
    }

    function updateGpsHud(nombre, lat, lng) {
        const chofer = document.getElementById('hudChofer');
        const hora = document.getElementById('hudHora');
        const latEl = document.getElementById('hudLat');
        const lngEl = document.getElementById('hudLng');
        if (chofer) chofer.innerText = nombre || floatingCurrentNombre || '-';
        if (hora) hora.innerText = new Date().toLocaleTimeString();
        if (latEl) latEl.innerText = Number(lat || 0).toFixed(6);
        if (lngEl) lngEl.innerText = Number(lng || 0).toFixed(6);
    }

    function addTrackPoint(lat, lng) {
        if (!floatingMap) return;
        floatingTrackPoints.push([lat, lng]);
        if (floatingTrackPoints.length > 300) floatingTrackPoints.shift();
        if (!floatingTrackLine) {
            floatingTrackLine = L.polyline(floatingTrackPoints, { color: '#4fd1ff', weight: 3, opacity: 0.85 }).addTo(floatingMap);
        } else {
            floatingTrackLine.setLatLngs(floatingTrackPoints);
        }
    }

    function centrarMapaChofer() {
        if (!floatingMap || !floatingMarker) return;
        floatingMap.setView(floatingMarker.getLatLng(), 16);
    }

    function toggleSeguirChofer() {
        floatingFollow = !floatingFollow;
        const btn = document.getElementById('btnFollowDriver');
        if (btn) {
            btn.classList.toggle('on', floatingFollow);
            btn.innerText = floatingFollow ? 'SEGUIR ON' : 'SEGUIR OFF';
        }
    }

    async function loadPoiChofer() {
        if (!floatingMap || !floatingPoiOn) return;
        if (!floatingPoiLayer) floatingPoiLayer = L.layerGroup().addTo(floatingMap);
        floatingPoiLayer.clearLayers();

        const b = floatingMap.getBounds();
        const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
        const query = `[out:json][timeout:20];(node["amenity"="fuel"](${bbox});node["shop"~"supermarket|convenience"](${bbox});node["amenity"~"pharmacy|hospital|clinic|police"](${bbox}););out body 150;`;

        try {
            const res = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                body: 'data=' + encodeURIComponent(query)
            });
            if (!res.ok) return;
            const data = await res.json();
            const elements = Array.isArray(data.elements) ? data.elements : [];
            elements.forEach((el) => {
                if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) return;
                const tags = el.tags || {};
                const name = tags.name || tags.brand || 'Referencia';
                L.circleMarker([el.lat, el.lon], {
                    radius: 5,
                    color: '#ffd57a',
                    fillColor: '#ffd57a',
                    fillOpacity: 0.75,
                    weight: 1
                }).bindPopup(name).addTo(floatingPoiLayer);
            });
        } catch (e) {}
    }

    function togglePoiChofer() {
        floatingPoiOn = !floatingPoiOn;
        const btn = document.getElementById('btnPoiDriver');
        if (btn) btn.innerText = floatingPoiOn ? 'REFERENCIAS ON' : 'REFERENCIAS OFF';
        if (!floatingPoiOn) {
            if (floatingPoiLayer) floatingPoiLayer.clearLayers();
            return;
        }
        loadPoiChofer();
    }

    function modernMapLayers(targetMap) {
        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: 'Â© OpenStreetMap contributors',
            maxZoom: 19
        });
        const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles Â© Esri'
        });
        const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: 'Â© OpenStreetMap contributors Â© CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        });
        const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles Â© Esri'
        });
        osm.addTo(targetMap);
        L.control.layers({
            'OpenStreetMap Referencias': osm,
            'Esri Streets + POI': esri,
            'Carto Voyager': carto,
            'Esri Satelital': esriSat
        }, null, { position: 'bottomright' }).addTo(targetMap);
    }

    function loadRiskZones() {
        try {
            const raw = localStorage.getItem(RISK_ZONES_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            riskZones = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            riskZones = [];
        }
    }

    function saveRiskZones() {
        localStorage.setItem(RISK_ZONES_KEY, JSON.stringify(riskZones));
    }

    function redrawRiskZones() {
        if (riskZonesLayer) riskZonesLayer.clearLayers();
        if (riskZonesLayerExpanded) riskZonesLayerExpanded.clearLayers();

        riskZones.forEach((z) => {
            const opts = { color: '#ff3b30', fillColor: '#ff3b30', fillOpacity: 0.24, weight: 2 };
            const label = z.name || 'Zona peligrosa';
            const radius = Math.max(MIN_ZONE_RADIUS_METERS, Number(z.radius || 0) || DEFAULT_ZONE_RADIUS_METERS);
            if (riskZonesLayer) L.circle([z.lat, z.lng], { radius, ...opts }).addTo(riskZonesLayer).bindTooltip(label);
            if (riskZonesLayerExpanded) L.circle([z.lat, z.lng], { radius, ...opts }).addTo(riskZonesLayerExpanded).bindTooltip(label);
        });

        renderZoneList();
    }

    function addRiskZone(lat, lng, radius = DEFAULT_ZONE_RADIUS_METERS, name = '') {
        const safeRadius = Math.min(MAX_ZONE_RADIUS_METERS, Math.max(MIN_ZONE_RADIUS_METERS, Number(radius || 0) || DEFAULT_ZONE_RADIUS_METERS));
        riskZones.push({ lat, lng, radius: safeRadius, name: name || ('Zona ' + (riskZones.length + 1)) });
        saveRiskZones();
        redrawRiskZones();
    }

    function clearRiskZones() {
        riskZones = [];
        saveRiskZones();
        redrawRiskZones();
    }

    function renderZoneList() {
        const cont = document.getElementById('zoneList');
        if (!cont) return;
        if (!riskZones.length) {
            cont.innerHTML = '<div class="small text-secondary">No hay zonas cargadas.</div>';
            return;
        }

        cont.innerHTML = riskZones.map((z, i) => {
            const lat = Number(z.lat || 0).toFixed(5);
            const lng = Number(z.lng || 0).toFixed(5);
            const radius = Number(z.radius || 220);
            const safeName = String(z.name || ('Zona ' + (i + 1))).replace(/</g, '&lt;');
            return `<div class="zone-list-item"><div class="d-flex justify-content-between align-items-center"><strong>${safeName}</strong><div class="d-flex gap-1"><button class="btn btn-sm btn-outline-info" onclick="focusZone(${i})">VER</button><button class="btn btn-sm btn-outline-danger" onclick="removeZone(${i})">BORRAR</button></div></div><div class="meta">Lat ${lat} | Lng ${lng} | Radio ${radius}m</div></div>`;
        }).join('');
    }

    function setGeocodeMarker(lat, lng, label) {
        if (geocodeMarkerMain) mainMap.removeLayer(geocodeMarkerMain);
        geocodeMarkerMain = L.marker([lat, lng]).addTo(mainMap).bindPopup(label).openPopup();

        if (mainMapExpanded) {
            if (geocodeMarkerExpanded) mainMapExpanded.removeLayer(geocodeMarkerExpanded);
            geocodeMarkerExpanded = L.marker([lat, lng]).addTo(mainMapExpanded).bindPopup(label);
        }
    }

    async function buscarLugarParaZona() {
        const queryInput = document.getElementById('zoneSearch');
        const raw = (queryInput?.value || '').trim();
        if (!raw) {
            alert('EscribÃ­ un barrio o referencia para buscar.');
            return;
        }

        const q = /san\s*juan/i.test(raw) ? raw : `${raw}, San Juan, Argentina`;

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ar&q=${encodeURIComponent(q)}`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) throw new Error('Geocoding ' + res.status);
            const list = await res.json();

            if (!Array.isArray(list) || list.length === 0) {
                alert('No encontrÃ© ese lugar. ProbÃ¡ con otro nombre o una referencia cercana.');
                return;
            }

            const top = list[0];
            const lat = Number(top.lat);
            const lng = Number(top.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Coordenadas invalidas');

            const shortName = String(top.display_name || raw).split(',').slice(0, 2).join(',').trim();
            let suggestedRadius = DEFAULT_ZONE_RADIUS_METERS;
            if (Array.isArray(top.boundingbox) && top.boundingbox.length === 4 && mainMap) {
                const south = Number(top.boundingbox[0]);
                const north = Number(top.boundingbox[1]);
                const west = Number(top.boundingbox[2]);
                const east = Number(top.boundingbox[3]);
                if ([south, north, west, east].every(Number.isFinite)) {
                    const nsMeters = mainMap.distance([south, lng], [north, lng]);
                    const ewMeters = mainMap.distance([lat, west], [lat, east]);
                    const halfSpan = Math.max(nsMeters, ewMeters) / 2;
                    suggestedRadius = Math.min(MAX_ZONE_RADIUS_METERS, Math.max(MIN_ZONE_RADIUS_METERS, halfSpan));
                }
            }

            addRiskZone(lat, lng, suggestedRadius, shortName || raw);
            if (queryInput) queryInput.value = '';

            mainMap.setView([lat, lng], 16);
            if (mainMapExpanded) mainMapExpanded.setView([lat, lng], 16);
            setGeocodeMarker(lat, lng, shortName || raw);
        } catch (e) {
            console.error('Error al buscar lugar:', e);
            alert('No se pudo buscar el lugar ahora. RevisÃ¡ conexiÃ³n y probÃ¡ de nuevo.');
        }
    }

    function focusZone(index) {
        const z = riskZones[index];
        if (!z || !mainMap) return;
        const zoom = z.radius > 900 ? 14 : 16;
        mainMap.setView([z.lat, z.lng], zoom);
        if (mainMapExpanded) mainMapExpanded.setView([z.lat, z.lng], zoom);
    }

    function removeZone(index) {
        if (index < 0 || index >= riskZones.length) return;
        riskZones.splice(index, 1);
        saveRiskZones();
        redrawRiskZones();
    }

    function isInsideRiskZone(lat, lng) {
        if (!mainMap || !Array.isArray(riskZones) || riskZones.length === 0) return false;
        return riskZones.some((z) => {
            const radius = Math.max(MIN_ZONE_RADIUS_METERS, Number(z.radius || 0) || DEFAULT_ZONE_RADIUS_METERS);
            return mainMap.distance([lat, lng], [z.lat, z.lng]) <= radius;
        });
    }

    function ofrecerAyudaZona(pid) {
        activarSOSOperador(pid, 'zona_riesgo_auto');
    }

    function startRiskBlink(pid) {
        const u = units[pid];
        if (!u || !u.mainMarker || u.riskBlinkTimer) return;
        u.riskBlinkOn = false;
        u.riskBlinkTimer = setInterval(() => {
            u.riskBlinkOn = !u.riskBlinkOn;
            if (!u.mainMarker) return;
            // Silent blink: fade marker instead of switching to SOS-like icon.
            u.mainMarker.setOpacity(u.riskBlinkOn ? 0.28 : 1);
        }, 550);
    }

    function stopRiskBlink(pid) {
        const u = units[pid];
        if (!u) return;
        if (u.riskBlinkTimer) {
            clearInterval(u.riskBlinkTimer);
            u.riskBlinkTimer = null;
        }
        u.riskBlinkOn = false;
        if (u.mainMarker) {
            u.mainMarker.setOpacity(1);
            if (!u.emergencyRecording) {
                u.mainMarker.setIcon(carIcon);
            }
        }
    }

    function handleRiskZoneState(pid, lat, lng) {
        units[pid] = units[pid] || { ignoreIA: false, lat: 0, lng: 0 };
        const inRisk = isInsideRiskZone(lat, lng);

        if (inRisk && !units[pid].riskZoneActive) {
            units[pid].riskZoneActive = true;
            if (units[pid].mainMarker) {
                units[pid].mainMarker.bindPopup(`<b>${pid}</b><br>ZONA DE RIESGO`);
            }
            startRiskBlink(pid);
        } else if (!inRisk && units[pid].riskZoneActive) {
            units[pid].riskZoneActive = false;
            stopRiskBlink(pid);
            if (units[pid].mainMarker) {
                units[pid].mainMarker.bindPopup(pid);
            }
        }
    }

    function toggleMainMapExpanded(show) {
        const modal = document.getElementById('mainMapModal');
        if (!modal) return;

        modal.style.display = show ? 'block' : 'none';
        if (!show) return;

        if (!mainMapExpanded) {
            mainMapExpanded = L.map('mainMapExpandedContainer').setView(mainMap.getCenter(), mainMap.getZoom());
            modernMapLayers(mainMapExpanded);
            riskZonesLayerExpanded = L.layerGroup().addTo(mainMapExpanded);
        }

        mainMapExpanded.setView(mainMap.getCenter(), mainMap.getZoom());
        redrawRiskZones();

        setTimeout(() => {
            mainMapExpanded.invalidateSize();
        }, 120);
    }

    async function init() {
        mainMap = L.map('mainMap').setView([-31.5375, -68.5364], 13);
        modernMapLayers(mainMap);
        riskZonesLayer = L.layerGroup().addTo(mainMap);
        loadRiskZones();
        redrawRiskZones();
        
        try {
            const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
            await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
            await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
            await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
        } catch(e) { console.error("Error modelos IA:", e); }

        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch(e) { console.log("Permiso micro central denegado"); }

        conectarCentral();
        renderAgenda();
        setInterval(escanearIA, 2000);
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
            console.log('Central conectada con ID:', id);
            setStatusCentral(true, 'EN LÃNEA - ' + id + ` (${endpoint.secure ? 'WSS' : 'WS'})`);
        });

        peer.on('connection', (conn) => {
            if (peer !== activePeer) return;
            if (!units[conn.peer]) units[conn.peer] = { ignoreIA: false, lat: 0, lng: 0 };
            units[conn.peer].conn = conn;

            conn.on('data', (data) => {
                if (data.tipo === 'login') manejarLogin(conn, data);
                if (data.tipo === 'gps') actualizarPosicionGlobal(conn.peer, data.lat, data.lng);
                if (data.tipo === 'emergency_recording_started') manejarEmergenciaGrabacion(conn.peer, data);
            });

            conn.on('close', () => {
                console.log('Unidad desconectada:', conn.peer);
                const card = document.getElementById('card-' + conn.peer);
                if (card) card.style.opacity = '0.4';
            });

            conn.on('error', (err) => {
                console.error('Error en conexiÃ³n de unidad:', err);
            });
        });

        peer.on('call', (call) => {
            if (peer !== activePeer) return;
            call.answer();
            call.on('stream', (s) => {
                attachUnitStream(call.peer, s);
            });
        });

        // â”€â”€ FIX CLAVE: ReconexiÃ³n automÃ¡tica de la central â”€â”€
        peer.on('error', (err) => {
            if (peer !== activePeer) return;
            centralConnecting = false;
            console.error('Error central:', err.type, err.message);

            if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
                peerEndpointIndex = (peerEndpointIndex + 1) % PEER_ENDPOINTS.length;
            }

            if (err.type === 'unavailable-id') {
                scheduleCentralReconnect(10000, 'ID OCUPADO - ESPERANDO 10s...');
            } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
                scheduleCentralReconnect(5000, 'SIN RED - REINTENTANDO...');
            } else {
                scheduleCentralReconnect(5000, 'ERROR: ' + err.type);
            }
        });

        peer.on('disconnected', () => {
            if (peer !== activePeer) return;
            centralConnecting = false;
            console.warn('Central desconectada del servidor PeerJS, reconectando...');
            peerEndpointIndex = (peerEndpointIndex + 1) % PEER_ENDPOINTS.length;
            scheduleCentralReconnect(5000, 'DESCONECTADA - RECONECTANDO...');
        });

        peer.on('close', () => {
            if (peer !== activePeer) return;
            centralConnecting = false;
            scheduleCentralReconnect(5000, 'CERRADA - RECONECTANDO...');
        });
    }

    // --- AGENDA Y TOKEN ---
    function toggleAgenda(s) { document.getElementById('agendaModal').style.display = s ? 'block' : 'none'; }
    
    function generarAlta() {
        const n = document.getElementById('regNombre').value.trim().toUpperCase();
        const horas = parseInt(document.getElementById('regTiempo').value);
        if (!n) return;
        let db = JSON.parse(localStorage.getItem('pablo_db') || "[]");
        db.push({ 
            nombre: n, 
            token: Math.floor(1000 + Math.random() * 9000).toString(), 
            vence: Date.now() + (horas * 60 * 60 * 1000) 
        });
        localStorage.setItem('pablo_db', JSON.stringify(db));
        document.getElementById('regNombre').value = "";
        renderAgenda();
    }

    function renderAgenda() {
        const list = JSON.parse(localStorage.getItem('pablo_db') || "[]");
        const ahora = Date.now();
        const cont = document.getElementById('listaAbonadosVisual');
        if (!cont) return;
        cont.innerHTML = list.map((u, i) => {
            const falta = Math.round((u.vence - ahora) / (1000 * 60 * 60));
            return `<div class="p-2 border-bottom border-secondary small d-flex justify-content-between align-items-center"><span>${u.nombre} - <b>${u.token}</b></span><span>${falta > 0 ? falta+'h rest.' : 'VENCIDO'}</span><button class="btn btn-xs btn-danger py-0" onclick="eliminarAbonado(${i})">X</button></div>`;
        }).join('');
    }

    function eliminarAbonado(i) { let db = JSON.parse(localStorage.getItem('pablo_db') || "[]"); db.splice(i, 1); localStorage.setItem('pablo_db', JSON.stringify(db)); renderAgenda(); }
    
    function manejarLogin(conn, data) {
        const db = JSON.parse(localStorage.getItem('pablo_db') || "[]");
        const u = db.find(x => x.nombre === data.nombre.toUpperCase() && x.token === data.token);
        if (u && Date.now() < u.vence) { 
            crearOActualizarCelda(conn.peer, data.nombre); 
            conn.send({ tipo: 'auth_ok' }); 
        } else { 
            conn.send({ tipo: 'auth_fail', msg: 'ACCESO DENEGADO O VENCIDO' }); 
        }
    }

    // --- MOTOR IA ---
    async function escanearIA() {
        if (!iaActiva) return;
        const tx = dbIndexed.transaction("delincuentes", "readonly");
        const dbList = await new Promise(res => {
            const list = [];
            tx.objectStore("delincuentes").openCursor().onsuccess = (e) => {
                const c = e.target.result; if (c) { list.push(c.value); c.continue(); } else res(list);
            };
        });
        if (dbList.length === 0) return;
        const vids = document.querySelectorAll('video');
        for (let v of vids) {
            const pid = v.id.replace('v-', '');
            if (units[pid] && units[pid].ignoreIA) continue;
            if (v.paused || v.ended || v.readyState < 3) continue;
            try {
                const detections = await faceapi.detectAllFaces(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 })).withFaceLandmarks().withFaceDescriptors();
                for (let det of detections) {
                    for (let del of dbList) {
                        if (faceapi.euclideanDistance(det.descriptor, new Float32Array(del.descriptor)) < 0.6) dispararAlerta(pid);
                    }
                }
            } catch(e) {}
        }
    }

    function dispararAlerta(pid) {
        const c = document.getElementById('card-' + pid);
        if (c && !c.classList.contains('alerta-ia')) {
            c.classList.add('alerta-ia');
            if (units[pid].mainMarker) units[pid].mainMarker.setIcon(sosIcon);
            alarmAudio.play().catch(() => {});
        }
    }

    function manejarEmergenciaGrabacion(pid, data) {
        const c = document.getElementById('card-' + pid);
        const h = document.getElementById('header-' + pid);

        units[pid] = units[pid] || { ignoreIA: false, lat: 0, lng: 0 };
        units[pid].emergencyRecording = true;
        units[pid].emergencyReason = data.reason || 'double_tap_lock';
        units[pid].emergencyTimestamp = data.timestamp || Date.now();

        if (c) {
            c.classList.add('alerta-emergencia');
        }

        if (h) {
            h.classList.add('emergency');
            const label = data.nombre || h.dataset.nombre || h.innerText;
            h.innerText = 'GRABANDO SOS - ' + label;
        }

        if (units[pid].mainMarker) units[pid].mainMarker.setIcon(sosIcon);
        alarmAudio.play().catch(() => {});

        if (units[pid].conn && units[pid].conn.open) {
            units[pid].conn.send({ tipo: 'emergency_recording_ack' });
        }
    }

    function activarSOSOperador(pid, origen = 'central_ui') {
        dispararAlerta(pid);
        if (units[pid] && units[pid].conn && units[pid].conn.open) {
            units[pid].conn.send({
                tipo: 'sos_operador',
                source: origen,
                timestamp: Date.now()
            });
        }
    }

    function pararAlerta(pid) {
        const c = document.getElementById('card-' + pid);
        const h = document.getElementById('header-' + pid);
        if (c && c.classList.contains('alerta-ia')) {
            c.classList.remove('alerta-ia'); 
            if (units[pid].mainMarker) units[pid].mainMarker.setIcon(carIcon); 
            if (units[pid]) {
                units[pid].ignoreIA = true;
                c.classList.add('pausa-activa');
                setTimeout(() => { units[pid].ignoreIA = false; c.classList.remove('pausa-activa'); }, 180000); 
            }
            if (document.querySelectorAll('.alerta-ia').length === 0) { alarmAudio.pause(); alarmAudio.currentTime = 0; }
        }

        if (c && c.classList.contains('alerta-emergencia')) {
            c.classList.remove('alerta-emergencia');
            if (h) {
                h.classList.remove('emergency');
                h.innerText = h.dataset.nombre || h.innerText.replace(/^GRABANDO SOS - /, '');
            }
            if (units[pid]) {
                units[pid].emergencyRecording = false;
                units[pid].emergencyReason = null;
            }
            if (!document.querySelector('.alerta-ia') && !document.querySelector('.alerta-emergencia')) {
                alarmAudio.pause();
                alarmAudio.currentTime = 0;
            }
        }

        if (c && c.classList.contains('alerta-zona') && units[pid] && !units[pid].riskZoneActive) {
            c.classList.remove('alerta-zona');
            if (!document.querySelector('.alerta-ia') && !document.querySelector('.alerta-emergencia') && !document.querySelector('.alerta-zona')) {
                alarmAudio.pause();
                alarmAudio.currentTime = 0;
            }
        }
    }

    // --- FUNCIONES EXTRA ---
    function actualizarPosicionGlobal(pid, lat, lng) {
        const pos = [lat, lng];
        if (!units[pid]) units[pid] = { ignoreIA: false, lat: lat, lng: lng };
        units[pid].lat = lat; units[pid].lng = lng;
        if (!units[pid].mainMarker) { units[pid].mainMarker = L.marker(pos, {icon: carIcon}).addTo(mainMap).bindPopup(pid); } else { units[pid].mainMarker.setLatLng(pos); }
        if (mainMapExpanded) {
            if (!units[pid].expandedMarker) {
                units[pid].expandedMarker = L.marker(pos, { icon: carIcon }).addTo(mainMapExpanded).bindPopup(pid);
            } else {
                units[pid].expandedMarker.setLatLng(pos);
            }
        }
        if (document.getElementById('gpsModal').style.display === 'block' && floatingMarker && pid === floatingCurrentPid) {
            floatingMarker.setLatLng(pos);
            addTrackPoint(lat, lng);
            if (floatingFollow) floatingMap.panTo(pos);
            updateGpsHud(floatingCurrentNombre || pid, lat, lng);
        }
        handleRiskZoneState(pid, lat, lng);
    }

    function abrirMapaGPS(pid, nombre) { 
        document.getElementById('gpsModal').style.display = 'block'; 
        document.getElementById('gpsModalTitle').innerText = "UBICACIÃ“N: " + nombre; 
        floatingCurrentPid = pid;
        floatingCurrentNombre = nombre;
        floatingTrackPoints = [];
        floatingTrackLine = null;
        const pos = [units[pid].lat || -31.5375, units[pid].lng || -68.5364]; 
        if (!floatingMap) { 
            floatingMap = L.map('mapaFlotanteContainer').setView(pos, 16); 
            modernMapLayers(floatingMap); 
            floatingMarker = L.marker(pos, {icon: carIcon}).addTo(floatingMap); 
        } else { 
            floatingMap.setView(pos, 16); 
            floatingMarker.setLatLng(pos); 
            setTimeout(() => { floatingMap.invalidateSize(); }, 200); 
        } 
        updateGpsHud(nombre, pos[0], pos[1]);
        addTrackPoint(pos[0], pos[1]);
        if (floatingPoiOn) loadPoiChofer();
    }

    function cerrarMapaGPS() {
        document.getElementById('gpsModal').style.display = 'none';
        floatingCurrentPid = null;
        floatingCurrentNombre = '';
    }

    function iniciarHabla(pid) { 
        if (!localStream) return; 
        const btn = document.getElementById('btn-hablar-' + pid); 
        btn.classList.add('btn-talking'); 
        units[pid].currentCall = peer.call(pid, localStream); 
    }

    function detenerHabla(pid) { 
        const btn = document.getElementById('btn-hablar-' + pid); 
        if (btn) btn.classList.remove('btn-talking'); 
        if (units[pid] && units[pid].currentCall) { units[pid].currentCall.close(); units[pid].currentCall = null; } 
    }

    function toggleEscucha(pid) { 
        const v = document.getElementById('v-' + pid); 
        const btn = document.getElementById('btn-escuchar-' + pid); 
        if (v.muted) { v.muted = false; btn.classList.add('btn-active'); btn.innerText = "ðŸ”Š ON"; } 
        else { v.muted = true; btn.classList.remove('btn-active'); btn.innerText = "ðŸ”ˆ ESCUCHAR"; } 
    }

    function bloquearPantalla(pid) { 
        if (units[pid] && units[pid].conn) units[pid].conn.send({ tipo: 'bloquear_pantalla' }); 
    }

    function crearOActualizarCelda(pid, nombre) { 
        const existing = document.getElementById('card-' + pid);
        if (existing) { existing.style.opacity = '1'; return; }
        const grid = document.getElementById('monitorGrid'); 
        const card = document.createElement('div'); 
        card.className = 'unit-card'; 
        card.id = 'card-' + pid; 
        card.onclick = function() { if (this.classList.contains('alerta-ia') || this.classList.contains('alerta-emergencia')) pararAlerta(pid); }; 
        card.ondblclick = function(event) { event.preventDefault(); activarSOSOperador(pid, 'central_card_double_click'); };
        card.innerHTML = `<div class=\"unit-header\" id=\"header-${pid}\" data-nombre=\"${nombre}\">${nombre}</div><div class=\"video-box\"><video id=\"v-${pid}\" autoplay playsinline muted crossorigin=\"anonymous\"></video></div><div class=\"unit-actions\"><button id=\"btn-hablar-${pid}\" class=\"btn-ctrl\" onmousedown=\"iniciarHabla('${pid}')\" onmouseup=\"detenerHabla('${pid}')\" onmouseleave=\"detenerHabla('${pid}')\">HABLAR</button><button id=\"btn-escuchar-${pid}\" class=\"btn-ctrl\" onclick=\"event.stopPropagation(); toggleEscucha('${pid}')\">ESCUCHAR</button><button class=\"btn-ctrl btn-gps\" onclick=\"event.stopPropagation(); abrirMapaGPS('${pid}', '${nombre}')\">GPS</button><button class=\"btn-ctrl\" style=\"color:red\" onclick=\"event.stopPropagation(); activarSOSOperador('${pid}', 'central_sos_button')\">SOS</button><button class=\"btn-ctrl btn-block\" style=\"grid-column: span 2;\" onclick=\"event.stopPropagation(); bloquearPantalla('${pid}')\">BLOQUEAR</button></div>`; 
        grid.prepend(card); 
        units[pid] = units[pid] || { ignoreIA: false, lat: 0, lng: 0 }; 
        if (pendingUnitStreams[pid]) {
            attachUnitStream(pid, pendingUnitStreams[pid]);
        }
    }

    function toggleIA() { 
        iaActiva = !iaActiva; 
        document.getElementById('ia-dot').style.left = iaActiva ? "40px" : "5px"; 
        document.getElementById('ia-toggle').style.background = iaActiva ? "#0f0" : "#444"; 
        document.getElementById('ia-text').innerText = iaActiva ? "ACTIVA" : "DESACTIVADA"; 
        document.getElementById('ia-text').style.color = iaActiva ? "#0f0" : "#555"; 
    }

    function toggleCarpetaNegra(s) { document.getElementById('blackFolderModal').style.display = s ? 'block' : 'none'; }

    function toggleCarpetaZonas(s) { document.getElementById('zoneFolderModal').style.display = s ? 'block' : 'none'; }

    async function guardarDelincuente() { 
        const nom = document.getElementById('nombreDelincuente').value; 
        const file = document.getElementById('fotoDelincuente').files[0]; 
        if (!nom || !file) return; 
        const img = await faceapi.bufferToImage(file); 
        const det = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 224 })).withFaceDescriptor(); 
        if (!det) { alert('No se detectÃ³ cara en la foto'); return; }
        dbIndexed.transaction(["delincuentes"], "readwrite").objectStore("delincuentes").add({ nombre: nom.toUpperCase(), descriptor: Array.from(det.descriptor), foto: await toBase64(file) }); 
        cargarListaNegraVisual(); 
    }

    function cargarListaNegraVisual() { 
        const cont = document.getElementById('listaNegra'); 
        if (!cont) return; 
        cont.innerHTML = ""; 
        dbIndexed.transaction("delincuentes", "readonly").objectStore("delincuentes").openCursor().onsuccess = (e) => { 
            const c = e.target.result; 
            if (c) { 
                cont.innerHTML += `<div class="col-4 col-md-3 mb-2 text-center"><div class="card bg-black border-danger p-1"><img src="${c.value.foto}" style="height:80px; object-fit:cover; border-radius:4px;"><div class="small text-danger mt-1">${c.value.nombre}</div><button class="btn btn-danger btn-sm w-100 mt-1" onclick="eliminarSospechoso(${c.value.id})">BORRAR</button></div></div>`; 
                c.continue(); 
            } 
        }; 
    }

    function eliminarSospechoso(id) { 
        dbIndexed.transaction(["delincuentes"], "readwrite").objectStore("delincuentes").delete(id); 
        cargarListaNegraVisual(); 
    }

    function toBase64(f) { 
        return new Promise(res => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(f); }); 
    }

    window.onload = init;
