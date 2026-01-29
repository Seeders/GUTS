/**
 * SystemsEditor - Visual editor for scene system dependencies
 *
 * Displays systems included in a scene and visualizes service connections
 * between them using an interactive graph view.
 */

class SystemsEditor {
    // Node dimensions
    static NODE_WIDTH = 140;
    static NODE_HEIGHT = 36;
    static NODE_PADDING = 20;

    // Colors for different sources
    static COLORS = {
        systems: '#6366f1',      // Indigo
        clientSystems: '#22c55e', // Green
        serverSystems: '#f97316', // Orange
        service: '#a855f7',       // Purple
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
            unconsumedServiceNodes: [], // Layer 0: Services provided but not consumed (above providers)
            providerNodes: [],    // Layer 1: Systems that provide active services
            serviceNodes: [],     // Layer 2: Service nodes (only active ones)
            consumerGroups: []    // Layer 3: Groups of consumers per service
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
        this.dragOffset = { x: 0, y: 0 };

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

        // Loading flag
        this._isLoading = false;

        this.setupEventListeners();
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
        document.getElementById('systems-zoom-in-btn')?.addEventListener('click', () => this.setZoom(this.zoom + 0.1));
        document.getElementById('systems-zoom-out-btn')?.addEventListener('click', () => this.setZoom(this.zoom - 0.1));
        document.getElementById('systems-reset-layout-btn')?.addEventListener('click', () => this.resetLayout());

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
            unconsumedServiceNodes: [],
            providerNodes: [],
            serviceNodes: [],
            consumerGroups: []
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
     * Calculate hierarchical layout with 4 layers:
     * Layer 0 (above providers): Unconsumed services - services provided but not consumed
     * Layer 1 (top): Provider systems - centered over their services
     * Layer 2 (middle): Service nodes - primary reference layer
     * Layer 3 (bottom): Consumer groups - directly below each service
     */
    calculateHierarchicalLayout() {
        this.hierarchyNodes = {
            unconsumedServiceNodes: [],
            providerNodes: [],
            serviceNodes: [],
            consumerGroups: []
        };

        // Build list of all provided services with their consumption status
        const allProvidedServices = new Map(); // serviceName -> { providers: [], consumers: [] }

        Object.entries(this.serviceProviders).forEach(([serviceName, providers]) => {
            const consumers = this.resolvedSystems
                .filter(sys => (sys.serviceDependencies || []).includes(serviceName))
                .map(sys => sys.name);

            allProvidedServices.set(serviceName, {
                providers: [...providers],
                consumers: consumers
            });
        });

        // If no services at all, return
        if (allProvidedServices.size === 0) return;

        const canvasWidth = this.canvas?.width || 800;
        const canvasHeight = this.canvas?.height || 600;

        // Dimensions for different node types
        const PROVIDER_WIDTH = 140;
        const PROVIDER_HEIGHT = 36;
        const SERVICE_WIDTH = 120;
        const SERVICE_HEIGHT = 28;
        const UNCONSUMED_SERVICE_WIDTH = 100;
        const UNCONSUMED_SERVICE_HEIGHT = 22;
        const GROUP_MIN_WIDTH = 160;
        const GROUP_LINE_HEIGHT = 18;
        const GROUP_PADDING = 12;
        const NODE_GAP = 20;

        // Layer Y positions - adjusted to make room for unconsumed services
        const unconsumedY = 20;
        const providerY = 80;
        const serviceY = canvasHeight * 0.40;
        const consumerY = canvasHeight * 0.65;

        // Step 1: Position service nodes first (the primary/widest layer)
        // Use the larger of SERVICE_WIDTH or GROUP_MIN_WIDTH for column spacing
        const columnWidth = Math.max(SERVICE_WIDTH, GROUP_MIN_WIDTH) + NODE_GAP;
        const serviceTotalWidth = this.activeServices.length * columnWidth;
        const serviceStartX = (canvasWidth - serviceTotalWidth) / 2;

        this.activeServices.forEach((svc, i) => {
            const columnCenterX = serviceStartX + i * columnWidth + columnWidth / 2;

            this.hierarchyNodes.serviceNodes.push({
                name: svc.name,
                type: 'service',
                x: columnCenterX - SERVICE_WIDTH / 2,
                y: serviceY,
                width: SERVICE_WIDTH,
                height: SERVICE_HEIGHT,
                providers: svc.providers,
                consumers: svc.consumers,
                columnIndex: i,
                columnCenterX: columnCenterX
            });
        });

        // Step 2: Position consumer groups directly below each service
        this.activeServices.forEach((svc, i) => {
            const serviceNode = this.hierarchyNodes.serviceNodes[i];
            const columnCenterX = serviceNode.columnCenterX;

            // Calculate group height based on number of consumers
            const groupHeight = GROUP_PADDING * 2 + 20 + (svc.consumers.length * GROUP_LINE_HEIGHT);

            this.hierarchyNodes.consumerGroups.push({
                name: svc.name,
                type: 'consumerGroup',
                x: columnCenterX - GROUP_MIN_WIDTH / 2,
                y: consumerY,
                width: GROUP_MIN_WIDTH,
                height: groupHeight,
                consumers: svc.consumers,
                serviceName: svc.name
            });
        });

        // Step 3: Position provider nodes centered over the services they provide
        const providerSystems = new Set();
        this.activeServices.forEach(svc => {
            svc.providers.forEach(p => providerSystems.add(p));
        });

        const providerList = [...providerSystems];

        providerList.forEach(sysName => {
            const sys = this.resolvedSystems.find(s => s.name === sysName);

            // Find all services this provider provides
            const providedServices = this.hierarchyNodes.serviceNodes.filter(
                sn => sn.providers.includes(sysName)
            );

            if (providedServices.length === 0) return;

            // Calculate center X based on the span of services this provider covers
            const minX = Math.min(...providedServices.map(s => s.columnCenterX));
            const maxX = Math.max(...providedServices.map(s => s.columnCenterX));
            const centerX = (minX + maxX) / 2;

            this.hierarchyNodes.providerNodes.push({
                name: sysName,
                source: sys?.source || 'systems',
                type: 'provider',
                x: centerX - PROVIDER_WIDTH / 2,
                y: providerY,
                width: PROVIDER_WIDTH,
                height: PROVIDER_HEIGHT,
                found: sys?.found ?? false,
                providedServices: providedServices.map(s => s.name)
            });
        });

        // Step 4: Resolve overlapping provider nodes
        this.resolveProviderOverlaps(PROVIDER_WIDTH, NODE_GAP);

        // Step 5: Position unconsumed service nodes above their providers
        // These are services that are provided but have no consumers
        this.hierarchyNodes.providerNodes.forEach(providerNode => {
            const sys = this.resolvedSystems.find(s => s.name === providerNode.name);
            if (!sys || !sys.services) return;

            // Find services this system provides that are NOT consumed (not in activeServices)
            const activeServiceNames = new Set(this.activeServices.map(s => s.name));
            const unconsumedServices = sys.services.filter(svcName => !activeServiceNames.has(svcName));

            if (unconsumedServices.length === 0) return;

            // Position unconsumed services in a row above the provider node
            const totalWidth = unconsumedServices.length * (UNCONSUMED_SERVICE_WIDTH + 8);
            const startX = providerNode.x + providerNode.width / 2 - totalWidth / 2;

            unconsumedServices.forEach((svcName, i) => {
                this.hierarchyNodes.unconsumedServiceNodes.push({
                    name: svcName,
                    type: 'unconsumedService',
                    x: startX + i * (UNCONSUMED_SERVICE_WIDTH + 8),
                    y: unconsumedY,
                    width: UNCONSUMED_SERVICE_WIDTH,
                    height: UNCONSUMED_SERVICE_HEIGHT,
                    providerName: providerNode.name
                });
            });
        });
    }

    /**
     * Resolve overlapping provider nodes by shifting them apart
     */
    resolveProviderOverlaps(nodeWidth, gap) {
        const nodes = this.hierarchyNodes.providerNodes;
        if (nodes.length < 2) return;

        // Sort by X position
        nodes.sort((a, b) => a.x - b.x);

        // Push overlapping nodes apart
        for (let i = 1; i < nodes.length; i++) {
            const prev = nodes[i - 1];
            const curr = nodes[i];
            const minX = prev.x + nodeWidth + gap;

            if (curr.x < minX) {
                curr.x = minX;
            }
        }
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
        } else if (this.viewMode === 'hierarchy') {
            // Render 3-layer hierarchical view
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
     * Render connections for 3-layer hierarchical view
     */
    renderHierarchicalConnections(ctx) {
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeStyle = SystemsEditor.COLORS.satisfied;

        // Draw connections from unconsumed services to their providers (dashed, grayed)
        this.hierarchyNodes.unconsumedServiceNodes.forEach(unconsumedNode => {
            const providerNode = this.hierarchyNodes.providerNodes.find(n => n.name === unconsumedNode.providerName);
            if (!providerNode) return;

            const fromX = unconsumedNode.x + unconsumedNode.width / 2;
            const fromY = unconsumedNode.y + unconsumedNode.height;
            const toX = providerNode.x + providerNode.width / 2;
            const toY = providerNode.y;

            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);

            ctx.strokeStyle = '#64748b'; // Muted gray
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
        });

        // Reset for main connections
        ctx.lineWidth = 2;
        ctx.strokeStyle = SystemsEditor.COLORS.satisfied;

        // Draw connections from providers to services
        this.hierarchyNodes.serviceNodes.forEach(serviceNode => {
            serviceNode.providers.forEach(providerName => {
                const providerNode = this.hierarchyNodes.providerNodes.find(n => n.name === providerName);
                if (!providerNode) return;

                const fromX = providerNode.x + providerNode.width / 2;
                const fromY = providerNode.y + providerNode.height;
                const toX = serviceNode.x + serviceNode.width / 2;
                const toY = serviceNode.y;

                ctx.beginPath();
                ctx.moveTo(fromX, fromY);

                // Bezier curve for smooth connection
                const cpOffset = Math.abs(toY - fromY) * 0.4;
                ctx.bezierCurveTo(
                    fromX, fromY + cpOffset,
                    toX, toY - cpOffset,
                    toX, toY
                );

                ctx.stroke();
                this.drawArrowHead(ctx, toX, toY - 15, toX, toY, true);
            });
        });

        // Draw connections from services to consumer groups
        this.hierarchyNodes.serviceNodes.forEach(serviceNode => {
            const consumerGroup = this.hierarchyNodes.consumerGroups.find(
                g => g.serviceName === serviceNode.name
            );
            if (!consumerGroup) return;

            const fromX = serviceNode.x + serviceNode.width / 2;
            const fromY = serviceNode.y + serviceNode.height;
            const toX = consumerGroup.x + consumerGroup.width / 2;
            const toY = consumerGroup.y;

            ctx.beginPath();
            ctx.moveTo(fromX, fromY);

            const cpOffset = Math.abs(toY - fromY) * 0.4;
            ctx.bezierCurveTo(
                fromX, fromY + cpOffset,
                toX, toY - cpOffset,
                toX, toY
            );

            ctx.stroke();
            this.drawArrowHead(ctx, toX, toY - 15, toX, toY, true);
        });
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
     * Render nodes for 4-layer hierarchical view
     */
    renderHierarchicalNodes(ctx) {
        // Layer 0: Unconsumed service nodes (above providers, small pills, grayed out)
        this.hierarchyNodes.unconsumedServiceNodes.forEach(node => {
            // Muted background
            ctx.fillStyle = '#334155'; // Slate gray
            this.roundRect(ctx, node.x, node.y, node.width, node.height, node.height / 2);
            ctx.fill();

            // Dashed border to indicate "unused"
            ctx.strokeStyle = '#64748b';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            this.roundRect(ctx, node.x, node.y, node.width, node.height, node.height / 2);
            ctx.stroke();
            ctx.setLineDash([]);

            // Muted text
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            let displayName = node.name;
            const maxWidth = node.width - 12;
            while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
                displayName = displayName.slice(0, -4) + '...';
            }
            ctx.fillText(displayName, node.x + node.width / 2, node.y + node.height / 2);
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

        // Layer 2: Service nodes (pill-shaped, purple)
        this.hierarchyNodes.serviceNodes.forEach(node => {
            const isSelected = this.selectedService === node.name;

            ctx.fillStyle = isSelected ? '#c084fc' : SystemsEditor.COLORS.service;
            this.roundRect(ctx, node.x, node.y, node.width, node.height, node.height / 2);
            ctx.fill();

            // Border
            ctx.strokeStyle = '#c084fc';
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

        // Layer 3: Consumer group nodes (boxes with listed systems)
        this.hierarchyNodes.consumerGroups.forEach(group => {
            // Group background
            ctx.fillStyle = '#1e293b';
            this.roundRect(ctx, group.x, group.y, group.width, group.height, 8);
            ctx.fill();

            // Group border
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            this.roundRect(ctx, group.x, group.y, group.width, group.height, 8);
            ctx.stroke();

            // Header
            ctx.fillStyle = '#64748b';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`consumers`, group.x + group.width / 2, group.y + 8);

            // Divider line
            ctx.strokeStyle = '#475569';
            ctx.beginPath();
            ctx.moveTo(group.x + 8, group.y + 24);
            ctx.lineTo(group.x + group.width - 8, group.y + 24);
            ctx.stroke();

            // Consumer list
            ctx.fillStyle = SystemsEditor.COLORS.text;
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';

            group.consumers.forEach((consumerName, i) => {
                const y = group.y + 30 + i * 18;
                const isSelected = this.selectedSystem === consumerName;

                if (isSelected) {
                    ctx.fillStyle = SystemsEditor.COLORS.selected;
                    ctx.fillRect(group.x + 4, y - 2, group.width - 8, 16);
                    ctx.fillStyle = '#fff';
                } else {
                    ctx.fillStyle = SystemsEditor.COLORS.text;
                }

                // Truncate if needed
                let displayName = consumerName;
                const maxWidth = group.width - 24;
                while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
                    displayName = displayName.slice(0, -4) + '...';
                }

                ctx.fillText('• ' + displayName, group.x + 10, y);
            });
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
        if (this.viewMode === 'hierarchy') {
            // Check all hierarchical node types
            // First check consumer groups (they're clickable)
            for (const group of this.hierarchyNodes.consumerGroups) {
                if (x >= group.x && x <= group.x + group.width &&
                    y >= group.y && y <= group.y + group.height) {
                    // Check if clicking on a specific consumer within the group
                    const consumerY = group.y + 30;
                    const consumerIndex = Math.floor((y - consumerY) / 18);
                    if (consumerIndex >= 0 && consumerIndex < group.consumers.length) {
                        return {
                            ...group,
                            clickedConsumer: group.consumers[consumerIndex]
                        };
                    }
                    return group;
                }
            }

            // Check unconsumed service nodes
            for (const node of this.hierarchyNodes.unconsumedServiceNodes) {
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

    handleMouseDown(e) {
        const pos = this.screenToCanvas(e.clientX, e.clientY);
        const node = this.getNodeAtPosition(pos.x, pos.y);

        if (node) {
            this.isDragging = true;
            this.dragNode = node;
            this.dragOffset = {
                x: pos.x - node.x,
                y: pos.y - node.y
            };
        } else {
            // Start panning
            this.isPanning = true;
            this.lastMousePos = { x: e.clientX, y: e.clientY };
        }
    }

    handleMouseMove(e) {
        const pos = this.screenToCanvas(e.clientX, e.clientY);

        if (this.isDragging && this.dragNode) {
            // Update node position
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
            // Check for hover on connections
            this.updateConnectionHover(pos);
        }
    }

    handleMouseUp(e) {
        if (this.isDragging && this.dragNode) {
            // Select the node if it wasn't really dragged
            const pos = this.screenToCanvas(e.clientX, e.clientY);
            const node = this.getNodeAtPosition(pos.x, pos.y);
            if (node === this.dragNode || (node && node.clickedConsumer)) {
                if (this.viewMode === 'hierarchy') {
                    // Handle hierarchy view clicks
                    if (node.type === 'provider') {
                        this.selectSystem(node.name);
                    } else if (node.type === 'service') {
                        // Don't drill into service view from graph - only from right panel
                        // Just highlight/select the service for now
                        this.selectedService = node.name;
                        this.render();
                    } else if (node.type === 'unconsumedService') {
                        // Clicking on unconsumed service selects its provider
                        this.selectSystem(node.providerName);
                    } else if (node.type === 'consumerGroup') {
                        // If clicked on a specific consumer, select it
                        if (node.clickedConsumer) {
                            this.selectSystem(node.clickedConsumer);
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

        // Calculate new zoom
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
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

        const relatedNodes = [];

        // Check if it's a provider
        const providerNode = this.hierarchyNodes.providerNodes.find(n => n.name === systemName);

        if (providerNode) {
            // Add the provider node
            relatedNodes.push(providerNode);

            // Add service nodes that this system PROVIDES
            this.hierarchyNodes.serviceNodes.forEach(sn => {
                if (sn.providers.includes(systemName)) {
                    relatedNodes.push(sn);
                }
            });

            // Add unconsumed services above this provider
            this.hierarchyNodes.unconsumedServiceNodes.forEach(usn => {
                if (usn.providerName === systemName) {
                    relatedNodes.push(usn);
                }
            });
        } else {
            // System is only a consumer - find where it appears in consumer groups
            this.hierarchyNodes.consumerGroups.forEach(group => {
                if (group.consumers.includes(systemName)) {
                    relatedNodes.push(group);
                }
            });
        }

        // If system not in hierarchy, don't change view
        if (relatedNodes.length === 0) return;

        // Filter out any nodes with invalid positions
        const validNodes = relatedNodes.filter(n =>
            typeof n.x === 'number' && !isNaN(n.x) &&
            typeof n.y === 'number' && !isNaN(n.y) &&
            typeof n.width === 'number' && !isNaN(n.width) &&
            typeof n.height === 'number' && !isNaN(n.height)
        );

        if (validNodes.length === 0) return;

        // Calculate bounding box
        const minX = Math.min(...validNodes.map(n => n.x));
        const maxX = Math.max(...validNodes.map(n => n.x + n.width));
        const minY = Math.min(...validNodes.map(n => n.y));
        const maxY = Math.max(...validNodes.map(n => n.y + n.height));

        // Validate bounding box
        if (isNaN(minX) || isNaN(maxX) || isNaN(minY) || isNaN(maxY)) return;

        // Ensure canvas has valid dimensions
        const canvasWidth = this.canvas.width || 800;
        const canvasHeight = this.canvas.height || 600;

        // Add padding
        const padding = 80;
        const contentWidth = Math.max(maxX - minX + padding * 2, 100);
        const contentHeight = Math.max(maxY - minY + padding * 2, 100);

        // Calculate zoom to fit
        const zoomX = canvasWidth / contentWidth;
        const zoomY = canvasHeight / contentHeight;
        this.zoom = Math.min(zoomX, zoomY, 1.5); // Don't zoom in past 150%
        this.zoom = Math.max(this.zoom, 0.1); // Don't zoom out past 10%

        // Center on content
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
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
            ${this.viewMode === 'service' ? `
                <button class="systems-editor__back-btn" id="systems-back-btn">
                    ← Back to Hierarchy View
                </button>
            ` : ''}
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
            backBtn.addEventListener('click', () => this.clearServiceSelection());
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
