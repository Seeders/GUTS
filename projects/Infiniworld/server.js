// server.js - Multiplayer game server using Node.js, Express and Socket.IO
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Store game state
const gameState = {
  players: {},
  objects: {}
};

// Physics update rate (Hz)
const PHYSICS_RATE = 60;
let lastUpdateTime = Date.now();

// Handle new connections
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  
  // Create new player
  gameState.players[socket.id] = {
    id: socket.id,
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    lastUpdate: Date.now()
  };
  
  // Send current game state to the new player
  socket.emit('gameState', gameState);
  
  // Notify everyone about the new player
  socket.broadcast.emit('playerJoined', {
    id: socket.id,
    position: gameState.players[socket.id].position,
    quaternion: gameState.players[socket.id].quaternion
  });
  
  // Player updates their position and rotation
  socket.on('playerUpdate', (data) => {
    if (gameState.players[socket.id]) {
      // Update player state
      gameState.players[socket.id].position = data.position;
      gameState.players[socket.id].quaternion = data.quaternion;
      gameState.players[socket.id].velocity = data.velocity || gameState.players[socket.id].velocity;
      gameState.players[socket.id].lastUpdate = Date.now();
      
      // Broadcast to all other players
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        position: data.position,
        quaternion: data.quaternion,
        velocity: data.velocity
      });
    }
  });
  
  // Player interacts with physics objects
  socket.on('objectUpdate', (data) => {
    // Update object in game state
    gameState.objects[data.id] = {
      ...gameState.objects[data.id],
      ...data,
      lastUpdate: Date.now()
    };
    
    // Broadcast object update to all other players
    socket.broadcast.emit('objectUpdated', data);
  });
  
  // Player adds a new physics object
  socket.on('addObject', (data) => {
    // Add object to game state with a unique ID
    const objectId = `obj_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    gameState.objects[objectId] = {
      id: objectId,
      ...data,
      createdBy: socket.id,
      lastUpdate: Date.now()
    };
    
    // Send the new object ID to the creator
    socket.emit('objectAdded', {
      clientId: data.clientId, // If the client needs to map their temporary ID
      serverId: objectId
    });
    
    // Broadcast new object to all players
    io.emit('newObject', gameState.objects[objectId]);
  });
  
  // Handle player disconnection
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    // Remove player from game state
    delete gameState.players[socket.id];
    // Notify all other players
    socket.broadcast.emit('playerLeft', { id: socket.id });
    
    // Optionally remove objects created by this player
    // or transfer ownership to the server
  });
  
  // Handle player input for authoritative server
  socket.on('playerInput', (input) => {
    // Store or immediately process player input
    if (gameState.players[socket.id]) {
      gameState.players[socket.id].input = input;
    }
  });
});

// Game loop for server-authoritative physics (if needed)
function gameLoop() {
  const now = Date.now();
  const dt = (now - lastUpdateTime) / 1000;
  lastUpdateTime = now;
  
  // Update server-side physics here if using authoritative server model
  // This would use Rapier.js on the server side too
  
  // Broadcast entire game state periodically (reduced frequency)
  if (now % 100 < 16) { // ~6 times per second instead of 60fps
    io.emit('gameStateUpdate', {
      players: gameState.players,
      timestamp: now
    });
  }
  
  // Clean up stale objects and disconnected players
  cleanupStaleEntities();
  
  setTimeout(gameLoop, 1000 / PHYSICS_RATE);
}

// Remove players who haven't updated in a while
function cleanupStaleEntities() {
  const now = Date.now();
  const timeoutThreshold = 10000; // 10 seconds
  
  // Check for stale players
  Object.keys(gameState.players).forEach(playerId => {
    if (now - gameState.players[playerId].lastUpdate > timeoutThreshold) {
      console.log(`Removing stale player: ${playerId}`);
      delete gameState.players[playerId];
      io.emit('playerLeft', { id: playerId });
    }
  });
}

// Start the game loop
gameLoop();

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});