/**
 * DogBoardingApp - the entry point GUTS instantiates (appLibrary in game.json).
 *
 * SimpleLoader has already injected the interface HTML/CSS into #appContainer
 * by the time init() runs, so all we do here is own the hash router and hand
 * off to either the public site or the admin console.
 *
 *   #/               public home
 *   #/services       price list
 *   #/register       new client intake
 *   #/admin[/...]    the back office
 */
class DogBoardingApp {
    constructor(engine) {
        this.engine = engine;
        this.api = null;
        this.root = null;
    }

    async init() {
        this.api = new GUTS.DogBoardApi();
        this.ui = GUTS.DogBoardUI;

        this.root = document.getElementById('app')
            || document.getElementById('appContainer');

        this.publicSite = new GUTS.PublicSite(this);
        this.admin = new GUTS.AdminConsole(this);

        window.addEventListener('hashchange', () => this.route());

        // The API client fires this when a token is rejected or has expired.
        window.addEventListener('dogboard:unauthorized', () => {
            if (this.currentPath().startsWith('/admin')) {
                GUTS.DogBoardUI.toast('Your session expired. Please log in again.', 'warn');
                this.admin.render(this.root, '/admin');
            }
        });

        document.getElementById('appContainer').style.display = 'block';

        await this.route();
    }

    currentPath() {
        const hash = window.location.hash.replace(/^#/, '');
        return hash || '/';
    }

    navigate(path) {
        if (this.currentPath() === path) this.route();
        else window.location.hash = path;
    }

    async route() {
        const path = this.currentPath();
        window.scrollTo(0, 0);

        try {
            if (path.startsWith('/admin')) {
                document.body.classList.add('is-admin');
                await this.admin.render(this.root, path);
            } else {
                document.body.classList.remove('is-admin');
                await this.publicSite.render(this.root, path);
            }
        } catch (err) {
            console.error(err);
            GUTS.DogBoardUI.mount(this.root,
                GUTS.DogBoardUI.el('div.fatal',
                    GUTS.DogBoardUI.el('h1', 'Something went wrong'),
                    GUTS.DogBoardUI.el('p', err.message || String(err)),
                    GUTS.DogBoardUI.el('button.btn.btn--primary',
                        { onclick: () => this.route() }, 'Try again')));
        }
    }
}
