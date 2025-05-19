class MultiplayerManager extends engine.Component {
  init({scene, world, serverUrl}) {
    this.scene = scene;            // Three.js scene
    this.world = world;            // Rapier world
    this.localPlayer = null;       // Local player object
    this.remotePlayers = {};       // Other players
    this.networkObjects = {};      // Networked physics objects
    
    // Create network manager
    this.network = new (this.game.libraryClasses.NetworkManager)(this);
    this.serverUrl = serverUrl;
    // Interpolation settings
    this.interpolationDelay = 100; // ms    
  }
  
  // Initialize networking
  async initializeMultiplayer() {
    try {
      const networkId = await this.network.connect(this.serverUrl);
      console.log(`Multiplayer initialized with player ID: ${networkId}`);
      return networkId;
    } catch (err) {
      console.error('Failed to initialize multiplayer:', err);
      throw err;
    }
  }
  
  // Update called from your game loop
  update() {
    // Update local player position on network
    if (this.localPlayer) {
      const position = this.localPlayer.transform.position;
      const quaternion = this.localPlayer.transform.quaternion;
      const velocity = this.localPlayer.transform.velocity;
      
      this.network.sendPlayerUpdate(
        { x: position.x, y: position.y, z: position.z },
        { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
        { x: velocity.x, y: velocity.y, z: velocity.z }
      );
    }
    
    // Interpolate remote players
    this.updateRemotePlayers();
  }
  
  // Update remote players with interpolation
  updateRemotePlayers() {
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
  createRemotePlayer(networkId, data) {
    let objEntity = this.game.spawn(data.type, { networkId: networkId }, data.position);
    objEntity.networkId = networkId;
    this.setNetworkTransform(objEntity);
    this.remotePlayers[networkId] = remotePlayer;
    return remotePlayer;
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
  // Update remote player
  updateRemotePlayer(playerId, playerData) {
    const player = this.remotePlayers[playerId];
    if (!player) return;
    
    // Update target position and rotation for interpolation
    if (playerData.position) {
      player.transform.networkPosition.set(
        playerData.position.x,
        playerData.position.y,
        playerData.position.z
      );
    }
    
    if (playerData.quaternion) {
      player.transform.networkQuaternion.set(
        playerData.quaternion.x,
        playerData.quaternion.y,
        playerData.quaternion.z,
        playerData.quaternion.w
      );
    }
    
    if (playerData.velocity) {
      player.transform.networkVelocity.set(
        playerData.velocity.x,
        playerData.velocity.y,
        playerData.velocity.z
      );
    }
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