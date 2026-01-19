/**
 * ExitSystem - Detects when player reaches the exit and triggers level completion
 */
class ExitSystem extends GUTS.BaseSystem {
    static services = [
        'isLevelComplete',
        'getExitPosition',
        'getLevelStats'
    ];

    constructor(game) {
        super(game);
        this.game.exitSystem = this;
        this.levelComplete = false;
        this.levelStartTime = 0;
        this.levelEndTime = 0;
        this.illusionsUsed = 0;
    }

    static eventListeners = {
        'onIllusionCreated': 'handleIllusionCreated'
    };

    init() {
    }

    onSceneLoad(sceneData) {
        this.levelComplete = false;
        this.levelStartTime = Date.now();
        this.levelEndTime = 0;
        this.illusionsUsed = 0;
    }

    handleIllusionCreated(data) {
        this.illusionsUsed++;
    }

    update() {
        if (this.levelComplete) return;

        this.checkPlayerAtExit();
    }

    checkPlayerAtExit() {
        // Get player entity
        const playerEntities = this.game.getEntitiesWith('playerController', 'transform');
        if (playerEntities.length === 0) return;

        const playerId = playerEntities[0];
        const playerTransform = this.game.getComponent(playerId, 'transform');
        const playerPos = playerTransform?.position;
        if (!playerPos) return;

        // Get exit zones
        const exitZones = this.game.getEntitiesWith('exitZone', 'transform');

        for (const exitId of exitZones) {
            const exitZone = this.game.getComponent(exitId, 'exitZone');
            if (!exitZone || !exitZone.isActive) continue;

            const exitTransform = this.game.getComponent(exitId, 'transform');
            const exitPos = exitTransform?.position;
            if (!exitPos) continue;

            const dx = playerPos.x - exitPos.x;
            const dz = playerPos.z - exitPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist < exitZone.radius) {
                this.triggerLevelComplete(playerId, exitId);
                return;
            }
        }
    }

    triggerLevelComplete(playerId, exitId) {
        this.levelComplete = true;
        this.levelEndTime = Date.now();

        // Get exit position for effects
        const exitTransform = this.game.getComponent(exitId, 'transform');
        const exitPos = exitTransform?.position;

        // Create victory effect
        if (exitPos && this.game.effectsSystem) {
            this.game.effectsSystem.createParticleEffect(
                exitPos.x,
                exitPos.y + 50,
                exitPos.z,
                'magic',
                { count: 50, scaleMultiplier: 2.0 }
            );
        }

        console.log('[ExitSystem] Level complete!');

        // Trigger event for other systems to handle
        this.game.triggerEvent('onLevelComplete', { playerId, exitId });

        // Show victory screen with stats
        if (this.game.hasService('showVictoryScreen')) {
            this.game.call('showVictoryScreen', this.getLevelStats());
        } else {
            // Fallback - show victory overlay
            const victoryOverlay = document.getElementById('victoryOverlay');
            if (victoryOverlay) {
                victoryOverlay.classList.add('active');
            }
        }
    }

    isLevelComplete() {
        return this.levelComplete;
    }

    getExitPosition() {
        const exitZones = this.game.getEntitiesWith('exitZone', 'transform');
        if (exitZones.length === 0) return null;

        const exitTransform = this.game.getComponent(exitZones[0], 'transform');
        return exitTransform?.position || null;
    }

    getLevelStats() {
        const endTime = this.levelEndTime || Date.now();
        const elapsedMs = endTime - this.levelStartTime;
        const totalSeconds = Math.floor(elapsedMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        return {
            timeElapsed: elapsedMs,
            timeFormatted: `${minutes}:${seconds.toString().padStart(2, '0')}`,
            illusionsUsed: this.illusionsUsed
        };
    }

    onSceneUnload() {
        this.levelComplete = false;
        this.levelStartTime = 0;
        this.levelEndTime = 0;
        this.illusionsUsed = 0;
    }
}
