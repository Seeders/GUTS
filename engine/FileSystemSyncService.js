class FileSystemSyncService {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
        this.elements = {};
        this.syncConfig = {
            enabled: false,
            autoSync: true,
            syncInterval: 3000
        };
        this.projectScriptDirectoryName = 'collections';
        this.propertyConfig = [
            { propertyName: 'script', ext: 'js' },
            { propertyName: 'html', ext: 'html' },
            { propertyName: 'css', ext: 'css' },
            { propertyName: 'testScript', ext: 'test.js', folder: 'tests' }
        ];
        this.intervalId = null;
        this.lastSyncTime = Date.now();
        this.pendingChanges = {};
        this.typeHasSpecialProperties = {}; // New: Tracks if a type has any special properties

        this.currentCollections = {};
        this.collectionCategories = {}; // Track actual category for each collection from folder structure

        if (window.location.hostname === 'localhost') {
            this.setupHooks();
        }
    }

    setPropertyConfig(config) {
        if (Array.isArray(config)) {
            this.propertyConfig = config;
            console.log('Property config updated:', this.propertyConfig);
        }
    }

    setupHooks() {
        document.body.addEventListener('saveProject', () => {
            this.queueSync();
        });
        document.body.addEventListener('saveObject', async () => {
            this.queueSync();
            await this.processPendingChanges();
        });
        document.body.addEventListener('projectLoaded', () => {
            this.checkProjectExistsInFilesystem();
        });
        document.body.addEventListener('createType', async (event) => {
            await this.saveObjectTypeDefinition(event.detail);
        });
        document.body.addEventListener('deleteType', async (event) => {
            await this.deleteObjectTypeDefinition(event.detail.typeId, event.detail.category);
        });
    }

    async saveObjectTypeDefinition(typeDef) {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }

        const { typeId, typeName, typeSingular, typeCategory } = typeDef;
        const data = {
            id: typeId,
            name: typeName || typeId.charAt(0).toUpperCase() + typeId.slice(1),
            singular: typeSingular || typeId.slice(0, -1),
            objectTypeCategory: typeCategory || 'uncategorized',
            fileName: typeId
        };

        const filePath = `${projectId}/${this.projectScriptDirectoryName}/Settings/objectTypeDefinitions/${typeId}.json`;
        const jsonContent = JSON.stringify(data, null, 2);

        try {
            const response = await fetch('/save-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, content: jsonContent })
            });

            if (!response.ok) {
                throw new Error(`Failed to save objectTypeDefinition: ${response.status}`);
            }
            console.log(`Saved objectTypeDefinition: ${filePath}`);
        } catch (error) {
            console.error('Error saving objectTypeDefinition:', error);
        }
    }

    async deleteObjectTypeDefinition(typeId, category) {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) return;

        // Delete the objectTypeDefinition JSON file
        const defFilePath = `${projectId}/${this.projectScriptDirectoryName}/Settings/objectTypeDefinitions/${typeId}.json`;

        try {
            const response = await fetch('/delete-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: defFilePath })
            });

            if (!response.ok) {
                console.warn(`Failed to delete objectTypeDefinition file: ${response.status}`);
            } else {
                console.log(`Deleted objectTypeDefinition: ${defFilePath}`);
            }
        } catch (error) {
            console.error('Error deleting objectTypeDefinition:', error);
        }

        // Delete the collection folder if category is provided
        if (category) {
            const folderPath = `${projectId}/${this.projectScriptDirectoryName}/${category}/${typeId}`;

            try {
                const response = await fetch('/delete-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: folderPath })
                });

                if (!response.ok) {
                    console.warn(`Failed to delete collection folder: ${response.status}`);
                } else {
                    console.log(`Deleted collection folder: ${folderPath}`);
                }
            } catch (error) {
                console.error('Error deleting collection folder:', error);
            }
        }
    }

    checkAndDownloadIfNeeded() {
        if (this.syncConfig.autoDownloadOnUnsaved && !this.projectSavedToFS) {
            console.log('Project not saved to filesystem yet. Triggering download...');
            this.downloadProjectAsJSON();
        } else {
            this.syncFromFilesystem();
        }
    }

    startSync() {
        this.stopSync();
        this.intervalId = setInterval(() => {
            this.syncNow();
        }, this.syncConfig.syncInterval);
        console.log(`Filesystem sync started with ${this.syncConfig.syncInterval}ms interval`);
    }

    stopSync() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('Filesystem sync stopped');
        }
    }

    queueSync() {
        const { selectedType, selectedObject } = this.gameEditor.model.getCurrentObjectContext();
        if (selectedType && selectedObject) {
            this.pendingChanges[`${selectedType}/${selectedObject}`] = {
                type: selectedType,
                id: selectedObject,
                data: this.gameEditor.model.getCurrentObject(),
                timestamp: Date.now()
            };
        }
    }

    async processPendingChanges() {
        const changesKeys = Object.keys(this.pendingChanges);
        if (changesKeys.length === 0) return;

        console.log(`Processing ${changesKeys.length} pending changes`);
        const syncPromises = changesKeys.map(async (key) => {
            const change = this.pendingChanges[key];
            await this.syncObjectToFilesystem(change.type, change.id, change.data);
        });

        await Promise.all(syncPromises);
        this.pendingChanges = {};
    }

    syncNow() {
        this.processPendingChanges();
        this.syncFromFilesystem();
    }

    saveProjectToFilesystem() {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }

        const collections = this.gameEditor.model.getCollections();
        console.log('Saving entire project to filesystem:', projectId);

        Object.entries(collections).forEach(([type, objects]) => {
            Object.entries(objects).forEach(([id, data]) => {
                this.syncObjectToFilesystem(type, id, data);
            });
        });
    }

    // New helper method to check if any object in a type has special properties
    hasSpecialPropertiesInType(type) {
        if (this.typeHasSpecialProperties[type] !== undefined) {
            return this.typeHasSpecialProperties[type];
        }

        const collections = this.gameEditor.model.getCollections();
        const objects = collections[type] || {};
        const hasSpecial = Object.values(objects).some(obj =>
            this.propertyConfig.some(config => typeof obj[config.propertyName] === 'string')
        );
        this.typeHasSpecialProperties[type] = hasSpecial;
        return hasSpecial;
    }

    async importProject(projectId) {
        // Load project data from storage via the model    
        await this.importModulesFromFilesystem();      
        await this.importProjectFromFilesystem(projectId);      
        this.setCollectionDefs();
        this.gameEditor.model.saveProject();
    }

    async importProjectFromFilesystem(projectId) {
        if (!projectId) {
            console.log('No project ID available');
            return;
        }
    
        try {
            const projectPath = `${projectId}/${this.projectScriptDirectoryName}`;
            console.log('Importing project from filesystem:', projectPath);
    
            const response = await fetch('/list-files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: projectPath,
                    since: 0 // Fetch all files on import
                })
            });
    
            if (!response.ok) throw new Error(`Failed to list files: ${response.status}`);
            const files = await response.json();
            await this.loadFiles(files, false);
            console.log('All files successfully imported');
        } catch (error) {
            console.error('Error importing project:', error);
            throw error;
        }
    }

    async importModulesFromFilesystem() {

    
        try {
            console.log('Importing modules from filesystem');
    
            const response = await fetch('/list-files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: '',
                    isModule: true,
                    since: 0 // Fetch all files on import
                })
            });
    
            if (!response.ok) throw new Error(`Failed to import modules: ${response.status}`);
            const files = await response.json();
    
            await this.loadFiles(files, true);
            console.log('All modules successfully imported');

        } catch(e) {
            console.warn(e);
        }
    }

    async loadFiles(files, isModule) {

        if (files.length === 0) {
            console.log('No files found, initializing project in filesystem');
            this.saveProjectToFilesystem();
            return;
        }

        const fileGroups = {};

        files.forEach(file => {
            const parts = file.name.split('/');
            if (parts.length < 3) {
                console.warn(`Skipping malformed file path: ${file.name}`);
                return;
            }

            let category, collectionId, objectId;
            // Build property directory names (use 'folder' if specified, otherwise 'ext')
            const propertyDirs = this.propertyConfig.map(config => config.folder || config.ext);
            let subdirIndex = -1;

            for (const dir of propertyDirs) {
                const idx = parts.indexOf(dir);
                if (idx !== -1) {
                    subdirIndex = idx;
                    break;
                }
            }

            // Look for 'data' as a collection subdirectory (immediate parent of the file)
            // Only match if 'data' is at position parts.length - 2 (parent of file)
            // This prevents confusing a category folder named 'data' with the data subdirectory
            const fileParentIndex = parts.length - 2;
            if (parts[fileParentIndex] === 'data' && (subdirIndex === -1 || fileParentIndex < subdirIndex)) {
                subdirIndex = fileParentIndex;
            }

            if (subdirIndex >= 2) {
                category = parts[subdirIndex - 2];
                collectionId = parts[subdirIndex - 1];
                const fileName = parts[parts.length - 1];
                // Handle .test.js extension - strip .test before the final extension
                objectId = fileName.replace(/\.test\.js$/, '').replace(/\.[^/.]+$/, '');
            } else {
                category = parts[parts.length - 3];
                collectionId = parts[parts.length - 2];
                const fileName = parts[parts.length - 1];
                // Handle .test.js extension - strip .test before the final extension
                objectId = fileName.replace(/\.test\.js$/, '').replace(/\.[^/.]+$/, '');
            }

            if (!category || !collectionId || !objectId) {
                console.warn(`Could not parse file path: ${file.name}`);
                return;
            }

            const key = `${category}/${collectionId}/${objectId}`;
            if (!fileGroups[key]) fileGroups[key] = { category, collectionId, objectId, files: [] };
            fileGroups[key].files.push(file);

            // Track the actual category for this collection from folder structure
            if (category && collectionId) {
                this.collectionCategories[collectionId] = category;
            }
        });

        // Batch load all files in one request
        const allFilePaths = files.map(f => f.name);
        const fileContents = await this.batchReadFiles(allFilePaths, isModule);

        // Process file groups with pre-loaded content
        for (const group of Object.values(fileGroups)) {
            await this.processFileGroup(group.collectionId, group.objectId, group.files, fileContents, isModule);
        }
    }

    /**
     * Extract static services array from JavaScript class content
     * Parses: static services = ['service1', 'service2', ...]
     * @param {string} jsContent - The JavaScript file content
     * @returns {string[]} Array of service names, or empty array if not found
     */
    extractStaticServices(jsContent) {
        // Match: static services = ['name1', 'name2', ...]
        const match = jsContent.match(/static\s+services\s*=\s*\[([\s\S]*?)\]/);
        if (!match) return [];

        // Extract individual string values from the array content
        const arrayContent = match[1];
        const services = [];
        const stringMatches = arrayContent.matchAll(/['"]([^'"]+)['"]/g);
        for (const m of stringMatches) {
            services.push(m[1]);
        }
        return services;
    }

    async batchReadFiles(filePaths, isModule) {
        try {
            const response = await fetch('/read-files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: filePaths, isModule })
            });

            if (!response.ok) {
                console.warn('Batch read failed, falling back to individual reads');
                return null;
            }

            const result = await response.json();
            return result.success ? result.files : null;
        } catch (error) {
            console.warn('Batch read error:', error);
            return null;
        }
    }

    async processFileGroup(collectionIdFromPath, objectId, files, fileContents, isModule) {
        if (!this.currentCollections[collectionIdFromPath]) {
            this.currentCollections[collectionIdFromPath] = {};
        }

        const jsonFile = files.find(f => f.name.endsWith('.json'));
        let objectData = this.currentCollections[collectionIdFromPath][objectId] || {};

        // Process JSON file if it exists
        if (jsonFile) {
            let content;
            if (fileContents && fileContents[jsonFile.name]) {
                content = fileContents[jsonFile.name];
            } else {
                const jsonResponse = await fetch('/read-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: jsonFile.name, isModule })
                });
                if (!jsonResponse.ok) throw new Error(`Failed to read JSON file: ${jsonFile.name}`);
                content = await jsonResponse.text();
            }
            const newData = JSON.parse(content);
            objectId = newData.id || objectId;
            Object.assign(objectData, newData);
        }

        // Process special property files (e.g., .html, .css, .test.js)
        const specialFiles = files.filter(f => !f.name.endsWith('.json'));
        for (const fileInfo of specialFiles) {
            // Extract file extension, handling compound extensions like .test.js
            let fileExt = fileInfo.name.substring(fileInfo.name.lastIndexOf('.') + 1);
            // Check for compound extension (e.g., .test.js)
            if (fileInfo.name.endsWith('.test.js')) {
                fileExt = 'test.js';
            }
            const propertyConfig = this.propertyConfig.find(config => config.ext === fileExt);

            if (propertyConfig) {
                let content;
                if (fileContents && fileContents[fileInfo.name]) {
                    content = fileContents[fileInfo.name];
                } else {
                    const response = await fetch('/read-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: fileInfo.name, isModule })
                    });
                    if (!response.ok) throw new Error(`Failed to read ${fileExt} file: ${fileInfo.name}`);
                    content = await response.text();
                }
                objectData[propertyConfig.propertyName] = content;
                let filePath = fileInfo.name;
                if(filePath.startsWith('..')) {
                    filePath = filePath.substr(2, filePath.length - 2);
                } else {
                    filePath = '/projects/' + filePath;
                }
                // Set filePath property based on property type (e.g., testScript -> testFilePath)
                const filePathProp = propertyConfig.propertyName === 'testScript' ? 'testFilePath' : 'filePath';
                objectData[filePathProp] = filePath;
                this.typeHasSpecialProperties[collectionIdFromPath] = true;

                // Extract static services array from JS files (not test files)
                if (fileExt === 'js' && propertyConfig.propertyName === 'script') {
                    const services = this.extractStaticServices(content);
                    if (services.length > 0) {
                        objectData.services = services;
                    }
                }
            }
        }

        // Set fileName if applicable
        if (this.hasSpecialPropertiesInType(collectionIdFromPath)) {
            // Handle .test.js extension when extracting fileName
            const fileName = files[0].name.split('/').pop().replace(/\.test\.js$/, '').replace(/\.[^/.]+$/, '');
            objectData.fileName = fileName;
        }

        this.currentCollections[collectionIdFromPath][objectId] = objectData;
    }

    setCollectionDefs(){
        // Load objectTypeDefinitions from the objectTypeDefinitions collection
        // (which is loaded from Settings/objectTypeDefinitions/*.json)
        let collectionDefs = [];

        if (this.currentCollections.objectTypeDefinitions) {
            // Convert the collection objects to an array
            collectionDefs = Object.values(this.currentCollections.objectTypeDefinitions);
        } else {
            // Fallback to model's existing definitions
            collectionDefs = this.gameEditor.model.getCollectionDefs() || [];
        }

        // Filter to only include definitions for collections that actually exist
        collectionDefs = collectionDefs.filter(def => {
            // Keep the definition if the collection exists OR if it's the objectTypeDefinitions collection itself
            return this.currentCollections[def.id] || def.id === 'objectTypeDefinitions';
        });

        // Update objectTypeDefinitions to match actual folder locations
        this.syncObjectTypeDefinitionsWithFolders(collectionDefs);

        this.gameEditor.model.state.project = {
            objectTypes: this.currentCollections,
            objectTypeDefinitions: collectionDefs
        }
    }

    /**
     * Sync objectTypeDefinitions with actual folder locations.
     * If a collection is in a different folder than its definition says,
     * update the definition and save it to the filesystem.
     * Also creates missing objectTypeCategory entries for new folders.
     */
    async syncObjectTypeDefinitionsWithFolders(collectionDefs) {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) return;

        // Collect all unique categories from folder structure
        const categoriesFromFolders = new Set(Object.values(this.collectionCategories));

        // Get existing objectTypeCategories
        const existingCategories = this.currentCollections.objectTypeCategories || {};

        // Create missing objectTypeCategory entries
        for (const category of categoriesFromFolders) {
            if (!existingCategories[category]) {
                await this.createObjectTypeCategory(projectId, category);
            }
        }

        for (const def of collectionDefs) {
            const actualCategory = this.collectionCategories[def.id];

            // Skip if we don't know the actual category or it already matches
            if (!actualCategory || def.objectTypeCategory === actualCategory) continue;

            console.log(`Updating objectTypeDefinition '${def.id}': objectTypeCategory '${def.objectTypeCategory}' -> '${actualCategory}'`);

            // Update the definition in memory
            def.objectTypeCategory = actualCategory;

            // Also update in currentCollections if it exists there
            if (this.currentCollections.objectTypeDefinitions &&
                this.currentCollections.objectTypeDefinitions[def.id]) {
                this.currentCollections.objectTypeDefinitions[def.id].objectTypeCategory = actualCategory;
            }

            // Save the updated definition to the filesystem
            const filePath = `${projectId}/${this.projectScriptDirectoryName}/Settings/objectTypeDefinitions/${def.id}.json`;
            const jsonContent = JSON.stringify(def, null, 2);

            try {
                const response = await fetch('/save-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: filePath, content: jsonContent })
                });

                if (!response.ok) {
                    console.warn(`Failed to update objectTypeDefinition: ${filePath}`);
                } else {
                    console.log(`Updated objectTypeDefinition: ${filePath}`);
                }
            } catch (error) {
                console.error('Error updating objectTypeDefinition:', error);
            }
        }
    }

    /**
     * Create a new objectTypeCategory entry for a folder that doesn't have one
     */
    async createObjectTypeCategory(projectId, categoryId) {
        // Create a title from the category ID (capitalize first letter)
        const title = categoryId.charAt(0).toUpperCase() + categoryId.slice(1);

        const categoryData = {
            title: title
        };

        // Add to in-memory collections
        if (!this.currentCollections.objectTypeCategories) {
            this.currentCollections.objectTypeCategories = {};
        }
        this.currentCollections.objectTypeCategories[categoryId] = categoryData;

        // Save to filesystem
        const filePath = `${projectId}/${this.projectScriptDirectoryName}/Settings/objectTypeCategories/${categoryId}.json`;
        const jsonContent = JSON.stringify(categoryData, null, 2);

        try {
            const response = await fetch('/save-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, content: jsonContent })
            });

            if (!response.ok) {
                console.warn(`Failed to create objectTypeCategory: ${filePath}`);
            } else {
                console.log(`Created objectTypeCategory: ${filePath}`);
            }
        } catch (error) {
            console.error('Error creating objectTypeCategory:', error);
        }
    }

    async loadFilesForObject(collectionIdFromPath, objectId, files, isModule) {
      
        if (!this.currentCollections[collectionIdFromPath]) this.currentCollections[collectionIdFromPath] = {};
    
        const jsonFile = files.find(f => f.name.endsWith('.json'));
        let objectData = this.currentCollections[collectionIdFromPath][objectId] || {};
    
        // Process JSON file if it exists
        if (jsonFile) {
            const jsonResponse = await fetch('/read-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: jsonFile.name, isModule })
            });
            if (!jsonResponse.ok) throw new Error(`Failed to read JSON file: ${jsonFile.name}`);
            const content = await jsonResponse.text();
            const newData = JSON.parse(content);
            objectId = newData.id || objectId;
            Object.assign(objectData, newData);
        }
    
        // Process special property files (e.g., .html, .css, .test.js)
        const specialFiles = files.filter(f => !f.name.endsWith('.json'));
        for (const fileInfo of specialFiles) {
            // Extract file extension, handling compound extensions like .test.js
            let fileExt = fileInfo.name.substring(fileInfo.name.lastIndexOf('.') + 1);
            // Check for compound extension (e.g., .test.js)
            if (fileInfo.name.endsWith('.test.js')) {
                fileExt = 'test.js';
            }
            const propertyConfig = this.propertyConfig.find(config => config.ext === fileExt);

            if (propertyConfig) {
                const response = await fetch('/read-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: fileInfo.name })
                });
                if (!response.ok) throw new Error(`Failed to read ${fileExt} file: ${fileInfo.name}`);
                const content = await response.text();
                objectData[propertyConfig.propertyName] = content;
                let filePath = fileInfo.name;
                if(filePath.startsWith('..')) {
                    filePath = filePath.substr(2, filePath.length - 2);
                } else {
                    filePath = '/projects/' + filePath;
                }
                // Set filePath property based on property type (e.g., testScript -> testFilePath)
                const filePathProp = propertyConfig.propertyName === 'testScript' ? 'testFilePath' : 'filePath';
                objectData[filePathProp] = filePath;
                this.typeHasSpecialProperties[collectionIdFromPath] = true;
            }
        }

        // Set fileName if applicable
        if (this.hasSpecialPropertiesInType(collectionIdFromPath)) {
            const fileName = files[0].name.split('/').pop().replace(/\.test\.js$/, '').replace(/\.[^/.]+$/, '');
            objectData.fileName = fileName;
        }

        this.currentCollections[collectionIdFromPath][objectId] = objectData;

        const updateEvent = new CustomEvent('projectUpdated', { cancelable: true });
        document.body.dispatchEvent(updateEvent);
    }

    async syncObjectToFilesystem(type, id, data) {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }

        if (!type || !id || !data || typeof data !== 'object') {
            console.error(`Invalid input: type=${type}, id=${id}, data=${data}`);
            return;
        }

        const categoryFromModel = this.gameEditor.model.getCategoryByType(type);
        const category = categoryFromModel || 'uncategorized';

        if (category === 'uncategorized') {
            console.warn(`Skipping sync for type=${type}, id=${id}: No valid category found.`);
            return;
        }

        const basePath = `${projectId}/${this.projectScriptDirectoryName}/${category}/${type}`;

        // Check for special properties in this object
        const specialProperties = {};
        const jsonData = { ...data };
        let hasSpecialProperties = false;

        this.propertyConfig.forEach(config => {
            const propName = config.propertyName;
            if (typeof data[propName] === 'string') {
                specialProperties[propName] = {
                    content: data[propName],
                    ext: config.ext,
                    folder: config.folder || config.ext  // Use folder if specified, otherwise ext
                };
                delete jsonData[propName];
                hasSpecialProperties = true;
            }
        });

        // Update type status if this object has special properties
        if (hasSpecialProperties) {
            this.typeHasSpecialProperties[type] = true;
        }

        // Determine filename and JSON path based on type-wide special properties
        const useDataFolder = this.hasSpecialPropertiesInType(type);
        let fileName = useDataFolder ? (jsonData.fileName || id) : id;
        if (useDataFolder && !jsonData.fileName) {
            jsonData.fileName = fileName;
        }

        const jsonFilePath = useDataFolder
            ? `${basePath}/data/${fileName}.json`
            : `${basePath}/${fileName}.json`;

        const jsonContent = JSON.stringify(jsonData, null, 2);

        try {
            // Save the JSON file
            const jsonResponse = await fetch('/save-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: jsonFilePath, content: jsonContent })
            });

            if (!jsonResponse.ok) {
                throw new Error(`Failed to save JSON file: ${jsonFilePath}`);
            }
            console.log(`JSON file saved: ${jsonFilePath}`);

            // Save special property files (if any)
            const specialPropertyPromises = Object.entries(specialProperties).map(
                async ([propName, propData]) => {
                    // Use folder for directory (e.g., 'tests'), ext for file extension (e.g., 'test.js')
                    const fileDir = `${basePath}/${propData.folder}`;
                    const filePath = `${fileDir}/${fileName}.${propData.ext}`;
                    const fileContent = propData.content;

                    const response = await fetch('/save-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: filePath, content: fileContent })
                    });

                    if (!response.ok) {
                        throw new Error(`Failed to save ${propData.ext} file: ${filePath}`);
                    }
                }
            );

            await Promise.all(specialPropertyPromises);

            // Update the model with fileName if type has special properties
            const currentCollections = this.gameEditor.model.getCollections();
            if (currentCollections[type] && currentCollections[type][id] && useDataFolder) {
                currentCollections[type][id].fileName = fileName;
            }

            return { success: true, jsonFilePath, specialProperties: Object.keys(specialProperties) };
        } catch (error) {
            console.error('Error in syncObjectToFilesystem:', error);
            throw error;
        }
    }

    // Fix for the syncFromFilesystem method to properly handle HTML and CSS files
    async syncFromFilesystem() {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }

        const projectPath = `${projectId}/${this.projectScriptDirectoryName}`;
        console.log('Checking filesystem for changes in:', projectPath);

        const response = await fetch('/list-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: projectPath,
                since: this.lastSyncTime
            })
        });

        if (!response.ok) throw new Error('Failed to list files');
        const files = await response.json();

        if (files.length === 0) {
            console.log('No changes detected in filesystem');
            this.lastSyncTime = Date.now();
            return;
        }

        const fileGroups = {};
        const currentCollections = this.gameEditor.model.getCollections();

        // Group files by their object identifier
        for (const file of files) {
            const parts = file.name.split('/');
            if (parts.length < 3) continue;

            let category, collectionId, objectId;
            // Build property directory names (use 'folder' if specified, otherwise 'ext')
            const propertyDirs = this.propertyConfig.map(config => config.folder || config.ext);
            let subdirIndex = -1;

            for (const dir of propertyDirs) {
                const idx = parts.indexOf(dir);
                if (idx !== -1) {
                    subdirIndex = idx;
                    break;
                }
            }

            // Look for 'data' as a collection subdirectory (immediate parent of the file)
            // Only match if 'data' is at position parts.length - 2 (parent of file)
            // This prevents confusing a category folder named 'data' with the data subdirectory
            const fileParentIndex = parts.length - 2;
            if (parts[fileParentIndex] === 'data' && (subdirIndex === -1 || fileParentIndex < subdirIndex)) {
                subdirIndex = fileParentIndex;
            }

            if (subdirIndex >= 2) {
                category = parts[subdirIndex - 2];
                collectionId = parts[subdirIndex - 1];
                const fileName = parts[parts.length - 1];
                // Handle .test.js extension - strip .test before the final extension
                objectId = fileName.replace(/\.test\.js$/, '').replace(/\.[^/.]+$/, '');
            } else {
                category = parts[parts.length - 3];
                collectionId = parts[parts.length - 2];
                const fileName = parts[parts.length - 1];
                // Handle .test.js extension - strip .test before the final extension
                objectId = fileName.replace(/\.test\.js$/, '').replace(/\.[^/.]+$/, '');
            }

            if (category && collectionId && objectId) {
                const key = `${category}/${collectionId}/${objectId}`;
                if (!fileGroups[key]) fileGroups[key] = { category, collectionId, objectId, files: [] };
                fileGroups[key].files.push(file);
            }
        }

        // Process each group of related files
        for (const group of Object.values(fileGroups)) {
            const { collectionId, objectId, files } = group;
            
            if (!currentCollections[collectionId]) {
                currentCollections[collectionId] = {};
            }
            
            // First find and process JSON file to get the base object data
            const jsonFile = files.find(f => f.name.endsWith('.json'));
            if (!jsonFile) {
                console.warn(`No JSON file found for ${collectionId}/${objectId}, processing other files directly`);
                // Even if no JSON file exists, we still need to process HTML, CSS, etc.
            }
            
            let jsonData = {};
            let canonicalId = objectId;
            
            if (jsonFile) {
                const jsonResponse = await fetch('/read-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: jsonFile.name })
                });
                
                const jsonContent = await jsonResponse.text();
                jsonData = JSON.parse(jsonContent);
                canonicalId = jsonData.id || objectId;
                
                const fileNameFromFS = jsonFile.name.split('/').pop().replace('.json', '');
                const existingObject = currentCollections[collectionId]?.[canonicalId];
                const useDataFolder = this.hasSpecialPropertiesInType(collectionId);

                if (existingObject && useDataFolder && fileNameFromFS !== existingObject.fileName) {
                    console.log(`Detected rename: ${existingObject.fileName} → ${fileNameFromFS} for id: ${canonicalId}`);
                    // Handle rename scenario (already implemented)
           
                }
                
                // Update the base object data
                if (!currentCollections[collectionId][canonicalId]) {
                    currentCollections[collectionId][canonicalId] = {};
                }
                
                // Preserve special properties when updating from JSON
                const existingObj = currentCollections[collectionId][canonicalId];
                this.propertyConfig.forEach(config => {
                    if (existingObj[config.propertyName]) {
                        jsonData[config.propertyName] = existingObj[config.propertyName];
                    }
                });
                
                Object.assign(currentCollections[collectionId][canonicalId], jsonData);
            }
            debugger;
            // Now process special property files (HTML, CSS, JS, etc.)
            for (const file of files) {
                if (file.name.endsWith('.json')) continue; // Skip JSON, already processed
                
                const fileExt = file.name.substring(file.name.lastIndexOf('.') + 1);
                const propertyConfig = this.propertyConfig.find(config => config.ext === fileExt);
                
                if (propertyConfig) {
                    // This is a special property file (HTML, CSS, JS)
                    const response = await fetch('/read-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: file.name })
                    });
                    
                    if (!response.ok) {
                        console.error(`Failed to read ${fileExt} file: ${file.name}`);
                        continue;
                    }
                    
                    const content = await response.text();
                    
                    if (!currentCollections[collectionId][canonicalId]) {
                        currentCollections[collectionId][canonicalId] = {
                            id: canonicalId
                        };
                    }
                    
                    // Update the special property
                    currentCollections[collectionId][canonicalId][propertyConfig.propertyName] = content;
                    currentCollections[collectionId][canonicalId]['filePath'] = file.name;

                    // Mark this type as having special properties
                    this.typeHasSpecialProperties[collectionId] = true;

                    // Extract static services array from JS files
                    if (fileExt === 'js') {
                        const services = this.extractStaticServices(content);
                        if (services.length > 0) {
                            currentCollections[collectionId][canonicalId].services = services;
                        }
                    }

                    console.log(`Updated ${propertyConfig.propertyName} content for ${collectionId}/${canonicalId}`);
                }
            }

            // Make sure fileName is set for objects with special properties
            if (this.hasSpecialPropertiesInType(collectionId)) {
                const obj = currentCollections[collectionId][canonicalId];
                if (!obj.fileName) {
                    obj.fileName = canonicalId;
                }
            }
        }

        // Update the UI to reflect changes
        const updateEvent = new CustomEvent('projectUpdated', { cancelable: true });
        document.body.dispatchEvent(updateEvent);
        
        this.lastSyncTime = Date.now();
        console.log('Filesystem sync completed successfully');
    }

    checkProjectExistsInFilesystem() {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }

        const projectPath = `${projectId}/${this.projectScriptDirectoryName}`;

        fetch('/list-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: projectPath,
                since: 0
            })
        })
        .then(response => {
            if (!response.ok) throw new Error('Failed to list files');
            return response.json();
        })
        .then(files => {
            if (files.length === 0) {
                console.log('Project does not exist in filesystem yet.');
                this.projectSavedToFS = false;
                this.checkAndDownloadIfNeeded();
            } else {
                console.log('Project exists in filesystem.');
                this.projectSavedToFS = true;
            }
        })
        .catch(error => {
            console.error('Error checking project existence:', error);
            this.projectSavedToFS = false;
        });
    }
}