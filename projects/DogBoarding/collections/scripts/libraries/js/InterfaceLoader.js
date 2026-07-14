/**
 * InterfaceLoader - swaps the interface in #appContainer.
 *
 * Mirrors what SceneManager.loadSceneInterface does for ECS projects, because a
 * pure-DOM project has no SceneManager but still wants its markup to live in the
 * interfaces collection rather than in a template literal in a JS file.
 *
 * The `baseInterface` named in game.json is CSS-only and always injected: it
 * carries the design tokens and the components both faces share.
 */
class InterfaceLoader {
    constructor(engine) {
        this.engine = engine;
        this.current = null;
    }

    get collections() {
        return this.engine.collections;
    }

    get container() {
        return document.getElementById('appContainer');
    }

    /** Inject an interface's CSS once, keyed by id so a reload is a no-op. */
    injectCss(name) {
        const data = this.collections.interfaces?.[name];
        if (!data || !data.css) return;

        const id = `interface-${name}-styles`;
        if (document.getElementById(id)) return;

        const style = document.createElement('style');
        style.id = id;
        style.textContent = data.css;
        document.head.appendChild(style);
    }

    /**
     * Show an interface. Returns its root element so the caller can query it.
     * Re-showing the interface already on screen does nothing - that keeps form
     * state alive when the router lands on a route of the same interface.
     */
    load(name) {
        const container = this.container;

        const baseName = this.collections.configs?.game?.baseInterface;
        if (baseName) this.injectCss(baseName);

        this.injectCss(name);

        if (container.dataset.currentInterface === name) {
            return container;
        }

        const data = this.collections.interfaces?.[name];
        if (!data || !data.html) {
            console.error(`[InterfaceLoader] Interface '${name}' has no HTML in the collection.`);
            return container;
        }

        container.innerHTML = data.html;
        container.dataset.currentInterface = name;
        this.current = name;

        return container;
    }

    /** Clone a <template data-template="x"> out of the current interface. */
    template(name) {
        const node = this.container.querySelector(`template[data-template="${name}"]`);
        if (!node) {
            console.error(`[InterfaceLoader] No template named '${name}' in the current interface.`);
            return document.createElement('div');
        }
        return node.content.firstElementChild.cloneNode(true);
    }
}
