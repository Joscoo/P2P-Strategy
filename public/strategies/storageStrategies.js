// PATRÓN STRATEGY - Estrategias de Almacenamiento
// Permite cambiar dinámicamente el mecanismo de persistencia de datos

/**
 * Interfaz Strategy: StorageStrategy
 * Define el contrato que todas las estrategias de almacenamiento deben cumplir
 */
class StorageStrategy {
    /**
     * @param {string} key - Clave para almacenar los datos
     * @param {any} data - Datos a almacenar
     */
    save(key, data) {
        throw new Error('El método save() debe ser implementado');
    }

    /**
     * @param {string} key - Clave de los datos a recuperar
     * @returns {any} Los datos almacenados o null si no existen
     */
    load(key) {
        throw new Error('El método load() debe ser implementado');
    }

    /**
     * @param {string} key - Clave de los datos a eliminar
     */
    remove(key) {
        throw new Error('El método remove() debe ser implementado');
    }

    /**
     * Limpia todo el almacenamiento
     */
    clear() {
        throw new Error('El método clear() debe ser implementado');
    }

    /**
     * Retorna el nombre de la estrategia
     */
    getName() {
        throw new Error('El método getName() debe ser implementado');
    }

    /**
     * Retorna información sobre el espacio disponible
     */
    getStorageInfo() {
        throw new Error('El método getStorageInfo() debe ser implementado');
    }
}

/**
 * Estrategia Concreta: LocalStorage
 * Almacenamiento persistente que sobrevive al cierre del navegador
 * Ventaja: Persistencia permanente
 * Desventaja: Límite de ~5-10 MB, síncrono
 */
class LocalStorageStrategy extends StorageStrategy {
    save(key, data) {
        try {
            const serialized = JSON.stringify(data);
            localStorage.setItem(key, serialized);
            console.log(`[LocalStorage] Guardado: ${key} (${serialized.length} bytes)`);
            return true;
        } catch (error) {
            console.error('[LocalStorage] Error al guardar:', error);
            if (error.name === 'QuotaExceededError') {
                console.error('[LocalStorage] Cuota excedida. Considera usar IndexedDB.');
            }
            return false;
        }
    }

    load(key) {
        try {
            const serialized = localStorage.getItem(key);
            if (!serialized) return null;
            
            const data = JSON.parse(serialized);
            console.log(`[LocalStorage] Cargado: ${key}`);
            return data;
        } catch (error) {
            console.error('[LocalStorage] Error al cargar:', error);
            return null;
        }
    }

    remove(key) {
        try {
            localStorage.removeItem(key);
            console.log(`[LocalStorage] Eliminado: ${key}`);
            return true;
        } catch (error) {
            console.error('[LocalStorage] Error al eliminar:', error);
            return false;
        }
    }

    clear() {
        try {
            localStorage.clear();
            console.log('[LocalStorage] Almacenamiento limpiado');
            return true;
        } catch (error) {
            console.error('[LocalStorage] Error al limpiar:', error);
            return false;
        }
    }

    getName() {
        return 'LocalStorage (Persistente)';
    }

