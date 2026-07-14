/**
 * DogBoardingApp - the entry point GUTS instantiates (appLibrary in game.json).
 *
 * The routes are not written here. They come from the `scenes` collection: each
 * scene declares its `route`, the `interface` it wants on screen, and which
 * `page` of that interface to show. Adding a page is a new scene JSON, not a new
 * branch in a switch statement.
 *
 * Everything else the app says or asks comes from collections too - `content`
 * for copy, `forms` for form schemas, `adminNav` for the sidebar, and the enum
 * collections (recordTypes, expenseCategories, paymentMethods, bookingStatuses,
 * serviceUnits) for every dropdown.
 */
class DogBoardingApp {
    constructor(engine) {
        this.engine = engine;
    }

    get collections() {
        return this.engine.collections;
    }

    async init() {
        this.api = new GUTS.DogBoardApi();
        this.ui = GUTS.DogBoardUI;
        this.interfaces = new GUTS.InterfaceLoader(this.engine);
        this.forms = new GUTS.FormRenderer(this.engine);

        this.publicSite = new GUTS.PublicSite(this);
        this.admin = new GUTS.AdminConsole(this);

        // Business details live in the database (they are edited in Settings),
        // so the header and footer are filled from the API, not a collection.
        // Check any stored session at the same time: a token can easily outlive
        // the database that issued it, and we would rather find that out here
        // than by getting a 401 while rendering the dashboard.
        const [info] = await Promise.all([
            this.api.info(),
            this.api.verifySession()
        ]);
        this.info = info;

        this.routes = this.buildRoutes();

        window.addEventListener('hashchange', () => this.route());

        /**
         * Every form in this app is submitted here, by delegation.
         *
         * Binding a handler to the form element itself (form.onsubmit = ...) is
         * fragile: the forms now live in the interface markup, so the element
         * you bound can be replaced out from under you by a later interface
         * load, leaving a form on screen that looks fine and does nothing. That
         * is exactly what "nothing happens when I click login" is.
         *
         * A listener on the document cannot be lost that way. It does not care
         * when the form appeared, how many times the interface has been
         * re-injected, or whether anyone remembered to wire it up.
         *
         * Capture phase, and preventDefault first, because nothing here should
         * ever submit natively: for the login form that would put the password
         * in the URL, and for the intake form the client's home address.
         */
        document.addEventListener('submit', (e) => {
            e.preventDefault();

            const form = e.target;
            if (!(form instanceof HTMLFormElement)) return;

            if (form.matches('[data-login-form]')) {
                this.admin.submitLogin(form);
            } else if (form.matches('[data-form="intake"]')) {
                this.publicSite.submitIntake(form);
            }
            // Anything else is a form built in JS, which wires its own handler.
        }, true);

        window.addEventListener('dogboard:unauthorized', () => {
            if (this.currentPath().startsWith('/admin')) {
                this.ui.toast('Your session expired. Please log in again.', 'warn');
                this.route();
            }
        });

        document.getElementById('appContainer').style.display = 'block';

        await this.route();
    }

    /** The route table, read off the scenes collection. */
    buildRoutes() {
        return this.ui.ordered(this.collections.scenes)
            .filter(scene => scene.route)
            .map(scene => ({
                id: scene.id,
                route: scene.route,
                page: scene.page,
                interface: scene.interface,
                title: scene.title
            }));
    }

    currentPath() {
        return window.location.hash.replace(/^#/, '') || '/';
    }

    /**
     * Longest matching route wins, so /admin/clients/12 resolves to the /admin
     * scene while / stays the home page.
     */
    matchScene(path) {
        const exact = this.routes.find(r => r.route === path);
        if (exact) return exact;

        const prefixed = this.routes
            .filter(r => r.route !== '/' && path.startsWith(r.route))
            .sort((a, b) => b.route.length - a.route.length)[0];

        return prefixed || this.routes.find(r => r.route === '/');
    }

    navigate(path) {
        if (this.currentPath() === path) this.route();
        else window.location.hash = path;
    }

    async route() {
        const path = this.currentPath();
        const scene = this.matchScene(path);
        if (!scene) return;

        window.scrollTo(0, 0);
        document.body.classList.toggle('is-admin', scene.interface === 'admin');

        const root = this.interfaces.load(scene.interface);

        try {
            if (scene.interface === 'admin') {
                await this.admin.render(root, path);
            } else {
                await this.publicSite.render(root, scene, path);
            }
        } catch (err) {
            console.error(err);
            this.ui.mount(root, this.ui.el('div.fatal',
                this.ui.el('h1', 'Something went wrong'),
                this.ui.el('p', err.message || String(err)),
                this.ui.el('button.btn.btn--primary',
                    { onclick: () => this.route() }, 'Try again')));
        }
    }
}
