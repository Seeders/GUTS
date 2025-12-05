class BuildBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        // Skip if MoveBehaviorAction is already handling this order
        const aiState = game.getComponent(entityId, 'aiState');
   
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

    travelToBuilding(entityId, aiState, game) {
        // Get building info from playerOrder or aiState.meta
        const playerOrder = game.getComponent(entityId, 'playerOrder');
        const buildingId = playerOrder.meta.buildingId || aiState.meta.buildingId;
        const buildingTransform = game.getComponent(buildingId, 'transform');
        const buildingPos = buildingTransform?.position;

        if (!buildingPos) {
            return null;
        }

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const distance = this.distance(pos, buildingPos);

        if (distance < this.parameters.buildRange) {
            // Reached building
            if (transform) {
                const dx = buildingPos.x - pos.x;
                const dz = buildingPos.z - pos.z;
                const angleToBuilding = Math.atan2(dz, dx);
                if (!transform.rotation) transform.rotation = { x: 0, y: 0, z: 0 };
                transform.rotation.y = angleToBuilding;
            }

            // Position at build range from building
            if (pos) {
                pos.x = buildingPos.x + this.parameters.buildRange;
                pos.z = buildingPos.z;
            }

            // Clear playerOrder.targetPosition to stop movement
            const playerOrder = game.getComponent(entityId, 'playerOrder');
            if (playerOrder) {
                playerOrder.targetPosition = null;
            }

            // Stop the unit so it doesn't move while building
            const vel = game.getComponent(entityId, 'velocity');
            if (vel) {
                vel.vx = 0;
                vel.vz = 0;
            }

            // Return state object - transition to building state
            return {
                buildingId: buildingId,
                buildingPosition: buildingPos,
                buildState: 'building',
                constructionStartTime: game.state.round
            };
        }

        // Still traveling - return targetPosition so MovementSystem moves unit to building
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
        const unitType = game.getComponent(buildingId, 'unitType');

        if (!buildingPlacement) {
            return null;
        }

        // Play building animation
        if (game.animationSystem) {
            const animState = game.getComponent(entityId, "animationState");
            if (animState) {
                const finished = game.animationSystem.isAnimationFinished(entityId, animState.currentClip);
                if (finished || animState.currentClip !== 'attack') {
                    game.abilitySystem.startAbilityAnimation(entityId, { castTime: 1 });
                }
            }
        }

        const elapsed = game.state.round - aiState.meta.constructionStartTime;
        const buildTime = buildingPlacement.buildTime || this.parameters.defaultBuildTime;


        if (elapsed >= buildTime) {
            // Complete construction
            this.completeConstruction(entityId, buildingId, buildingPlacement, game);

            // Remove player order so unit can return to normal behavior
            game.removeComponent(entityId, 'playerOrder');

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
        if (!buildingPlacement || !buildingPlacement.unitType) {
            console.error('[BuildBehaviorAction] Cannot complete construction - missing placement or unitType');
            return;
        }


        // Get the actual building unit type from placement
        const actualBuildingType = buildingPlacement.unitType;

        // 1. Restore renderable component - change from underConstruction to actual building
        const renderComponent = game.getComponent(buildingId, 'renderable');
        if (renderComponent) {
            renderComponent.spawnType = actualBuildingType.id;
            // Remove instance to trigger re-spawn with correct model
            game.gameManager.call('removeInstance', buildingId);
        }

        // 2. Restore health to full (health component is kept during construction)
        const maxHP = actualBuildingType.hp || 100;
        const health = game.getComponent(buildingId, 'health');
        if (health) {
            health.max = maxHP;
            health.current = maxHP;
        }

        // 3. Update unitType component to ensure it has all the actual building's data
        const unitTypeComponent = game.getComponent(buildingId, 'unitType');
        if (unitTypeComponent) {
            Object.assign(unitTypeComponent, actualBuildingType);
        }

        // 4. Update placement component - building is now complete
        buildingPlacement.isUnderConstruction = false;
        buildingPlacement.assignedBuilder = null;

        // 5. Register building with shop system
        if (game.shopSystem) {
            game.shopSystem.addBuilding(actualBuildingType.id, buildingId);
        }

        // 6. Change to idle animation
        if (game.animationSystem) {
            game.animationSystem.changeAnimation(buildingId, 'idle', 1.0, 0);
        }

    }

    onEnd(entityId, game) {
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
