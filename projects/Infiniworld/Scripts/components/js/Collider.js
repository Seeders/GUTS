class Collider extends engine.Component {
    init({ debug = true }) {
        this.id = this.parent.id;
        this.stats = this.getComponent('stats').stats;
        this.type = this.stats.colliderType || 'sphere'; // 'sphere' or 'box'
        this.size = this.stats.colliderSize || 1; // For box: dimensions, for sphere: radius
        if(typeof  this.stats.colliderOffset == "string")  this.stats.colliderOffset = JSON.parse( this.stats.colliderOffset);
        this.offset = this.stats.colliderOffset ? new THREE.Vector3(this.stats.colliderOffset.x, this.stats.colliderOffset.y, this.stats.colliderOffset.z) : new THREE.Vector3(0, 0, 0); // Center offset

        this.mass = this.stats.colliderMass || 1; // Override entity mass
        this.restitution = this.stats.colliderRestitution || 0.25; // Override restitution
        this.debug = debug; // Enable debug mode
        this.debugMesh = null; // Store debug mesh

        // Register with physics system
        this.game.gameEntity.getComponent("Physics").registerCollider(this);

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

    postUpdate() {
        this.parent.transform.position.lerp(
            this.parent.transform.physicsPosition,
            this.parent.transform.lerpFactor
        );

        // Update debug mesh position if it exists
        if (this.debug && this.debugMesh) {
            this.debugMesh.position.copy(this.parent.transform.physicsPosition).add(this.offset);
        }
        this.game.gameEntity.getComponent("physics").collectPhysicsData(this);
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