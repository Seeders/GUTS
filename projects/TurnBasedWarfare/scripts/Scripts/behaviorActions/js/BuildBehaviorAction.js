class BuildBehaviorAction extends GUTS.BaseBehaviorAction {
    static TYPE = "BUILD";
    static PRIORITY = 5;

    canExecute(entityId, controller, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        if (!aiState || !aiState.meta || !aiState.meta.buildingId) return false;

        const buildingId = aiState.meta.buildingId;
        const buildingPlacement = game.getComponent(buildingId, 'placement');

        // Check if building exists and is under construction
        return buildingPlacement && buildingPlacement.isUnderConstruction;
    }

    execute(entityId, controller, game, dt) {
        const aiState = game.getComponent(entityId, 'aiState');
        const state = aiState.meta.buildState || 'traveling_to_building';

        switch (state) {
            case 'traveling_to_building':
                return this.travelToBuilding(entityId, game);
            case 'building':
                return this.doBuilding(entityId, game);
        }
    }

    onStart(entityId, controller, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        const buildingId = aiState.meta.buildingId;
        const buildingPlacement = game.getComponent(buildingId, 'placement');
        const renderComponent = game.getComponent(buildingId, 'renderable');

        if (renderComponent) {
            renderComponent.spawnType = 'underConstruction';
        }

        // Remove health component while under construction
        game.removeComponent(buildingId, 'health');

        if (buildingPlacement) {
            buildingPlacement.isUnderConstruction = true;
            buildingPlacement.assignedBuilder = entityId;
        }

        // Initialize build state in meta
        aiState.meta.buildState = 'traveling_to_building';
    }

    travelToBuilding(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        const pos = game.getComponent(entityId, 'position');
        const buildingPos = game.getComponent(aiState.meta.buildingId, 'position');

        if (!buildingPos) {
            return { complete: true, failed: true };
        }

        const distance = this.distance(pos, buildingPos);

        if (distance < this.parameters.buildRange) {
            // Reached building - position builder near it
            const vel = game.getComponent(entityId, 'velocity');
            if (vel) {
                vel.targetX = null;
                vel.targetZ = null;
                vel.vx = 0;
                vel.vz = 0;
            }

            // Make the builder face the building
            const facing = game.getComponent(entityId, 'facing');
            if (facing) {
                const dx = buildingPos.x - pos.x;
                const dz = buildingPos.z - pos.z;
                const angleToBuilding = Math.atan2(dz, dx);
                facing.angle = angleToBuilding;
            }

            // Position at build range from building
            pos.x = buildingPos.x + this.parameters.buildRange;
            pos.z = buildingPos.z;

            aiState.meta.buildState = 'building';
            aiState.meta.constructionStartTime = game.state.now;
            return { complete: false };
        }

        // Continue moving to building
        const vel = game.getComponent(entityId, 'velocity');
        if (vel) {
            vel.targetX = buildingPos.x;
            vel.targetZ = buildingPos.z;
        }
        return { complete: false };
    }

    doBuilding(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        const buildingId = aiState.meta.buildingId;
        const buildingPlacement = game.getComponent(buildingId, 'placement');

        if (!buildingPlacement) {
            return { complete: true, failed: true };
        }

        // Play building animation
        if (game.animationSystem) {
            const animState = game.animationSystem.entityAnimationStates.get(entityId);
            if (animState) {
                const finished = game.animationSystem.isAnimationFinished(entityId, animState.currentClip);
                if (finished || animState.currentClip !== 'attack') {
                    game.abilitySystem.startAbilityAnimation(entityId, { castTime: 1 });
                }
            }
        }

        const elapsed = game.state.now - aiState.meta.constructionStartTime;
        const buildTime = buildingPlacement.buildTime || this.parameters.defaultBuildTime;

        if (elapsed >= buildTime) {
            this.completeConstruction(entityId, buildingId, buildingPlacement, game);
            return { complete: true };
        }

        return { complete: false };
    }

    completeConstruction(entityId, buildingId, buildingPlacement, game) {
        const renderComponent = game.getComponent(buildingId, 'renderable');
        const unitType = game.getComponent(buildingId, 'unitType');

        // Restore building appearance
        if (renderComponent && buildingPlacement) {
            renderComponent.spawnType = buildingPlacement.unitType.id;
            game.gameManager.call('removeInstance', buildingId);
        }

        // Add health component
        if (unitType) {
            game.addComponent(buildingId, 'health', {
                max: unitType.hp,
                current: unitType.hp
            });
        }

        // Register building with shop system
        if (game.shopSystem && buildingPlacement) {
            game.shopSystem.addBuilding(buildingPlacement.unitType.id, buildingId);
        }

        // Update placement component
        if (buildingPlacement) {
            buildingPlacement.isUnderConstruction = false;
            buildingPlacement.assignedBuilder = null;
        }

        // Change to idle animation
        if (game.animationSystem) {
            game.animationSystem.changeAnimation(buildingId, 'idle', 1.0, 0);
        }
    }

    onEnd(entityId, controller, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        if (!aiState || !aiState.meta) return;

        const buildingId = aiState.meta.buildingId;
        if (!buildingId) return;

        const buildingPlacement = game.getComponent(buildingId, 'placement');

        // Clean up if action was interrupted
        if (buildingPlacement && buildingPlacement.assignedBuilder === entityId) {
            buildingPlacement.assignedBuilder = null;
        }

        // Clear building meta data
        delete aiState.meta.buildingId;
        delete aiState.meta.buildingPosition;
        delete aiState.meta.buildState;
        delete aiState.meta.constructionStartTime;
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
