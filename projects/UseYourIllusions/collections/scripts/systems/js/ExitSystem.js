/**
 * ExitSystem - Detects when player reaches the exit and triggers level completion
 */
class ExitSystem extends GUTS.BaseSystem {
    static serviceDependencies = [
        'pauseGame',
        'playSound',
        'showVictoryScreen',
        'startLevel'
    ];

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
        // PauseSystem handles resetting pause state on scene load
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

            // Vector from exit to player
            const dx = playerPos.x - exitPos.x;
            const dz = playerPos.z - exitPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            // Check distance
            const exitDistance = exitZone.distance || exitZone.radius || 50;
            if (dist >= exitDistance) continue;

            // Check direction constraint if specified
            // Uses the exit's spriteDirection (how the camera/player sees it)
            if (exitZone.directionEnum !== null && exitZone.directionEnum !== undefined) {
                const animState = this.game.getComponent(exitId, 'animationState');
                if (animState && animState.spriteDirection !== exitZone.directionEnum) {
                    console.log('[ExitSystem] Direction check failed:', {
                        spriteDirection: animState.spriteDirection,
                        requiredDirection: exitZone.directionEnum
                    });
                    continue;
                }
            }

            this.triggerLevelComplete(playerId, exitId);
            return;
        }
    }

    triggerLevelComplete(playerId, exitId) {
        this.levelComplete = true;
        this.levelEndTime = Date.now();

        // Get exit zone to check for next level
        const exitZone = this.game.getComponent(exitId, 'exitZone');
        // nextLevel is stored as an enum index, convert back to level name
        const nextLevelIndex = exitZone?.nextLevel;
        const reverseEnums = this.game.getReverseEnums();
        const nextLevel = typeof nextLevelIndex === 'number' ? reverseEnums.levels?.[nextLevelIndex] : nextLevelIndex;
        console.log('[ExitSystem] nextLevel from component:', nextLevelIndex, '-> resolved to:', nextLevel);

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

        // Play victory sound
        this.call.playSound('sounds', 'victory');

        console.log('[ExitSystem] Level complete!', nextLevel ? `Loading next level: ${nextLevel}` : 'No next level specified');

        // Trigger event for other systems to handle
        this.game.triggerEvent('onLevelComplete', { playerId, exitId, nextLevel });

        // If next level is specified, load it directly
        if (nextLevel && this.game.hasService('startLevel')) {
            this.call.startLevel(nextLevel);
            return;
        }

        // Otherwise show victory screen
        // Pause the game
        this.call.pauseGame();

        // Unlock mouse so player can click UI buttons
        if (document.pointerLockElement) {
            document.exitPointerLock();
        }

        if (this.game.hasService('showVictoryScreen')) {
            this.call.showVictoryScreen(this.getLevelStats());
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
