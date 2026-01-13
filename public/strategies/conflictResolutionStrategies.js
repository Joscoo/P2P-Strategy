// PATRÓN STRATEGY - Estrategias de Resolución de Conflictos
// Permite cambiar dinámicamente el algoritmo para resolver conflictos de sincronización

/**
 * Interfaz Strategy: ConflictResolutionStrategy
 * Define el contrato que todas las estrategias de resolución de conflictos deben cumplir
 */
class ConflictResolutionStrategy {
    /**
     * @param {Object} localNote - Nota almacenada localmente
     * @param {Object} remoteNote - Nota recibida de un peer remoto
     * @returns {Object} La nota que debe prevalecer
     */
    resolve(localNote, remoteNote) {
        throw new Error('El método resolve() debe ser implementado');
    }

    getName() {
        throw new Error('El método getName() debe ser implementado');
    }
}

/**
 * Estrategia Concreta: Last-Write-Wins
 * La nota con el timestamp más reciente prevalece
 * Ventaja: Simple y determinista
 * Desventaja: Puede perder cambios si los timestamps no están sincronizados
 */
class LastWriteWinsStrategy extends ConflictResolutionStrategy {
    resolve(localNote, remoteNote) {
        if (!localNote) return remoteNote;
        if (!remoteNote) return localNote;

        console.log('[LWW Strategy] Comparando timestamps:', {
            local: localNote.timestamp,
            remote: remoteNote.timestamp
        });

        // La nota con el timestamp mayor gana
        return remoteNote.timestamp > localNote.timestamp ? remoteNote : localNote;
    }

    getName() {
        return 'Last-Write-Wins (Último escribe)';
    }
}

/**
 * Estrategia Concreta: First-Write-Wins
 * La primera nota en ser creada prevalece, ignorando actualizaciones posteriores
 * Ventaja: Protege contra sobrescrituras accidentales
 * Desventaja: No permite actualizaciones legítimas
 */
class FirstWriteWinsStrategy extends ConflictResolutionStrategy {
    resolve(localNote, remoteNote) {
        if (!localNote) return remoteNote;
        if (!remoteNote) return localNote;

        console.log('[FWW Strategy] Comparando timestamps:', {
            local: localNote.timestamp,
            remote: remoteNote.timestamp
        });

        // La nota con el timestamp menor (más antigua) gana
        return localNote.timestamp < remoteNote.timestamp ? localNote : remoteNote;
    }

    getName() {
        return 'First-Write-Wins (Primero escribe)';
    }
}

/**
 * Estrategia Concreta: Version-Based
 * Utiliza un contador de versión además del timestamp
 * La versión mayor gana, el timestamp se usa como desempate
 * Ventaja: Más robusto contra problemas de sincronización de relojes
 */
class VersionBasedStrategy extends ConflictResolutionStrategy {
    resolve(localNote, remoteNote) {
        if (!localNote) return remoteNote;
        if (!remoteNote) return localNote;

        // Asegura que las notas tengan versión (compatibilidad con notas antiguas)
        const localVersion = localNote.version || 1;
        const remoteVersion = remoteNote.version || 1;

        console.log('[Version Strategy] Comparando versiones:', {
            local: localVersion,
            remote: remoteVersion
        });

        // La versión mayor gana
        if (remoteVersion > localVersion) return remoteNote;
        if (localVersion > remoteVersion) return localNote;

        // En caso de empate, usar timestamp como desempate
        return remoteNote.timestamp > localNote.timestamp ? remoteNote : localNote;
    }

    getName() {
        return 'Version-Based (Basado en versión)';
    }
}

/**
 * Estrategia Concreta: Content-Merge
 * Intenta fusionar el contenido de ambas notas cuando hay conflicto
 * Ventaja: No pierde información
 * Desventaja: Puede crear contenido duplicado o confuso
 */
