class FileSystemSyncService {
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

        this.init();
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
                    <div class="settings-form">
                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="fs-sync-enabled"> 
                                Enable Filesystem Sync
                            </label>
                        </div>
                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="fs-auto-sync"> 
                                Auto-sync Changes
                            </label>
                        </div>
                        <div class="form-group">
                            <label for="fs-sync-interval">Sync Interval (ms):</label>
                            <input type="number" id="fs-sync-interval" min="1000" step="500" value="3000">
                        </div>
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
        document.body.addEventListener('loadProject', () => {
            if (this.syncConfig.enabled) {
                this.loadSyncConfig();
                this.syncNow();
            }
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
            this.processPendingChanges();
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
            Object.entries(objects).forEach(([id, data]) => {
                this.syncObjectToFilesystem(type, id, data);
            });
        });
    }

    importProjectFromFilesystem() {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }

        const projectPath = `${projectId}`;
        console.log('Importing project from filesystem:', projectPath);

        fetch('/list-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: projectPath,
                since: 0 // Get all files, ignore lastSyncTime
            })
        })
        .then(response => {
            if (!response.ok) throw new Error('Failed to list files');
            return response.json();
        })
        .then(files => {
            console.log('Found files:', files);
            files.forEach(file => {
                const parts = file.name.split('/');
                if (parts.length >= 2) {
                    const collectionId = parts[parts.length - 2];
                    this.loadFileFromFilesystem(collectionId, projectPath, file);
                }
            });
        })
        .catch(error => console.error('Error importing project:', error));
    }

    syncObjectToFilesystem(type, id, data) {
        const projectId = this.gameEditor.model.getCurrentProject();
        if (!projectId) {
            console.log('No project ID available');
            return;
        }

        const isScript = data && typeof data.script === 'string';
        const fileExtension = isScript ? 'js' : 'json';
        const content = isScript ? data.script : JSON.stringify(data, null, 2);
        const filePath = `${projectId}/${type}/${id}.${fileExtension}`;

        fetch('/save-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, content })
        })
        .then(response => {
            if (!response.ok) throw new Error('Failed to save file');
            console.log(`File saved: ${filePath}`);
        })
        .catch(error => console.error('Error saving file:', error));
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
                files.forEach(file => {
                    const parts = file.name.split('/');
                    if (parts.length >= 2) {
                        const collectionId = parts[parts.length - 2];
                        this.loadFileFromFilesystem(collectionId, projectPath, file);
                    }
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
