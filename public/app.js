// P2P NOTES - Sistema de Notas Colaborativas Descentralizado
// Tecnolog�as: WebRTC, Socket.IO, localStorage
// PATR�N STRATEGY IMPLEMENTADO para: Resoluci�n de Conflictos, Almacenamiento y Broadcasting

// DEBUG MÓVIL - Consola flotante (QUITAR DESPUÉS DE DEBUGGEAR)
(function() {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/eruda';
    script.onload = function() { 
        eruda.init();
        console.log('🔧 [DEBUG] Eruda consola activada para móvil');
    };
    document.head.appendChild(script);
})();

class P2PNotesApp {
    constructor() {
        this.socket = null;
        this.peers = new Map();
        this.pendingCandidates = new Map();
        this.notes = new Map();
        this.nodeId = this.generateNodeId();
        this.editingNoteId = null;
        
        // PATR�N STRATEGY: Inicializar gestores de estrategias
        this.conflictResolver = new ConflictResolver(new LastWriteWinsStrategy());
        this.storageManager = new StorageManager(new LocalStorageStrategy());
        this.broadcastManager = new BroadcastManager(new BroadcastAllStrategy());
        
        // Almacenar configuraci�n de estrategias de peers remotos
        this.peerStrategies = new Map(); // peerId -> { conflict, broadcast }
        
        // Control de sincronización para evitar loops
        this.syncInProgress = new Set(); // peerIds que están sincronizando
        
        this.init();
    }
        this.peerStrategies = new Map(); // peerId -> { conflict, broadcast }
        
