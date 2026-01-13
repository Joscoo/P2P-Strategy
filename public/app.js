// P2P NOTES - Sistema de Notas Colaborativas Descentralizado
// Tecnologías: WebRTC, Socket.IO, localStorage
// PATRÓN STRATEGY IMPLEMENTADO para: Resolución de Conflictos, Almacenamiento y Broadcasting

class P2PNotesApp {
    constructor() {
        this.socket = null;
        this.peers = new Map();
        this.pendingCandidates = new Map();
        this.notes = new Map();
        this.nodeId = this.generateNodeId();
        this.editingNoteId = null;
        
        // PATRÓN STRATEGY: Inicializar gestores de estrategias
        this.conflictResolver = new ConflictResolver(new LastWriteWinsStrategy());
        this.storageManager = new StorageManager(new LocalStorageStrategy());
        this.broadcastManager = new BroadcastManager(new BroadcastAllStrategy());
        
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
    }
    // Establece la conexión con el servidor de señalización mediante Socket.IO
    // Este servidor actúa como intermediario para el descubrimiento de peers y el intercambio de señales WebRTC
    initSocketConnection() {
        // Inicializa la conexión Socket.IO con el servidor
        this.socket = io();
        
        // Evento: Cuando se establece conexión exitosa con el servidor
        this.socket.on('connect', () => {
            console.log('[CONEXION] Conectado al servidor');
            // Actualiza el indicador visual de estado
            this.updateConnectionStatus(true);
            // Muestra el ID único de este nodo en la interfaz
            document.getElementById('nodeId').textContent = this.nodeId;
        });

        // Evento: Cuando se pierde la conexión con el servidor
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
            // Inicia conexión WebRTC con el nuevo peer si no está conectado
            if (!this.peers.has(peerId)) {
                this.connectToPeer(peerId);
            }
        });

        // Evento: Cuando un peer se desconecta de la red
        this.socket.on('peer-left', (peerId) => {
            console.log('[PEER] Desconectado:', peerId);
            // Limpia la conexión y libera recursos del peer desconectado
            this.removePeer(peerId);
        });

        // Evento: Recibe señales WebRTC (ofertas, respuestas, ICE candidates) de otros peers
        this.socket.on('signal', (data) => {
            // Procesa la señal recibida según su tipo
            this.handleSignal(data);
        });
    }
    // Inicia la conexión WebRTC P2P directa con otro peer
    // Este nodo actúa como el Iniciador (Caller) que envía la oferta SDP
    async connectToPeer(peerId) {
        console.log('[WebRTC] Conectando con:', peerId);

        // Configuración de servidores ICE para descubrir direcciones IP públicas
        // STUN servers ayudan a atravesar NATs y descubrir la IP pública
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },    // Servidor STUN de Google
                { urls: 'stun:stun1.l.google.com:19302' }    // Servidor STUN alternativo
            ]
        };
        
        // Crea una nueva conexión peer-to-peer con la configuración especificada
        const pc = new RTCPeerConnection(configuration);

        // Listener: Detecta cambios en el estado de la conexión WebRTC
        // Estados posibles: new, connecting, connected, disconnected, failed, closed
        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] Estado con ${peerId}:`, pc.connectionState);
            this.updateStats();
        };

        // Listener: Monitorea el proceso de recolección de ICE candidates
        // Estados: new, gathering, complete
        pc.onicegatheringstatechange = () => {
            console.log(`[ICE] Gathering con ${peerId}:`, pc.iceGatheringState);
        };

        // Crea un canal de datos para intercambiar mensajes
        // ordered: true asegura que los mensajes lleguen en orden
        const dataChannel = pc.createDataChannel('notes', { ordered: true });
        this.setupDataChannel(dataChannel, peerId);

        // Listener: Se activa cada vez que se genera un nuevo ICE candidate
        // Los ICE candidates son posibles rutas de conexión (direcciones IP/puertos)
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[ICE] Enviando candidate a', peerId);
                // Envía el candidate al peer remoto a través del servidor de señalización
                this.socket.emit('signal', {
                    to: peerId,
                    signal: { type: 'ice-candidate', candidate: event.candidate }
                });
            }
        };

        try {
            // Crea una oferta SDP que describe las capacidades multimedia de este peer
            const offer = await pc.createOffer();
            // Establece la oferta como descripción local (inicia el proceso ICE)
            await pc.setLocalDescription(offer);

            console.log('[WebRTC] Enviando oferta a', peerId);
            // Envía la oferta SDP al peer remoto para iniciar la negociación
            this.socket.emit('signal', {
                to: peerId,
                signal: { type: 'offer', sdp: offer }
            });

            // Almacena la conexión peer con su información de estado
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
    // Este nodo actúa como Receptor (Callee) que responde a la solicitud de conexión
    async handleOffer(peerId, signal) {
        console.log('[WebRTC] Oferta recibida de', peerId);

        // Configuración de servidores STUN para descubrir IP pública
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        // Crea la conexión peer-to-peer para responder a la oferta
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
            this.updateStats();
        };

        // Listener: Monitorea el proceso de recolección de ICE candidates
        pc.onicegatheringstatechange = () => {
            console.log(`[ICE] Gathering con ${peerId}:`, pc.iceGatheringState);
        };

        // Listener: Envía cada ICE candidate generado al peer remoto
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
            // Establece la oferta SDP recibida como descripción remota
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            // Almacena la conexión marcando que ya tiene descripción remota
            this.peers.set(peerId, { pc, dataChannel: null, isRemoteDescriptionSet: true });
            // Procesa cualquier ICE candidate que llegó antes de la oferta
            await this.processPendingCandidates(peerId);

            // Crea una respuesta SDP que acepta/rechaza las capacidades ofrecidas
            const answer = await pc.createAnswer();
            // Establece la respuesta como descripción local
            await pc.setLocalDescription(answer);

            console.log('[WebRTC] Enviando answer a', peerId);
            // Envía la respuesta SDP al peer que inició la conexión
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

        try {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            peer.isRemoteDescriptionSet = true;
            await this.processPendingCandidates(peerId);
            this.updateStats();
        } catch (error) {
            console.error('[ERROR] Error en answer:', error);
        }
    }

    // Maneja los ICE candidates recibidos de un peer remoto
    // Los ICE candidates son posibles rutas de red para establecer la conexión
    async handleIceCandidate(peerId, signal) {
        console.log('[ICE] Candidate recibido de', peerId);

        // Busca la conexión peer existente
        const peer = this.peers.get(peerId);
        if (!peer) {
            console.error('[ERROR] Peer no encontrado:', peerId);
            return;
        }

        // Verifica si la descripción remota ya fue establecida
        // Los ICE candidates solo pueden agregarse después de setRemoteDescription
        if (!peer.isRemoteDescriptionSet) {
            console.log('[ICE] Guardando candidate pendiente');
            // Si la descripción remota no está lista, guarda el candidate para después
            if (!this.pendingCandidates.has(peerId)) {
                this.pendingCandidates.set(peerId, []);
            }
            this.pendingCandidates.get(peerId).push(signal.candidate);
            return;
        }

        try {
            // Agrega el ICE candidate a la conexión peer
            // Esto permite que WebRTC pruebe esta ruta de conexión
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

    // Configura los listeners del canal de datos (DataChannel) para comunicación P2P
    // El DataChannel permite intercambiar mensajes directamente entre peers sin servidor
    setupDataChannel(dataChannel, peerId) {
        // Listener: Se activa cuando el canal de datos se abre y está listo para usar
        dataChannel.onopen = () => {
            console.log('[DataChannel] Abierto con', peerId);
            
            // Actualiza la referencia del canal en el objeto peer
            const peer = this.peers.get(peerId);
            if (peer) {
                peer.dataChannel = dataChannel;
            }
            
            // Actualiza las estadísticas de la interfaz
            this.updateStats();
            // Sincroniza todas las notas locales con el peer recién conectado
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
                // Parsea el mensaje JSON recibido
                const message = JSON.parse(event.data);
                // Procesa el mensaje según su tipo (sync, create, update, delete)
                this.handlePeerMessage(message, peerId);
            } catch (error) {
                console.error('[ERROR] Error en mensaje:', error);
            }
        };
    }

    syncAllNotesWithPeer(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer?.dataChannel || peer.dataChannel.readyState !== 'open') {
            return;
        }

        console.log(`[SYNC] Sincronizando ${this.notes.size} notas con ${peerId}`);

        const notesArray = Array.from(this.notes.values());
        const message = {
            type: 'sync-all',
            notes: notesArray
        };

        try {
            peer.dataChannel.send(JSON.stringify(message));
            console.log('[SYNC] Sincronizacion enviada');
        } catch (error) {
            console.error('[ERROR] Error en sync:', error);
        }
    }

    // Procesa los mensajes recibidos de otros peers a través del DataChannel
    // Distribuye los mensajes según su tipo a los handlers específicos
    handlePeerMessage(message, peerId) {
        console.log('[MENSAJE] Recibido de', peerId, ':', message.type);

        // Enruta el mensaje al handler apropiado según el tipo
        switch (message.type) {
            case 'sync-all':
                // Sincronización inicial: recibe todas las notas del peer
                this.handleSyncAll(message.notes);
                break;
            case 'note-created':
                // Notificación de nueva nota creada por el peer
                this.handleRemoteNoteCreated(message.note);
                break;
            case 'note-updated':
                // Notificación de nota modificada por el peer
                this.handleRemoteNoteUpdated(message.note);
                break;
            case 'note-deleted':
                // Notificación de nota eliminada por el peer
                this.handleRemoteNoteDeleted(message.noteId);
                break;
            default:
                // Tipo de mensaje no reconocido
                console.warn('[WARNING] Tipo desconocido:', message.type);
        }
    }

    handleSyncAll(remoteNotes) {
        console.log(`[SYNC] Procesando ${remoteNotes.length} notas remotas`);

        let added = 0, updated = 0, skipped = 0;

        remoteNotes.forEach(remoteNote => {
            const localNote = this.notes.get(remoteNote.id);

            if (!localNote) {
                this.notes.set(remoteNote.id, remoteNote);
                added++;
            } else {
                // PATRÓN STRATEGY: Usar estrategia de resolución de conflictos
                const resolvedNote = this.conflictResolver.resolve(localNote, remoteNote);
                if (resolvedNote.id === remoteNote.id || resolvedNote.timestamp !== localNote.timestamp) {
                    this.notes.set(remoteNote.id, resolvedNote);
                    updated++;
                } else {
                    skipped++;
                }
            }
        });

        console.log(`[SYNC] ${added} nuevas, ${updated} actualizadas, ${skipped} omitidas`);
        console.log(`[SYNC] Estrategia usada: ${this.conflictResolver.getCurrentStrategyName()}`);

        this.saveNotesToStorage();
        this.renderNotes();
        this.updateStats();
    }

    handleRemoteNoteCreated(note) {
        const existingNote = this.notes.get(note.id);
        
        console.log('\n========================================');
        console.log('📩 NOTA CREADA REMOTAMENTE');
        console.log('========================================');
        console.log('ID:', note.id);
        console.log('Título:', note.title);
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
        } else {
            console.log('Estado: Conflicto detectado, resolviendo...');
            console.log('Estrategia:', this.conflictResolver.getCurrentStrategyName());
            // PATRÓN STRATEGY: Resolver conflicto con estrategia actual
            const resolvedNote = this.conflictResolver.resolve(existingNote, note);
            console.log('Resolución: Nota ' + (resolvedNote.id === note.id ? 'remota' : 'local') + ' prevalece');
            console.log('========================================\n');
            this.notes.set(note.id, resolvedNote);
            this.saveNotesToStorage();
            this.renderNotes();
            this.updateStats();
        }
    }

    handleRemoteNoteUpdated(note) {
        const existingNote = this.notes.get(note.id);
        
        console.log('\n========================================');
        console.log('📝 NOTA ACTUALIZADA REMOTAMENTE');
        console.log('========================================');
        console.log('ID:', note.id);
        console.log('Título:', note.title);
        console.log('Contenido:', note.content.substring(0, 50) + (note.content.length > 50 ? '...' : ''));
        console.log('Autor remoto:', note.author);
        console.log('Timestamp:', new Date(note.timestamp).toLocaleString());
        
        if (!existingNote) {
            console.log('Estado: Nota no existía localmente, agregando');
            console.log('========================================\n');
            this.notes.set(note.id, note);
        } else {
            console.log('Estado: Actualizando nota existente');
            console.log('Estrategia de resolución:', this.conflictResolver.getCurrentStrategyName());
            // PATRÓN STRATEGY: Resolver conflicto con estrategia actual
            const resolvedNote = this.conflictResolver.resolve(existingNote, note);
            console.log('Resolución: Versión ' + (resolvedNote.timestamp === note.timestamp ? 'remota' : 'local') + ' prevalece');
            console.log('========================================\n');
            this.notes.set(note.id, resolvedNote);
        }
        this.saveNotesToStorage();
        this.renderNotes();
        this.updateStats();
    }

    handleRemoteNoteDeleted(noteId) {
        const note = this.notes.get(noteId);
        
        console.log('\n========================================');
        console.log('🗑️  NOTA ELIMINADA REMOTAMENTE');
        console.log('========================================');
        console.log('ID:', noteId);
        
        if (this.notes.has(noteId)) {
            if (note) {
                console.log('Título:', note.title);
                console.log('Autor:', note.author);
            }
            console.log('Estado: Eliminando nota local');
            console.log('Notas restantes:', this.notes.size - 1);
            console.log('========================================\n');
            this.notes.delete(noteId);
            this.saveNotesToStorage();
            this.renderNotes();
            this.updateStats();
        } else {
            console.log('Estado: Nota no existía localmente');
            console.log('========================================\n');
        }
    }

    // PATRÓN STRATEGY: Envía un mensaje usando la estrategia de broadcasting actual
    // Utilizado para propagar cambios de notas (crear, actualizar, eliminar) a toda la red
    broadcastToPeers(message) {
        // Asigna un ID único al mensaje si no lo tiene
        if (!message.id) {
            message.id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        }

        // Delega el broadcasting a la estrategia actual
        const result = this.broadcastManager.broadcast(this.peers, message);
        
        // Registra estadísticas del broadcast
        console.log(`[BROADCAST] Estrategia: ${result.strategy}`);
        console.log(`[BROADCAST] Resultado: ${result.sent} enviados, ${result.failed} fallos`);
        
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
        console.log('📝 CREANDO NUEVA NOTA');
        console.log('========================================');
        console.log('ID:', note.id);
        console.log('Título:', note.title);
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
            return;
        }

        const oldTitle = note.title;
        const oldContent = note.content;
        const oldTimestamp = note.timestamp;

        console.log('\n========================================');
        console.log('✏️  EDITANDO NOTA');
        console.log('========================================');
        console.log('ID:', noteId);
        console.log('\nANTES:');
        console.log('  Título:', oldTitle);
        console.log('  Contenido:', oldContent.substring(0, 50) + (oldContent.length > 50 ? '...' : ''));
        console.log('  Timestamp:', new Date(oldTimestamp).toLocaleString());
        console.log('\nDESPUÉS:');
        console.log('  Título:', title);
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

        this.broadcastToPeers({
            type: 'note-updated',
            note: note
        });
    }

    deleteNote(noteId) {
        const note = this.notes.get(noteId);
        
        console.log('\n========================================');
        console.log('🗑️  ELIMINANDO NOTA');
        console.log('========================================');
        console.log('ID:', noteId);
        if (note) {
            console.log('Título:', note.title);
            console.log('Contenido:', note.content.substring(0, 50) + (note.content.length > 50 ? '...' : ''));
            console.log('Creada:', new Date(note.timestamp).toLocaleString());
            console.log('Autor:', note.author);
        }
        console.log('Total de notas restantes:', this.notes.size - 1);
        console.log('========================================\n');

        this.notes.delete(noteId);
        this.saveNotesToStorage();
        this.renderNotes();
        this.updateStats();

        this.broadcastToPeers({
            type: 'note-deleted',
            noteId: noteId
        });
    }

    generateNoteId() {
        return `note_${this.nodeId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }

    saveNotesToStorage() {
        // PATRÓN STRATEGY: Usar estrategia de almacenamiento actual
        const notesArray = Array.from(this.notes.values());
        const success = this.storageManager.save('p2p-notes', notesArray);
        
        if (success) {
            console.log(`[STORAGE] Guardadas ${notesArray.length} notas con ${this.storageManager.getCurrentStrategyName()}`);
        } else {
            console.error('[STORAGE] Error al guardar notas');
        }
    }

    loadNotesFromStorage() {
        // PATRÓN STRATEGY: Usar estrategia de almacenamiento actual
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

        // Cerrar modal al hacer clic fuera de él
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
        const notesArray = Array.from(this.notes.values());

        if (notesArray.length === 0) {
            container.innerHTML = '<div class="empty-state">No hay notas. Crea una nueva nota para comenzar.</div>';
            return;
        }

        notesArray.sort((a, b) => b.timestamp - a.timestamp);

        container.innerHTML = notesArray.map(note => {
            const isTestNote = note.isTestNote === true;
            const testBadge = isTestNote ? '<span class="test-badge">🧪 PRUEBA</span>' : '';
            
            return `
            <div class="note-card ${isTestNote ? 'test-note' : ''}" data-id="${note.id}">
                <div class="note-header">
                    <h3 class="note-title">${this.escapeHtml(note.title)} ${testBadge}</h3>
                    <div class="note-actions">
                        <button class="note-btn edit" onclick="app.editNote('${note.id}')">Editar</button>
                        <button class="note-btn delete" onclick="app.deleteNote('${note.id}')">Eliminar</button>
                    </div>
                </div>
                <div class="note-content">${this.escapeHtml(note.content)}</div>
                <div class="note-meta">
                    <span class="note-author">${note.origin === this.nodeId ? 'Local' : 'Remoto'}</span>
                    <span class="note-time">${this.formatDate(note.timestamp)}</span>
                    ${isTestNote ? '<span class="test-type">Tipo: ' + (note.testType || 'general') + '</span>' : ''}
                </div>
            </div>
            `;
        }).join('');
    }

    updateStats() {
        document.getElementById('noteCount').textContent = this.notes.size;
        
        // Actualizar información de estrategias si existen los elementos
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

    // PATRÓN STRATEGY: Métodos para cambiar estrategias dinámicamente
    
    // Descripciones específicas de cada estrategia
    getStrategyDescriptions() {
        return {
            conflict: {
                'last-write-wins': {
                    title: '🔄 Estrategia: Last-Write-Wins',
                    description: 'La última modificación siempre prevalece. Simple y rápida, pero puede sobrescribir cambios importantes. Ideal para colaboración casual.',
                    info: 'La última modificación prevalece en caso de conflicto.'
                },
                'first-write-wins': {
                    title: '🔄 Estrategia: First-Write-Wins',
                    description: 'La primera modificación se mantiene, los cambios posteriores se descartan. Protege datos originales pero puede ignorar actualizaciones importantes.',
                    info: 'La primera modificación se conserva, las posteriores se rechazan.'
                },
                'version-based': {
                    title: '🔄 Estrategia: Version-Based',
                    description: 'Compara números de versión para decidir qué cambio mantener. Garantiza orden cronológico estricto. Útil para historial preciso.',
                    info: 'Usa números de versión para determinar qué cambio es más reciente.'
                },
                'content-merge': {
                    title: '🔄 Estrategia: Content-Merge',
                    description: 'Fusiona automáticamente el contenido de ambas versiones, combinando cambios cuando sea posible. Minimiza pérdida de datos pero puede crear duplicados.',
                    info: 'Fusiona automáticamente el contenido de versiones conflictivas.'
                },
                'author-priority': {
                    title: '🔄 Estrategia: Author-Priority',
                    description: 'Prioriza cambios del nodo local sobre remotos. Da control total al usuario local. Recomendado cuando confías más en tus ediciones.',
                    info: 'Los cambios del autor local tienen prioridad sobre los remotos.'
                }
            },
            storage: {
                'local-storage': {
                    title: '💾 Estrategia: LocalStorage',
                    description: 'Almacena datos persistentemente en el navegador (hasta 5-10MB). Los datos sobreviven al cerrar el navegador. Mejor para uso regular.',
                    info: 'Datos persistentes en el navegador.'
                },
                'session-storage': {
                    title: '💾 Estrategia: SessionStorage',
                    description: 'Datos temporales que se eliminan al cerrar la pestaña. Útil para sesiones únicas o datos sensibles que no deben guardarse permanentemente.',
                    info: 'Datos temporales que se borran al cerrar la pestaña.'
                },
                'in-memory': {
                    title: '💾 Estrategia: InMemory',
                    description: 'Almacena todo en RAM. Máxima velocidad pero los datos se pierden al recargar. Ideal para pruebas o sesiones temporales de alta performance.',
                    info: 'Solo en memoria RAM, se pierde al recargar la página.'
                },
                'indexed-db': {
                    title: '💾 Estrategia: IndexedDB',
                    description: 'Base de datos del navegador con gran capacidad (GB). Permite almacenar grandes volúmenes de datos con búsquedas eficientes. Para aplicaciones complejas.',
                    info: 'Base de datos del navegador con gran capacidad de almacenamiento.'
                }
            },
            broadcast: {
                'broadcast-all': {
                    title: '📡 Estrategia: Broadcast-All',
                    description: 'Envía cada mensaje a todos los nodos conectados. Garantiza que todos reciban la información pero genera mucho tráfico de red.',
                    info: 'Envío de mensajes a todos los nodos conectados.'
                },
                'selective': {
                    title: '📡 Estrategia: Selective',
                    description: 'Envía solo a nodos específicos según criterios definidos. Reduce tráfico de red pero requiere lógica de selección. Eficiente para redes grandes.',
                    info: 'Envío selectivo basado en criterios específicos.'
                },
                'gossip': {
                    title: '📡 Estrategia: Gossip Protocol',
                    description: 'Propagación epidémica: cada nodo reenvía a un subconjunto aleatorio. Escalable y resistente a fallos, pero con latencia variable.',
                    info: 'Propagación epidémica aleatoria entre nodos.'
                },
                'priority': {
                    title: '📡 Estrategia: Priority-Based',
                    description: 'Envía primero a nodos de alta prioridad. Optimiza entrega crítica pero puede crear desigualdades. Útil para redes jerárquicas.',
                    info: 'Envío basado en prioridad de los nodos.'
                },
                'batch': {
                    title: '📡 Estrategia: Batch',
                    description: 'Agrupa múltiples mensajes antes de enviar. Reduce overhead de red y mejora eficiencia, pero aumenta latencia. Ideal para actualizaciones no críticas.',
                    info: 'Agrupa mensajes en lotes para envío eficiente.'
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
        
        // Configurar iconos según el tipo
        const icons = {
            conflict: '🔄',
            storage: '💾',
            broadcast: '📡'
        };
        
        iconEl.textContent = icons[type] || '⚙️';
        titleEl.textContent = strategyInfo.title;
        descriptionEl.textContent = strategyInfo.description;
        
        // Mostrar notificación
        notification.style.display = 'block';
        notification.classList.remove('hiding');
        
        // Auto-ocultar después de 8 segundos
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
        
        // Actualizar la información en el panel
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
        
        let message = `=== INFORMACIÓN DE ESTRATEGIAS ===\n\n`;
        message += `🔄 Resolución de Conflictos: ${this.conflictResolver.getCurrentStrategyName()}\n\n`;
        message += `💾 Almacenamiento: ${this.storageManager.getCurrentStrategyName()}\n`;
        message += `   - Usado: ${info.usedFormatted || 'N/A'}\n`;
        message += `   - Límite: ${info.limit}\n`;
        message += `   - Persistente: ${info.persistent ? 'Sí' : 'No'}\n\n`;
        message += `📡 Broadcasting: ${this.broadcastManager.getCurrentStrategyName()}\n`;
        message += `   - Mensajes totales: ${stats.totalMessages}\n`;
        message += `   - Exitosos: ${stats.totalSent}\n`;
        message += `   - Fallidos: ${stats.totalFailed}\n`;
        message += `   - Tasa de éxito: ${stats.successRate}\n`;
        
        alert(message);
    }

    // ===== SISTEMA DE PRUEBAS =====
    
    showTestPanel() {
        const panel = document.getElementById('testPanel');
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }
    }

    switchTestTab(tabName) {
        // Ocultar todos los contenidos
        document.querySelectorAll('.test-tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        // Desactivar todos los tabs
        document.querySelectorAll('.test-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        
        // Activar el tab seleccionado
        document.getElementById('test-' + tabName).classList.add('active');
        event.target.classList.add('active');
    }

    addTestResult(title, description, type, metrics = null) {
        const resultsContent = document.getElementById('testResultsContent');
        const noResults = resultsContent.querySelector('.no-results');
        
        if (noResults) {
            resultsContent.innerHTML = '';
        }
        
        const resultItem = document.createElement('div');
        resultItem.className = `test-result-item ${type}`;
        
        let metricsHtml = '';
        if (metrics) {
            metricsHtml = '<div class="result-metrics">';
            for (const [key, value] of Object.entries(metrics)) {
                metricsHtml += `
                    <div class="metric">
                        <div class="metric-label">${key}</div>
                        <div class="metric-value">${value}</div>
                    </div>
                `;
            }
            metricsHtml += '</div>';
        }
        
        resultItem.innerHTML = `
            <div class="result-header">
                <div class="result-title">${title}</div>
                <div class="result-time">${new Date().toLocaleTimeString()}</div>
            </div>
            <div class="result-description">${description}</div>
            ${metricsHtml}
        `;
        
        resultsContent.insertBefore(resultItem, resultsContent.firstChild);
        
        // Limitar a 10 resultados
        while (resultsContent.children.length > 10) {
            resultsContent.removeChild(resultsContent.lastChild);
        }
    }

    // Pruebas de Resolución de Conflictos
    runConflictTest(strategyName) {
        console.log(`[TEST] Ejecutando prueba de conflicto: ${strategyName}`);
        
        // Guardar estrategia actual
        const currentStrategy = this.conflictResolver.getCurrentStrategyName();
        
        // Cambiar a la estrategia a probar
        this.setConflictStrategy(strategyName);
        
        // Crear notas de prueba con datos específicos
        const testId = 'TEST-CONFLICT-' + Date.now();
        const localNote = {
            id: testId,
            title: '🧪 [PRUEBA] Proyecto Final - Revisión Local',
            content: 'Versión Local: Agregar sección de conclusiones y bibliografía. Revisar formato APA.',
            timestamp: Date.now() - 5000,
            version: 1,
            origin: this.nodeId,
            author: 'Usuario Local',
            isTestNote: true,
            testType: 'conflict'
        };
        
        const remoteNote = {
            id: testId,
            title: '🧪 [PRUEBA] Proyecto Final - Actualización Remota',
            content: 'Versión Remota: Incluir nuevos datos experimentales y gráficas comparativas. Actualizar referencias.',
            timestamp: Date.now(),
            version: 2,
            origin: 'node_remote_test',
            author: 'Usuario Remoto',
            isTestNote: true,
            testType: 'conflict'
        };
        
        // Guardar nota local en el panel primero
        this.notes.set(localNote.id, localNote);
        this.renderNotes();
        this.updateStats();
        
        // Simular un pequeño delay para visualizar la nota local
        setTimeout(() => {
            // Ejecutar resolución de conflicto
            const startTime = performance.now();
            const resolved = this.conflictResolver.resolve(localNote, remoteNote);
            const endTime = performance.now();
            
            // Actualizar con la nota resuelta
            this.notes.set(resolved.id, { ...resolved, isTestNote: true, testType: 'conflict' });
            this.renderNotes();
            this.updateStats();
            
            // Analizar resultado detalladamente
            let winner = 'Fusionada';
            let winnerReason = '';
            
            if (resolved.timestamp === localNote.timestamp && resolved.content === localNote.content) {
                winner = '📍 Local';
                winnerReason = 'La nota local (más antigua) fue seleccionada';
            } else if (resolved.timestamp === remoteNote.timestamp && resolved.content === remoteNote.content) {
                winner = '🌐 Remota';
                winnerReason = 'La nota remota (más reciente) fue seleccionada';
            } else if (resolved.content.includes(localNote.content) && resolved.content.includes(remoteNote.content)) {
                winner = '🔀 Fusionada';
                winnerReason = 'Ambas versiones fueron combinadas';
            } else {
                winner = '⚙️ Procesada';
                winnerReason = 'Resultado procesado según lógica de la estrategia';
            }
            
            // Calcular diferencias
            const timeDiff = Math.abs(remoteNote.timestamp - localNote.timestamp);
            const versionDiff = (remoteNote.version || 1) - (localNote.version || 1);
            
            const description = `
                <div class="test-detail-section">
                    <strong>📋 Estrategia Aplicada:</strong> ${this.conflictResolver.getCurrentStrategyName()}
                    <br><br>
                    <strong>📝 Nota Creada:</strong> "${resolved.title}"<br>
                    <strong>🔍 Visualiza la nota en el panel principal</strong> (marcada con 🧪)<br>
                    <br>
                    <strong>🔍 Datos de Entrada:</strong>
                    <table class="comparison-table">
                        <tr>
                            <th>Atributo</th>
                            <th>Nota Local</th>
                            <th>Nota Remota</th>
                        </tr>
                        <tr>
                            <td><strong>Título</strong></td>
                            <td>${localNote.title.replace('🧪 [PRUEBA] ', '')}</td>
                            <td>${remoteNote.title.replace('🧪 [PRUEBA] ', '')}</td>
                        </tr>
                        <tr>
                            <td><strong>Timestamp</strong></td>
                            <td>${new Date(localNote.timestamp).toLocaleTimeString()} (hace 5s)</td>
                            <td class="${winner.includes('Remota') ? 'winner' : ''}">${new Date(remoteNote.timestamp).toLocaleTimeString()} (ahora)</td>
                        </tr>
                        <tr>
                            <td><strong>Versión</strong></td>
                            <td>v${localNote.version}</td>
                            <td class="${winner.includes('Remota') ? 'winner' : ''}">v${remoteNote.version}</td>
                        </tr>
                    </table>
                    <br>
                    <strong>✅ Resultado de la Resolución:</strong><br>
                    <div class="result-highlight">
                        <strong>🏆 Ganador:</strong> ${winner}<br>
                        <strong>📝 Razón:</strong> ${winnerReason}<br>
                        <strong>📄 Título Final:</strong> "${resolved.title}"<br>
                        <strong>⏰ Timestamp Final:</strong> ${new Date(resolved.timestamp).toLocaleTimeString()}<br>
                        <strong>🔢 Versión Final:</strong> ${resolved.version || 'N/A'}<br>
                        <strong>📊 Diferencia Temporal:</strong> ${(timeDiff / 1000).toFixed(1)}s<br>
                        <strong>📈 Diferencia de Versión:</strong> ${versionDiff > 0 ? '+' : ''}${versionDiff}
                    </div>
                    <br>
                    <strong>💡 Comportamiento Observado:</strong><br>
                    ${this.getConflictTestInsight(strategyName, winner)}
                    <br><br>
                    <strong>🗑️ Puedes eliminar esta nota desde el panel principal o usar "Limpiar Notas de Prueba"</strong>
                </div>
            `;
            
            this.addTestResult(
                `✅ Prueba de Conflicto: ${strategyName}`,
                description,
                'success',
                {
                    'Tiempo': `${(endTime - startTime).toFixed(3)}ms`,
                    'Ganador': winner,
                    'Versión Final': `v${resolved.version || '?'}`,
                    'ID Nota': testId.substring(0, 20) + '...'
                }
            );
        }, 500);
    }

    getConflictTestInsight(strategyName, winner) {
        const insights = {
            'last-write-wins': winner.includes('Remota') 
                ? '✅ Correcto: La nota remota (más reciente) ganó como se esperaba. Esta estrategia prioriza la última modificación.' 
                : '⚠️ La nota local ganó, lo cual es inusual para esta estrategia.',
            'first-write-wins': winner.includes('Local') 
                ? '✅ Correcto: La nota local (primera escritura) se preservó. Protege el dato original.' 
                : '⚠️ La nota remota ganó, lo cual no es el comportamiento esperado.',
            'version-based': resolved => resolved.version === 2 
                ? '✅ Correcto: La versión más alta (v2) prevalece independientemente del timestamp.' 
                : '✅ Decisión basada en número de versión.',
            'content-merge': winner.includes('Fusionada') 
                ? '✅ Correcto: Los contenidos se fusionaron. Ambas contribuciones se preservan.' 
                : '✅ Contenido procesado según lógica de fusión.',
            'author-priority': winner.includes('Local') 
                ? '✅ Correcto: La prioridad del autor local se respetó. Control total del nodo local.' 
                : '⚠️ La nota remota ganó, lo cual contradice esta estrategia.'
        };
        
        return insights[strategyName] || '✅ Resolución completada según la estrategia configurada.';
    }

    runAllConflictTests() {
        console.log('[TEST] Ejecutando todas las pruebas de conflicto');
        
        const strategies = [
            'last-write-wins',
            'first-write-wins',
            'version-based',
            'content-merge',
            'author-priority'
        ];
        
        let delay = 0;
        strategies.forEach(strategy => {
            setTimeout(() => {
                this.runConflictTest(strategy);
            }, delay);
            delay += 300;
        });
        
        this.addTestResult(
            '🚀 Todas las Pruebas de Conflicto Iniciadas',
            `Se ejecutarán ${strategies.length} pruebas en secuencia. Revisa los resultados abajo.`,
            'success',
            { 'Total': strategies.length }
        );
    }

    // Pruebas de Almacenamiento
    async runStorageTest(strategyName) {
        console.log(`[TEST] Ejecutando prueba de almacenamiento: ${strategyName}`);
        
        // Cambiar a la estrategia a probar
        this.setStorageStrategy(strategyName);
        
        // Crear datos de prueba realistas
        const testNotes = [];
        const noteTemplates = [
            'Investigación sobre patrones de diseño',
            'Lista de tareas del proyecto',
            'Notas de la reunión',
            'Ideas para la implementación',
            'Problemas encontrados y soluciones'
        ];
        
        for (let i = 0; i < 100; i++) {
            testNotes.push({
                id: `TEST-STORAGE-${strategyName}-${i}`,
                title: `🧪 [PRUEBA] ${noteTemplates[i % noteTemplates.length]} #${i + 1}`,
                content: `Contenido de prueba detallado para testing de almacenamiento.
Esta nota contiene información sobre ${noteTemplates[i % noteTemplates.length]}.
ID: ${i}, Estrategia: ${strategyName}, Timestamp: ${Date.now()}`,
                timestamp: Date.now() - (i * 1000),
                origin: this.nodeId,
                version: Math.floor(i / 10) + 1,
                isTestNote: true,
                testType: 'storage'
            });
        }
        
        const dataSize = JSON.stringify(testNotes).length;
        
        // Agregar primeras 5 notas al panel principal para visualización
        const notesToShow = testNotes.slice(0, 5);
        notesToShow.forEach(note => {
            this.notes.set(note.id, note);
        });
        this.renderNotes();
        this.updateStats();
        
        // Medir escritura
        const writeStart = performance.now();
        await this.storageManager.save(testNotes);
        const writeEnd = performance.now();
        const writeTime = writeEnd - writeStart;
        
        // Medir lectura
        const readStart = performance.now();
        const loaded = await this.storageManager.load();
        const readEnd = performance.now();
        const readTime = readEnd - readStart;
        
        // Obtener info de almacenamiento
        const info = await this.storageManager.getStorageInfo();
        
        // Calcular métricas
        const writeSpeed = (dataSize / writeTime).toFixed(2); // bytes/ms
        const readSpeed = (dataSize / readTime).toFixed(2);
        const totalTime = writeTime + readTime;
        const integrity = loaded.length === testNotes.length ? '✅ 100%' : `⚠️ ${((loaded.length / testNotes.length) * 100).toFixed(1)}%`;
        
        const description = `
            <div class="test-detail-section">
                <strong>💾 Estrategia Probada:</strong> ${this.storageManager.getCurrentStrategyName()}
                <br><br>
                <strong>� Notas Creadas:</strong> Se crearon ${testNotes.length} notas de prueba<br>
                <strong>🔍 Visualiza las primeras 5 notas en el panel principal</strong> (marcadas con 🧪)<br>
                <br>
                <strong>�📊 Configuración de la Prueba:</strong><br>
                • Notas a guardar: 100 unidades<br>
                • Tamaño total de datos: ${(dataSize / 1024).toFixed(2)} KB (${dataSize} bytes)<br>
                • Tamaño promedio por nota: ${(dataSize / testNotes.length).toFixed(0)} bytes<br>
                <br>
                <strong>⏱️ Métricas de Rendimiento:</strong>
                <table class="comparison-table">
                    <tr>
                        <th>Operación</th>
                        <th>Tiempo</th>
                        <th>Velocidad</th>
                    </tr>
                    <tr class="${writeTime < 50 ? 'winner' : ''}">
                        <td><strong>✍️ Escritura</strong></td>
                        <td>${writeTime.toFixed(2)}ms</td>
                        <td>${writeSpeed} bytes/ms</td>
                    </tr>
                    <tr class="${readTime < 30 ? 'winner' : ''}">
                        <td><strong>📖 Lectura</strong></td>
                        <td>${readTime.toFixed(2)}ms</td>
                        <td>${readSpeed} bytes/ms</td>
                    </tr>
                    <tr>
                        <td><strong>🔄 Total</strong></td>
                        <td><strong>${totalTime.toFixed(2)}ms</strong></td>
                        <td>-</td>
                    </tr>
                </table>
                <br>
                <strong>📦 Características del Almacenamiento:</strong>
                <table class="comparison-table">
                    <tr>
                        <th>Propiedad</th>
                        <th>Valor</th>
                    </tr>
                    <tr>
                        <td>Persistencia</td>
                        <td><strong>${info.persistent ? '✅ Permanente' : '❌ Temporal'}</strong></td>
                    </tr>
                    <tr>
                        <td>Límite de capacidad</td>
                        <td>${info.limit}</td>
                    </tr>
                    <tr>
                        <td>Espacio usado</td>
                        <td>${info.usedFormatted || 'N/A'}</td>
                    </tr>
                    <tr class="${loaded.length === testNotes.length ? 'winner' : ''}">
                        <td>Integridad de datos</td>
                        <td><strong>${integrity}</strong> (${loaded.length}/${testNotes.length})</td>
                    </tr>
                </table>
                <br>
                <strong>💡 Análisis de Resultados:</strong><br>
                ${this.getStorageTestInsight(strategyName, writeTime, readTime, totalTime, info.persistent)}
                <br><br>
                <strong>🗑️ Usa "Limpiar Notas de Prueba" para eliminar las notas creadas</strong>
            </div>
        `;
        
        this.addTestResult(
            `💾 Prueba de Almacenamiento: ${strategyName}`,
            description,
            loaded.length === testNotes.length ? 'success' : 'warning',
            {
                'Escritura': `${writeTime.toFixed(2)}ms`,
                'Lectura': `${readTime.toFixed(2)}ms`,
                'Total': `${totalTime.toFixed(2)}ms`,
                'Integridad': integrity
            }
        );
        
        // Limpiar datos de prueba
        await this.storageManager.clear();
        this.loadNotesFromStorage();
    }

    getStorageTestInsight(strategyName, writeTime, readTime, totalTime, persistent) {
        if (strategyName === 'local-storage') {
            return `✅ LocalStorage mostró un rendimiento ${totalTime < 80 ? 'excelente' : 'aceptable'} (${totalTime.toFixed(0)}ms total). 
                    Es ideal para aplicaciones web que necesitan persistencia sin configuración compleja. 
                    ${persistent ? 'Los datos sobrevivirán al cierre del navegador.' : ''}`;
        } else if (strategyName === 'session-storage') {
            return `✅ SessionStorage tuvo un rendimiento ${totalTime < 80 ? 'excelente' : 'aceptable'} (${totalTime.toFixed(0)}ms total). 
                    Perfecto para datos temporales de sesión. 
                    ⚠️ Los datos se eliminarán al cerrar la pestaña.`;
        } else if (strategyName === 'in-memory') {
            return `⚡ InMemory fue ${writeTime < 20 ? 'extremadamente rápido' : 'muy rápido'} (${totalTime.toFixed(0)}ms total). 
                    Rendimiento óptimo para operaciones frecuentes. 
                    ❌ Los datos se pierden al recargar la página (solo RAM).`;
        } else if (strategyName === 'indexed-db') {
            return `✅ IndexedDB mostró ${totalTime < 150 ? 'buen' : 'rendimiento aceptable para'} rendimiento (${totalTime.toFixed(0)}ms total). 
                    Soporta grandes volúmenes de datos (GB) y búsquedas complejas. 
                    ${persistent ? 'Altamente recomendado para aplicaciones offline-first.' : ''}`;
        }
        return '✅ Prueba completada exitosamente.';
    }

    async runAllStorageTests() {
        console.log('[TEST] Ejecutando todas las pruebas de almacenamiento');
        
        const strategies = [
            'local-storage',
            'session-storage',
            'in-memory',
            'indexed-db'
        ];
        
        this.addTestResult(
            '🚀 Comparativa de Almacenamiento Iniciada',
            `Se ejecutarán ${strategies.length} pruebas. Cada una guardará y cargará 100 notas.`,
            'success',
            { 'Total': strategies.length }
        );
        
        for (const strategy of strategies) {
            await this.runStorageTest(strategy);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Pruebas de Broadcasting
    runBroadcastTest(strategyName) {
        console.log(`[TEST] Ejecutando prueba de broadcasting: ${strategyName}`);
        
        // Cambiar a la estrategia a probar
        this.setBroadcastStrategy(strategyName);
        
        // Crear nota de prueba para visualizar
        const testNote = {
            id: 'TEST-BROADCAST-' + strategyName + '-' + Date.now(),
            title: `🧪 [PRUEBA] Broadcasting con ${strategyName}`,
            content: `Prueba de difusión de mensajes P2P usando la estrategia ${strategyName}.\n\nEsta nota simula la propagación de información a través de la red.\nSe envía a 10 peers con diferentes niveles de prioridad:\n- 2 Servidores (prioridad 9-10)\n- 2 VIP (prioridad 7-8)\n- 2 Premium (prioridad 5)\n- 2 Regular (prioridad 3)\n- 2 Basic (prioridad 1)`,
            timestamp: Date.now(),
            origin: this.nodeId,
            isTestNote: true,
            testType: 'broadcast'
        };
        
        // Agregar nota al panel
        this.notes.set(testNote.id, testNote);
        this.renderNotes();
        this.updateStats();
        
        // Crear peers simulados con características específicas
        const mockPeers = [
            { id: 'peer-server-main', priority: 10, type: 'server', send: () => Math.random() > 0.02 },
            { id: 'peer-server-backup', priority: 9, type: 'server', send: () => Math.random() > 0.02 },
            { id: 'peer-client-vip-1', priority: 8, type: 'vip', send: () => Math.random() > 0.03 },
            { id: 'peer-client-vip-2', priority: 7, type: 'vip', send: () => Math.random() > 0.03 },
            { id: 'peer-client-premium-1', priority: 5, type: 'premium', send: () => Math.random() > 0.05 },
            { id: 'peer-client-premium-2', priority: 5, type: 'premium', send: () => Math.random() > 0.05 },
            { id: 'peer-client-regular-1', priority: 3, type: 'regular', send: () => Math.random() > 0.05 },
            { id: 'peer-client-regular-2', priority: 3, type: 'regular', send: () => Math.random() > 0.05 },
            { id: 'peer-client-basic-1', priority: 1, type: 'basic', send: () => Math.random() > 0.08 },
            { id: 'peer-client-basic-2', priority: 1, type: 'basic', send: () => Math.random() > 0.08 }
        ];
        
        const message = {
            type: 'note-update',
            data: testNote,
            timestamp: Date.now(),
            priority: 'high'
        };
        
        // Ejecutar broadcast
        const startTime = performance.now();
        const result = this.broadcastManager.broadcast(mockPeers, message);
        const endTime = performance.now();
        
        const totalPeers = mockPeers.length;
        const successRate = ((result.sent / totalPeers) * 100).toFixed(1);
        const avgLatency = ((endTime - startTime) / result.sent).toFixed(3);
        
        // Determinar qué peers recibieron el mensaje (simulación)
        const serversCount = mockPeers.filter(p => p.type === 'server').length;
        const vipCount = mockPeers.filter(p => p.type === 'vip').length;
        const premiumCount = mockPeers.filter(p => p.type === 'premium').length;
        
        const description = `
            <div class="test-detail-section">
                <strong>📡 Estrategia de Broadcasting:</strong> ${this.broadcastManager.getCurrentStrategyName()}
                <br><br>
                <strong>📝 Nota Creada:</strong> "${testNote.title}"<br>
                <strong>🔍 Visualiza la nota en el panel principal</strong> (marcada con 🧪)<br>
                <br>
                <strong>🌐 Configuración de la Red:</strong><br>
                • Total de peers: ${totalPeers} nodos<br>
                • Servidores: ${serversCount} (prioridad 9-10)<br>
                • Clientes VIP: ${vipCount} (prioridad 7-8)<br>
                • Clientes Premium: ${premiumCount} (prioridad 5)<br>
                • Clientes Regular: 2 (prioridad 3)<br>
                • Clientes Basic: 2 (prioridad 1)<br>
                <br>
                <strong>📨 Mensaje Enviado:</strong><br>
                • Tipo: ${message.type}<br>
                • Prioridad: ${message.priority}<br>
                • Tamaño: ${JSON.stringify(message).length} bytes<br>
                <br>
                <strong>📊 Resultados de la Transmisión:</strong>
                <table class="comparison-table">
                    <tr>
                        <th>Métrica</th>
                        <th>Valor</th>
                        <th>Evaluación</th>
                    </tr>
                    <tr class="${result.sent === totalPeers ? 'winner' : ''}">
                        <td>Mensajes enviados</td>
                        <td><strong>${result.sent}/${totalPeers}</strong></td>
                        <td>${result.sent === totalPeers ? '✅ Completo' : result.sent >= totalPeers * 0.8 ? '✅ Bueno' : '⚠️ Parcial'}</td>
                    </tr>
                    <tr>
                        <td>Mensajes fallidos</td>
                        <td>${result.failed}</td>
                        <td>${result.failed === 0 ? '✅ Sin fallos' : '⚠️ Algunos fallos'}</td>
                    </tr>
                    <tr class="${successRate >= 90 ? 'winner' : ''}">
                        <td>Tasa de éxito</td>
                        <td><strong>${successRate}%</strong></td>
                        <td>${successRate >= 95 ? '🌟 Excelente' : successRate >= 80 ? '✅ Bueno' : '⚠️ Regular'}</td>
                    </tr>
                    <tr class="${(endTime - startTime) < 5 ? 'winner' : ''}">
                        <td>Latencia total</td>
                        <td>${(endTime - startTime).toFixed(3)}ms</td>
                        <td>${(endTime - startTime) < 2 ? '⚡ Muy rápido' : (endTime - startTime) < 5 ? '✅ Rápido' : '⚠️ Moderado'}</td>
                    </tr>
                    <tr>
                        <td>Latencia promedio</td>
                        <td>${avgLatency}ms/peer</td>
                        <td>-</td>
                    </tr>
                </table>
                <br>
                <strong>📈 Eficiencia de la Estrategia:</strong><br>
                • Ancho de banda usado: ${result.sent} transmisiones<br>
                • Ahorro vs Broadcast-All: ${totalPeers - result.sent} mensajes (${(((totalPeers - result.sent) / totalPeers) * 100).toFixed(1)}%)<br>
                • Overhead de protocolo: ${(result.sent * 40).toFixed(0)} bytes (aprox.)<br>
                <br>
                <strong>💡 Análisis de la Estrategia:</strong><br>
                ${this.getBroadcastTestInsight(strategyName, result.sent, totalPeers, successRate, endTime - startTime)}
                <br><br>
                <strong>🗑️ Usa "Limpiar Notas de Prueba" para eliminar las notas creadas</strong>
            </div>
        `;
        
        this.addTestResult(
            `📡 Prueba de Broadcasting: ${strategyName}`,
            description,
            successRate >= 80 ? 'success' : 'warning',
            {
                'Latencia': `${(endTime - startTime).toFixed(3)}ms`,
                'Enviados': `${result.sent}/${totalPeers}`,
                'Éxito': `${successRate}%`,
                'Eficiencia': `${(((totalPeers - result.sent) / totalPeers) * 100).toFixed(0)}%`
            }
        );
    }

    getBroadcastTestInsight(strategyName, sent, total, successRate, latency) {
        const efficiency = ((total - sent) / total) * 100;
        
        if (strategyName === 'broadcast-all') {
            return `✅ Broadcast-All envió a todos los peers (${sent}/${total}). 
                    Garantiza entrega completa pero ${efficiency === 0 ? 'sin optimización de ancho de banda' : ''}. 
                    Ideal para redes pequeñas (< 20 nodos) o mensajes críticos.`;
        } else if (strategyName === 'selective') {
            return `✅ Selective envió solo a ${sent} peers seleccionados (${efficiency.toFixed(0)}% de ahorro). 
                    Reduce tráfico innecesario mediante filtros. 
                    ${successRate >= 90 ? 'Excelente para segmentación de red.' : 'Útil para mensajes específicos.'}`;
        } else if (strategyName === 'gossip') {
            return `✅ Gossip Protocol propagó a ${sent} peers en esta ronda. 
                    La propagación continúa exponencialmente en rondas subsecuentes. 
                    Convergencia eventual garantizada. Ideal para redes masivas (1000+ nodos).`;
        } else if (strategyName === 'priority') {
            return `✅ Priority-Based respetó el orden de prioridad (servidores primero). 
                    Latencia escalonada: ${latency.toFixed(1)}ms total. 
                    Perfecto para arquitecturas jerárquicas y CDN.`;
        } else if (strategyName === 'batch') {
            return `✅ Batch agrupó mensajes reduciendo overhead de red. 
                    ${efficiency > 0 ? `Ahorro de ${efficiency.toFixed(0)}% en transmisiones.` : ''} 
                    Trade-off: Mayor latencia (${latency.toFixed(1)}ms) a cambio de eficiencia.`;
        }
        return '✅ Prueba completada exitosamente.';
    }

    runAllBroadcastTests() {
        console.log('[TEST] Ejecutando todas las pruebas de broadcasting');
        
        const strategies = [
            'broadcast-all',
            'selective',
            'gossip',
            'priority',
            'batch'
        ];
        
        let delay = 0;
        strategies.forEach(strategy => {
            setTimeout(() => {
                this.runBroadcastTest(strategy);
            }, delay);
            delay += 300;
        });
        
        this.addTestResult(
            '🚀 Todas las Pruebas de Broadcasting Iniciadas',
            `Se ejecutarán ${strategies.length} pruebas con 10 peers simulados cada una.`,
            'success',
            { 'Total': strategies.length }
        );
    }

    // Limpiar notas de prueba
    clearTestNotes() {
        let testNotesCount = 0;
        
        // Filtrar y eliminar notas de prueba
        this.notes.forEach((note, id) => {
            if (note.isTestNote === true) {
                this.notes.delete(id);
                testNotesCount++;
            }
        });
        
        // Guardar cambios y actualizar interfaz
        this.saveNotesToStorage();
        this.renderNotes();
        this.updateStats();
        
        // Mostrar confirmación
        this.addTestResult(
            '🗑️ Notas de Prueba Eliminadas',
            `Se eliminaron ${testNotesCount} nota(s) de prueba del panel de notas.`,
            testNotesCount > 0 ? 'success' : 'info',
            { 'Eliminadas': testNotesCount }
        );
        
        console.log(`[TEST] ${testNotesCount} notas de prueba eliminadas`);
    }

    // Limpiar resultados de pruebas
    clearTestResults() {
        const resultsContent = document.getElementById('testResultsContent');
        resultsContent.innerHTML = '<div class="no-results">No hay resultados de pruebas disponibles</div>';
        console.log('[TEST] Resultados de pruebas limpiados');
    }
}

let app;

document.addEventListener('DOMContentLoaded', () => {
    console.log('P2P NOTES - Iniciando aplicacion...');
    app = new P2PNotesApp();
});