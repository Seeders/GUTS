/**
 * ConstructBuildingBehaviorAction - Performs construction over time
 *
 * Reads from shared state:
 * - shared.targetBuilding - Building entity ID
 * - shared.buildTime - Construction time required
 *
 * Returns RUNNING while constructing, SUCCESS when complete
 * Handles completion logic (restore model, health, register with systems)
 */
class ConstructBuildingBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        const shared = this.getShared(entityId, game);
        const memory = this.getMemory(entityId);

        const buildingId = shared.targetBuilding;
        if (!buildingId) {
            return this.failure();
        }

        const buildingPlacement = game.getComponent(buildingId, 'placement');
        if (!buildingPlacement || !buildingPlacement.isUnderConstruction) {
            // Building no longer under construction
            return this.failure();
        }

        // Anchor the builder and face the building
        this.anchorBuilder(entityId, buildingId, game);

        // Initialize construction start time
        if (!memory.constructionStartTime) {
            memory.constructionStartTime = game.state.round;
        }

        // Play building animation
        this.playBuildAnimation(entityId, game);

        // Check progress
        const elapsed = game.state.round - memory.constructionStartTime;
        const buildTime = shared.buildTime || this.parameters.defaultBuildTime || 5;

        if (elapsed >= buildTime) {
            // Complete construction
            this.completeConstruction(entityId, buildingId, buildingPlacement, game);

            // Clear shared state
            shared.targetBuilding = null;
            shared.targetPosition = null;
            shared.buildTime = null;

            // Unanchor builder
            this.unanchorBuilder(entityId, game);

            return this.success();
        }

        // Still building
        return this.running({ progress: elapsed / buildTime });
    }

    anchorBuilder(entityId, buildingId, game) {
        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const buildingTransform = game.getComponent(buildingId, 'transform');
        const buildingPos = buildingTransform?.position;
        const vel = game.getComponent(entityId, 'velocity');

        if (vel && !vel.anchored) {
            vel.anchored = true;
            vel.vx = 0;
            vel.vz = 0;
        }

        // Face the building
        if (pos && buildingPos && transform) {
            const dx = buildingPos.x - pos.x;
            const dz = buildingPos.z - pos.z;
            if (!transform.rotation) transform.rotation = { x: 0, y: 0, z: 0 };
            transform.rotation.y = Math.atan2(dz, dx);
        }

        // Clear movement target
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (playerOrder) {
            playerOrder.targetPosition = null;
        }
    }

    unanchorBuilder(entityId, game) {
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.anchored = false;
        }
    }

    playBuildAnimation(entityId, game) {
        if (!game.animationSystem) return;

        const animState = game.animationSystem.entityAnimationStates.get(entityId);
        if (animState) {
            const finished = game.animationSystem.isAnimationFinished(entityId, animState.currentClip);
            if (finished || animState.currentClip !== 'attack') {
                game.abilitySystem?.startAbilityAnimation(entityId, { castTime: 1 });
            }
        }
    }

    completeConstruction(entityId, buildingId, buildingPlacement, game) {
        if (!buildingPlacement || !buildingPlacement.unitType) {
            console.error('[ConstructBuildingBehaviorAction] Cannot complete construction - missing placement or unitType');
            return;
        }

        const actualBuildingType = buildingPlacement.unitType;

        // 1. Update renderable - change from underConstruction to actual building
        const renderComponent = game.getComponent(buildingId, 'renderable');
        if (renderComponent) {
            renderComponent.spawnType = actualBuildingType.id;
            game.gameManager.call('removeInstance', buildingId);
        }

        // 2. Restore health to full
        const maxHP = actualBuildingType.hp || 100;
        const health = game.getComponent(buildingId, 'health');
        if (health) {
            health.max = maxHP;
            health.current = maxHP;
        }

        // 3. Update unitType component
        const unitTypeComponent = game.getComponent(buildingId, 'unitType');
        if (unitTypeComponent) {
            Object.assign(unitTypeComponent, actualBuildingType);
        }

        // 4. Mark construction complete
        buildingPlacement.isUnderConstruction = false;
        buildingPlacement.assignedBuilder = null;

        // 5. Register with shop system
        if (game.shopSystem) {
            game.shopSystem.addBuilding(actualBuildingType.id, buildingId);
        }

        // 6. Change building to idle animation
        if (game.animationSystem) {
            game.animationSystem.changeAnimation(buildingId, 'idle', 1.0, 0);
        }
    }

    onBattleEnd(entityId, game){
        const shared = this.getShared(entityId, game);
        const memory = this.getMemory(entityId);
        const buildingId = shared.targetBuilding;
        if (!buildingId) {
            return;
        }
        const elapsed = game.state.round - memory.constructionStartTime + 1;
        const buildTime = shared.buildTime || this.parameters.defaultBuildTime;

        if (elapsed >= buildTime) {
            const buildingPlacement = game.getComponent(buildingId, 'placement');
            if (!buildingPlacement || !buildingPlacement.isUnderConstruction ||  buildingPlacement.assignedBuilder != entityId) {
                return;
            }
            this.completeConstruction(entityId, buildingId, buildingPlacement, game);

            shared.targetBuilding = null;
            shared.targetPosition = null;
            shared.buildTime = null;

            this.unanchorBuilder(entityId, game);
        }

    }
    onEnd(entityId, game) {
        // Unanchor builder if action is interrupted
        this.unanchorBuilder(entityId, game);

        // Clean up assigned builder reference
        const shared = this.getShared(entityId, game);
        if (shared.targetBuilding) {
            const buildingPlacement = game.getComponent(shared.targetBuilding, 'placement');
            if (buildingPlacement && buildingPlacement.assignedBuilder === entityId) {
                buildingPlacement.assignedBuilder = null;
            }
        }

        super.onEnd(entityId, game);
    }
}
