/**
 * GhostPreviewSystem - Shows a preview of the illusion to be placed
 *
 * Features:
 * - Creates a real entity with semi-transparent rendering for preview
 * - Preview follows mouse/camera direction
 * - Only shows when a belt slot with an item is selected
 * - Uses the same rendering as the actual illusion for accurate preview
 */
class GhostPreviewSystem extends GUTS.BaseSystem {
    static services = [
        'showIllusionPreview',
        'hideIllusionPreview',
        'getPreviewPosition'
    ];

    constructor(game) {
        super(game);
        this.game.placementPreviewSystem = this;
        console.log('[GhostPreviewSystem] Constructor called');

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
        console.log('[GhostPreviewSystem] init() called');
    }

    onSceneLoad(sceneData) {
        console.log('[GhostPreviewSystem] onSceneLoad() called');
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

        // Check if a slot is selected with an item
        const selectedSlot = belt.selectedSlot;
        const slotKey = `slot${selectedSlot}`;
        const selectedItemIndex = belt[slotKey];

        // null means empty slot
        if (selectedItemIndex === null) {
            this.hideIllusionPreview();
            return;
        }

        // Convert index to string name for preview
        const reverseEnums = this.game.getReverseEnums();
        const selectedItem = reverseEnums.collectibles?.[selectedItemIndex];
        if (!selectedItem) {
            console.log('[GhostPreviewSystem] Could not resolve item name for index:', selectedItemIndex);
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
        const collectionIndex = enums.objectTypeDefinitions?.collectibles;

        console.log('[GhostPreviewSystem] createPreviewEntity:', { itemIndex, collectionIndex });

        if (collectionIndex === undefined || itemIndex === undefined) {
            console.log('[GhostPreviewSystem] Could not find enum indices for preview');
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
        console.log('[GhostPreviewSystem] Created preview entity:', this.previewEntityId);

        if (this.previewEntityId !== null && this.previewEntityId !== undefined) {
            // Add preview component to mark this as a preview (non-interactive)
            this.game.addComponent(this.previewEntityId, 'preview', {
                isPreview: 1,
                opacity: this.config.opacity,
                sourceType: itemIndex
            });

            // Set opacity for semi-transparent rendering
            console.log('[GhostPreviewSystem] entityRenderer:', !!this.game.entityRenderer, 'setEntityOpacity:', !!this.game.entityRenderer?.setEntityOpacity);
            if (this.game.entityRenderer && this.game.entityRenderer.setEntityOpacity) {
                const result = this.game.entityRenderer.setEntityOpacity(this.previewEntityId, this.config.opacity);
                console.log('[GhostPreviewSystem] setEntityOpacity result:', result);
            }

            // Remove collision so preview doesn't block anything
            if (this.game.hasComponent(this.previewEntityId, 'collision')) {
                this.game.removeComponent(this.previewEntityId, 'collision');
            }
        } else {
            console.log('[GhostPreviewSystem] createUnit returned null/undefined');
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

        // Get facing angle from camera
        const facingAngle = this.game.hasService('getFacingAngle')
            ? this.game.call('getFacingAngle')
            : 0;

        // Calculate target position in front of player
        const distance = this.config.placementDistance;
        const targetX = casterPos.x + Math.cos(facingAngle) * distance;
        const targetZ = casterPos.z + Math.sin(facingAngle) * distance;

        // Get terrain height at target position
        let targetY = 0;
        if (this.game.hasService('getTerrainHeightAtPosition')) {
            targetY = this.game.call('getTerrainHeightAtPosition', targetX, targetZ) || 0;
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
            if (dist <= this.config.placementRange) {
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
