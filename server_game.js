// server.js - Multiplayer game server using Node.js, Express and Socket.IO
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins (for development only)
    methods: ["GET", "POST"], // Allowed HTTP methods
    credentials: true // Optional: allow cookies to be sent
  }
});


let hostSocket = null;

// Handle new connections
io.on('connection', (socket) => {
  
  if (!hostSocket) {
    console.log(`Host connected: ${socket.id}`);
    // First client is the host
    hostSocket = socket;

    hostSocket.emit('setHost', { isHost: true });

    hostSocket.on('gameState', (data) => {
        io.emit('gameState', data);      
    });

    hostSocket.on('playerConnected', (data) => {
        io.emit('playerConnected', data);      
    });
    hostSocket.on('playerDisconnected', (data) => {
    console.log(`Removing Player: ${socket.id}`); 
        io.emit('playerDisconnected', data);      
    });
    hostSocket.on('disconnect', () => {     
    console.log(`Host disconnected: ${socket.id}`); 
      hostSocket = null;
    });
  } else {
  console.log(`Player connected: ${socket.id}`);

    hostSocket?.emit('playerConnected', {
      networkId: socket.id
    });
    
    socket.on('playerInput', (data) => {    
      hostSocket?.emit('playerInput', data);
    });

    socket.on('disconnect', () => {      
    console.log(`Player disconnected: ${socket.id}`); 
      hostSocket?.emit('playerDisconnected', { networkId: socket.id });
    });
  }
});


// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});