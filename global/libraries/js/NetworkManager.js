class NetworkManager {
  constructor(multiplayerManager) {
    this.socket = null;
    this.connected = false;
    this.playerId = null;
    this.players = {}; // Other players
    this.multiplayerManager = multiplayerManager; // Reference to your main game engine
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

    this.socket.on('setHost', (data) => {
      console.log('Setting host:', data);
      this.isHost = data.isHost;  
      this.multiplayerManager.setHost(this.isHost);
    });
   
    // New player joined
    this.socket.on('playerConnected', (playerData) => {
      
      if(!this.players[playerData.networkId]){
        this.addRemotePlayer(playerData);
        console.log('Player joined:', playerData);

      }
    });
    
    // Player left
    this.socket.on('playerDisconnected', (data) => {
      let player = this.players[data.networkId];
      if(player){
        console.log('Player left:', data.networkId);
        this.removeRemotePlayer(data.networkId);
        if(this.isHost){
          this.socket.emit('playerDisconnected', data);
        }
      }
    });
    
    // Player moved
    this.socket.on('playerInput', (data) => {
      if(data.networkId && this.isHost){
        let player = this.players[data.networkId];
        if(player){
          player.setNetworkComponentData(data, true);                 
        }
      }

    });
    
    // Object update from server
    this.socket.on('objectUpdated', (objectData) => {
      this.multiplayerManager.updateObjectFromServer(objectData);
    });
    
    // New object created
    this.socket.on('newObject', (objectData) => {
      this.multiplayerManager.createObjectFromServer(objectData);
    });
    
    // Object added confirmation
    this.socket.on('objectAdded', (data) => {
      // Map the client-side temporary ID to the server's permanent ID
      if (this.pendingObjects[data.clientId]) {
        const object = this.pendingObjects[data.clientId];
        delete this.pendingObjects[data.clientId];
        // Update the object with the server ID
        this.multiplayerManager.updateObjectId(data.clientId, data.serverId);
      }
    });
    
    // Server state update (server-authoritative mode)
    this.socket.on('gameState', (update) => {
      // Process server reconciliation
      if(!this.isHost){
        this.serverState = update;
        update.players.forEach((playerData) => {
          if(!this.players[playerData.networkId]){
            this.addRemotePlayer(playerData);
          }
          // Server reconciliation for player character             
          this.multiplayerManager.updatePlayer(playerData);       
        });
      }
    });
    
    // Handle disconnection
    this.socket.on('disconnect', () => {
      console.log('Disconnected from game server');
      this.connected = false;
      this.multiplayerManager.handleDisconnect();
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
  sendPlayerInput(playerData) {
    if (!this.connected) return;
    
    // Add sequence number for reconciliation
    playerData.seq = this.inputSequence++;

    // Send to server
    this.socket.emit('playerInput', {networkId: this.playerId, ...playerData});
    
    // Save this input for reconciliation
    this.pendingInputs.push(playerData);
    
    return playerData.seq;
  }
    // Send player input for server-authoritative physics
  sendGameState(data) {
    if (!this.connected || !this.isHost) return;
    

    // Send to server
    this.socket.emit('gameState', data);    
    
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
  addRemotePlayer(data) {
    if (this.players[data.networkId] || data.networkId === this.playerId) return;
    
    // Create remote player representation
    this.players[data.networkId] = this.multiplayerManager.createRemotePlayer(data);
  }
  
  // Remove a remote player
  removeRemotePlayer(playerId) {
    if (!this.players[playerId]) return;
    
    // Remove from scene
    this.multiplayerManager.removeRemotePlayer(playerId);
    
    // Remove from local cache
    delete this.players[playerId];
  }
  
  // Update remote player position and rotation
  updateRemotePlayer(playerData) {
    // Update the player in the game engine
    this.multiplayerManager.updateRemotePlayer(playerData);
  }
  
 
  // Disconnect from server
  disconnect() {
    if (this.socket && this.connected) {
      this.socket.disconnect();
      this.connected = false;
    }
  }
}