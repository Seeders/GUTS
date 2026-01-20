/**
 * PlacementPreviewSystem - Shows a preview of the illusion to be placed
 *
 * Features:
 * - Creates a real entity with semi-transparent rendering for preview
 * - Preview follows mouse/camera direction
 * - Only shows when a belt slot with an item is selected
 * - Uses the same rendering as the actual illusion for accurate preview
 */
class PlacementPreviewSystem extends GUTS.BaseSystem {
    static services = [
        'showIllusionPreview',
        'hideIllusionPreview',
        'getPreviewPosition'
    ];

    constructor(game) {
        super(game);
        this.game.placementPreviewSystem = this;
        console.log('[PlacementPreviewSystem] Constructor called');

        this.previewEntityId = null;
        this.currentItemType = null;
        this.currentItemIndex = null;
        this.previewPosition = { x: 0, y: 0, z: 0 };
        this.isVisible = false;

        // Preview config
        this.config = {
            opacity: 0.5,
            placementRange: 300,
            placementDistance: 100
        };
    }

    init() {
        console.log('[PlacementPreviewSystem] init() called');
    }

    onSceneLoad(sceneData) {
        console.log('[PlacementPreviewSystem] onSceneLoad() called');
    }

    update() {
        const playerEntity = this.game.call('getPlayerEntity');
        if (!playerEntity) {
            return;
        }

        const belt = this.game.getComponent(playerEntity, 'magicBelt');
        if (!belt) {
            this.hideIllusionPreview();
            return;
        }

        // Check if a slot is actively selected (not -1) and has an item
        const selectedSlot = belt.selectedSlot;
        if (selectedSlot < 0) {
            this.hideIllusionPreview();
            return;
        }

        const slotKey = `slot${selectedSlot}`;
        const selectedItemIndex = belt[slotKey];

        // null means empty slot
        if (selectedItemIndex === null) {
            this.hideIllusionPreview();
            return;
        }

        // Convert index to string name for preview
        const reverseEnums = this.game.getReverseEnums();
        const selectedItem = reverseEnums.worldObjects?.[selectedItemIndex];
        if (!selectedItem) {
            console.log('[PlacementPreviewSystem] Could not resolve item name for index:', selectedItemIndex);
            this.hideIllusionPreview();
            return;
        }

        // Show preview at target position
        this.showIllusionPreview(selectedItem, selectedItemIndex);
        this.updatePreviewPosition(playerEntity);
    }

    showIllusionPreview(itemType, itemIndex) {
        // If item type changed, recreate the preview entity
        if (this.currentItemType !== itemType) {
            this.destroyPreviewEntity();
            this.currentItemType = itemType;
            this.currentItemIndex = itemIndex;
            this.createPreviewEntity(itemIndex);
        }

        this.isVisible = true;
    }

    hideIllusionPreview() {
        if (this.isVisible) {
            this.isVisible = false;
            this.currentItemType = null;
            this.currentItemIndex = null;
            this.destroyPreviewEntity();
        }
    }

    createPreviewEntity(itemIndex) {
        const enums = this.game.getEnums();
        const collectionIndex = enums.objectTypeDefinitions?.worldObjects;

        console.log('[PlacementPreviewSystem] createPreviewEntity:', { itemIndex, collectionIndex });

        if (collectionIndex === undefined || itemIndex === undefined) {
            console.log('[PlacementPreviewSystem] Could not find enum indices for preview');
            return;
        }

        // Create at origin initially, will be moved in updatePreviewPosition
        const transform = {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        };

        const neutralTeam = enums.team?.neutral ?? 0;

        // Use createUnit to properly create the preview entity
        this.previewEntityId = this.game.call('createUnit', collectionIndex, itemIndex, transform, neutralTeam);
        console.log('[PlacementPreviewSystem] Created preview entity:', this.previewEntityId);

        if (this.previewEntityId !== null && this.previewEntityId !== undefined) {
            // Add preview component to mark this as a preview (non-interactive)
            this.game.addComponent(this.previewEntityId, 'preview', {
                isPreview: 1,
                opacity: this.config.opacity,
                sourceType: itemIndex
            });

            // Set opacity for semi-transparent rendering
            console.log('[PlacementPreviewSystem] entityRenderer:', !!this.game.entityRenderer, 'setEntityOpacity:', !!this.game.entityRenderer?.setEntityOpacity);
            if (this.game.entityRenderer && this.game.entityRenderer.setEntityOpacity) {
                const result = this.game.entityRenderer.setEntityOpacity(this.previewEntityId, this.config.opacity);
                console.log('[PlacementPreviewSystem] setEntityOpacity result:', result);
            }

            // Remove collision so preview doesn't block anything
            if (this.game.hasComponent(this.previewEntityId, 'collision')) {
                this.game.removeComponent(this.previewEntityId, 'collision');
            }
        } else {
            console.log('[PlacementPreviewSystem] createUnit returned null/undefined');
        }
    }

    destroyPreviewEntity() {
        if (this.previewEntityId !== null && this.previewEntityId !== undefined) {
            if (this.game.removeEntity) {
                this.game.removeEntity(this.previewEntityId);
            } else if (this.game.destroyEntity) {
                this.game.destroyEntity(this.previewEntityId);
            }
            this.previewEntityId = null;
        }
    }

