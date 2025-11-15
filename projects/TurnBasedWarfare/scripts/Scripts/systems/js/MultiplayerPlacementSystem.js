/**
 * MultiplayerPlacementSystem - Client-side placement system
 * Thin wrapper that composes PlacementSystem with ClientPlacementUI
 */
class MultiplayerPlacementSystem extends PlacementSystem {
    constructor(game, sceneManager) {
        super(game);

        // Initialize client-specific UI controller
        this.clientUI = new ClientPlacementUI(this, sceneManager);
    }

    init(params) {
        super.init(params);
    }

    // Delegate client-specific lifecycle events to UI controller
    onGameStarted() {
        if (this.clientUI) {
            this.clientUI.onGameStarted();
        }
    }

    onPlacementPhaseStart() {
        if (this.clientUI) {
            this.clientUI.onPlacementPhaseStart();
        }
    }

    handleCanvasClick(event) {
        if (this.clientUI) {
            this.clientUI.handleCanvasClick(event);
        }
    }

    handleUnitSelectionChange() {
        if (this.clientUI) {
            this.clientUI.handleUnitSelectionChange();
        }
    }

    onActivateBuildingPlacement() {
        if (this.clientUI) {
            this.clientUI.onActivateBuildingPlacement();
        }
    }

    handleReadyForBattleUpdate(data) {
        if (this.clientUI) {
            this.clientUI.handleReadyForBattleUpdate(data);
        }
    }

    // Expose client UI methods for external access
    getPlacementsForSide(side) {
        if (side === this.game.state.mySide) {
            return this.clientUI.playerPlacements;
        } else {
            return this.clientUI.opponentPlacements;
        }
    }
}
