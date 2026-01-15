/**
 * UnitOrderUISystem - Client-only UI for unit orders
 *
 * Handles all UI interactions for issuing orders:
 * - Canvas click targeting
 * - Action panel buttons
 * - Targeting preview
 * - Visual feedback (particle effects)
 *
 * This system calls UnitOrderSystem.applySquadTargetPosition for the core logic.
 */
class UnitOrderUISystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game = game;
        this.game.unitOrderUISystem = this;

        this.isTargeting = false;
        this.isForceMove = false;
        this.pendingCallbacks = 0;
        this.orderMeta = {};

        this._onCanvasClick = this._onCanvasClick.bind(this);

        this.cursorWhenTargeting = 'crosshair';
        this.pingEffect = { count: 12, color: 0x00ff00 };
        this.targetingPreview = null;
        this.orderPreview = null;
    }

    init() {
        // Preview created in onGameStarted when scene is available
    }

    onGameStarted() {
        // Create targeting preview for building placement (squares)
        this.targetingPreview = new GUTS.PlacementPreview(this.game);
        this.targetingPreview.updateConfig({
            cellOpacity: 0.3,
            borderOpacity: 0.6
        });

        // Create order preview for move/hide orders (circles)
        this.orderPreview = new GUTS.PlayerOrderPreview(this.game);
    }

    showSquadActionPanel(placementId) {
        const actionPanel = document.getElementById('actionPanel');
        if (!actionPanel) return;

        const placement = this.game.call('getPlacementById', placementId);
        if (!placement) {
            console.warn(`[UnitOrderUISystem] No placement found for ${placementId}`);
            return;
        }

        actionPanel.innerHTML = "";

        const firstUnit = placement.squadUnits?.[0];
        const unitTypeComp = firstUnit ? this.game.getComponent(firstUnit, "unitType") : null;
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

        let squadPanel = document.createElement('div');
        squadPanel.id = 'squadActionPanel';

        actionPanel.appendChild(squadPanel);

        this.displayActionSet(null, squadPanel, firstUnit, unitType);
    }

    displayActionSet(actionSetId, panel, selectedUnitId, unitType) {
        panel.innerHTML = ``;
        const actionSection = document.createElement('div');
        actionSection.className = 'action-section';

        const grid = document.createElement('div');
        grid.className = 'action-grid';

        let actions = [];

        if (!unitType.actionSet) {
            if (unitType.collection == 'units') {
                unitType.actionSet = 'defaultUnitActions';
            }
        }

        if (actionSetId || unitType.actionSet) {
            if (!actionSetId) {
                actionSetId = unitType.actionSet;
            }
            let currentActionSet = this.collections.actionSets[actionSetId];
            if (currentActionSet.actions) {
                actions = currentActionSet.actions;
                const actionsCollection = this.collections.actions;

                // Get unit's abilities to check for ability-based actions
                const unitAbilities = this.game.call('getEntityAbilities', selectedUnitId) || [];
                const unitAbilityIds = unitAbilities.map(a => a.id);

                // Find all actions that require abilities and add them if the unit has the ability
                const abilityActions = [];
                for (const [actionId, action] of Object.entries(actionsCollection)) {
                    if (action.ability && unitAbilityIds.includes(action.ability)) {
                        // Unit has this ability, add the action if not already in base actions
                        if (!actions.includes(actionId)) {
                            abilityActions.push(actionId);
                        }
                    }
                }

                // Combine base actions with ability-based actions
                const allActions = [...actions, ...abilityActions];

                allActions.forEach((actionId) => {
                    // Filter conditional actions like levelUp and specialize
                    if (!this.shouldShowAction(actionId, selectedUnitId)) return;
                    let action = actionsCollection[actionId];
                    const btn = this.createActionButton(action, panel, selectedUnitId, unitType);
                    grid.appendChild(btn);
                });
            } else if (currentActionSet.buildings) {
                const buildings = this.collections.buildings;
                currentActionSet.buildings.forEach(buildingId => {
                    if (buildingId === 'underConstruction') return;

                    const building = buildings[buildingId];
                    if (!building.buildTime) building.buildTime = 1;

                    building.id = buildingId;
                    building.collection = "buildings";
                    const canAfford = this.game.call('canAffordCost', building.value || 0);
                    const isLocked = this.game.shopSystem?.isBuildingLocked(buildingId, building);
                    const lockReason = this.game.shopSystem?.getLockReason(buildingId, building);

                    const btn = this.createBuildingButton(building, canAfford, isLocked, lockReason, selectedUnitId);
                    grid.appendChild(btn);
                });
            }
        }
        actionSection.appendChild(grid);

        panel.appendChild(actionSection);
    }

    createActionButton(action, panel, selectedUnitId, unitType) {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.title = `${action.title}`;

        const iconEl = document.createElement('div');
        iconEl.className = 'action-btn-icon';
        if (action.icon) {
            const icon = this.collections.icons[action.icon];
            if (icon && icon.imagePath) {
                const img = document.createElement('img');
                img.src = `./resources/${icon.imagePath}`;
                iconEl.append(img);
            } else {
                iconEl.textContent = '🏛️';
            }
        } else {
            iconEl.textContent = '🏛️';
        }
        btn.append(iconEl);

        if (action.order) {
            console.log('[createActionButton] adding click handler for order:', action.order);
            btn.addEventListener('click', () => {
                console.log('[createActionButton] button clicked, calling:', action.order);
                this[action.order]();
            });
        } else if (action.actionSet) {
            btn.addEventListener('click', () => {
                this.displayActionSet(action.actionSet, panel, selectedUnitId, unitType);
            });
        }
        return btn;
    }

    createBuildingButton(building, canAfford, isLocked, lockReason, selectedUnitId) {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.title = `${building.title} 💰${building.value}`;
        const locked = isLocked || !canAfford;
        if (locked) {
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.title = `${building.title} ${lockReason}`;
        }

        const iconEl = document.createElement('div');
        iconEl.className = 'action-btn-icon';
        if (building.icon) {
            const icon = this.collections.icons[building.icon];
            if (icon && icon.imagePath) {
                const img = document.createElement('img');
                img.src = `./resources/${icon.imagePath}`;
                iconEl.append(img);
            } else {
                iconEl.textContent = '🏛️';
            }
        } else {
            iconEl.textContent = '🏛️';
        }
        btn.append(iconEl);

        if (!locked) {
            btn.addEventListener('click', () => {
                this.activateBuildingPlacement(building, selectedUnitId);
            });

            btn.addEventListener('mouseenter', () => {
                btn.style.border = '2px solid var(--primary-gold)';
                btn.style.transform = 'translateY(-2px)';
            });

            btn.addEventListener('mouseleave', () => {
                btn.style.border = '2px solid rgba(255, 170, 0, 0.3)';
                btn.style.transform = 'translateY(0)';
            });
        }

        return btn;
    }

    activateBuildingPlacement(building, selectedUnitId) {
        console.log('[UnitOrderUISystem] activateBuildingPlacement called', {
            buildingId: building.id,
            buildTime: building.buildTime,
            selectedUnitId,
            isTrap: building.isTrap
        });

        this.game.state.selectedUnitType = { ...building };

        this.game.state.peasantBuildingPlacement = {
            peasantId: selectedUnitId,
            buildTime: building.buildTime
        };

        console.log('[UnitOrderUISystem] peasantBuildingPlacement set', this.game.state.peasantBuildingPlacement);

        this.stopTargeting();

        this.game.triggerEvent('onActivateBuildingPlacement', this.game.state.selectedUnitType);
    }

    moveOrderAction() {
        this.startTargeting({ preventEnemiesInRangeCheck: true, preventCombat: true });
    }

    hideOrderAction() {
        this.startTargeting({ isHideOrder: true });
    }

    startTargeting(meta = {}) {
        this.stopTargeting();
        if (this.game.state.phase !== this.enums.gamePhase.placement) return;
        this.isTargeting = true;
        this.orderMeta = meta;
        this.pendingCallbacks = 0;

        const canvas = this.game.canvas;
        if (canvas) {
            canvas.addEventListener('contextmenu', this._onCanvasClick, { once: true });
        }
    }

    stopTargeting() {
        if (!this.isTargeting) return;
        this.isTargeting = false;

        const canvas = this.game.canvas;
        if (canvas) {
            canvas.removeEventListener('contextmenu', this._onCanvasClick, { once: true });
        }

        if (this.targetingPreview) {
            this.targetingPreview.clear();
        }
    }

    holdPosition() {
        this.stopTargeting();

        // Use game.call - SAME code path as headless mode
        let placementIds = this.game.call('getSelectedSquads');

        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            return;
        }

        // Use game.call - handles all the logic
        this.game.call('ui_holdPosition', placementIds, (success) => {
            if (success) {
                // Domain logic (applySquadsTargetPositions) now handled by ClientNetworkSystem
                // Here we just handle UI concerns: visual feedback

                // Show visual feedback
                placementIds.forEach((placementId) => {
                    const placement = this.game.call('getPlacementById', placementId);
                    placement.squadUnits.forEach((unitId) => {
                        const transform = this.game.getComponent(unitId, "transform");
                        const position = transform?.position;
                        if (this.game.effectsSystem && position) {
                            this.game.call('createParticleEffect', position.x, 0, position.z, 'magic', { ...this.pingEffect });
                        }

                        // Clear path in pathfinding system
                        this.game.call('clearEntityPath', unitId);
                    });
                });
            }
        });
    }

    hide() {
        this.stopTargeting();

        // Use game.call - SAME code path as headless mode
        let placementIds = this.game.call('getSelectedSquads');

        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            return;
        }

        // Use game.call - handles all the logic
        this.game.call('ui_hide', placementIds, (success) => {
            if (success) {
                // Show visual feedback
                placementIds.forEach((placementId) => {
                    const placement = this.game.call('getPlacementById', placementId);
                    placement.squadUnits.forEach((unitId) => {
                        const transform = this.game.getComponent(unitId, "transform");
                        const position = transform?.position;
                        if (this.game.effectsSystem && position) {
                            // Use a subtle effect for hiding
                            this.game.call('createParticleEffect', position.x, 0, position.z, 'magic', {
                                ...this.pingEffect,
                                color: 0x444444  // Darker color for stealth
                            });
                        }

                        // Clear path in pathfinding system
                        this.game.call('clearEntityPath', unitId);
                    });
                });
            }
        });
    }

    placeBearTrap() {
        // Get selected scouts
        const placementIds = this.game.call('getSelectedSquads') || [];
        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            return;
        }

        // Find a scout unit with BearTrapAbility
        let scoutUnit = null;
        for (const placementId of placementIds) {
            const placement = this.game.call('getPlacementById', placementId);
            if (!placement) continue;

            for (const unitId of placement.squadUnits) {
                const abilities = this.game.call('getEntityAbilities', unitId);
                if (abilities) {
                    const bearTrapAbility = abilities.find(a => a.id === 'BearTrapAbility');
                    if (bearTrapAbility) {
                        // Check if ability is available (cooldown and max traps)
                        if (bearTrapAbility.canExecute(unitId)) {
                            scoutUnit = unitId;
                            break;
                        }
                    }
                }
            }
            if (scoutUnit) break;
        }

        if (!scoutUnit) {
            this.game.uiSystem?.showNotification('Cannot place trap (max 2 traps or on cooldown).', 'warning', 800);
            return;
        }

        // Get bear trap building definition
        const bearTrapBuilding = this.collections.buildings?.bearTrap;
        if (!bearTrapBuilding) {
            this.game.uiSystem?.showNotification('Bear trap building not found.', 'error', 1000);
            return;
        }

        // Use the same pattern as peasant building placement
        // Scout will walk to position and place trap (uses buildTime from bearTrap.json)
        const trapDef = {
            ...bearTrapBuilding,
            id: 'bearTrap',
            collection: 'buildings'
        };

        this.activateBuildingPlacement(trapDef, scoutUnit);
        this.game.uiSystem?.showNotification('Click to place bear trap', 'info', 2000);
    }

    placeExplosiveTrap() {
        // Get selected trappers
        const placementIds = this.game.call('getSelectedSquads') || [];
        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            return;
        }

        // Find a trapper unit with ExplosiveTrapAbility
        let trapperUnit = null;
        for (const placementId of placementIds) {
            const placement = this.game.call('getPlacementById', placementId);
            if (!placement) continue;

            for (const unitId of placement.squadUnits) {
                const abilities = this.game.call('getEntityAbilities', unitId);
                if (abilities) {
                    const explosiveTrapAbility = abilities.find(a => a.id === 'ExplosiveTrapAbility');
                    if (explosiveTrapAbility) {
                        // Check if ability is available (cooldown and max traps)
                        if (explosiveTrapAbility.canExecute(unitId)) {
                            trapperUnit = unitId;
                            break;
                        }
                    }
                }
            }
            if (trapperUnit) break;
        }

        if (!trapperUnit) {
            this.game.uiSystem?.showNotification('Cannot place trap (max 2 traps or on cooldown).', 'warning', 800);
            return;
        }

        // Get explosive trap building definition
        const explosiveTrapBuilding = this.collections.buildings?.explosiveTrap;
        if (!explosiveTrapBuilding) {
            this.game.uiSystem?.showNotification('Explosive trap building not found.', 'error', 1000);
            return;
        }

        // Use the same pattern as peasant building placement
        // Trapper will walk to position and place trap (uses buildTime from explosiveTrap.json)
        const trapDef = {
            ...explosiveTrapBuilding,
            id: 'explosiveTrap',
            collection: 'buildings'
        };

        this.activateBuildingPlacement(trapDef, trapperUnit);
        this.game.uiSystem?.showNotification('Click to place explosive trap', 'info', 2000);
    }

    // ==================== TRANSFORM ACTIONS ====================

    transformToFlying() {
        this._executeTransform('dragon_red_flying', 'takeoff');
    }

    transformToGround() {
        this._executeTransform('dragon_red', 'land');
    }

    _executeTransform(targetUnitType, animationType) {
        const placementIds = this.game.call('getSelectedSquads') || [];
        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            return;
        }

        // Find first unit in selection
        for (const placementId of placementIds) {
            const placement = this.game.call('getPlacementById', placementId);
            if (!placement?.squadUnits?.length) continue;

            const entityId = placement.squadUnits[0];

            // Get animation duration from sprite data
            const unitTypeComp = this.game.getComponent(entityId, 'unitType');
            const unitDef = this.game.call('getUnitTypeDef', unitTypeComp);
            const spriteAnimationSet = unitDef?.spriteAnimationSet;
            let animationDuration = 1000;
            if (spriteAnimationSet && this.game.hasService('getSpriteAnimationDuration')) {
                animationDuration = this.game.call('getSpriteAnimationDuration', spriteAnimationSet, animationType);
            }

            // Call network-synced transform via GameInterfaceSystem
            this.game.call('ui_transformUnit', entityId, targetUnitType, animationType, (success, response) => {
                if (success) {
                    this.game.uiSystem?.showNotification('Transforming...', 'info', animationDuration);

                    // Auto-select the new entity after animation completes
                    const newEntityId = response?.newEntityId;
                    if (newEntityId != null && this.game.hasService('selectEntity')) {
                        setTimeout(() => {
                            if (this.game.entityExists(newEntityId)) {
                                this.game.call('selectEntity', newEntityId);
                            }
                        }, animationDuration);
                    }
                } else {
                    this.game.uiSystem?.showNotification(response?.error || 'Transform failed', 'error', 1000);
                }
            });
            return;
        }

        this.game.uiSystem?.showNotification('No valid unit to transform.', 'warning', 800);
    }

    onKeyDown(key) {
        if (key === 'Escape' && this.isTargeting) {
            this.game.uiSystem?.showNotification('Targeting canceled', 'warning', 800);
            this.stopTargeting();
        }
    }

    onMultipleUnitsSelected(unitIds) {
        // Get the first selected entity to display its action panel
        const entityId = unitIds.size > 0 ? Array.from(unitIds)[0] : null;
        if (!entityId) {
            this.stopTargeting();
            return;
        }

        const unitTypeComp = this.game.getComponent(entityId, "unitType");
        const unitType = this.game.call('getUnitTypeDef', unitTypeComp);
        if (unitType && unitType.collection === "units") {
            const placement = this.game.getComponent(entityId, "placement");
            const placementId = placement?.placementId;
            if (placementId) {
                this.showSquadActionPanel(placementId);
                this.startTargeting();
            }
        } else {
            this.stopTargeting();
        }
        this.showMoveTargets();
    }

    showMoveTargets() {
        if (!this.orderPreview) return;

        const placementIds = this.game.call('getSelectedSquads') || [];
        const orders = [];

        placementIds.forEach((placementId) => {
            const placement = this.game.call('getPlacementById', placementId);
            placement.squadUnits.forEach((entityId) => {
                const playerOrder = this.game.getComponent(entityId, "playerOrder");
                if (playerOrder && (playerOrder.targetPositionX !== 0 || playerOrder.targetPositionZ !== 0)) {
                    orders.push({
                        x: playerOrder.targetPositionX,
                        z: playerOrder.targetPositionZ,
                        isHiding: playerOrder.isHiding
                    });
                }
            });
        });

        if (orders.length > 0) {
            this.orderPreview.show(orders);
        } else {
            this.orderPreview.hide();
        }
    }

    // ==================== CANVAS RIGHT-CLICK HANDLING ====================

    _onCanvasClick(event) {
        if (!this.isTargeting) return;

        const canvas = this.game.canvas;
        if (!canvas) {
            this.stopTargeting();
            return;
        }

        // Get raw world position without grid centering offset
        // Move/Hide orders should go exactly where clicked, not snapped to grid center
        const worldPos = this.game.call('getWorldPositionFromMouse', undefined, undefined, false);
        if (!worldPos) {
            this.game.uiSystem?.showNotification('Could not find ground under cursor.', 'error', 1000);
            this.stopTargeting();
            return;
        }

        let placementIds = this.game.call('getSelectedSquads') || [];

        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            this.stopTargeting();
            return;
        }

        // Check if clicking on a building under construction
        const buildingUnderConstruction = this.getBuildingUnderConstructionAtPosition(worldPos);
        if (buildingUnderConstruction) {
            // Check if any selected units have BuildAbility
            const builderUnit = this.getBuilderUnitFromSelection(placementIds);
            if (builderUnit) {
                this.assignBuilderToConstruction(builderUnit, buildingUnderConstruction);
                return;
            }
        }

        const targetPosition = { x: worldPos.x, y: 0, z: worldPos.z };

        // Check if this is a hide order
        const isHideOrder = this.orderMeta?.isHideOrder;
        const isForceMove = this.orderMeta?.preventEnemiesInRangeCheck;
        const effectColor = isHideOrder ? 0x8866cc : (isForceMove ? 0xffaa00 : 0x00ff00);  // Purple for stealth, orange for force move, green for normal move

        // Use GameInterfaceSystem for the actual order
        if (isHideOrder) {
            this.game.call('ui_issueHideOrder', placementIds, targetPosition, (success, response) => {
                this._handleMoveOrderResponse(success, worldPos, effectColor, isHideOrder);
            });
        } else {
            // Pass orderMeta to ui_issueMoveOrder for force move support
            this.game.call('ui_issueMoveOrder', placementIds, targetPosition, this.orderMeta, (success, response) => {
                this._handleMoveOrderResponse(success, worldPos, effectColor, isHideOrder);
            });
        }
    }

    _handleMoveOrderResponse(success, worldPos, effectColor, isHideOrder) {
        if (success) {
            // Show visual feedback
            if (this.game.effectsSystem) {
                this.game.call('createParticleEffect', worldPos.x, 0, worldPos.z, 'magic', {
                    ...this.pingEffect,
                    color: effectColor
                });
            }

            // Keep targeting active for move orders, stop for hide orders
            // Always show the target preview so user sees where unit is going
            if (!isHideOrder) {
                this.startTargeting(this.orderMeta);
            } else {
                this.stopTargeting();
            }
            this.showMoveTargets();
        }
    }

    getBuildingUnderConstructionAtPosition(worldPos) {
        const buildings = this.game.getEntitiesWith("placement", "transform", "unitType");

        for (const entityId of buildings) {
            const placement = this.game.getComponent(entityId, "placement");
            const transform = this.game.getComponent(entityId, "transform");
            const pos = transform?.position;
            const unitTypeComp = this.game.getComponent(entityId, "unitType");
            const unitType = this.game.call('getUnitTypeDef', unitTypeComp);

            if (!placement || !pos || !unitType) continue;
            if (unitType.collection !== 'buildings') continue;
            if (!placement.isUnderConstruction) continue;

            // Check if click is within building bounds (use collision radius or default)
            const radius = unitType.collisionRadius || 50;
            const dx = worldPos.x - pos.x;
            const dz = worldPos.z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            if (dist <= radius) {
                return entityId;
            }
        }

        return null;
    }

    getBuilderUnitFromSelection(placementIds) {
        for (const placementId of placementIds) {
            const placement = this.game.call('getPlacementById', placementId);
            if (!placement) continue;

            for (const unitId of placement.squadUnits) {
                // Check if unit has BuildAbility
                const abilities = this.game.call('getEntityAbilities', unitId);
                if (abilities) {
                    const buildAbility = abilities.find(a => a.id === 'BuildAbility');
                    if (buildAbility) {
                        return unitId;
                    }
                }
            }
        }
        return null;
    }

    assignBuilderToConstruction(builderEntityId, buildingEntityId) {
        // Use GameInterfaceSystem for the actual builder assignment
        this.game.call('ui_assignBuilder', builderEntityId, buildingEntityId, (result) => {
            if (result && result.success) {
                const { targetPosition } = result.data;

                // Store peasantId in ability for completion tracking
                const abilities = this.game.call('getEntityAbilities', builderEntityId);
                if (abilities) {
                    const buildAbility = abilities.find(a => a.id === 'BuildAbility');
                    if (buildAbility) {
                        buildAbility.peasantId = builderEntityId;
                    }
                }

                // Show visual feedback
                if (this.game.effectsSystem && targetPosition) {
                    this.game.call('createParticleEffect', targetPosition.x, 0, targetPosition.z, 'magic', { count: 8, color: 0xffaa00 });
                }

                this.game.uiSystem?.showNotification('Peasant assigned to continue construction', 'success', 1000);
            }

            // Keep targeting active
            this.startTargeting();
        });
    }

    onBattleStart() {
        this.stopTargeting();
    }

    onDeSelectAll() {
        if (this.targetingPreview) {
            this.targetingPreview.clear();
        }
        if (this.orderPreview) {
            this.orderPreview.clear();
        }
    }

    // ==================== EXPERIENCE & LEVELING ACTIONS ====================

    /**
     * Check if an action should be shown based on squad state
     * @param {string} actionId - The action ID to check
     * @param {number} selectedUnitId - The selected unit entity ID
     * @returns {boolean} Whether the action should be displayed
     */
    shouldShowAction(actionId, selectedUnitId) {
        // Check if action is hidden
        const action = this.collections.actions?.[actionId];
        if (action?.hidden) return false;

        const placementIds = this.game.call('getSelectedSquads') || [];
        console.log('[shouldShowAction] actionId:', actionId, 'placementIds:', placementIds);
        if (!placementIds.length) return actionId !== 'levelUp' && actionId !== 'specialize';

        const placementId = placementIds[0];
        const squadData = this.game.squadExperienceSystem?.getSquadExperience(placementId);
        console.log('[shouldShowAction] squadData:', squadData);

        if (actionId === 'levelUp') {
            const result = squadData?.canLevelUp === true;
            console.log('[shouldShowAction] levelUp result:', result);
            return result;
        }
        if (actionId === 'specialize') {
            const unitType = this.game.squadExperienceSystem?.getCurrentUnitType(placementId);
            return squadData?.level >= 2 && unitType?.specUnits?.length > 0;
        }
        return true;
    }

    /**
     * Level up the selected squad
     */
    levelUpSquadAction() {
        console.log('[LevelUp] levelUpSquadAction called');
        const placementIds = this.game.call('getSelectedSquads') || [];
        console.log('[LevelUp] placementIds:', placementIds);
        if (!placementIds.length) return;

        const placementId = placementIds[0];
        const squadData = this.game.squadExperienceSystem?.getSquadExperience(placementId);
        console.log('[LevelUp] squadData:', squadData);
        if (!squadData?.canLevelUp) {
            this.game.uiSystem?.showNotification('Not ready to level up', 'warning', 800);
            return;
        }

        const playerGold = this.game.call('getPlayerGold');
        console.log('[LevelUp] playerGold:', playerGold);
        if (!this.game.call('canAffordLevelUp', placementId, playerGold)) {
            const cost = this.game.call('getLevelUpCost', placementId);
            this.game.uiSystem?.showNotification(`Need ${cost} gold`, 'warning', 800);
            return;
        }

        const currentLevel = squadData.level;
        const unitType = this.game.squadExperienceSystem?.getCurrentUnitType(placementId);
        const willBeLevel2 = currentLevel + 1 === 2;
        const hasSpecializations = unitType?.specUnits?.length > 0;

        console.log('[LevelUp] calling levelSquad service');
        this.game.call('levelSquad', { placementId }, (success) => {
            console.log('[LevelUp] levelSquad callback, success:', success);
            if (success) {
                this.game.uiSystem?.showNotification('Leveled up!', 'success', 1000);
                this.showSquadActionPanel(placementId);
                // If unit just reached level 2 and has specializations, show selection
                if (willBeLevel2 && hasSpecializations) {
                    const newSquadData = this.game.squadExperienceSystem?.getSquadExperience(placementId);
                    if (newSquadData) {
                        this.game.squadExperienceSystem.showSpecializationSelection(placementId, newSquadData, () => {});
                    }
                }
            } else {
                this.game.uiSystem?.showNotification('Level up failed', 'error', 800);
            }
        });
    }

    /**
     * Show specialization selection for the selected squad
     */
    specializeSquadAction() {
        const placementIds = this.game.call('getSelectedSquads') || [];
        if (!placementIds.length) return;

        const placementId = placementIds[0];
        const squadData = this.game.squadExperienceSystem?.getSquadExperience(placementId);
        const unitType = this.game.squadExperienceSystem?.getCurrentUnitType(placementId);

        if (!squadData || squadData.level < 2) {
            this.game.uiSystem?.showNotification('Must be level 2', 'warning', 800);
            return;
        }

        if (!unitType?.specUnits?.length) {
            this.game.uiSystem?.showNotification('No specializations available', 'warning', 800);
            return;
        }

        this.game.squadExperienceSystem.showSpecializationSelection(placementId, squadData, () => {});
    }

    destroy() {
        this.stopTargeting();
        if (this.targetingPreview) {
            this.targetingPreview.dispose();
            this.targetingPreview = null;
        }
        if (this.orderPreview) {
            this.orderPreview.dispose();
            this.orderPreview = null;
        }
    }

    onSceneUnload() {
        this.destroy();
    }
}
