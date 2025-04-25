class Collider extends engine.Component {
    init({}) {
        this.stats = this.getComponent('stats').stats;  
        this.type = 'sphere'; // 'sphere' or 'box'
        this.size = { radius: 5 }; // For box: dimensions, for sphere: radius
        this.offset = new THREE.Vector3(0, 0, 0); // Center offset
        this.mass = 1; // Override entity mass
        this.restitution = 1; // Override restitution
        this.game.gameEntity.getComponent("Physics").registerEntity(this.parent);
    }

    getAABB(position = this.entity.position) {
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
        // Optional: Update collider properties dynamically if needed
    }

    destroy() {
        // Cleanup if needed
    }
}