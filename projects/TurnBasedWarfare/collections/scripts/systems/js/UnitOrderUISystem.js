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
    }

    init() {
        // Preview created in onGameStarted when scene is available
    }

    onGameStarted() {
        // Create targeting preview after scene is available
        this.targetingPreview = new GUTS.PlacementPreview(this.game);
        this.targetingPreview.updateConfig({
            cellOpacity: 0.3,
            borderOpacity: 0.6
        });
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
                actions.forEach((actionId) => {
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
            btn.addEventListener('click', () => {
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
        this.game.state.selectedUnitType = { ...building };

        this.game.state.peasantBuildingPlacement = {
            peasantId: selectedUnitId,
            buildTime: building.buildTime
        };

        this.stopTargeting();

        this.game.triggerEvent('onActivateBuildingPlacement', this.game.state.selectedUnitType);
    }

    moveOrderAction() {
        this.startTargeting({ preventEnemiesInRangeCheck: true, preventCombat: true });
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

        let placementIds = this.game.call('getSelectedSquads') || [];

        if (!placementIds || placementIds.length === 0) {
            this.game.uiSystem?.showNotification('No units selected.', 'warning', 800);
            return;
        }

        // Calculate target positions (current positions) for each placement
        const targetPositions = [];
        placementIds.forEach((placementId) => {
            const placement = this.game.call('getPlacementById', placementId);
            // For hold position, use the first unit's current position as the squad target
            if (placement.squadUnits.length > 0) {
                const firstUnitId = placement.squadUnits[0];
                const transform = this.game.getComponent(firstUnitId, "transform");
                const position = transform?.position;
                targetPositions.push(position ? { x: position.x, y: 0, z: position.z } : null);
            } else {
                targetPositions.push(null);
            }
        });

        const meta = { isMoveOrder: false };

        // Send to server for authoritative confirmation
        this.game.call('setSquadTargets',
            { placementIds, targetPositions, meta },
            (success) => {
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
            }
        );
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
        if (!this.targetingPreview) return;

        this.targetingPreview.clear();
        const placementIds = this.game.call('getSelectedSquads') || [];
        const targetPositions = [];
        placementIds.forEach((placementId) => {
            const placement = this.game.call('getPlacementById', placementId);
            placement.squadUnits.forEach((entityId) => {
                const playerOrder = this.game.getComponent(entityId, "playerOrder");
                if (playerOrder && (playerOrder.targetPositionX !== 0 || playerOrder.targetPositionZ !== 0)) {
                    targetPositions.push({
                        x: playerOrder.targetPositionX,
                        y: playerOrder.targetPositionY,
                        z: playerOrder.targetPositionZ
                    });
                }
            });
        });

        this.targetingPreview.showAtWorldPositions(targetPositions, true);
    }

    _onCanvasClick(event) {
        if (!this.isTargeting) return;

        const canvas = this.game.canvas;
        if (!canvas) {
            this.stopTargeting();
            return;
        }

        const worldPos = this.game.call('getWorldPositionFromMouse');
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
                this.startTargeting();
                return;
            }
        }

        const targetPosition = { x: worldPos.x, y: 0, z: worldPos.z };

        if (this.game.effectsSystem) {
            this.game.call('createParticleEffect', worldPos.x, 0, worldPos.z, 'magic', { ...this.pingEffect });
        }

        this.issueMoveOrders(placementIds, targetPosition);
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
                    for (const ability of abilities) {
                        if (ability.id === 'build') {
                            return unitId;
                        }
                    }
                }
            }
        }

        return null;
    }

    assignBuilderToConstruction(builderEntityId, buildingEntityId) {
        const buildingTransform = this.game.getComponent(buildingEntityId, "transform");
        const buildingPos = buildingTransform?.position;
        const buildingPlacement = this.game.getComponent(buildingEntityId, "placement");
        const builderPlacement = this.game.getComponent(builderEntityId, "placement");

        if (!buildingPos || !buildingPlacement || !builderPlacement) return;

        // Verify the builder has BuildAbility
        const abilities = this.game.call('getEntityAbilities', builderEntityId);
        if (!abilities) return;
        const buildAbility = abilities.find(a => a.id === 'build');
        if (!buildAbility) return;

        // Send build assignment to server
        const targetPosition = { x: buildingPos.x, y: 0, z: buildingPos.z };
        const meta = {
            buildingId: buildingEntityId,
            preventEnemiesInRangeCheck: true,
            isMoveOrder: false
        };

        this.game.call('setSquadTarget',
            { placementId: builderPlacement.placementId, targetPosition, meta },
            (success) => {
                if (success) {
                    // Domain logic (applySquadTargetPosition, buildingState, assignedBuilder) now handled by ClientNetworkSystem
                    // Here we just handle UI concerns: effects, notifications, ability tracking

                    // Store peasantId in ability for completion tracking
                    buildAbility.peasantId = builderEntityId;

                    if (this.game.effectsSystem) {
                        this.game.call('createParticleEffect', buildingPos.x, 0, buildingPos.z, 'magic', { count: 8, color: 0xffaa00 });
                    }

                    this.game.uiSystem?.showNotification('Peasant assigned to continue construction', 'success', 1000);
                }
            }
        );
    }

    issueMoveOrders(placementIds, targetPosition) {
        if (this.game.state.phase !== this.enums.gamePhase.placement) {
            return;
        }
        const meta = {
            ...this.orderMeta,
            isMoveOrder: true,
            preventEnemiesInRangeCheck: !!this.orderMeta.preventEnemiesInRangeCheck
        };
        this.orderMeta = {};
        const targetPositions = this.getFormationTargetPositions(targetPosition, placementIds);
        // Send to server - server will set authoritative issuedTime and respond
        this.game.call('setSquadTargets',
            { placementIds, targetPositions, meta },
            (success) => {
                if (success) {
                    // Domain logic (applySquadsTargetPositions) now handled by ClientNetworkSystem
                    // Here we just handle UI concerns: targeting state, visual feedback
                    this.startTargeting();
                    this.showMoveTargets();
                }
            }
        );
    }

    getFormationTargetPositions(targetPosition, placementIds) {
        let targetPositions = [];
        // Use placement grid size (half of terrain grid) for unit formation spacing
        const placementGridSize = this.game.call('getPlacementGridSize');
        const unitPadding = 1;

        // Round to 2 decimal places to avoid floating-point precision issues that cause desync
        const roundPos = (val) => Math.round(val * 100) / 100;

        for (let i = 0; i < placementIds.length; i++) {
            targetPositions.push({
                x: roundPos(targetPosition.x),
                z: roundPos(i % 2 == 0 ? targetPosition.z + i * placementGridSize * unitPadding : targetPosition.z - i * placementGridSize * unitPadding)
            });
        }
        return targetPositions;
    }

    onBattleStart() {
        this.stopTargeting();
    }

    onDeSelectAll() {
        if (this.targetingPreview) {
            this.targetingPreview.clear();
        }
    }

    destroy() {
        this.stopTargeting();
        if (this.targetingPreview) {
            this.targetingPreview.dispose();
        }
    }
}
