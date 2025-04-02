export class FileSystemSyncService {
    constructor(gameEditor) {
        this.gameEditor = gameEditor;
        this.elements = {};
        this.syncConfig = {
            enabled: false,
            autoSync: true,
            syncInterval: 3000
        };
        this.intervalId = null;
        this.lastSyncTime = Date.now();
        this.pendingChanges = {};

        if(window.location.hostname == 'localhost'){
            this.init();
        }
    }

    init() {
        this.setupUI();
        this.setupHooks();
        this.loadSyncConfig();
        
        if (this.syncConfig.enabled && this.syncConfig.autoSync) {
            this.startSync();
        }
    }

    setupUI() {
        const modal = document.createElement('div');
        modal.id = 'modal-FileSystemSyncPanel';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Filesystem Sync Settings</h2>
                    <span class="close">×</span>
                </div>
                <div class="modal-body">
                    <div class="form-row">
                        <label>
                            <input type="checkbox" id="fs-sync-enabled"> 
                            Enable Filesystem Sync
                        </label>
                    </div>
                    <div class="form-row">
                        <label>
                            <input type="checkbox" id="fs-auto-sync"> 
                            Auto-sync Changes
                        </label>
                    </div>
                    <div class="form-row">
                        <label for="fs-sync-interval">Sync Interval (ms):</label>
                        <input type="number" id="fs-sync-interval" min="1000" step="500" value="3000">
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="save-fs-settings" class="btn primary">Save Settings</button>
                    <button id="sync-now-btn" class="btn">Sync Now</button>
                    <button id="save-project-btn" class="btn">Save Project to FS</button>
                    <button id="import-project-btn" class="btn">Import Project from FS</button>
                    <button id="close-fs-settings" class="btn">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        this.elements = {
            modal: modal,
            enabledCheckbox: modal.querySelector('#fs-sync-enabled'),
            autoSyncCheckbox: modal.querySelector('#fs-auto-sync'),
            syncIntervalInput: modal.querySelector('#fs-sync-interval'),
            saveSettingsBtn: modal.querySelector('#save-fs-settings'),
            syncNowBtn: modal.querySelector('#sync-now-btn'),
            saveProjectBtn: modal.querySelector('#save-project-btn'),
            importProjectBtn: modal.querySelector('#import-project-btn'),
            closeBtn: modal.querySelector('#close-fs-settings'),
            closeX: modal.querySelector('.close')
        };
        if (this.elements.fsyncBtn) this.elements.fsyncBtn.remove();
        this.elements.fsyncBtn = document.createElement('button');
        this.elements.fsyncBtn.innerHTML = "FS Sync";
        this.elements.fsyncBtn.id = 'fs-sync-btn';
        this.elements.fsyncBtn.title = "Configure Filesystem Sync";
        this.gameEditor.elements.sidebar.querySelector(".sidebar-actions>.primary")?.after(this.elements.fsyncBtn);

        if (this.elements.syncIndicator) this.elements.syncIndicator.remove();
        this.elements.syncIndicator = document.createElement('span');
        this.elements.syncIndicator.id = 'fs-sync-indicator';
        this.elements.syncIndicator.className = this.syncConfig.enabled ? 'active' : 'inactive';
        this.elements.syncIndicator.title = this.syncConfig.enabled ? 'Sync Active' : 'Sync Inactive';
        this.elements.fsyncBtn.appendChild(this.elements.syncIndicator);
    
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.elements.fsyncBtn.addEventListener('click', () => this.showSettings());
        this.elements.closeBtn.addEventListener('click', () => this.hideSettings());
        this.elements.closeX.addEventListener('click', () => this.hideSettings());
        this.elements.saveSettingsBtn.addEventListener('click', () => {
            this.saveSettings();
            this.hideSettings();
        });
        this.elements.syncNowBtn.addEventListener('click', () => this.syncNow());
        this.elements.saveProjectBtn.addEventListener('click', () => this.saveProjectToFilesystem());
        this.elements.importProjectBtn.addEventListener('click', () => this.importProjectFromFilesystem());

        window.addEventListener('click', (event) => {
            if (event.target === this.elements.modal) {
                this.hideSettings();
            }
        });
    }

    setupHooks() {
        document.body.addEventListener('saveProject', () => {
            if (this.syncConfig.enabled) this.queueSync();
        });
        document.body.addEventListener('saveObject', () => {
            if (this.syncConfig.enabled) this.queueSync();
        });
    }

    showSettings() {
        this.elements.enabledCheckbox.checked = this.syncConfig.enabled;
        this.elements.autoSyncCheckbox.checked = this.syncConfig.autoSync;
        this.elements.syncIntervalInput.value = this.syncConfig.syncInterval;
        this.elements.modal.classList.add('show');
    }

    hideSettings() {
        this.elements.modal.classList.remove('show');
    }

    saveSettings() {
        this.syncConfig.enabled = this.elements.enabledCheckbox.checked;
        this.syncConfig.autoSync = this.elements.autoSyncCheckbox.checked;
        this.syncConfig.syncInterval = parseInt(this.elements.syncIntervalInput.value) || 3000;

        this.saveSyncConfig();

        if (this.syncConfig.enabled && this.syncConfig.autoSync) {
            this.startSync();
        } else {
            this.stopSync();
        }

        this.elements.syncIndicator.className = this.syncConfig.enabled ? 'active' : 'inactive';
        this.elements.syncIndicator.title = this.syncConfig.enabled ? 'Sync Active' : 'Sync Inactive';

        if (this.syncConfig.enabled) {
            this.syncNow();
        }
    }

    loadSyncConfig() {
        const projectId = this.gameEditor.model.getCurrentProject();
        const savedConfig = localStorage.getItem(`${projectId}_fs_sync_config`);
        
        if (savedConfig) {
            try {
                this.syncConfig = JSON.parse(savedConfig);
            } catch (e) {
                console.error('Failed to parse saved sync config:', e);
            }
        }
    }

    saveSyncConfig() {
        const projectId = this.gameEditor.model.getCurrentProject();
        localStorage.setItem(`${projectId}_fs_sync_config`, JSON.stringify(this.syncConfig));
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

    processPendingChanges() {
        const changesKeys = Object.keys(this.pendingChanges);
        if (changesKeys.length === 0) return;
        
        console.log(`Processing ${changesKeys.length} pending changes`);
        
        changesKeys.forEach(key => {
            const change = this.pendingChanges[key];
            this.syncObjectToFilesystem(change.type, change.id, change.data);
        });
        
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
            const category = this.gameEditor.model.getCategoryByType(type) || 'uncategorized';
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
            const fileGroups = {};
    
            files.forEach(file => {
                const parts = file.name.split('/');
                if (parts.length >= 3) { // Expecting projectId/category/type/id.ext
                    const category = parts[parts.length - 3];
                    const collectionId = parts[parts.length - 2];
                    const fileName = parts[parts.length - 1];
                    const objectId = fileName.substring(0, fileName.lastIndexOf('.'));
                    const key = `${category}/${collectionId}/${objectId}`;
                    if (!fileGroups[key]) fileGroups[key] = { category, collectionId, objectId, files: [] };
                    fileGroups[key].files.push(file);
                }
            });
    
            // Use Promise.all to wait for all file operations to complete
            const loadPromises = Object.values(fileGroups).map(group => 
                this.loadFilesForObject(group.collectionId, group.objectId, group.files)
            );
            
            await Promise.all(loadPromises);
            this.gameEditor.model.saveProject();
            console.log('All files successfully imported');
            
        } catch (error) {
            console.error('Error importing project:', error);
            throw error; // Re-throw so caller can handle it if needed
        }
    }
    async loadFilesForObject(collectionIdFromPath, objectId, files) {
        const currentCollections = this.gameEditor.model.getCollections();
        const filePathParts = files[0].name.split('/');
        const fsCategory = filePathParts[filePathParts.length - 3]; // e.g., "Scripts" 
        const fsTypeFolder = filePathParts[filePathParts.length - 2]; // e.g., "things"
    
        // Default to the filesystem folder name as the new collectionId
        const newCollectionId = fsTypeFolder;
        if (!currentCollections[newCollectionId]) currentCollections[newCollectionId] = {};
        let objectData = currentCollections[newCollectionId][objectId] || {};
    
        // Get type definitions
        const typeDefs = this.gameEditor.model.getCollectionDefs();
        const oldTypeDef = typeDefs.find(t => t.id === collectionIdFromPath);
    
        // If the folder name differs from the original typeId, update the typeDef
        if (oldTypeDef && oldTypeDef.id !== fsTypeFolder) {
            console.log(`Renaming collection from ${oldTypeDef.id} to ${fsTypeFolder}`);
    
            // Move collection data from old to new typeId
            if (currentCollections[oldTypeDef.id]) {
                currentCollections[newCollectionId] = { ...currentCollections[oldTypeDef.id] };
                delete currentCollections[oldTypeDef.id];
            }
    
            // Update the typeDef
            const newName = fsTypeFolder.charAt(0).toUpperCase() + fsTypeFolder.slice(1); // e.g., "Things"
            const newSingular = oldTypeDef.singular || (fsTypeFolder.endsWith('s') ? fsTypeFolder.slice(0, -1) : fsTypeFolder); // e.g., "Thing"
            oldTypeDef.id = fsTypeFolder;
            oldTypeDef.name = newName; // Update plural form
            oldTypeDef.singular = newSingular; // Preserve or regenerate singular
            console.log(`Updated typeDef: id: ${fsTypeFolder}, name: ${newName}, singular: ${newSingular}`);
        }
    
        // Update category if it differs
        const currentCategory = this.gameEditor.model.getCategoryByType(newCollectionId);
        if (currentCategory !== fsCategory) {
            const typeDef = typeDefs.find(t => t.id === newCollectionId);
            if (typeDef) {
                typeDef.category = fsCategory;
                console.log(`Updated category for ${newCollectionId} to ${fsCategory}`);
            }
        }
    
        // Process each file
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
                if (fileExt === 'js') {
                    objectData.script = content;
                } else if (fileExt === 'json') {
                    const newData = JSON.parse(content);
                    const existingScript = objectData.script;
                    objectData = { ...newData };
                    if (existingScript) objectData.script = existingScript;
                }
            });
        });
    
        // Return the promise so the calling function can await it
        return Promise.all(promises)
            .then(() => {
                currentCollections[newCollectionId][objectId] = objectData;
                const updateEvent = new CustomEvent('projectUpdated', { cancelable: true });
                document.body.dispatchEvent(updateEvent);
                console.log(`Updated object ${newCollectionId}/${objectId} in editor`);
            })
            .catch(error => {
                console.error(`Error loading files for ${newCollectionId}/${objectId}:`, error);
                throw error; // Re-throw so the caller can catch it
            });
    }

    syncObjectToFilesystem(type, id, data) {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }

        const category = this.gameEditor.model.getCategoryByType(type) || 'uncategorized'; // Fallback to 'uncategorized' if no category
        const basePath = `${projectId}/${category}/${type}/${id}`;
        const isScript = data && typeof data.script === 'string';

        // Save JSON file (all properties except script)
        const jsonData = { ...data };
        if (isScript) delete jsonData.script; // Remove script from JSON data
        const jsonContent = JSON.stringify(jsonData, null, 2);
        const jsonFilePath = `${basePath}.json`;

        fetch('/save-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: jsonFilePath, content: jsonContent })
        })
        .then(response => {
            if (!response.ok) throw new Error('Failed to save JSON file');
            console.log(`JSON file saved: ${jsonFilePath}`);
        })
        .catch(error => console.error('Error saving JSON file:', error));

        // Save JS file if script exists
        if (isScript) {
            const jsFilePath = `${basePath}.js`;
            const jsContent = data.script;

            fetch('/save-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: jsFilePath, content: jsContent })
            })
            .then(response => {
                if (!response.ok) throw new Error('Failed to save JS file');
                console.log(`JS file saved: ${jsFilePath}`);
            })
            .catch(error => console.error('Error saving JS file:', error));
        }
    }

    syncFromFilesystem() {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }

        const projectPath = `${projectId}`;
        console.log('Checking filesystem for changes in:', projectPath);

        fetch('/list-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: projectPath,
                since: this.lastSyncTime
            })
        })
        .then(response => {
            if (!response.ok) throw new Error('Failed to list files');
            return response.json();
        })
        .then(files => {
            if (files.length > 0) {
                console.log('Files changed since last sync:', files);
                const fileGroups = {};

                // Group files by object ID (including category and type in path)
                files.forEach(file => {
                    const parts = file.name.split('/');
                    if (parts.length >= 3) { // Expecting projectId/category/type/id.ext
                        const category = parts[parts.length - 3];
                        const collectionId = parts[parts.length - 2];
                        const fileName = parts[parts.length - 1];
                        const objectId = fileName.substring(0, fileName.lastIndexOf('.'));
                        const key = `${category}/${collectionId}/${objectId}`;
                        if (!fileGroups[key]) fileGroups[key] = { category, collectionId, objectId, files: [] };
                        fileGroups[key].files.push(file);
                    }
                });

                Object.values(fileGroups).forEach(group => {
                    this.loadFilesForObject(group.collectionId, group.objectId, group.files);
                });
            } else {
                console.log('No changes detected in filesystem');
            }
            this.lastSyncTime = Date.now();
        })
        .catch(error => console.error('Error listing files:', error));
    }
    
    loadFileFromFilesystem(collectionId, folderPath, fileInfo) {
        const filePath = fileInfo.name; // Use fileInfo.name directly, no folderPath prefix
        const objectId = fileInfo.name.substring(fileInfo.name.lastIndexOf('/') + 1, fileInfo.name.lastIndexOf('.'));
        const fileExt = fileInfo.name.substring(fileInfo.name.lastIndexOf('.') + 1);
        
        console.log(`Loading ${filePath}`);
        
        fetch('/read-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath })
        })
        .then(response => {
            if (!response.ok) throw new Error(`Failed to read file: ${response.status}`);
            return response.text();
        })
        .then(content => {
            let objectData;
            
            if (fileExt === 'js') {
                objectData = { script: content };
            } else if (fileExt === 'json') {
                objectData = JSON.parse(content);
            } else {
                return;
            }
            
            if (!this.gameEditor.model.getCollections()[collectionId]) {
                this.gameEditor.model.getCollections()[collectionId] = {};
            }
            
            this.gameEditor.model.getCollections()[collectionId][objectId] = objectData;
            this.gameEditor.model.saveProject();
            
            const updateEvent = new CustomEvent('projectUpdated', { cancelable: true });
            document.body.dispatchEvent(updateEvent);
        })
        .catch(error => console.error('Error reading file:', error));
    }
}
