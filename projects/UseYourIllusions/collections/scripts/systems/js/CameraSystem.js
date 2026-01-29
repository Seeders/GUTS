import ThirdPersonCameraSystem from '../../../../../../global/collections/scripts/systems/js/ThirdPersonCameraSystem.js';

/**
 * CameraSystem for UseYourIllusions
 * Extends ThirdPersonCameraSystem with player rotation sync and indoor level restrictions
 */
class CameraSystem extends ThirdPersonCameraSystem {
    static serviceDependencies = [
        ...ThirdPersonCameraSystem.serviceDependencies,
        'getCurrentLevelId'
    ];

    constructor(game) {
        super(game);
        this._isIndoorLevel = false;
    }

    onSceneLoad(sceneData) {
        super.onSceneLoad(sceneData);
        this._detectIndoorLevel();
    }

    /**
     * Restrict zoom for indoor levels
     */
    getZoomConstraints() {
        if (this._isIndoorLevel) {
            // Lock to third-person view for indoor levels
            return { min: 0.08, max: 0.08 };
        }
        return { min: 0, max: 1 };
    }

    /**
     * Sync player rotation with camera facing angle
     */
    onFollowTargetMoved(entityId, position) {
        const transform = this.game.getComponent(entityId, 'transform');
        if (transform?.rotation) {
            transform.rotation.y = this.state.facingAngle;
        }
    }

    /**
     * Detect if current level is indoors
     */
    _detectIndoorLevel() {
        const levelId = this.call.getCurrentLevelId?.();
        this._isIndoorLevel = levelId?.includes('indoor') || false;
    }
}

export default CameraSystem;
