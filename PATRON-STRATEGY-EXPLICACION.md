# Patrón Strategy en P2P Notes
## Sistema de Notas Colaborativas Descentralizado

---

## 📋 Índice

1. [Introducción al Patrón Strategy](#introducción)
2. [Implementación en el Proyecto](#implementación)
3. [Estrategias de Resolución de Conflictos](#conflictos)
4. [Estrategias de Broadcasting](#broadcasting)
5. [Estrategias de Almacenamiento](#almacenamiento)
6. [Ventajas de la Implementación](#ventajas)
7. [Ejemplos de Uso](#ejemplos)
8. [Diagrama de Clases](#diagrama)

---

## 🎯 Introducción al Patrón Strategy {#introducción}

### ¿Qué es el Patrón Strategy?

El **Patrón Strategy** es un patrón de diseño de comportamiento que permite:

- ✅ Definir una **familia de algoritmos**
- ✅ **Encapsular** cada uno de ellos
- ✅ Hacerlos **intercambiables** en tiempo de ejecución
- ✅ Permitir que el algoritmo varíe **independientemente** de los clientes que lo usan

### Estructura del Patrón

```
Context (Contexto)
    ├── Mantiene referencia a Strategy
    └── Delega operaciones a Strategy

Strategy (Interfaz)
    └── Define operación común

ConcreteStrategyA, B, C... (Estrategias Concretas)
    └── Implementan el algoritmo específico
```

### ¿Por qué usar Strategy en este proyecto?

En un sistema **P2P descentralizado**, diferentes situaciones requieren diferentes comportamientos:

1. **Conflictos de sincronización**: ¿Cuál versión de una nota prevalece?
2. **Propagación de mensajes**: ¿A cuántos peers enviar? ¿En qué orden?
3. **Persistencia de datos**: ¿LocalStorage? ¿IndexedDB? ¿Solo en memoria?

El patrón Strategy permite **cambiar estos comportamientos dinámicamente** sin modificar el código principal.

---

## 🏗️ Implementación en el Proyecto {#implementación}

### Tres Contextos Principales

El proyecto implementa el patrón Strategy en **tres áreas críticas**:

| Contexto | Propósito | Archivo |
|----------|-----------|---------|
| **ConflictResolver** | Resolver conflictos de sincronización | `conflictResolutionStrategies.js` |
| **BroadcastManager** | Propagar mensajes a peers | `broadcastStrategies.js` |
| **StorageManager** | Persistir datos localmente | `storageStrategies.js` |

### Inicialización en la Aplicación

```javascript
class P2PNotesApp {
    constructor() {
        // PATRÓN STRATEGY: Inicializar gestores de estrategias
        this.conflictResolver = new ConflictResolver(new LastWriteWinsStrategy());
        this.storageManager = new StorageManager(new LocalStorageStrategy());
        this.broadcastManager = new BroadcastManager(new BroadcastAllStrategy());
    }
}
```

### Cambio Dinámico de Estrategias

```javascript
// El usuario puede cambiar la estrategia en tiempo de ejecución
conflictResolver.setStrategy(new VersionBasedStrategy());
broadcastManager.setStrategy(new GossipProtocolStrategy());
storageManager.setStrategy(new IndexedDBStorageStrategy());
```

---

## ⚔️ Estrategias de Resolución de Conflictos {#conflictos}

### Contexto: ConflictResolver

**Problema**: Cuando dos peers modifican la misma nota simultáneamente, ¿cuál versión debe prevalecer?

### Estrategias Implementadas

#### 1. **Last-Write-Wins (Último Escribe Gana)**

```javascript
class LastWriteWinsStrategy {
    resolve(localNote, remoteNote) {
        // La nota con timestamp mayor prevalece
        return remoteNote.timestamp > localNote.timestamp 
            ? remoteNote 
            : localNote;
    }
}
```

| ✅ Ventajas | ❌ Desventajas |
|------------|---------------|
| Simple y determinista | Puede perder cambios si timestamps no sincronizados |
| Fácil de entender | Depende de relojes precisos |
| Bajo overhead computacional | Sin historial de cambios |

**Caso de Uso**: Aplicaciones donde la versión más reciente siempre es correcta.

---

#### 2. **First-Write-Wins (Primero Escribe Gana)**

```javascript
class FirstWriteWinsStrategy {
    resolve(localNote, remoteNote) {
        // La nota más antigua prevalece
        return localNote.timestamp < remoteNote.timestamp 
            ? localNote 
            : remoteNote;
    }
}
```

| ✅ Ventajas | ❌ Desventajas |
|------------|---------------|
| Protege contra sobrescrituras | No permite actualizaciones legítimas |
| Inmutable después de creación | Inflexible |
| Previene conflictos | Requiere eliminar y recrear para cambiar |

**Caso de Uso**: Registros inmutables, auditoría.

---

#### 3. **Version-Based (Basado en Versión)**

```javascript
class VersionBasedStrategy {
    resolve(localNote, remoteNote) {
        const localVersion = localNote.version || 1;
        const remoteVersion = remoteNote.version || 1;
        
        if (remoteVersion > localVersion) return remoteNote;
        if (localVersion > remoteVersion) return localNote;
        
        // Desempate con timestamp
        return remoteNote.timestamp > localNote.timestamp 
            ? remoteNote 
            : localNote;
    }
}
```

| ✅ Ventajas | ❌ Desventajas |
|------------|---------------|
| Robusto contra desincronización de relojes | Requiere contador de versión |
| Detección de conflictos precisa | Más complejo de implementar |
| Permite merge manual | Necesita sincronización del contador |

**Caso de Uso**: Sistemas colaborativos con control de versiones.

---

#### 4. **Content-Merge (Fusión de Contenido)**

```javascript
class ContentMergeStrategy {
    resolve(localNote, remoteNote) {
        if (localNote.content === remoteNote.content) {
            return remoteNote.timestamp > localNote.timestamp 
                ? remoteNote 
                : localNote;
        }
        
        // Fusionar contenidos
        return {
            ...localNote,
            title: `${localNote.title} / ${remoteNote.title}`,
            content: `=== VERSIÓN LOCAL ===\n${localNote.content}\n\n` +
                    `=== VERSIÓN REMOTA ===\n${remoteNote.content}`,
            merged: true
        };
    }
}
```

| ✅ Ventajas | ❌ Desventajas |
|------------|---------------|
| No pierde información | Puede crear contenido duplicado |
| Preserva ambas versiones | Requiere intervención manual |
| Útil para revisión | Contenido puede volverse confuso |

**Caso de Uso**: Documentos importantes donde no se puede perder información.

---

#### 5. **Author-Priority (Prioridad al Autor)**

```javascript
class AuthorPriorityStrategy {
    resolve(localNote, remoteNote) {
        // El autor original tiene prioridad
        if (localNote.author === this.currentNodeId) {
            return localNote;
        }
        
        if (remoteNote.author === remoteNote.origin) {
            return remoteNote;
        }
        
        // Fallback a Last-Write-Wins
        return remoteNote.timestamp > localNote.timestamp 
            ? remoteNote 
            : localNote;
    }
}
```

| ✅ Ventajas | ❌ Desventajas |
|------------|---------------|
| Respeta la autoría | Rechaza ediciones colaborativas |
| Protege trabajo del creador | No apropiado para wikis |
| Control de propiedad | Puede ignorar mejoras |

**Caso de Uso**: Notas personales en red compartida.

---

## 📡 Estrategias de Broadcasting {#broadcasting}

### Contexto: BroadcastManager

**Problema**: ¿Cómo propagar eficientemente un cambio (crear/editar/eliminar nota) a todos los peers?

### Estrategias Implementadas

#### 1. **Broadcast-All (Todos los Peers)**

```javascript
class BroadcastAllStrategy {
    broadcast(peers, message) {
        peers.forEach((peer, peerId) => {
            if (peer.dataChannel?.readyState === 'open') {
                peer.dataChannel.send(JSON.stringify(message));
            }
        });
    }
}
```

| ✅ Ventajas | ❌ Desventajas |
|------------|---------------|
| Garantiza entrega a todos | Tráfico redundante en redes grandes |
| Simple de implementar | Overhead de red alto |
| Baja latencia | No escalable |

**Métricas**: O(N) mensajes donde N = número de peers.

**Caso de Uso**: Redes pequeñas (<10 peers), actualizaciones críticas.

---

#### 2. **Selective-Broadcast (Selectivo)**

```javascript
class SelectiveBroadcastStrategy {
    broadcast(peers, message, options) {
        peers.forEach((peer, peerId) => {
            // Solo envía si cumple criterio
            if (this.selectorFn(peer, peerId, message)) {
                peer.dataChannel.send(JSON.stringify(message));
            }
        });
    }
}
```

**Ejemplo de Selector**:
```javascript
// Solo enviar a peers con buena conexión
const goodConnectionSelector = (peer) => {
    return peer.dataChannel?.readyState === 'open' &&
           peer.pc?.iceConnectionState === 'connected';
};
```

| ✅ Ventajas | ❌ Desventajas |
|------------|---------------|
| Reduce tráfico innecesario | Requiere lógica de selección |
| Comunicación dirigida | Algunos peers pueden no recibir |
| Flexible y configurable | Complejidad adicional |

**Caso de Uso**: Mensajes dirigidos, priorización de peers.

---

#### 3. **Gossip-Protocol (Protocolo Epidémico)**

```javascript
class GossipProtocolStrategy {
    constructor(fanout = 3) {
        this.fanout = fanout; // Número de peers a los que enviar
    }
    
    broadcast(peers, message) {
        // Selecciona peers aleatorios
        const selectedPeers = this.selectRandomPeers(peers, this.fanout);
        
        selectedPeers.forEach((peer) => {
            peer.dataChannel.send(JSON.stringify({
                ...message,
                gossip: true,
                hopCount: (message.hopCount || 0) + 1
            }));
        });
    }
}
```

**Propagación**:
```
Peer A → [B, C, D] (fanout=3)
    B → [E, F, G]
    C → [H, I, J]
    D → [K, L, M]
```

| ✅ Ventajas | ❌ Desventajas |
|------------|---------------|
| Escalable a redes grandes | Mayor latencia |
| Distribuye la carga | No garantiza entrega inmediata |
| Resiliente a fallos | Puede haber duplicados |

**Métricas**: O(fanout × log N) propagación.

**Caso de Uso**: Redes grandes (>100 peers), actualizaciones no críticas.

---

#### 4. **Priority-Based-Broadcast (Basado en Prioridad)**

```javascript
class PriorityBasedBroadcastStrategy {
    broadcast(peers, message, options) {
        const messagePriority = options.priority || 5;
        
        // Ordena peers por prioridad
        const sortedPeers = this.sortPeersByPriority(peers);
        
        // Envía primero a alta prioridad
        for (const [peerId, peer] of sortedPeers) {
            const peerPriority = this.peerPriorities.get(peerId) || 5;
            
            if (peerPriority >= messagePriority) {
                peer.dataChannel.send(JSON.stringify(message));
            }
        }
    }
}
```

**Niveles de Prioridad**:
- **10**: Crítico (servidores, coordinadores)
- **7-9**: Alto (peers de confianza)
- **4-6**: Normal (peers regulares)
- **1-3**: Bajo (peers nuevos, inestables)

| ✅ Ventajas | ❌ Desventajas |
|------------|---------------|
| Optimiza latencia para peers críticos | Puede crear desigualdad |
| Garantiza entrega ordenada | Requiere gestión de prioridades |
| Control fino de propagación | Complejidad de configuración |

**Caso de Uso**: Redes jerárquicas, servidores dedicados.

---

#### 5. **Batch-Broadcast (Por Lotes)**

```javascript
class BatchBroadcastStrategy {
    constructor(batchSize = 5, batchDelay = 100) {
        this.batchSize = batchSize;
        this.batchDelay = batchDelay; // ms
        this.messageQueue = [];
    }
    
    broadcast(peers, message) {
        this.messageQueue.push(message);
        
        if (this.messageQueue.length >= this.batchSize) {
            this.flushBatch(peers);
        } else {
            setTimeout(() => this.flushBatch(peers), this.batchDelay);
        }
    }
}
```

**Ejemplo de Lote**:
```json
{
  "type": "batch",
  "messages": [
    { "type": "note-created", ... },
    { "type": "note-updated", ... },
    { "type": "note-updated", ... },
    { "type": "note-deleted", ... }
  ]
}
```

| ✅ Ventajas | ❌ Desventajas |
|------------|---------------|
| Reduce overhead de red | Introduce latencia intencional |
| Eficiente para ráfagas | No apropiado para tiempo real |
| Menor uso de ancho de banda | Complejidad en manejo de lotes |

**Caso de Uso**: Ediciones rápidas sucesivas, optimización de ancho de banda.

---

## 💾 Estrategias de Almacenamiento {#almacenamiento}

### Contexto: StorageManager

**Problema**: ¿Dónde y cómo persistir las notas localmente?

### Comparativa de Estrategias

| Característica | LocalStorage | SessionStorage | InMemory | IndexedDB |
|---------------|--------------|----------------|----------|-----------|
| **Capacidad** | ~5-10 MB | ~5-10 MB | RAM disponible | ~50% disco |
| **Persistencia** | Permanente | Por sesión | Solo runtime | Permanente |
| **API** | Síncrona | Síncrona | Síncrona | Asíncrona |
| **Velocidad** | Media | Media | Muy rápida | Rápida |
| **Soporte** | 100% | 100% | 100% | 97% |

---

#### 1. **LocalStorage (Persistente)**

```javascript
class LocalStorageStrategy {
    save(key, data) {
        const serialized = JSON.stringify(data);
        localStorage.setItem(key, serialized);
        return true;
    }
    
    load(key) {
        const serialized = localStorage.getItem(key);
        return serialized ? JSON.parse(serialized) : null;
    }
}
```

**Características**:
- ✅ Datos sobreviven al cierre del navegador
- ✅ Simple de usar (API síncrona)
- ⚠️ Límite de ~5-10 MB
- ❌ Puede lanzar `QuotaExceededError`

**Caso de Uso**: **Predeterminado** - Notas personales, configuración.

---

#### 2. **SessionStorage (Temporal)**

```javascript
class SessionStorageStrategy {
    save(key, data) {
        sessionStorage.setItem(key, JSON.stringify(data));
        return true;
    }
}
```

**Características**:
- ✅ Aislamiento por pestaña
- ✅ Se limpia automáticamente
- ⚠️ Se pierde al cerrar pestaña
- ❌ No para datos importantes

**Caso de Uso**: Sesiones temporales, demos, testing.

---

#### 3. **InMemory (Solo RAM)**

```javascript
class InMemoryStorageStrategy {
    constructor() {
        this.storage = new Map();
    }
    
    save(key, data) {
        this.storage.set(key, JSON.parse(JSON.stringify(data)));
        return true;
    }
}
```

**Características**:
- ✅ Muy rápido (sin I/O)
- ✅ Sin límites prácticos
- ❌ Se pierde al recargar
- ❌ Solo para datos volátiles

**Caso de Uso**: Caché temporal, tests unitarios, prototipos.

---

#### 4. **IndexedDB (Gran Capacidad)**

```javascript
class IndexedDBStorageStrategy {
    async save(key, data) {
        const db = await this.initDB();
        const tx = db.transaction(['notes'], 'readwrite');
        const store = tx.objectStore('notes');
        await store.put(data, key);
    }
}
```

**Características**:
- ✅ Gran capacidad (~50% del disco)
- ✅ Transacciones ACID
- ✅ Búsquedas indexadas
- ⚠️ API asíncrona (compleja)

**Caso de Uso**: Aplicaciones con muchas notas, archivos adjuntos, historial.

---

## 🎁 Ventajas de la Implementación {#ventajas}

### 1. **Flexibilidad**

```javascript
// Cambiar estrategia según el contexto
if (networkSize > 100) {
    broadcastManager.setStrategy(new GossipProtocolStrategy());
} else {
    broadcastManager.setStrategy(new BroadcastAllStrategy());
}
```

### 2. **Mantenibilidad**

- ✅ Cada estrategia es una clase independiente
- ✅ Fácil agregar nuevas estrategias
- ✅ No modifica código existente (Open/Closed Principle)

### 3. **Testabilidad**

```javascript
// Tests unitarios para cada estrategia
describe('LastWriteWinsStrategy', () => {
    it('should prefer newer timestamp', () => {
        const strategy = new LastWriteWinsStrategy();
        const result = strategy.resolve(
            { timestamp: 1000 },
            { timestamp: 2000 }
        );
        expect(result.timestamp).toBe(2000);
    });
});
```

### 4. **Configurabilidad**

Los usuarios pueden elegir estrategias según sus necesidades:
- 📝 Notas personales → Last-Write-Wins + LocalStorage
- 👥 Colaboración → Content-Merge + IndexedDB
- 🌐 Red grande → Gossip-Protocol + Selective-Broadcast

---

## 💡 Ejemplos de Uso {#ejemplos}

### Ejemplo 1: Cambiar Estrategia de Conflictos

```javascript
// Usuario selecciona estrategia en UI
function setConflictStrategy(strategyName) {
    let strategy;
    
    switch (strategyName) {
        case 'last-write':
            strategy = new LastWriteWinsStrategy();
            break;
        case 'version':
            strategy = new VersionBasedStrategy();
            break;
        case 'merge':
            strategy = new ContentMergeStrategy();
            break;
    }
    
    app.conflictResolver.setStrategy(strategy);
    console.log('Estrategia cambiada a:', strategyName);
}
```

### Ejemplo 2: Broadcasting Selectivo

```javascript
// Solo broadcast a peers de confianza
const trustedPeersSelector = (peer, peerId) => {
    const trustedIds = ['peer_A', 'peer_B', 'peer_C'];
    return trustedIds.includes(peerId) && 
           peer.dataChannel?.readyState === 'open';
};

const strategy = new SelectiveBroadcastStrategy(trustedPeersSelector);
broadcastManager.setStrategy(strategy);
```

### Ejemplo 3: Cambio Dinámico de Storage

```javascript
// Cambiar a IndexedDB si hay muchas notas
async function optimizeStorage() {
    const noteCount = app.notes.size;
    
    if (noteCount > 1000) {
        const idbStrategy = new IndexedDBStorageStrategy();
        await idbStrategy.initDB();
        app.storageManager.setStrategy(idbStrategy);
        
        console.log('Migrado a IndexedDB por volumen de datos');
    }
}
```

---

## 📊 Diagrama de Clases {#diagrama}

```
┌─────────────────────────────────────────────────────────────┐
│                       P2PNotesApp                           │
│─────────────────────────────────────────────────────────────│
│ - conflictResolver: ConflictResolver                        │
│ - broadcastManager: BroadcastManager                        │
│ - storageManager: StorageManager                            │
│─────────────────────────────────────────────────────────────│
│ + createNote()                                              │
│ + updateNote()                                              │
│ + deleteNote()                                              │
│ + syncWithPeers()                                           │
└─────────────────────────────────────────────────────────────┘
           │                    │                    │
           │                    │                    │
           ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ ConflictResolver │  │ BroadcastManager │  │ StorageManager   │
│──────────────────│  │──────────────────│  │──────────────────│
│ - strategy       │  │ - strategy       │  │ - strategy       │
│──────────────────│  │──────────────────│  │──────────────────│
│ + setStrategy()  │  │ + setStrategy()  │  │ + setStrategy()  │
│ + resolve()      │  │ + broadcast()    │  │ + save()         │
└──────────────────┘  └──────────────────┘  │ + load()         │
           │                    │            └──────────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ <<interface>>    │  │ <<interface>>    │  │ <<interface>>    │
│ ConflictStrategy │  │ BroadcastStrategy│  │ StorageStrategy  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
           │                    │                    │
    ┌──────┴──────┐      ┌──────┴──────┐      ┌──────┴──────┐
    │             │      │             │      │             │
    ▼             ▼      ▼             ▼      ▼             ▼
LastWriteWins  Version  BroadcastAll Gossip LocalStorage IndexedDB
FirstWriteWins Merge   Selective     Priority SessionStorage InMemory
AuthorPriority         Batch
```

---

## 🎓 Conclusiones

### Beneficios del Patrón Strategy en P2P Notes

1. **Adaptabilidad**: El sistema se adapta a diferentes escenarios de red y uso
2. **Extensibilidad**: Nuevas estrategias se agregan sin modificar código existente
3. **Configurabilidad**: Usuarios eligen comportamientos según necesidades
4. **Mantenibilidad**: Código organizado, modular y testeable
5. **Rendimiento**: Optimización dinámica según contexto

### Casos de Uso Reales

| Escenario | Conflict | Broadcast | Storage |
|-----------|----------|-----------|---------|
| **Red pequeña colaborativa** | Content-Merge | Broadcast-All | LocalStorage |
| **Red grande P2P** | Version-Based | Gossip-Protocol | IndexedDB |
| **Notas personales** | Author-Priority | Selective | LocalStorage |
| **Demo temporal** | Last-Write-Wins | Broadcast-All | InMemory |
| **Red corporativa** | Version-Based | Priority-Based | IndexedDB |

### Próximas Mejoras

- 🔄 **Estrategias híbridas**: Combinar múltiples estrategias
- 📈 **Auto-optimización**: Cambio automático según métricas
- 🔐 **Estrategias de seguridad**: Encriptación, firmas digitales
- 📊 **Métricas avanzadas**: Dashboards de rendimiento

---

## 📚 Referencias

- **Design Patterns**: Gang of Four (GoF)
- **JavaScript Design Patterns**: Addy Osmani
- **WebRTC Documentation**: MDN Web Docs
- **P2P Networks**: Distributed Systems Concepts

---

**Desarrollado para la materia de Arquitectura de Software**  
**ESPOCH - 7mo Semestre**  
**Enero 2026**
