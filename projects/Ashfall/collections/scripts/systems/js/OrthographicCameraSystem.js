import BaseOrthographicCameraSystem from '../../../../../../global/collections/scripts/systems/js/OrthographicCameraSystem.js';

/**
 * OrthographicCameraSystem for Ashfall
 *
 * In adventure mode the camera is locked to the player character:
 * - WASD belongs to character movement (PlayerControllerSystem), so the
 *   camera's own keyboard pan (which runs a display-rate rAF loop and
 *   CANCELS entity follow) must not engage — it makes the camera drift
 *   away faster than the character walks.
 * - Edge panning is disabled too: aiming with the mouse constantly brushes
 *   the screen edges and would fight the follow.
 * - Follow is sticky: if anything clears it, it re-attaches to the player.
 *
 * Outside adventure mode (skirmish, campaign, hunt) behavior is unchanged.
 */
class OrthographicCameraSystem extends BaseOrthographicCameraSystem {
    _inAdventure() {
        return !!this.game.state?.isAdventure;
    }

    // Blocks _startPanLoop from ever engaging on WASD in adventure
    _isPanKey(code) {
        if (this._inAdventure()) return false;
        return super._isPanKey(code);
    }

    // Fallback per-tick keyboard pan path
    _applyKeyboardPan(dt) {
        if (this._inAdventure()) return false;
        return super._applyKeyboardPan(dt);
    }

    _calculateKeyboardPan(dt) {
        if (this._inAdventure()) return { x: 0, z: 0 };
        return super._calculateKeyboardPan(dt);
    }

    // Mouse-at-screen-edge panning
    _calculateEdgePan(dt) {
        if (this._inAdventure()) return { x: 0, z: 0 };
        return super._calculateEdgePan(dt);
    }

    updateCamera(dt) {
        // Sticky follow: re-attach to the player if follow was lost
        if (this._inAdventure()) {
            const playerId = this.game.state.playerCharacterId;
            if (playerId != null && this.state.followingEntityId == null &&
                this.game.getComponent(playerId, 'transform')) {
                this.state.followingEntityId = playerId;
            }
        }
        super.updateCamera(dt);
    }
}

export default OrthographicCameraSystem;
export { OrthographicCameraSystem };
