/**
 * WarGame - Game class for the War card game
 * Game logic is handled by WarGameSystem
 */
class WarGame extends GUTS.BaseECSGame {
    constructor(app) {
        super(app);
        this.gameInstance = this;
        this.state.gameOver = false;
        this.clientNetworkManager = new GUTS.ClientNetworkManager(this);
    }

    getConfig() {
        const configs = this.getCollections()?.configs || {};
        return configs.game || {};
    }
}
