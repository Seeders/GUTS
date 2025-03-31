class ZipExporter {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
        this.elements = {};
        this.init();
    }

    init(aiConfig) {
        this.setupHooks();
        const modal = document.getElementById('modal-ZipExporterPanel');
        this.config = aiConfig;
        this.elements = { modal: modal };
        this.setupEventListeners();
    }

    getCurrentObjectContext() {
        const { selectedType, selectedObject } = this.gameEditor.state;
        return this.gameEditor.getCollections()[selectedType]?.[selectedObject] || {};
    }

    setCurrentObjectValues(data) {
        const { selectedType, selectedObject } = this.gameEditor.state;
        this.gameEditor.getCollections()[selectedType][selectedObject] = data;
    }

    setupEventListeners() {
        // Placeholder for future listeners
    }

    setupHooks() {
        document.body.addEventListener('renderEditor', () => {
            // Export Current Object Button
            if (this.elements.exportCurrentObjectBtn) this.elements.exportCurrentObjectBtn.remove();
            this.elements.exportCurrentObjectBtn = document.createElement('button');
            this.elements.exportCurrentObjectBtn.innerHTML = "Export Object";
            this.elements.exportCurrentObjectBtn.id = 'save-object-btn';
            this.gameEditor.elements.editor.querySelector(".actions>div")?.appendChild(this.elements.exportCurrentObjectBtn);
            this.elements.exportCurrentObjectBtn.addEventListener('click', () => {
                this.exportCurrentObject();
            });

            // Import Current Object Button
            if (this.elements.importCurrentObjectBtn) this.elements.importCurrentObjectBtn.remove();
            this.elements.importCurrentObjectBtn = document.createElement('button');
            this.elements.importCurrentObjectBtn.innerHTML = "Import Object";
            this.elements.importCurrentObjectBtn.id = 'import-object-btn';
            this.gameEditor.elements.editor.querySelector(".actions>div")?.appendChild(this.elements.importCurrentObjectBtn);
            this.elements.importCurrentObjectBtn.addEventListener('click', () => {
                this.triggerImportJson();
            });
        });

        document.body.addEventListener('selectObject', () => {
            const { selectedType } = this.gameEditor.state;
            const category = this.gameEditor.getCategoryByType(selectedType);

            requestAnimationFrame(() => {
                // Export Project Button
                if (this.elements.exportProjectBtn) this.elements.exportProjectBtn.remove();
                this.elements.exportProjectBtn = document.createElement('button');
                this.elements.exportProjectBtn.innerHTML = "Export Project";
                this.elements.exportProjectBtn.id = 'export-project-btn';
                this.gameEditor.elements.sidebar.querySelector(".sidebar-actions>.primary")?.after(this.elements.exportProjectBtn);
                this.elements.exportProjectBtn.addEventListener('click', () => {
                    this.exportFullProject();
                });
                // Import Project Button
                if (this.elements.importProjectBtn) this.elements.importProjectBtn.remove();
                this.elements.importProjectBtn = document.createElement('button');
                this.elements.importProjectBtn.innerHTML = "Import Project";
                this.elements.importProjectBtn.id = 'import-project-btn';
                this.gameEditor.elements.sidebar.querySelector(".sidebar-actions>.primary")?.after(this.elements.importProjectBtn);
                this.elements.importProjectBtn.addEventListener('click', () => {
                    this.triggerImportProject();
                });
                // Export All in Category Button
                if (this.elements.exportAllBtn) this.elements.exportAllBtn.remove();
                this.elements.exportAllBtn = document.createElement('button');
                this.elements.exportAllBtn.innerHTML = `Export All ${category}`;
                this.elements.exportAllBtn.id = 'export-all-btn';
                this.gameEditor.elements.sidebar.querySelector(".sidebar-actions>.primary")?.after(this.elements.exportAllBtn);
                this.elements.exportAllBtn.addEventListener('click', () => {
                    this.exportCategory(category);
                });
            });
        });
    }

    // Export a JSON file
    exportJSON(fileName, jsonObj) {
        const blob = new Blob([JSON.stringify(jsonObj, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${fileName}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
    }

    // Export current object as JSON
    exportCurrentObject() {
        const { selectedType, selectedObject } = this.gameEditor.state;
        const currentObject = this.getCurrentObjectContext();
        this.exportJSON(selectedObject, currentObject);
    }

    // Export a category as a zip
    exportCategory(category) {
        const scripts = this.gameEditor.getCollectionsByCategory(category);
        this.exportZip(category, scripts);
    }

    // Export the entire project as a zip
    exportFullProject() {
        const allCollections = {};
        const defs = this.gameEditor.getCollectionDefs();

        defs.forEach(def => {
            const category = def.category;
            const collectionKey = def.id;
            const collectionData = this.gameEditor.state.project.objectTypes[collectionKey];
            if (collectionData) {
                if (!allCollections[category]) {
                    allCollections[category] = {};
                }
                allCollections[category][collectionKey] = collectionData;
            }
        });

        this.exportZip(this.gameEditor.state.currentProject, allCollections);
    }

    // Generic zip export method
    exportZip(fileName, projectData) {
        const zip = new JSZip();

        Object.keys(projectData).forEach(category => {
            const collections = projectData[category];
            Object.keys(collections).forEach(collection => {
                const objects = collections[collection];
                const folder = zip.folder(`${category}/${collection}`);

                Object.keys(objects).forEach(objKey => {
                    const objData = objects[objKey];
                    const scriptContent = objData.script || '';
                    if (scriptContent) {
                        folder.file(`${objKey}.js`, scriptContent);
                    } else {
                        folder.file(`${objKey}.json`, JSON.stringify(objData, null, 2));
                    }
                });
            });
        });

        zip.generateAsync({ type: 'blob' }).then(blob => {
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${fileName}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        }).catch(error => {
            console.error('Error generating zip file:', error);
        });
    }

    // Trigger JSON import
    triggerImportJson() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.style.display = 'none';
        input.addEventListener('change', (e) => this.importJson(e));
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }
    triggerImportProject() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.style.display = 'none';
        input.addEventListener('change', (e) => this.importProject(e));
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }
    // Import a single JSON file
    async importJson(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const reader = new FileReader();
            reader.onload = (e) => {
                const jsonContent = JSON.parse(e.target.result);
                this.setCurrentObjectValues(jsonContent);
                const myCustomEvent = new CustomEvent('updateCurrentObject', { cancelable: true });
                document.body.dispatchEvent(myCustomEvent);
            };
            reader.onerror = (error) => {
                console.error('Error reading JSON file:', error);
            };
            reader.readAsText(file);
        } catch (error) {
            console.error('Error importing JSON:', error);
        }
    }
  
  	// Import a project zip file
    async importProject(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const jsZip = new JSZip();
            const zipContent = await jsZip.loadAsync(file);

            const projectData = {};

            // Process all files in the zip
            const fileProcessingPromises = [];

            zipContent.forEach((relativePath, zipEntry) => {
                if (!zipEntry.dir) {
                    const promise = zipEntry.async('string').then(content => {
                        // Parse path: category/collection/objectKey.ext
                        const pathParts = relativePath.split('/');
                        if (pathParts.length >= 3) {
                            const category = pathParts[0];
                            const collection = pathParts[1];
                            const fileName = pathParts[2];
                            const objectKey = fileName.substring(0, fileName.lastIndexOf('.'));
                            const fileExt = fileName.substring(fileName.lastIndexOf('.') + 1);

                            // Initialize the data structure if needed
                            if (!projectData[category]) projectData[category] = {};
                            if (!projectData[category][collection]) projectData[category][collection] = {};

                            // Parse content based on file extension
                            if (fileExt === 'js') {
                                projectData[category][collection][objectKey] = { script: content };
                            } else if (fileExt === 'json') {
                                projectData[category][collection][objectKey] = JSON.parse(content);
                            }
                        }
                    });
                    fileProcessingPromises.push(promise);
                }
            });

            // Wait for all files to be processed
            await Promise.all(fileProcessingPromises);

            // Update game editor state with imported data
            const defs = this.gameEditor.getCollectionDefs();
            defs.forEach(def => {
                const category = def.category;
                const collectionKey = def.id;

                if (projectData[category] && projectData[category][collectionKey]) {
                    if (!this.gameEditor.state.project.objectTypes[collectionKey]) {
                        this.gameEditor.state.project.objectTypes[collectionKey] = {};
                    }

                    // Merge imported objects with existing
                    Object.keys(projectData[category][collectionKey]).forEach(objKey => {
                        this.gameEditor.state.project.objectTypes[collectionKey][objKey] = 
                            projectData[category][collectionKey][objKey];
                    });
                }
            });

            // Trigger UI update
            const updateEvent = new CustomEvent('projectUpdated', { cancelable: true });
            document.body.dispatchEvent(updateEvent);

            alert('Project imported successfully');
        } catch (error) {
            console.error('Error importing project:', error);
            alert('Error importing project. See console for details.');
        }
    }
}