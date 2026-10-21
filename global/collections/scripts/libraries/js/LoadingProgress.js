/**
 * LoadingProgress - Tracks and displays loading progress for game assets
 *
 * Usage:
 *   const progress = new LoadingProgress();
 *   progress.addPhase('textures', 10);  // 10 textures to load
 *   progress.addPhase('models', 5);     // 5 models to load
 *   progress.start();
 *
 *   // During loading:
 *   progress.increment('textures');     // Each texture loaded
 *   progress.increment('models');       // Each model loaded
 */
class LoadingProgress {
    /**
     * @param {Object} [screenConfig] - configs.game.loadingScreen: the game's own loading
     *   screen and its text (see SceneManager.loadingScreen); without it, the page's
     *   loadingProgressBar / loadingText elements show progress.
     */
    constructor(screenConfig = null) {
        this.screenConfig = screenConfig || null;
        this.phases = new Map();
        this.totalItems = 0;
        this.loadedItems = 0;
        this.currentPhase = '';
        this.onProgress = null;

        // DOM elements (will be found when start() is called)
        this.progressBar = null;
        this.progressText = null;
        this.loadingText = null;
    }

    /**
     * Add a loading phase with a number of items
     * @param {string} phaseName - Name of the phase (e.g., 'textures', 'models')
     * @param {number} itemCount - Number of items in this phase
     */
    addPhase(phaseName, itemCount) {
        this.phases.set(phaseName, {
            total: itemCount,
            loaded: 0
        });
        this.totalItems += itemCount;
    }

    /**
     * Initialize and show the loading UI
     */
    start() {
        this.progressBar = document.getElementById('loadingProgressBar');
        this.progressText = document.getElementById('loadingProgressText');
        this.loadingText = document.getElementById('loadingText');
        const cfg = this.screenConfig;
        this.screen?.show({ title: cfg.title, kicker: cfg.kicker, subtitle: cfg.subtitle });

        this.update();
    }

    /**
     * Increment progress for a phase
     * @param {string} phaseName - Name of the phase
     * @param {number} count - Number of items to increment (default 1)
     */
    increment(phaseName, count = 1) {
        const phase = this.phases.get(phaseName);
        if (phase) {
            phase.loaded = Math.min(phase.loaded + count, phase.total);
            this.loadedItems += count;
            this.currentPhase = phaseName;
            this.update();
        }
    }

    /**
     * Set progress for a phase directly
     * @param {string} phaseName - Name of the phase
     * @param {number} loaded - Number of items loaded
     */
    setProgress(phaseName, loaded) {
        const phase = this.phases.get(phaseName);
        if (phase) {
            const diff = loaded - phase.loaded;
            phase.loaded = Math.min(loaded, phase.total);
            this.loadedItems += diff;
            this.currentPhase = phaseName;
            this.update();
        }
    }

    /**
     * Get current progress as a percentage
     * @returns {number} Progress percentage (0-100)
     */
    getProgress() {
        if (this.totalItems === 0) return 100;
        return Math.round((this.loadedItems / this.totalItems) * 100);
    }

    /**
     * Get a display name for a phase
     * @param {string} phaseName
     * @returns {string}
     */
    getPhaseDisplayName(phaseName) {
        const screen = this.screen;
        if (screen?.phaseName) return screen.phaseName(phaseName);
        if (this.screenConfig?.phases) {
            return this.screenConfig.phases[phaseName] || `${this.screenConfig.phaseFallback || 'Loading'} ${phaseName}`;
        }
        const names = {
            'textures': 'Loading Textures',
            'models': 'Loading Models',
            'images': 'Loading Images',
            'sounds': 'Loading Sounds',
            'data': 'Loading Data',
            'init': 'Initializing'
        };
        return names[phaseName] || `Loading ${phaseName}`;
    }

    /**
     * Update the UI with current progress
     */
    update() {
        const percent = this.getProgress();

        if (this.progressBar) {
            this.progressBar.style.width = `${percent}%`;
        }

        if (this.progressText) {
            this.progressText.textContent = `${percent}%`;
        }

        if (this.loadingText && this.currentPhase) {
            const phase = this.phases.get(this.currentPhase);
            if (phase) {
                this.loadingText.textContent = `${this.getPhaseDisplayName(this.currentPhase)} (${phase.loaded}/${phase.total})`;
            }
        }

        this.screen?.progress(percent / 100, this.currentPhase ? this.getPhaseDisplayName(this.currentPhase) : null);

        if (this.onProgress) {
            this.onProgress(percent, this.currentPhase);
        }
    }

    /**
     * Mark loading as complete
     */
    complete() {
        this.loadedItems = this.totalItems;
        if (this.progressBar) {
            this.progressBar.style.width = '100%';
        }
        if (this.progressText) {
            this.progressText.textContent = '100%';
        }
        if (this.loadingText) {
            this.loadingText.textContent = this.screenConfig?.completeText || 'Complete!';
        }
        this.screen?.progress(1, this.screenConfig?.completeLabel || this.screenConfig?.completeText || null);
    }

    /** The game's own loading screen library (configs.game.loadingScreen.library), if any. */
    get screen() {
        const library = this.screenConfig?.library;
        return (library && typeof GUTS !== 'undefined' && GUTS[library]) || null;
    }
}
