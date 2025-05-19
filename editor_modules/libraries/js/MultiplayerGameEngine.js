class MultiplayerGameEngine {
  constructor(scene, world) {
    this.scene = scene;            // Three.js scene
    this.world = world;            // Rapier world
    this.localPlayer = null;       // Local player object
    this.remotePlayers = {};       // Other players
    this.networkObjects = {};      // Networked physics objects
    
    // Create network manager
    this.network = new NetworkManager(this);
    
    // Interpolation settings
    this.interpolationDelay = 100; // ms
  }
  
  // Initialize networking
  async initializeMultiplayer(serverUrl) {
    try {
      const playerId = await this.network.connect(serverUrl);
      console.log(`Multiplayer initialized with player ID: ${playerId}`);
      return playerId;
    } catch (err) {
      console.error('Failed to initialize multiplayer:', err);
      throw err;
    }
  }
  
  // Update called from your game loop
  update(deltaTime) {
    // Update local player position on network
    if (this.localPlayer) {
      const position = this.localPlayer.mesh.position;
      const quaternion = this.localPlayer.mesh.quaternion;
      const velocity = this.localPlayer.body ? 
        this.localPlayer.body.linvel() : { x: 0, y: 0, z: 0 };
      
      this.network.sendPlayerUpdate(
        { x: position.x, y: position.y, z: position.z },
        { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
        { x: velocity.x, y: velocity.y, z: velocity.z }
      );
    }
    
    // Interpolate remote players
    this.updateRemotePlayers(deltaTime);
  }
  
  // Update remote players with interpolation
  updateRemotePlayers(deltaTime) {
    Object.keys(this.remotePlayers).forEach(playerId => {
      const player = this.remotePlayers[playerId];
      
      if (player.targetPosition && player.targetQuaternion) {
        // Position interpolation
        player.mesh.position.lerp(player.targetPosition, 0.2);
        
        // Rotation interpolation
        player.mesh.quaternion.slerp(player.targetQuaternion, 0.2);
      }
    });
  }
  
  // Create local player
  createLocalPlayer(mesh, body) {
    this.localPlayer = { mesh, body };
    return this.localPlayer;
  }
  
  // Create remote player representation
  createRemotePlayer(playerId, playerData) {
    // Create mesh for remote player - customize based on your game's player representation
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geometry, material);
    
    // Set initial position and rotation
    if (playerData.position) {
      mesh.position.set(
        playerData.position.x,
        playerData.position.y,
        playerData.position.z
      );
    }
    
    if (playerData.quaternion) {
      mesh.quaternion.set(
        playerData.quaternion.x,
        playerData.quaternion.y,
        playerData.quaternion.z,
        playerData.quaternion.w
      );
    }
    
    // Add to scene
    this.scene.add(mesh);
    
    // Store in remote players
    const remotePlayer = {
      id: playerId,
      mesh: mesh,
      targetPosition: mesh.position.clone(),
      targetQuaternion: mesh.quaternion.clone(),
      velocity: new THREE.Vector3()
    };
    
    this.remotePlayers[playerId] = remotePlayer;
    return remotePlayer;
  }
  
  // Update remote player
  updateRemotePlayer(playerId, playerData) {
    const player = this.remotePlayers[playerId];
    if (!player) return;
    
    // Update target position and rotation for interpolation
    if (playerData.position) {
      player.targetPosition.set(
        playerData.position.x,
        playerData.position.y,
        playerData.position.z
      );
    }
    
    if (playerData.quaternion) {
      player.targetQuaternion.set(
        playerData.quaternion.x,
        playerData.quaternion.y,
        playerData.quaternion.z,
        playerData.quaternion.w
      );
    }
    
    if (playerData.velocity) {
      player.velocity.set(
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
    
    // Remove from scene
    this.scene.remove(player.mesh);
    
    // Dispose resources
    if (player.mesh.geometry) player.mesh.geometry.dispose();
    if (player.mesh.material) {
      if (Array.isArray(player.mesh.material)) {
        player.mesh.material.forEach(material => material.dispose());
      } else {
        player.mesh.material.dispose();
      }
    }
    
    // Remove from cache
    delete this.remotePlayers[playerId];
  }
  
  // Create object from server data
  createObjectFromServer(objectData) {
    // Implement based on your object types and creation logic
    // This is just a basic example
    const object = this.createNetworkObject(objectData);
    
    if (object) {
      this.networkObjects[objectData.id] = object;
    }
    
    return object;
  }
  
  // Create a networked physics object
  createNetworkObject(data) {
    // Example implementation - customize based on your game objects
    let mesh, body;
    
    // Create Three.js mesh
    if (data.type === 'box') {
      const geometry = new THREE.BoxGeometry(data.size.x, data.size.y, data.size.z);
      const material = new THREE.MeshStandardMaterial({ color: data.color || 0xaaaaaa });
      mesh = new THREE.Mesh(geometry, material);
    } else if (data.type === 'sphere') {
      const geometry = new THREE.SphereGeometry(data.radius, 16, 16);
      const material = new THREE.MeshStandardMaterial({ color: data.color || 0xaaaaaa });
      mesh = new THREE.Mesh(geometry, material);
    } else {
      // Default or custom object type
      return null;
    }
    
    // Set position and rotation
    if (data.position) {
      mesh.position.set(data.position.x, data.position.y, data.position.z);
    }
    
    if (data.quaternion) {
      mesh.quaternion.set(
        data.quaternion.x,
        data.quaternion.y,
        data.quaternion.z,
        data.quaternion.w
      );
    }
    
    // Add to scene
    this.scene.add(mesh);
    
    // Create Rapier physics body if we have a physics world
    if (this.world) {
      // Create rigid body description
      let bodyDesc;
      if (data.isStatic) {
        bodyDesc = RAPIER.RigidBodyDesc.fixed();
      } else {
        bodyDesc = RAPIER.RigidBodyDesc.dynamic();
      }
      
      if (data.position) {
        bodyDesc.setTranslation(data.position.x, data.position.y, data.position.z);
      }
      
      if (data.quaternion) {
        bodyDesc.setRotation({
          x: data.quaternion.x,
          y: data.quaternion.y,
          z: data.quaternion.z,
          w: data.quaternion.w
        });
      }
      
      // Create the rigid body
      body = this.world.createRigidBody(bodyDesc);
      
      // Create collision shape
      let collider;
      if (data.type === 'box') {
        collider = RAPIER.ColliderDesc.cuboid(
          data.size.x / 2, 
          data.size.y / 2, 
          data.size.z / 2
        );
      } else if (data.type === 'sphere') {
        collider = RAPIER.ColliderDesc.ball(data.radius);
      }
      
      if (collider) {
        // Set restitution, friction, etc.
        if (data.restitution !== undefined) collider.setRestitution(data.restitution);
        if (data.friction !== undefined) collider.setFriction(data.friction);
        
        // Create the collider
        this.world.createCollider(collider, body);
      }
    }
    
    // Return the created object
    return {
      id: data.id,
      mesh: mesh,
      body: body,
      data: data
    };
  }
  
  // Update object from server data
  updateObjectFromServer(objectData) {
    const object = this.networkObjects[objectData.id];
    if (!object) return;
    
    // Update mesh and body
    if (objectData.position && object.mesh) {
      object.mesh.position.set(
        objectData.position.x,
        objectData.position.y,
        objectData.position.z
      );
    }
    
    if (objectData.quaternion && object.mesh) {
      object.mesh.quaternion.set(
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
    if (!this.localPlayer || !this.localPlayer.mesh) {
      return { x: 0, y: 0, z: 0 };
    }
    
    const pos = this.localPlayer.mesh.position;
    return { x: pos.x, y: pos.y, z: pos.z };
  }
  
  // Reconcile local player with server position
  reconcileLocalPlayer(position, velocity) {
    if (!this.localPlayer) return;
    
    // Update position
    if (position && this.localPlayer.mesh) {
      this.localPlayer.mesh.position.set(position.x, position.y, position.z);
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