class BuildBehaviorAction extends GUTS.BaseBehaviorAction {

    execute(entityId, game) {
        // Read from buildingState component
        const buildingState = game.getComponent(entityId, 'buildingState');
        if (!buildingState || buildingState.targetBuildingEntityId === -1) {
            return null;
        }

        const buildingId = buildingState.targetBuildingEntityId;
        const buildingPlacement = game.getComponent(buildingId, 'placement');

        // Check if building exists and is under construction
        if (!buildingPlacement || !buildingPlacement.isUnderConstruction) {
            return null;
        }

        const meta = this.getMeta(entityId, game);
        const state = meta.buildState || 'traveling_to_building';

        console.log('[BuildBehaviorAction] execute', {
            entityId,
            buildingId,
            state,
            isUnderConstruction: buildingPlacement.isUnderConstruction
        });

        // State machine - return state objects, don't modify meta directly
        switch (state) {
            case 'traveling_to_building':
                return this.travelToBuilding(entityId, meta, game);
            case 'building':
                return this.doBuilding(entityId, meta, game);
        }

        return null;
    }

    travelToBuilding(entityId, meta, game) {
        // Get building info from buildingState or meta
        const buildingState = game.getComponent(entityId, 'buildingState');
        const buildingId = (buildingState && buildingState.targetBuildingEntityId !== -1) ? buildingState.targetBuildingEntityId : meta.buildingId;
        const buildingTransform = game.getComponent(buildingId, 'transform');
        const buildingPos = buildingTransform?.position;

        if (!buildingPos) {
            console.log('[BuildBehaviorAction] travelToBuilding - no building position');
            return null;
        }

        const transform = game.getComponent(entityId, 'transform');
        const pos = transform?.position;
        const distance = this.distance(pos, buildingPos);

        console.log('[BuildBehaviorAction] travelToBuilding', {
            entityId,
            buildingId,
            distance,
            buildRange: this.parameters.buildRange,
            pos,
            buildingPos
        });

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

            // Clear playerOrder to stop movement
            const playerOrder = game.getComponent(entityId, 'playerOrder');
            if (playerOrder) {
                playerOrder.enabled = false;
                playerOrder.targetPositionX = 0;
                playerOrder.targetPositionY = 0;
                playerOrder.targetPositionZ = 0;
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

    doBuilding(entityId, meta, game) {
        const buildingId = meta.buildingId;
        const buildingPlacement = game.getComponent(buildingId, 'placement');

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

        const elapsed = game.state.round - meta.constructionStartTime;
        const buildTime = buildingPlacement.buildTime || this.parameters.defaultBuildTime;


        if (elapsed >= buildTime) {
            // Complete construction
            this.completeConstruction(entityId, buildingId, buildingPlacement, game);

            // Disable player order so unit can return to normal behavior
            const playerOrder = game.getComponent(entityId, 'playerOrder');
            if (playerOrder) {
                playerOrder.enabled = false;
                playerOrder.targetPositionX = 0;
                playerOrder.targetPositionY = 0;
                playerOrder.targetPositionZ = 0;
                playerOrder.isMoveOrder = false;
                playerOrder.preventEnemiesInRangeCheck = false;
                playerOrder.completed = false;
                playerOrder.issuedTime = 0;
            }

            // Return null to end this action (building is complete)
            return null;
        }

        // Still building - return state to continue
        return {
            buildingId: buildingId,
            buildingPosition: meta.buildingPosition,
            buildState: 'building',
            constructionStartTime: meta.constructionStartTime
        };
    }

    completeConstruction(entityId, buildingId, buildingPlacement, game) {
        // Get unitType from the entity's unitType component (not from placement)
        const unitTypeComponent = game.getComponent(buildingId, 'unitType');
        if (!buildingPlacement || !unitTypeComponent) {
            console.error('[BuildBehaviorAction] Cannot complete construction - missing placement or unitType', buildingId);
            return;
        }

        // Get unit def from collections using numeric indices
        const unitTypeDef = game.call('getUnitTypeDef', unitTypeComponent);

        // Check if this is a trap - handle differently from regular buildings
        if (unitTypeDef?.isTrap) {
            this.completeTrapPlacement(entityId, buildingId, buildingPlacement, unitTypeDef, game);
            return;
        }

        // 1. Restore renderable component - change from underConstruction to actual building
        // unitTypeComponent.type is the numeric spawnType index
        const renderComponent = game.getComponent(buildingId, 'renderable');
        if (renderComponent) {
            renderComponent.spawnType = unitTypeComponent.type;
            // Remove instance to trigger re-spawn with correct model
            game.call('removeInstance', buildingId);
        }

        // 2. Restore health to full
        const maxHP = unitTypeDef?.hp || 100;
        const health = game.getComponent(buildingId, 'health');
        if (health) {
            health.max = maxHP;
            health.current = maxHP;
        }

        // 3. unitType component already has correct data

        // 4. Update placement component - building is now complete
        buildingPlacement.isUnderConstruction = false;
        buildingPlacement.assignedBuilder = null;

        // 5. Change to idle animation
        if (game.animationSystem) {
            const enums = game.call('getEnums');
            game.animationSystem.changeAnimation(buildingId, enums.animationType.idle, 1.0, 0);
        }

    }

    completeTrapPlacement(entityId, buildingId, buildingPlacement, unitTypeDef, game) {
        console.log('[BuildBehaviorAction] completeTrapPlacement called', {
            scoutEntityId: entityId,
            trapBuildingId: buildingId
        });

        // Call the scout's BearTrapAbility.onTrapPlaced to set up ownership and cooldown
        const scoutAbilities = game.call('getEntityAbilities', entityId);
        if (scoutAbilities) {
            const bearTrapAbility = scoutAbilities.find(a => a.id === 'BearTrapAbility');
            if (bearTrapAbility) {
                bearTrapAbility.onTrapPlaced(entityId, buildingId);
            }
        }

        // Update placement component - trap is now active
        buildingPlacement.isUnderConstruction = false;
        buildingPlacement.assignedBuilder = null;

        // Restore health to full
        const maxHP = unitTypeDef?.hp || 10;
        const health = game.getComponent(buildingId, 'health');
        if (health) {
            health.max = maxHP;
            health.current = maxHP;
        }

        // Update renderable to show actual trap model
        const unitTypeComponent = game.getComponent(buildingId, 'unitType');
        const renderComponent = game.getComponent(buildingId, 'renderable');
        console.log('[BuildBehaviorAction] Trap renderable before update:', {
            buildingId,
            renderComponent: renderComponent?.toJSON?.() || renderComponent,
            unitTypeComponent: unitTypeComponent?.toJSON?.() || unitTypeComponent
        });

        if (renderComponent && unitTypeComponent) {
            renderComponent.spawnType = unitTypeComponent.type;
            console.log('[BuildBehaviorAction] Calling removeInstance for trap', buildingId);
            game.call('removeInstance', buildingId);
        }
    }

    onEnd(entityId, game) {
        const aiState = game.getComponent(entityId, 'aiState');
        if (!aiState) return;

        const meta = this.getMeta(entityId, game);
        const buildingId = meta.buildingId;
        // buildingId is null/undefined when not set, or could be 0 (valid entity ID)
        if (buildingId !== undefined && buildingId !== null && buildingId >= 0) {
            const buildingPlacement = game.getComponent(buildingId, 'placement');

            // Clean up if action was interrupted
            if (buildingPlacement && buildingPlacement.assignedBuilder === entityId) {
                buildingPlacement.assignedBuilder = null;
            }
        }


        // Clear all behavior state (like MineGoldBehaviorAction)
        game.call('clearBehaviorState', entityId);
        aiState.currentAction = -1;
        aiState.currentActionCollection = -1;
    }

    distance(pos, target) {
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }
}