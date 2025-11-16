class MovementSystem extends BaseSystem {
    constructor(game) {
        super(game);
        this.game = game;
        this.gravity = -20; // Gravity constant
    }

    update(deltaTime, now) {
        const entities = this.game.getEntitiesWith('Position', 'Velocity');

        for (const entityId of entities) {
            const position = this.game.getComponent(entityId, 'Position');
            const velocity = this.game.getComponent(entityId, 'Velocity');

            if (velocity.anchored) continue;

            // Apply gravity
            if (velocity.affectedByGravity) {
                velocity.vy += this.gravity * deltaTime;
            }

            // Clamp velocity to max speed
            const horizontalSpeed = Math.sqrt(velocity.vx * velocity.vx + velocity.vz * velocity.vz);
            if (horizontalSpeed > velocity.maxSpeed) {
                const scale = velocity.maxSpeed / horizontalSpeed;
                velocity.vx *= scale;
                velocity.vz *= scale;
            }

            // Update position
            position.x += velocity.vx * deltaTime;
            position.y += velocity.vy * deltaTime;
            position.z += velocity.vz * deltaTime;

            // Check terrain collision
            if (this.game.state.terrainMap) {
                const terrainHeight = this.getTerrainHeight(position.x, position.z);

                if (position.y < terrainHeight) {
                    position.y = terrainHeight;
                    velocity.vy = 0;
                }
            }

            // Check entity collisions
            this.checkEntityCollisions(entityId, position);
        }
    }

    getTerrainHeight(x, z) {
        if (!this.game.state.terrainMap) return 0;

        const terrainWidth = this.game.state.terrainWidth;
        const terrainHeight = this.game.state.terrainHeight;

        // Convert world coordinates to terrain grid
        const gridX = Math.floor(x);
        const gridZ = Math.floor(z);

        if (gridX < 0 || gridX >= terrainWidth || gridZ < 0 || gridZ >= terrainHeight) {
            return 0;
        }

        const terrainType = this.game.state.terrainMap[gridZ][gridX];

        // Wall terrain is elevated
        if (terrainType === 1) {
            return 2; // Walls are 2 units high
        }

        return 0; // Floor is at ground level
    }

    checkEntityCollisions(entityId, position) {
        const collision = this.game.getComponent(entityId, 'Collision');
        if (!collision) return;

        const entities = this.game.getEntitiesWith('Position', 'Collision');

        for (const otherId of entities) {
            if (otherId === entityId) continue;

            const otherPosition = this.game.getComponent(otherId, 'Position');
            const otherCollision = this.game.getComponent(otherId, 'Collision');

            const dx = position.x - otherPosition.x;
            const dz = position.z - otherPosition.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            const minDistance = collision.radius + otherCollision.radius;

            if (distance < minDistance && distance > 0) {
                // Push entities apart
                const pushX = (dx / distance) * (minDistance - distance) * 0.5;
                const pushZ = (dz / distance) * (minDistance - distance) * 0.5;

                position.x += pushX;
                position.z += pushZ;

                // Only push the other entity if it's not anchored
                const otherVelocity = this.game.getComponent(otherId, 'Velocity');
                if (otherVelocity && !otherVelocity.anchored) {
                    otherPosition.x -= pushX;
                    otherPosition.z -= pushZ;
                }
            }
        }
    }
}
