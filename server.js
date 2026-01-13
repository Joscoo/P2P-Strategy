const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const os = require('os');

// Servir archivos estáticos
app.use(express.static('public'));

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Lista de pares conectados
const peers = new Map();

io.on('connection', (socket) => {
  const timestamp = new Date().toLocaleTimeString();
  console.log('\n========================================');
  console.log(`[${timestamp}] 🟢 NUEVA CONEXIÓN`);
  console.log('========================================');
  console.log('Socket ID:', socket.id);
  console.log('IP del cliente:', socket.handshake.address);
  console.log('User Agent:', socket.handshake.headers['user-agent']);
  
  // Registrar el peer
  peers.set(socket.id, socket);
  
  console.log('Total de peers conectados:', peers.size);
  console.log('========================================\n');
  
  // Informar al nuevo peer sobre todos los peers existentes
  const existingPeers = Array.from(peers.keys()).filter(id => id !== socket.id);
  socket.emit('peer-list', existingPeers);
  console.log(`[INFO] Enviando lista de ${existingPeers.length} peer(s) existentes a ${socket.id}`);
  
  // Notificar a otros peers sobre el nuevo peer
  socket.broadcast.emit('peer-joined', socket.id);
  console.log(`[INFO] Notificando a ${peers.size - 1} peer(s) sobre nuevo peer ${socket.id}\n`);
  
  // Manejo de señales WebRTC (ICE candidates, offers, answers)
  socket.on('signal', (data) => {
    const targetSocket = peers.get(data.to);
    if (targetSocket) {
      targetSocket.emit('signal', {
        from: socket.id,
        signal: data.signal
      });
      
      const signalType = data.signal.type || 'unknown';
      console.log(`[SIGNAL] ${socket.id} → ${data.to} (${signalType})`);
    } else {
      console.warn(`[WARN] Peer destino ${data.to} no encontrado para señal de ${socket.id}`);
    }
  });
  
  // Desconexión
  socket.on('disconnect', () => {
    const disconnectTime = new Date().toLocaleTimeString();
    console.log('\n========================================');
    console.log(`[${disconnectTime}] 🔴 DESCONEXIÓN`);
    console.log('========================================');
    console.log('Socket ID:', socket.id);
    peers.delete(socket.id);
    console.log('Peers restantes:', peers.size);
    console.log('========================================\n');
    
    socket.broadcast.emit('peer-left', socket.id);
  });
});

const PORT = process.env.PORT || 3000;

// Función para obtener la IP local
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Buscar IPv4 no interna
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

http.listen(PORT, () => {
  const localIP = getLocalIP();
  console.log('\n=================================================');
  console.log('🚀 P2P Notes - Bloc colaborativo descentralizado');
  console.log('=================================================');
  console.log(`\n📍 Servidor de señalización iniciado\n`);
  console.log(`   🏠 Local:    http://localhost:${PORT}`);
  console.log(`   🌐 Red:      http://${localIP}:${PORT}`);
  console.log('\n💡 Para conectarte desde otro dispositivo:');
  console.log(`   Usa esta URL: http://${localIP}:${PORT}`);
  console.log('\n🌍 NGROK - Acceso desde Internet:');
  console.log('   Si estás usando ngrok, tu URL pública es:');
  console.log('   👉 Revisa la consola de ngrok para obtener la URL');
  console.log('   👉 Ejemplo: https://xxxx-xxx-xxx-xxx-xxx.ngrok-free.app');
  console.log('\n📊 Estado del servidor:');
  console.log(`   ✅ Escuchando en el puerto ${PORT}`);
  console.log(`   📡 WebSocket listo para conexiones P2P`);
  console.log(`   🔗 Peers conectados: 0`);
  console.log('\n=================================================\n');
});
