export class FileSystemSyncService {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
        this.elements = {};
        this.syncConfig = {
            enabled: false,
            autoSync: true,
            syncInterval: 3000
        };
        this.propertyConfig = [
            { propertyName: 'script', ext: 'js' },
            { propertyName: 'html', ext: 'html' },
            { propertyName: 'css', ext: 'css' }
        ];
        this.intervalId = null;
        this.lastSyncTime = Date.now();
        this.pendingChanges = {};

        if(window.location.hostname == 'localhost'){            
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
    
    async importProjectFromFilesystem(projectId) {        
        if (!projectId) {
            console.log('No project ID available');
            return;
        }
        
        try {
            const projectPath = `${projectId}`;
            console.log('Importing project from filesystem:', projectPath);
    
            const response = await fetch('/list-files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: projectPath,
                    since: 0 // Get all files
                })
            });
            
            if (!response.ok) throw new Error('Failed to list files');
            const files = await response.json();
            
            console.log('Found files:', files);
            if (files.length == 0) {
                console.log('no files found');
                this.saveProjectToFilesystem();
                return;
            } 
            const fileGroups = {};
    
            files.forEach(file => {
                const parts = file.name.split('/');
                if (parts.length >= 3) {
                    let category, collectionId, objectId;
                    
                    // Check for property subdirectories (js, html, css) and data
                    const propertyDirs = this.propertyConfig.map(config => config.ext);
                    let subdirIndex = -1;
                    let isDataDir = false;
    
                    // Check for property subdirs
                    for (const dir of propertyDirs) {
                        const idx = parts.indexOf(dir);
                        if (idx !== -1) {
                            subdirIndex = idx;
                            break;
                        }
                    }
    
                    // Check for data subdir
                    const dataIndex = parts.indexOf('data');
                    if (dataIndex !== -1 && (subdirIndex === -1 || dataIndex < subdirIndex)) {
                        isDataDir = true;
                        subdirIndex = dataIndex;
                    }
    
                    if (subdirIndex >= 2) {
                        // Handle file in property or data subdirectory
                        category = parts[subdirIndex - 2];
                        collectionId = parts[subdirIndex - 1];
                        const fileName = parts[parts.length - 1];
                        objectId = fileName.substring(0, fileName.lastIndexOf('.'));
                    } else {
                        // Standard path: projectId/category/type/id.ext
                        category = parts[parts.length - 3];
                        collectionId = parts[parts.length - 2];
                        const fileName = parts[parts.length - 1];
                        objectId = fileName.substring(0, fileName.lastIndexOf('.'));
                    }
    
                    // Adjust for data directory: move up one level
                    if (isDataDir && subdirIndex >= 3) {
                        collectionId = parts[subdirIndex - 1]; // e.g., "things"
                        category = parts[subdirIndex - 2];     // e.g., "entities"
                    }
    
                    if (category && collectionId && objectId) {
                        const key = `${category}/${collectionId}/${objectId}`;
                        if (!fileGroups[key]) fileGroups[key] = { category, collectionId, objectId, files: [] };
                        fileGroups[key].files.push(file);
                    }
                }
            });
    
            const loadPromises = Object.values(fileGroups).map(group => 
                this.loadFilesForObject(group.collectionId, group.objectId, group.files)
            );
            
