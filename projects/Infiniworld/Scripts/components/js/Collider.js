class Collider extends engine.Component {
    init({ debug = false, objectType, spawnType }) {
        this.id = this.parent.id;
        this.prefabData = this.game.config[objectType][spawnType];
        this.colliderData = this.game.config.colliders[this.prefabData.collider];
        if(!this.colliderData){
            this.colliderData = {
                type: "sphere",
                size: 1,
                offset: new THREE.Vector3(),
                gravity: true,
                mass: 1,
                restitution: 0.25
            }
        }
        this.type = this.colliderData.type; 
        this.size = this.colliderData.size; 
        if(typeof  this.colliderData.offset == "string")  this.colliderData.offset = JSON.parse( this.colliderData.offset);
        this.offset = this.colliderData.offset ? new THREE.Vector3(this.colliderData.offset.x, this.colliderData.offset.y, this.colliderData.offset.z) : new THREE.Vector3(0, 0, 0); // Center offset
        this.gravity = this.colliderData.gravity;
        this.mass = this.colliderData.mass; 
        this.restitution = this.colliderData.restitution;
        this.debug = debug; // Enable debug mode
        this.debugMesh = null; // Store debug mesh

        // Register with physics system
        this.game.gameEntity.getComponent('Physics').registerCollider(this);

        // Create debug visualization if debug mode is enabled
        if (this.debug) {
            this.createDebugMesh();
        }
    }

    createDebugMesh() {
        let geometry, material;

        if (this.type === 'sphere') {
            geometry = new THREE.SphereGeometry(this.size, 16, 16); // Low-poly for performance
            material = new THREE.MeshBasicMaterial({
                color: 0x00ff00, // Green wireframe
                wireframe: true
            });
        } else if (this.type === 'box') {
            geometry = new THREE.BoxGeometry(this.size.x, this.size.y, this.size.z);
            material = new THREE.MeshBasicMaterial({
                color: 0x00ff00, // Green wireframe
                wireframe: true
            });
        } else {
            throw new Error(`Unsupported collider type: ${this.type}`);
        }

        this.debugMesh = new THREE.Mesh(geometry, material);
        this.debugMesh.position.copy(this.parent.transform.physicsPosition).add(this.offset);
        this.game.scene.add(this.debugMesh); // Add to the Three.js scene
    }

    getAABB(position = this.parent.transform.physicsPosition) {
        const pos = position.clone().add(this.offset);
        if (this.type === 'sphere') {
            const radius = this.size;
            return {
                min: {
                    x: pos.x - radius,
                    y: pos.y - radius,
                    z: pos.z - radius
                },
                max: {
                    x: pos.x + radius,
                    y: pos.y + radius,
                    z: pos.z + radius
                }
            };
        } else if (this.type === 'box') {
            return {
                min: {
                    x: pos.x - this.size.x / 2,
                    y: pos.y - this.size.y / 2,
                    z: pos.z - this.size.z / 2
                },
                max: {
                    x: pos.x + this.size.x / 2,
                    y: pos.y + this.size.y / 2,
                    z: pos.z + this.size.z / 2
                }
            };
        }
        throw new Error(`Unsupported collider type: ${this.type}`);
    }

    update() {

        this.parent.transform.position.lerp(
            this.parent.transform.physicsPosition,
            this.parent.transform.lerpFactor
        );
        // Update debug mesh position if it exists
        if (this.debug && this.debugMesh) {
            this.debugMesh.position.copy(this.parent.transform.physicsPosition).add(this.offset);
        }
        this.game.gameEntity.getComponent('Physics').collectPhysicsData(this);
    }

    destroy() {
        // Clean up debug mesh if it exists
        if (this.debug && this.debugMesh) {
            this.game.scene.remove(this.debugMesh);
            this.debugMesh.geometry.dispose();
            this.debugMesh.material.dispose();
            this.debugMesh = null;
        }
    }
}