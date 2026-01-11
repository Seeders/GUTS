/**
 * ChatUISystem - TurnBasedWarfare implementation of global ChatSystem
 * Initializes and manages the chat UI for multiplayer games
 */
class ChatUISystem extends GUTS.BaseSystem {
    static services = [];

    constructor(game) {
        super(game);
        this.chatSystem = null;
    }

    init(params) {
        this.params = params || {};

        // Initialize the global ChatSystem library
        if (GUTS.ChatSystem) {
            this.chatSystem = new GUTS.ChatSystem(this.game, this.collections);
            this.chatSystem.init();
        }
    }

    dispose() {
        if (this.chatSystem) {
            this.chatSystem.dispose();
            this.chatSystem = null;
        }
    }
}