class ContentMergeStrategy extends ConflictResolutionStrategy {
    resolve(localNote, remoteNote) {
        if (!localNote) return remoteNote;
        if (!remoteNote) return localNote;

        console.log('[Merge Strategy] Fusionando contenidos');

        // Si el contenido es idéntico, no hay conflicto real
        if (localNote.content === remoteNote.content && 
            localNote.title === remoteNote.title) {
            return remoteNote.timestamp > localNote.timestamp ? remoteNote : localNote;
        }

        // Crear una nota fusionada
        const mergedNote = {
            id: localNote.id,
            title: this.mergeTitle(localNote.title, remoteNote.title),
            content: this.mergeContent(localNote.content, remoteNote.content),
            timestamp: Math.max(localNote.timestamp, remoteNote.timestamp),
            version: Math.max(localNote.version || 1, remoteNote.version || 1) + 1,
            origin: localNote.origin,
            author: localNote.author,
            merged: true // Marca para indicar que esta nota fue fusionada
        };

        return mergedNote;
    }

    mergeTitle(localTitle, remoteTitle) {
        if (localTitle === remoteTitle) return localTitle;
        
        // Si son diferentes, combinar ambos títulos
        return `${localTitle} / ${remoteTitle}`;
    }

    mergeContent(localContent, remoteContent) {
        if (localContent === remoteContent) return localContent;

        // Fusionar contenidos con separación clara
        return `=== VERSIÓN LOCAL ===\n${localContent}\n\n=== VERSIÓN REMOTA ===\n${remoteContent}`;
    }

    getName() {
        return 'Content-Merge (Fusionar contenido)';
    }
}

/**
 * Estrategia Concreta: Author-Priority
 * Da prioridad a las notas del nodo que las creó originalmente
 * Ventaja: Respeta la autoría original
 * Desventaja: Puede rechazar actualizaciones colaborativas legítimas
 */
class AuthorPriorityStrategy extends ConflictResolutionStrategy {
    constructor(currentNodeId) {
        super();
        this.currentNodeId = currentNodeId;
    }

    resolve(localNote, remoteNote) {
        if (!localNote) return remoteNote;
        if (!remoteNote) return localNote;

        console.log('[Author Priority Strategy] Verificando autoría:', {
            localAuthor: localNote.author,
            remoteAuthor: remoteNote.author,
            currentNode: this.currentNodeId
        });

        // Si el nodo actual es el autor original, la versión local gana
        if (localNote.author === this.currentNodeId) {
            return localNote;
        }

        // Si el autor remoto es el original, la versión remota gana
        if (remoteNote.author === remoteNote.origin) {
            return remoteNote;
        }

        // Si ninguno es el autor original, usar Last-Write-Wins como fallback
        return remoteNote.timestamp > localNote.timestamp ? remoteNote : localNote;
    }

    getName() {
        return 'Author-Priority (Prioridad al autor)';
    }
}

/**
 * Context: ConflictResolver
 * Mantiene una referencia a la estrategia actual y delega la resolución de conflictos
 */
class ConflictResolver {
    constructor(strategy = null) {
        this.strategy = strategy || new LastWriteWinsStrategy();
    }

    /**
     * Permite cambiar la estrategia dinámicamente en tiempo de ejecución
     */
    setStrategy(strategy) {
        console.log('[ConflictResolver] Cambiando estrategia a:', strategy.getName());
        this.strategy = strategy;
    }

    /**
     * Delega la resolución del conflicto a la estrategia actual
     */
    resolve(localNote, remoteNote) {
        return this.strategy.resolve(localNote, remoteNote);
    }

    getCurrentStrategyName() {
        return this.strategy.getName();
    }
}

// Exportar las clases para uso en otros módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ConflictResolutionStrategy,
        LastWriteWinsStrategy,
        FirstWriteWinsStrategy,
        VersionBasedStrategy,
        ContentMergeStrategy,
        AuthorPriorityStrategy,
        ConflictResolver
    };
}