            await Promise.all(loadPromises);
            this.gameEditor.model.saveProject();
            console.log('All files successfully imported');
            
        } catch (error) {
            console.error('Error importing project:', error);
            throw error;
        }
    }
    async loadFilesForObject(collectionIdFromPath, objectId, files) {
        const currentCollections = this.gameEditor.model.getCollections();
        if (!currentCollections[collectionIdFromPath]) currentCollections[collectionIdFromPath] = {};
    
        const baseFile = files.find(f => f.name.includes('/data/') && f.name.endsWith('.json')) || files[0];
        const filePathParts = baseFile.name.split('/');
    
        let fsCategory, fsTypeFolder;
        const dataIndex = filePathParts.indexOf('data');
        const propertyDirIndex = filePathParts.findIndex(part => 
            this.propertyConfig.some(config => config.ext === part)
        );
    
        if (dataIndex !== -1 && dataIndex >= 2) {
            fsCategory = filePathParts[dataIndex - 2];
            fsTypeFolder = filePathParts[dataIndex - 1];
        } else if (propertyDirIndex !== -1 && propertyDirIndex >= 2) {
            fsCategory = filePathParts[propertyDirIndex - 2];
            fsTypeFolder = filePathParts[propertyDirIndex - 1];
        } else {
            fsCategory = filePathParts[filePathParts.length - 3];
            fsTypeFolder = filePathParts[filePathParts.length - 2];
        }
    
        const newCollectionId = fsTypeFolder;
        const fullFileName = filePathParts[filePathParts.length - 1];
        const fileNameFromFS = fullFileName.substring(0, fullFileName.lastIndexOf('.'));
    
        let hasSpecialProperties = false;
        let objectData = currentCollections[newCollectionId][objectId] || {};
    
        const promises = files.map(fileInfo => {
            const filePath = fileInfo.name;
            const fileExt = filePath.substring(filePath.lastIndexOf('.') + 1);
    
            return fetch('/read-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath })
            })
            .then(response => {
                if (!response.ok) throw new Error(`Failed to read file: ${response.status}`);
                return response.text();
            })
            .then(content => {
                const propertyConfig = this.propertyConfig.find(config => config.ext === fileExt);
                if (propertyConfig) {
                    hasSpecialProperties = true;
                    objectData[propertyConfig.propertyName] = content;
                } else if (fileExt === 'json') {
                    const newData = JSON.parse(content);
                    const jsonId = newData.id || objectId;
                    objectData = currentCollections[newCollectionId][jsonId] || {};
                    Object.assign(objectData, newData);
                    objectId = jsonId; // Ensure we’re using the canonical id
                }
            });
        });
    
        await Promise.all(promises);
    
        if (hasSpecialProperties) {
            objectData.fileName = fileNameFromFS; // Always update fileName from filesystem if special properties
        }
        currentCollections[newCollectionId][objectId] = objectData;
    
        const typeDefs = this.gameEditor.model.getCollectionDefs();
        const oldTypeDef = typeDefs.find(t => t.id === collectionIdFromPath);
        if (oldTypeDef && oldTypeDef.id !== fsTypeFolder) {
            console.log(`Renaming collection from ${oldTypeDef.id} to ${fsTypeFolder}`);
            if (currentCollections[oldTypeDef.id]) {
                currentCollections[newCollectionId] = { ...currentCollections[oldTypeDef.id] };
                delete currentCollections[oldTypeDef.id];
            }
            const newName = fsTypeFolder.charAt(0).toUpperCase() + fsTypeFolder.slice(1);
            const newSingular = oldTypeDef.singular || (fsTypeFolder.endsWith('s') ? fsTypeFolder.slice(0, -1) : fsTypeFolder);
            oldTypeDef.id = fsTypeFolder;
            oldTypeDef.name = newName;
            oldTypeDef.singular = newSingular;
        }
    
        const currentCategory = this.gameEditor.model.getCategoryByType(newCollectionId);
        if (currentCategory !== fsCategory) {
            const typeDef = typeDefs.find(t => t.id === newCollectionId);
            if (typeDef) typeDef.category = fsCategory;
        }
    
        const updateEvent = new CustomEvent('projectUpdated', { cancelable: true });
        document.body.dispatchEvent(updateEvent);
        console.log(`Updated object ${newCollectionId}/${objectId} in editor${hasSpecialProperties ? ` with fileName: ${objectData.fileName}` : ''}`);
    }

    async syncObjectToFilesystem(type, id, data) {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }
    
        // Basic validation
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
    
        const basePath = `${projectId}/${category}/${type}`;
    
        // Check for special properties in this object
        const specialProperties = {};
        const jsonData = { ...data }; // Clone data to avoid mutating the original yet
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
    
        // Determine filename based on whether there are special properties
        let fileName;
        if (hasSpecialProperties) {
            fileName = jsonData.fileName || id; // Use fileName if present, otherwise id
            if (!jsonData.fileName) {
                jsonData.fileName = fileName; // Add to jsonData only if special properties exist
            }
        } else {
            fileName = id; // Use id directly, no fileName property added
        }
    
        // Use the 'data' folder for JSON files
        const jsonFilePath = `${basePath}/data/${fileName}.json`;
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
    
            // Save all special property files concurrently (only if they exist)
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
                    console.log(`${propData.ext.toUpperCase()} file saved: ${filePath}`);
                }
            );
    
            // Wait for all special property files to finish saving
            await Promise.all(specialPropertyPromises);
    
            // Update the original data object in the model to reflect fileName (only if special properties)
            const currentCollections = this.gameEditor.model.getCollections();
            if (currentCollections[type] && currentCollections[type][id] && hasSpecialProperties) {
                currentCollections[type][id].fileName = fileName;
            }
    
            return { success: true, jsonFilePath, specialProperties: Object.keys(specialProperties) };
        } catch (error) {
            console.error('Error in syncObjectToFilesystem:', error);
            throw error;
        }
    }
    
    async syncFromFilesystem() {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }
    
        const projectPath = `${projectId}`;
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
    
        console.log('Files changed since last sync:', files);
        const fileGroups = {};
        const currentCollections = this.gameEditor.model.getCollections();
    
        // Group files by filename-derived objectId initially
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
    
        // Process each group and handle renames
        for (const group of Object.values(fileGroups)) {
            const { collectionId, objectId, files } = group;
            const jsonFile = files.find(f => f.name.includes('/data/') && f.name.endsWith('.json'));
            if (!jsonFile) {
                console.warn(`No JSON file found for ${collectionId}/${objectId}, skipping`);
                continue;
            }
    
            const jsonResponse = await fetch('/read-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: jsonFile.name })
            });
            const jsonContent = await jsonResponse.text();
            const jsonData = JSON.parse(jsonContent);
            const canonicalId = jsonData.id || objectId;
    
            // Check if this is a rename
            const fileNameFromFS = jsonFile.name.split('/').pop().replace('.json', '');
            const existingObject = currentCollections[collectionId]?.[canonicalId];
            if (existingObject && fileNameFromFS !== existingObject.fileName) {
                console.log(`Detected rename: ${existingObject.fileName} → ${fileNameFromFS} for id: ${canonicalId}`);
                
                // Rename associated files
                const oldBaseName = existingObject.fileName || canonicalId;
                const newBaseName = fileNameFromFS;
                const basePath = `${projectId}/${group.category}/${collectionId}`;
                const renamePromises = [];
    
                // Rename JSON file if needed
                if (jsonFile.name !== `${basePath}/data/${oldBaseName}.json`) {
                    renamePromises.push(
                        fetch('/rename-file', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                oldPath: `${basePath}/data/${oldBaseName}.json`,
                                newPath: `${basePath}/data/${newBaseName}.json`
                            })
                        }).then(res => {
                            if (!res.ok) throw new Error(`Failed to rename JSON file`);
                            console.log(`Renamed ${basePath}/data/${oldBaseName}.json to ${newBaseName}.json`);
                        })
                    );
                }
    
                // Rename special property files
                for (const config of this.propertyConfig) {
                    const oldPath = `${basePath}/${config.ext}/${oldBaseName}.${config.ext}`;
                    const newPath = `${basePath}/${config.ext}/${newBaseName}.${config.ext}`;
                    if (files.some(f => f.name === newPath)) {
                        renamePromises.push(
                            fetch('/rename-file', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ oldPath, newPath })
                            }).then(res => {
                                if (!res.ok) throw new Error(`Failed to rename ${config.ext} file`);
                                console.log(`Renamed ${oldPath} to ${newPath}`);
                            })
                        );
                    }
                }
    
                await Promise.all(renamePromises);
    
                // Update fileName in JSON and model
                jsonData.fileName = newBaseName;
                await fetch('/save-file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: `${basePath}/data/${newBaseName}.json`,
                        content: JSON.stringify(jsonData, null, 2)
                    })
                });
                if (currentCollections[collectionId]) {
                    currentCollections[collectionId][canonicalId].fileName = newBaseName;
                }
            }
    
            // Load the object (updates existing or creates new if no id match)
            await this.loadFilesForObject(collectionId, canonicalId, files);
        }
    
        this.lastSyncTime = Date.now();
    }

    checkProjectExistsInFilesystem() {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }

        const projectPath = `${projectId}`;
        
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