    getStorageInfo() {
        try {
            // Estima el uso de almacenamiento
            let totalSize = 0;
            for (let key in localStorage) {
                if (localStorage.hasOwnProperty(key)) {
                    totalSize += localStorage[key].length + key.length;
                }
            }

            return {
                used: totalSize,
                usedFormatted: this.formatBytes(totalSize),
                limit: '~5-10 MB',
                persistent: true
            };
        } catch (error) {
            return {
                used: 0,
                usedFormatted: '0 bytes',
                limit: 'Desconocido',
                persistent: true
            };
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}

/**
 * Estrategia Concreta: SessionStorage
 * Almacenamiento temporal que se borra al cerrar la pestaña
 * Ventaja: Aislamiento por pestaña, mismo límite que localStorage
 * Desventaja: No persiste al cerrar la pestaña
 */
class SessionStorageStrategy extends StorageStrategy {
    save(key, data) {
        try {
            const serialized = JSON.stringify(data);
            sessionStorage.setItem(key, serialized);
            console.log(`[SessionStorage] Guardado: ${key} (${serialized.length} bytes)`);
            return true;
        } catch (error) {
            console.error('[SessionStorage] Error al guardar:', error);
            return false;
        }
    }

    load(key) {
        try {
            const serialized = sessionStorage.getItem(key);
            if (!serialized) return null;
            
            const data = JSON.parse(serialized);
            console.log(`[SessionStorage] Cargado: ${key}`);
            return data;
        } catch (error) {
            console.error('[SessionStorage] Error al cargar:', error);
            return null;
        }
    }

    remove(key) {
        try {
            sessionStorage.removeItem(key);
            console.log(`[SessionStorage] Eliminado: ${key}`);
            return true;
        } catch (error) {
            console.error('[SessionStorage] Error al eliminar:', error);
            return false;
        }
    }

    clear() {
        try {
            sessionStorage.clear();
            console.log('[SessionStorage] Almacenamiento limpiado');
            return true;
        } catch (error) {
            console.error('[SessionStorage] Error al limpiar:', error);
            return false;
        }
    }

    getName() {
        return 'SessionStorage (Temporal)';
    }

    getStorageInfo() {
        try {
            let totalSize = 0;
            for (let key in sessionStorage) {
                if (sessionStorage.hasOwnProperty(key)) {
                    totalSize += sessionStorage[key].length + key.length;
                }
            }

            return {
                used: totalSize,
                usedFormatted: this.formatBytes(totalSize),
                limit: '~5-10 MB',
                persistent: false
            };
        } catch (error) {
            return {
                used: 0,
                usedFormatted: '0 bytes',
                limit: 'Desconocido',
                persistent: false
            };
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}

/**
 * Estrategia Concreta: InMemory
 * Almacenamiento en memoria RAM sin persistencia
 * Ventaja: Muy rápido, sin límites prácticos
 * Desventaja: Se pierde al recargar la página
 */
class InMemoryStorageStrategy extends StorageStrategy {
    constructor() {
        super();
        this.storage = new Map();
    }

    save(key, data) {
        try {
            // Clona los datos para evitar referencias compartidas
            const clonedData = JSON.parse(JSON.stringify(data));
            this.storage.set(key, clonedData);
            console.log(`[InMemory] Guardado: ${key}`);
            return true;
        } catch (error) {
            console.error('[InMemory] Error al guardar:', error);
            return false;
        }
    }

    load(key) {
        try {
            if (!this.storage.has(key)) return null;
            
            // Retorna una copia para evitar mutaciones
            const data = this.storage.get(key);
            console.log(`[InMemory] Cargado: ${key}`);
            return JSON.parse(JSON.stringify(data));
        } catch (error) {
            console.error('[InMemory] Error al cargar:', error);
            return null;
        }
    }

    remove(key) {
        try {
            this.storage.delete(key);
            console.log(`[InMemory] Eliminado: ${key}`);
            return true;
        } catch (error) {
            console.error('[InMemory] Error al eliminar:', error);
            return false;
        }
    }

    clear() {
        try {
            this.storage.clear();
            console.log('[InMemory] Almacenamiento limpiado');
            return true;
        } catch (error) {
            console.error('[InMemory] Error al limpiar:', error);
            return false;
        }
    }

    getName() {
        return 'InMemory (Solo RAM)';
    }

    getStorageInfo() {
        try {
            // Estima el tamaño en memoria
            let totalSize = 0;
            this.storage.forEach((value, key) => {
                const serialized = JSON.stringify(value);
                totalSize += serialized.length + key.length;
            });

            return {
                used: totalSize,
                usedFormatted: this.formatBytes(totalSize),
                limit: 'RAM disponible',
                persistent: false,
                items: this.storage.size
            };
        } catch (error) {
            return {
                used: 0,
                usedFormatted: '0 bytes',
                limit: 'Desconocido',
                persistent: false,
                items: 0
            };
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}

/**
 * Estrategia Concreta: IndexedDB Storage
 * Base de datos NoSQL en el navegador con mayor capacidad
 * Ventaja: Gran capacidad (~50% del disco duro), asíncrono, transaccional
 * Desventaja: API más compleja, asíncrono
 */
class IndexedDBStorageStrategy extends StorageStrategy {
    constructor(dbName = 'P2PNotesDB', storeName = 'notes') {
        super();
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
        });
    }

    async save(key, data) {
        try {
            if (!this.db) await this.initDB();

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.put(data, key);

                request.onsuccess = () => {
                    console.log(`[IndexedDB] Guardado: ${key}`);
                    resolve(true);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('[IndexedDB] Error al guardar:', error);
            return false;
        }
    }

    async load(key) {
        try {
            if (!this.db) await this.initDB();

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.get(key);

                request.onsuccess = () => {
                    console.log(`[IndexedDB] Cargado: ${key}`);
                    resolve(request.result || null);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('[IndexedDB] Error al cargar:', error);
            return null;
        }
    }

    async remove(key) {
        try {
            if (!this.db) await this.initDB();

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.delete(key);

                request.onsuccess = () => {
                    console.log(`[IndexedDB] Eliminado: ${key}`);
                    resolve(true);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('[IndexedDB] Error al eliminar:', error);
            return false;
        }
    }

    async clear() {
        try {
            if (!this.db) await this.initDB();

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.clear();

                request.onsuccess = () => {
                    console.log('[IndexedDB] Almacenamiento limpiado');
                    resolve(true);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('[IndexedDB] Error al limpiar:', error);
            return false;
        }
    }

    getName() {
        return 'IndexedDB (Gran capacidad)';
    }

    async getStorageInfo() {
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const estimate = await navigator.storage.estimate();
                return {
                    used: estimate.usage,
                    usedFormatted: this.formatBytes(estimate.usage),
                    quota: estimate.quota,
                    quotaFormatted: this.formatBytes(estimate.quota),
                    limit: 'Variable (~50% disco)',
                    persistent: true
                };
            }
            return {
                limit: 'Variable (~50% disco)',
                persistent: true
            };
        } catch (error) {
            return {
                limit: 'Desconocido',
                persistent: true
            };
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }
}

/**
 * Context: StorageManager
 * Mantiene una referencia a la estrategia actual y delega las operaciones de almacenamiento
 */
class StorageManager {
    constructor(strategy = null) {
        this.strategy = strategy || new LocalStorageStrategy();
    }

    /**
     * Permite cambiar la estrategia dinámicamente en tiempo de ejecución
     */
    setStrategy(strategy) {
        console.log('[StorageManager] Cambiando estrategia a:', strategy.getName());
        this.strategy = strategy;
    }

    /**
     * Delega las operaciones a la estrategia actual
     */
    save(key, data) {
        return this.strategy.save(key, data);
    }

    load(key) {
        return this.strategy.load(key);
    }

    remove(key) {
        return this.strategy.remove(key);
    }

    clear() {
        return this.strategy.clear();
    }

    getCurrentStrategyName() {
        return this.strategy.getName();
    }

    async getStorageInfo() {
        return await this.strategy.getStorageInfo();
    }
}

// Exportar las clases para uso en otros módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        StorageStrategy,
        LocalStorageStrategy,
        SessionStorageStrategy,
        InMemoryStorageStrategy,
        IndexedDBStorageStrategy,
        StorageManager
    };
}
