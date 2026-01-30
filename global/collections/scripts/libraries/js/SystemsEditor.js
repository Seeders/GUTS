/**
 * SystemsEditor - Visual editor for scene system dependencies
 *
 * Displays systems included in a scene and visualizes service connections
 * between them using an interactive graph view.
 */

class SystemsEditor {
    // Node dimensions (legacy)
    static NODE_WIDTH = 140;
    static NODE_HEIGHT = 36;
    static NODE_PADDING = 20;

    // Layout dimensions for hierarchical view
    static LAYOUT = {
        PROVIDER_WIDTH: 140,
        PROVIDER_HEIGHT: 36,
        SERVICE_WIDTH: 120,
        SERVICE_HEIGHT: 28,
        DEPENDENCY_WIDTH: 120,
        DEPENDENCY_HEIGHT: 24,
        NODE_GAP: 20,
        ROW_GAP: 100,
        INTERNAL_ROW_GAP: 40,
        SYSTEM_GAP: 30
    };

    // Colors for different sources
    static COLORS = {
        systems: '#6366f1',      // Indigo
        clientSystems: '#22c55e', // Green
        serverSystems: '#f97316', // Orange
        service: '#a855f7',       // Purple
        serviceUnused: '#64748b', // Grey - for services with no consumers
        satisfied: '#22c55e',     // Green
        missing: '#ef4444',       // Red
        selected: '#818cf8',      // Light indigo
        text: '#f8fafc',
        textMuted: '#94a3b8'
    };

    constructor(controller, moduleConfig, GUTS) {
        this.controller = controller;
        this.moduleConfig = moduleConfig;
        this.GUTS = GUTS;

        // Current data
        this.objectData = null;
        this.propertyName = null;

        // System arrays from scene data
        this.systems = [];
        this.clientSystems = [];
        this.serverSystems = [];

        // Resolved system info: { name, source, services, serviceDependencies, found }
        this.resolvedSystems = [];

        // Service provider map: serviceName -> [systemNames]
        this.serviceProviders = {};

        // Connections: { dependent, service, providers, satisfied }
        this.connections = [];

        // Active services (services that have both providers and consumers)
        this.activeServices = [];

        // Hierarchical layout nodes for 3-layer view
        this.hierarchyNodes = {
            dependencyNodes: [],  // Services this system needs (inputs) - shown above providers
            providerNodes: [],    // Layer 1: Systems that provide active services
            serviceNodes: [],     // Layer 2: Service nodes (only active ones)
        };

        // Graph nodes with positions
        this.nodes = [];

        // Selection state
        this.selectedSystem = null;
        this.selectedService = null;
        this.viewMode = 'hierarchy'; // 'hierarchy', 'systems', or 'service'

        // Service view nodes (separate from system nodes)
        this.serviceViewNodes = [];

        // Drag state
        this.isDragging = false;
        this.dragNode = null;
        this.dragBlock = null; // Provider name when dragging entire block
        this.dragOffset = { x: 0, y: 0 };
        this.hasDragged = false; // Track if actual movement occurred

        // Pan and zoom
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        this.isPanning = false;
        this.lastMousePos = { x: 0, y: 0 };

        // Canvas reference
        this.canvas = null;
        this.ctx = null;

        // Tooltip
        this.tooltip = null;
        this.hoveredConnection = null;
        this.hoveredDependency = null;

        // Loading flag
        this._isLoading = false;

        // Layout settings
        this.maxRowWidth = 10000;

        this.setupEventListeners();
    }

    /**
     * Check if current view mode uses hierarchical node layout (hierarchy or isolated)
     */
    isGraphView() {
        return this.viewMode === 'hierarchy' || this.viewMode === 'isolated';
    }

    /**
     * Calculate the width of a system block based on its services and dependencies
     * @param {string} sysName - System name
     * @param {Object} filter - Optional filter { services: Set, dependencies: Set }
     */
    getSystemBlockWidth(sysName, filter = null) {
        const L = SystemsEditor.LAYOUT;
        const sys = this.resolvedSystems.find(s => s.name === sysName);
        if (!sys) return L.PROVIDER_WIDTH;

        const columnWidth = Math.max(L.SERVICE_WIDTH, L.PROVIDER_WIDTH) + L.NODE_GAP;
        let services = sys.services || [];
        let dependencies = sys.serviceDependencies || [];

        // Apply filters if provided
        if (filter?.services) {
            services = services.filter(s => filter.services.has(s));
        }
        if (filter?.dependencies) {
            dependencies = dependencies.filter(d => filter.dependencies.has(d));
        }

        const servicesWidth = services.length * columnWidth;
        const depsWidth = dependencies.length * (L.DEPENDENCY_WIDTH + 8);
        return Math.max(servicesWidth, depsWidth, L.PROVIDER_WIDTH);
    }

    /**
     * Arrange system names into rows based on maxRowWidth
     * Returns array of arrays: [[sys1, sys2], [sys3], ...]
     * @param {string[]} systemNames - Array of system names
     * @param {Map} filterMap - Optional map of sysName -> { services: Set, dependencies: Set }
     */
    arrangeSystemsInRows(systemNames, filterMap = null) {
        const L = SystemsEditor.LAYOUT;
        const rows = [];
        let currentRow = [];
        let currentRowWidth = 0;

        systemNames.forEach(sysName => {
            const filter = filterMap?.get(sysName) || null;
            const blockWidth = this.getSystemBlockWidth(sysName, filter) + L.SYSTEM_GAP;

            if (currentRowWidth + blockWidth > this.maxRowWidth && currentRow.length > 0) {
                rows.push(currentRow);
                currentRow = [];
                currentRowWidth = 0;
            }
            currentRow.push(sysName);
            currentRowWidth += blockWidth;
        });

        if (currentRow.length > 0) {
            rows.push(currentRow);
        }

        return rows;
    }

    /**
     * Create nodes for a system block (provider + services + dependencies)
     * Returns the block height for layout calculations
     * @param {string} sysName - System name
     * @param {number} centerX - Center X position
     * @param {number} baseY - Base Y position
     * @param {number} rowIndex - Row index for grouping
     * @param {Object} filter - Optional filter { services: Set, dependencies: Set }
     */
    createSystemBlockNodes(sysName, centerX, baseY, rowIndex = 0, filter = null) {
        const L = SystemsEditor.LAYOUT;
        const sys = this.resolvedSystems.find(s => s.name === sysName);
        if (!sys) return 0;

        let services = sys.services || [];
        let dependencies = sys.serviceDependencies || [];

        // Apply filters if provided
        if (filter?.services) {
            services = services.filter(s => filter.services.has(s));
        }
        if (filter?.dependencies) {
            dependencies = dependencies.filter(d => filter.dependencies.has(d));
        }

        const columnWidth = Math.max(L.SERVICE_WIDTH, L.PROVIDER_WIDTH) + L.NODE_GAP;
        const servicesWidth = services.length * columnWidth;

        // Calculate Y positions
        const depY = baseY;
        const providerY = baseY + (dependencies.length > 0 ? L.DEPENDENCY_HEIGHT + 20 : 0);
        const serviceY = providerY + L.PROVIDER_HEIGHT + 30;

        // Create dependency nodes
        if (dependencies.length > 0) {
            const depTotalWidth = dependencies.length * (L.DEPENDENCY_WIDTH + 8);
            const depStartX = centerX - depTotalWidth / 2;

            dependencies.forEach((depName, i) => {
                const providers = this.serviceProviders[depName] || [];
                const isFulfilled = providers.length > 0;
                const providerSystemName = isFulfilled ? providers[0] : null;

                this.hierarchyNodes.dependencyNodes.push({
                    name: depName,
                    type: 'dependency',
                    x: depStartX + i * (L.DEPENDENCY_WIDTH + 8),
                    y: depY,
                    width: L.DEPENDENCY_WIDTH,
                    height: L.DEPENDENCY_HEIGHT,
                    consumerName: sysName,
                    isFulfilled,
                    providerSystemName,
                    source: sys.source || 'systems',
                    rowIndex
                });
            });
        }

        // Create provider node
        this.hierarchyNodes.providerNodes.push({
            name: sysName,
            source: sys.source || 'systems',
            type: 'provider',
            x: centerX - L.PROVIDER_WIDTH / 2,
            y: providerY,
            width: L.PROVIDER_WIDTH,
            height: L.PROVIDER_HEIGHT,
            found: sys.found ?? false,
            providedServices: services,
            dependencies: dependencies,
            rowIndex
        });

        // Create service nodes
        if (services.length > 0) {
            const servicesStartX = centerX - servicesWidth / 2;
            services.forEach((svcName, i) => {
                const svc = this.activeServices.find(s => s.name === svcName);
                this.hierarchyNodes.serviceNodes.push({
                    name: svcName,
                    type: 'service',
                    source: sys.source || 'systems',
                    x: servicesStartX + i * columnWidth + columnWidth / 2 - L.SERVICE_WIDTH / 2,
                    y: serviceY,
                    width: L.SERVICE_WIDTH,
                    height: L.SERVICE_HEIGHT,
                    providers: svc?.providers || [sysName],
                    consumers: svc?.consumers || [],
                    columnIndex: i,
                    rowIndex,
                    providerName: sysName
                });
            });
        }

        // Return block height
        return (dependencies.length > 0 ? L.DEPENDENCY_HEIGHT + 20 : 0) +
               L.PROVIDER_HEIGHT + 30 +
               (services.length > 0 ? L.SERVICE_HEIGHT : 0);
    }

    /**
     * Layout a row of systems horizontally centered, returning the max block height
     * @param {string[]} systemNames - Array of system names
     * @param {number} baseY - Base Y position
     * @param {number} canvasWidth - Canvas width for centering
     * @param {number} rowIndex - Row index
     * @param {Map} filterMap - Optional map of sysName -> { services: Set, dependencies: Set }
     */
    layoutSystemRow(systemNames, baseY, canvasWidth, rowIndex = 0, filterMap = null) {
        const L = SystemsEditor.LAYOUT;

        // Calculate total width
        const widths = systemNames.map(name => {
            const filter = filterMap?.get(name) || null;
            return this.getSystemBlockWidth(name, filter);
        });
        const totalWidth = widths.reduce((sum, w) => sum + w, 0) +
                          (systemNames.length - 1) * L.SYSTEM_GAP;

        let currentX = (canvasWidth - totalWidth) / 2;
        let maxHeight = 0;

        systemNames.forEach((sysName, i) => {
            const blockWidth = widths[i];
            const centerX = currentX + blockWidth / 2;
            const filter = filterMap?.get(sysName) || null;
            const blockHeight = this.createSystemBlockNodes(sysName, centerX, baseY, rowIndex, filter);
            maxHeight = Math.max(maxHeight, blockHeight);
            currentX += blockWidth + L.SYSTEM_GAP;
        });

        return maxHeight;
    }

