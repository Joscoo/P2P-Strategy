// PATRÓN STRATEGY - Estrategias de Broadcasting
// Permite cambiar dinámicamente el algoritmo de propagación de mensajes a peers

/**
 * Interfaz Strategy: BroadcastStrategy
 * Define el contrato que todas las estrategias de broadcasting deben cumplir
 */
class BroadcastStrategy {
    /**
     * @param {Map} peers - Mapa de todos los peers conectados
     * @param {Object} message - Mensaje a enviar
     * @param {Object} options - Opciones adicionales (ej: origen, prioridad)
     * @returns {Object} Resultado con estadísticas de envío
     */
    broadcast(peers, message, options = {}) {
        throw new Error('El método broadcast() debe ser implementado');
    }

    getName() {
        throw new Error('El método getName() debe ser implementado');
    }
}

/**
 * Estrategia Concreta: Broadcast-All
 * Envía el mensaje a todos los peers conectados simultáneamente
 * Ventaja: Simple, garantiza que todos reciban el mensaje
 * Desventaja: Puede generar tráfico redundante en redes grandes
 */
class BroadcastAllStrategy extends BroadcastStrategy {
    broadcast(peers, message, options = {}) {
        console.log('[Broadcast-All] Enviando a todos los peers');
        
        let sent = 0, failed = 0;
        const startTime = Date.now();

        peers.forEach((peer, peerId) => {
            if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
                try {
                    peer.dataChannel.send(JSON.stringify(message));
                    sent++;
                } catch (error) {
                    console.error(`[Broadcast-All] Error enviando a ${peerId}:`, error);
                    failed++;
                }
            } else {
                failed++;
            }
        });

        const duration = Date.now() - startTime;
        console.log(`[Broadcast-All] Completado: ${sent} exitosos, ${failed} fallos en ${duration}ms`);

        return {
            strategy: this.getName(),
            sent,
            failed,
            total: peers.size,
            duration
        };
    }

    getName() {
        return 'Broadcast-All (Todos los peers)';
    }
}

/**
 * Estrategia Concreta: Selective-Broadcast
 * Envía el mensaje solo a peers seleccionados según un criterio
 * Ventaja: Reduce tráfico, permite comunicación dirigida
 * Desventaja: Requiere lógica adicional de selección
 */
class SelectiveBroadcastStrategy extends BroadcastStrategy {
    constructor(selectorFn = null) {
        super();
        // Función que determina si un peer debe recibir el mensaje
        // Por defecto, envía solo a peers con buena conexión
        this.selectorFn = selectorFn || this.defaultSelector;
    }

    defaultSelector(peer, peerId, message) {
        // Criterio por defecto: solo peers con DataChannel abierto
        return peer.dataChannel && peer.dataChannel.readyState === 'open';
    }

    broadcast(peers, message, options = {}) {
        console.log('[Selective-Broadcast] Seleccionando peers...');
        
        let sent = 0, failed = 0, skipped = 0;
        const startTime = Date.now();

        peers.forEach((peer, peerId) => {
            // Aplica el criterio de selección
            if (!this.selectorFn(peer, peerId, message, options)) {
                skipped++;
                return;
            }

            if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
                try {
                    peer.dataChannel.send(JSON.stringify(message));
                    sent++;
                } catch (error) {
                    console.error(`[Selective-Broadcast] Error enviando a ${peerId}:`, error);
                    failed++;
                }
            } else {
                failed++;
            }
        });

        const duration = Date.now() - startTime;
        console.log(`[Selective-Broadcast] ${sent} enviados, ${failed} fallos, ${skipped} omitidos en ${duration}ms`);

        return {
            strategy: this.getName(),
            sent,
            failed,
            skipped,
            total: peers.size,
            duration
        };
    }

    setSelector(selectorFn) {
        this.selectorFn = selectorFn;
    }

    getName() {
        return 'Selective-Broadcast (Selectivo)';
    }
}

/**
 * Estrategia Concreta: Gossip-Protocol
 * Envía el mensaje a un subconjunto aleatorio de peers que luego propagan
 * Ventaja: Escalable, reduce carga del emisor original
 * Desventaja: Latencia mayor, no garantiza entrega inmediata
 */
class GossipProtocolStrategy extends BroadcastStrategy {
    constructor(fanout = 3) {
        super();
        // Número de peers a los que enviar directamente
        this.fanout = fanout;
        this.messageCache = new Set(); // Evita reenvíos infinitos
    }

