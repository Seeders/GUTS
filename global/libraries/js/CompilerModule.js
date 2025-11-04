class CompilerModule {
    constructor(app, config, libraries) {
        this.app = app;
        this.config = config;
        this.libraries = libraries;
        this.compiler = null;
        this.currentCompilation = null;
        this.init();
    }

    init() {
        // Create compiler instance
        this.compiler = new GUTS.Compiler(this.app);
        
        // Add to editor interface if needed
        this.setupUI();
    }

    setupUI() {
        // Create compiler button in editor toolbar
        const toolbar = document.querySelector('.sidebar-actions');
        if (!toolbar) return;

        const compileBtn = document.createElement('button');
        compileBtn.innerHTML = '🔨 Compile';
        compileBtn.onclick = () => this.openCompilerDialog();
        
        toolbar.appendChild(compileBtn);
    }

    openCompilerDialog() {
        // Create modal dialog
        document.getElementById('modal-compilerModal')?.classList.add('show');
        window.compilerModule = this; // Temporary reference for onclick handlers
    }

    async compile() {
        const projectName = this.app.model.state.currentProject;
        const outputName = document.getElementById('compileOutputName').value;
        const includeMetadata = document.getElementById('compileIncludeMetadata').checked;
        const generateHTML = document.getElementById('compileGenerateHTML').checked;

        const output = document.getElementById('compilationOutput');
        const log = document.getElementById('compilationLog');
        
        output.style.display = 'block';
        log.textContent = 'Starting compilation...\n';

        try {
            // Compile
            log.textContent += 'Loading project configuration...\n';
            const result = await this.compiler.compile(projectName, this.app.getCollections());
            
            log.textContent += `✓ Compiled ${result.classRegistry.systems.length} systems\n`;
            log.textContent += `✓ Compiled ${result.classRegistry.managers.length} managers\n`;
            log.textContent += `✓ Compiled ${result.classRegistry.components.length} components\n`;
            log.textContent += `✓ Compiled ${result.classRegistry.functions.length} functions\n`;
            log.textContent += `✓ Bundle size: ${Math.round(result.code.length / 1024)} KB\n\n`;

            // Create download links
            this.createDownloads(result, outputName, includeMetadata, generateHTML);
            
            log.textContent += '✓ Compilation complete!\n';
            log.textContent += 'Download links created above.\n';

            this.currentCompilation = result;

        } catch (error) {
            log.textContent += `\n✗ Error: ${error.message}\n`;
            console.error(error);
        }
    }

    createDownloads(result, outputName, includeMetadata, generateHTML) {
        const modal = document.querySelector('#modal-compilerModal .modal-body');
        
        // Remove old downloads section if exists
        const oldSection = modal.querySelector('.downloads-section');
        if (oldSection) oldSection.remove();

        const downloads = document.createElement('div');
        downloads.className = 'downloads-section';
        downloads.innerHTML = '<h3>Download Files:</h3>';

        // Bundle download
        const bundleBlob = new Blob([result.code], { type: 'application/javascript' });
        const bundleUrl = URL.createObjectURL(bundleBlob);
        const bundleLink = document.createElement('a');
        bundleLink.href = bundleUrl;
        bundleLink.download = outputName;
        bundleLink.textContent = `📦 ${outputName}`;
        bundleLink.className = 'download-link';
        downloads.appendChild(bundleLink);
        downloads.appendChild(document.createElement('br'));

        // Metadata download
        if (includeMetadata) {
            const metadata = {
                projectName: result.projectName,
                timestamp: result.timestamp,
                classRegistry: result.classRegistry,
                dependencies: result.dependencies
            };
            const metaBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
            const metaUrl = URL.createObjectURL(metaBlob);
            const metaLink = document.createElement('a');
            metaLink.href = metaUrl;
            metaLink.download = outputName.replace('.js', '.meta.json');
            metaLink.textContent = `📄 ${outputName.replace('.js', '.meta.json')}`;
            metaLink.className = 'download-link';
            downloads.appendChild(metaLink);
            downloads.appendChild(document.createElement('br'));
        }

        // HTML download
        if (generateHTML) {
            const html = this.compiler.generateCompiledHTML(result.projectName, outputName);
            const htmlBlob = new Blob([html], { type: 'text/html' });
            const htmlUrl = URL.createObjectURL(htmlBlob);
            const htmlLink = document.createElement('a');
            htmlLink.href = htmlUrl;
            htmlLink.download = outputName.replace('.js', '.html');
            htmlLink.textContent = `🌐 ${outputName.replace('.js', '.html')}`;
            htmlLink.className = 'download-link';
            downloads.appendChild(htmlLink);
        }

        modal.insertBefore(downloads, document.getElementById('compilationOutput'));
    }

    // Quick compile shortcut
    async quickCompile() {
        if (!this.app.currentProject) {
            alert('No project loaded');
            return;
        }

        try {
            console.log('Quick compiling...');
            const result = await this.compiler.compile(this.app.currentProject);
            
            // Auto-download
            const blob = new Blob([result.code], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.app.currentProject.toLowerCase()}-compiled.js`;
            a.click();
            
            console.log('Quick compile complete!', result);
            alert(`Compiled successfully!\nBundle size: ${Math.round(result.code.length / 1024)} KB`);

        } catch (error) {
            console.error('Quick compile failed:', error);
            alert(`Compilation failed: ${error.message}`);
        }
    }
}

if(typeof CompilerModule != 'undefined'){
    // Export for use
    if (typeof window !== 'undefined') {
        window.CompilerModule = CompilerModule;    
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { CompilerModule, compilerModuleDefinition, compilerCSS };
    }
}