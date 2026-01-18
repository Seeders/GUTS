class BaseLoader {
    constructor(game) {
        this.game = game;
    }
    async load(){
        this.collections = this.game.getCollections();
        await this.game.init(false);
    }
}