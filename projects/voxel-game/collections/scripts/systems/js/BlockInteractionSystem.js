/**
 * BlockInteractionSystem - DDA raycasting and block placement/destruction
 * Ports voxel_raycast from player.rs
 */
class BlockInteractionSystem extends GUTS.BaseSystem {
    static services = [
        'voxelRaycast',
        'placeBlock',
        'destroyBlock'
    ];

    static serviceDependencies = [];

    constructor(game) {
        super(game);
        this.game.blockInteractionSystem = this;

        // Raycast settings
        this.maxRayDistance = 5.0;

        // Input state
        this.leftMouseDown = false;
        this.rightMouseDown = false;
        this.leftMousePressed = false;
        this.rightMousePressed = false;

        // Cached references
        this.worldSystem = null;
        this.playerControllerSystem = null;
    }

    init() {
        console.log('BlockInteractionSystem initializing...');
        this.worldSystem = this.game.voxelWorldSystem;
        this.setupInputListeners();
        console.log('BlockInteractionSystem initialized');
    }

    postAllInit() {
        this.playerControllerSystem = this.game.playerControllerSystem;
    }

    setupInputListeners() {
        document.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                this.leftMousePressed = !this.leftMouseDown;
                this.leftMouseDown = true;
            } else if (e.button === 2) {
                this.rightMousePressed = !this.rightMouseDown;
                this.rightMouseDown = true;
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.leftMouseDown = false;
            else if (e.button === 2) this.rightMouseDown = false;
        });

        // Prevent context menu
        document.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    update() {
        if (!this.playerControllerSystem) return;

        const pos = this.playerControllerSystem.getPlayerPosition();
        const rot = this.playerControllerSystem.getPlayerRotation();

        if (!pos || !rot) return;

        // Calculate eye position and look direction
        const eyePos = [pos.x, pos.y + 1.6, pos.z]; // Eye height
        const direction = this.getLookDirection(rot.pitch, rot.yaw);

        // Perform raycast
        const hit = this.voxelRaycast(eyePos, direction, this.maxRayDistance);

        // Handle block destruction (left click)
        if (this.leftMousePressed && hit) {
            this.destroyBlock(hit.blockPos[0], hit.blockPos[1], hit.blockPos[2]);
        }

        // Handle block placement (right click)
        if (this.rightMousePressed && hit) {
            this.placeBlock(hit.previousPos[0], hit.previousPos[1], hit.previousPos[2],
                this.worldSystem.BLOCK_ROCK, 0);
        }

        // Reset pressed state
        this.leftMousePressed = false;
        this.rightMousePressed = false;
    }

    getLookDirection(pitch, yaw) {
        const cosPitch = Math.cos(pitch);
        return [
            -Math.sin(yaw) * cosPitch,
            Math.sin(pitch),
            -Math.cos(yaw) * cosPitch
        ];
    }

    /**
     * DDA voxel raycast algorithm
     * Ports voxel_raycast from player.rs
     */
    voxelRaycast(origin, direction, maxDistance) {
        // Normalize direction
        const len = Math.sqrt(
            direction[0] * direction[0] +
            direction[1] * direction[1] +
            direction[2] * direction[2]
        );
        const dir = [direction[0] / len, direction[1] / len, direction[2] / len];

        // Current voxel position
        const current = [
            Math.floor(origin[0]),
            Math.floor(origin[1]),
            Math.floor(origin[2])
        ];

        // Step direction
        const step = [
            dir[0] > 0 ? 1 : -1,
            dir[1] > 0 ? 1 : -1,
            dir[2] > 0 ? 1 : -1
        ];

        // tDelta - how far along ray to move for each axis step
        const tDelta = [
            Math.abs(1 / dir[0]),
            Math.abs(1 / dir[1]),
            Math.abs(1 / dir[2])
        ];

        // tMax - distance to next voxel boundary for each axis
        const tMax = [
            this.getTMax(origin[0], dir[0], step[0]),
            this.getTMax(origin[1], dir[1], step[1]),
            this.getTMax(origin[2], dir[2], step[2])
        ];

        let distance = 0;
        const previous = [...current];

        while (distance < maxDistance) {
            // Check current voxel
            const block = this.worldSystem.getBlock(current[0], current[1], current[2]);
            if (block) {
                return {
                    blockPos: [...current],
                    previousPos: [...previous],
                    distance
                };
            }

            // Save previous position
            previous[0] = current[0];
            previous[1] = current[1];
            previous[2] = current[2];

            // Step to next voxel
            if (tMax[0] < tMax[1] && tMax[0] < tMax[2]) {
                current[0] += step[0];
                distance = tMax[0];
                tMax[0] += tDelta[0];
            } else if (tMax[1] < tMax[2]) {
                current[1] += step[1];
                distance = tMax[1];
                tMax[1] += tDelta[1];
            } else {
                current[2] += step[2];
                distance = tMax[2];
                tMax[2] += tDelta[2];
            }
        }

        return null;
    }

    getTMax(origin, direction, step) {
        if (direction === 0) return Infinity;

        const voxelBoundary = step > 0 ?
            Math.floor(origin) + 1 :
            Math.floor(origin);

        return (voxelBoundary - origin) / direction;
    }

    placeBlock(x, y, z, blockKind, blockData = 0) {
        // Check if position is valid (not inside player)
        const playerPos = this.playerControllerSystem.getPlayerPosition();
        if (playerPos) {
            const dx = Math.abs(x + 0.5 - playerPos.x);
            const dy = y - playerPos.y;
            const dz = Math.abs(z + 0.5 - playerPos.z);

            if (dx < 0.8 && dz < 0.8 && dy >= -0.5 && dy < 1.8) {
                return false; // Would intersect player
            }
        }

        return this.worldSystem.setBlock(x, y, z, blockKind, blockData);
    }

    destroyBlock(x, y, z) {
        return this.worldSystem.setBlock(x, y, z, this.worldSystem.BLOCK_AIR, 0);
    }
}

GUTS.BlockInteractionSystem = BlockInteractionSystem;
