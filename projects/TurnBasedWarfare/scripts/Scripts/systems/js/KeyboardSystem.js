class KeyboardSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.keyboardSystem = this;
    }
}