    setupEventListeners() {
        // Listen for load hook
        document.body.addEventListener(this.moduleConfig.loadHook, (event) => {
            this.loadSystems(event.detail);
        });

        // Listen for unload event
        document.body.addEventListener(this.moduleConfig.unloadHook, () => {
            this.handleUnload();
        });

        // Ensure container exists - inject HTML if missing (fallback for interface loading issues)
        let container = document.getElementById(this.moduleConfig.container);
        if (!container) {
            this.injectHTML();
            container = document.getElementById(this.moduleConfig.container);
        }
        if (!container) {
            console.error('[SystemsEditor] Failed to create container');
            return;
        }

        // Save button
        document.getElementById('systems-save-btn')?.addEventListener('click', () => this.saveChanges());

        // Refresh button
        document.getElementById('systems-refresh-btn')?.addEventListener('click', () => this.refresh());

        // Add system button
        document.getElementById('systems-add-btn')?.addEventListener('click', () => this.handleAddSystem());

        // Filter input
        document.getElementById('systems-filter-input')?.addEventListener('input', (e) => {
            this.filterSystems(e.target.value);
        });

        // Zoom controls
        document.getElementById('systems-zoom-in-btn')?.addEventListener('click', () => this.setZoom(this.zoom + 0.05));
        document.getElementById('systems-zoom-out-btn')?.addEventListener('click', () => this.setZoom(this.zoom - 0.05));
        document.getElementById('systems-reset-layout-btn')?.addEventListener('click', () => this.resetLayout());

        // Row width slider
        const rowWidthSlider = document.getElementById('systems-row-width');
        const rowWidthValue = document.getElementById('systems-row-width-value');
        if (rowWidthSlider) {
            rowWidthSlider.addEventListener('input', (e) => {
                this.maxRowWidth = parseInt(e.target.value, 10);
                if (rowWidthValue) {
                    rowWidthValue.textContent = this.maxRowWidth;
                }
                // Recalculate layout based on current view mode
                if (this.viewMode === 'isolated') {
                    this.calculateIsolatedLayout();
                } else if (this.viewMode === 'hierarchy') {
                    this.calculateHierarchicalLayout();
                }
                this.render();
            });
        }

        // Setup canvas after a short delay to ensure DOM is ready
        setTimeout(() => this.setupCanvas(), 100);
    }

    /**
     * Inject HTML fallback if interface wasn't loaded properly
     */
    injectHTML() {
        const html = `
<div id="systems-editor-container" class="editor-module">
    <div class="editor-module__sidebar editor-module__sidebar--left editor-module__scroll-y">
        <div id="systems-status-container" class="editor-module__status-bar">
            <span id="systems-status-message">Ready</span>
        </div>
        <div class="editor-module__section">
            <div class="editor-module__toolbar editor-module__toolbar--vertical">
                <button id="systems-save-btn" class="editor-module__btn editor-module__btn--success">Save</button>
                <button id="systems-refresh-btn" class="editor-module__btn">Refresh</button>
            </div>
        </div>
        <div class="editor-module__section">
            <h3 class="editor-module__section-title">Add System</h3>
            <div class="systems-editor__add-controls" style="display:flex;flex-direction:column;gap:8px;">
                <select id="systems-available-select" class="editor-module__select"><option value="">-- Select System --</option></select>
                <select id="systems-target-select" class="editor-module__select">
                    <option value="systems">systems</option>
                    <option value="clientSystems">clientSystems</option>
                    <option value="serverSystems">serverSystems</option>
                </select>
                <button id="systems-add-btn" class="editor-module__btn editor-module__btn--primary editor-module__btn--small">+ Add</button>
            </div>
        </div>
        <div class="editor-module__section">
            <input type="text" id="systems-filter-input" class="editor-module__input" placeholder="Filter systems...">
        </div>
        <div class="editor-module__section">
            <h3 class="editor-module__section-title"><span style="display:inline-block;width:12px;height:12px;background:#6366f1;border-radius:3px;margin-right:8px;"></span>Systems (Shared)</h3>
            <div id="systems-list-systems" style="max-height:200px;overflow-y:auto;"></div>
        </div>
        <div class="editor-module__section">
            <h3 class="editor-module__section-title"><span style="display:inline-block;width:12px;height:12px;background:#22c55e;border-radius:3px;margin-right:8px;"></span>Client Systems</h3>
            <div id="systems-list-client" style="max-height:200px;overflow-y:auto;"></div>
        </div>
        <div class="editor-module__section">
            <h3 class="editor-module__section-title"><span style="display:inline-block;width:12px;height:12px;background:#f97316;border-radius:3px;margin-right:8px;"></span>Server Systems</h3>
            <div id="systems-list-server" style="max-height:200px;overflow-y:auto;"></div>
        </div>
    </div>
    <div class="editor-module__canvas-area" style="position:relative;background:#0f172a;">
        <div class="editor-module__canvas-toolbar">
            <button id="systems-zoom-in-btn" class="editor-module__btn editor-module__btn--small">+</button>
            <span id="systems-zoom-level">100%</span>
            <button id="systems-zoom-out-btn" class="editor-module__btn editor-module__btn--small">-</button>
            <button id="systems-reset-layout-btn" class="editor-module__btn editor-module__btn--small">Reset Layout</button>
        </div>
        <canvas id="systems-graph-canvas" style="width:100%;height:calc(100% - 40px);display:block;"></canvas>
        <div style="position:absolute;bottom:10px;left:10px;display:flex;gap:16px;background:rgba(15,23,42,0.9);padding:8px 12px;border-radius:6px;font-size:11px;">
            <span><span style="display:inline-block;width:14px;height:14px;background:#6366f1;border-radius:3px;margin-right:6px;vertical-align:middle;"></span>Shared</span>
            <span><span style="display:inline-block;width:14px;height:14px;background:#22c55e;border-radius:3px;margin-right:6px;vertical-align:middle;"></span>Client</span>
            <span><span style="display:inline-block;width:14px;height:14px;background:#f97316;border-radius:3px;margin-right:6px;vertical-align:middle;"></span>Server</span>
        </div>
    </div>
    <div class="editor-module__sidebar editor-module__sidebar--right editor-module__scroll-y" id="systems-details-panel">
        <div class="editor-module__section">
            <h3 class="editor-module__section-title">System Details</h3>
            <div id="systems-details-content"><p style="color:#94a3b8;font-style:italic;text-align:center;padding:20px 0;">Click a system node to view details</p></div>
        </div>
    </div>
</div>`;

        // Find the main content container and append our HTML
        const mainContent = document.querySelector('.main-content') || document.getElementById('main-content-container');
        if (mainContent) {
            mainContent.insertAdjacentHTML('beforeend', html);
        } else {
            document.body.insertAdjacentHTML('beforeend', html);
        }

        // Also inject minimal CSS
        const css = `
.systems-editor__system-item{display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:var(--editor-bg-light,#1e293b);border-radius:4px;cursor:pointer;margin-bottom:4px;}
.systems-editor__system-item:hover{background:var(--editor-bg-medium,#334155);}
.systems-editor__system-item--selected{background:var(--editor-primary,#6366f1);color:white;}
.systems-editor__system-item--has-missing-deps{border-left:3px solid #ef4444;}
.systems-editor__system-name{font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
.systems-editor__missing-deps-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;background:#ef4444;color:white;border-radius:50%;font-size:10px;font-weight:bold;margin-right:6px;flex-shrink:0;}
.systems-editor__remove-btn{background:none;border:none;color:#94a3b8;cursor:pointer;padding:2px 6px;font-size:14px;line-height:1;border-radius:3px;}
.systems-editor__remove-btn:hover{background:#ef4444;color:white;}
.systems-editor__empty-list{color:#94a3b8;font-style:italic;font-size:11px;padding:8px;text-align:center;}
`;
        const styleTag = document.createElement('style');
        styleTag.textContent = css;
        document.head.appendChild(styleTag);
    }