    broadcast(peers, message, options = {}) {
        console.log('[Gossip] Iniciando propagación con fanout:', this.fanout);

        // Evita loops infinitos
        if (this.messageCache.has(message.id)) {
            console.log('[Gossip] Mensaje ya procesado, ignorando');
            return { strategy: this.getName(), sent: 0, failed: 0, cached: true };
        }

        this.messageCache.add(message.id);
        // Limpia el caché después de 60 segundos
        setTimeout(() => this.messageCache.delete(message.id), 60000);

        // Convierte el Map a array y selecciona peers aleatorios
        const peersArray = Array.from(peers.entries());
        const activePeers = peersArray.filter(([_, peer]) => 
            peer.dataChannel && peer.dataChannel.readyState === 'open'
        );

        // Selección aleatoria de peers
        const selectedPeers = this.selectRandomPeers(activePeers, this.fanout);

        let sent = 0, failed = 0;
        const startTime = Date.now();

        // Marca el mensaje para propagación gossip
        const gossipMessage = {
            ...message,
            gossip: true,
            hopCount: (message.hopCount || 0) + 1
        };

        selectedPeers.forEach(([peerId, peer]) => {
            try {
                peer.dataChannel.send(JSON.stringify(gossipMessage));
                sent++;
            } catch (error) {
                console.error(`[Gossip] Error enviando a ${peerId}:`, error);
                failed++;
            }
        });

        const duration = Date.now() - startTime;
        console.log(`[Gossip] ${sent} enviados, ${failed} fallos en ${duration}ms (${activePeers.length} activos)`);

        return {
            strategy: this.getName(),
            sent,
            failed,
            selected: selectedPeers.length,
            available: activePeers.length,
            total: peers.size,
            duration,
            hopCount: gossipMessage.hopCount
        };
    }

    selectRandomPeers(peersArray, count) {
        // Fisher-Yates shuffle simplificado para selección aleatoria
        const shuffled = [...peersArray].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, Math.min(count, peersArray.length));
    }

    setFanout(fanout) {
        this.fanout = fanout;
        console.log('[Gossip] Fanout actualizado a:', fanout);
    }

    getName() {
        return 'Gossip-Protocol (Epidémico)';
    }
}

/**
 * Estrategia Concreta: Priority-Based-Broadcast
 * Envía mensajes según prioridades asignadas a los peers
 * Ventaja: Optimiza latencia para peers críticos
 * Desventaja: Puede crear desigualdad en la red
 */
class PriorityBasedBroadcastStrategy extends BroadcastStrategy {
    constructor() {
        super();
        this.peerPriorities = new Map(); // peerId -> priority (0-10)
    }

    broadcast(peers, message, options = {}) {
        console.log('[Priority-Broadcast] Ordenando por prioridad...');
        
        const messagePriority = options.priority || 5;
        
        // Ordena peers por prioridad
        const sortedPeers = this.sortPeersByPriority(peers);

        let sent = 0, failed = 0;
        const startTime = Date.now();

        // Envía primero a peers de alta prioridad
        for (const [peerId, peer] of sortedPeers) {
            const peerPriority = this.peerPriorities.get(peerId) || 5;
            
            // Solo envía si la prioridad del peer es >= prioridad del mensaje
            if (peerPriority < messagePriority) {
                continue;
            }

            if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
                try {
                    peer.dataChannel.send(JSON.stringify(message));
                    sent++;
                } catch (error) {
                    console.error(`[Priority-Broadcast] Error enviando a ${peerId}:`, error);
                    failed++;
                }
            } else {
                failed++;
            }
        }

        const duration = Date.now() - startTime;
        console.log(`[Priority-Broadcast] ${sent} enviados, ${failed} fallos en ${duration}ms`);

        return {
            strategy: this.getName(),
            sent,
            failed,
            total: peers.size,
            duration,
            messagePriority
        };
    }

    sortPeersByPriority(peers) {
        return Array.from(peers.entries()).sort((a, b) => {
            const priorityA = this.peerPriorities.get(a[0]) || 5;
            const priorityB = this.peerPriorities.get(b[0]) || 5;
            return priorityB - priorityA; // Orden descendente
        });
    }

    setPeerPriority(peerId, priority) {
        this.peerPriorities.set(peerId, Math.max(0, Math.min(10, priority)));
        console.log(`[Priority-Broadcast] Peer ${peerId} prioridad: ${priority}`);
    }

    getName() {
        return 'Priority-Based (Basado en prioridad)';
    }
}

