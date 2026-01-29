import CameraCoordinatorSystem from '../../../../../../global/collections/scripts/systems/js/CameraCoordinatorSystem.js';

/**
 * CameraSystem for TurnBasedWarfare
 * Extends CameraCoordinatorSystem to coordinate between RTS and ThirdPerson cameras
 */
class CameraSystem extends CameraCoordinatorSystem {
    /**
     * Orthographic mode always returns 1.0 zoom for FogOfWar compatibility
     */
    getZoomLevel() {
        if (this.activeMode === 'orthographic') {
            return 1.0;
        }
        return super.getZoomLevel();
    }
}

export default CameraSystem;
