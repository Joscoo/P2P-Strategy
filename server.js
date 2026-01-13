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
  console.log('[CONEXION] Nuevo peer conectado:', socket.id);
  
  // Registrar el peer
  peers.set(socket.id, socket);
  
  // Informar al nuevo peer sobre todos los peers existentes
  socket.emit('peer-list', Array.from(peers.keys()).filter(id => id !== socket.id));
  
  // Notificar a otros peers sobre el nuevo peer
  socket.broadcast.emit('peer-joined', socket.id);
  
  // Manejo de señales WebRTC (ICE candidates, offers, answers)
  socket.on('signal', (data) => {
    const targetSocket = peers.get(data.to);
    if (targetSocket) {
      targetSocket.emit('signal', {
        from: socket.id,
        signal: data.signal
      });
    }
  });
  
  // Desconexión
  socket.on('disconnect', () => {
    console.log('[DESCONEXION] Peer desconectado:', socket.id);
    peers.delete(socket.id);
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
  console.log('\n=================================================\n');
});
