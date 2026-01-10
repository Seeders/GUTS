/**
 * Simple loader for projects that don't need asset loading
 * Just initializes the app
 */
class SimpleLoader {
    constructor(app) {
        this.app = app;
    }

    async load() {
        // No assets to load - just initialize the app if it has an init method
        if (this.app && typeof this.app.init === 'function') {
            await this.app.init();
        }
    }
}