    setupCanvas() {
        this.canvas = document.getElementById('systems-graph-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');

        // Handle resize
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Mouse events for graph interaction
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        this.canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));

        // Create tooltip element
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'systems-editor__tooltip';
        this.tooltip.style.display = 'none';
        this.canvas.parentElement.appendChild(this.tooltip);
    }

    resizeCanvas() {
        if (!this.canvas) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height - 40; // Account for toolbar

        // Recalculate layouts with new canvas dimensions
        this.calculateHierarchicalLayout();
        this.calculateNodePositions();
        this.render();
    }

    loadSystems(detail) {
        this._isLoading = true;

        this.propertyName = detail.propertyName;
        this.objectData = detail.objectData || this.controller?.getCurrentObject();

        // Extract system arrays from object data
        this.systems = Array.isArray(this.objectData?.systems) ? [...this.objectData.systems] : [];
        this.clientSystems = Array.isArray(this.objectData?.clientSystems) ? [...this.objectData.clientSystems] : [];
        this.serverSystems = Array.isArray(this.objectData?.serverSystems) ? [...this.objectData.serverSystems] : [];

        // Show the editor
        Object.values(document.getElementsByClassName('editor-module')).forEach((editor) => {
            editor.classList.remove('show');
        });
        document.getElementById(this.moduleConfig.container)?.classList.add('show');

        // Process systems
        this.resolveSystems();
        this.buildServiceProviderMap();
        this.buildConnections();
        this.buildActiveServices();
        this.populateAvailableSystemsDropdown();
        this.renderSystemLists();
        this.calculateHierarchicalLayout();
        this.calculateNodePositions();

        // Setup canvas if not already done
        if (!this.canvas) {
            this.setupCanvas();
        }

        // resizeCanvas recalculates layouts and renders
        this.resizeCanvas();

        this._isLoading = false;
        this.updateStatus('Ready');
    }

    handleUnload() {
        this.selectedSystem = null;
        this.selectedService = null;
        this.viewMode = 'hierarchy';
        this.resolvedSystems = [];
        this.nodes = [];
        this.connections = [];
        this.activeServices = [];
        this.hierarchyNodes = {
            dependencyNodes: [],
            providerNodes: [],
            serviceNodes: [],
        };
        this.serviceViewNodes = [];
    }

    /**
     * Resolve system classes and extract their service info
     * Reads services and serviceDependencies from the class's static properties
     */
    resolveSystems() {
        this.resolvedSystems = [];

        // Track which systems we've already processed to avoid duplicates
        const processedSystems = new Set();

        // Get the systems collection for "found" fallback check
        const collections = this.controller?.getCollections?.() || {};
        const systemsCollection = collections.systems || {};

        const processArray = (arr, source) => {
            arr.forEach(name => {
                // Skip if we've already processed this system
                if (processedSystems.has(name)) return;
                processedSystems.add(name);

                // Get the class from GUTS namespace - this is the source of truth
                const cls = window.GUTS?.[name];

                // Read services and serviceDependencies from class static properties
                const services = cls?.services || [];
                const serviceDependencies = cls?.serviceDependencies || [];

                // Check if collection data exists (for "found" fallback if class not loaded)
                const collectionObj = systemsCollection[name];

                // Consider it "found" if the class is loaded
                const found = !!cls;

                this.resolvedSystems.push({
                    name,
                    source,
                    services,
                    serviceDependencies,
                    found
                });
            });
        };

        processArray(this.systems, 'systems');
        processArray(this.clientSystems, 'clientSystems');
        processArray(this.serverSystems, 'serverSystems');
    }

    /**
     * Build map of which systems provide which services
     */
    buildServiceProviderMap() {
        this.serviceProviders = {};

        this.resolvedSystems.forEach(sys => {
            (sys.services || []).forEach(service => {
                if (!this.serviceProviders[service]) {
                    this.serviceProviders[service] = [];
                }
                this.serviceProviders[service].push(sys.name);
            });
        });
    }

    /**
     * Build connections array showing dependencies between systems
     */
    buildConnections() {
        this.connections = [];

        this.resolvedSystems.forEach(sys => {
            (sys.serviceDependencies || []).forEach(dep => {
                const providers = this.serviceProviders[dep] || [];
                this.connections.push({
                    dependent: sys.name,
                    service: dep,
                    providers: [...providers],
                    satisfied: providers.length > 0
                });
            });
        });

    }

    /**
     * Build list of active services - services that have both providers AND consumers
     * These are the services that will be shown as nodes in the hierarchical view
     */
    buildActiveServices() {
        this.activeServices = [];

        // For each service that has providers
        Object.entries(this.serviceProviders).forEach(([serviceName, providers]) => {
            // Find consumers (systems that have this in serviceDependencies)
            const consumers = this.resolvedSystems
                .filter(sys => (sys.serviceDependencies || []).includes(serviceName))
                .map(sys => sys.name);

            // Only include if there are consumers
            if (consumers.length > 0) {
                this.activeServices.push({
                    name: serviceName,
                    providers: [...providers],
                    consumers: consumers
                });
            }
        });

    }

    /**
     * Get all available systems from global + project collections
     */
    getAllAvailableSystems() {
        const available = [];
        const collections = this.controller?.getCollections?.() || {};
        const allSystems = collections.systems || {};

        Object.keys(allSystems).forEach(name => {
            // Check if it's already included
            const isIncluded = this.systems.includes(name) ||
                             this.clientSystems.includes(name) ||
                             this.serverSystems.includes(name);

            if (!isIncluded) {
                available.push(name);
            }
        });

        return available.sort();
    }

    /**
     * Populate the available systems dropdown
     */
    populateAvailableSystemsDropdown() {
        const select = document.getElementById('systems-available-select');
        if (!select) return;

        const available = this.getAllAvailableSystems();

        select.innerHTML = '<option value="">-- Select System --</option>';
        available.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });
    }

    /**
     * Render system lists in left sidebar
     */
    renderSystemLists() {
        this.renderSystemList('systems-list-systems', this.systems, 'systems');
        this.renderSystemList('systems-list-client', this.clientSystems, 'clientSystems');
        this.renderSystemList('systems-list-server', this.serverSystems, 'serverSystems');
    }

    renderSystemList(containerId, systems, source) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (systems.length === 0) {
            container.innerHTML = '<div class="systems-editor__empty-list">No systems</div>';
            return;
        }

        container.innerHTML = systems.map(name => {
            const resolved = this.resolvedSystems.find(s => s.name === name && s.source === source);
            const isSelected = this.selectedSystem === name;
            const isMissing = resolved && !resolved.found;
            const hasMissingDeps = this.systemHasMissingDependencies(name);

            return `
                <div class="systems-editor__system-item ${isSelected ? 'systems-editor__system-item--selected' : ''} ${isMissing ? 'systems-editor__system-item--missing' : ''} ${hasMissingDeps ? 'systems-editor__system-item--has-missing-deps' : ''}"
                     data-name="${name}" data-source="${source}">
                    ${hasMissingDeps ? '<span class="systems-editor__missing-deps-icon" title="Has missing dependencies">!</span>' : ''}
                    <span class="systems-editor__system-name">${name}</span>
                    <button class="systems-editor__remove-btn" data-name="${name}" data-source="${source}">&times;</button>
                </div>
            `;
        }).join('');

        // Add click handlers
        container.querySelectorAll('.systems-editor__system-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('systems-editor__remove-btn')) return;
                this.selectSystem(item.dataset.name);
            });
        });

        // Add remove handlers
        container.querySelectorAll('.systems-editor__remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeSystem(btn.dataset.name, btn.dataset.source);
            });
        });
    }

    /**
     * Calculate node positions for graph layout
     * Layout: Server systems at top, Shared systems in middle, Client systems at bottom
     */
    calculateNodePositions() {
        this.nodes = [];

        if (this.resolvedSystems.length === 0) return;

        const canvasWidth = this.canvas?.width || 800;
        const canvasHeight = this.canvas?.height || 600;
        const centerX = canvasWidth / 2;

        // Group by source
        const groups = {
            serverSystems: this.resolvedSystems.filter(s => s.source === 'serverSystems'),
            systems: this.resolvedSystems.filter(s => s.source === 'systems'),
            clientSystems: this.resolvedSystems.filter(s => s.source === 'clientSystems')
        };

        // Layout in three horizontal rows: server (top), shared (middle), client (bottom)
        const rows = [
            { systems: groups.serverSystems, y: canvasHeight * 0.15 },
            { systems: groups.systems, y: canvasHeight * 0.5 },
            { systems: groups.clientSystems, y: canvasHeight * 0.85 }
        ];

        rows.forEach(row => {
            const count = row.systems.length;
            if (count === 0) return;

            const totalWidth = count * (SystemsEditor.NODE_WIDTH + SystemsEditor.NODE_PADDING);
            const startX = centerX - totalWidth / 2;

            row.systems.forEach((sys, i) => {
                this.nodes.push({
                    name: sys.name,
                    source: sys.source,
                    x: startX + i * (SystemsEditor.NODE_WIDTH + SystemsEditor.NODE_PADDING),
                    y: row.y - SystemsEditor.NODE_HEIGHT / 2,
                    width: SystemsEditor.NODE_WIDTH,
                    height: SystemsEditor.NODE_HEIGHT,
                    found: sys.found
                });
            });
        });
    }

    /**
     * Calculate hierarchical layout organized by source (server/shared/client):
     * - Three horizontal bands for serverSystems, systems (shared), clientSystems
     * - Systems are atomic blocks - all services from one provider stay together
     * - When a system block won't fit in the row, the entire system moves to next row
     * - Dependency nodes (inputs) appear above each provider
     */
    calculateHierarchicalLayout() {
        this.hierarchyNodes = {
            dependencyNodes: [],  // Services this system needs (inputs)
            providerNodes: [],
            serviceNodes: [],
        };

        if (this.activeServices.length === 0) return;

        const canvasWidth = this.canvas?.width || 800;

        // Dimensions for different node types
        const PROVIDER_WIDTH = 140;
        const PROVIDER_HEIGHT = 36;
        const SERVICE_WIDTH = 120;
        const SERVICE_HEIGHT = 28;
        const DEPENDENCY_WIDTH = 120;
        const DEPENDENCY_HEIGHT = 24;
        const GROUP_MIN_WIDTH = 160;
        const GROUP_LINE_HEIGHT = 18;
        const GROUP_PADDING = 12;
        const NODE_GAP = 20;
        const ROW_GAP = 100; // Gap between source bands
        const BAND_INTERNAL_GAP = 60; // Gap between provider/service/consumer within a band
        const INTERNAL_ROW_GAP = 40; // Gap between rows within a band
        const SYSTEM_GAP = 30; // Gap between system blocks

        // Step 1: Group active services by their primary provider
        const servicesByProvider = {};
        this.activeServices.forEach(svc => {
            const primaryProvider = svc.providers[0];
            if (!servicesByProvider[primaryProvider]) {
                servicesByProvider[primaryProvider] = [];
            }
            servicesByProvider[primaryProvider].push(svc);
        });

        // Step 2: Create system blocks (provider + its services)
        const systemBlocksBySource = {
            serverSystems: [],
            systems: [],
            clientSystems: []
        };

        Object.entries(servicesByProvider).forEach(([providerName, services]) => {
            const sys = this.resolvedSystems.find(s => s.name === providerName);
            const source = sys?.source || 'systems';

            // Get dependencies for this system
            const dependencies = sys?.serviceDependencies || [];

            systemBlocksBySource[source].push({
                providerName,
                services,
                serviceCount: services.length,
                dependencies,
                sys
            });
        });

        // Step 3: Calculate layout for each source band
        const columnWidth = Math.max(SERVICE_WIDTH, GROUP_MIN_WIDTH) + NODE_GAP;
        let currentY = 60; // Start Y position

        const sourceBands = [
            { source: 'serverSystems', label: 'Server Systems', color: '#f97316' },
            { source: 'systems', label: 'Shared Systems', color: '#6366f1' },
            { source: 'clientSystems', label: 'Client Systems', color: '#22c55e' }
        ];

        sourceBands.forEach(band => {
            const systemBlocks = systemBlocksBySource[band.source];
            if (systemBlocks.length === 0) return;

            // Calculate actual block widths (max of services, dependencies, consumer groups)
            systemBlocks.forEach(block => {
                const servicesWidth = block.serviceCount * columnWidth;
                const depsWidth = block.dependencies.length * (DEPENDENCY_WIDTH + 8);
                block.actualWidth = Math.max(servicesWidth, depsWidth, PROVIDER_WIDTH) + SYSTEM_GAP;
            });

            // Arrange system blocks into rows based on maxRowWidth
            const rows = [];
            let currentRow = [];
            let currentRowWidth = 0;

            systemBlocks.forEach(block => {
                // If adding this block would exceed the limit AND the row isn't empty, start new row
                if (currentRowWidth + block.actualWidth > this.maxRowWidth && currentRow.length > 0) {
                    rows.push(currentRow);
                    currentRow = [];
                    currentRowWidth = 0;
                }
                currentRow.push(block);
                currentRowWidth += block.actualWidth;
            });
            if (currentRow.length > 0) {
                rows.push(currentRow);
            }

            // Process each row within this band
            rows.forEach((rowBlocks, rowIndex) => {
                // Calculate row positions (dependency nodes above provider, services below)
                const dependencyY = currentY;
                const providerY = currentY + DEPENDENCY_HEIGHT + 20;
                const serviceY = providerY + PROVIDER_HEIGHT + 30; // Smaller gap since no consumer groups

                // Calculate total width needed (using actual widths)
                const totalBlockWidth = rowBlocks.reduce((sum, block) => {
                    return sum + block.actualWidth;
                }, -SYSTEM_GAP); // Remove last gap (actualWidth includes SYSTEM_GAP)

                let currentX = (canvasWidth - totalBlockWidth) / 2;

                // Position each system block
                rowBlocks.forEach(block => {
                    const blockStartX = currentX;
                    const blockContentWidth = block.actualWidth - SYSTEM_GAP; // Width without the gap
                    const providerCenterX = blockStartX + blockContentWidth / 2;

                    // Position dependency nodes above the provider
                    if (block.dependencies.length > 0) {
                        const depTotalWidth = block.dependencies.length * (DEPENDENCY_WIDTH + 8);
                        const depStartX = providerCenterX - depTotalWidth / 2;

                        block.dependencies.forEach((depName, i) => {
                            // Find who provides this service
                            const providers = this.serviceProviders[depName] || [];
                            const isFulfilled = providers.length > 0;
                            const providerSystemName = isFulfilled ? providers[0] : null;

                            this.hierarchyNodes.dependencyNodes.push({
                                name: depName,
                                type: 'dependency',
                                x: depStartX + i * (DEPENDENCY_WIDTH + 8),
                                y: dependencyY,
                                width: DEPENDENCY_WIDTH,
                                height: DEPENDENCY_HEIGHT,
                                consumerName: block.providerName,
                                isFulfilled,
                                providerSystemName,
                                source: band.source,
                                rowIndex: rowIndex
                            });
                        });
                    }

                    // Position services for this block (centered within block)
                    const servicesWidth = block.serviceCount * columnWidth;
                    const servicesStartX = blockStartX + (blockContentWidth - servicesWidth) / 2;

                    block.services.forEach((svc, i) => {
                        const columnCenterX = servicesStartX + i * columnWidth + columnWidth / 2;

                        // Service node (output)
                        this.hierarchyNodes.serviceNodes.push({
                            name: svc.name,
                            type: 'service',
                            source: band.source,
                            x: columnCenterX - SERVICE_WIDTH / 2,
                            y: serviceY,
                            width: SERVICE_WIDTH,
                            height: SERVICE_HEIGHT,
                            providers: svc.providers,
                            consumers: svc.consumers,
                            columnIndex: i,
                            columnCenterX: columnCenterX,
                            rowIndex: rowIndex,
                            providerName: block.providerName
                        });
                    });

                    // Position provider centered above its services
                    this.hierarchyNodes.providerNodes.push({
                        name: block.providerName,
                        source: band.source,
                        type: 'provider',
                        x: providerCenterX - PROVIDER_WIDTH / 2,
                        y: providerY,
                        width: PROVIDER_WIDTH,
                        height: PROVIDER_HEIGHT,
                        found: block.sys?.found ?? false,
                        providedServices: block.services.map(s => s.name),
                        dependencies: block.dependencies,
                        rowIndex: rowIndex
                    });

                    // Move X position for next block
                    currentX += block.actualWidth;
                });

                // Move to next row within band (services are at the bottom now)
                currentY = serviceY + SERVICE_HEIGHT + INTERNAL_ROW_GAP;
            });

            // Add extra gap after the band
            currentY += (ROW_GAP - INTERNAL_ROW_GAP);
        });
    }


    /**
     * Main render function
     */
    render() {
        if (!this.ctx || !this.canvas) return;

        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Apply zoom and pan
        ctx.save();
        ctx.translate(this.pan.x, this.pan.y);
        ctx.scale(this.zoom, this.zoom);

        if (this.viewMode === 'service' && this.selectedService) {
            // Render service-focused view
            this.renderServiceViewConnections(ctx);
            this.renderServiceViewNodes(ctx);
        } else if (this.viewMode === 'hierarchy' || this.viewMode === 'isolated') {
            // Render hierarchical view (full or isolated)
            this.renderHierarchicalConnections(ctx);
            this.renderHierarchicalNodes(ctx);
        } else {
            // Render flat systems view
            this.renderConnections(ctx);
            this.renderNodes(ctx);
        }

        ctx.restore();
    }

    /**
     * Render connections for service-focused view
     */
    renderServiceViewConnections(ctx) {
        const serviceNode = this.serviceViewNodes.find(n => n.type === 'service');
        if (!serviceNode) return;

        // Draw connections from providers to service
        this.serviceViewNodes.filter(n => n.type === 'provider').forEach(providerNode => {
            const fromX = providerNode.x + providerNode.width / 2;
            const fromY = providerNode.y + providerNode.height;
            const toX = serviceNode.x + serviceNode.width / 2;
            const toY = serviceNode.y;

            ctx.beginPath();
            ctx.moveTo(fromX, fromY);

            const cpOffset = Math.abs(toY - fromY) * 0.4;
            ctx.bezierCurveTo(
                fromX, fromY + cpOffset,
                toX, toY - cpOffset,
                toX, toY
            );

            ctx.strokeStyle = SystemsEditor.COLORS.satisfied;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.stroke();

            this.drawArrowHead(ctx, fromX, fromY + cpOffset, toX, toY, true);
        });

        // Draw connections from service to dependents
        this.serviceViewNodes.filter(n => n.type === 'dependent').forEach(dependentNode => {
            const fromX = serviceNode.x + serviceNode.width / 2;
            const fromY = serviceNode.y + serviceNode.height;
            const toX = dependentNode.x + dependentNode.width / 2;
            const toY = dependentNode.y;

            ctx.beginPath();
            ctx.moveTo(fromX, fromY);

            const cpOffset = Math.abs(toY - fromY) * 0.4;
            ctx.bezierCurveTo(
                fromX, fromY + cpOffset,
                toX, toY - cpOffset,
                toX, toY
            );

            ctx.strokeStyle = SystemsEditor.COLORS.satisfied;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.stroke();

            this.drawArrowHead(ctx, toX, toY - cpOffset, toX, toY, true);
        });
    }

    /**
     * Render nodes for service-focused view
     */
    renderServiceViewNodes(ctx) {
        this.serviceViewNodes.forEach(node => {
            const isService = node.type === 'service';
            const isSelected = this.selectedSystem === node.name && !isService;

            // Node background - use service color for service node
            if (isService) {
                ctx.fillStyle = SystemsEditor.COLORS.service;
            } else {
                ctx.fillStyle = isSelected ? SystemsEditor.COLORS.selected : SystemsEditor.COLORS[node.source];
            }

            // Rounded rectangle
            this.roundRect(ctx, node.x, node.y, node.width, node.height, 6);
            ctx.fill();

            // Border for service node
            if (isService) {
                ctx.strokeStyle = '#c084fc';
                ctx.lineWidth = 2;
                ctx.setLineDash([]);
                this.roundRect(ctx, node.x, node.y, node.width, node.height, 6);
                ctx.stroke();
            }

            // Border for missing systems
            if (!node.found && !isService) {
                ctx.strokeStyle = SystemsEditor.COLORS.missing;
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                this.roundRect(ctx, node.x, node.y, node.width, node.height, 6);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Node text
            ctx.fillStyle = SystemsEditor.COLORS.text;
            ctx.font = isService ? 'bold 12px sans-serif' : '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Truncate long names
            let displayName = node.name;
            const maxWidth = node.width - 16;
            while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
                displayName = displayName.slice(0, -4) + '...';
            }

            ctx.fillText(displayName, node.x + node.width / 2, node.y + node.height / 2);

            // Draw type label above/below node
            if (!isService) {
                ctx.fillStyle = SystemsEditor.COLORS.textMuted;
                ctx.font = '10px sans-serif';
                const label = node.type === 'provider' ? 'provides' : 'depends on';
                const labelY = node.type === 'provider' ? node.y - 8 : node.y + node.height + 14;
                ctx.fillText(label, node.x + node.width / 2, labelY);
            }
        });
    }

    renderConnections(ctx) {
        let connectionsDrawn = 0;
        let connectionsMissing = 0;

        this.connections.forEach(conn => {
            const toNode = this.nodes.find(n => n.name === conn.dependent);
            if (!toNode) {
                connectionsMissing++;
                return;
            }

            conn.providers.forEach(provider => {
                const fromNode = this.nodes.find(n => n.name === provider);
                if (!fromNode) return;

                // Skip self-connections
                if (fromNode.name === toNode.name) return;

                connectionsDrawn++;

                // Calculate connection points based on relative positions
                const fromCenterX = fromNode.x + fromNode.width / 2;
                const fromCenterY = fromNode.y + fromNode.height / 2;
                const toCenterX = toNode.x + toNode.width / 2;
                const toCenterY = toNode.y + toNode.height / 2;

                let fromX, fromY, toX, toY;

                // Determine if connection is primarily vertical or horizontal
                const dx = Math.abs(toCenterX - fromCenterX);
                const dy = Math.abs(toCenterY - fromCenterY);

                // Check if nodes are in the same row (same Y position = horizontal layout)
                const sameRow = dy < SystemsEditor.NODE_HEIGHT;

                if (sameRow) {
                    // Same row: curve above/below the nodes to make connection visible
                    // Connect from top edge, curve above
                    fromX = fromCenterX;
                    toX = toCenterX;
                    fromY = fromNode.y; // Top edge
                    toY = toNode.y;     // Top edge

                    // Calculate curve height based on distance between nodes
                    const curveHeight = Math.max(40, dx * 0.3);

                    ctx.beginPath();
                    ctx.moveTo(fromX, fromY);

                    // Bezier curve going above the nodes
                    const midX = (fromX + toX) / 2;
                    const midY = fromY - curveHeight;

                    ctx.bezierCurveTo(
                        fromX, midY,
                        toX, midY,
                        toX, toY
                    );

                    ctx.strokeStyle = conn.satisfied ? SystemsEditor.COLORS.satisfied : SystemsEditor.COLORS.missing;
                    ctx.lineWidth = 2;
                    ctx.setLineDash(conn.satisfied ? [] : [5, 5]);
                    ctx.stroke();

                    // Arrow head pointing down to the target node
                    this.drawArrowHead(ctx, toX, midY, toX, toY, conn.satisfied);
                } else if (dy > dx) {
                    // Vertical connection (provider above/below dependent)
                    fromX = fromCenterX;
                    toX = toCenterX;
                    if (fromCenterY < toCenterY) {
                        // Provider is above dependent
                        fromY = fromNode.y + fromNode.height;
                        toY = toNode.y;
                    } else {
                        // Provider is below dependent
                        fromY = fromNode.y;
                        toY = toNode.y + toNode.height;
                    }

                    ctx.beginPath();
                    ctx.moveTo(fromX, fromY);

                    const cpOffset = Math.abs(toY - fromY) * 0.4;
                    ctx.bezierCurveTo(
                        fromX, fromY + (fromCenterY < toCenterY ? cpOffset : -cpOffset),
                        toX, toY + (fromCenterY < toCenterY ? -cpOffset : cpOffset),
                        toX, toY
                    );

                    ctx.strokeStyle = conn.satisfied ? SystemsEditor.COLORS.satisfied : SystemsEditor.COLORS.missing;
                    ctx.lineWidth = 2;
                    ctx.setLineDash(conn.satisfied ? [] : [5, 5]);
                    ctx.stroke();

                    const arrowFromY = fromCenterY < toCenterY ? toY - 20 : toY + 20;
                    this.drawArrowHead(ctx, toX, arrowFromY, toX, toY, conn.satisfied);
                } else {
                    // Horizontal connection between different rows
                    fromY = fromCenterY;
                    toY = toCenterY;
                    if (fromCenterX < toCenterX) {
                        fromX = fromNode.x + fromNode.width;
                        toX = toNode.x;
                    } else {
                        fromX = fromNode.x;
                        toX = toNode.x + toNode.width;
                    }

                    ctx.beginPath();
                    ctx.moveTo(fromX, fromY);

                    const cpOffset = Math.abs(toX - fromX) * 0.4;
                    ctx.bezierCurveTo(
                        fromX + (fromCenterX < toCenterX ? cpOffset : -cpOffset), fromY,
                        toX + (fromCenterX < toCenterX ? -cpOffset : cpOffset), toY,
                        toX, toY
                    );

                    ctx.strokeStyle = conn.satisfied ? SystemsEditor.COLORS.satisfied : SystemsEditor.COLORS.missing;
                    ctx.lineWidth = 2;
                    ctx.setLineDash(conn.satisfied ? [] : [5, 5]);
                    ctx.stroke();

                    const arrowFromX = fromCenterX < toCenterX ? toX - 20 : toX + 20;
                    this.drawArrowHead(ctx, arrowFromX, toY, toX, toY, conn.satisfied);
                }
            });

            // Draw missing dependency indicator (no provider)
            if (conn.providers.length === 0) {
                const x = toNode.x + toNode.width / 2;
                const y = toNode.y - 20;

                ctx.beginPath();
                ctx.arc(x, y, 8, 0, Math.PI * 2);
                ctx.fillStyle = SystemsEditor.COLORS.missing;
                ctx.fill();

                ctx.fillStyle = '#fff';
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('!', x, y);
            }
        });

        ctx.setLineDash([]);
    }

    drawArrowHead(ctx, fromX, fromY, toX, toY, satisfied) {
        const headLen = 10;
        const angle = Math.atan2(toY - fromY, toX - fromX);

        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(
            toX - headLen * Math.cos(angle - Math.PI / 6),
            toY - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            toX - headLen * Math.cos(angle + Math.PI / 6),
            toY - headLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = satisfied ? SystemsEditor.COLORS.satisfied : SystemsEditor.COLORS.missing;
        ctx.fill();
    }

    renderNodes(ctx) {
        this.nodes.forEach(node => {
            const isSelected = this.selectedSystem === node.name;

            // Node background
            ctx.fillStyle = isSelected ? SystemsEditor.COLORS.selected : SystemsEditor.COLORS[node.source];

            // Rounded rectangle
            this.roundRect(ctx, node.x, node.y, node.width, node.height, 6);
            ctx.fill();

            // Border for missing systems
            if (!node.found) {
                ctx.strokeStyle = SystemsEditor.COLORS.missing;
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                this.roundRect(ctx, node.x, node.y, node.width, node.height, 6);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Node text
            ctx.fillStyle = SystemsEditor.COLORS.text;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Truncate long names
            let displayName = node.name;
            const maxWidth = node.width - 16;
            while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
                displayName = displayName.slice(0, -4) + '...';
            }

            ctx.fillText(displayName, node.x + node.width / 2, node.y + node.height / 2);
        });
    }

    /**
     * Render connections for hierarchical view
     * Draws external connections from service outputs to dependency inputs on consuming systems
     */
    renderHierarchicalConnections(ctx) {
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeStyle = SystemsEditor.COLORS.satisfied;

        // Draw orange lines between duplicate services (same service provided by multiple systems)
        if (this.viewMode !== 'isolated') {
            this.drawDuplicateServiceConnections(ctx);
        }

        // In isolated view, always draw all connections
        // In hierarchy view, only draw connections for selected system
        if (this.viewMode === 'isolated' || this.selectedSystem) {
            const targetSystem = this.selectedSystem;
            // Draw connections FROM selected system's services TO dependency nodes on other systems
            this.hierarchyNodes.serviceNodes
                .filter(sn => sn.providerName === this.selectedSystem)
                .forEach(serviceNode => {
                    const consumingDeps = this.hierarchyNodes.dependencyNodes.filter(
                        dep => dep.name === serviceNode.name && dep.isFulfilled && dep.consumerName !== this.selectedSystem
                    );

                    consumingDeps.forEach(depNode => {
                        this.drawExternalConnection(ctx, serviceNode, depNode);
                    });
                });

            // Draw connections TO selected system's dependency nodes FROM service nodes on other systems
            this.hierarchyNodes.dependencyNodes
                .filter(dep => dep.consumerName === this.selectedSystem && dep.isFulfilled)
                .forEach(depNode => {
                    const providingService = this.hierarchyNodes.serviceNodes.find(
                        sn => sn.name === depNode.name && sn.providerName !== this.selectedSystem
                    );

                    if (providingService) {
                        this.drawExternalConnection(ctx, providingService, depNode);
                    }
                });
        }
    }

    /**
     * Draw an external connection from a service node to a dependency node
     */
    drawExternalConnection(ctx, serviceNode, depNode) {
        const fromX = serviceNode.x + serviceNode.width / 2;
        const fromY = serviceNode.y + serviceNode.height;
        const toX = depNode.x + depNode.width / 2;
        const toY = depNode.y;

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);

        // Use bezier curve with horizontal and vertical tendencies
        const cpOffset = Math.min(Math.abs(toY - fromY) * 0.3, 100);
        ctx.bezierCurveTo(
            fromX, fromY + cpOffset,
            toX, toY - cpOffset,
            toX, toY
        );

        ctx.strokeStyle = SystemsEditor.COLORS.satisfied;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw arrow head at destination
        this.drawArrowHead(ctx, toX, toY - 10, toX, toY, true);
    }

    /**
     * Draw orange connections between duplicate services (same service provided by multiple systems)
     */
    drawDuplicateServiceConnections(ctx) {
        // Group service nodes by name
        const servicesByName = {};
        this.hierarchyNodes.serviceNodes.forEach(sn => {
            if (!servicesByName[sn.name]) {
                servicesByName[sn.name] = [];
            }
            servicesByName[sn.name].push(sn);
        });

        // Draw connections between duplicates
        ctx.strokeStyle = '#f97316'; // Orange
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);

        Object.values(servicesByName).forEach(nodes => {
            if (nodes.length < 2) return;

            // Connect each pair of duplicate services
            for (let i = 0; i < nodes.length - 1; i++) {
                const from = nodes[i];
                const to = nodes[i + 1];

                const fromX = from.x + from.width / 2;
                const fromY = from.y + from.height / 2;
                const toX = to.x + to.width / 2;
                const toY = to.y + to.height / 2;

                ctx.beginPath();
                ctx.moveTo(fromX, fromY);

                // Use bezier curve for smooth connection
                const midY = (fromY + toY) / 2;
                const offsetY = Math.abs(toX - fromX) * 0.2;
                ctx.bezierCurveTo(
                    fromX, midY + offsetY,
                    toX, midY + offsetY,
                    toX, toY
                );

                ctx.stroke();
            }
        });

        ctx.setLineDash([]);
    }

    /**
     * Check if a system has missing service dependencies
     */
    systemHasMissingDependencies(systemName) {
        const sys = this.resolvedSystems.find(s => s.name === systemName);
        if (!sys) return false;
        return (sys.serviceDependencies || []).some(dep =>
            !this.serviceProviders[dep] || this.serviceProviders[dep].length === 0
        );
    }

    /**
     * Get the bounding box for a provider block (provider + dependencies + services + consumer groups)
     * @param {Object} provider - The provider node
     * @param {number} padding - Padding around the box
     * @returns {Object|null} - { minX, maxX, minY, maxY, width, height } or null if no nodes
     */
    getProviderBlockBounds(provider, padding = 12) {
        // Find all services this provider provides
        const providerServices = this.hierarchyNodes.serviceNodes.filter(
            sn => sn.providerName === provider.name && sn.rowIndex === provider.rowIndex
        );

        // Find dependency nodes for this provider
        const dependencyNodes = this.hierarchyNodes.dependencyNodes.filter(
            dn => dn.consumerName === provider.name && dn.rowIndex === provider.rowIndex
        );

        // Calculate bounding box (no consumer groups anymore)
        const allNodes = [provider, ...providerServices, ...dependencyNodes];
        if (allNodes.length === 0) return null;

        const minX = Math.min(...allNodes.map(n => n.x)) - padding;
        const maxX = Math.max(...allNodes.map(n => n.x + n.width)) + padding;
        const minY = Math.min(...allNodes.map(n => n.y)) - padding;
        const maxY = Math.max(...allNodes.map(n => n.y + n.height)) + padding;

        return {
            minX,
            maxX,
            minY,
            maxY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Render boxes around each provider block (provider + dependencies + services + consumer groups)
     */
    renderProviderBoxes(ctx) {
        const PADDING = 12;
        const sourceColors = {
            serverSystems: 'rgba(249, 115, 22, 0.08)',  // Orange tint
            systems: 'rgba(99, 102, 241, 0.08)',        // Indigo tint
            clientSystems: 'rgba(34, 197, 94, 0.08)'    // Green tint
        };
        const borderColors = {
            serverSystems: 'rgba(249, 115, 22, 0.25)',
            systems: 'rgba(99, 102, 241, 0.25)',
            clientSystems: 'rgba(34, 197, 94, 0.25)'
        };

        // Group nodes by provider
        this.hierarchyNodes.providerNodes.forEach(provider => {
            const bounds = this.getProviderBlockBounds(provider, PADDING);
            if (!bounds) return;

            // Draw filled box
            ctx.fillStyle = sourceColors[provider.source] || sourceColors.systems;
            this.roundRect(ctx, bounds.minX, bounds.minY, bounds.width, bounds.height, 10);
            ctx.fill();

            // Draw border
            ctx.strokeStyle = borderColors[provider.source] || borderColors.systems;
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            this.roundRect(ctx, bounds.minX, bounds.minY, bounds.width, bounds.height, 10);
            ctx.stroke();
        });
    }

    /**
     * Render nodes for 4-layer hierarchical view
     */
    renderHierarchicalNodes(ctx) {
        // First, render boxes around each provider block (provider + its services + consumers)
        this.renderProviderBoxes(ctx);

        // Layer 0: Dependency nodes (inputs - services this system needs)
        this.hierarchyNodes.dependencyNodes.forEach(node => {
            const isHovered = this.hoveredDependency === node;

            if (node.isFulfilled) {
                // Fulfilled dependency - green/teal background
                ctx.fillStyle = isHovered ? '#065f46' : '#134e4a';
                this.roundRect(ctx, node.x, node.y, node.width, node.height, 4);
                ctx.fill();

                // Border
                ctx.strokeStyle = '#14b8a6';
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                this.roundRect(ctx, node.x, node.y, node.width, node.height, 4);
                ctx.stroke();

                // Service name (top line, smaller)
                ctx.fillStyle = '#5eead4';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                let serviceName = node.name;
                const maxServiceWidth = node.width - 8;
                while (ctx.measureText(serviceName).width > maxServiceWidth && serviceName.length > 3) {
                    serviceName = serviceName.slice(0, -4) + '...';
                }
                ctx.fillText(serviceName, node.x + node.width / 2, node.y + 3);

                // Provider name (bottom line, clickable indicator)
                ctx.fillStyle = isHovered ? '#fff' : '#99f6e4';
                ctx.font = 'bold 10px sans-serif';
                ctx.textBaseline = 'bottom';
                let providerName = '→ ' + node.providerSystemName;
                while (ctx.measureText(providerName).width > maxServiceWidth && providerName.length > 5) {
                    providerName = providerName.slice(0, -4) + '...';
                }
                ctx.fillText(providerName, node.x + node.width / 2, node.y + node.height - 2);
            } else {
                // Missing dependency - red background
                ctx.fillStyle = '#7f1d1d';
                this.roundRect(ctx, node.x, node.y, node.width, node.height, 4);
                ctx.fill();

                // Dashed border to indicate missing
                ctx.strokeStyle = '#ef4444';
                ctx.lineWidth = 2;
                ctx.setLineDash([3, 3]);
                this.roundRect(ctx, node.x, node.y, node.width, node.height, 4);
                ctx.stroke();
                ctx.setLineDash([]);

                // Service name
                ctx.fillStyle = '#fca5a5';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                let serviceName = node.name;
                const maxServiceWidth = node.width - 8;
                while (ctx.measureText(serviceName).width > maxServiceWidth && serviceName.length > 3) {
                    serviceName = serviceName.slice(0, -4) + '...';
                }
                ctx.fillText(serviceName, node.x + node.width / 2, node.y + 3);

                // "Missing" indicator
                ctx.fillStyle = '#ef4444';
                ctx.font = 'bold 10px sans-serif';
                ctx.textBaseline = 'bottom';
                ctx.fillText('MISSING', node.x + node.width / 2, node.y + node.height - 2);
            }
        });

        // Layer 1: Provider nodes
        this.hierarchyNodes.providerNodes.forEach(node => {
            const isSelected = this.selectedSystem === node.name;
            const hasMissingDeps = this.systemHasMissingDependencies(node.name);

            ctx.fillStyle = isSelected ? SystemsEditor.COLORS.selected : SystemsEditor.COLORS[node.source];
            this.roundRect(ctx, node.x, node.y, node.width, node.height, 6);
            ctx.fill();

            if (!node.found) {
                ctx.strokeStyle = SystemsEditor.COLORS.missing;
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                this.roundRect(ctx, node.x, node.y, node.width, node.height, 6);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            ctx.fillStyle = SystemsEditor.COLORS.text;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            let displayName = node.name;
            const maxWidth = node.width - 16;
            while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
                displayName = displayName.slice(0, -4) + '...';
            }
            ctx.fillText(displayName, node.x + node.width / 2, node.y + node.height / 2);

            // Draw missing dependency indicator (red warning circle with !)
            if (hasMissingDeps) {
                const iconX = node.x + node.width - 8;
                const iconY = node.y - 8;
                const iconRadius = 10;

                ctx.beginPath();
                ctx.arc(iconX, iconY, iconRadius, 0, Math.PI * 2);
                ctx.fillStyle = SystemsEditor.COLORS.missing;
                ctx.fill();

                ctx.fillStyle = '#fff';
                ctx.font = 'bold 12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('!', iconX, iconY);
            }
        });

        // Layer 2: Service nodes (pill-shaped, purple for used, grey for unused)
        this.hierarchyNodes.serviceNodes.forEach(node => {
            const isSelected = this.selectedService === node.name;
            const hasConsumers = node.consumers && node.consumers.length > 0;
            const baseColor = hasConsumers ? SystemsEditor.COLORS.service : SystemsEditor.COLORS.serviceUnused;
            const selectedColor = hasConsumers ? '#c084fc' : '#94a3b8';

            ctx.fillStyle = isSelected ? selectedColor : baseColor;
            this.roundRect(ctx, node.x, node.y, node.width, node.height, node.height / 2);
            ctx.fill();

            // Border
            ctx.strokeStyle = selectedColor;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            this.roundRect(ctx, node.x, node.y, node.width, node.height, node.height / 2);
            ctx.stroke();

            ctx.fillStyle = SystemsEditor.COLORS.text;
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            let displayName = node.name;
            const maxWidth = node.width - 16;
            while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
                displayName = displayName.slice(0, -4) + '...';
            }
            ctx.fillText(displayName, node.x + node.width / 2, node.y + node.height / 2);
        });

    }

    roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    /**
     * Convert screen coordinates to canvas coordinates
     */
    screenToCanvas(screenX, screenY) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (screenX - rect.left - this.pan.x) / this.zoom,
            y: (screenY - rect.top - this.pan.y) / this.zoom
        };
    }

    /**
     * Find node at position
     */
    getNodeAtPosition(x, y) {
        if (this.isGraphView()) {
            // Check all hierarchical node types

            // Check dependency nodes
            for (const node of this.hierarchyNodes.dependencyNodes) {
                if (x >= node.x && x <= node.x + node.width &&
                    y >= node.y && y <= node.y + node.height) {
                    return node;
                }
            }

            // Check service nodes
            for (const node of this.hierarchyNodes.serviceNodes) {
                if (x >= node.x && x <= node.x + node.width &&
                    y >= node.y && y <= node.y + node.height) {
                    return node;
                }
            }

            // Check provider nodes
            for (const node of this.hierarchyNodes.providerNodes) {
                if (x >= node.x && x <= node.x + node.width &&
                    y >= node.y && y <= node.y + node.height) {
                    return node;
                }
            }

            return null;
        }

        // Use appropriate node list based on view mode
        const nodeList = this.viewMode === 'service' ? this.serviceViewNodes : this.nodes;

        // Check in reverse order (top nodes first)
        for (let i = nodeList.length - 1; i >= 0; i--) {
            const node = nodeList[i];
            if (x >= node.x && x <= node.x + node.width &&
                y >= node.y && y <= node.y + node.height) {
                return node;
            }
        }
        return null;
    }

    /**
     * Find which provider block contains a position (for background clicks)
     * Returns the provider node if position is within any block's bounds
     */
    getProviderBlockAtPosition(x, y) {
        if (!this.isGraphView()) return null;

        for (const provider of this.hierarchyNodes.providerNodes) {
            const bounds = this.getProviderBlockBounds(provider, 12);
            if (bounds &&
                x >= bounds.minX && x <= bounds.maxX &&
                y >= bounds.minY && y <= bounds.maxY) {
                return provider;
            }
        }
        return null;
    }

    /**
     * Get all nodes belonging to a provider block
     */
    getBlockNodes(providerName, rowIndex) {
        const nodes = [];

        // Provider node
        const provider = this.hierarchyNodes.providerNodes.find(
            p => p.name === providerName && p.rowIndex === rowIndex
        );
        if (provider) nodes.push(provider);

        // Service nodes
        this.hierarchyNodes.serviceNodes.forEach(sn => {
            if (sn.providerName === providerName && sn.rowIndex === rowIndex) {
                nodes.push(sn);
            }
        });

        // Dependency nodes
        this.hierarchyNodes.dependencyNodes.forEach(dn => {
            if (dn.consumerName === providerName && dn.rowIndex === rowIndex) {
                nodes.push(dn);
            }
        });

        return nodes;
    }

    handleMouseDown(e) {
        const pos = this.screenToCanvas(e.clientX, e.clientY);
        const node = this.getNodeAtPosition(pos.x, pos.y);

        this.hasDragged = false; // Reset drag tracking

        if (node) {
            // Clicking on a specific node - drag just that node (legacy behavior)
            // But actually, we want to drag the whole block
            if (this.isGraphView() && (node.type === 'provider' || node.type === 'service' || node.type === 'dependency')) {
                // Find the provider for this node
                let providerName, rowIndex;
                if (node.type === 'provider') {
                    providerName = node.name;
                    rowIndex = node.rowIndex;
                } else if (node.type === 'service') {
                    providerName = node.providerName;
                    rowIndex = node.rowIndex;
                } else if (node.type === 'dependency') {
                    providerName = node.consumerName;
                    rowIndex = node.rowIndex;
                }

                if (providerName !== undefined) {
                    this.isDragging = true;
                    this.dragBlock = { providerName, rowIndex };
                    this.dragOffset = { x: pos.x, y: pos.y };
                    return;
                }
            }

            this.isDragging = true;
            this.dragNode = node;
            this.dragOffset = {
                x: pos.x - node.x,
                y: pos.y - node.y
            };
        } else {
            // Check if clicking on block background
            const blockProvider = this.getProviderBlockAtPosition(pos.x, pos.y);
            if (blockProvider) {
                this.isDragging = true;
                this.dragBlock = { providerName: blockProvider.name, rowIndex: blockProvider.rowIndex };
                this.dragOffset = { x: pos.x, y: pos.y };
            } else {
                // Start panning
                this.isPanning = true;
                this.lastMousePos = { x: e.clientX, y: e.clientY };
            }
        }
    }

    handleMouseMove(e) {
        const pos = this.screenToCanvas(e.clientX, e.clientY);

        if (this.isDragging && this.dragBlock) {
            // Dragging entire block - move all nodes together
            const dx = pos.x - this.dragOffset.x;
            const dy = pos.y - this.dragOffset.y;

            // Mark as dragged if there's actual movement
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                this.hasDragged = true;
            }

            const blockNodes = this.getBlockNodes(this.dragBlock.providerName, this.dragBlock.rowIndex);
            blockNodes.forEach(node => {
                node.x += dx;
                node.y += dy;
            });

            this.dragOffset = { x: pos.x, y: pos.y };
            this.render();
        } else if (this.isDragging && this.dragNode) {
            // Update node position
            this.hasDragged = true;
            this.dragNode.x = pos.x - this.dragOffset.x;
            this.dragNode.y = pos.y - this.dragOffset.y;
            this.render();
        } else if (this.isPanning) {
            // Pan the view
            const dx = e.clientX - this.lastMousePos.x;
            const dy = e.clientY - this.lastMousePos.y;
            this.pan.x += dx;
            this.pan.y += dy;
            this.lastMousePos = { x: e.clientX, y: e.clientY };
            this.render();
        } else {
            // Check for hover on dependency nodes
            let newHoveredDep = null;
            if (this.isGraphView()) {
                for (const dep of this.hierarchyNodes.dependencyNodes) {
                    if (pos.x >= dep.x && pos.x <= dep.x + dep.width &&
                        pos.y >= dep.y && pos.y <= dep.y + dep.height) {
                        newHoveredDep = dep;
                        break;
                    }
                }
            }

            if (newHoveredDep !== this.hoveredDependency) {
                this.hoveredDependency = newHoveredDep;
                this.render();
            }

            // Update cursor style based on what we're hovering
            if (this.canvas) {
                if (newHoveredDep && newHoveredDep.isFulfilled) {
                    this.canvas.style.cursor = 'pointer';
                } else {
                    // Check if hovering over any node or block background
                    const node = this.getNodeAtPosition(pos.x, pos.y);
                    const block = this.getProviderBlockAtPosition(pos.x, pos.y);
                    if (node || block) {
                        this.canvas.style.cursor = 'grab';
                    } else {
                        this.canvas.style.cursor = 'default';
                    }
                }
            }

            // Check for hover on connections
            this.updateConnectionHover(pos);
        }
    }

    handleMouseUp(e) {
        if (this.isDragging && this.dragBlock && !this.hasDragged) {
            // Block was clicked (not dragged) - handle selection
            const pos = this.screenToCanvas(e.clientX, e.clientY);
            const node = this.getNodeAtPosition(pos.x, pos.y);

            // If clicking on a specific node, handle node-specific behavior
            if (node) {
                if (node.type === 'provider') {
                    this.selectSystem(node.name);
                } else if (node.type === 'service') {
                    this.selectedService = node.name;
                    this.render();
                } else if (node.type === 'dependency') {
                    if (node.isFulfilled && node.providerSystemName) {
                        this.selectSystem(node.providerSystemName);
                    }
                }
            } else {
                // Clicked on block background - select the provider
                this.selectSystem(this.dragBlock.providerName);
            }
        } else if (this.isDragging && this.dragNode && !this.hasDragged) {
            // Node was clicked (not dragged) - handle selection
            const pos = this.screenToCanvas(e.clientX, e.clientY);
            const node = this.getNodeAtPosition(pos.x, pos.y);
            if (node === this.dragNode || (node && node.clickedConsumer)) {
                if (this.isGraphView()) {
                    // Handle hierarchy view clicks
                    if (node.type === 'provider') {
                        this.selectSystem(node.name);
                    } else if (node.type === 'service') {
                        // Don't drill into service view from graph - only from right panel
                        // Just highlight/select the service for now
                        this.selectedService = node.name;
                        this.render();
                    } else if (node.type === 'dependency') {
                        // Clicking on a fulfilled dependency zooms to its provider
                        if (node.isFulfilled && node.providerSystemName) {
                            this.selectSystem(node.providerSystemName);
                        }
                    }
                } else if (node.type === 'service') {
                    // In service view, clicking on the service node does nothing
                } else {
                    this.selectSystem(node.name);
                }
            }
        }

        this.isDragging = false;
        this.dragNode = null;
        this.dragBlock = null;
        this.isPanning = false;
    }

    handleWheel(e) {
        e.preventDefault();

        // Get mouse position relative to canvas
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Get the world position under the mouse BEFORE zoom
        const worldX = (mouseX - this.pan.x) / this.zoom;
        const worldY = (mouseY - this.pan.y) / this.zoom;

        // Calculate new zoom (smaller increments for smoother scrolling)
        const delta = e.deltaY > 0 ? -0.03 : 0.03;
        const newZoom = Math.max(0.1, Math.min(2, this.zoom + delta));

        // Adjust pan so the world position stays under the mouse
        this.pan.x = mouseX - worldX * newZoom;
        this.pan.y = mouseY - worldY * newZoom;

        this.zoom = newZoom;
        document.getElementById('systems-zoom-level').textContent = `${Math.round(this.zoom * 100)}%`;
        this.render();
    }

    handleDoubleClick(e) {
        const pos = this.screenToCanvas(e.clientX, e.clientY);
        const node = this.getNodeAtPosition(pos.x, pos.y);

        if (node) {
            // Center view on node
            this.pan.x = this.canvas.width / 2 - (node.x + node.width / 2) * this.zoom;
            this.pan.y = this.canvas.height / 2 - (node.y + node.height / 2) * this.zoom;
            this.render();
        }
    }

    updateConnectionHover(pos) {
        // Simplified hover detection - could be enhanced
        // For now, just update cursor based on node hover
        const node = this.getNodeAtPosition(pos.x, pos.y);
        this.canvas.style.cursor = node ? 'pointer' : 'grab';
    }

    setZoom(newZoom) {
        this.zoom = Math.max(0.1, Math.min(2, newZoom));
        document.getElementById('systems-zoom-level').textContent = `${Math.round(this.zoom * 100)}%`;
        this.render();
    }

    resetLayout() {
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        if (this.viewMode === 'service') {
            this.calculateServiceViewPositions();
        } else if (this.viewMode === 'isolated') {
            this.calculateIsolatedLayout();
        } else if (this.viewMode === 'hierarchy') {
            this.calculateHierarchicalLayout();
        } else {
            this.calculateNodePositions();
        }
        document.getElementById('systems-zoom-level').textContent = '100%';
        this.render();
    }

    /**
     * Select a system and show its details
     */
    selectSystem(name) {
        this.selectedSystem = name;
        this.renderSystemLists();
        this.renderDetails();
        this.zoomToSystem(name);
        this.render();
    }

    /**
     * Zoom and pan to fit a system and its related nodes in view
     */
    zoomToSystem(systemName) {
        if (!this.canvas || this.viewMode !== 'hierarchy') return;

        let bounds = null;

        // Check if it's a provider - use the same bounds as renderProviderBoxes
        const providerNode = this.hierarchyNodes.providerNodes.find(n => n.name === systemName);

        if (providerNode) {
            // Use the same bounding box calculation as renderProviderBoxes
            bounds = this.getProviderBlockBounds(providerNode, 12);
        } else {
            // System might be a consumer only - find its dependency nodes
            const depNodes = this.hierarchyNodes.dependencyNodes.filter(
                dep => dep.consumerName === systemName
            );

            if (depNodes.length > 0) {
                // Find the provider block that contains these dependency nodes
                const consumerProvider = this.hierarchyNodes.providerNodes.find(
                    p => p.name === systemName
                );
                if (consumerProvider) {
                    bounds = this.getProviderBlockBounds(consumerProvider, 12);
                }
            }
        }

        // If no bounds found, don't change view
        if (!bounds) return;

        // Validate bounding box
        if (isNaN(bounds.minX) || isNaN(bounds.maxX) || isNaN(bounds.minY) || isNaN(bounds.maxY)) return;

        // Ensure canvas has valid dimensions
        const canvasWidth = this.canvas.width || 800;
        const canvasHeight = this.canvas.height || 600;

        // Add padding for zoom (beyond the box padding)
        const zoomPadding = 40;
        const contentWidth = Math.max(bounds.width + zoomPadding * 2, 100);
        const contentHeight = Math.max(bounds.height + zoomPadding * 2, 100);

        // Calculate zoom to fit
        const zoomX = canvasWidth / contentWidth;
        const zoomY = canvasHeight / contentHeight;
        this.zoom = Math.min(zoomX, zoomY, 1.5); // Don't zoom in past 150%
        this.zoom = Math.max(this.zoom, 0.1); // Don't zoom out past 10%

        // Center on content
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        this.pan.x = canvasWidth / 2 - centerX * this.zoom;
        this.pan.y = canvasHeight / 2 - centerY * this.zoom;

        // Update zoom display
        const zoomDisplay = document.getElementById('systems-zoom-level');
        if (zoomDisplay) {
            zoomDisplay.textContent = `${Math.round(this.zoom * 100)}%`;
        }
    }

    /**
     * Render details panel for selected system
     */
    renderDetails() {
        const container = document.getElementById('systems-details-content');
        if (!container) return;

        if (!this.selectedSystem) {
            container.innerHTML = '<p class="systems-editor__no-selection">Click a system node to view details</p>';
            return;
        }

        const system = this.resolvedSystems.find(s => s.name === this.selectedSystem);
        if (!system) {
            container.innerHTML = '<p class="systems-editor__no-selection">System not found</p>';
            return;
        }

        // Get dependencies with their status
        const deps = (system.serviceDependencies || []).map(dep => {
            const providers = this.serviceProviders[dep] || [];
            return {
                name: dep,
                satisfied: providers.length > 0,
                providers
            };
        });

        container.innerHTML = `
            ${this.viewMode === 'service' || this.viewMode === 'isolated' ? `
                <button class="systems-editor__back-btn" id="systems-back-btn">
                    ← Back to Full View
                </button>
            ` : `
                <button class="systems-editor__isolate-btn" id="systems-isolate-btn">
                    Isolate View
                </button>
            `}
            <div class="systems-editor__detail-header">
                <span class="systems-editor__source-indicator systems-editor__source-indicator--${system.source}"></span>
                <span class="systems-editor__detail-name">${system.name}</span>
                ${!system.found ? '<span class="systems-editor__detail-source" style="background:#ef4444">Class Not Loaded</span>' : ''}
            </div>

            <div class="systems-editor__detail-section">
                <div class="systems-editor__detail-section-title">Source</div>
                <span class="systems-editor__detail-source">${system.source}</span>
            </div>

            <div class="systems-editor__detail-section">
                <div class="systems-editor__detail-section-title">Services Provided (${system.services.length})</div>
                ${system.services.length === 0 ?
                    '<div class="systems-editor__empty-list">None</div>' :
                    `<ul class="systems-editor__service-list">
                        ${system.services.map(s => `
                            <li class="systems-editor__service-item systems-editor__service-item--provided systems-editor__service-item--clickable ${this.selectedService === s ? 'systems-editor__service-item--selected' : ''}"
                                data-service="${s}">
                                <span class="systems-editor__service-status">+</span>
                                ${s}
                            </li>
                        `).join('')}
                    </ul>`
                }
            </div>

            <div class="systems-editor__detail-section">
                <div class="systems-editor__detail-section-title">Dependencies (${deps.length})</div>
                ${!system.found && deps.length === 0 ?
                    '<div class="systems-editor__empty-list" style="color:#f59e0b;">Class not loaded - dependencies unavailable</div>' :
                    deps.length === 0 ?
                    '<div class="systems-editor__empty-list">None</div>' :
                    `<ul class="systems-editor__service-list">
                        ${deps.map(d => `
                            <li class="systems-editor__service-item ${d.satisfied ? 'systems-editor__service-item--satisfied' : 'systems-editor__service-item--missing'} systems-editor__service-item--clickable ${this.selectedService === d.name ? 'systems-editor__service-item--selected' : ''}"
                                data-service="${d.name}">
                                <span class="systems-editor__service-status">${d.satisfied ? '\u2713' : '\u2717'}</span>
                                ${d.name}
                                ${d.satisfied ? `<span class="systems-editor__provider-name">${d.providers.join(', ')}</span>` : ''}
                            </li>
                        `).join('')}
                    </ul>`
                }
            </div>
        `;

        // Add click handlers for service items
        container.querySelectorAll('.systems-editor__service-item--clickable').forEach(item => {
            item.addEventListener('click', () => {
                this.selectService(item.dataset.service);
            });
        });

        // Add back button handler
        const backBtn = document.getElementById('systems-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => this.exitIsolatedView());
        }

        // Add isolate button handler
        const isolateBtn = document.getElementById('systems-isolate-btn');
        if (isolateBtn) {
            isolateBtn.addEventListener('click', () => this.enterIsolatedView());
        }
    }

    /**
     * Select a service and switch to service-focused view
     */
    selectService(serviceName) {
        this.selectedService = serviceName;
        this.viewMode = 'service';
        this.calculateServiceViewPositions();
        this.renderDetails();
        this.render();
    }

    /**
     * Clear service selection and return to hierarchy view
     */
    clearServiceSelection() {
        this.selectedService = null;
        this.viewMode = 'hierarchy';
        this.renderDetails();
        this.render();
    }

    /**
     * Enter isolated view for the selected system
     */
    enterIsolatedView() {
        if (!this.selectedSystem) return;
        this.viewMode = 'isolated';
        this.calculateIsolatedLayout();
        this.renderDetails();
        this.zoomToFitAll();
        this.render();
    }

    /**
     * Exit isolated view and return to hierarchy view
     */
    exitIsolatedView() {
        this.selectedService = null;
        this.viewMode = 'hierarchy';
        this.calculateHierarchicalLayout();
        this.renderDetails();
        this.render();
    }

    /**
     * Calculate layout for isolated view showing selected system and its connections
     * Uses shared layout methods for consistency with hierarchy view
     * Only shows relevant services/dependencies on connected systems
     */
    calculateIsolatedLayout() {
        if (!this.selectedSystem) return;

        const canvasWidth = this.canvas?.width || 800;
        const L = SystemsEditor.LAYOUT;
        const ROW_GAP = 120;

        const selectedSys = this.resolvedSystems.find(s => s.name === this.selectedSystem);
        if (!selectedSys) return;

        const selectedDeps = new Set(selectedSys.serviceDependencies || []);
        const selectedServices = new Set(selectedSys.services || []);

        // Find upstream systems and track which services are relevant
        // Upstream = systems that provide services the selected system depends on
        const upstreamSystems = new Map(); // sysName -> { upCount, downCount, relevantServices }
        selectedDeps.forEach(depName => {
            const providers = this.serviceProviders[depName] || [];
            providers.forEach(providerName => {
                if (providerName === this.selectedSystem) return;
                if (!upstreamSystems.has(providerName)) {
                    upstreamSystems.set(providerName, {
                        upCount: 0,
                        downCount: 0,
                        relevantServices: new Set()
                    });
                }
                const data = upstreamSystems.get(providerName);
                data.upCount++;
                data.relevantServices.add(depName);
            });
        });

        // Find downstream systems and track which dependencies are relevant
        // Downstream = systems that depend on services the selected system provides
        const downstreamSystems = new Map(); // sysName -> { upCount, downCount, relevantDeps }
        selectedServices.forEach(serviceName => {
            this.resolvedSystems.forEach(sys => {
                if (sys.name === this.selectedSystem) return;
                if ((sys.serviceDependencies || []).includes(serviceName)) {
                    if (!downstreamSystems.has(sys.name)) {
                        downstreamSystems.set(sys.name, {
                            upCount: 0,
                            downCount: 0,
                            relevantDeps: new Set()
                        });
                    }
                    const data = downstreamSystems.get(sys.name);
                    data.downCount++;
                    data.relevantDeps.add(serviceName);
                }
            });
        });

        // Handle systems in both - place on side with more connections
        const finalUpstream = [];
        const finalDownstream = [];
        const upstreamFilters = new Map(); // sysName -> { services, dependencies }
        const downstreamFilters = new Map(); // sysName -> { services, dependencies }

        // For upstream systems:
        //   - services: only show services that the selected system depends on
        //   - dependencies: only show dependencies that the selected system provides
        // For downstream systems:
        //   - services: only show services that the selected system depends on
        //   - dependencies: only show dependencies that the selected system provides

        upstreamSystems.forEach((data, name) => {
            // Calculate relevant dependencies for this upstream system
            // (dependencies that match services the selected system provides)
            const sys = this.resolvedSystems.find(s => s.name === name);
            const sysDeps = new Set(sys?.serviceDependencies || []);
            const relevantDeps = new Set([...sysDeps].filter(d => selectedServices.has(d)));

            if (downstreamSystems.has(name)) {
                const downData = downstreamSystems.get(name);
                if (data.upCount >= downData.downCount) {
                    finalUpstream.push(name);
                    upstreamFilters.set(name, {
                        services: data.relevantServices,
                        dependencies: relevantDeps
                    });
                } else {
                    finalDownstream.push(name);
                    // Calculate relevant services for downstream
                    const sysServices = new Set(sys?.services || []);
                    const relevantServices = new Set([...sysServices].filter(s => selectedDeps.has(s)));
                    downstreamFilters.set(name, {
                        dependencies: downData.relevantDeps,
                        services: relevantServices
                    });
                }
                downstreamSystems.delete(name);
            } else {
                finalUpstream.push(name);
                upstreamFilters.set(name, {
                    services: data.relevantServices,
                    dependencies: relevantDeps
                });
            }
        });

        downstreamSystems.forEach((data, name) => {
            finalDownstream.push(name);
            // Calculate relevant services for this downstream system
            // (services that the selected system depends on)
            const sys = this.resolvedSystems.find(s => s.name === name);
            const sysServices = new Set(sys?.services || []);
            const relevantServices = new Set([...sysServices].filter(s => selectedDeps.has(s)));
            downstreamFilters.set(name, {
                dependencies: data.relevantDeps,
                services: relevantServices
            });
        });

        // Reset hierarchy nodes
        this.hierarchyNodes = {
            dependencyNodes: [],
            providerNodes: [],
            serviceNodes: [],
        };

        // Arrange each group into rows based on maxRowWidth (with filters for sizing)
        const upstreamRows = this.arrangeSystemsInRows(finalUpstream, upstreamFilters);
        const downstreamRows = this.arrangeSystemsInRows(finalDownstream, downstreamFilters);

        // Calculate heights for positioning (with filters)
        const getRowsHeight = (rows, filterMap) => {
            if (rows.length === 0) return 0;
            let height = 0;
            rows.forEach((row, i) => {
                let maxBlockHeight = 0;
                row.forEach(sysName => {
                    const sys = this.resolvedSystems.find(s => s.name === sysName);
                    const filter = filterMap?.get(sysName);
                    let deps = sys?.serviceDependencies || [];
                    let services = sys?.services || [];
                    if (filter?.services) services = services.filter(s => filter.services.has(s));
                    if (filter?.dependencies) deps = deps.filter(d => filter.dependencies.has(d));
                    const blockHeight = (deps.length > 0 ? L.DEPENDENCY_HEIGHT + 20 : 0) +
                                       L.PROVIDER_HEIGHT + 30 +
                                       (services.length > 0 ? L.SERVICE_HEIGHT : 0);
                    maxBlockHeight = Math.max(maxBlockHeight, blockHeight);
                });
                height += maxBlockHeight + (i < rows.length - 1 ? L.INTERNAL_ROW_GAP : 0);
            });
            return height;
        };

        const selectedBlockHeight = (selectedDeps.size > 0 ? L.DEPENDENCY_HEIGHT + 20 : 0) +
                                   L.PROVIDER_HEIGHT + 30 +
                                   (selectedServices.size > 0 ? L.SERVICE_HEIGHT : 0);

        const upstreamHeight = getRowsHeight(upstreamRows, upstreamFilters);
        const downstreamHeight = getRowsHeight(downstreamRows, downstreamFilters);

        // Calculate total height and starting Y
        const totalHeight = upstreamHeight + (upstreamHeight > 0 ? ROW_GAP : 0) +
                           selectedBlockHeight +
                           (downstreamHeight > 0 ? ROW_GAP : 0) + downstreamHeight;

        let currentY = Math.max(60, (this.canvas?.height || 600) / 2 - totalHeight / 2);

        // Layout upstream rows (only show services selected system depends on)
        upstreamRows.forEach((row, rowIdx) => {
            const maxHeight = this.layoutSystemRow(row, currentY, canvasWidth, rowIdx, upstreamFilters);
            currentY += maxHeight + L.INTERNAL_ROW_GAP;
        });

        if (upstreamRows.length > 0) {
            currentY += ROW_GAP - L.INTERNAL_ROW_GAP;
        }

        // Layout selected system (full - no filter)
        this.layoutSystemRow([this.selectedSystem], currentY, canvasWidth, 0, null);
        currentY += selectedBlockHeight + ROW_GAP;

        // Layout downstream rows (only show dependencies that match selected system's services)
        downstreamRows.forEach((row, rowIdx) => {
            const maxHeight = this.layoutSystemRow(row, currentY, canvasWidth, rowIdx, downstreamFilters);
            currentY += maxHeight + L.INTERNAL_ROW_GAP;
        });
    }

    /**
     * Zoom to fit all visible content
     */
    zoomToFitAll() {
        if (!this.canvas) return;

        // Get bounds of all nodes
        const allNodes = [
            ...this.hierarchyNodes.providerNodes,
            ...this.hierarchyNodes.serviceNodes,
            ...this.hierarchyNodes.dependencyNodes
        ];

        if (allNodes.length === 0) return;

        const minX = Math.min(...allNodes.map(n => n.x));
        const maxX = Math.max(...allNodes.map(n => n.x + n.width));
        const minY = Math.min(...allNodes.map(n => n.y));
        const maxY = Math.max(...allNodes.map(n => n.y + n.height));

        const padding = 60;
        const contentWidth = maxX - minX + padding * 2;
        const contentHeight = maxY - minY + padding * 2;

        const canvasWidth = this.canvas.width || 800;
        const canvasHeight = this.canvas.height || 600;

        const zoomX = canvasWidth / contentWidth;
        const zoomY = canvasHeight / contentHeight;
        this.zoom = Math.min(zoomX, zoomY, 1);
        this.zoom = Math.max(this.zoom, 0.1);

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        this.pan.x = canvasWidth / 2 - centerX * this.zoom;
        this.pan.y = canvasHeight / 2 - centerY * this.zoom;

        const zoomDisplay = document.getElementById('systems-zoom-level');
        if (zoomDisplay) {
            zoomDisplay.textContent = `${Math.round(this.zoom * 100)}%`;
        }
    }

    /**
     * Calculate node positions for service-focused view
     * Layout: Providers at top, Service in middle, Dependents at bottom
     */
    calculateServiceViewPositions() {
        this.serviceViewNodes = [];

        if (!this.selectedService) return;

        const canvasWidth = this.canvas?.width || 800;
        const canvasHeight = this.canvas?.height || 600;
        const centerX = canvasWidth / 2;

        // Find systems that provide this service
        const providers = this.resolvedSystems.filter(sys =>
            (sys.services || []).includes(this.selectedService)
        );

        // Find systems that depend on this service
        const dependents = this.resolvedSystems.filter(sys =>
            (sys.serviceDependencies || []).includes(this.selectedService)
        );

        // Layout providers at top (row 1)
        const providerY = canvasHeight * 0.15;
        if (providers.length > 0) {
            const totalWidth = providers.length * (SystemsEditor.NODE_WIDTH + SystemsEditor.NODE_PADDING);
            const startX = centerX - totalWidth / 2;
            providers.forEach((sys, i) => {
                this.serviceViewNodes.push({
                    name: sys.name,
                    source: sys.source,
                    type: 'provider',
                    x: startX + i * (SystemsEditor.NODE_WIDTH + SystemsEditor.NODE_PADDING),
                    y: providerY,
                    width: SystemsEditor.NODE_WIDTH,
                    height: SystemsEditor.NODE_HEIGHT,
                    found: sys.found
                });
            });
        }

        // Service node in the middle (row 2)
        const serviceY = canvasHeight * 0.5;
        this.serviceViewNodes.push({
            name: this.selectedService,
            source: 'service',
            type: 'service',
            x: centerX - SystemsEditor.NODE_WIDTH / 2,
            y: serviceY - SystemsEditor.NODE_HEIGHT / 2,
            width: SystemsEditor.NODE_WIDTH,
            height: SystemsEditor.NODE_HEIGHT,
            found: true
        });

        // Layout dependents at bottom (row 3)
        const dependentY = canvasHeight * 0.85;
        if (dependents.length > 0) {
            const totalWidth = dependents.length * (SystemsEditor.NODE_WIDTH + SystemsEditor.NODE_PADDING);
            const startX = centerX - totalWidth / 2;
            dependents.forEach((sys, i) => {
                this.serviceViewNodes.push({
                    name: sys.name,
                    source: sys.source,
                    type: 'dependent',
                    x: startX + i * (SystemsEditor.NODE_WIDTH + SystemsEditor.NODE_PADDING),
                    y: dependentY - SystemsEditor.NODE_HEIGHT / 2,
                    width: SystemsEditor.NODE_WIDTH,
                    height: SystemsEditor.NODE_HEIGHT,
                    found: sys.found
                });
            });
        }
    }

    /**
     * Handle adding a new system
     */
    handleAddSystem() {
        const systemSelect = document.getElementById('systems-available-select');
        const targetSelect = document.getElementById('systems-target-select');

        const systemName = systemSelect?.value;
        const target = targetSelect?.value;

        if (!systemName) {
            this.updateStatus('Please select a system to add');
            return;
        }

        this.addSystem(systemName, target);
    }

    addSystem(name, target) {
        // Add to appropriate array
        switch (target) {
            case 'systems':
                if (!this.systems.includes(name)) {
                    this.systems.push(name);
                }
                break;
            case 'clientSystems':
                if (!this.clientSystems.includes(name)) {
                    this.clientSystems.push(name);
                }
                break;
            case 'serverSystems':
                if (!this.serverSystems.includes(name)) {
                    this.serverSystems.push(name);
                }
                break;
        }

        // Rebuild everything
        this.resolveSystems();
        this.buildServiceProviderMap();
        this.buildConnections();
        this.buildActiveServices();
        this.populateAvailableSystemsDropdown();
        this.renderSystemLists();
        this.calculateHierarchicalLayout();
        this.calculateNodePositions();
        this.render();

        this.updateStatus(`Added ${name} to ${target}`);
    }

    removeSystem(name, source) {
        // Remove from appropriate array
        switch (source) {
            case 'systems':
                this.systems = this.systems.filter(s => s !== name);
                break;
            case 'clientSystems':
                this.clientSystems = this.clientSystems.filter(s => s !== name);
                break;
            case 'serverSystems':
                this.serverSystems = this.serverSystems.filter(s => s !== name);
                break;
        }

        // Clear selection if removed
        if (this.selectedSystem === name) {
            this.selectedSystem = null;
        }

        // Rebuild everything
        this.resolveSystems();
        this.buildServiceProviderMap();
        this.buildConnections();
        this.buildActiveServices();
        this.populateAvailableSystemsDropdown();
        this.renderSystemLists();
        this.calculateHierarchicalLayout();
        this.calculateNodePositions();
        this.render();
        this.renderDetails();

        this.updateStatus(`Removed ${name} from ${source}`);
    }

    /**
     * Filter systems in the list
     */
    filterSystems(query) {
        const lowerQuery = query.toLowerCase();

        document.querySelectorAll('.systems-editor__system-item').forEach(item => {
            const name = item.dataset.name.toLowerCase();
            item.style.display = name.includes(lowerQuery) ? '' : 'none';
        });
    }

    /**
     * Save changes back to the object
     */
    saveChanges() {
        if (this._isLoading) return;

        // Build the save data - we save all three arrays
        const saveData = {
            systems: [...this.systems],
            clientSystems: [...this.clientSystems],
            serverSystems: [...this.serverSystems]
        };

        // Dispatch save event for the main property (systems)
        const saveEvent = new CustomEvent(this.moduleConfig.saveHook, {
            detail: {
                data: saveData.systems,
                propertyName: 'systems',
                additionalProperties: {
                    clientSystems: saveData.clientSystems,
                    serverSystems: saveData.serverSystems
                }
            }
        });

        document.body.dispatchEvent(saveEvent);
        this.updateStatus('Changes saved');
    }

    refresh() {
        if (this.objectData) {
            this.loadSystems({
                data: this.objectData.systems,
                propertyName: this.propertyName,
                objectData: this.objectData
            });
        }
    }

    updateStatus(message) {
        const statusEl = document.getElementById('systems-status-message');
        if (statusEl) {
            statusEl.textContent = message;
        }
    }
}

// Register with GUTS namespace
if (typeof window.GUTS === 'undefined') {
    window.GUTS = {};
}
window.GUTS.SystemsEditor = SystemsEditor;
