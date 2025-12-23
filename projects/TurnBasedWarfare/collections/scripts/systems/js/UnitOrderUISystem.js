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
        if (this.game.state.phase !== this.enums.gamePhase.placement) return;
        this.isTargeting = true;
        this.orderMeta = meta;
        this.pendingCallbacks = 0;
    }

    stopTargeting() {
        if (!this.isTargeting) return;
        this.isTargeting = false;
        this.orderMeta = {};

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

    /**
     * Handle input results from GameInterfaceSystem
     * Called via game event 'onInputResult'
     */
    onInputResult(result) {
        if (!result) return;

        if (result.action === 'move_order') {
            if (result.success) {
                const { targetPosition } = result.data;

                // Show visual feedback
                if (this.game.effectsSystem && targetPosition) {
                    this.game.call('createParticleEffect', targetPosition.x, 0, targetPosition.z, 'magic', { ...this.pingEffect });
                }

                // Keep targeting active and update preview
                this.startTargeting();
                this.showMoveTargets();
            }
        } else if (result.action === 'assign_builder') {
            if (result.success) {
                const { builderEntityId, targetPosition } = result.data;

                // Store peasantId in ability for completion tracking
                const abilities = this.game.call('getEntityAbilities', builderEntityId);
                if (abilities) {
                    const buildAbility = abilities.find(a => a.id === 'build');
                    if (buildAbility) {
                        buildAbility.peasantId = builderEntityId;
                    }
                }

                // Show visual feedback
                if (this.game.effectsSystem && targetPosition) {
                    this.game.call('createParticleEffect', targetPosition.x, 0, targetPosition.z, 'magic', { count: 8, color: 0xffaa00 });
                }

                this.game.uiSystem?.showNotification('Peasant assigned to continue construction', 'success', 1000);

                // Keep targeting active
                this.startTargeting();
            }
        }
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