/**
 * Estrategia Concreta: Batch-Broadcast
 * Agrupa múltiples mensajes y los envía en lotes
 * Ventaja: Reduce overhead de red, eficiente para ráfagas
 * Desventaja: Introduce latencia intencional
 */
class BatchBroadcastStrategy extends BroadcastStrategy {
    constructor(batchSize = 5, batchDelay = 100) {
        super();
        this.batchSize = batchSize;
        this.batchDelay = batchDelay; // ms
        this.messageQueue = [];
        this.batchTimer = null;
    }

    broadcast(peers, message, options = {}) {
        console.log('[Batch-Broadcast] Agregando mensaje a lote');

        this.messageQueue.push(message);

        // Si el lote está lleno, envía inmediatamente
        if (this.messageQueue.length >= this.batchSize) {
            return this.flushBatch(peers);
        }

        // Si no, programa el envío
        if (!this.batchTimer) {
            this.batchTimer = setTimeout(() => {
                this.flushBatch(peers);
            }, this.batchDelay);
        }

        return {
            strategy: this.getName(),
            queued: true,
            queueSize: this.messageQueue.length,
            batchSize: this.batchSize
        };
    }

    flushBatch(peers) {
        if (this.messageQueue.length === 0) {
            return { strategy: this.getName(), sent: 0, failed: 0 };
        }

        console.log(`[Batch-Broadcast] Enviando lote de ${this.messageQueue.length} mensajes`);

        const batchMessage = {
            type: 'batch',
            messages: [...this.messageQueue],
            timestamp: Date.now()
        };

        let sent = 0, failed = 0;
        const startTime = Date.now();

        peers.forEach((peer, peerId) => {
            if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
                try {
                    peer.dataChannel.send(JSON.stringify(batchMessage));
                    sent++;
                } catch (error) {
                    console.error(`[Batch-Broadcast] Error enviando a ${peerId}:`, error);
                    failed++;
                }
            }
        });

        const messageCount = this.messageQueue.length;
        this.messageQueue = [];
        this.batchTimer = null;

        const duration = Date.now() - startTime;
        console.log(`[Batch-Broadcast] ${messageCount} mensajes a ${sent} peers en ${duration}ms`);

        return {
            strategy: this.getName(),
            sent,
            failed,
            messagesInBatch: messageCount,
            total: peers.size,
            duration
        };
    }

    getName() {
        return 'Batch-Broadcast (Por lotes)';
    }
}

/**
 * Context: BroadcastManager
 * Mantiene una referencia a la estrategia actual y delega el broadcasting
 */
class BroadcastManager {
    constructor(strategy = null) {
        this.strategy = strategy || new BroadcastAllStrategy();
        this.stats = {
            totalMessages: 0,
            totalSent: 0,
            totalFailed: 0
        };
    }

    /**
     * Permite cambiar la estrategia dinámicamente en tiempo de ejecución
     */
    setStrategy(strategy) {
        console.log('[BroadcastManager] Cambiando estrategia a:', strategy.getName());
        this.strategy = strategy;
    }

    /**
     * Delega el broadcasting a la estrategia actual
     */
    broadcast(peers, message, options = {}) {
        this.stats.totalMessages++;
        const result = this.strategy.broadcast(peers, message, options);
        
        this.stats.totalSent += result.sent || 0;
        this.stats.totalFailed += result.failed || 0;

        return result;
    }

    getCurrentStrategyName() {
        return this.strategy.getName();
    }

    getStats() {
        return {
            ...this.stats,
            successRate: this.stats.totalMessages > 0 
                ? (this.stats.totalSent / (this.stats.totalSent + this.stats.totalFailed) * 100).toFixed(2) + '%'
                : 'N/A'
        };
    }

    resetStats() {
        this.stats = {
            totalMessages: 0,
            totalSent: 0,
            totalFailed: 0
        };
        console.log('[BroadcastManager] Estadísticas reiniciadas');
    }
}

// Exportar las clases para uso en otros módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        BroadcastStrategy,
        BroadcastAllStrategy,
        SelectiveBroadcastStrategy,
        GossipProtocolStrategy,
        PriorityBasedBroadcastStrategy,
        BatchBroadcastStrategy,
        BroadcastManager
    };
}
