class HelloSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.helloSystem = this;
        this.messageDisplayed = false;
    }

    init() {
        // Register any game manager functions here
    }

    onSceneLoad(sceneData) {
        console.log('[HelloSystem] Hello World scene loaded!');

    }

    update() {
        // Called every frame - could animate the message here
    }

    onSceneUnload() {
        // Clean up when scene unloads
        const overlay = document.getElementById('hello-overlay');
        if (overlay) {
            overlay.remove();
        }
    }
}