        this.init();
    }

    generateNodeId() {
        return 'node_' + Math.random().toString(36).substring(2, 11);
    }

    init() {
        this.loadNotesFromStorage();
        this.initSocketConnection();
        this.initUI();
        this.renderNotes();
        this.updateStats();
        
        // Mostrar el nodeId en la interfaz inmediatamente
        const nodeIdElement = document.getElementById('nodeId');
        if (nodeIdElement) {
            nodeIdElement.textContent = this.nodeId;
        }
    }
    // Establece la conexi�n con el servidor de se�alizaci�n mediante Socket.IO
    // Este servidor act�a como intermediario para el descubrimiento de peers y el intercambio de se�ales WebRTC
    initSocketConnection() {
        // Inicializa la conexi�n Socket.IO con el servidor
        this.socket = io();
        
        // Evento: Cuando se establece conexi�n exitosa con el servidor
        this.socket.on('connect', () => {
            console.log('\n========================================');
            console.log('?? CONECTADO AL SERVIDOR');
            console.log('========================================');
            console.log('Tu Node ID:', this.nodeId);
            console.log('Socket ID:', this.socket.id);
            console.log('========================================\n');
            
            // Actualiza el indicador visual de estado
            this.updateConnectionStatus(true);
            // Muestra el ID �nico de este nodo en la interfaz
            document.getElementById('nodeId').textContent = this.nodeId;
        });

        // Evento: Cuando se pierde la conexi�n con el servidor
        this.socket.on('disconnect', () => {
            console.log('[DESCONEXION] Desconectado del servidor');
            // Actualiza el indicador visual a desconectado
            this.updateConnectionStatus(false);
        });

        // Evento: Recibe la lista inicial de peers conectados al unirse a la red
        this.socket.on('peer-list', (peerIds) => {
            console.log('[PEERS] Lista recibida:', peerIds);
            // Intenta conectarse con cada peer existente
            peerIds.forEach(peerId => {
                // Evita conectarse consigo mismo y peers ya conectados
                if (peerId !== this.socket.id && !this.peers.has(peerId)) {
                    this.connectToPeer(peerId);
                }
            });
        });

        // Evento: Cuando un nuevo peer se une a la red
        this.socket.on('peer-joined', (peerId) => {
            console.log('[PEER] Nuevo peer:', peerId);
            // Inicia conexi�n WebRTC con el nuevo peer si no est� conectado
            if (!this.peers.has(peerId)) {
                this.connectToPeer(peerId);
            }
        });

        // Evento: Cuando un peer se desconecta de la red
        this.socket.on('peer-left', (peerId) => {
            console.log('[PEER] Desconectado:', peerId);
            // Limpia la conexi�n y libera recursos del peer desconectado
            this.removePeer(peerId);
        });

        // Evento: Recibe se�ales WebRTC (ofertas, respuestas, ICE candidates) de otros peers
        this.socket.on('signal', (data) => {
            // Procesa la se�al recibida seg�n su tipo
            this.handleSignal(data);
        });
    }
    // Inicia la conexi�n WebRTC P2P directa con otro peer
    // Este nodo act�a como el Iniciador (Caller) que env�a la oferta SDP
    async connectToPeer(peerId) {
        console.log('[WebRTC] Conectando con:', peerId);

        // Verificar si ya existe una conexi�n con este peer
        const existingPeer = this.peers.get(peerId);
        if (existingPeer && existingPeer.pc) {
            const state = existingPeer.pc.signalingState;
            console.log(`[WebRTC] Ya existe conexi�n con ${peerId} en estado '${state}'`);
            
            // Si ya est� conectado o conectando, no crear nueva conexi�n
            if (state === 'stable' || state === 'have-local-offer') {
                const connState = existingPeer.pc.connectionState;
                if (connState === 'connected' || connState === 'connecting') {
                    console.warn('[WARN] Ya existe conexi�n activa, cancelando nueva conexi�n');
                    return;
                }
            }
            
            // Cerrar conexi�n anterior si existe
            console.log('[WebRTC] Cerrando conexi�n anterior');
            existingPeer.pc.close();
            this.peers.delete(peerId);
        }

        // Configuraci�n de servidores ICE para descubrir direcciones IP p�blicas
        // STUN servers ayudan a atravesar NATs y descubrir la IP p�blica
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },    // Servidor STUN de Google
                { urls: 'stun:stun1.l.google.com:19302' }    // Servidor STUN alternativo
            ]
        };
        
        // Crea una nueva conexi�n peer-to-peer con la configuraci�n especificada
        const pc = new RTCPeerConnection(configuration);

        // Listener: Detecta cambios en el estado de la conexión WebRTC
        // Estados posibles: new, connecting, connected, disconnected, failed, closed
        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] Estado con ${peerId}:`, pc.connectionState);
            
            // Logging detallado para debugging
            if (pc.connectionState === 'failed') {
                console.error(`❌ [ERROR] Conexión FALLIDA con ${peerId}`);
                console.log('ICE Connection State:', pc.iceConnectionState);
                console.log('Signaling State:', pc.signalingState);
            } else if (pc.connectionState === 'connected') {
                console.log(`✅ [ÉXITO] Conectado exitosamente con ${peerId}`);
            } else if (pc.connectionState === 'disconnected') {
                console.warn(`⚠️ [WARN] Desconectado de ${peerId}, intentando reconectar...`);
            }
            
            this.updateStats();
        };

        // Listener: Monitorea el proceso de recolección de ICE candidates
        // Estados: new, gathering, complete
        pc.onicegatheringstatechange = () => {
            console.log(`[ICE] Gathering con ${peerId}:`, pc.iceGatheringState);
            if (pc.iceGatheringState === 'complete') {
                console.log(`✅ [ICE] Recolección completa con ${peerId}`);
            }
        };

        // Monitorear estado ICE connection
        pc.oniceconnectionstatechange = () => {
            console.log(`[ICE] Connection State con ${peerId}:`, pc.iceConnectionState);
            if (pc.iceConnectionState === 'failed') {
                console.error(`❌ [ICE] Conexión ICE FALLIDA con ${peerId} - Verifica firewalls/NAT`);
            } else if (pc.iceConnectionState === 'connected') {
                console.log(`✅ [ICE] ICE conectado con ${peerId}`);
            }
        };

        // Crea un canal de datos para intercambiar mensajes
        // ordered: true asegura que los mensajes lleguen en orden
        const dataChannel = pc.createDataChannel('notes', { ordered: true });
        this.setupDataChannel(dataChannel, peerId);

        // Listener: Se activa cada vez que se genera un nuevo ICE candidate
        // Los ICE candidates son posibles rutas de conexi�n (direcciones IP/puertos)
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[ICE] Enviando candidate a', peerId);
                // Env�a el candidate al peer remoto a trav�s del servidor de se�alizaci�n
                this.socket.emit('signal', {
                    to: peerId,
                    signal: { type: 'ice-candidate', candidate: event.candidate }
                });
            }
        };

        try {
            // Crea una oferta SDP que describe las capacidades multimedia de este peer
            const offer = await pc.createOffer();
            // Establece la oferta como descripci�n local (inicia el proceso ICE)
            await pc.setLocalDescription(offer);

            console.log('[WebRTC] Enviando oferta a', peerId);
            // Env�a la oferta SDP al peer remoto para iniciar la negociaci�n
            this.socket.emit('signal', {
                to: peerId,
                signal: { type: 'offer', sdp: offer }
            });

            // Almacena la conexi�n peer con su informaci�n de estado
            this.peers.set(peerId, { pc, dataChannel, isRemoteDescriptionSet: false });
            // Inicializa array para almacenar ICE candidates que lleguen antes de tiempo
            this.pendingCandidates.set(peerId, []);
            this.updateStats();
        } catch (error) {
            console.error('[ERROR] Error en oferta:', error);
        }
    }

    async handleSignal(data) {
        const { from, signal } = data;

        if (signal.type === 'offer') {
            await this.handleOffer(from, signal);
        } else if (signal.type === 'answer') {
            await this.handleAnswer(from, signal);
        } else if (signal.type === 'ice-candidate') {
            await this.handleIceCandidate(from, signal);
        }
    }
    // Responde a una oferta SDP recibida de otro peer
    // Este nodo act�a como Receptor (Callee) que responde a la solicitud de conexi�n
    async handleOffer(peerId, signal) {
        console.log('[WebRTC] Oferta recibida de', peerId);

        // Verificar si ya existe una conexión con este peer
        const existingPeer = this.peers.get(peerId);
        if (existingPeer && existingPeer.pc) {
            const state = existingPeer.pc.signalingState;
            console.log(`[WebRTC] Ya existe conexión con ${peerId} en estado '${state}'`);
            
            // Resolver conflicto de ofertas simultáneas (glare)
            if (state === 'have-local-offer') {
                console.warn('[WARN] ⚠️ Conflicto de ofertas simultáneas detectado');
                
                // El peer con ID mayor responde a la oferta, el menor espera
                if (this.nodeId > peerId) {
                    console.log('[GLARE] 🔄 Mi ID es mayor, procesando oferta recibida');
                    existingPeer.pc.close();
                    this.peers.delete(peerId);
                } else {
                    console.log('[GLARE] ⏳ Mi ID es menor, esperando respuesta a mi oferta');
                    return;
                }
            } else if (state !== 'stable' && state !== 'closed') {
                console.warn('[WARN] Estado incompatible, ignorando oferta');
                return;
            }
            
            // Si está stable o closed, cerrar y crear nueva conexión
            if (state === 'stable' || state === 'closed') {
                console.log('[WebRTC] Cerrando conexión anterior y creando nueva');
                existingPeer.pc.close();
            }
        }

        // Configuraci�n de servidores STUN para descubrir IP p�blica
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ],
            iceCandidatePoolSize: 10
        };

        // Crea la conexi�n peer-to-peer para responder a la oferta
        const pc = new RTCPeerConnection(configuration);

        // Listener: Se activa cuando el peer remoto crea un canal de datos
        // El Callee recibe el canal, mientras que el Caller lo crea
        pc.ondatachannel = (event) => {
            console.log('[WebRTC] DataChannel recibido de', peerId);
            // Configura los listeners para el canal de datos recibido
            this.setupDataChannel(event.channel, peerId);
        };

        // Listener: Monitorea cambios en el estado de la conexión
        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] Estado con ${peerId}:`, pc.connectionState);
            
            if (pc.connectionState === 'failed') {
                console.error(`❌ [ERROR] Conexión FALLIDA con ${peerId}`);
                console.log('ICE Connection State:', pc.iceConnectionState);
                console.log('Signaling State:', pc.signalingState);
                this.showToast(`❌ Conexión perdida con ${peerId.substring(0, 8)}`, 'error');
                
                // Intentar reconexión automática después de 3 segundos
                console.log(`🔄 [RECONEXIÓN] Intentando reconectar con ${peerId} en 3s...`);
                setTimeout(() => {
                    if (this.peers.has(peerId)) {
                        console.log(`🔄 [RECONEXIÓN] Reintentando conexión con ${peerId}`);
                        this.removePeer(peerId);
                        this.createPeerConnection(peerId);
                    }
                }, 3000);
            } else if (pc.connectionState === 'connected') {
                console.log(`✅ [ÉXITO] Conectado exitosamente con ${peerId}`);
            } else if (pc.connectionState === 'disconnected') {
                console.warn(`⚠️ [WARN] Desconectado de ${peerId}`);
                // No reconectar inmediatamente, esperar a ver si pasa a 'failed'
            }
            
            this.updateStats();
        };

        // Listener: Monitorea el proceso de recolección de ICE candidates
        pc.onicegatheringstatechange = () => {
            console.log(`[ICE] Gathering con ${peerId}:`, pc.iceGatheringState);
            if (pc.iceGatheringState === 'complete') {
                console.log(`✅ [ICE] Recolección completa con ${peerId}`);
            }
        };

        // Monitorear estado ICE connection
        pc.oniceconnectionstatechange = () => {
            console.log(`[ICE] Connection State con ${peerId}:`, pc.iceConnectionState);
            if (pc.iceConnectionState === 'failed') {
                console.error(`❌ [ICE] Conexión ICE FALLIDA con ${peerId} - Verifica firewalls/NAT`);
            } else if (pc.iceConnectionState === 'connected') {
                console.log(`✅ [ICE] ICE conectado con ${peerId}`);
            }
        };

        // Listener: Env�a cada ICE candidate generado al peer remoto
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[ICE] Enviando candidate a', peerId);
                this.socket.emit('signal', {
                    to: peerId,
                    signal: { type: 'ice-candidate', candidate: event.candidate }
                });
            }
        };

        try {
            // Registrar peer INMEDIATAMENTE (antes de async) para evitar race condition
            // Los candidates pueden llegar mientras esperamos setRemoteDescription
            this.peers.set(peerId, { pc, dataChannel: null, isRemoteDescriptionSet: false });
            
            // Establece la oferta SDP recibida como descripci�n remota
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            
            // Actualizar estado: remote description ya establecida
            const peer = this.peers.get(peerId);
            if (peer) peer.isRemoteDescriptionSet = true;
            
            // Procesa cualquier ICE candidate que lleg� antes de la oferta
            await this.processPendingCandidates(peerId);

            // Crea una respuesta SDP que acepta/rechaza las capacidades ofrecidas
            const answer = await pc.createAnswer();
            // Establece la respuesta como descripci�n local
            await pc.setLocalDescription(answer);

            console.log('[WebRTC] Enviando answer a', peerId);
            // Env�a la respuesta SDP al peer que inici� la conexi�n
            this.socket.emit('signal', {
                to: peerId,
                signal: { type: 'answer', sdp: answer }
            });

            this.updateStats();
        } catch (error) {
            console.error('[ERROR] Error en oferta:', error);
        }
    }

    async handleAnswer(peerId, signal) {
        console.log('[WebRTC] Answer recibida de', peerId);

        const peer = this.peers.get(peerId);
        if (!peer) {
            console.error('[ERROR] Peer no encontrado:', peerId);
            return;
        }

        // Verificar el estado de la conexi�n
        const currentState = peer.pc.signalingState;
        console.log('[WebRTC] Estado actual de se�alizaci�n:', currentState);

        // Solo procesar la respuesta si estamos esperando una
        if (currentState !== 'have-local-offer') {
            console.warn(`[WARN] No se puede procesar answer en estado '${currentState}'. Se esperaba 'have-local-offer'.`);
            console.warn('[WARN] Posible respuesta duplicada o fuera de orden. Ignorando...');
            return;
        }

        try {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            
            // Marcar que remote description está establecida
            peer.isRemoteDescriptionSet = true;
            console.log('[WebRTC] Remote description establecida correctamente');
            await this.processPendingCandidates(peerId);
            this.updateStats();
        } catch (error) {
            console.error('[ERROR] Error en answer:', error);
            console.error('[ERROR] Estado de se�alizaci�n:', peer.pc.signalingState);
            console.error('[ERROR] Estado de conexi�n:', peer.pc.connectionState);
        }
    }

    // Maneja los ICE candidates recibidos de un peer remoto
    // Los ICE candidates son posibles rutas de red para establecer la conexi�n
    async handleIceCandidate(peerId, signal) {
        console.log('[ICE] Candidate recibido de', peerId);

        // Busca la conexi�n peer existente
        const peer = this.peers.get(peerId);
        
        // Si el peer no existe AÚN, guardar candidate como pendiente
        // (puede llegar antes de que se complete handleOffer/handleAnswer)
        if (!peer) {
            console.log('[ICE] ⏳ Peer aún no registrado, guardando candidate pendiente');
            if (!this.pendingCandidates.has(peerId)) {
                this.pendingCandidates.set(peerId, []);
            }
            this.pendingCandidates.get(peerId).push(signal.candidate);
            return;
        }

        // Verifica si la descripci�n remota ya fue establecida
        // Los ICE candidates solo pueden agregarse despu�s de setRemoteDescription
        if (!peer.isRemoteDescriptionSet) {
            console.log('[ICE] Guardando candidate pendiente (sin remote description)');
            // Si la descripci�n remota no est� lista, guarda el candidate para despu�s
            if (!this.pendingCandidates.has(peerId)) {
                this.pendingCandidates.set(peerId, []);
            }
            this.pendingCandidates.get(peerId).push(signal.candidate);
            return;
        }

        try {
            // Agrega el ICE candidate a la conexi�n peer
            // Esto permite que WebRTC pruebe esta ruta de conexi�n
            await peer.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
            console.log('[ICE] Candidate agregado');
        } catch (error) {
            console.error('[ERROR] Error en candidate:', error);
        }
    }

    async processPendingCandidates(peerId) {
        const candidates = this.pendingCandidates.get(peerId);
        if (!candidates || candidates.length === 0) {
            return;
        }

        console.log(`[ICE] Procesando ${candidates.length} candidates pendientes`);

        const peer = this.peers.get(peerId);
        for (const candidate of candidates) {
            try {
                await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('[ERROR] Error en candidate pendiente:', error);
            }
        }

        this.pendingCandidates.set(peerId, []);
    }

    // Configura los listeners del canal de datos (DataChannel) para comunicaci�n P2P
    // El DataChannel permite intercambiar mensajes directamente entre peers sin servidor
    setupDataChannel(dataChannel, peerId) {
        // Listener: Se activa cuando el canal de datos se abre y est� listo para usar
        dataChannel.onopen = () => {
            console.log('✅ ✅ ✅ [DataChannel] ABIERTO con', peerId);
            this.showToast(`✅ Conectado con peer ${peerId.substring(0, 8)}...`, 'success');
            
            // Actualiza la referencia del canal en el objeto peer
            const peer = this.peers.get(peerId);
            if (peer) {
                peer.dataChannel = dataChannel;
                console.log(`[DataChannel] Referencia actualizada para ${peerId}`);
            } else {
                console.error(`❌ [ERROR] Peer ${peerId} no encontrado al abrir DataChannel`);
            }
            
            // Actualiza las estad�sticas de la interfaz
            this.updateStats();
            // Sincroniza todas las notas locales con el peer reci�n conectado
            console.log(`[SYNC] Iniciando sincronización con ${peerId}...`);
            this.syncAllNotesWithPeer(peerId);
        };

        // Listener: Se activa cuando el canal de datos se cierra
        dataChannel.onclose = () => {
            console.log('[DataChannel] Cerrado con', peerId);
            this.updateStats();
        };

        // Listener: Maneja errores en el canal de datos
        dataChannel.onerror = (error) => {
            console.error('[ERROR] DataChannel:', error);
        };

        // Listener: Se activa cuando se recibe un mensaje del peer remoto
        dataChannel.onmessage = (event) => {
            try {
                console.log(`📨 [DataChannel] Mensaje recibido de ${peerId}`);
                // Parsea el mensaje JSON recibido
                const message = JSON.parse(event.data);
                console.log(`   Tipo: ${message.type}`);
                // Procesa el mensaje seg�n su tipo (sync, create, update, delete)
                this.handlePeerMessage(message, peerId);
            } catch (error) {
                console.error('❌ [ERROR] Error en mensaje:', error);
                console.error('   Datos:', event.data);
            }
        };
    }

    syncAllNotesWithPeer(peerId, isResponse = false) {
        const peer = this.peers.get(peerId);
        if (!peer?.dataChannel || peer.dataChannel.readyState !== 'open') {
            console.warn(`[SYNC] No se puede sincronizar con ${peerId}: DataChannel no disponible`);
            return;
        }
        
        // Prevenir loops de sincronización
        if (!isResponse && this.syncInProgress.has(peerId)) {
            console.log(`[SYNC] Ya hay sincronización en progreso con ${peerId}, omitiendo...`);
            return;
        }
        
        if (!isResponse) {
            this.syncInProgress.add(peerId);
        }

        console.log(`\n========================================`);
        console.log(`📤 SINCRONIZANDO TODAS LAS NOTAS ${isResponse ? '(RESPUESTA)' : ''}`);
        console.log(`========================================`);
        console.log('Peer destino:', peerId);
        console.log('Total de notas a enviar:', this.notes.size);
        console.log('Estado del DataChannel:', peer.dataChannel.readyState);

        const notesArray = Array.from(this.notes.values());
        
        // Log detallado de cada nota
        notesArray.forEach((note, index) => {
            console.log(`\nNota ${index + 1}:`);
            console.log('  - ID:', note.id);
            console.log('  - T�tulo:', note.title);
            console.log('  - Autor:', note.author);
            console.log('  - Timestamp:', new Date(note.timestamp).toLocaleString());
        });
        
        const message = {
            type: 'sync-all',
            notes: notesArray,
            from: this.nodeId,
            timestamp: Date.now(),
            isResponse: isResponse
        };

        try {
            const messageStr = JSON.stringify(message);
            const messageSize = new Blob([messageStr]).size;
            
            console.log('\n?? Mensaje de sincronizaci�n:');
            console.log('  - Tipo:', message.type);
            console.log('  - Tama�o:', messageSize, 'bytes');
            console.log('  - Notas incluidas:', notesArray.length);
            console.log('  - Es respuesta:', isResponse);
            
            peer.dataChannel.send(messageStr);
            
            // Enviar tambi�n la configuraci�n de estrategias
            if (!isResponse) {
                this.sendStrategyConfig(peerId);
            }
            
            console.log('? Sincronizaci�n enviada exitosamente');
            console.log('========================================\n');
            
            // Limpiar flag después de 2 segundos
            if (!isResponse) {
                setTimeout(() => this.syncInProgress.delete(peerId), 2000);
            }
        } catch (error) {
            console.error('\n? ERROR AL SINCRONIZAR');
            console.error('========================================');
            console.error('Peer:', peerId);
            console.error('Error:', error.message);
            console.error('Stack:', error.stack);
            console.error('========================================\n');
        }
    }

    // Enviar configuraci�n de estrategias al peer
    sendStrategyConfig(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer?.dataChannel || peer.dataChannel.readyState !== 'open') {
            return;
        }

        const config = {
            conflict: this.conflictResolver.getCurrentStrategyName(),
            broadcast: this.broadcastManager.getCurrentStrategyName(),
            // No enviamos storage porque es local
        };

        const message = {
            type: 'strategy-config',
            config: config,
            from: this.nodeId
        };

        try {
            peer.dataChannel.send(JSON.stringify(message));
            console.log('[CONFIG] Configuraci�n de estrategias enviada a', peerId);
        } catch (error) {
            console.error('[ERROR] Error al enviar configuraci�n:', error);
        }
    }

    // Recibir y almacenar configuraci�n de estrategias del peer
    handleStrategyConfig(config, peerId) {
        console.log('\n========================================');
        console.log('?? CONFIGURACI�N DE PEER RECIBIDA');
        console.log('========================================');
        console.log('Peer:', peerId);
        console.log('Estrategia de conflictos:', config.conflict);
        console.log('Estrategia de broadcast:', config.broadcast);
        
        // Almacenar configuraci�n del peer
        this.peerStrategies.set(peerId, config);
        
        // Actualizar panel de peers si est� abierto
        const peersPanel = document.getElementById('peersPanel');
        if (peersPanel && peersPanel.style.display === 'block') {
            this.refreshPeersList();
        }
        
        // Detectar incompatibilidades
        const myConflictStrategy = this.conflictResolver.getCurrentStrategyName();
        if (config.conflict !== myConflictStrategy) {
            console.warn('?? ADVERTENCIA: Incompatibilidad detectada');
            console.warn(`   Tu estrategia: ${myConflictStrategy}`);
            console.warn(`   Peer ${peerId}: ${config.conflict}`);
            console.warn('   Esto puede causar datos inconsistentes entre peers.');
            
            this.showStrategyWarning(peerId, myConflictStrategy, config.conflict);
        } else {
            console.log('? Estrategias compatibles');
        }
        console.log('========================================\n');
    }

    // Mostrar advertencia de incompatibilidad de estrategias
    showStrategyWarning(peerId, myStrategy, peerStrategy) {
        const warningDiv = document.createElement('div');
        warningDiv.className = 'strategy-warning';
        warningDiv.innerHTML = `
            <div class="warning-content">
                <h4>?? Incompatibilidad de Estrategias Detectada</h4>
                <p>El peer <code>${peerId.substring(0, 12)}...</code> est� usando una estrategia diferente:</p>
                <ul>
                    <li><strong>Tu estrategia:</strong> ${myStrategy}</li>
                    <li><strong>Peer remoto:</strong> ${peerStrategy}</li>
                </ul>
                <p>Esto puede causar que las notas sean diferentes en cada dispositivo.</p>
                <div class="warning-actions">
                    <button class="btn btn-warning" onclick="app.requestStrategyChange('${peerId}')">
                        ?? Sugerir mi configuraci�n al peer
                    </button>
                    <button class="btn btn-secondary" onclick="app.adoptPeerStrategy('${peerId}')">
                        ?? Adoptar configuraci�n del peer
                    </button>
                    <button class="btn btn-secondary" onclick="this.parentElement.parentElement.parentElement.remove()">
                        ? Ignorar
                    </button>
                </div>
            </div>
        `;
        
        // Agregar al DOM si no existe ya
        const existingWarning = document.querySelector('.strategy-warning');
        if (!existingWarning) {
            document.body.appendChild(warningDiv);
            
            // Auto-eliminar despu�s de 30 segundos
            setTimeout(() => {
                if (warningDiv.parentElement) {
                    warningDiv.remove();
                }
            }, 30000);
        }
    }

    // Solicitar a un peer que cambie su estrategia
    requestStrategyChange(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer?.dataChannel || peer.dataChannel.readyState !== 'open') {
            alert('El peer no est� conectado');
            return;
        }

        const message = {
            type: 'strategy-change-request',
            strategyType: 'conflict',
            strategyName: this.conflictResolver.getCurrentStrategyName(),
            from: this.nodeId
        };

        try {
            peer.dataChannel.send(JSON.stringify(message));
            console.log(`[CONFIG] Solicitando cambio de estrategia a ${peerId}`);
            alert(`Solicitud enviada a ${peerId.substring(0, 12)}...\nEl peer puede aceptar o rechazar el cambio.`);
            
            // Cerrar advertencia
            const warning = document.querySelector('.strategy-warning');
            if (warning) warning.remove();
        } catch (error) {
            console.error('[ERROR] Error al solicitar cambio:', error);
            alert('Error al enviar solicitud');
        }
    }

    // Adoptar la estrategia de un peer remoto
    adoptPeerStrategy(peerId) {
        const peerConfig = this.peerStrategies.get(peerId);
        if (!peerConfig) {
            alert('Configuraci�n del peer no disponible');
            return;
        }

        console.log(`[CONFIG] Adoptando configuraci�n de ${peerId}`);
        
        // Cambiar estrategia de conflictos
        this.setConflictStrategy(peerConfig.conflict);
        
        // Opcional: cambiar broadcast tambi�n
        if (peerConfig.broadcast) {
            this.setBroadcastStrategy(peerConfig.broadcast);
        }

        alert(`Configuraci�n adoptada:\n- Conflictos: ${peerConfig.conflict}\n- Broadcasting: ${peerConfig.broadcast}`);
        
        // Cerrar advertencia
        const warning = document.querySelector('.strategy-warning');
        if (warning) warning.remove();
    }

    // Manejar solicitud de cambio de estrategia de otro peer
    handleStrategyChangeRequest(strategyType, strategyName, fromPeerId) {
        console.log(`\n[CONFIG] Solicitud de cambio recibida de ${fromPeerId}`);
        console.log(`  Tipo: ${strategyType}`);
        console.log(`  Estrategia sugerida: ${strategyName}`);

        const currentStrategy = strategyType === 'conflict' 
            ? this.conflictResolver.getCurrentStrategyName()
            : this.broadcastManager.getCurrentStrategyName();

        if (confirm(`El peer ${fromPeerId.substring(0, 12)}... sugiere cambiar tu estrategia de ${strategyType}:\n\nActual: ${currentStrategy}\nSugerida: ${strategyName}\n\n�Aceptar el cambio?`)) {
            if (strategyType === 'conflict') {
                this.setConflictStrategy(strategyName);
            } else if (strategyType === 'broadcast') {
                this.setBroadcastStrategy(strategyName);
            }
            console.log(`[CONFIG] Cambio aceptado: ${strategyName}`);
            alert(`Estrategia cambiada a: ${strategyName}`);
        } else {
            console.log('[CONFIG] Cambio rechazado por el usuario');
        }
    }

    // Procesa los mensajes recibidos de otros peers a trav�s del DataChannel
    // Distribuye los mensajes seg�n su tipo a los handlers espec�ficos
    handlePeerMessage(message, peerId) {
        console.log('[MENSAJE] Recibido de', peerId, ':', message.type);

        // Enruta el mensaje al handler apropiado seg�n el tipo
        switch (message.type) {
            case 'sync-all':
                // Sincronizaci�n inicial: recibe todas las notas del peer
                this.handleSyncAll(message.notes, peerId, message);
                break;
            case 'note-created':
                // Notificaci�n de nueva nota creada por el peer
                this.handleRemoteNoteCreated(message.note);
                break;
            case 'note-updated':
                // Notificaci�n de nota modificada por el peer
                this.handleRemoteNoteUpdated(message.note);
                break;
            case 'note-deleted':
                // Notificaci�n de nota eliminada por el peer
                this.handleRemoteNoteDeleted(message.noteId);
                break;
            case 'strategy-config':
                // Configuraci�n de estrategias del peer remoto
                this.handleStrategyConfig(message.config, peerId);
                break;
            case 'strategy-change-request':
                // Solicitud para cambiar estrategia localmente
                this.handleStrategyChangeRequest(message.strategyType, message.strategyName, peerId);
                break;
            default:
                // Tipo de mensaje no reconocido
                console.warn('[WARNING] Tipo desconocido:', message.type);
        }
    }

    handleSyncAll(remoteNotes, peerId, message) {
        console.log(`\n📥 [SYNC] Procesando ${remoteNotes.length} notas remotas de ${peerId}`);
        console.log(`📦 [SYNC] Notas locales actuales: ${this.notes.size}`);
        console.log(`🔄 [SYNC] Es respuesta: ${message?.isResponse || false}`);

        let added = 0, updated = 0, skipped = 0, deleted = 0;
        
        // Crear un Set con los IDs de las notas remotas
        const remoteNoteIds = new Set(remoteNotes.map(note => note.id));
        
        // Primero, procesar las notas recibidas
        remoteNotes.forEach(remoteNote => {
            const localNote = this.notes.get(remoteNote.id);

            if (!localNote) {
                this.notes.set(remoteNote.id, remoteNote);
                added++;
                console.log(`  ➕ Agregada: ${remoteNote.title}`);
            } else {
                // PATR�N STRATEGY: Usar estrategia de resoluci�n de conflictos
                const resolvedNote = this.conflictResolver.resolve(localNote, remoteNote);
                if (resolvedNote.timestamp !== localNote.timestamp) {
                    this.notes.set(remoteNote.id, resolvedNote);
                    updated++;
                    console.log(`  ♻️ Actualizada: ${resolvedNote.title}`);
                } else {
                    skipped++;
                }
            }
        });
        
        // Detectar notas que tenemos localmente pero no están en remoto
        // (probablemente fueron eliminadas en el peer remoto)
        const localNotesToCheck = Array.from(this.notes.keys()).filter(id => {
            return !remoteNoteIds.has(id) && !id.startsWith(`note_${this.nodeId}`);
        });
        
        if (localNotesToCheck.length > 0) {
            console.log(`⚠️ [SYNC] Detectadas ${localNotesToCheck.length} notas locales no presentes en remoto`);
            // No eliminar automáticamente - podría ser que las creamos recientemente
            // Solo mostrar advertencia
        }

        console.log(`\n📊 [SYNC] Resumen:`);
        console.log(`  ➕ ${added} nuevas`);
        console.log(`  ♻️ ${updated} actualizadas`);
        console.log(`  ⏭️ ${skipped} sin cambios`);
        console.log(`  📦 Total después: ${this.notes.size}`);
        console.log(`  🎯 Estrategia: ${this.conflictResolver.getCurrentStrategyName()}\n`);

        this.saveNotesToStorage();
        this.renderNotes();
        this.updateStats();
        
        // Responder con sincronización inversa SOLO si no es una respuesta ya
        // Esto previene loops infinitos
        if (!message?.isResponse) {
            const peer = this.peers.get(peerId);
            if (peer?.dataChannel && peer.dataChannel.readyState === 'open') {
                console.log(`🔄 [SYNC] Enviando sincronización inversa a ${peerId}...`);
                setTimeout(() => this.syncAllNotesWithPeer(peerId, true), 500);
            }
        } else {
            console.log(`✅ [SYNC] Sincronización bidireccional completada con ${peerId}`);
            this.syncInProgress.delete(peerId);
        }
    }

    handleRemoteNoteCreated(note) {
        const existingNote = this.notes.get(note.id);
        
        console.log('\n========================================');
        console.log('?? NOTA CREADA REMOTAMENTE');
        console.log('========================================');
        console.log('ID:', note.id);
        console.log('T�tulo:', note.title);
        console.log('Contenido:', note.content.substring(0, 50) + (note.content.length > 50 ? '...' : ''));
        console.log('Autor remoto:', note.author);
        console.log('Timestamp:', new Date(note.timestamp).toLocaleString());
        
        if (!existingNote) {
            console.log('Estado: Nueva nota agregada');
            console.log('========================================\n');
            this.notes.set(note.id, note);
            this.saveNotesToStorage();
            this.renderNotes();
            this.updateStats();
            
            // Mostrar notificaci�n
            this.showToast('? Nueva nota recibida', note.title, 'success');
        } else {
            console.log('Estado: Conflicto detectado, resolviendo...');
            console.log('Estrategia:', this.conflictResolver.getCurrentStrategyName());
            // PATR�N STRATEGY: Resolver conflicto con estrategia actual
            const resolvedNote = this.conflictResolver.resolve(existingNote, note);
            console.log('Resoluci�n: Nota ' + (resolvedNote.id === note.id ? 'remota' : 'local') + ' prevalece');
            console.log('========================================\n');
            this.notes.set(note.id, resolvedNote);
            this.saveNotesToStorage();
            this.renderNotes();
            this.updateStats();
            
            // Mostrar notificaci�n de conflicto resuelto
            this.showToast('?? Conflicto resuelto', note.title, 'warning');
        }
    }

    handleRemoteNoteUpdated(note) {
        const existingNote = this.notes.get(note.id);
        
        console.log('\n========================================');
        console.log('?? NOTA ACTUALIZADA REMOTAMENTE');
        console.log('========================================');
        console.log('ID:', note.id);
        console.log('T�tulo:', note.title);
        console.log('Contenido:', note.content.substring(0, 50) + (note.content.length > 50 ? '...' : ''));
        console.log('Autor remoto:', note.author);
        console.log('Timestamp:', new Date(note.timestamp).toLocaleString());
        
        if (!existingNote) {
            console.log('Estado: Nota no exist�a localmente, agregando');
            console.log('========================================\n');
            this.notes.set(note.id, note);
        } else {
            console.log('Estado: Actualizando nota existente');
            console.log('Estrategia de resoluci�n:', this.conflictResolver.getCurrentStrategyName());
            // PATR�N STRATEGY: Resolver conflicto con estrategia actual
            const resolvedNote = this.conflictResolver.resolve(existingNote, note);
            console.log('Resoluci�n: Versi�n ' + (resolvedNote.timestamp === note.timestamp ? 'remota' : 'local') + ' prevalece');
            console.log('========================================\n');
            this.notes.set(note.id, resolvedNote);
        }
        this.saveNotesToStorage();
        this.renderNotes();
        this.updateStats();
        
        // Mostrar notificaci�n
        this.showToast('?? Nota actualizada', note.title, 'info');
    }

    handleRemoteNoteDeleted(noteId) {
        const note = this.notes.get(noteId);
        
        console.log('\n📨🛡️ ========================================');
        console.log('🛡️  ELIMINACIÓN REMOTA RECIBIDA');
        console.log('========================================');
        console.log('ID a eliminar:', noteId);
        
        if (this.notes.has(noteId)) {
            const noteTitle = note ? note.title : 'Sin t�tulo';
            if (note) {
                console.log('T�tulo:', note.title);
                console.log('Autor:', note.author);
            }
            console.log('✅ Estado: Eliminando nota local');
            console.log('Notas antes:', this.notes.size);
            
            this.notes.delete(noteId);
            
            console.log('Notas despu�s:', this.notes.size);
            console.log('========================================\n');
            
            this.saveNotesToStorage();
            this.renderNotes();
            this.updateStats();
            
            // Mostrar notificaci�n
            this.showToast('🛡️ Nota eliminada remotamente', noteTitle, 'error');
        } else {
            console.log('⚠️ Estado: Nota no exist�a localmente (ya eliminada o nunca existi�)');
            console.log('Notas actuales:', Array.from(this.notes.keys()));
            console.log('========================================\n');
        }
    }

    // PATR�N STRATEGY: Env�a un mensaje usando la estrategia de broadcasting actual
    // Utilizado para propagar cambios de notas (crear, actualizar, eliminar) a toda la red
    broadcastToPeers(message) {
        // Asigna un ID �nico al mensaje si no lo tiene
        if (!message.id) {
            message.id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        }

        console.log(`\n📡 [BROADCAST] Tipo: ${message.type}`);
        console.log(`   Total peers: ${this.peers.size}`);
        
        // Contar peers conectados
        let connected = 0;
        this.peers.forEach((peer, peerId) => {
            const isConnected = peer.dataChannel && peer.dataChannel.readyState === 'open';
            console.log(`   - ${peerId.substring(0, 12)}: ${isConnected ? '✅ Conectado' : '❌ Desconectado'}`);
            if (isConnected) connected++;
        });
        
        console.log(`   Peers conectados: ${connected}/${this.peers.size}`);

        // Delega el broadcasting a la estrategia actual
        const result = this.broadcastManager.broadcast(this.peers, message);
        
        // Registra estad�sticas del broadcast
        console.log(`[BROADCAST] Estrategia: ${result.strategy}`);
        console.log(`[BROADCAST] Resultado: ${result.sent} enviados, ${result.failed} fallos\n`);
        
        return result;
    }

    removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            if (peer.dataChannel) {
                peer.dataChannel.close();
            }
            if (peer.pc) {
                peer.pc.close();
            }
            this.peers.delete(peerId);
            this.pendingCandidates.delete(peerId);
            this.updateStats();
            console.log('[PEER] Eliminado:', peerId);
        }
    }

    createNote(title, content) {
        const note = {
            id: this.generateNoteId(),
            title: title || 'Sin titulo',
            content: content || '',
            timestamp: Date.now(),
            origin: this.nodeId,
            author: this.nodeId
        };

        console.log('\n========================================');
        console.log('?? CREANDO NUEVA NOTA');
        console.log('========================================');
        console.log('ID:', note.id);
        console.log('T�tulo:', note.title);
        console.log('Contenido:', content.substring(0, 50) + (content.length > 50 ? '...' : ''));
        console.log('Timestamp:', new Date(note.timestamp).toLocaleString());
        console.log('Autor:', this.nodeId);
        console.log('========================================\n');

        this.notes.set(note.id, note);
        this.saveNotesToStorage();
        this.renderNotes();
        this.updateStats();

        this.broadcastToPeers({
            type: 'note-created',
            note: note
        });
    }

    updateNote(noteId, title, content) {
        const note = this.notes.get(noteId);
        if (!note) {
            console.error('[ERROR] Nota no encontrada:', noteId);
            this.showToast(
                'Error',
                'No se pudo encontrar la nota para editar',
                'error'
            );
            return;
        }

        const oldTitle = note.title;
        const oldContent = note.content;
        const oldTimestamp = note.timestamp;

        console.log('\n========================================');
        console.log('??  EDITANDO NOTA');
        console.log('========================================');
        console.log('ID:', noteId);
        console.log('\nANTES:');
        console.log('  T�tulo:', oldTitle);
        console.log('  Contenido:', oldContent.substring(0, 50) + (oldContent.length > 50 ? '...' : ''));
        console.log('  Timestamp:', new Date(oldTimestamp).toLocaleString());
        console.log('\nDESPU�S:');
        console.log('  T�tulo:', title);
        console.log('  Contenido:', content.substring(0, 50) + (content.length > 50 ? '...' : ''));

        note.title = title;
        note.content = content;
        note.timestamp = Date.now();

        console.log('  Timestamp:', new Date(note.timestamp).toLocaleString());
        console.log('========================================\n');

        this.notes.set(noteId, note);
        this.saveNotesToStorage();
        this.renderNotes();
        this.updateStats();
        
        // Mostrar toast de confirmaci�n
        this.showToast(
            'Nota actualizada',
            `Se actualiz� "${title}"`,
            'success'
        );

        this.broadcastToPeers({
            type: 'note-updated',
            note: note
        });
    }

    deleteNote(noteId) {
        const note = this.notes.get(noteId);
        
        console.log('\n========================================');
        console.log('???  ELIMINANDO NOTA');
        console.log('========================================');
        console.log('ID:', noteId);
        if (note) {
            console.log('T�tulo:', note.title);
            console.log('Contenido:', note.content.substring(0, 50) + (note.content.length > 50 ? '...' : ''));
            console.log('Creada:', new Date(note.timestamp).toLocaleString());
            console.log('Autor:', note.author);
        } else {
            console.warn('?? NOTA NO ENCONTRADA EN LA COLECCI�N');
            console.log('Notas disponibles:', Array.from(this.notes.keys()));
        }
        console.log('Total de notas antes:', this.notes.size);
        
        const deleted = this.notes.delete(noteId);
        console.log('Eliminaci�n exitosa:', deleted);
        console.log('Total de notas despu�s:', this.notes.size);
        console.log('========================================\n');

        this.saveNotesToStorage();
        this.renderNotes();
        this.updateStats();
        
        // Mostrar toast de confirmaci�n
        this.showToast(
            'Nota eliminada',
            `Se elimin� la nota "${note ? note.title : 'Sin t�tulo'}"`,
            'success'
        );

        console.log('📤 [DELETE] Broadcasting eliminaci�n a peers...');
        const broadcastResult = this.broadcastToPeers({
            type: 'note-deleted',
            noteId: noteId,
            from: this.nodeId,
            timestamp: Date.now()
        });
        
        console.log(`📤 [DELETE] Broadcast completado: ${broadcastResult.sent} peers notificados`);
        if (broadcastResult.failed > 0) {
            console.warn(`⚠️ [DELETE] ${broadcastResult.failed} peers no recibieron la eliminaci�n`);
        }
    }

    generateNoteId() {
        return `note_${this.nodeId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }

    saveNotesToStorage() {
        // PATR�N STRATEGY: Usar estrategia de almacenamiento actual
        const notesArray = Array.from(this.notes.values());
        const success = this.storageManager.save('p2p-notes', notesArray);
        
        if (success) {
            console.log(`[STORAGE] Guardadas ${notesArray.length} notas con ${this.storageManager.getCurrentStrategyName()}`);
        } else {
            console.error('[STORAGE] Error al guardar notas');
        }
    }

    loadNotesFromStorage() {
        // PATR�N STRATEGY: Usar estrategia de almacenamiento actual
        const notesArray = this.storageManager.load('p2p-notes');
        
        if (notesArray && Array.isArray(notesArray)) {
            notesArray.forEach(note => {
                this.notes.set(note.id, note);
            });
            console.log(`[STORAGE] Cargadas ${notesArray.length} notas con ${this.storageManager.getCurrentStrategyName()}`);
        } else {
            console.log('[STORAGE] No hay notas guardadas');
        }
    }

    initUI() {
        document.getElementById('createNote').addEventListener('click', () => {
            this.showNoteEditor();
        });

        document.getElementById('saveNote').addEventListener('click', () => {
            this.saveCurrentNote();
        });

        document.getElementById('cancelEdit').addEventListener('click', () => {
            this.cancelEdit();
        });

        document.getElementById('closeEditor').addEventListener('click', () => {
            this.cancelEdit();
        });

        // Cerrar modal al hacer clic fuera de �l
        document.getElementById('noteEditor').addEventListener('click', (e) => {
            if (e.target.id === 'noteEditor') {
                this.cancelEdit();
            }
        });
    }

    showNoteEditor() {
        this.editingNoteId = null;
        document.getElementById('noteTitle').value = '';
        document.getElementById('noteContent').value = '';
        document.getElementById('noteEditor').style.display = 'block';
        document.getElementById('noteTitle').focus();
    }

    editNote(noteId) {
        const note = this.notes.get(noteId);
        if (!note) return;

        this.editingNoteId = noteId;
        document.getElementById('noteTitle').value = note.title;
        document.getElementById('noteContent').value = note.content;
        document.getElementById('noteEditor').style.display = 'block';
        document.getElementById('noteTitle').focus();
    }

    saveCurrentNote() {
        const title = document.getElementById('noteTitle').value.trim();
        const content = document.getElementById('noteContent').value.trim();

        if (!title && !content) {
            alert('La nota esta vacia');
            return;
        }

        if (this.editingNoteId) {
            this.updateNote(this.editingNoteId, title, content);
        } else {
            this.createNote(title, content);
        }

        this.cancelEdit();
    }

    cancelEdit() {
        this.editingNoteId = null;
        document.getElementById('noteEditor').style.display = 'none';
        document.getElementById('noteTitle').value = '';
        document.getElementById('noteContent').value = '';
    }

    renderNotes() {
        const container = document.getElementById('notesList');
        if (!container) {
            console.error('❌ [ERROR] Contenedor notesList no encontrado en el DOM');
            return;
        }
        
        const notesArray = Array.from(this.notes.values());
        
        console.log(`[RENDER] Renderizando ${notesArray.length} nota(s)`);

        if (notesArray.length === 0) {
            container.innerHTML = '<div class="empty-state">No hay notas. Crea una nueva nota para comenzar.</div>';
            return;
        }

        notesArray.sort((a, b) => b.timestamp - a.timestamp);

        container.innerHTML = notesArray.map(note => {
            return `
            <div class="note-card" data-id="${note.id}">
                <div class="note-header">
                    <h3 class="note-title">${this.escapeHtml(note.title)}</h3>
                    <div class="note-actions">
                        <button class="note-btn edit" onclick="app.editNote('${note.id}')">Editar</button>
                        <button class="note-btn delete" onclick="app.deleteNote('${note.id}')">Eliminar</button>
                    </div>
                </div>
                <div class="note-content">${this.escapeHtml(note.content)}</div>
                <div class="note-meta">
                    <span class="note-author" title="Autor: ${note.author}">
                        ${note.origin === this.nodeId ? '🏠 Tú' : '🌐 ' + note.author.substring(0, 12)}
                    </span>
                    <span class="note-time">${this.formatDate(note.timestamp)}</span>
                </div>
            </div>
            `;
        }).join('');
    }

    updateStats() {
        document.getElementById('noteCount').textContent = this.notes.size;
        
        // Actualizar informaci�n de estrategias si existen los elementos
        const conflictStrategyEl = document.getElementById('currentConflictStrategy');
        if (conflictStrategyEl) {
            conflictStrategyEl.textContent = this.conflictResolver.getCurrentStrategyName();
        }
        
        const storageStrategyEl = document.getElementById('currentStorageStrategy');
        if (storageStrategyEl) {
            storageStrategyEl.textContent = this.storageManager.getCurrentStrategyName();
        }
        
        const broadcastStrategyEl = document.getElementById('currentBroadcastStrategy');
        if (broadcastStrategyEl) {
            broadcastStrategyEl.textContent = this.broadcastManager.getCurrentStrategyName();
        }
    }

    // Panel de Peers Conectados
    showPeersPanel() {
        const panel = document.getElementById('peersPanel');
        const isVisible = panel.style.display === 'block';
        
        if (isVisible) {
            panel.style.display = 'none';
        } else {
            panel.style.display = 'block';
            this.refreshPeersList();
        }
    }

    refreshPeersList() {
        const container = document.getElementById('peersListContainer');
        const peersArray = Array.from(this.peers.entries());
        
        let connectedCount = 0;
        let disconnectedCount = 0;
        
        if (peersArray.length === 0) {
            container.innerHTML = '<p class="no-peers">No hay peers conectados a�n.</p>';
            document.getElementById('totalPeers').textContent = '0';
            document.getElementById('connectedPeers').textContent = '0';
            document.getElementById('disconnectedPeers').textContent = '0';
            return;
        }
        
        const peersHtml = peersArray.map(([peerId, peerData]) => {
            const pc = peerData.pc;
            const dc = peerData.dataChannel;
            const connectionState = pc ? pc.connectionState : 'unknown';
            const dataChannelState = dc ? dc.readyState : 'closed';
            const isConnected = connectionState === 'connected' && dataChannelState === 'open';
            
            if (isConnected) {
                connectedCount++;
            } else {
                disconnectedCount++;
            }
            
            const statusIcon = isConnected ? '??' : '??';
            const statusText = isConnected ? 'Conectado' : 'Desconectado';
            const statusClass = isConnected ? 'peer-connected' : 'peer-disconnected';
            
            // Obtener configuraci�n de estrategias del peer
            const peerConfig = this.peerStrategies.get(peerId);
            const myConflictStrategy = this.conflictResolver.getCurrentStrategyName();
            const hasConflict = peerConfig && peerConfig.conflict !== myConflictStrategy;
            
            let strategyInfo = '';
            if (peerConfig) {
                const conflictMatch = peerConfig.conflict === myConflictStrategy;
                strategyInfo = `
                    <div class="peer-strategies">
                        <div class="peer-strategy-item ${conflictMatch ? 'strategy-match' : 'strategy-mismatch'}">
                            <span class="strategy-label">Conflictos:</span>
                            <span class="strategy-value">${peerConfig.conflict}</span>
                            ${conflictMatch ? '<span class="match-icon">?</span>' : '<span class="mismatch-icon">?</span>'}
                        </div>
                        <div class="peer-strategy-item">
                            <span class="strategy-label">Broadcasting:</span>
                            <span class="strategy-value">${peerConfig.broadcast}</span>
                        </div>
                    </div>
                `;
            }
            
            return `
                <div class="peer-item ${statusClass}">
                    <div class="peer-header">
                        <span class="peer-icon">${statusIcon}</span>
                        <span class="peer-id">${peerId.substring(0, 12)}...</span>
                        <span class="peer-status">${statusText}</span>
                    </div>
                    <div class="peer-details">
                        <div class="peer-detail-row">
                            <span class="detail-label">Conexi�n WebRTC:</span>
                            <span class="detail-value">${connectionState}</span>
                        </div>
                        <div class="peer-detail-row">
                            <span class="detail-label">DataChannel:</span>
                            <span class="detail-value">${dataChannelState}</span>
                        </div>
                        <div class="peer-detail-row">
                            <span class="detail-label">ICE Gathering:</span>
                            <span class="detail-value">${pc ? pc.iceGatheringState : 'N/A'}</span>
                        </div>
                    </div>
                    ${strategyInfo}
                    ${hasConflict ? `
                        <div class="peer-actions">
                            <button class="btn btn-sm btn-warning" onclick="app.requestStrategyChange('${peerId}')">
                                ?? Sugerir mi configuraci�n
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="app.adoptPeerStrategy('${peerId}')">
                                ?? Adoptar su configuraci�n
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        container.innerHTML = peersHtml;
        document.getElementById('totalPeers').textContent = peersArray.length;
        document.getElementById('connectedPeers').textContent = connectedCount;
        document.getElementById('disconnectedPeers').textContent = disconnectedCount;
        
        console.log(`[PEERS] Total: ${peersArray.length}, Conectados: ${connectedCount}, Desconectados: ${disconnectedCount}`);
    }

    testSyncWithPeers() {
        const connectedPeers = Array.from(this.peers.entries()).filter(([_, p]) => 
            p.dataChannel && p.dataChannel.readyState === 'open'
        );
        
        if (connectedPeers.length === 0) {
            alert('No hay peers conectados para probar la sincronizaci�n');
            return;
        }
        
        console.log('\n========================================');
        console.log('?? PROBANDO SINCRONIZACI�N CON PEERS');
        console.log('========================================');
        console.log('Total de peers conectados:', connectedPeers.length);
        console.log('Total de notas locales:', this.notes.size);
        
        let syncCount = 0;
        let failCount = 0;
        
        connectedPeers.forEach(([peerId, peerData]) => {
            try {
                console.log(`\n[SYNC TEST] Enviando sincronizaci�n a peer: ${peerId}`);
                this.syncAllNotesWithPeer(peerId);
                syncCount++;
            } catch (error) {
                console.error(`[ERROR] Fallo al sincronizar con ${peerId}:`, error);
                failCount++;
            }
        });
        
        console.log('\n========================================');
        console.log('? SINCRONIZACI�N COMPLETADA');
        console.log('========================================');
        console.log('Exitosas:', syncCount);
        console.log('Fallidas:', failCount);
        console.log('========================================\n');
        
        alert(`Sincronizaci�n enviada a ${syncCount} peer(s)\nNotas compartidas: ${this.notes.size}`);
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('connectionStatus');
        if (connected) {
            indicator.classList.add('connected');
            indicator.classList.remove('disconnected');
        } else {
            indicator.classList.remove('connected');
            indicator.classList.add('disconnected');
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Ahora';
        if (diffMins < 60) return `Hace ${diffMins} min`;
        if (diffHours < 24) return `Hace ${diffHours} h`;
        if (diffDays < 7) return `Hace ${diffDays} dias`;
        
        return date.toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    // Sistema de notificaciones Toast
    showToast(title, message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: '?',
            error: '???',
            warning: '??',
            info: '??'
        };

        toast.innerHTML = `
            <div class="toast-icon">${icons[type] || '??'}</div>
            <div class="toast-content">
                <div class="toast-title">${this.escapeHtml(title)}</div>
                <div class="toast-message">${this.escapeHtml(message)}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">?</button>
        `;

        container.appendChild(toast);

        // Animaci�n de entrada
        setTimeout(() => {
            toast.classList.add('toast-show');
        }, 10);

        // Auto-eliminar despu�s de 4 segundos
        setTimeout(() => {
            toast.classList.remove('toast-show');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }, 4000);
    }

    // PATR�N STRATEGY: M�todos para cambiar estrategias din�micamente
    
    // Descripciones espec�ficas de cada estrategia
    getStrategyDescriptions() {
        return {
            conflict: {
                'last-write-wins': {
                    title: '?? Estrategia: Last-Write-Wins',
                    description: 'La �ltima modificaci�n siempre prevalece. Simple y r�pida, pero puede sobrescribir cambios importantes. Ideal para colaboraci�n casual.',
                    info: 'La �ltima modificaci�n prevalece en caso de conflicto.'
                },
                'first-write-wins': {
                    title: '?? Estrategia: First-Write-Wins',
                    description: 'La primera modificaci�n se mantiene, los cambios posteriores se descartan. Protege datos originales pero puede ignorar actualizaciones importantes.',
                    info: 'La primera modificaci�n se conserva, las posteriores se rechazan.'
                },
                'version-based': {
                    title: '?? Estrategia: Version-Based',
                    description: 'Compara n�meros de versi�n para decidir qu� cambio mantener. Garantiza orden cronol�gico estricto. �til para historial preciso.',
                    info: 'Usa n�meros de versi�n para determinar qu� cambio es m�s reciente.'
                },
                'content-merge': {
                    title: '?? Estrategia: Content-Merge',
                    description: 'Fusiona autom�ticamente el contenido de ambas versiones, combinando cambios cuando sea posible. Minimiza p�rdida de datos pero puede crear duplicados.',
                    info: 'Fusiona autom�ticamente el contenido de versiones conflictivas.'
                },
                'author-priority': {
                    title: '?? Estrategia: Author-Priority',
                    description: 'Prioriza cambios del nodo local sobre remotos. Da control total al usuario local. Recomendado cuando conf�as m�s en tus ediciones.',
                    info: 'Los cambios del autor local tienen prioridad sobre los remotos.'
                }
            },
            storage: {
                'local-storage': {
                    title: '?? Estrategia: LocalStorage',
                    description: 'Almacena datos persistentemente en el navegador (hasta 5-10MB). Los datos sobreviven al cerrar el navegador. Mejor para uso regular.',
                    info: 'Datos persistentes en el navegador.'
                },
                'session-storage': {
                    title: '?? Estrategia: SessionStorage',
                    description: 'Datos temporales que se eliminan al cerrar la pesta�a. �til para sesiones �nicas o datos sensibles que no deben guardarse permanentemente.',
                    info: 'Datos temporales que se borran al cerrar la pesta�a.'
                },
                'in-memory': {
                    title: '?? Estrategia: InMemory',
                    description: 'Almacena todo en RAM. M�xima velocidad pero los datos se pierden al recargar. Ideal para pruebas o sesiones temporales de alta performance.',
                    info: 'Solo en memoria RAM, se pierde al recargar la p�gina.'
                },
                'indexed-db': {
                    title: '?? Estrategia: IndexedDB',
                    description: 'Base de datos del navegador con gran capacidad (GB). Permite almacenar grandes vol�menes de datos con b�squedas eficientes. Para aplicaciones complejas.',
                    info: 'Base de datos del navegador con gran capacidad de almacenamiento.'
                }
            },
            broadcast: {
                'broadcast-all': {
                    title: '?? Estrategia: Broadcast-All',
                    description: 'Env�a cada mensaje a todos los nodos conectados. Garantiza que todos reciban la informaci�n pero genera mucho tr�fico de red.',
                    info: 'Env�o de mensajes a todos los nodos conectados.'
                },
                'selective': {
                    title: '?? Estrategia: Selective',
                    description: 'Env�a solo a nodos espec�ficos seg�n criterios definidos. Reduce tr�fico de red pero requiere l�gica de selecci�n. Eficiente para redes grandes.',
                    info: 'Env�o selectivo basado en criterios espec�ficos.'
                },
                'gossip': {
                    title: '?? Estrategia: Gossip Protocol',
                    description: 'Propagaci�n epid�mica: cada nodo reenv�a a un subconjunto aleatorio. Escalable y resistente a fallos, pero con latencia variable.',
                    info: 'Propagaci�n epid�mica aleatoria entre nodos.'
                },
                'priority': {
                    title: '?? Estrategia: Priority-Based',
                    description: 'Env�a primero a nodos de alta prioridad. Optimiza entrega cr�tica pero puede crear desigualdades. �til para redes jer�rquicas.',
                    info: 'Env�o basado en prioridad de los nodos.'
                },
                'batch': {
                    title: '?? Estrategia: Batch',
                    description: 'Agrupa m�ltiples mensajes antes de enviar. Reduce overhead de red y mejora eficiencia, pero aumenta latencia. Ideal para actualizaciones no cr�ticas.',
                    info: 'Agrupa mensajes en lotes para env�o eficiente.'
                }
            }
        };
    }

    showStrategyNotification(type, strategyKey, strategyName) {
        const descriptions = this.getStrategyDescriptions();
        const strategyInfo = descriptions[type][strategyKey];
        
        const notification = document.getElementById('strategyNotification');
        const titleEl = document.getElementById('notificationTitle');
        const descriptionEl = document.getElementById('notificationDescription');
        const iconEl = document.getElementById('notificationIcon');
        
        if (!strategyInfo) return;
        
        // Configurar iconos seg�n el tipo
        const icons = {
            conflict: '??',
            storage: '??',
            broadcast: '??'
        };
        
        iconEl.textContent = icons[type] || '??';
        titleEl.textContent = strategyInfo.title;
        descriptionEl.textContent = strategyInfo.description;
        
        // Mostrar notificaci�n
        notification.style.display = 'block';
        notification.classList.remove('hiding');
        
        // Auto-ocultar despu�s de 8 segundos
        if (this.notificationTimeout) {
            clearTimeout(this.notificationTimeout);
        }
        
        this.notificationTimeout = setTimeout(() => {
            this.closeNotification();
        }, 8000);
    }

    closeNotification() {
        const notification = document.getElementById('strategyNotification');
        notification.classList.add('hiding');
        
        setTimeout(() => {
            notification.style.display = 'none';
            notification.classList.remove('hiding');
        }, 300);
        
        if (this.notificationTimeout) {
            clearTimeout(this.notificationTimeout);
        }
    }

    updateStrategyInfo(type, strategyKey) {
        const descriptions = this.getStrategyDescriptions();
        const strategyInfo = descriptions[type][strategyKey];
        
        if (!strategyInfo) return;
        
        // Actualizar la informaci�n en el panel
        const infoElements = {
            conflict: 'conflictStrategyInfo',
            storage: 'storageStrategyInfo',
            broadcast: 'broadcastStrategyInfo'
        };
        
        const infoEl = document.getElementById(infoElements[type]);
        if (infoEl) {
            infoEl.textContent = strategyInfo.info;
        }
    }
    
    setConflictStrategy(strategyName) {
        let strategy;
        switch(strategyName) {
            case 'last-write-wins':
                strategy = new LastWriteWinsStrategy();
                break;
            case 'first-write-wins':
                strategy = new FirstWriteWinsStrategy();
                break;
            case 'version-based':
                strategy = new VersionBasedStrategy();
                break;
            case 'content-merge':
                strategy = new ContentMergeStrategy();
                break;
            case 'author-priority':
                strategy = new AuthorPriorityStrategy(this.nodeId);
                break;
            default:
                console.error('[ERROR] Estrategia de conflicto desconocida:', strategyName);
                return;
        }
        
        this.conflictResolver.setStrategy(strategy);
        this.updateStats();
        this.updateStrategyInfo('conflict', strategyName);
        this.showStrategyNotification('conflict', strategyName, strategy.getName());
        console.log('[STRATEGY] Estrategia de conflicto cambiada a:', strategy.getName());
        
        // Notificar a todos los peers conectados sobre el cambio
        this.broadcastStrategyChange();
    }

    setStorageStrategy(strategyName) {
        let strategy;
        switch(strategyName) {
            case 'local-storage':
                strategy = new LocalStorageStrategy();
                break;
            case 'session-storage':
                strategy = new SessionStorageStrategy();
                break;
            case 'in-memory':
                strategy = new InMemoryStorageStrategy();
                break;
            case 'indexed-db':
                strategy = new IndexedDBStorageStrategy();
                break;
            default:
                console.error('[ERROR] Estrategia de almacenamiento desconocida:', strategyName);
                return;
        }
        
        // Guardar notas actuales con la nueva estrategia
        const currentNotes = Array.from(this.notes.values());
        this.storageManager.setStrategy(strategy);
        if (currentNotes.length > 0) {
            this.saveNotesToStorage();
        }
        this.updateStats();
        this.updateStrategyInfo('storage', strategyName);
        this.showStrategyNotification('storage', strategyName, strategy.getName());
        console.log('[STRATEGY] Estrategia de almacenamiento cambiada a:', strategy.getName());
    }

    setBroadcastStrategy(strategyName) {
        let strategy;
        switch(strategyName) {
            case 'broadcast-all':
                strategy = new BroadcastAllStrategy();
                break;
            case 'selective':
                strategy = new SelectiveBroadcastStrategy();
                break;
            case 'gossip':
                strategy = new GossipProtocolStrategy(3);
                break;
            case 'priority':
                strategy = new PriorityBasedBroadcastStrategy();
                break;
            case 'batch':
                strategy = new BatchBroadcastStrategy(5, 100);
                break;
            default:
                console.error('[ERROR] Estrategia de broadcasting desconocida:', strategyName);
                return;
        }
        
        this.broadcastManager.setStrategy(strategy);
        this.updateStats();
        this.updateStrategyInfo('broadcast', strategyName);
        this.showStrategyNotification('broadcast', strategyName, strategy.getName());
        console.log('[STRATEGY] Estrategia de broadcasting cambiada a:', strategy.getName());
        
        // Notificar a todos los peers conectados sobre el cambio
        this.broadcastStrategyChange();
    }

    // Notificar a todos los peers sobre cambio de configuraci�n
    broadcastStrategyChange() {
        const connectedPeers = Array.from(this.peers.entries()).filter(([_, p]) => 
            p.dataChannel && p.dataChannel.readyState === 'open'
        );

        if (connectedPeers.length === 0) {
            return;
        }

        console.log(`[CONFIG] Notificando cambio de estrategia a ${connectedPeers.length} peer(s)`);

        connectedPeers.forEach(([peerId, _]) => {
            this.sendStrategyConfig(peerId);
        });
    }

    showStrategyPanel() {
        const panel = document.getElementById('strategyPanel');
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }
    }

    async showStorageInfo() {
        const info = await this.storageManager.getStorageInfo();
        const stats = this.broadcastManager.getStats();
        
        let message = `=== INFORMACI�N DE ESTRATEGIAS ===\n\n`;
        message += `?? Resoluci�n de Conflictos: ${this.conflictResolver.getCurrentStrategyName()}\n\n`;
        message += `?? Almacenamiento: ${this.storageManager.getCurrentStrategyName()}\n`;
        message += `   - Usado: ${info.usedFormatted || 'N/A'}\n`;
        message += `   - L�mite: ${info.limit}\n`;
        message += `   - Persistente: ${info.persistent ? 'S�' : 'No'}\n\n`;
        message += `?? Broadcasting: ${this.broadcastManager.getCurrentStrategyName()}\n`;
        message += `   - Mensajes totales: ${stats.totalMessages}\n`;
        message += `   - Exitosos: ${stats.totalSent}\n`;
        message += `   - Fallidos: ${stats.totalFailed}\n`;
        message += `   - Tasa de �xito: ${stats.successRate}\n`;
        
        alert(message);
    }

}

// Variable global para la aplicaci�n
let app;

document.addEventListener('DOMContentLoaded', () => {
    console.log('P2P NOTES - Iniciando aplicacion...');
    app = new P2PNotesApp();
    
    // Hacer app accesible globalmente para los event handlers inline
    window.app = app;
});
