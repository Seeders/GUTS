class MultiplayerManager extends engine.Component {
  init({scene, physics, serverUrl}) {
    this.scene = scene;            // Three.js scene
    this.physics = physics;            // Rapier world
    this.localPlayer = null;       // Local player object
    this.remotePlayers = {};       // Other players
    this.networkObjects = {};      // Networked physics objects
    this.isServer = false;
    // Create network manager
    this.serverUrl = serverUrl;
    // Interpolation settings
    this.interpolationDelay = 100; // ms    
  }
  
  // Initialize networking
  async initializeMultiplayer() {
    try {
      this.network = new (this.game.libraryClasses.NetworkManager)(this);
      const networkId = await this.network.connect(this.serverUrl);
      console.log(`Multiplayer initialized with player ID: ${networkId}`);
      return networkId;
    } catch (err) {
      console.error('Failed to initialize multiplayer:', err);
      throw err;
    }
  }

  setHost(isHost){
    this.isServer = isHost;
    this.game.isServer = this.isServer;
    if(this.game.isServer){            
        this.game.player.getComponent("PlayerController").setupPhysics(this.physics.simulation);
    }
  }
  
  // Update called from your game loop
  update() {
    // Update local player position on network
      this.updatePlayers();  
    if (!this.game.isServer) {    
      if(this.localPlayer){  
        this.network.sendPlayerInput({ components: this.localPlayer.getNetworkComponentData() });          
      }
      // Interpolate remote players
    } else {
      let data = {
        players: []
      };
      Object.keys(this.remotePlayers).forEach((networkId) => {
        let entity = this.remotePlayers[networkId];
        let componentData = entity.getNetworkComponentData();
        data.players.push({
          networkId: networkId,
          components: {
            ...componentData
          }
        });
      });
      this.network.sendGameState(data);
    }   
  }
    // Update remote player
  updatePlayer(playerData) {
    let player = this.remotePlayers[playerData.networkId];
    let isRemote = true;
    if (!player && this.localPlayer && this.localPlayer.networkId == playerData.networkId) {
      player = this.localPlayer;
      isRemote = false;
    };

    if(!player) return;
    player.setNetworkComponentData(playerData, isRemote);
  }
  
  // Update remote players with interpolation
  updatePlayers() {
    if (this.localPlayer.transform.networkPosition) {
      // Position interpolation
      this.localPlayer.transform.position.lerp(this.localPlayer.transform.networkPosition, 0.2);
    }
    if(this.localPlayer.transform.networkQuaternion){
      // Rotation interpolation
      this.localPlayer.transform.quaternion.slerp(this.localPlayer.transform.networkQuaternion, 0.2);
    }
    Object.keys(this.remotePlayers).forEach(networkId => {
      const player = this.remotePlayers[networkId];
      
      if (player.transform.networkPosition) {
        // Position interpolation
        player.transform.position.lerp(player.transform.networkPosition, 0.2);
      }
      if(player.transform.networkQuaternion){
        // Rotation interpolation
        player.transform.quaternion.slerp(player.transform.networkQuaternion, 0.2);
      }
    });
  }
  
  // Create local player
  createLocalPlayer(networkId, entity) {
    this.localPlayer = entity;
    this.localPlayer.networkId = networkId;
    entity.transform.networkPosition = entity.transform.position;
    entity.transform.networkQuaternion = entity.transform.quaternion;
    entity.transform.networkVelocity = entity.transform.velocity;
    return this.localPlayer;
  }
  
  // Create remote player representation
  createRemotePlayer(data) {
    let objEntity = this.game.spawn("player", { objectType: "playerPrefabs", spawnType: "waving_guy", networkId: data.networkId, isRemote: true }, new THREE.Vector3(data.position));
    objEntity.networkId = data.networkId;
    this.setNetworkTransform(objEntity);
    this.remotePlayers[data.networkId] = objEntity;
    if(this.game.isServer){            
      objEntity.getComponent("PlayerController").setupPhysics(this.physics.simulation);
    }
    return objEntity;
  }

  createNetworkObjectEntity(networkId, data) {
    let objEntity = this.game.spawn(data.type, { networkId: networkId }, data.position);
    objEntity.networkId = this.network;
    this.setNetworkTransform(objEntity);    
    this.networkObjects[networkId] = objEntity;  
    return object;
  }
    
  setNetworkTransform(entity) {
    entity.transform.networkPosition = entity.transform.position.clone();
    entity.transform.networkQuaternion = entity.transform.quaternion.clone();
    entity.transform.networkVelocity = entity.transform.velocity.clone();
    return entity;
  }

  // Remove remote player
  removeRemotePlayer(playerId) {
    const player = this.remotePlayers[playerId];
    if (!player) return;
    
    player.destroy();
    // Remove from cache
    delete this.remotePlayers[playerId];
  }
  
  
  // Update object from server data
  updateObjectFromServer(objectData) {
    const object = this.networkObjects[objectData.id];
    if (!object) return;
    
    // Update mesh and body
    if (objectData.position && object.transform) {
      object.transform.position.set(
        objectData.position.x,
        objectData.position.y,
        objectData.position.z
      );
    }
    
    if (objectData.quaternion && object.mesh) {
      object.transform.quaternion.set(
        objectData.quaternion.x,
        objectData.quaternion.y,
        objectData.quaternion.z,
        objectData.quaternion.w
      );
    }
    
    // Update physics body if needed
    if (object.body && !object.isLocal) {
      if (objectData.position) {
        object.body.setTranslation({
          x: objectData.position.x,
          y: objectData.position.y,
          z: objectData.position.z
        }, true);
      }
      
      if (objectData.quaternion) {
        object.body.setRotation({
          x: objectData.quaternion.x,
          y: objectData.quaternion.y,
          z: objectData.quaternion.z,
          w: objectData.quaternion.w
        }, true);
      }
      
      if (objectData.velocity) {
        object.body.setLinvel({
          x: objectData.velocity.x,
          y: objectData.velocity.y,
          z: objectData.velocity.z
        }, true);
      }
    }
  }
  
  // Update object ID (when a temporary client ID is replaced with server ID)
  updateObjectId(oldId, newId) {
    const object = this.networkObjects[oldId];
    if (!object) return;
    
    // Update the ID
    object.id = newId;
    
    // Move to new ID in the cache
    this.networkObjects[newId] = object;
    delete this.networkObjects[oldId];
  }
  
  // Get local player position for reconciliation
  getLocalPlayerPosition() {
    if (!this.localPlayer || !this.localPlayer.transform) {
      return { x: 0, y: 0, z: 0 };
    }
    
    const pos = this.localPlayer.transform.position;
    return { x: pos.x, y: pos.y, z: pos.z };
  }
  
  // Reconcile local player with server position
  reconcileLocalPlayer(position, velocity) {
    if (!this.localPlayer) return;
    
    // Update position
    if (position && this.localPlayer.transform) {
      this.localPlayer.transform.position.set(position.x, position.y, position.z);
    }
    
    // Update velocity
    if (velocity && this.localPlayer.body) {
      this.localPlayer.body.setLinvel({
        x: velocity.x,
        y: velocity.y,
        z: velocity.z
      }, true);
    }
  }
  
  // Apply pending input for reconciliation
  applyInput(input) {
    // Implement based on your input system
    // For example, if input contains movement:
    if (input.movement && this.localPlayer && this.localPlayer.body) {
      const force = new THREE.Vector3(
        input.movement.x,
        input.movement.y,
        input.movement.z
      ).multiplyScalar(input.deltaTime * 1000); // Convert to appropriate force
      
      this.localPlayer.body.applyImpulse(force, true);
    }
  }
  
  // Handle disconnection from server
  handleDisconnect() {
    // Clear remote players
    Object.keys(this.remotePlayers).forEach(playerId => {
      this.removeRemotePlayer(playerId);
    });
    
    // Optionally clear network objects or mark them as non-synced
  }
  
  // Create an object that will be synced on the network
  createNetworkedObject(objectData) {
    // Create local representation
    const object = this.createNetworkObject({
      ...objectData,
      id: `temp_${Date.now()}`
    });
    
    if (!object) return null;
    
    // Send to server
    const networkId = this.network.createObject(objectData);
    
    // Update local ID
    object.id = networkId;
    this.networkObjects[networkId] = object;
    
    return object;
  }
  
  // Cleanup and disconnect
  dispose() {
    // Disconnect from server
    this.network.disconnect();
    
    // Clear remote players
    Object.keys(this.remotePlayers).forEach(playerId => {
      this.removeRemotePlayer(playerId);
    });
    
    // Clear network objects
    Object.keys(this.networkObjects).forEach(objId => {
      const obj = this.networkObjects[objId];
      if (obj.mesh) this.scene.remove(obj.mesh);
      if (obj.mesh.geometry) obj.mesh.geometry.dispose();
      if (obj.mesh.material) {
        if (Array.isArray(obj.mesh.material)) {
          obj.mesh.material.forEach(material => material.dispose());
        } else {
          obj.mesh.material.dispose();
        }
      }
    });
    
    this.networkObjects = {};
  }
}