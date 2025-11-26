class BuildBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, controller, game, dt) {
        // Read from playerOrder component (like MoveBehaviorAction)
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        if (!playerOrder || !playerOrder.meta || !playerOrder.meta.buildingId) {
            return null;
        }

        const buildingId = playerOrder.meta.buildingId;
        const buildingPlacement = game.getComponent(buildingId, 'placement');

        // Check if building exists and is under construction
        if (!buildingPlacement || !buildingPlacement.isUnderConstruction) {
            return null;
        }

        // Get current state from aiState.meta (like MineGoldBehaviorAction)
        const aiState = game.getComponent(entityId, 'aiState');
        const state = aiState.meta.buildState || 'traveling_to_building';

        // State machine - return state objects, don't modify aiState.meta
        switch (state) {
            case 'traveling_to_building':
                return this.travelToBuilding(entityId, aiState, game);
            case 'building':
                return this.doBuilding(entityId, aiState, game);
        }

        return null;
    }

    onStart(entityId, controller, game) {
        // Building state is already initialized by assignToBuild or assignBuilderToConstruction
        // No additional setup needed - action state is managed via returned state objects
    }

    travelToBuilding(entityId, aiState, game) {
        // Get building info from playerOrder or aiState.meta
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        const buildingId = playerOrder.meta.buildingId || aiState.meta.buildingId;
        const buildingPos = game.getComponent(buildingId, 'position');

        if (!buildingPos) {
            return null;
        }

        const pos = game.getComponent(entityId, 'position');
        const distance = this.distance(pos, buildingPos);

        if (distance < this.parameters.buildRange) {
            // Reached building
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

            // Return state object - transition to building state
            return {
                buildingId: buildingId,
                buildingPosition: buildingPos,
                buildState: 'building',
                constructionStartTime: game.state.now
            };
        }

        // Still traveling - return state with target position
        return {
            buildingId: buildingId,
            buildingPosition: buildingPos,
            buildState: 'traveling_to_building',
            targetPosition: { x: buildingPos.x, z: buildingPos.z }
        };
    }

    doBuilding(entityId, aiState, game) {
        const buildingId = aiState.meta.buildingId;
        const buildingPlacement = game.getComponent(buildingId, 'placement');

        if (!buildingPlacement) {
            return null;
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
            // Complete construction
            this.completeConstruction(entityId, buildingId, buildingPlacement, game);

            // Return null to end this action (building is complete)
            return null;
        }

        // Still building - return state to continue
        return {
            buildingId: buildingId,
            buildingPosition: aiState.meta.buildingPosition,
            buildState: 'building',
            constructionStartTime: aiState.meta.constructionStartTime
        };
    }

    completeConstruction(entityId, buildingId, buildingPlacement, game) {
        const renderComponent = game.getComponent(buildingId, 'renderable');
        const unitType = game.getComponent(buildingId, 'unitType');

            console.log('completed', buildingPlacement);
        // Restore building appearance
        if (renderComponent && buildingPlacement) {
            renderComponent.spawnType = buildingPlacement.unitType.id;
            game.gameManager.call('removeInstance', buildingId);
        }

        // Add health component to the new building entity
        if (unitType) {
            game.addComponent(buildingId, 'health', {
                max: unitType.hp,
                current: unitType.hp
            });
        }

        // Register building with shop system using new entity ID
        if (game.shopSystem && buildingPlacement) {
            game.shopSystem.addBuilding(buildingPlacement.unitType.id, buildingId);
        }

        // Update placement component - building is now complete
        if (buildingPlacement) {
            buildingPlacement.isUnderConstruction = false;
            buildingPlacement.assignedBuilder = null;
        }

        // Change to idle animation on the new building entity
        if (game.animationSystem) {
            game.animationSystem.changeAnimation(buildingId, 'idle', 1.0, 0);
        }
    }

    onEnd(entityId, controller, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        if (!aiState || !aiState.meta) return;

        const buildingId = aiState.meta.buildingId;
        if (buildingId) {
            const buildingPlacement = game.getComponent(buildingId, 'placement');

            // Clean up if action was interrupted
            if (buildingPlacement && buildingPlacement.assignedBuilder === entityId) {
                buildingPlacement.assignedBuilder = null;
            }
        }

        // Clear all meta data (like MineGoldBehaviorAction)
        aiState.meta = {};
        aiState.currentAction = null;
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}
