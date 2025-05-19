class NetworkManager {
  constructor(gameEngine) {
    this.socket = null;
    this.connected = false;
    this.playerId = null;
    this.players = {}; // Other players
    this.gameEngine = gameEngine; // Reference to your main game engine
    this.pendingObjects = {}; // Objects waiting for server ID
    
    // Server reconciliation
    this.serverState = {};
    this.inputSequence = 0;
    this.pendingInputs = [];
  }
  
  // Connect to the multiplayer server
  connect(serverUrl = window.location.origin) {
    return new Promise((resolve, reject) => {
      try {
        console.log(`Connecting to game server at: ${serverUrl}`);
        
        // Load Socket.IO client from CDN if not already available
        if (!window.io) {
          const script = document.createElement('script');
          script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
          script.onload = () => this.setupConnection(serverUrl, resolve, reject);
          script.onerror = (err) => reject(new Error('Failed to load Socket.IO client'));
          document.head.appendChild(script);
        } else {
          this.setupConnection(serverUrl, resolve, reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  }
  
  setupConnection(serverUrl, resolve, reject) {
    try {
      this.socket = io(serverUrl);
      
      // Handle connection events
      this.socket.on('connect', () => {
        console.log('Connected to game server');
        this.connected = true;
        this.playerId = this.socket.id;
        resolve(this.playerId);
      });
      
      this.socket.on('connect_error', (err) => {
        console.error('Connection error:', err);
        this.connected = false;
        reject(err);
      });
      
      // Set up game-specific event handlers
      this.setupEventHandlers();
      
    } catch (err) {
      console.error('Error setting up connection:', err);
      reject(err);
    }
  }
  
  setupEventHandlers() {
    if (!this.socket) return;
    
    // Initial game state from server
    this.socket.on('gameState', (gameState) => {
      console.log('Received initial game state:', gameState);
      this.serverState = gameState;
      
      // Create other players
      Object.keys(gameState.players).forEach(playerId => {
        if (playerId !== this.playerId) {
          this.addRemotePlayer(playerId, gameState.players[playerId]);
        }
      });
      
      // Create existing objects
      Object.keys(gameState.objects || {}).forEach(objId => {
        this.gameEngine.createObjectFromServer(gameState.objects[objId]);
      });
    });
    
    // New player joined
    this.socket.on('playerJoined', (playerData) => {
      console.log('Player joined:', playerData);
      this.addRemotePlayer(playerData.id, playerData);
    });
    
    // Player left
    this.socket.on('playerLeft', (data) => {
      console.log('Player left:', data.id);
      this.removeRemotePlayer(data.id);
    });
    
    // Player moved
    this.socket.on('playerMoved', (data) => {
      this.updateRemotePlayer(data.id, data);
    });
    
    // Object update from server
    this.socket.on('objectUpdated', (objectData) => {
      this.gameEngine.updateObjectFromServer(objectData);
    });
    
    // New object created
    this.socket.on('newObject', (objectData) => {
      this.gameEngine.createObjectFromServer(objectData);
    });
    
    // Object added confirmation
    this.socket.on('objectAdded', (data) => {
      // Map the client-side temporary ID to the server's permanent ID
      if (this.pendingObjects[data.clientId]) {
        const object = this.pendingObjects[data.clientId];
        delete this.pendingObjects[data.clientId];
        // Update the object with the server ID
        this.gameEngine.updateObjectId(data.clientId, data.serverId);
      }
    });
    
    // Server state update (server-authoritative mode)
    this.socket.on('gameStateUpdate', (update) => {
      // Process server reconciliation
      this.handleServerUpdate(update);
    });
    
    // Handle disconnection
    this.socket.on('disconnect', () => {
      console.log('Disconnected from game server');
      this.connected = false;
      this.gameEngine.handleDisconnect();
    });
  }
  
  // Send player position and rotation to server
  sendPlayerUpdate(position, quaternion, velocity) {
    if (!this.connected) return;
    
    this.socket.emit('playerUpdate', {
      position: position,
      quaternion: quaternion,
      velocity: velocity
    });
  }
  
  // Send player input for server-authoritative physics
  sendPlayerInput(input) {
    if (!this.connected) return;
    
    // Add sequence number for reconciliation
    input.seq = this.inputSequence++;
    
    // Send to server
    this.socket.emit('playerInput', input);
    
    // Save this input for reconciliation
    this.pendingInputs.push(input);
    
    return input.seq;
  }
  
  // Create a new object on the server
  createObject(objectData) {
    if (!this.connected) return null;
    
    // Create a temporary client ID
    const clientId = `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // Store in pending objects
    this.pendingObjects[clientId] = objectData;
    
    // Send to server
    this.socket.emit('addObject', {
      ...objectData,
      clientId: clientId
    });
    
    return clientId;
  }
  
  // Update object state (for objects the client has authority over)
  updateObject(objectId, objectData) {
    if (!this.connected) return;
    
    this.socket.emit('objectUpdate', {
      id: objectId,
      ...objectData
    });
  }
  
  // Add a new remote player
  addRemotePlayer(playerId, playerData) {
    if (this.players[playerId] || playerId === this.playerId) return;
    
    // Create remote player representation
    this.players[playerId] = this.gameEngine.createRemotePlayer(playerId, playerData);
  }
  
  // Remove a remote player
  removeRemotePlayer(playerId) {
    if (!this.players[playerId]) return;
    
    // Remove from scene
    this.gameEngine.removeRemotePlayer(playerId);
    
    // Remove from local cache
    delete this.players[playerId];
  }
  
  // Update remote player position and rotation
  updateRemotePlayer(playerId, playerData) {
    if (!this.players[playerId]) {
      // Player doesn't exist yet, create them
      this.addRemotePlayer(playerId, playerData);
      return;
    }
    
    // Update the player in the game engine
    this.gameEngine.updateRemotePlayer(playerId, playerData);
  }
  
  // Handle server state update (for server-authoritative mode)
  handleServerUpdate(update) {
    // Update server state
    this.serverState = update;
    
    // Server reconciliation for player character
    if (update.players[this.playerId] && this.gameEngine.localPlayer) {
      const serverPos = update.players[this.playerId].position;
      const serverVel = update.players[this.playerId].velocity;
      
      // Find the last input that the server processed
      const lastProcessedInput = update.players[this.playerId].lastProcessedInput;
      
      // Remove older inputs
      if (lastProcessedInput !== undefined) {
        this.pendingInputs = this.pendingInputs.filter(input => input.seq > lastProcessedInput);
      }
      
      // Check if we need to reconcile
      const localPos = this.gameEngine.getLocalPlayerPosition();
      const posDiff = {
        x: serverPos.x - localPos.x,
        y: serverPos.y - localPos.y,
        z: serverPos.z - localPos.z
      };
      
      const distSquared = posDiff.x * posDiff.x + posDiff.y * posDiff.y + posDiff.z * posDiff.z;
      
      // If difference is too large, reconcile
      if (distSquared > 1) { // Threshold distance (1 unit squared)
        // Reset to server position
        this.gameEngine.reconcileLocalPlayer(serverPos, serverVel);
        
        // Reapply all pending inputs
        this.pendingInputs.forEach(input => {
          this.gameEngine.applyInput(input);
        });
      }
    }
    
    // Update other players
    Object.keys(update.players).forEach(playerId => {
      if (playerId !== this.playerId) {
        this.updateRemotePlayer(playerId, update.players[playerId]);
      }
    });
  }
  
  // Disconnect from server
  disconnect() {
    if (this.socket && this.connected) {
      this.socket.disconnect();
      this.connected = false;
    }
  }
}