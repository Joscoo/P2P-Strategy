"# P2P-Strategy

Sistema de notas colaborativas P2P con implementación del Patrón Strategy para resolución de conflictos, almacenamiento y broadcasting.

## 🚀 Características

- **Conexión P2P**: WebRTC para comunicación directa entre peers
- **Sincronización en tiempo real**: Notas compartidas automáticamente
- **Panel de Peers**: Visualiza todos los peers conectados con su estado
- **Estrategias configurables**: 
  - Resolución de conflictos (5 estrategias)
  - Almacenamiento (4 estrategias)
  - Broadcasting (5 estrategias)

## 📦 Instalación

```bash
npm install
```

## 🏃 Ejecutar Localmente

```bash
npm start
```

Abre `http://localhost:3000` en tu navegador.

## 🌍 Acceso Remoto con ngrok

Para acceder desde otra red (otra casa, celular con datos móviles, etc.):

### 1. Instalar ngrok

Descarga desde: https://ngrok.com/download

O con npm:
```bash
npm install -g ngrok
```

### 2. Iniciar el servidor

```bash
npm start
```

### 3. En otra terminal, ejecutar ngrok

```bash
ngrok http 3000
```

### 4. Copiar la URL pública

ngrok mostrará algo como:
```
Forwarding    https://xxxx-xxx-xxx-xxx.ngrok-free.app -> http://localhost:3000
```

### 5. Abrir en cualquier dispositivo

Abre esa URL (`https://xxxx-xxx-xxx-xxx.ngrok-free.app`) en cualquier navegador, desde cualquier red.

## 👥 Ver Peers Conectados

1. Haz clic en el botón verde flotante (👥) en la esquina inferior derecha
2. Verás:
   - Total de peers conectados
   - Estado de cada conexión (Conectado/Desconectado)
   - Detalles técnicos (WebRTC, DataChannel, ICE)
3. Usa "Probar Sincronización" para forzar envío de notas

## 🔍 Debugging - Por qué no se ven las notas

Abre la consola del navegador (F12) y busca estos logs:

### Cuando creas una nota:
```
📝 CREANDO NUEVA NOTA
[BROADCAST] Estrategia: Broadcast-All
[BROADCAST] Resultado: X enviados, Y fallos
```

### Cuando otro peer crea una nota:
```
📩 NOTA CREADA REMOTAMENTE
ID: note_xxx
Título: ...
Estado: Nueva nota agregada
```

### Si NO ves estos logs:
1. **Verifica peers conectados**: Botón 👥 → debe haber al menos 1 peer conectado
2. **Revisa el DataChannel**: Debe estar en estado "open"
3. **Prueba la sincronización**: Botón "Probar Sincronización" en el panel de peers
4. **Logs del servidor**: Busca mensajes de conexión/desconexión

### Problemas comunes:

**❌ No se conectan los peers**
- Ambos dispositivos deben estar en la MISMA URL (mismo servidor ngrok)
- Verifica que ngrok esté corriendo
- Revisa la consola del servidor (debe mostrar 2+ conexiones)

**❌ Se conectan pero no se sincronizan**
- Verifica que el DataChannel esté "open" (panel de peers)
- Mira los logs de broadcast (debe decir "X enviados")
- Prueba crear una nota con la consola abierta (F12)

**❌ ngrok da error o se desconecta**
- ngrok gratis tiene límite de conexiones
- Reinicia ngrok si se cae
- La URL de ngrok cambia cada vez que se reinicia

## 🧪 Pruebas

Haz clic en el botón 🧪 para ejecutar pruebas automáticas de las estrategias.

## 🎯 Patrón Strategy

El proyecto implementa 3 contextos de Strategy:

1. **ConflictResolver**: Decide qué hacer cuando 2 peers editan la misma nota
2. **StorageManager**: Maneja dónde y cómo se guardan las notas
3. **BroadcastManager**: Controla cómo se propagan los cambios

## 📚 Tecnologías

- WebRTC (conexión P2P)
- Socket.IO (señalización)
- Express.js (servidor)
- HTML/CSS/JavaScript vanilla

## 🐛 Logs Detallados

El sistema ahora muestra logs muy detallados en la consola:

- ✅ Conexión de peers (verde)
- 📤 Sincronización de notas
- 📩 Recepción de notas remotas
- 🔴 Desconexiones
- ⚠️ Errores y advertencias

**Siempre abre la consola (F12) para ver qué está pasando.**
" 