    updatePreviewPosition(playerEntity) {
        if (this.previewEntityId === null || this.previewEntityId === undefined) return;

        const playerTransform = this.game.getComponent(playerEntity, 'transform');
        if (!playerTransform || !playerTransform.position) return;

        const casterPos = playerTransform.position;

        // Get camera info for raycast
        const camera = this.game.hasService('getCamera') ? this.game.call('getCamera') : null;
        const facingAngle = this.game.hasService('getFacingAngle') ? this.game.call('getFacingAngle') : 0;
        const pitchAngle = this.game.hasService('getPitchAngle') ? this.game.call('getPitchAngle') : 0;

        // Get player's vision range as max placement distance
        const combat = this.game.getComponent(playerEntity, 'combat');
        const unitTypeComp = this.game.getComponent(playerEntity, 'unitType');
        const unitTypeDef = this.game.call('getUnitTypeDef', unitTypeComp);
        const visionRange = unitTypeDef?.visionRange || combat?.visionRange || this.config.placementRange;

        let targetX, targetY, targetZ;

        if (camera && camera.position) {
            // Raycast from camera position in look direction to find terrain intersection
            const rayOrigin = camera.position;

            // Calculate ray direction from facing angle (yaw) and pitch angle
            // Horizontal component is reduced by cos(pitch), vertical by sin(pitch)
            const cosPitch = Math.cos(pitchAngle);
            const sinPitch = Math.sin(pitchAngle);

            const rayDirX = Math.cos(facingAngle) * cosPitch;
            const rayDirY = sinPitch;
            const rayDirZ = Math.sin(facingAngle) * cosPitch;

            // Find intersection with terrain using iterative raymarching
            // Step along the ray and check terrain height at each point
            // Stop when we exceed vision range from player
            const stepSize = 5;
            const maxSteps = 200; // Safety limit

            let hitX = null, hitZ = null, hitY = null;
            let lastValidX = null, lastValidZ = null;

            for (let i = 1; i <= maxSteps; i++) {
                const t = i * stepSize;
                const testX = rayOrigin.x + rayDirX * t;
                const testY = rayOrigin.y + rayDirY * t;
                const testZ = rayOrigin.z + rayDirZ * t;

                // Check distance from player - stop if we exceed vision range
                const dx = testX - casterPos.x;
                const dz = testZ - casterPos.z;
                const distFromPlayer = Math.sqrt(dx * dx + dz * dz);

                if (distFromPlayer > visionRange) {
                    // We've gone past vision range - use last valid position or clamp
                    if (lastValidX !== null) {
                        // Use the last position that was within range
                        hitX = lastValidX;
                        hitZ = lastValidZ;
                        hitY = this.game.hasService('getTerrainHeightAtPosition')
                            ? this.game.call('getTerrainHeightAtPosition', hitX, hitZ) || 0
                            : 0;
                    } else {
                        // Clamp to vision range boundary
                        const scale = visionRange / distFromPlayer;
                        hitX = casterPos.x + dx * scale;
                        hitZ = casterPos.z + dz * scale;
                        hitY = this.game.hasService('getTerrainHeightAtPosition')
                            ? this.game.call('getTerrainHeightAtPosition', hitX, hitZ) || 0
                            : 0;
                    }
                    break;
                }

                // Track last position within vision range
                lastValidX = testX;
                lastValidZ = testZ;

                // Get terrain height at this XZ position
                const terrainHeight = this.game.hasService('getTerrainHeightAtPosition')
                    ? this.game.call('getTerrainHeightAtPosition', testX, testZ) || 0
                    : 0;

                // Check if ray has gone below terrain
                if (testY <= terrainHeight) {
                    hitX = testX;
                    hitZ = testZ;
                    hitY = terrainHeight;
                    break;
                }
            }

            if (hitX !== null) {
                targetX = hitX;
                targetZ = hitZ;
                targetY = hitY;
            } else {
                // No terrain hit within range - place at max range in look direction
                targetX = casterPos.x + Math.cos(facingAngle) * visionRange;
                targetZ = casterPos.z + Math.sin(facingAngle) * visionRange;
                targetY = this.game.hasService('getTerrainHeightAtPosition')
                    ? this.game.call('getTerrainHeightAtPosition', targetX, targetZ) || 0
                    : 0;
            }
        } else {
            // Fallback: fixed distance in front of player
            const distance = this.config.placementDistance;
            targetX = casterPos.x + Math.cos(facingAngle) * distance;
            targetZ = casterPos.z + Math.sin(facingAngle) * distance;
            targetY = this.game.hasService('getTerrainHeightAtPosition')
                ? this.game.call('getTerrainHeightAtPosition', targetX, targetZ) || 0
                : 0;
        }

        // Store position for placement
        this.previewPosition.x = targetX;
        this.previewPosition.y = targetY;
        this.previewPosition.z = targetZ;

        // Update preview entity position
        const previewTransform = this.game.getComponent(this.previewEntityId, 'transform');
        if (previewTransform && previewTransform.position) {
            previewTransform.position.x = targetX;
            previewTransform.position.y = targetY;
            previewTransform.position.z = targetZ;
        }

        // Update opacity based on range (dimmer if out of range)
        const dx = targetX - casterPos.x;
        const dz = targetZ - casterPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (this.game.entityRenderer && this.game.entityRenderer.setEntityOpacity) {
            if (dist <= visionRange) {
                // Valid placement - normal preview opacity
                this.game.entityRenderer.setEntityOpacity(this.previewEntityId, this.config.opacity);
            } else {
                // Out of range - more transparent
                this.game.entityRenderer.setEntityOpacity(this.previewEntityId, this.config.opacity * 0.3);
            }
        }
    }

    getPreviewPosition() {
        return this.previewPosition;
    }

    onSceneUnload() {
        this.destroyPreviewEntity();
        this.currentItemType = null;
        this.currentItemIndex = null;
        this.isVisible = false;
    }
}
