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
        this.compiler = new GUTS.Compiler(this.app);
        this.setupUI();
    }

    setupUI() {
        const toolbar = document.querySelector('.sidebar-actions');
        if (!toolbar) return;

        const compileBtn = document.createElement('button');
        compileBtn.innerHTML = '🔨 Compile';
        compileBtn.onclick = () => this.openCompilerDialog();
        
        toolbar.appendChild(compileBtn);
    }

    openCompilerDialog() {
        document.getElementById('modal-compilerModal')?.classList.add('show');
        window.compilerModule = this;
    }

    async compile() {
        const projectName = this.app.model.state.currentProject;
        const includeMetadata = document.getElementById('compileIncludeMetadata').checked;
        const includeEngine = document.getElementById('compileIncludeEngine')?.checked ?? true;
        const createZip = document.getElementById('compileCreateZip')?.checked ?? true; // NEW

        const output = document.getElementById('compilationOutput');
        const log = document.getElementById('compilationLog');
        
        output.style.display = 'block';
        log.textContent = 'Starting compilation...\n';

        try {
            log.textContent += 'Loading project configuration...\n';
            
            const enginePaths = includeEngine ? {
                moduleManager: './../../engine/ModuleManager.js',
                baseEngine: './../../engine/BaseEngine.js',
                engine: './../../engine/Engine.js'
            } : null;
            
            const result = await this.compiler.compile(
                projectName, 
                this.app.getCollections(),
                enginePaths
            );
            
            log.textContent += `✓ Compiled ${result.classRegistry.systems.length} systems\n`;
            log.textContent += `✓ Compiled ${result.classRegistry.managers.length} managers\n`;
            log.textContent += `✓ Compiled ${result.classRegistry.components.length} components\n`;
            log.textContent += `✓ Compiled ${result.classRegistry.functions.length} functions\n`;
            log.textContent += `✓ Game bundle: ${Math.round(result.code.length / 1024)} KB\n`;
            
            if (result.engineCode) {
                log.textContent += `✓ Engine bundle: ${Math.round(result.engineCode.length / 1024)} KB\n`;
            }
            
            log.textContent += '\n';

            // Create downloads (individual files or zip)
            if (createZip) {
                await this.createZipDownload(result);
                log.textContent += '✓ Created zip bundle!\n';
            } else {
                this.createDownloads(result, includeMetadata);
            }
            
            log.textContent += '✓ Compilation complete!\n';
            log.textContent += 'Download links created above.\n';

            this.currentCompilation = result;

        } catch (error) {
            log.textContent += `\n✗ Error: ${error.message}\n`;
            console.error(error);
        }
    }

    async createZipDownload(result) {
        const modal = document.querySelector('#modal-compilerModal .modal-body');
        
        const oldSection = modal.querySelector('.downloads-section');
        if (oldSection) oldSection.remove();

        const downloads = document.createElement('div');
        downloads.className = 'downloads-section';
        downloads.innerHTML = '<h3>Download Files:</h3>';

        try {
            // Create zip bundle
            const zipBlob = await this.compiler.createZipBundle(result);
            
            // Create download link
            const zipUrl = URL.createObjectURL(zipBlob);
            const zipLink = document.createElement('a');
            zipLink.href = zipUrl;
            zipLink.download = `${result.projectName.toLowerCase().replace(/\s+/g, '-')}-compiled.zip`;
            zipLink.textContent = `📦 ${result.projectName}-compiled.zip (${Math.round(zipBlob.size / 1024)} KB)`;
            zipLink.className = 'download-link';
            downloads.appendChild(zipLink);
            
        } catch (error) {
            downloads.innerHTML += `<p style="color: red;">Error creating zip: ${error.message}</p>`;
        }

        modal.insertBefore(downloads, document.getElementById('compilationOutput'));
    }

    createDownloads(result, includeMetadata) {
        const modal = document.querySelector('#modal-compilerModal .modal-body');
        const outputName = "game.js";
        const oldSection = modal.querySelector('.downloads-section');
        if (oldSection) oldSection.remove();

        const downloads = document.createElement('div');
        downloads.className = 'downloads-section';
        downloads.innerHTML = '<h3>Download Files:</h3>';

        // Game bundle
        const bundleBlob = new Blob([result.engineCode + "\n\n" + result.code], { type: 'application/javascript' });
        const bundleUrl = URL.createObjectURL(bundleBlob);
        const bundleLink = document.createElement('a');
        bundleLink.href = bundleUrl;
        bundleLink.download = outputName;
        bundleLink.textContent = `📦 ${outputName}`;
        bundleLink.className = 'download-link';
        downloads.appendChild(bundleLink);
        downloads.appendChild(document.createElement('br'));

        // // Engine bundle
        // if (result.engineCode) {
        //     const engineBlob = new Blob([result.engineCode], { type: 'application/javascript' });
        //     const engineUrl = URL.createObjectURL(engineBlob);
        //     const engineLink = document.createElement('a');
        //     engineLink.href = engineUrl;
        //     engineLink.download = 'engine.js';
        //     engineLink.textContent = `⚙️ engine.js`;
        //     engineLink.className = 'download-link';
        //     downloads.appendChild(engineLink);
        //     downloads.appendChild(document.createElement('br'));
        // }

        // Metadata
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

        modal.insertBefore(downloads, document.getElementById('compilationOutput'));
    }

    async quickCompile() {
        if (!this.app.currentProject) {
            alert('No project loaded');
            return;
        }

        try {
            console.log('Quick compiling...');
            const result = await this.compiler.compile(
                this.app.currentProject,
                this.app.getCollections()
            );
            
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
    if (typeof window !== 'undefined') {
        window.CompilerModule = CompilerModule;    
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { CompilerModule, compilerModuleDefinition, compilerCSS };
    }
}