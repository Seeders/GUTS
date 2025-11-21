/**
 * RaycastHelper - Utility for raycasting mouse positions to 3D world coordinates
 *
 * Provides methods for:
 * - Raycasting against ground mesh
 * - Fallback flat plane raycasting
 * - Converting mouse screen coordinates to world positions
 *
 * Used by both the game (MultiplayerPlacementSystem) and editor (TerrainMapEditor)
 */
class RaycastHelper {
    constructor(camera, scene) {
        this.camera = camera;
        this.scene = scene;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Cache for ground mesh to avoid repeated searches
        this.groundMeshCache = null;
    }

    /**
     * Update camera reference (useful when camera changes)
     */
    setCamera(camera) {
        this.camera = camera;
    }

    /**
     * Update scene reference (useful when scene changes)
     */
    setScene(scene) {
        this.scene = scene;
        this.groundMeshCache = null; // Invalidate cache when scene changes
    }

    /**
     * Raycast from mouse position to get world coordinates on ground
     * @param {number} mouseX - Normalized mouse X (-1 to 1)
     * @param {number} mouseY - Normalized mouse Y (-1 to 1)
     * @param {THREE.Mesh} [groundMesh] - Optional ground mesh to raycast against
     * @returns {THREE.Vector3|null} World position or null if no intersection
     */
    rayCastGround(mouseX, mouseY, groundMesh = null) {
        if (!this.camera || !this.scene) {
            console.warn('RaycastHelper: Camera or scene not set');
            return null;
        }

        this.mouse.set(mouseX, mouseY);
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Use provided ground mesh or cached one
        const ground = groundMesh || this.groundMeshCache || this.findGroundMesh();

        if (ground) {
            // Cache the ground mesh for future use
            if (!this.groundMeshCache) {
                this.groundMeshCache = ground;
            }

            const intersects = this.raycaster.intersectObject(ground, false);
            if (intersects.length > 0) {
                return intersects[0].point;
            }
        }

        return null;
    }

    /**
     * Raycast to a flat plane at given height (fallback when ground mesh not available)
     * @param {number} mouseX - Normalized mouse X (-1 to 1)
     * @param {number} mouseY - Normalized mouse Y (-1 to 1)
     * @param {number} planeHeight - Height of the flat plane (default 0)
     * @returns {THREE.Vector3|null} World position or null if no intersection
     */
    rayCastFlatPlane(mouseX, mouseY, planeHeight = 0) {
        if (!this.camera) {
            console.warn('RaycastHelper: Camera not set');
            return null;
        }

        this.mouse.set(mouseX, mouseY);
        this.raycaster.setFromCamera(this.mouse, this.camera);

        const ray = this.raycaster.ray;

        // Check if ray is parallel to plane
        if (Math.abs(ray.direction.y) < 0.0001) {
            return null;
        }

        // Calculate intersection distance
        const distance = (planeHeight - ray.origin.y) / ray.direction.y;

        if (distance < 0) {
            return null;
        }

        // Calculate intersection point
        const intersectionPoint = ray.origin.clone().add(
            ray.direction.clone().multiplyScalar(distance)
        );

        return intersectionPoint;
    }

    /**
     * Get world position from mouse event
     * Tries ground mesh first, falls back to flat plane
     * @param {number} mouseX - Normalized mouse X (-1 to 1)
     * @param {number} mouseY - Normalized mouse Y (-1 to 1)
     * @param {number} [fallbackHeight] - Height for flat plane fallback
     * @param {THREE.Mesh} [groundMesh] - Optional ground mesh
     * @returns {THREE.Vector3|null} World position
     */
    getWorldPositionFromMouse(mouseX, mouseY, fallbackHeight = 0, groundMesh = null) {
        // Try raycasting against ground mesh first
        let worldPos = this.rayCastGround(mouseX, mouseY, groundMesh);

        // Fall back to flat plane if ground raycast failed
        if (!worldPos) {
            worldPos = this.rayCastFlatPlane(mouseX, mouseY, fallbackHeight);
        }

        return worldPos;
    }

    /**
     * Convert canvas mouse event to normalized device coordinates
     * @param {MouseEvent} event - Mouse event
     * @param {HTMLElement} canvas - Canvas element
     * @returns {{x: number, y: number}} Normalized coordinates (-1 to 1)
     */
    mouseEventToNDC(event, canvas) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
            y: -((event.clientY - rect.top) / rect.height) * 2 + 1
        };
    }

    /**
     * Find ground mesh in scene (searches for PlaneGeometry mesh)
     * @returns {THREE.Mesh|null} Ground mesh or null
     */
    findGroundMesh() {
        if (!this.scene) return null;

        for (let child of this.scene.children) {
            if (child.isMesh && child.geometry?.type === 'PlaneGeometry') {
                return child;
            }
        }
        return null;
    }

    /**
     * Clear cached ground mesh
     */
    clearCache() {
        this.groundMeshCache = null;
    }

    /**
     * Raycast against any objects in scene
     * @param {number} mouseX - Normalized mouse X (-1 to 1)
     * @param {number} mouseY - Normalized mouse Y (-1 to 1)
     * @param {THREE.Object3D[]} objects - Objects to raycast against
     * @param {boolean} recursive - Whether to check children recursively
     * @returns {THREE.Intersection[]} Array of intersections
     */
    rayCastObjects(mouseX, mouseY, objects, recursive = false) {
        if (!this.camera) {
            console.warn('RaycastHelper: Camera not set');
            return [];
        }

        this.mouse.set(mouseX, mouseY);
        this.raycaster.setFromCamera(this.mouse, this.camera);

        return this.raycaster.intersectObjects(objects, recursive);
    }

    /**
     * Get closest entity at world position
     * @param {THREE.Vector3} worldPos - World position to check
     * @param {Function} getEntitiesWithComponents - Function to get entities
     * @param {Function} getComponent - Function to get component from entity
     * @param {Object} componentTypes - Component type constants
     * @param {number} clickRadius - Maximum search radius
     * @returns {string|null} Entity ID or null
     */
    getEntityAtWorldPosition(worldPos, getEntitiesWithComponents, getComponent, componentTypes, clickRadius = 30) {
        let closestEntityId = null;
        let closestDistance = clickRadius;

        const entities = getEntitiesWithComponents(
            componentTypes.POSITION,
            componentTypes.TEAM
        );

        entities.forEach(entityId => {
            const pos = getComponent(entityId, componentTypes.POSITION);

            if (!pos) return;

            const dx = pos.x - worldPos.x;
            const dz = pos.z - worldPos.z;
            const distance = Math.sqrt(dx * dx + dz * dz);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestEntityId = entityId;
            }
        });

        return closestEntityId;
    }

    /**
     * Clean up resources
     */
    dispose() {
        this.camera = null;
        this.scene = null;
        this.groundMeshCache = null;
        this.raycaster = null;
        this.mouse = null;
    }
}
