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
        this.createHelloMessage();
    }

    createHelloMessage() {
        // Create a simple HTML overlay to display "Hello World"
        const overlay = document.createElement('div');
        overlay.id = 'hello-overlay';
        overlay.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 48px;
            font-family: Arial, sans-serif;
            color: white;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
            pointer-events: none;
            z-index: 1000;
        `;
        overlay.textContent = 'Hello World!';

        const container = document.getElementById('game') || document.body;
        container.appendChild(overlay);
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
