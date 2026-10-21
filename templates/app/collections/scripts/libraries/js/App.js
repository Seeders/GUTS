class App {
    constructor(engine) {
        this.engine = engine;
    }

    async init() {
        const config = this.engine.collections.configs.game;
        document.getElementById('title').textContent = config.title;
    }
}
