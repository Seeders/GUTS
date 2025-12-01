class FileSystemSyncService {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
        this.elements = {};
        this.syncConfig = {
            enabled: false,
            autoSync: true,
            syncInterval: 3000
        };
        this.projectScriptDirectoryName = 'scripts';
        this.propertyConfig = [
            { propertyName: 'script', ext: 'js' },
            { propertyName: 'html', ext: 'html' },
            { propertyName: 'css', ext: 'css' }
        ];
        this.intervalId = null;
        this.lastSyncTime = Date.now();
        this.pendingChanges = {};
        this.typeHasSpecialProperties = {}; // New: Tracks if a type has any special properties

        this.currentCollections = {};

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
            category: typeCategory || 'Uncategorized',
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
         //   console.log('loading file', file.name);
            const parts = file.name.split('/');
            if (parts.length < 3) {
                console.warn(`Skipping malformed file path: ${file.name}`);
                return;
            }

            let category, collectionId, objectId;
            const propertyDirs = this.propertyConfig.map(config => config.ext);
            let subdirIndex = -1;

            for (const dir of propertyDirs) {
                const idx = parts.indexOf(dir);
                if (idx !== -1) {
                    subdirIndex = idx;
                    break;
                }
            }

            const dataIndex = parts.indexOf('data');
            if (dataIndex !== -1 && (subdirIndex === -1 || dataIndex < subdirIndex)) {
                subdirIndex = dataIndex;
            }

            if (subdirIndex >= 2) {
                category = parts[subdirIndex - 2];
                collectionId = parts[subdirIndex - 1];
                const fileName = parts[parts.length - 1];
                objectId = fileName.substring(0, fileName.lastIndexOf('.'));
            } else {
                category = parts[parts.length - 3];
                collectionId = parts[parts.length - 2];
                const fileName = parts[parts.length - 1];
                objectId = fileName.substring(0, fileName.lastIndexOf('.'));
            }

            if (!category || !collectionId || !objectId) {
                console.warn(`Could not parse file path: ${file.name}`);
                return;
            }

            const key = `${category}/${collectionId}/${objectId}`;
            if (!fileGroups[key]) fileGroups[key] = { category, collectionId, objectId, files: [] };
            fileGroups[key].files.push(file);
        });

        const loadPromises = Object.values(fileGroups).map(group =>
            this.loadFilesForObject(group.collectionId, group.objectId, group.files, isModule)
        );

        await Promise.all(loadPromises);
      
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

        this.gameEditor.model.state.project = {
            objectTypes: this.currentCollections,
            objectTypeDefinitions: collectionDefs
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
    
        // Process special property files (e.g., .html, .css)
        const specialFiles = files.filter(f => !f.name.endsWith('.json'));
        for (const fileInfo of specialFiles) {
            const fileExt = fileInfo.name.substring(fileInfo.name.lastIndexOf('.') + 1);
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
                objectData['filePath'] = filePath;
                this.typeHasSpecialProperties[collectionIdFromPath] = true;
            }
        }
    
        // Set fileName if applicable
        if (this.hasSpecialPropertiesInType(collectionIdFromPath)) {
            const fileName = files[0].name.split('/').pop().replace(/\.[^/.]+$/, '');
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
                    ext: config.ext
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
                    const fileDir = `${basePath}/${propData.ext}`;
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
            const propertyDirs = this.propertyConfig.map(config => config.ext);
            let subdirIndex = -1;

            for (const dir of propertyDirs) {
                const idx = parts.indexOf(dir);
                if (idx !== -1) {
                    subdirIndex = idx;
                    break;
                }
            }

            const dataIndex = parts.indexOf('data');
            if (dataIndex !== -1 && (subdirIndex === -1 || dataIndex < subdirIndex)) {
                subdirIndex = dataIndex;
            }

            if (subdirIndex >= 2) {
                category = parts[subdirIndex - 2];
                collectionId = parts[subdirIndex - 1];
                const fileName = parts[parts.length - 1];
                objectId = fileName.substring(0, fileName.lastIndexOf('.'));
            } else {
                category = parts[parts.length - 3];
                collectionId = parts[parts.length - 2];
                const fileName = parts[parts.length - 1];
                objectId = fileName.substring(0, fileName.lastIndexOf('.'));
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