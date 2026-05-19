        let peer, miStream, connCentral, watchId, retryTimer, connectWatchdogTimer, nombreActivo, tokenActivo;
        let centralTalkCall = null;
        let centralTalkAudio = null;
        let centralVideoCall = null;
        let viewerConns = [], lastLat = null, lastLng = null;
        let viewerCalls = new Map();
        let lastGpsBroadcastTs = 0;
        let centralConnectInFlight = false;
        let centralFailureCount = 0;
        let viajeTokenActivo = null;
        let viajeTokenExpiraEn = 0;
        let viajeTokenTimer = null;
        let emergencyRecorder = null;
        let emergencyChunks = [];
        let emergencyStopTimer = null;
        let emergencyRecordingActive = false;
        let emergencyRecordingReason = null;
        let emergencyRecordingSource = null;
        let misVideosVisible = false;
        let foregroundRecoverTimer = null;
        let transmissionGuardTimer = null;
        let transmissionRecoverInProgress = false;
        let lastTransmissionRecoverAt = 0;
        let sessionActive = false;
        let qrLinkActual = '';
        let qrCountdownTimer = null;
        window.__unitPeerId = null;
        let desiredUnitPeerId = null;
        const CENTRAL_PEER_ID = 'PABLO-CENTRAL-MASTER-2026';
        const RETRY_DELAY = 5000;
        const EMERGENCY_RECORDING_MS = 5 * 60 * 1000;
        const VIAJE_LINK_TTL_MS = 8 * 60 * 1000;
        const TRANSMISSION_GUARD_MS = 5000;
        const TRANSMISSION_RECOVER_COOLDOWN_MS = 2200;
        const SAFE_DISABLE_HIDDEN_PIP = true;
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

        function clearReconnectTimer() {
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
        }

        function clearConnectWatchdog() {
            if (connectWatchdogTimer) {
                clearTimeout(connectWatchdogTimer);
                connectWatchdogTimer = null;
            }
        }

        function scheduleReconnect(action, delayMs) {
            if (!sessionActive) return;
            clearReconnectTimer();
            retryTimer = setTimeout(() => {
                retryTimer = null;
                if (!sessionActive) return;
                action();
            }, delayMs);
        }

        function schedulePeerRestart(reason, delayMs = RETRY_DELAY) {
            if (!sessionActive) return;
            if (!nombreActivo || !tokenActivo) return;
            setStatus(reason || 'REINICIANDO ENLACE...', false);
            scheduleReconnect(() => iniciarPeer(), delayMs);
        }

        function handleNetworkOnline() {
            if (!sessionActive) return;
            setStatus('RED RECUPERADA - RECONectando...', false);
            schedulePeerRestart('RED RECUPERADA - REINICIANDO ENLACE...', 1200);
        }

        function handleNetworkOffline() {
            if (!sessionActive) return;
            setStatus('SIN INTERNET - ESPERANDO RED...', false);
            clearReconnectTimer();
            clearConnectWatchdog();
            centralConnectInFlight = false;
            centralFailureCount = 0;
            if (connCentral) {
                try { connCentral.close(); } catch (e) {}
                connCentral = null;
            }
            if (peer && !peer.destroyed) {
                try { peer.disconnect(); } catch (e) {}
            }
        }

        window.addEventListener('online', handleNetworkOnline);
        window.addEventListener('offline', handleNetworkOffline);

        function getMediaConstraints() {
            return {
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
            };
        }

        function setStatus(texto, online) {
            document.getElementById('statusText').innerText = texto;
            document.getElementById('dot').className = 'status-dot' + (online ? ' status-on' : '');
        }

        function isMonitorActive() {
            const monitor = document.getElementById('monitor-activo');
            return !!monitor && monitor.style.display !== 'none';
        }

        function hasLiveLocalTracks() {
            if (!miStream) return false;
            const hasLiveVideo = miStream.getVideoTracks && miStream.getVideoTracks().some(t => t.readyState === 'live');
            const hasLiveAudio = miStream.getAudioTracks && miStream.getAudioTracks().some(t => t.readyState === 'live');
            return !!(hasLiveVideo || hasLiveAudio);
        }

        function hasLiveLocalVideoTrack() {
            if (!miStream || !miStream.getVideoTracks) return false;
            return miStream.getVideoTracks().some(t => t.readyState === 'live');
        }

        function bindCentralVideoCall(call) {
            if (!call) return;
            centralVideoCall = call;
            call.on('close', () => {
                if (centralVideoCall === call) centralVideoCall = null;
                if (isMonitorActive()) {
                    setTimeout(() => recoverTransmission('central_call_close'), 700);
                }
            });
            call.on('error', () => {
                if (centralVideoCall === call) centralVideoCall = null;
                if (isMonitorActive()) {
                    setTimeout(() => recoverTransmission('central_call_error'), 900);
                }
            });
        }

        async function recoverTransmission(reason) {
            if (!sessionActive) return;
            if (!isMonitorActive()) return;
            if (transmissionRecoverInProgress) return;
            const now = Date.now();
            if (now - lastTransmissionRecoverAt < TRANSMISSION_RECOVER_COOLDOWN_MS) return;

            transmissionRecoverInProgress = true;
            lastTransmissionRecoverAt = now;
            try {
                const stream = await ensureStreamForViewer();
                if (!stream || !hasLiveLocalVideoTrack()) {
                    setStatus('RECUPERANDO CAMARA...', false);
                    return;
                }

                if (!peer || peer.destroyed) {
                    schedulePeerRestart('RECUPERANDO ENLACE...', 1200);
                    return;
                }

                if (!connCentral || !connCentral.open) {
                    setStatus('RECUPERANDO CENTRAL...', false);
                    conectar();
                    return;
                }

                if (centralVideoCall) {
                    try { centralVideoCall.close(); } catch (e) {}
                    centralVideoCall = null;
                }
                bindCentralVideoCall(peer.call(CENTRAL_PEER_ID, stream));
                setStatus('EN LINEA - TRANSMISION RECUPERADA', true);
            } finally {
                transmissionRecoverInProgress = false;
            }
        }

        function startTransmissionGuard() {
            if (transmissionGuardTimer) return;
            transmissionGuardTimer = setInterval(() => {
                if (!isMonitorActive()) return;
                if (!navigator.onLine) return;

                const needsRecover = !hasLiveLocalVideoTrack()
                    || !peer || peer.destroyed
                    || !connCentral || !connCentral.open
                    || !centralVideoCall;

                if (needsRecover) {
                    recoverTransmission('guard_tick');
                }
            }, TRANSMISSION_GUARD_MS);
        }

        function stopTransmissionGuard() {
            if (!transmissionGuardTimer) return;
            clearInterval(transmissionGuardTimer);
            transmissionGuardTimer = null;
        }

        function invalidarLinkViajeActivo() {
            viajeTokenActivo = null;
            viajeTokenExpiraEn = 0;
            if (viajeTokenTimer) {
                clearTimeout(viajeTokenTimer);
                viajeTokenTimer = null;
            }
            viewerConns.forEach((c) => {
                try { if (c && c.open) c.send({ tipo: 'viewer_denied' }); } catch (e) {}
                try { c.close(); } catch (e) {}
            });
            viewerCalls.forEach((c) => {
                try { c.close(); } catch (e) {}
            });
            viewerCalls.clear();
            viewerConns = [];
        }

        function ensureCentralTalkAudio() {
            if (centralTalkAudio) return centralTalkAudio;
            const a = document.createElement('audio');
            a.id = 'centralTalkAudio';
            a.autoplay = true;
            a.playsInline = true;
            a.style.display = 'none';
            document.body.appendChild(a);
            centralTalkAudio = a;
            return a;
        }

        function getEmergencyMimeType() {
            const types = [
                'video/webm;codecs=vp9,opus',
                'video/webm;codecs=vp8,opus',
                'video/webm'
            ];
            return types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
        }

        function pad2(value) {
            return String(value).padStart(2, '0');
        }

        function formatBytes(bytes) {
            if (!bytes || bytes <= 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB'];
            let val = bytes;
            let idx = 0;
            while (val >= 1024 && idx < units.length - 1) {
                val /= 1024;
                idx += 1;
            }
            return val.toFixed(idx === 0 ? 0 : 1) + ' ' + units[idx];
        }

        function formatDate(ms) {
            if (!ms) return '-';
            const d = new Date(ms);
            return d.toLocaleString('es-AR');
        }

        function renderMisVideos(list) {
            const cont = document.getElementById('misVideosList');
            if (!cont) return;

            if (!list || !list.length) {
                cont.innerHTML = 'No hay videos guardados todavÃ­a.';
                return;
            }

            cont.innerHTML = list.map((v) => {
                const safeName = (v.name || 'video.mp4').replace(/</g, '&lt;');
                const safePath = (v.relativePath || '').replace(/</g, '&lt;');
                const safeUri = (v.uri || '').replace(/'/g, "\\'");
                return `<div class="video-item"><div><strong>${safeName}</strong></div><div class="meta">${formatDate(v.dateAdded)} Â· ${formatBytes(v.size)}</div><div class="meta">${safePath}</div><div class="d-grid gap-2 mt-2"><button class="btn btn-sm btn-pablo" onclick="compartirVideo('${safeUri}')">COMPARTIR</button><button class="btn btn-sm btn-outline-danger" onclick="borrarVideo('${safeUri}')">BORRAR</button></div></div>`;
            }).join('');
        }

        function cargarMisVideos() {
            const cont = document.getElementById('misVideosList');
            if (cont) cont.innerHTML = 'Cargando videos...';

            if (!window.Android || !window.Android.getEmergencyVideosJson) {
                if (cont) cont.innerHTML = 'Listado disponible solo dentro de la app Android.';
                return;
            }

            try {
                const raw = window.Android.getEmergencyVideosJson();
                const list = raw ? JSON.parse(raw) : [];
                renderMisVideos(list);
            } catch (err) {
                if (cont) cont.innerHTML = 'Error cargando videos.';
                console.error('Error listando videos nativos:', err);
            }
        }

        function compartirVideo(uri) {
            if (!uri) return;
            if (window.Android && window.Android.shareEmergencyVideo) {
                window.Android.shareEmergencyVideo(uri);
            }
            // Al volver del chooser/video externo, revalidar transmisiÃ³n.
            if (foregroundRecoverTimer) clearTimeout(foregroundRecoverTimer);
            foregroundRecoverTimer = setTimeout(() => {
                recoverCentralTransmissionAfterRecording();
            }, 1800);
        }

        function borrarVideo(uri) {
            if (!uri) return;
            if (!window.Android || !window.Android.deleteEmergencyVideo) return;
            window.Android.deleteEmergencyVideo(uri);
            setTimeout(() => cargarMisVideos(), 250);
        }

        function toggleMisVideos() {
            misVideosVisible = !misVideosVisible;
            const panel = document.getElementById('misVideosPanel');
            if (!panel) return;
            panel.style.display = misVideosVisible ? 'block' : 'none';
            if (misVideosVisible) {
                cargarMisVideos();
                setTimeout(() => {
                    if (!sessionActive) return;
                    recoverTransmission('open_saved_videos');
                }, 250);
            }
        }

        function formatRemaining(ms) {
            const total = Math.max(0, Math.floor(ms / 1000));
            const mm = String(Math.floor(total / 60)).padStart(2, '0');
            const ss = String(total % 60).padStart(2, '0');
            return mm + ':' + ss;
        }

        function stopQrCountdown() {
            if (!qrCountdownTimer) return;
            clearInterval(qrCountdownTimer);
            qrCountdownTimer = null;
        }

        function updateQrStatus() {
            const el = document.getElementById('qrStatus');
            if (!el) return;
            if (!viajeTokenExpiraEn || !viajeTokenActivo) {
                el.textContent = 'QR vencido. Genera uno nuevo.';
                return;
            }
            const left = viajeTokenExpiraEn - Date.now();
            if (left <= 0) {
                el.textContent = 'QR vencido. Deben volver a escanear.';
                return;
            }
            el.textContent = 'Vence en ' + formatRemaining(left);
        }

        function startQrCountdown() {
            stopQrCountdown();
            updateQrStatus();
            qrCountdownTimer = setInterval(() => {
                updateQrStatus();
                if (!viajeTokenExpiraEn || Date.now() >= viajeTokenExpiraEn) {
                    stopQrCountdown();
                    const wrap = document.getElementById('qrCanvasWrap');
                    if (wrap) wrap.innerHTML = '<div style="color:#333;font-weight:bold;">QR VENCIDO</div>';
                }
            }, 1000);
        }

        function abrirQrViaje() {
            const modal = document.getElementById('qrModal');
            if (!modal) return;
            modal.style.display = 'flex';
            if (!sessionActive) {
                const wrap = document.getElementById('qrCanvasWrap');
                const linkText = document.getElementById('qrLinkText');
                const status = document.getElementById('qrStatus');
                if (wrap) wrap.innerHTML = '<div style="color:#333;font-weight:bold;">ACTIVA LA UNIDAD</div>';
                if (linkText) linkText.textContent = 'Primero tocÃ¡ ACTIVAR para generar un link de viaje.';
                if (status) status.textContent = 'Unidad inactiva';
                return;
            }
            regenerarQrViaje();
        }

        function cerrarQrViaje() {
            const modal = document.getElementById('qrModal');
            if (!modal) return;
            modal.style.display = 'none';
            stopQrCountdown();
        }

        function copiarLinkQrViaje() {
            if (!qrLinkActual) return;
            if (window.Android && window.Android.copyToClipboard) {
                window.Android.copyToClipboard(qrLinkActual);
                return;
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(qrLinkActual).catch(() => {});
            }
        }

        function regenerarQrViaje() {
            if (!sessionActive) return;
            const link = window.generarLinkViaje && window.generarLinkViaje();
            const wrap = document.getElementById('qrCanvasWrap');
            const linkText = document.getElementById('qrLinkText');
            if (!wrap || !linkText) return;

            if (!link) {
                wrap.innerHTML = '<div style="color:#333;font-weight:bold;">NO DISPONIBLE</div>';
                linkText.textContent = 'No se pudo generar link. VerificÃ¡ conexiÃ³n de unidad.';
                return;
            }

            qrLinkActual = link;
            linkText.textContent = link;
            wrap.innerHTML = '';

            const renderFallbackImageQr = () => {
                const img = document.createElement('img');
                img.alt = 'QR Viaje';
                img.width = 240;
                img.height = 240;
                img.style.maxWidth = '100%';
                img.style.borderRadius = '8px';
                img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(link);
                img.onerror = () => {
                    wrap.innerHTML = '<div style="color:#333;font-weight:bold;">NO SE PUDO CARGAR QR</div>';
                    const status = document.getElementById('qrStatus');
                    if (status) status.textContent = 'Usa COPIAR LINK si no carga el QR';
                };
                wrap.appendChild(img);
            };

            if (!window.QRCode || !window.QRCode.toCanvas) {
                renderFallbackImageQr();
                startQrCountdown();
                return;
            }

            const canvas = document.createElement('canvas');
            wrap.appendChild(canvas);
            window.QRCode.toCanvas(canvas, link, {
                width: 240,
                margin: 1,
                color: {
                    dark: '#061018',
                    light: '#ffffff'
                }
            }, (err) => {
                if (err) {
                    wrap.innerHTML = '';
                    renderFallbackImageQr();
                }
            });

            startQrCountdown();
        }

        function buildEmergencyFileName() {
            const now = new Date();
            const alias = (nombreActivo || 'UNIDAD').replace(/[^A-Z0-9_-]/gi, '_');
            return 'PABLO_' + alias + '_' + now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + '_' + pad2(now.getHours()) + '-' + pad2(now.getMinutes()) + '-' + pad2(now.getSeconds()) + '.webm';
        }

        function blobToDataUrl(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        async function finalizeEmergencyRecording() {
            if (!emergencyChunks.length) return;

            const mimeType = getEmergencyMimeType() || 'video/webm';
            const blob = new Blob(emergencyChunks, { type: mimeType });
            emergencyChunks = [];

            if (!blob.size) return;

            try {
                const dataUrl = await blobToDataUrl(blob);
                const fileName = buildEmergencyFileName();
                if (window.Android && window.Android.saveEmergencyRecording) {
                    window.Android.saveEmergencyRecording(fileName, mimeType, dataUrl);
                }
            } catch (error) {
                console.error('No se pudo guardar la grabaciÃ³n de emergencia:', error);
            }
        }

        function notifyCentralEmergency(reason, fileName) {
            if (connCentral && connCentral.open) {
                connCentral.send({
                    tipo: 'emergency_recording_started',
                    reason: reason || 'double_tap_lock',
                    timestamp: Date.now(),
                    nombre: nombreActivo || '',
                    peerId: (peer && peer.id) || window.__unitPeerId || desiredUnitPeerId || '',
                    fileName: fileName || ''
                });
            }
        }

        async function startEmergencyRecording(reason = 'double_tap_lock', preferNative = true) {
            if (preferNative && window.Android && window.Android.startNativeEmergencyRecording) {
                setStatus('INICIANDO GRABACION NATIVA...', false);
                window.Android.startNativeEmergencyRecording(reason);
                emergencyRecordingSource = 'native';
                return true;
            }

            if (emergencyRecordingActive || !miStream) {
                return false;
            }

            if (!window.MediaRecorder) {
                console.error('MediaRecorder no disponible en esta WebView');
                return false;
            }

            try {
                const mimeType = getEmergencyMimeType();
                emergencyChunks = [];
                emergencyRecordingReason = reason;
                emergencyRecorder = mimeType ? new MediaRecorder(miStream, { mimeType }) : new MediaRecorder(miStream);

                emergencyRecorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) {
                        emergencyChunks.push(event.data);
                    }
                };

                emergencyRecorder.onerror = (event) => {
                    console.error('Error de grabaciÃ³n de emergencia:', event.error || event);
                };

                emergencyRecorder.onstop = async () => {
                    emergencyRecordingActive = false;
                    clearTimeout(emergencyStopTimer);
                    emergencyStopTimer = null;
                    await finalizeEmergencyRecording();
                    emergencyRecorder = null;
                    emergencyRecordingReason = null;
                };

                emergencyRecorder.start(1000);
                emergencyRecordingActive = true;
                emergencyRecordingSource = 'web';
                notifyCentralEmergency(reason);

                if (window.Android && window.Android.showToast) {
                    window.Android.showToast('GrabaciÃ³n de emergencia iniciada');
                }

                emergencyStopTimer = setTimeout(() => {
                    if (emergencyRecorder && emergencyRecorder.state !== 'inactive') {
                        emergencyRecorder.stop();
                    }
                }, EMERGENCY_RECORDING_MS);

                return true;
            } catch (error) {
                console.error('No se pudo iniciar la grabaciÃ³n de emergencia:', error);
                emergencyRecordingActive = false;
                emergencyRecorder = null;
                emergencyChunks = [];
                return false;
            }
        }

        function stopWebEmergencyRecording() {
            if (emergencyRecorder && emergencyRecorder.state !== 'inactive') {
                emergencyRecorder.stop();
                return true;
            }
            return false;
        }

        window.startEmergencyRecordingFromNative = function(reason) {
            return startEmergencyRecording(reason || 'double_tap_lock', false);
        };

        window.toggleEmergencyRecordingFromNative = async function(reason) {
            if (emergencyRecordingActive && emergencyRecordingSource === 'web') {
                stopWebEmergencyRecording();
                return 'stopped_web';
            }

            const started = await startEmergencyRecording(reason || 'double_tap_lock', false);
            return started ? 'started_web' : 'failed';
        };

        window.onNativeEmergencyRecordingStarted = function(reason, fileName) {
            emergencyRecordingSource = 'native';
            setStatus('GRABACION NATIVA EN CURSO', true);
            notifyCentralEmergency(reason || 'double_tap_lock', fileName || '');
        };

        window.onNativeEmergencyRecordingFinished = function(fileName) {
            emergencyRecordingSource = null;
            setStatus('GRABACION NATIVA FINALIZADA', true);
            if (window.Android && window.Android.showToast) {
                window.Android.showToast('Grabacion guardada: ' + (fileName || 'OK'));
            }
            if (misVideosVisible) {
                setTimeout(() => cargarMisVideos(), 1200);
            }
            setTimeout(() => {
                recoverCentralTransmissionAfterRecording();
            }, 450);
        };

        window.onNativeEmergencyRecordingFailed = function(errorText) {
            emergencyRecordingSource = null;
            setStatus('ERROR GRABACION SOS', false);
            if (window.Android && window.Android.showToast) {
                window.Android.showToast('Error SOS: ' + (errorText || 'desconocido'));
            }

            const canFallbackWeb = !emergencyRecordingActive && miStream && window.MediaRecorder;
            if (canFallbackWeb) {
                setStatus('SOS NATIVO FALLO - INICIANDO FALLBACK WEB...', false);
                startEmergencyRecording('native_fail_fallback', false);
            }
        };

        function syncUnitPeerIdToNative() {
            if (!peer || peer.destroyed || !peer.id) return;
            window.__unitPeerId = peer.id;
            if (window.Android && window.Android.setUnitPeerId) {
                window.Android.setUnitPeerId(peer.id);
            }
        }

        async function ensureStreamForViewer() {
            const hasLiveVideo = miStream
                && miStream.getVideoTracks
                && miStream.getVideoTracks().some(t => t.readyState === 'live');
            if (hasLiveVideo) return miStream;

            try {
                miStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
                const localVideo = document.getElementById('localVideo');
                if (localVideo) localVideo.srcObject = miStream;
                return miStream;
            } catch (e) {
                console.error('No se pudo reabrir cÃ¡mara/mic para viewer:', e);
                return miStream;
            }
        }

        async function refreshLocalPreview() {
            const localVideo = document.getElementById('localVideo');
            if (!localVideo || !miStream) return;

            try {
                // Rebind explÃ­cito para evitar preview roto al volver de segundo plano.
                localVideo.srcObject = null;
                localVideo.srcObject = miStream;
                const p = localVideo.play();
                if (p && typeof p.catch === 'function') {
                    p.catch(() => {});
                }
            } catch (e) {
                console.error('No se pudo refrescar preview local:', e);
            }
        }

        async function recoverCentralTransmissionAfterRecording() {
            if (!sessionActive) return;
            await recoverTransmission('post_recording');

            // Si despuÃ©s de la primera recuperaciÃ³n sigue sin llamada de video, recrea peer completo.
            setTimeout(() => {
                if (!sessionActive) return;
                if (!isMonitorActive()) return;
                if (centralVideoCall) return;
                setStatus('REC FINALIZADA - RECREANDO ENLACE...', false);
                schedulePeerRestart('RECREANDO ENLACE COMPLETO...', 300);
            }, 1600);
        }

        window.onAppForegroundResume = function() {
            if (foregroundRecoverTimer) {
                clearTimeout(foregroundRecoverTimer);
            }
            foregroundRecoverTimer = setTimeout(() => {
                const monitor = document.getElementById('monitor-activo');
                if (!monitor || monitor.style.display === 'none') return;
                refreshLocalPreview();
                recoverTransmission('app_resume');
            }, 350);
        };

        function bootstrapUnitIdFromStorage() {
            const saved = (localStorage.getItem('pablo_last_unidad_id') || '').trim().toUpperCase();
            if (!saved) return;

            const expectedPeerId = 'PABLO-U-' + saved;
            desiredUnitPeerId = expectedPeerId;
            window.__unitPeerId = expectedPeerId;

            const input = document.getElementById('unidadId');
            if (input && !input.value) input.value = saved;

            if (window.Android && window.Android.setUnitAlias) {
                window.Android.setUnitAlias(saved);
            }
            if (window.Android && window.Android.setUnitPeerId) {
                window.Android.setUnitPeerId(expectedPeerId);
            }
        }

        async function validarYActivar() {
            const nom = document.getElementById('unidadId').value.trim().toUpperCase();
            const tok = document.getElementById('tokenAcceso').value.trim();
            if (!nom || !tok) { alert('CompletÃ¡ ID y TOKEN'); return; }

            nombreActivo = nom;
            tokenActivo = tok;

            localStorage.setItem('pablo_last_unidad_id', nombreActivo);

            // Guardar alias de unidad en nativo para fallback del candado
            if (window.Android && window.Android.setUnitAlias) {
                window.Android.setUnitAlias(nombreActivo);
            }

            // Persistir ID esperado en nativo desde el arranque (aunque PeerJS aÃºn no abra)
            const expectedPeerId = 'PABLO-U-' + nombreActivo;
            window.__unitPeerId = expectedPeerId;
            if (window.Android && window.Android.setUnitPeerId) {
                window.Android.setUnitPeerId(expectedPeerId);
            }

            try {
                miStream = await navigator.mediaDevices.getUserMedia(getMediaConstraints());
            } catch(e) {
                alert('Sin acceso a cÃ¡mara/micrÃ³fono: ' + e.message);
                return;
            }
            document.getElementById('localVideo').srcObject = miStream;
            document.getElementById('setup').style.display = 'none';
            document.getElementById('monitor-activo').style.display = 'block';
            setStatus('CONECTANDO...', false);

            sessionActive = true;
            startTransmissionGuard();

            iniciarPeer();
        }

        function iniciarPeer() {
            if (!sessionActive) return;
            clearReconnectTimer();
            clearConnectWatchdog();

            if (!navigator.onLine) {
                setStatus('SIN INTERNET - ESPERANDO RED...', false);
                return;
            }

            if (peer && !peer.destroyed) {
                peer.destroy();
            }

            if (centralVideoCall) {
                try { centralVideoCall.close(); } catch (e) {}
                centralVideoCall = null;
            }
            viewerCalls.forEach((c) => {
                try { c.close(); } catch (e) {}
            });
            viewerCalls.clear();

            // ID estable por sesiÃ³n (no cambia en reconexiones de red)
            const peerId = 'PABLO-U-' + nombreActivo;
            desiredUnitPeerId = peerId;
            window.__unitPeerId = peerId;
            if (window.Android && window.Android.setUnitPeerId) {
                window.Android.setUnitPeerId(peerId);
            }
            peer = new Peer(peerId, PEER_OPTS);

            peer.on('open', () => {
                if (!sessionActive) return;
                syncUnitPeerIdToNative();
                conectar();
            });

            // Viewers se conectan al peer principal de la unidad
            peer.on('connection', (conn) => {
                conn.on('data', (data) => {
                    if (!data || data.tipo !== 'viewer_ready') return;

                    const tokenValido = !!viajeTokenActivo && data.token === viajeTokenActivo;
                    const linkVigente = Date.now() < viajeTokenExpiraEn;
                    if (!tokenValido || !linkVigente) {
                        try { conn.send({ tipo: 'viewer_denied' }); } catch (e) {}
                        return;
                    }

                    try { conn.send({ tipo: 'viewer_ok' }); } catch (e) {}

                    if (!viewerConns.includes(conn)) viewerConns.push(conn);
                    if (lastLat !== null) {
                        try { conn.send({ tipo: 'gps', lat: lastLat, lng: lastLng }); } catch (e) {}
                    }

                    (async () => {
                        const streamToSend = await ensureStreamForViewer();
                        if (!streamToSend) return;
                        try {
                            const prevCall = viewerCalls.get(conn.peer);
                            if (prevCall) {
                                try { prevCall.close(); } catch (e) {}
                            }
                            const vc = peer.call(conn.peer, streamToSend);
                            viewerCalls.set(conn.peer, vc);
                            vc.on('close', () => {
                                if (viewerCalls.get(conn.peer) === vc) {
                                    viewerCalls.delete(conn.peer);
                                }
                            });
                            vc.on('error', () => {
                                if (viewerCalls.get(conn.peer) === vc) {
                                    viewerCalls.delete(conn.peer);
                                }
                            });
                        } catch (e) {
                            console.error('No se pudo iniciar llamada al viewer:', e);
                        }
                    })();
                });

                conn.on('close', () => {
                    const vc = viewerCalls.get(conn.peer);
                    if (vc) {
                        try { vc.close(); } catch (e) {}
                        viewerCalls.delete(conn.peer);
                    }
                    viewerConns = viewerConns.filter(c => c !== conn);
                });
            });

            // Recibir audio push-to-talk desde la central.
            peer.on('call', (call) => {
                if (call.peer !== CENTRAL_PEER_ID) {
                    try { call.answer(); } catch (e) {}
                    return;
                }

                if (centralTalkCall) {
                    try { centralTalkCall.close(); } catch (e) {}
                }
                centralTalkCall = call;

                call.answer();

                call.on('stream', (remoteStream) => {
                    const audioEl = ensureCentralTalkAudio();
                    audioEl.srcObject = remoteStream;
                    const p = audioEl.play();
                    if (p && typeof p.catch === 'function') {
                        p.catch(() => {
                            setStatus('AUDIO CENTRAL BLOQUEADO - TOCA LA PANTALLA', false);
                        });
                    }
                });

                call.on('close', () => {
                    if (centralTalkCall === call) centralTalkCall = null;
                    if (centralTalkAudio) centralTalkAudio.srcObject = null;
                });

                call.on('error', (err) => {
                    console.error('Error llamada de audio central:', err);
                });
            });

            peer.on('error', (err) => {
                if (!sessionActive) return;
                if (err.type === 'peer-unavailable') {
                    setStatus('CENTRAL OFFLINE - REINTENTANDO EN 5s...', false);
                    scheduleReconnect(() => conectar(), RETRY_DELAY);
                } else if (err.type === 'unavailable-id') {
                    // Mantener ID estable: esperar y reintentar el mismo ID
                    setStatus('ID OCUPADO - REINTENTANDO MISMO ID...', false);
                    scheduleReconnect(() => iniciarPeer(), 2500);
                } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
                    setStatus('SIN RED - REINTENTANDO EN 5s...', false);
                    schedulePeerRestart('SIN RED - REINICIANDO ENLACE...', RETRY_DELAY);
                } else {
                    setStatus('ERROR: ' + err.type + ' - REINTENTANDO...', false);
                    schedulePeerRestart('ERROR DE ENLACE - REINTENTANDO...', RETRY_DELAY);
                }
            });

            peer.on('disconnected', () => {
                if (!sessionActive) return;
                setStatus('DESCONECTADO - RECONECTANDO...', false);
                if (!peer.destroyed) {
                    peer.reconnect();
                } else {
                    schedulePeerRestart('ENLACE CERRADO - REINICIANDO...', RETRY_DELAY);
                }
            });
        }

        function conectar() {
            if (!sessionActive) return;
            clearReconnectTimer();
            clearConnectWatchdog();

            if (!navigator.onLine) {
                setStatus('SIN INTERNET - ESPERANDO RED...', false);
                return;
            }

            if (!peer || peer.destroyed || !peer.id) {
                schedulePeerRestart('RESTAURANDO PEER...', 1200);
                return;
            }

            if (centralConnectInFlight) {
                return;
            }

            centralConnectInFlight = true;
            setStatus('CONECTANDO CON CENTRAL...', false);

            if (connCentral) {
                try { connCentral.close(); } catch(e) {}
            }

            connCentral = peer.connect(CENTRAL_PEER_ID, { reliable: true });

            connCentral.on('open', () => {
                if (!sessionActive) return;
                centralConnectInFlight = false;
                centralFailureCount = 0;
                clearConnectWatchdog();
                connCentral.send({ tipo: 'login', nombre: nombreActivo, token: tokenActivo });
                iniciarGPS();
            });

            connCentral.on('data', (data) => {
                if (!sessionActive) return;
                if (data.tipo === 'auth_ok') {
                    centralFailureCount = 0;
                    setStatus('EN LÃNEA', true);
                    syncUnitPeerIdToNative();
                    (async () => {
                        const stream = await ensureStreamForViewer();
                        if (!stream || !hasLiveLocalVideoTrack()) {
                            setStatus('EN LINEA SIN VIDEO - RECUPERANDO...', false);
                            scheduleReconnect(() => recoverTransmission('auth_ok_no_video'), 250);
                            return;
                        }
                        if (centralVideoCall) {
                            try { centralVideoCall.close(); } catch (e) {}
                        }
                        bindCentralVideoCall(peer.call(CENTRAL_PEER_ID, stream));
                    })();
                } else if (data.tipo === 'auth_fail') {
                    setStatus('TOKEN INCORRECTO', false);
                } else if (data.tipo === 'emergency_recording_ack') {
                    setStatus('EMERGENCIA REPORTADA', true);
                } else if (data.tipo === 'sos_operador') {
                    setStatus('SOS DESDE CENTRAL', false);
                    startEmergencyRecording('central_sos');
                }
            });

            connCentral.on('close', () => {
                if (!sessionActive) return;
                centralConnectInFlight = false;
                clearConnectWatchdog();
                centralFailureCount += 1;
                if (centralVideoCall) {
                    try { centralVideoCall.close(); } catch (e) {}
                    centralVideoCall = null;
                }
                setStatus('CONEXIÃ“N CERRADA - REINTENTANDO...', false);
                if (centralFailureCount >= 2) {
                    schedulePeerRestart('ENLACE INESTABLE - RECREANDO PEER...', 1400);
                    return;
                }
                scheduleReconnect(() => conectar(), RETRY_DELAY);
            });

            connCentral.on('error', (err) => {
                if (!sessionActive) return;
                centralConnectInFlight = false;
                clearConnectWatchdog();
                centralFailureCount += 1;
                if (centralVideoCall) {
                    try { centralVideoCall.close(); } catch (e) {}
                    centralVideoCall = null;
                }
                setStatus('ERROR CONEXIÃ“N - REINTENTANDO...', false);
                if (centralFailureCount >= 2) {
                    schedulePeerRestart('ERROR DE RED MOVIL - RECREANDO PEER...', 1400);
                    return;
                }
                scheduleReconnect(() => conectar(), RETRY_DELAY);
            });

            // Si en 10 segundos no hubo respuesta, reintentar
            connectWatchdogTimer = setTimeout(() => {
                connectWatchdogTimer = null;
                if (!sessionActive) return;
                if (!connCentral || !connCentral.open) {
                    centralConnectInFlight = false;
                    setStatus('SIN RESPUESTA - REINTENTANDO...', false);
                    conectar();
                }
            }, 10000);
        }

        function iniciarGPS() {
            if (watchId) navigator.geolocation.clearWatch(watchId);
            watchId = navigator.geolocation.watchPosition((pos) => {
                const now = Date.now();
                if (now - lastGpsBroadcastTs < 900) {
                    return;
                }
                lastGpsBroadcastTs = now;
                lastLat = pos.coords.latitude;
                lastLng = pos.coords.longitude;
                if (connCentral && connCentral.open) {
                    connCentral.send({ tipo: 'gps', lat: lastLat, lng: lastLng });
                }
                // Enviar GPS a los viewers del link de viaje
                viewerConns.forEach(c => { try { if (c.open) c.send({ tipo: 'gps', lat: lastLat, lng: lastLng }); } catch(e) {} });
            }, (err) => console.error("Error GPS:", err), { enableHighAccuracy: true, timeout: 8000, maximumAge: 1000 });
        }

        function cerrarSesionYSalir() {
            const ok = confirm('Se cerrara la sesion y se apagara la app. Continuar?');
            if (!ok) return;

            sessionActive = false;

            clearReconnectTimer();
            clearConnectWatchdog();
            stopTransmissionGuard();
            if (foregroundRecoverTimer) {
                clearTimeout(foregroundRecoverTimer);
                foregroundRecoverTimer = null;
            }
            stopQrCountdown();
            qrLinkActual = '';
            centralConnectInFlight = false;
            centralFailureCount = 0;

            try { invalidarLinkViajeActivo(); } catch (e) {}

            if (watchId) {
                try { navigator.geolocation.clearWatch(watchId); } catch (e) {}
                watchId = null;
            }

            if (connCentral) {
                try { connCentral.close(); } catch (e) {}
                connCentral = null;
            }

            if (centralVideoCall) {
                try { centralVideoCall.close(); } catch (e) {}
                centralVideoCall = null;
            }

            if (centralTalkCall) {
                try { centralTalkCall.close(); } catch (e) {}
                centralTalkCall = null;
            }

            if (centralTalkAudio) {
                try { centralTalkAudio.pause(); } catch (e) {}
                centralTalkAudio.srcObject = null;
            }

            viewerConns.forEach((c) => {
                try { c.close(); } catch (e) {}
            });
            viewerConns = [];

            viewerCalls.forEach((c) => {
                try { c.close(); } catch (e) {}
            });
            viewerCalls.clear();

            if (emergencyRecorder && emergencyRecorder.state !== 'inactive') {
                try { emergencyRecorder.stop(); } catch (e) {}
            }

            if (miStream) {
                try { miStream.getTracks().forEach(t => t.stop()); } catch (e) {}
                miStream = null;
            }

            if (peer && !peer.destroyed) {
                try { peer.destroy(); } catch (e) {}
            }
            peer = null;

            const localVideo = document.getElementById('localVideo');
            if (localVideo) localVideo.srcObject = null;

            setStatus('SESION CERRADA', false);
            document.body.classList.remove('pip-hidden');
            document.getElementById('monitor-activo').style.display = 'none';
            document.getElementById('setup').style.display = 'block';

            // No forzar cierre nativo de la app: evita inestabilidad en algunos equipos.
        }

        // â”€â”€ LINK DE VIAJE (presiÃ³n larga en candado flotante) â”€â”€
        window.generarLinkViaje = function(tokenForzado) {
            invalidarLinkViajeActivo();

            // Token de 6 caracteres alfanumÃ©ricos
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            const token = tokenForzado || Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            viajeTokenActivo = token;
            viajeTokenExpiraEn = Date.now() + VIAJE_LINK_TTL_MS;
            viajeTokenTimer = setTimeout(() => {
                invalidarLinkViajeActivo();
            }, VIAJE_LINK_TTL_MS + 200);

            // Usar peer activo o el Ãºltimo peer cacheado sincronizado a nativo
            const peerIdForLink = (peer && !peer.destroyed && peer.id)
                ? peer.id
                : (window.__unitPeerId || desiredUnitPeerId);
            if (!peerIdForLink) {
                return null;
            }

            const link = 'https://monitor-uber.vercel.app/viewer.html?u=' + encodeURIComponent(peerIdForLink) + '&v=' + token + '&exp=' + viajeTokenExpiraEn;

            // Fallback browser normal
            if (!window.Android) {
                navigator.clipboard && navigator.clipboard.writeText(link);
            }

            return link;
        };

        // MANTENER VIVO EN SEGUNDO PLANO + guardas anti-pantalla negra
        let hiddenModeSince = 0;
        function applyHiddenMode(enabled) {
            if (SAFE_DISABLE_HIDDEN_PIP) {
                document.body.classList.remove('pip-hidden');
                hiddenModeSince = 0;
                if (miStream) document.getElementById('localVideo').srcObject = miStream;
                return;
            }
            const on = !!enabled;
            document.body.classList.toggle('pip-hidden', on);
            if (on) {
                hiddenModeSince = Date.now();
            } else {
                hiddenModeSince = 0;
                if (miStream) document.getElementById('localVideo').srcObject = miStream;
            }
        }

        function forceRecoverUiIfStuck() {
            // Si la app esta visible y quedo en pip-hidden por error, recuperar UI.
            if (!document.hidden && document.body.classList.contains('pip-hidden')) {
                applyHiddenMode(false);
            }
        }

        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                applyHiddenMode(true);
                return;
            }
            applyHiddenMode(false);
        });

        window.addEventListener('pageshow', () => {
            applyHiddenMode(false);
        });

        window.addEventListener('focus', () => {
            forceRecoverUiIfStuck();
        });

        // Watchdog: evita quedarse negro por un toggle atascado en algunos equipos.
        setInterval(() => {
            if (document.body.classList.contains('pip-hidden') && !document.hidden) {
                applyHiddenMode(false);
                return;
            }
            if (hiddenModeSince && !document.hidden && (Date.now() - hiddenModeSince > 10000)) {
                applyHiddenMode(false);
            }
        }, 1500);

        window.setHiddenPipMode = function(enabled) {
            applyHiddenMode(enabled);
        };

        // Heartbeat de sincronizaciÃ³n para nativo (evita null en PiP/background)
        setInterval(syncUnitPeerIdToNative, 2000);

        bootstrapUnitIdFromStorage();
    
