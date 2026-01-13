# 🔍 Diagnóstico de Problemas de Conexión P2P

## Mejoras Aplicadas

### ✅ Servidores ICE Mejorados
- **5 servidores STUN** de Google (alta disponibilidad)
- **2 servidores TURN** públicos (para NATs restrictivos)
- `iceCandidatePoolSize: 10` para mejor recolección de candidatos

### ✅ Logging Mejorado
- Estados de conexión con emojis visuales
- Diagnóstico de fallos ICE
- Monitoreo de estados: connectionState, iceConnectionState, iceGatheringState

---

## 📋 Checklist de Diagnóstico

### 1. **Verifica que el servidor esté corriendo**
```powershell
npm start
```
- Debe mostrar: `Servidor corriendo en http://localhost:3000`

### 2. **Accede desde diferentes dispositivos**
**Dispositivo 1 (host):**
- Abre: `http://localhost:3000`

**Dispositivo 2 (mismo WiFi):**
- Encuentra tu IP local:
  ```powershell
  ipconfig
  # Busca "Dirección IPv4" de tu adaptador WiFi
  ```
- Abre: `http://<TU-IP-LOCAL>:3000` (ejemplo: `http://192.168.1.10:3000`)

**Dispositivo 3 (internet externo - con ngrok):**
```powershell
ngrok http 3000
```
- Usa la URL que te da ngrok (ejemplo: `https://abc123.ngrok.io`)

### 3. **Abre la Consola del Navegador (F12)**

En cada dispositivo, abre las herramientas de desarrollador:
- **Chrome/Edge**: F12 → pestaña "Console"
- **Firefox**: F12 → pestaña "Console"
- **Safari**: Cmd+Option+C

### 4. **Busca estos mensajes**

#### ✅ Conexión Exitosa:
```
[WebRTC] Conectando con: <peer-id>
[ICE] Gathering con <peer-id>: gathering
[ICE] Recolección completa con <peer-id>
✅ [ICE] ICE conectado con <peer-id>
✅ [ÉXITO] Conectado exitosamente con <peer-id>
```

#### ❌ Problemas Comunes:

**Error 1: ICE Failed**
```
❌ [ICE] Conexión ICE FALLIDA con <peer-id> - Verifica firewalls/NAT
```
**Solución:**
- Firewall bloqueando WebRTC
- NAT muy restrictivo
- Servidor TURN no disponible
- Verifica configuración de red

**Error 2: Connection Failed**
```
❌ [ERROR] Conexión FALLIDA con <peer-id>
```
**Solución:**
- Peer desconectado
- Timeout de conexión
- Intenta refrescar ambas páginas

**Error 3: No aparecen peers**
```
[INFO] Enviando lista de 0 peer(s) existentes
```
**Solución:**
- Solo un dispositivo conectado
- El otro dispositivo no llegó al servidor
- Verifica que ambos usen la misma URL

---

## 🛠️ Soluciones Paso a Paso

### Problema: "Los peers no aparecen en la lista"

1. **Verifica que ambos dispositivos estén conectados al servidor:**
   - En consola debe aparecer: `Socket ID: <id>` en ambos
   
2. **Verifica el panel de peers:**
   - Click en el botón `👥` (arriba a la derecha)
   - Debe mostrar al menos 1 peer si hay otro conectado

3. **Intenta sincronización manual:**
   - Panel Peers → botón "🔄 Probar Sincronización"

### Problema: "Los peers aparecen pero no se conectan"

1. **Verifica los logs ICE en consola:**
   ```
   [ICE] Connection State con <peer>: checking
   [ICE] Connection State con <peer>: connected  ← Debe llegar aquí
   ```

2. **Si se queda en "checking" por más de 30 segundos:**
   - Firewall bloqueando puertos
   - Ambos dispositivos detrás de NAT simétrico
   - Servidor TURN no respondiendo

3. **Soluciones:**
   - Desactiva temporalmente el firewall para probar
   - Usa la misma red WiFi (evita datos móviles)
   - Prueba con ngrok (ya incluye HTTPS)

### Problema: "Se conectan pero no sincronizan notas"

1. **Verifica el DataChannel en consola:**
   ```
   [WebRTC] DataChannel abierto con <peer>
   ```

2. **Crea una nota de prueba y busca:**
   ```
   [SYNC] Enviando nota a <peer>
   [SYNC] Nota recibida de <peer>
   ```

3. **Si no aparece:**
   - Verifica que `app.showToast` se muestre
   - Panel de Estrategias → verifica broadcast: "Broadcast-All"

---

## 🔧 Comandos Útiles

### Ver IP local:
```powershell
ipconfig | findstr IPv4
```

### Probar conectividad:
```powershell
# Desde dispositivo 2, verifica que llegues al servidor
curl http://<IP-DISPOSITIVO-1>:3000
```

### Reiniciar servidor limpiamente:
```powershell
# Detener todos los procesos node
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# Limpiar puerto si está ocupado
netstat -ano | findstr :3000

# Reiniciar
npm start
```

---

## 📱 Configuración Recomendada para Pruebas

### Escenario 1: Mismo WiFi (más fácil)
- **Dispositivo 1**: `http://localhost:3000`
- **Dispositivo 2**: `http://192.168.X.X:3000`
- ✅ Baja latencia, sin NAT complejo

### Escenario 2: Redes diferentes con ngrok
- **Ambos dispositivos**: `https://abc123.ngrok.io`
- ⚠️ Mayor latencia, requiere servidores TURN

### Escenario 3: Móvil + PC
- **PC**: Corre servidor, obtén IP con `ipconfig`
- **Móvil**: Conéctate al mismo WiFi, abre `http://IP-PC:3000`
- ✅ Funciona bien si ambos están en misma red

---

## 🐛 Debugging Avanzado

### Ver todos los ICE candidates:
Pega en consola del navegador:
```javascript
// Ver candidatos recolectados
app.peers.forEach((peer, id) => {
    console.log(`Peer ${id}:`, peer.pc.iceConnectionState);
});
```

### Forzar sincronización:
```javascript
// Sincronizar con un peer específico
app.testSyncWithPeers();
```

### Ver estrategias activas:
```javascript
console.log('Conflict:', app.conflictResolver.getCurrentStrategyName());
console.log('Storage:', app.storageManager.getCurrentStrategyName());
console.log('Broadcast:', app.broadcastManager.getCurrentStrategyName());
```

---

## ✅ Confirmación de Conexión Exitosa

Cuando todo funciona correctamente verás:

1. **En la consola:**
   ```
   ✅ [ÉXITO] Conectado exitosamente con <peer-id>
   [WebRTC] DataChannel abierto con <peer-id>
   ```

2. **En el panel de Peers:**
   - Estado: `✅ Conectado`
   - ICE: `connected`
   - DataChannel: `open`

3. **Al crear una nota:**
   - Toast notification: "Nota creada"
   - La nota aparece en todos los peers conectados

---

## 🆘 Si nada funciona

1. **Limpia caché del navegador:** Ctrl+Shift+Delete
2. **Prueba modo incógnito**
3. **Verifica que WebRTC esté habilitado:**
   - Chrome: `chrome://flags` → busca "WebRTC"
   - Firefox: `about:config` → `media.peerconnection.enabled`
4. **Actualiza navegador a última versión**
5. **Intenta desde otro navegador** (Chrome recomendado)

---

## 📞 Contacto

Si sigues con problemas, incluye en tu reporte:
- Sistema operativo de cada dispositivo
- Navegador y versión
- Logs de la consola (primeros 50 líneas)
- Configuración de red (mismo WiFi, redes diferentes, etc.)
