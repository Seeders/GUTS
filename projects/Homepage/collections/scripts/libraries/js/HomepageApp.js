class HomepageApp {
    constructor(engine) {
        this.engine = engine;
    }

    async init() {
        // Interface already loaded by SimpleLoader via Engine
        await this.loadProjects();
    }

    async loadProjects() {
        const grid = document.getElementById('projects-grid');
        if (!grid) return;

        try {
            const response = await fetch('/list-projects');
            const data = await response.json();

            // Filter out Editor and Homepage from the projects list
            const projects = data.projects.filter(p => p !== 'Editor' && p !== 'Homepage');

            if (projects.length === 0) {
                grid.innerHTML = '<p class="homepage__empty">No projects found. Create one in the Editor!</p>';
                return;
            }

            grid.innerHTML = projects.map(project => `
                <a href="/projects/${project}/index.html" target="_blank" class="homepage__card">
                    <span class="homepage__card-icon">&#127918;</span>
                    <h3 class="homepage__card-title">${project}</h3>
                    <p class="homepage__card-description">Launch the ${project} game project.</p>
                </a>
            `).join('');
        } catch (error) {
            console.error('Failed to load projects:', error);
            grid.innerHTML = '<p class="homepage__empty">Failed to load projects.</p>';
        }
    }
}
