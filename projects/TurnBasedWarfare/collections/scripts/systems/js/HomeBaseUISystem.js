/**
 * HomeBaseUISystem - Manages Campaign Select and Home Base UI
 *
 * Handles:
 * - Campaign selection screen (new/load/delete campaigns)
 * - Home base tabs (Atlas, Upgrades, Unlocks, Inventory)
 * - Currency display updates
 * - Atlas canvas rendering and interaction
 * - Upgrade/unlock purchasing UI
 */
class HomeBaseUISystem extends GUTS.BaseSystem {
    static services = [
        'showCampaignSelect',
        'showHomeBase',
        'updateCurrencyDisplay',
        'refreshAtlas',
        'refreshUpgrades',
        'refreshUnlocks',
        'refreshInventory',
        'showCampaignMissionResults',
        'returnToCampaignHomeBase'
    ];

    constructor(game) {
        super(game);
        this.game.homeBaseUISystem = this;

        // Atlas rendering state
        this.atlasCanvas = null;
        this.atlasCtx = null;
        this.selectedNode = null;
        this.hoveredNode = null;

        // Atlas view state
        this.atlasOffset = { x: 0, y: 0 };
        this.atlasScale = 1;
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };

        // Node rendering constants
        this.NODE_RADIUS = 25;
        this.NODE_COLORS = {
            locked: '#444444',
            unlocked: '#cd7f32',
            completed: '#27ae60',
            selected: '#ffd700'
        };
    }

    init() {
    }

    onSceneLoad() {
        const currentScene = this.game.sceneManager?.getCurrentSceneName?.();

        // When campaign scene loads
        if (currentScene === 'campaign') {
            this.setupEventListeners();

            // Check if we're returning from a mission with results to show
            if (this.game.state.pendingMissionResults) {
                // If we need to process results (coming from game scene), do that first
                if (this.game.state.pendingMissionResults.needsProcessing) {
                    this.processMissionResultsFromGame();
                }
                this.displayMissionResults();
            } else if (this.game.call('isCampaignActive')) {
                // Campaign is loaded, show home base
                this.showHomeBase();
            } else {
                // No active campaign, show campaign select
                this.showScreen('campaignSelect');
                this.refreshCampaignList();
            }
        }
    }

    /**
     * Process mission results when returning from game scene
     * This is called when pendingMissionResults.needsProcessing is true
     */
    processMissionResultsFromGame() {
        const pending = this.game.state.pendingMissionResults;
        if (!pending) return;

        // Get scroll data from campaign mission if it was a scroll mission
        const scrollData = pending.scrollData || null;

        // Process mission result through CampaignSystem
        const rewards = this.game.call('processMissionResult', {
            victory: pending.victory,
            nodeId: pending.nodeId,
            scroll: scrollData,
            stats: pending.stats
        });

        // Process any pending loot collected during mission (from monsters)
        let lootRewards = { currencies: {}, items: [] };
        if (this.game.hasService('processPendingLoot')) {
            lootRewards = this.game.call('processPendingLoot');
        }

        // Merge loot currencies with node rewards
        if (rewards && rewards.currencies && lootRewards.currencies) {
            rewards.currencies.valor = (rewards.currencies.valor || 0) + (lootRewards.currencies.valor || 0);
            rewards.currencies.glory = (rewards.currencies.glory || 0) + (lootRewards.currencies.glory || 0);
            rewards.currencies.essence = (rewards.currencies.essence || 0) + (lootRewards.currencies.essence || 0);
        }

        // Add collected items to rewards
        if (rewards) {
            rewards.items = lootRewards.items || [];
        }

        // Update pending results with processed rewards
        this.game.state.pendingMissionResults = {
            victory: pending.victory,
            rewards,
            stats: pending.stats,
            nodeId: pending.nodeId,
            needsProcessing: false // Mark as processed
        };
    }

    setupEventListeners() {
        // Campaign Select Screen
        const campaignBackBtn = document.getElementById('campaignBackBtn');
        if (campaignBackBtn) {
            campaignBackBtn.addEventListener('click', () => {
                // Switch back to lobby scene (which has game mode select)
                this.game.switchScene('lobby');
            });
        }

        const newCampaignBtn = document.getElementById('newCampaignBtn');
        if (newCampaignBtn) {
            newCampaignBtn.addEventListener('click', () => this.showNewCampaignDialog());
        }

        const importCampaignBtn = document.getElementById('importCampaignBtn');
        if (importCampaignBtn) {
            importCampaignBtn.addEventListener('click', () => {
                document.getElementById('importCampaignFile').click();
            });
        }

        const importCampaignFile = document.getElementById('importCampaignFile');
        if (importCampaignFile) {
            importCampaignFile.addEventListener('change', (e) => this.handleImportCampaign(e));
        }

        // New Campaign Dialog
        const createCampaignBtn = document.getElementById('createCampaignBtn');
        if (createCampaignBtn) {
            createCampaignBtn.addEventListener('click', () => this.createNewCampaign());
        }

        const cancelNewCampaignBtn = document.getElementById('cancelNewCampaignBtn');
        if (cancelNewCampaignBtn) {
            cancelNewCampaignBtn.addEventListener('click', () => this.hideNewCampaignDialog());
        }

        // Home Base
        const homeBaseSaveBtn = document.getElementById('homeBaseSaveBtn');
        if (homeBaseSaveBtn) {
            homeBaseSaveBtn.addEventListener('click', () => {
                this.game.call('saveCampaign');
                this.showNotification('Campaign saved!');
            });
        }

        const homeBaseExitBtn = document.getElementById('homeBaseExitBtn');
        if (homeBaseExitBtn) {
            homeBaseExitBtn.addEventListener('click', () => {
                this.game.call('saveCampaign');
                // Show campaign select screen (staying in campaign scene)
                this.showScreen('campaignSelect');
                this.refreshCampaignList();
            });
        }

        // Tab switching
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // Mission start button
        const startMissionBtn = document.getElementById('startMissionBtn');
        if (startMissionBtn) {
            startMissionBtn.addEventListener('click', () => this.startMission());
        }

        // Continue to home base button (from results)
        const continueToHomeBtn = document.getElementById('continueToHomeBtn');
        if (continueToHomeBtn) {
            continueToHomeBtn.addEventListener('click', () => this.showHomeBase());
        }

        // Use item button (in inventory)
        const useItemBtn = document.getElementById('useItemBtn');
        if (useItemBtn) {
            useItemBtn.addEventListener('click', () => this.handleUseItem());
        }

        // Discard item button (in inventory)
        const discardItemBtn = document.getElementById('discardItemBtn');
        if (discardItemBtn) {
            discardItemBtn.addEventListener('click', () => this.handleDiscardItem());
        }

        // Oracle buttons
        const readProphecyBtn = document.getElementById('readProphecyBtn');
        if (readProphecyBtn) {
            readProphecyBtn.addEventListener('click', () => this.handleReadProphecy());
        }

        const rerollProphecyBtn = document.getElementById('rerollProphecyBtn');
        if (rerollProphecyBtn) {
            rerollProphecyBtn.addEventListener('click', () => this.handleRerollProphecy());
        }

        const sealProphecyBtn = document.getElementById('sealProphecyBtn');
        if (sealProphecyBtn) {
            sealProphecyBtn.addEventListener('click', () => this.handleSealProphecy());
        }

        const removeScrollBtn = document.getElementById('removeScrollBtn');
        if (removeScrollBtn) {
            removeScrollBtn.addEventListener('click', () => this.handleRemoveScrollFromOracle());
        }

        // Setup atlas canvas if present
        this.setupAtlasCanvas();
    }

    /**
     * Show the campaign selection screen
     * When called from lobby, switches to campaign scene
     * When called from within campaign scene, shows the select screen
     */
    showCampaignSelect() {
        const currentScene = this.game.sceneManager?.getCurrentSceneName?.();
        if (currentScene !== 'campaign') {
            // Switch to campaign scene - this loads the campaign interface
            this.game.switchScene('campaign');
        } else {
            // Already in campaign scene, just show the select screen
            this.showScreen('campaignSelect');
            this.refreshCampaignList();
        }
    }

    /**
     * Show a screen by ID (utility for within campaign scene)
     */
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
            screen.style.display = '';
        });
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
        }
    }

    /**
     * Refresh the list of saved campaigns
     */
    refreshCampaignList() {
        const campaignList = document.getElementById('campaignList');
        if (!campaignList) return;

        const campaigns = this.game.call('listCampaigns');

        if (campaigns.length === 0) {
            campaignList.innerHTML = '<div class="no-campaigns">No campaigns found. Start a new adventure!</div>';
            return;
        }

        campaignList.innerHTML = campaigns.map(campaign => `
            <div class="campaign-card" data-campaign-id="${campaign.campaignId}">
                <div class="campaign-card-info">
                    <div class="campaign-card-name">${campaign.commanderName}</div>
                    <div class="campaign-card-meta">Last played: ${campaign.lastPlayedDate}</div>
                </div>
                <div class="campaign-card-actions">
                    <button class="btn btn-small btn-primary load-campaign-btn">Load</button>
                    <button class="btn btn-small btn-secondary export-campaign-btn">Export</button>
                    <button class="btn btn-small btn-danger delete-campaign-btn">Delete</button>
                </div>
            </div>
        `).join('');

        // Add event listeners to campaign cards
        campaignList.querySelectorAll('.campaign-card').forEach(card => {
            const campaignId = card.dataset.campaignId;

            card.querySelector('.load-campaign-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.loadCampaign(campaignId);
            });

            card.querySelector('.export-campaign-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.game.call('exportCampaign', campaignId);
            });

            card.querySelector('.delete-campaign-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteCampaign(campaignId);
            });

            // Also allow clicking the card itself to load
            card.addEventListener('click', () => this.loadCampaign(campaignId));
        });
    }

    /**
     * Show the new campaign dialog
     */
    showNewCampaignDialog() {
        const dialog = document.getElementById('newCampaignDialog');
        if (dialog) {
            dialog.style.display = 'flex';
            const input = document.getElementById('commanderNameInput');
            if (input) {
                input.focus();
                input.select();
            }
        }
    }

    /**
     * Hide the new campaign dialog
     */
    hideNewCampaignDialog() {
        const dialog = document.getElementById('newCampaignDialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }

    /**
     * Create a new campaign
     */
    createNewCampaign() {
        const input = document.getElementById('commanderNameInput');
        const commanderName = input ? input.value.trim() : 'Commander';

        this.game.call('createCampaign', commanderName || 'Commander');
        this.hideNewCampaignDialog();
        this.showHomeBase();
    }

    /**
     * Load an existing campaign
     */
    loadCampaign(campaignId) {
        const campaign = this.game.call('loadCampaign', campaignId);
        if (campaign) {
            this.showHomeBase();
        } else {
            this.showNotification('Failed to load campaign', 'error');
        }
    }

    /**
     * Delete a campaign
     */
    deleteCampaign(campaignId) {
        if (confirm('Are you sure you want to delete this campaign? This cannot be undone.')) {
            this.game.call('deleteCampaign', campaignId);
            this.refreshCampaignList();
        }
    }

    /**
     * Handle campaign import
     */
    async handleImportCampaign(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            await this.game.call('importCampaign', file);
            this.showNotification('Campaign imported successfully!');
            this.refreshCampaignList();
        } catch (error) {
            this.showNotification('Failed to import campaign: ' + error.message, 'error');
        }

        event.target.value = '';
    }

    /**
     * Show the home base screen
     */
    showHomeBase() {
        this.showScreen('campaignHomeBase');
        this.updateCurrencyDisplay();
        this.updateCommanderInfo();
        this.switchTab('atlas');
    }

    /**
     * Update the currency display
     */
    updateCurrencyDisplay() {
        const currencies = this.game.call('getCurrencies');
        if (!currencies) return;

        const valorEl = document.getElementById('valorAmount');
        const gloryEl = document.getElementById('gloryAmount');
        const essenceEl = document.getElementById('essenceAmount');

        if (valorEl) valorEl.textContent = currencies.valor || 0;
        if (gloryEl) gloryEl.textContent = currencies.glory || 0;
        if (essenceEl) essenceEl.textContent = currencies.essence || 0;
    }

    /**
     * Update commander info display
     */
    updateCommanderInfo() {
        const campaign = this.game.call('getCampaignState');
        if (!campaign) return;

        const nameEl = document.getElementById('homeBaseCommanderName');
        const statsEl = document.getElementById('homeBaseCampaignStats');

        if (nameEl) nameEl.textContent = campaign.commanderName;
        if (statsEl) {
            statsEl.textContent = `Missions: ${campaign.statistics.missionsCompleted} | Tier: ${campaign.atlas.currentTier}`;
        }
    }

    /**
     * Switch between home base tabs
     */
    switchTab(tabId) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabId + 'Tab');
        });

        // Refresh tab content
        switch (tabId) {
            case 'atlas':
                this.refreshAtlas();
                break;
            case 'commander':
                this.refreshCommander();
                break;
            case 'oracle':
                this.refreshOracle();
                break;
            case 'upgrades':
                this.refreshUpgrades();
                break;
            case 'unlocks':
                this.refreshUnlocks();
                break;
            case 'inventory':
                this.refreshInventory();
                break;
        }
    }

    /**
     * Setup the atlas canvas for rendering
     */
    setupAtlasCanvas() {
        this.atlasCanvas = document.getElementById('atlasCanvas');
        if (!this.atlasCanvas) return;

        this.atlasCtx = this.atlasCanvas.getContext('2d');

        // Set canvas size to container size
        this.resizeAtlasCanvas();

        // Mouse events for atlas interaction
        this.atlasCanvas.addEventListener('click', (e) => this.handleAtlasClick(e));
        this.atlasCanvas.addEventListener('mousemove', (e) => this.handleAtlasMouseMove(e));
        this.atlasCanvas.addEventListener('mousedown', (e) => this.handleAtlasMouseDown(e));
        this.atlasCanvas.addEventListener('mouseup', (e) => this.handleAtlasMouseUp(e));
        this.atlasCanvas.addEventListener('wheel', (e) => this.handleAtlasWheel(e));

        // Use ResizeObserver to handle container size changes
        if (window.ResizeObserver) {
            const container = this.atlasCanvas.parentElement;
            if (container) {
                this.atlasResizeObserver = new ResizeObserver(() => {
                    this.resizeAtlasCanvas();
                    this.refreshAtlas();
                });
                this.atlasResizeObserver.observe(container);
            }
        }
    }

    /**
     * Resize the atlas canvas to match its container
     */
    resizeAtlasCanvas() {
        if (!this.atlasCanvas) return;

        const container = this.atlasCanvas.parentElement;
        if (container) {
            const rect = container.getBoundingClientRect();
            // Only update if we have valid dimensions
            if (rect.width > 0 && rect.height > 0) {
                this.atlasCanvas.width = rect.width;
                this.atlasCanvas.height = rect.height;

                // Update center offset if this is first valid size
                if (!this.atlasInitialized) {
                    this.atlasOffset.x = this.atlasCanvas.width / 2 - 400;
                    this.atlasOffset.y = this.atlasCanvas.height / 2 - 150;
                    this.atlasInitialized = true;
                }
            }
        }
    }

    /**
     * Refresh/render the atlas - now uses procedurally generated quest nodes
     */
    refreshAtlas() {
        if (!this.atlasCanvas || !this.atlasCtx) {
            this.setupAtlasCanvas();
            if (!this.atlasCanvas) return;
        }

        const ctx = this.atlasCtx;
        const canvas = this.atlasCanvas;

        // Clear canvas
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const campaign = this.game.call('getCampaignState');
        if (!campaign) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No campaign loaded', canvas.width / 2, canvas.height / 2);
            return;
        }

        // Get current quest nodes (generates quest if none exists)
        const quest = this.game.call('getCurrentQuest');
        if (!quest || !quest.nodes) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Generating quest...', canvas.width / 2, canvas.height / 2);
            return;
        }

        const questNodes = quest.nodes;
        const unlockedNodes = quest.unlockedNodes || [];
        const completedNodes = quest.completedNodes || [];

        // Draw quest progress header
        this.drawQuestHeader(ctx, canvas, quest);

        // Draw connections first
        ctx.lineWidth = 3;

        Object.values(questNodes).forEach(node => {
            if (!node.connections) return;

            const startX = node.position.x * this.atlasScale + this.atlasOffset.x;
            const startY = node.position.y * this.atlasScale + this.atlasOffset.y;

            node.connections.forEach(connectedId => {
                const connectedNode = questNodes[connectedId];
                if (!connectedNode) return;

                const endX = connectedNode.position.x * this.atlasScale + this.atlasOffset.x;
                const endY = connectedNode.position.y * this.atlasScale + this.atlasOffset.y;

                // Color connection based on node states
                const sourceCompleted = completedNodes.includes(node.id);
                const targetUnlocked = unlockedNodes.includes(connectedId);

                if (sourceCompleted && targetUnlocked) {
                    // Path is open
                    ctx.strokeStyle = '#4a9eff';
                } else if (sourceCompleted || unlockedNodes.includes(node.id)) {
                    // Partial progress
                    ctx.strokeStyle = '#666666';
                } else {
                    // Locked path
                    ctx.strokeStyle = '#333333';
                }

                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                ctx.stroke();
            });
        });

        // Draw nodes
        Object.values(questNodes).forEach(node => {
            const x = node.position.x * this.atlasScale + this.atlasOffset.x;
            const y = node.position.y * this.atlasScale + this.atlasOffset.y;
            const radius = (node.isBoss ? this.NODE_RADIUS * 1.3 : this.NODE_RADIUS) * this.atlasScale;

            // Determine node state
            let fillColor = this.NODE_COLORS.locked;
            let borderColor = '#555555';

            if (completedNodes.includes(node.id)) {
                fillColor = this.NODE_COLORS.completed;
                borderColor = '#2ecc71';
            } else if (unlockedNodes.includes(node.id)) {
                fillColor = this.NODE_COLORS.unlocked;
                borderColor = '#e67e22';
            }

            // Boss node gets special treatment
            if (node.isBoss) {
                if (!completedNodes.includes(node.id) && unlockedNodes.includes(node.id)) {
                    fillColor = '#8e44ad'; // Purple for available boss
                    borderColor = '#9b59b6';
                } else if (!unlockedNodes.includes(node.id)) {
                    fillColor = '#2c1445'; // Dark purple for locked boss
                    borderColor = '#5c2d7e';
                }
            }

            // Highlight selected or hovered node
            if (this.selectedNode === node.id) {
                fillColor = this.NODE_COLORS.selected;
                borderColor = '#ffd700';
            }

            // Draw node glow for boss
            if (node.isBoss && unlockedNodes.includes(node.id) && !completedNodes.includes(node.id)) {
                ctx.beginPath();
                ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(155, 89, 182, 0.3)';
                ctx.fill();
            }

            // Draw node circle
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.fill();

            // Draw border
            ctx.strokeStyle = this.hoveredNode === node.id ? '#ffffff' : borderColor;
            ctx.lineWidth = node.isBoss ? 3 : 2;
            ctx.stroke();

            // Draw icon/indicator
            ctx.fillStyle = '#ffffff';
            ctx.font = `${(node.isBoss ? 14 : 12) * this.atlasScale}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (node.isBoss) {
                ctx.fillText('BOSS', x, y);
            } else {
                ctx.fillText(node.layer + 1, x, y);
            }

            // Draw node title below
            ctx.font = `${10 * this.atlasScale}px Arial`;
            ctx.fillStyle = node.isBoss ? '#9b59b6' : '#aaaaaa';
            ctx.fillText(node.title, x, y + radius + 14);
        });
    }

    /**
     * Draw quest progress header on the atlas canvas
     */
    drawQuestHeader(ctx, canvas, quest) {
        const progress = this.game.call('getQuestProgress');
        if (!progress) return;

        // Draw background bar
        const barY = 15;
        const barHeight = 25;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, barY - 5, canvas.width - 20, barHeight + 10);

        // Quest title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Quest Tier ${quest.tier}`, 20, barY + barHeight / 2);

        // Progress text
        ctx.font = '12px Arial';
        ctx.textAlign = 'right';
        const progressText = quest.isComplete
            ? 'QUEST COMPLETE!'
            : `${progress.completedNodes}/${progress.totalNodes} nodes`;
        ctx.fillStyle = quest.isComplete ? '#2ecc71' : '#aaaaaa';
        ctx.fillText(progressText, canvas.width - 20, barY + barHeight / 2);

        // Progress bar
        const barX = 150;
        const barWidth = canvas.width - 300;
        ctx.fillStyle = '#333333';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        const fillWidth = (progress.completedNodes / progress.totalNodes) * barWidth;
        ctx.fillStyle = quest.isComplete ? '#2ecc71' : '#4a9eff';
        ctx.fillRect(barX, barY, fillWidth, barHeight);

        ctx.strokeStyle = '#555555';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth, barHeight);
    }

    /**
     * Handle atlas canvas click
     */
    handleAtlasClick(event) {
        const rect = this.atlasCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const clickedNode = this.getNodeAtPosition(x, y);

        if (clickedNode) {
            this.selectNode(clickedNode);
        }
    }

    /**
     * Handle atlas mouse move (for hover effects)
     */
    handleAtlasMouseMove(event) {
        if (this.isDragging) {
            const rect = this.atlasCanvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            this.atlasOffset.x += x - this.dragStart.x;
            this.atlasOffset.y += y - this.dragStart.y;

            this.dragStart = { x, y };
            this.refreshAtlas();
            return;
        }

        const rect = this.atlasCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const hoveredNode = this.getNodeAtPosition(x, y);
        if (hoveredNode !== this.hoveredNode) {
            this.hoveredNode = hoveredNode;
            this.atlasCanvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
            this.refreshAtlas();
        }
    }

    handleAtlasMouseDown(event) {
        const rect = this.atlasCanvas.getBoundingClientRect();
        this.dragStart = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
        this.isDragging = true;
        this.atlasCanvas.style.cursor = 'grabbing';
    }

    handleAtlasMouseUp(event) {
        this.isDragging = false;
        this.atlasCanvas.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
    }

    handleAtlasWheel(event) {
        event.preventDefault();
        const delta = event.deltaY > 0 ? 0.9 : 1.1;
        this.atlasScale = Math.max(0.5, Math.min(2, this.atlasScale * delta));
        this.refreshAtlas();
    }

    /**
     * Get node at canvas position - now uses quest nodes
     */
    getNodeAtPosition(x, y) {
        const quest = this.game.call('getCurrentQuest');
        if (!quest || !quest.nodes) return null;

        const questNodes = quest.nodes;

        for (const node of Object.values(questNodes)) {
            const nodeX = node.position.x * this.atlasScale + this.atlasOffset.x;
            const nodeY = node.position.y * this.atlasScale + this.atlasOffset.y;
            const radius = (node.isBoss ? this.NODE_RADIUS * 1.3 : this.NODE_RADIUS) * this.atlasScale;

            const distance = Math.sqrt(Math.pow(x - nodeX, 2) + Math.pow(y - nodeY, 2));
            if (distance <= radius) {
                return node.id;
            }
        }

        return null;
    }

    /**
     * Select a node and update the info panel
     * Nodes are places/levels - they require a scroll to play
     */
    selectNode(nodeId) {
        this.selectedNode = nodeId;
        this.refreshAtlas();

        // Get node from quest instead of static atlas
        const quest = this.game.call('getCurrentQuest');
        const node = quest?.nodes?.[nodeId] || null;
        const campaign = this.game.call('getCampaignState');

        const titleEl = document.getElementById('selectedNodeTitle');
        const descEl = document.getElementById('selectedNodeDesc');
        const rewardsEl = document.getElementById('nodeRewards');
        const rewardsListEl = document.getElementById('nodeRewardsList');
        const modifiersEl = document.getElementById('nodeModifiers');
        const modifiersListEl = document.getElementById('nodeModifiersList');
        const startBtn = document.getElementById('startMissionBtn');

        if (!node) {
            if (titleEl) titleEl.textContent = 'Select a Node';
            if (descEl) descEl.textContent = 'Click on a node in the atlas to view details.';
            if (rewardsEl) rewardsEl.style.display = 'none';
            if (modifiersEl) modifiersEl.style.display = 'none';
            if (startBtn) startBtn.style.display = 'none';
            this.hideMissionScrollUI();
            return;
        }

        // Show node title with mission type
        const missionType = node.missionType || 'hunt';
        const missionIcon = missionType === 'hunt' ? '🎯' : '⚔️';
        const missionLabel = missionType.charAt(0).toUpperCase() + missionType.slice(1);

        if (titleEl) titleEl.textContent = node.title;
        if (descEl) descEl.innerHTML = `<span style="color: ${missionType === 'hunt' ? '#e74c3c' : '#3498db'};">${missionIcon} ${missionLabel} Mission</span><br>${node.description || 'No description available.'}`;

        // Show base rewards for this location
        if (rewardsEl && rewardsListEl && node.baseRewards) {
            rewardsEl.style.display = 'block';
            let rewardsHtml = '<div style="color: rgba(255,255,255,0.5); font-size: 0.8rem; margin-bottom: 0.25rem;">Base Rewards:</div>';
            if (node.baseRewards.valor) rewardsHtml += `<div>⚔️ Valor: ${node.baseRewards.valor}</div>`;
            rewardsHtml += '<div style="color: rgba(255,255,255,0.4); font-size: 0.75rem; margin-top: 0.25rem;">📜 Chance to drop prophecy scroll</div>';
            rewardsListEl.innerHTML = rewardsHtml;
        }

        // Check if this node has an applied prophecy scroll
        const appliedScroll = this.getAppliedScrollForNode(nodeId);
        if (appliedScroll && modifiersEl && modifiersListEl) {
            modifiersEl.style.display = 'block';
            const modifiers = appliedScroll.itemData?.modifiers || [];

            let modHtml = `<div style="color: #9b59b6; margin-bottom: 0.5rem; font-weight: bold;">Applied Prophecy</div>`;
            if (modifiers.length > 0) {
                // Calculate total glory from modifiers
                let totalGlory = 0;
                modHtml += modifiers.map(mod => {
                    const modGlory = 5 + Math.floor((mod.rewardBonus || 0) * 20);
                    totalGlory += modGlory;
                    return `<div style="color: #9b59b6;">${mod.title} (+${Math.round((mod.rewardBonus || 0) * 100)}% valor)</div>`;
                }).join('');
                // Scale by node tier
                totalGlory *= (node.tier || 1);
                modHtml += `<div style="color: #f1c40f; margin-top: 0.5rem;">🏆 Glory: ${totalGlory}</div>`;
            } else {
                modHtml += `<div style="color: rgba(255,255,255,0.5);">No modifiers revealed yet</div>`;
            }
            modifiersListEl.innerHTML = modHtml;
        } else if (modifiersEl) {
            modifiersEl.style.display = 'none';
        }

        // Show start button if node is unlocked (scrolls are optional for prophecy bonuses)
        if (startBtn && quest) {
            const isUnlocked = this.game.call('isQuestNodeUnlocked', nodeId);
            startBtn.style.display = isUnlocked ? 'block' : 'none';

            // Update button text based on whether a prophecy is applied
            if (appliedScroll) {
                startBtn.textContent = 'Start Mission (with Prophecy)';
            } else {
                startBtn.textContent = 'Start Mission';
            }
        }

        // Show prophecy scroll UI (optional application)
        this.updateMissionScrollUI(nodeId, quest);
    }

    /**
     * Get the scroll that has been applied to a node for a mission
     */
    getAppliedScrollForNode(nodeId) {
        return this.appliedScrolls?.[nodeId] || null;
    }

    /**
     * Update the mission scroll UI in the node panel
     */
    updateMissionScrollUI(nodeId, quest) {
        // Remove existing scroll UI
        this.hideMissionScrollUI();

        const nodeInfoPanel = document.getElementById('nodeInfoPanel');
        if (!nodeInfoPanel) return;

        const isUnlocked = this.game.call('isQuestNodeUnlocked', nodeId);
        if (!isUnlocked) return;

        const appliedScroll = this.getAppliedScrollForNode(nodeId);

        if (appliedScroll) {
            // Show applied scroll info with option to remove
            const appliedDiv = document.createElement('div');
            appliedDiv.id = 'appliedScrollInfo';
            appliedDiv.className = 'applied-scroll-info';
            const modifiers = appliedScroll.itemData?.modifiers || [];
            appliedDiv.innerHTML = `
                <h4>Mission Ready</h4>
                <div class="modifier-list">
                    ${modifiers.length > 0
                        ? modifiers.map(mod => `<div>${mod.title}</div>`).join('')
                        : '<div style="color: rgba(255,255,255,0.5);">No incantation applied</div>'
                    }
                </div>
                <div style="color: #f39c12; margin-top: 0.5rem;">
                    Reward: ${(appliedScroll.itemData?.rewardMultiplier || 1).toFixed(2)}x
                </div>
                <button class="btn btn-secondary btn-small remove-scroll-btn" id="removeScrollBtn">
                    Remove Scroll
                </button>
            `;
            nodeInfoPanel.appendChild(appliedDiv);

            document.getElementById('removeScrollBtn')?.addEventListener('click', () => {
                this.removeScrollFromNode(nodeId);
            });

        } else if (this.pendingMissionScroll) {
            // Show option to apply pending scroll
            const scroll = this.pendingMissionScroll;
            const modifiers = scroll.itemData?.modifiers || [];
            const scrollDiv = document.createElement('div');
            scrollDiv.id = 'missionScrollUI';
            scrollDiv.className = 'node-scroll-info';
            scrollDiv.innerHTML = `
                <h4>Start Mission</h4>
                <p style="font-size: 0.85rem; color: rgba(255,255,255,0.7); margin-bottom: 0.5rem;">
                    Use "${scroll.name}" at this node?
                </p>
                <div style="font-size: 0.85rem; color: #9b59b6; margin-bottom: 0.5rem;">
                    ${modifiers.length > 0 ? modifiers.map(mod => mod.title).join(', ') : 'No incantation'}
                </div>
                <div style="color: #f39c12; font-size: 0.9rem; margin-bottom: 0.75rem;">
                    Reward Multiplier: ${(scroll.itemData?.rewardMultiplier || 1).toFixed(2)}x
                </div>
                <button class="btn btn-oracle apply-scroll-btn" id="applyScrollBtn">
                    Apply Scroll
                </button>
                <button class="btn btn-secondary btn-small" id="cancelScrollBtn" style="margin-top: 0.5rem;">
                    Cancel
                </button>
            `;
            nodeInfoPanel.appendChild(scrollDiv);

            document.getElementById('applyScrollBtn')?.addEventListener('click', () => {
                this.applyScrollToNode(nodeId);
            });

            document.getElementById('cancelScrollBtn')?.addEventListener('click', () => {
                this.pendingMissionScroll = null;
                this.updateMissionScrollUI(nodeId, quest);
            });
        } else {
            // No applied scroll and no pending scroll - show available scrolls from inventory
            this.showAvailableScrollsUI(nodeId, nodeInfoPanel);
        }
    }

    /**
     * Show available scrolls from inventory that can be applied to this node
     */
    showAvailableScrollsUI(nodeId, nodeInfoPanel) {
        const items = this.game.call('getInventoryItems') || [];
        const availableScrolls = items.filter(item => item.itemType === 'missionScroll');

        if (availableScrolls.length === 0) {
            // No scrolls - show message
            const noScrollsDiv = document.createElement('div');
            noScrollsDiv.id = 'missionScrollUI';
            noScrollsDiv.className = 'node-scroll-info';
            noScrollsDiv.innerHTML = `
                <h4>No Scrolls Available</h4>
                <p style="font-size: 0.85rem; color: rgba(255,255,255,0.6);">
                    You need a scroll to run a mission at this node.
                </p>
                <p style="font-size: 0.8rem; color: rgba(255,255,255,0.5); margin-top: 0.5rem;">
                    Visit the <strong>Commander</strong> to purchase scrolls.
                </p>
            `;
            nodeInfoPanel.appendChild(noScrollsDiv);
            return;
        }

        // Show list of available scrolls
        const scrollsDiv = document.createElement('div');
        scrollsDiv.id = 'missionScrollUI';
        scrollsDiv.className = 'node-scroll-info';

        let scrollsHtml = `<h4>Apply Prophecy (Optional)</h4>`;
        scrollsHtml += `<div class="available-scrolls-list">`;

        // Filter to only sealed prophecy scrolls (those with modifiers)
        const sealedScrolls = availableScrolls.filter(s => s.itemData?.modifiers?.length > 0 && s.itemData?.isSealed);

        if (sealedScrolls.length === 0) {
            scrollsHtml += `<div style="color: rgba(255,255,255,0.5); font-size: 0.85rem; padding: 0.5rem;">No sealed prophecies available. Visit the Oracle to reveal prophecies on blank scrolls.</div>`;
        }

        sealedScrolls.forEach(scroll => {
            const modifiers = scroll.itemData?.modifiers || [];
            const rewardMult = scroll.itemData?.rewardMultiplier || 1;
            const rarity = scroll.rarity || 'common';
            const rarityColor = rarity === 'epic' ? '#9b59b6' :
                               rarity === 'rare' ? '#3498db' :
                               rarity === 'uncommon' ? '#2ecc71' : '#95a5a6';

            scrollsHtml += `
                <div class="available-scroll-item" data-scroll-id="${scroll.id}">
                    <div class="scroll-header">
                        <span class="scroll-icon">📜</span>
                        <span class="scroll-name" style="color: ${rarityColor};">${scroll.name || 'Prophecy Scroll'}</span>
                    </div>
                    <div class="scroll-mods" style="font-size: 0.75rem; color: #9b59b6;">
                        ${modifiers.map(m => m.title).join(', ')}
                    </div>
                    <div class="scroll-reward" style="font-size: 0.75rem; color: #f39c12;">
                        Reward: ${rewardMult.toFixed(2)}x
                    </div>
                    <button class="btn btn-oracle btn-small apply-this-scroll-btn" data-scroll-id="${scroll.id}">
                        Apply
                    </button>
                </div>
            `;
        });

        scrollsHtml += `</div>`;
        scrollsDiv.innerHTML = scrollsHtml;
        nodeInfoPanel.appendChild(scrollsDiv);

        // Add click handlers for apply buttons
        scrollsDiv.querySelectorAll('.apply-this-scroll-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const scrollId = btn.dataset.scrollId;
                const scroll = availableScrolls.find(s => s.id === scrollId);
                if (scroll) {
                    this.pendingMissionScroll = scroll;
                    this.applyScrollToNode(nodeId);
                }
            });
        });
    }

    /**
     * Hide the mission scroll UI elements
     */
    hideMissionScrollUI() {
        document.getElementById('appliedScrollInfo')?.remove();
        document.getElementById('missionScrollUI')?.remove();
    }

    /**
     * Apply a scroll to a node to start a mission
     */
    applyScrollToNode(nodeId) {
        const scroll = this.pendingMissionScroll;
        if (!scroll) {
            this.showNotification('No scroll selected', 'error');
            return;
        }

        // Check if scroll has a prophecy (modifiers)
        const modifiers = scroll.itemData?.modifiers || [];
        if (modifiers.length === 0) {
            this.showNotification('This scroll has no prophecy. Visit the Oracle to reveal its fate.', 'error');
            return;
        }

        // Initialize applied scrolls map if needed
        if (!this.appliedScrolls) {
            this.appliedScrolls = {};
        }

        // Apply the scroll to the node
        this.appliedScrolls[nodeId] = scroll;

        // Remove scroll from inventory (it's now bound to this node)
        this.game.call('removeItemFromInventory', scroll.id);

        this.pendingMissionScroll = null;

        this.showNotification('Scroll applied. Ready to start mission!');
        this.refreshInventory();
        this.selectNode(nodeId);
    }

    /**
     * Remove a scroll from a node (returns scroll to inventory)
     */
    removeScrollFromNode(nodeId) {
        const scroll = this.appliedScrolls?.[nodeId];
        if (!scroll) return;

        // Return scroll to inventory
        this.game.call('addItemToInventory', scroll);

        // Remove from applied scrolls
        delete this.appliedScrolls[nodeId];

        this.showNotification('Scroll returned to inventory.');
        this.refreshInventory();
        this.selectNode(nodeId);
    }

    /**
     * Start a mission from the selected node
     * Mission type is determined by the node itself
     * Optional: apply a sealed prophecy scroll for modifiers
     */
    startMission() {
        if (!this.selectedNode) {
            this.showNotification('No node selected', 'error');
            return;
        }

        const isUnlocked = this.game.call('isQuestNodeUnlocked', this.selectedNode);
        if (!isUnlocked) {
            this.showNotification('This node is locked', 'error');
            return;
        }

        // Get node config from current quest (nodes are dynamically generated)
        const quest = this.game.call('getCurrentQuest');
        const node = quest?.nodes?.[this.selectedNode];

        if (!node) {
            this.showNotification('Node data not found', 'error');
            return;
        }

        // Check for optional applied prophecy scroll (for modifiers)
        const appliedScroll = this.getAppliedScrollForNode(this.selectedNode);

        // Store mission info in game state
        this.game.state.campaignMission = {
            nodeId: this.selectedNode,
            scroll: appliedScroll || null,
            scrollId: appliedScroll?.id || null
        };

        // Apply permanent upgrades to mission config
        // Base config uses node difficulty to scale starting resources
        const difficultyMultiplier = 1 + (node.baseDifficulty - 1) * 0.1;
        const baseConfig = {
            startingGold: Math.floor(100 * difficultyMultiplier),
            aiStartingGold: Math.floor(100 * difficultyMultiplier)
        };

        const missionConfig = this.game.call('applyPermanentUpgrades', baseConfig);

        // Build prophecy modifiers from applied scroll (if any)
        const prophecyModifiers = appliedScroll?.itemData?.modifiers || [];
        const prophecyRewardMultiplier = appliedScroll?.itemData?.rewardMultiplier || 1;

        // Get mission type from node (not scroll)
        const missionType = node.missionType || 'hunt';

        // Set game mode for GameSystem.initializeGame() - required for game to start properly
        this.game.state.gameMode = {
            id: missionType === 'hunt' ? 'hunt' : 'campaign',
            title: `${node.title} - ${missionType.charAt(0).toUpperCase() + missionType.slice(1)}`,
            description: node.description || node.title
        };

        // Convert level name to index and set it BEFORE scene switch
        // This is needed because TerrainSystem reads game.state.level in onSceneLoad
        const levelName = node.level;
        const levelIndex = this.enums?.levels?.[levelName] ?? 0;
        this.game.state.level = levelIndex;
        console.log('[HomeBaseUISystem] Setting level before scene switch:', levelName, '-> index:', levelIndex);

        if (missionType === 'hunt') {
            // Hunt mission config - pass directly to scene
            // Pack count and difficulty scale with node tier
            const nodeDifficulty = node.baseDifficulty || 1;
            const packCount = 2 + node.tier;
            const skeletonsPerPack = 3 + Math.floor(nodeDifficulty / 2);

            const huntConfig = {
                isHuntMission: true,
                isCampaignMission: true,
                selectedLevel: node.level,
                selectedTeam: 'left',
                startingGold: missionConfig.startingGold,
                packCount: packCount,
                skeletonsPerPack: skeletonsPerPack,
                difficulty: nodeDifficulty,  // Pass difficulty for stat scaling
                bossType: node.isBoss ? 'skeleton_boss' : (node.tier >= 2 ? 'skeleton_boss' : null),
                missionNodeId: this.selectedNode,
                campaignModifiers: missionConfig.campaignModifiers,
                prophecyModifiers: prophecyModifiers,
                prophecyRewardMultiplier: prophecyRewardMultiplier,
                hasAppliedProphecy: !!appliedScroll
            };

            // Consume scroll if one was applied (prophecy is used up)
            if (appliedScroll) {
                this.consumeAppliedScroll(this.selectedNode);
            }

            // Switch to hunt scene with config
            this.game.switchScene('hunt', huntConfig);
        } else {
            // Skirmish mission config - pass directly to scene
            // AI resources scale with node difficulty
            const skirmishConfig = {
                isSkirmish: true,
                isCampaignMission: true,
                selectedLevel: node.level,
                selectedTeam: 'left',
                startingGold: missionConfig.startingGold,
                aiStartingGold: missionConfig.aiStartingGold,
                aiMode: 'heuristic',
                missionNodeId: this.selectedNode,
                campaignModifiers: missionConfig.campaignModifiers,
                prophecyModifiers: prophecyModifiers,
                prophecyRewardMultiplier: prophecyRewardMultiplier,
                hasAppliedProphecy: !!appliedScroll
            };

            // Consume scroll if one was applied (prophecy is used up)
            if (appliedScroll) {
                this.consumeAppliedScroll(this.selectedNode);
            }

            // Switch to skirmish scene with config
            this.game.switchScene('skirmish', skirmishConfig);
        }
    }

    /**
     * Consume an applied prophecy scroll when starting a mission
     */
    consumeAppliedScroll(nodeId) {
        const appliedScroll = this.appliedScrolls[nodeId];
        if (appliedScroll) {
            // Remove from inventory
            this.game.call('removeFromInventory', appliedScroll.id);
            // Remove from applied scrolls
            delete this.appliedScrolls[nodeId];
        }
    }

    /**
     * Refresh the upgrades tab
     */
    refreshUpgrades() {
        const campaignUpgrades = this.collections.campaignUpgrades;
        const campaign = this.game.call('getCampaignState');

        if (!campaignUpgrades) return;

        const categories = {
            economy: document.querySelector('#economyUpgrades .upgrade-list'),
            military: document.querySelector('#militaryUpgrades .upgrade-list')
        };

        // Clear existing
        Object.values(categories).forEach(el => {
            if (el) el.innerHTML = '';
        });

        Object.values(campaignUpgrades).forEach(upgrade => {
            const category = upgrade.category || 'economy';
            const container = categories[category];
            if (!container) return;

            const currentValue = campaign ? (campaign.permanentUpgrades[upgrade.effect.stat] || 0) : 0;
            const currentLevel = Math.floor(currentValue / upgrade.effect.value);
            const isMaxed = upgrade.maxLevel && currentLevel >= upgrade.maxLevel;

            const canAfford = this.game.call('canAfford', upgrade.cost);

            const card = document.createElement('div');
            card.className = 'upgrade-card' + (isMaxed ? ' maxed' : '');
            card.innerHTML = `
                <div class="upgrade-card-header">
                    <span class="upgrade-card-title">${upgrade.title}</span>
                    <span class="upgrade-card-level">${currentLevel}/${upgrade.maxLevel || '?'}</span>
                </div>
                <div class="upgrade-card-desc">${upgrade.description}</div>
                <div class="upgrade-card-cost">${this.formatCost(upgrade.cost)}</div>
            `;

            if (!isMaxed) {
                card.addEventListener('click', () => {
                    if (this.game.call('purchaseUpgrade', upgrade.id)) {
                        this.updateCurrencyDisplay();
                        this.refreshUpgrades();
                        this.showNotification(`Purchased ${upgrade.title}!`);
                    } else {
                        this.showNotification('Cannot afford upgrade', 'error');
                    }
                });
            }

            container.appendChild(card);
        });
    }

    /**
     * Refresh the unlocks tab
     */
    refreshUnlocks() {
        const campaignUnlocks = this.collections.campaignUnlocks;
        const campaign = this.game.call('getCampaignState');
        const container = document.getElementById('unlocksList');

        if (!container || !campaignUnlocks) return;

        container.innerHTML = '';

        Object.values(campaignUnlocks).forEach(unlock => {
            const isOwned = campaign && (
                (unlock.type === 'unit' && campaign.unlocks.units.includes(unlock.unlockId)) ||
                (unlock.type === 'building' && campaign.unlocks.buildings.includes(unlock.unlockId))
            );

            const card = document.createElement('div');
            card.className = 'unlock-card' + (isOwned ? ' owned' : '');
            card.innerHTML = `
                <div class="unlock-card-title">${unlock.title}</div>
                <div class="unlock-card-desc">${unlock.description}</div>
                ${isOwned ?
                    '<div class="unlock-card-status">Owned</div>' :
                    `<div class="unlock-card-cost">${this.formatCost(unlock.cost)}</div>`
                }
            `;

            if (!isOwned) {
                card.addEventListener('click', () => {
                    if (!this.game.call('canAfford', unlock.cost)) {
                        this.showNotification('Cannot afford unlock', 'error');
                        return;
                    }

                    // Deduct cost
                    for (const [type, amount] of Object.entries(unlock.cost)) {
                        this.game.call('deductCurrency', type, amount);
                    }

                    // Add unlock
                    if (unlock.type === 'unit') {
                        this.game.call('unlockUnit', unlock.unlockId);
                    } else if (unlock.type === 'building') {
                        this.game.call('unlockBuilding', unlock.unlockId);
                    }

                    this.updateCurrencyDisplay();
                    this.refreshUnlocks();
                    this.showNotification(`Unlocked ${unlock.title}!`);
                });
            }

            container.appendChild(card);
        });
    }

    /**
     * Refresh the inventory tab
     */
    refreshInventory() {
        const campaign = this.game.call('getCampaignState');
        const container = document.getElementById('inventoryGrid');

        if (!container || !campaign) return;

        const maxSlots = campaign.inventory.maxSlots || 20;
        const items = campaign.inventory.items || [];

        // Update slot counts
        const usedEl = document.getElementById('inventoryUsed');
        const maxEl = document.getElementById('inventoryMax');
        if (usedEl) usedEl.textContent = items.length;
        if (maxEl) maxEl.textContent = maxSlots;

        container.innerHTML = '';

        // Create inventory slots
        for (let i = 0; i < maxSlots; i++) {
            const item = items.find(item => item.slotIndex === i);
            const slot = document.createElement('div');
            slot.className = 'inventory-slot' + (item ? ' filled' : '');
            slot.dataset.slotIndex = i;

            if (item) {
                // Determine icon based on item type
                let icon = '📦';
                if (item.itemType === 'missionScroll') icon = '📜';
                else if (item.itemType === 'equipment') icon = '⚔️';
                else if (item.itemType === 'consumable') icon = '🧪';
                else if (item.itemType === 'material') icon = '💎';

                slot.innerHTML = `<span class="item-icon">${icon}</span>`;

                // Show amount for stackable items
                if (item.amount > 1) {
                    slot.innerHTML += `<span class="item-amount">x${item.amount}</span>`;
                }

                // Apply item color as border
                if (item.color) {
                    slot.style.borderColor = item.color;
                }

                // Set rarity data attribute
                if (item.itemData && item.itemData.rarity) {
                    slot.dataset.rarity = item.itemData.rarity;
                }
            }

            slot.addEventListener('click', () => this.selectInventorySlot(i));
            container.appendChild(slot);
        }
    }

    /**
     * Select an inventory slot
     */
    selectInventorySlot(slotIndex) {
        // Update selection UI
        document.querySelectorAll('.inventory-slot').forEach(slot => {
            slot.classList.toggle('selected', parseInt(slot.dataset.slotIndex) === slotIndex);
        });

        const campaign = this.game.call('getCampaignState');
        const item = campaign ? campaign.inventory.items.find(i => i.slotIndex === slotIndex) : null;

        const titleEl = document.getElementById('selectedItemTitle');
        const descEl = document.getElementById('selectedItemDesc');
        const actionsEl = document.getElementById('itemActions');
        const useBtn = document.getElementById('useItemBtn');
        const scrollActionsEl = document.getElementById('scrollActions');

        if (!item) {
            if (titleEl) titleEl.textContent = 'Empty Slot';
            if (descEl) descEl.textContent = 'This inventory slot is empty.';
            if (actionsEl) actionsEl.style.display = 'none';
            if (scrollActionsEl) scrollActionsEl.style.display = 'none';
            return;
        }

        // Store selected item for actions
        this.selectedInventorySlot = slotIndex;
        this.selectedItem = item;

        // Show item name
        if (titleEl) {
            titleEl.textContent = item.name || item.itemType;
            if (item.color) {
                titleEl.style.color = item.color;
            } else {
                titleEl.style.color = '';
            }
        }

        // Build description based on item type
        let description = '';
        const amountText = item.amount > 1 ? ` (x${item.amount})` : '';

        switch (item.itemType) {
            case 'missionScroll':
                const tier = item.itemData?.tier || 1;
                const modifiers = item.itemData?.modifiers || [];
                const rewardMult = item.itemData?.rewardMultiplier || 1;
                const isSealed = modifiers.length > 0;

                description = `📜 Prophecy Scroll - Tier ${tier}\n`;

                if (isSealed) {
                    description += `Reward Multiplier: ${Math.round(rewardMult * 100)}%\n\n`;
                    description += 'Prophecy Modifiers:\n';
                    modifiers.forEach(m => {
                        description += `• ${m.title}: ${m.description}\n`;
                    });
                    if (useBtn) useBtn.textContent = 'Apply to Mission';
                } else {
                    description += '\nThis scroll has no prophecy yet.\n';
                    description += 'Take it to the Oracle to receive a prophecy.\n';
                    if (useBtn) useBtn.textContent = 'Go to Oracle';
                }

                // Show scroll-specific actions
                this.showScrollActions(item);
                break;
            case 'equipment':
                const effect = item.itemData?.effect || 'unknown';
                const value = item.itemData?.value || 0;
                description = `Equipment that provides bonuses.${amountText}\nEffect: +${value} ${effect}`;
                if (useBtn) useBtn.textContent = 'Equip';
                if (scrollActionsEl) scrollActionsEl.style.display = 'none';
                break;
            case 'consumable':
                const consumableEffect = item.itemData?.effect || 'unknown';
                description = `A consumable item for use in missions.${amountText}\nEffect: ${consumableEffect}`;
                if (useBtn) useBtn.textContent = 'Use';
                if (scrollActionsEl) scrollActionsEl.style.display = 'none';
                break;
            case 'material':
                const rarity = item.itemData?.rarity || 'common';
                description = `Crafting material.${amountText}\nRarity: ${rarity}`;
                if (useBtn) useBtn.textContent = 'Craft';
                if (scrollActionsEl) scrollActionsEl.style.display = 'none';
                break;
            default:
                description = `An item.${amountText}`;
                if (useBtn) useBtn.textContent = 'Use';
                if (scrollActionsEl) scrollActionsEl.style.display = 'none';
        }

        if (descEl) descEl.textContent = description;
        if (actionsEl) actionsEl.style.display = 'flex';
    }

    /**
     * Show scroll-specific action buttons
     * Directs users to the Oracle to read/roll prophecies
     */
    showScrollActions(scroll) {
        let scrollActionsEl = document.getElementById('scrollActions');

        // Create scroll actions container if it doesn't exist
        if (!scrollActionsEl) {
            const itemDetails = document.getElementById('itemDetails');
            if (itemDetails) {
                scrollActionsEl = document.createElement('div');
                scrollActionsEl.id = 'scrollActions';
                scrollActionsEl.className = 'scroll-actions';
                itemDetails.appendChild(scrollActionsEl);
            }
        }

        if (!scrollActionsEl) return;

        const modifiers = scroll.itemData?.modifiers || [];
        const isSealed = scroll.itemData?.isSealed;
        const tier = scroll.itemData?.tier || scroll.tier || 1;
        const rarity = scroll.rarity || 'common';
        const rarityColor = rarity === 'epic' ? '#9b59b6' :
                           rarity === 'rare' ? '#3498db' :
                           rarity === 'uncommon' ? '#2ecc71' : '#95a5a6';

        let html = '<div class="scroll-actions-title">Prophecy Scroll</div>';
        html += `<div style="color: ${rarityColor}; font-weight: bold; margin-bottom: 0.5rem;">Tier ${tier} - ${rarity.charAt(0).toUpperCase() + rarity.slice(1)}</div>`;

        if (modifiers.length === 0) {
            // No prophecy yet - direct to Oracle
            html += `
                <p style="color: rgba(255,255,255,0.6); margin-bottom: 0.75rem; font-size: 0.9rem;">
                    This scroll has no prophecy. Visit the Oracle to have its fate revealed.
                </p>
                <button class="btn btn-oracle" id="goToOracleBtn">
                    Visit the Oracle
                </button>
            `;
        } else if (!isSealed) {
            // Has prophecy but not sealed
            html += `
                <p style="color: rgba(255,255,255,0.6); margin-bottom: 0.75rem; font-size: 0.9rem;">
                    Prophecy revealed but not sealed. Visit the Oracle to seal or reroll.
                </p>
                <div class="modifier-reroll-list" style="margin-bottom: 0.75rem;">
                    ${modifiers.map(mod => `
                        <div class="modifier-reroll-item">
                            <span class="modifier-name">${mod.title}</span>
                            <span style="color: #27ae60; font-size: 0.85rem;">+${Math.round((mod.rewardBonus || 0) * 100)}%</span>
                        </div>
                    `).join('')}
                </div>
                <button class="btn btn-oracle" id="goToOracleBtn">
                    Visit the Oracle
                </button>
            `;
        } else {
            // Sealed - show modifiers and allow using on atlas
            html += `
                <p style="color: #27ae60; margin-bottom: 0.75rem; font-size: 0.9rem;">
                    Incantation applied! Use this scroll on the Atlas to start a mission.
                </p>
                <div class="modifier-reroll-list" style="margin-bottom: 0.75rem;">
                    ${modifiers.map(mod => `
                        <div class="modifier-reroll-item">
                            <span class="modifier-name">${mod.title}</span>
                            <span style="color: #27ae60; font-size: 0.85rem;">+${Math.round((mod.rewardBonus || 0) * 100)}%</span>
                        </div>
                    `).join('')}
                </div>
                <div style="text-align: center; color: #f39c12; font-weight: bold; margin-bottom: 0.75rem;">
                    Reward Multiplier: ${(scroll.itemData?.rewardMultiplier || 1).toFixed(2)}x
                </div>
                <button class="btn btn-primary" id="goToAtlasBtn">
                    Go to Atlas
                </button>
            `;
        }

        scrollActionsEl.innerHTML = html;
        scrollActionsEl.style.display = 'block';

        // Add event listeners
        const goToOracleBtn = document.getElementById('goToOracleBtn');
        if (goToOracleBtn) {
            goToOracleBtn.addEventListener('click', () => {
                // Select this scroll in the oracle and switch to oracle tab
                this.oracleSelectedScrollId = scroll.id;
                this.oracleSelectedScroll = scroll;
                this.switchTab('oracle');
            });
        }

        const goToAtlasBtn = document.getElementById('goToAtlasBtn');
        if (goToAtlasBtn) {
            goToAtlasBtn.addEventListener('click', () => {
                // Store scroll for mission and switch to atlas tab
                this.pendingMissionScroll = scroll;
                this.switchTab('atlas');
                this.showNotification('Select a node to start a mission');
            });
        }
    }

    /**
     * Handle rolling modifiers on a scroll
     */
    handleRollScrollModifiers(scrollId) {
        const result = this.game.call('rollScrollModifiers', scrollId);
        if (result) {
            this.showNotification('Modifiers rolled!');
            this.refreshInventory();
            // Re-select the slot to update the display
            if (this.selectedInventorySlot !== undefined) {
                this.selectInventorySlot(this.selectedInventorySlot);
            }
            this.updateCurrencyDisplay();
        } else {
            this.showNotification('Failed to roll modifiers', 'error');
        }
    }

    /**
     * Handle rerolling a specific modifier
     */
    handleRerollModifier(scrollId, modifierIndex) {
        const result = this.game.call('rerollScrollModifier', scrollId, modifierIndex);
        if (result) {
            this.showNotification('Modifier rerolled!');
            this.refreshInventory();
            // Re-select the slot to update the display
            if (this.selectedInventorySlot !== undefined) {
                this.selectInventorySlot(this.selectedInventorySlot);
            }
            this.updateCurrencyDisplay();
        } else {
            this.showNotification('Cannot afford reroll', 'error');
        }
    }

    /**
     * Handle using an item from inventory
     */
    handleUseItem() {
        if (!this.selectedItem) {
            this.showNotification('No item selected', 'error');
            return;
        }

        switch (this.selectedItem.itemType) {
            case 'missionScroll':
                this.startMissionFromScroll(this.selectedItem);
                break;
            case 'consumable':
                this.showNotification('Consumables can only be used in missions');
                break;
            case 'equipment':
                this.showNotification('Equipment system coming soon');
                break;
            case 'material':
                this.showNotification('Crafting system coming soon');
                break;
            default:
                this.showNotification('Cannot use this item');
        }
    }

    /**
     * Handle discarding an item from inventory
     */
    handleDiscardItem() {
        if (!this.selectedItem) {
            this.showNotification('No item selected', 'error');
            return;
        }

        if (confirm(`Are you sure you want to discard ${this.selectedItem.name}?`)) {
            this.game.call('removeItemFromInventory', this.selectedItem.id);
            this.showNotification('Item discarded');
            this.selectedItem = null;
            this.selectedInventorySlot = undefined;
            this.refreshInventory();

            // Clear item details display
            const titleEl = document.getElementById('selectedItemTitle');
            const descEl = document.getElementById('selectedItemDesc');
            const actionsEl = document.getElementById('itemActions');
            const scrollActionsEl = document.getElementById('scrollActions');

            if (titleEl) titleEl.textContent = 'Select an Item';
            if (descEl) descEl.textContent = 'Click on an item in your inventory to view details.';
            if (actionsEl) actionsEl.style.display = 'none';
            if (scrollActionsEl) scrollActionsEl.style.display = 'none';
        }
    }

    /**
     * Start a mission using a scroll from inventory
     * Note: This is a legacy method - the preferred flow is to apply scroll to a node on the atlas
     * This method is kept for direct scroll usage without a specific node
     */
    startMissionFromScroll(scroll) {
        if (!scroll || scroll.itemType !== 'missionScroll') {
            this.showNotification('Invalid scroll', 'error');
            return;
        }

        // User should apply scroll to a node to start a mission
        this.showNotification('Go to the Atlas and select a node for this mission', 'info');
        this.pendingMissionScroll = scroll;
        this.switchTab('atlas');
    }

    /**
     * Format a cost object for display
     */
    formatCost(cost) {
        const parts = [];
        if (cost.valor) parts.push(`${cost.valor} Valor`);
        if (cost.glory) parts.push(`${cost.glory} Glory`);
        if (cost.essence) parts.push(`${cost.essence} Essence`);
        return parts.join(', ') || 'Free';
    }

    /**
     * Show a notification message
     */
    showNotification(message, type = 'success') {
        // Use existing notification system if available
        if (this.game.call && this.game.hasService && this.game.hasService('showNotification')) {
            this.game.call('showNotification', message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    /**
     * Show campaign mission results after a battle
     * Called from the game scene when a campaign mission ends
     * @param {boolean} victory - Whether the player won
     * @param {Object} stats - Battle statistics
     */
    showCampaignMissionResults(victory, stats = {}) {
        // Get campaign mission info from game state
        const missionInfo = this.game.state.campaignMission;
        const nodeId = missionInfo?.nodeId || this.game.state.skirmishConfig?.missionNodeId;

        // Process mission result through CampaignSystem
        const rewards = this.game.call('processMissionResult', {
            victory,
            nodeId,
            scroll: missionInfo?.scroll || null,
            stats
        });

        // Process any pending loot collected during mission (from monsters)
        let lootRewards = { currencies: {}, items: [] };
        if (this.game.hasService('processPendingLoot')) {
            lootRewards = this.game.call('processPendingLoot');
        }

        // Merge loot currencies with node rewards
        if (rewards && rewards.currencies && lootRewards.currencies) {
            rewards.currencies.valor = (rewards.currencies.valor || 0) + (lootRewards.currencies.valor || 0);
            rewards.currencies.glory = (rewards.currencies.glory || 0) + (lootRewards.currencies.glory || 0);
            rewards.currencies.essence = (rewards.currencies.essence || 0) + (lootRewards.currencies.essence || 0);
        }

        // Add collected items to rewards
        if (rewards) {
            rewards.items = lootRewards.items || [];
        }

        // Store rewards for display when we return to campaign scene
        this.game.state.pendingMissionResults = {
            victory,
            rewards,
            stats,
            nodeId
        };

        // Switch to campaign scene - it will show results screen
        this.game.switchScene('campaign');
    }

    /**
     * Display the mission results screen (called after scene switch)
     */
    displayMissionResults() {
        const results = this.game.state.pendingMissionResults;
        if (!results) {
            this.showHomeBase();
            return;
        }

        // Check if this was a quest completion
        const isQuestComplete = results.rewards?.questComplete;
        const isBossKill = results.rewards?.isBossNode;

        // Update result title
        const titleEl = document.getElementById('missionResultTitle');
        if (titleEl) {
            if (isQuestComplete) {
                titleEl.textContent = 'QUEST COMPLETE!';
                titleEl.className = 'result-title quest-complete';
            } else if (isBossKill) {
                titleEl.textContent = 'BOSS DEFEATED!';
                titleEl.className = 'result-title victory';
            } else {
                titleEl.textContent = results.victory ? 'VICTORY!' : 'DEFEAT';
                titleEl.className = 'result-title ' + (results.victory ? 'victory' : 'defeat');
            }
        }

        // Populate rewards
        const rewardsList = document.getElementById('rewardsList');
        if (rewardsList && results.rewards) {
            rewardsList.innerHTML = '';
            const currencies = results.rewards.currencies || {};

            if (currencies.valor) {
                rewardsList.innerHTML += `<div class="reward-item"><span class="reward-icon">⚔️</span> ${currencies.valor} Valor</div>`;
            }
            if (currencies.glory) {
                rewardsList.innerHTML += `<div class="reward-item"><span class="reward-icon">🏆</span> ${currencies.glory} Glory</div>`;
            }
            if (currencies.essence) {
                rewardsList.innerHTML += `<div class="reward-item essence-reward"><span class="reward-icon">✨</span> ${currencies.essence} Essence</div>`;
            }

            if (results.rewards.nodeCompleted) {
                if (results.rewards.unlockedNodes && results.rewards.unlockedNodes.length > 0) {
                    rewardsList.innerHTML += `<div class="reward-item"><span class="reward-icon">🗺️</span> ${results.rewards.unlockedNodes.length} new path(s) unlocked!</div>`;
                }
            }

            // Show scroll drops
            if (results.rewards.items && results.rewards.items.length > 0) {
                for (const item of results.rewards.items) {
                    if (item.itemType === 'missionScroll') {
                        const rarityColor = item.rarity === 'epic' ? '#9b59b6' :
                                           item.rarity === 'rare' ? '#3498db' :
                                           item.rarity === 'uncommon' ? '#2ecc71' : '#95a5a6';
                        rewardsList.innerHTML += `<div class="reward-item scroll-drop" style="border-left: 3px solid ${rarityColor};"><span class="reward-icon">📜</span> ${item.name}</div>`;
                    }
                }
            }

            if (isQuestComplete) {
                rewardsList.innerHTML += `<div class="reward-item quest-reward"><span class="reward-icon">🎯</span> Quest Complete! A new quest awaits...</div>`;
            }

            if (!currencies.valor && !currencies.glory && !currencies.essence && !results.rewards.nodeCompleted && (!results.rewards.items || results.rewards.items.length === 0)) {
                rewardsList.innerHTML = '<div class="reward-item">No rewards earned</div>';
            }
        }

        // Populate collected items
        const itemsList = document.getElementById('itemsCollectedList');
        if (itemsList && results.rewards && results.rewards.items) {
            itemsList.innerHTML = '';
            const items = results.rewards.items;

            if (items.length > 0) {
                items.forEach(item => {
                    const itemEl = document.createElement('div');
                    itemEl.className = 'collected-item';
                    itemEl.style.borderColor = item.color || '#ffffff';

                    // Determine icon based on item type
                    let icon = '📦';
                    if (item.itemType === 'missionScroll') icon = '📜';
                    else if (item.itemType === 'equipment') icon = '⚔️';
                    else if (item.itemType === 'consumable') icon = '🧪';
                    else if (item.itemType === 'material') icon = '💎';

                    const amountText = item.amount > 1 ? ` x${item.amount}` : '';
                    itemEl.innerHTML = `
                        <span class="item-icon">${icon}</span>
                        <span class="item-name">${item.name || item.itemType}${amountText}</span>
                    `;
                    itemsList.appendChild(itemEl);
                });
            } else {
                itemsList.innerHTML = '<div class="no-items">No items collected</div>';
            }
        }

        // Show/hide items section based on whether we have items
        const itemsSection = document.getElementById('itemsCollectedSection');
        if (itemsSection && results.rewards) {
            const hasItems = results.rewards.items && results.rewards.items.length > 0;
            itemsSection.style.display = hasItems ? 'block' : 'none';
        }

        // Populate battle stats
        const statsList = document.getElementById('battleStatsList');
        if (statsList && results.stats) {
            statsList.innerHTML = '';
            const stats = results.stats;

            if (stats.round !== undefined) {
                statsList.innerHTML += `<div class="stat-item"><span class="stat-label">Rounds:</span> ${stats.round}</div>`;
            }
            if (stats.goldEarned !== undefined) {
                statsList.innerHTML += `<div class="stat-item"><span class="stat-label">Gold Earned:</span> ${stats.goldEarned}</div>`;
            }
            if (stats.unitsDeployed !== undefined) {
                statsList.innerHTML += `<div class="stat-item"><span class="stat-label">Units Deployed:</span> ${stats.unitsDeployed}</div>`;
            }
            if (stats.unitsLost !== undefined) {
                statsList.innerHTML += `<div class="stat-item"><span class="stat-label">Units Lost:</span> ${stats.unitsLost}</div>`;
            }
        }

        // Update continue button text and behavior based on quest state
        const continueBtn = document.getElementById('continueToHomeBtn');
        if (continueBtn) {
            if (isQuestComplete) {
                continueBtn.textContent = 'Start New Quest';
                continueBtn.onclick = () => {
                    // Generate new quest before showing home base
                    this.game.call('generateNewQuest');
                    this.showNotification('A new quest has begun!');
                    this.showHomeBase();
                };
            } else {
                continueBtn.textContent = 'Continue';
                continueBtn.onclick = () => this.showHomeBase();
            }
        }

        // Show the results screen
        this.showScreen('missionResults');

        // Clear pending results
        this.game.state.pendingMissionResults = null;
    }

    /**
     * Return to campaign home base (from mission results or other contexts)
     */
    returnToCampaignHomeBase() {
        const currentScene = this.game.sceneManager?.getCurrentSceneName?.();

        if (currentScene !== 'campaign') {
            // Switch to campaign scene
            this.game.switchScene('campaign');
        } else {
            // Already in campaign scene, show home base
            this.showHomeBase();
        }
    }

    // ==================== COMMANDER TAB ====================

    /**
     * Refresh the Commander tab display
     */
    refreshCommander() {
        this.refreshCommanderTab();
    }

    /**
     * Refresh the commander tab display
     */
    refreshCommanderTab() {
        const campaign = this.game.call('getCampaignState');
        if (!campaign) return;

        // Update commander level and upgrade section
        this.updateCommanderUpgradeSection(campaign);

        // Update quest selection section
        this.updateQuestSelectionSection(campaign);

        // Update campaign status
        const statusEl = document.getElementById('campaignStatusInfo');
        if (statusEl) {
            const quest = this.game.call('getCurrentQuest');
            const progress = this.game.call('getQuestProgress');

            if (quest && progress) {
                statusEl.innerHTML = `
                    <div class="status-row"><span>Active Quest:</span><span>Tier ${quest.tier} (${quest.length})</span></div>
                    <div class="status-row"><span>Nodes Completed:</span><span>${progress.completedNodes} / ${progress.totalNodes}</span></div>
                    <div class="status-row"><span>Quests Completed:</span><span>${campaign.statistics?.questsCompleted || 0}</span></div>
                    <div class="status-row"><span>Missions Won:</span><span>${campaign.statistics?.missionsCompleted || 0}</span></div>
                `;
            } else {
                statusEl.innerHTML = `
                    <div class="status-row"><span>Active Quest:</span><span style="color: #e74c3c;">None - Select a quest below</span></div>
                    <div class="status-row"><span>Quests Completed:</span><span>${campaign.statistics?.questsCompleted || 0}</span></div>
                    <div class="status-row"><span>Missions Won:</span><span>${campaign.statistics?.missionsCompleted || 0}</span></div>
                `;
            }
        }

        // Update scroll inventory
        const inventoryEl = document.getElementById('commanderScrollInventory');
        if (inventoryEl) {
            const items = this.game.call('getInventoryItems') || [];
            const scrolls = items.filter(item => item.itemType === 'missionScroll');

            if (scrolls.length === 0) {
                inventoryEl.innerHTML = '<div class="no-scrolls">No prophecy scrolls. Complete missions to find scrolls!</div>';
            } else {
                inventoryEl.innerHTML = scrolls.map(scroll => {
                    const isSealed = scroll.itemData?.modifiers?.length > 0;
                    const rarityClass = scroll.rarity || 'common';
                    return `
                        <div class="scroll-inventory-item ${rarityClass} ${isSealed ? 'sealed' : ''}">
                            <span class="scroll-icon">${isSealed ? '🔮' : '📜'}</span>
                            <span class="scroll-name">${scroll.name}</span>
                            <span class="scroll-status">${isSealed ? 'Sealed Prophecy' : 'Blank'}</span>
                        </div>
                    `;
                }).join('');
            }
        }
    }

    /**
     * Update the Commander upgrade section
     */
    updateCommanderUpgradeSection(campaign) {
        const upgradeEl = document.getElementById('commanderUpgradeSection');
        if (!upgradeEl) return;

        const commanderLevel = this.game.call('getNpcLevel', 'commander') || 1;
        const upgradeCost = this.game.call('getNpcUpgradeCost', 'commander');
        const canUpgrade = this.game.call('canUpgradeNpc', 'commander');
        const essence = campaign.currencies?.essence || 0;

        let upgradeHtml = `
            <div class="commander-level-display">
                <span class="level-label">Commander Rank</span>
                <span class="level-value">Level ${commanderLevel}</span>
                <span class="level-desc">Unlocks Tier ${commanderLevel} quests</span>
            </div>
        `;

        if (upgradeCost) {
            const costAmount = upgradeCost.essence || 0;
            upgradeHtml += `
                <div class="commander-upgrade-action">
                    <button class="upgrade-btn ${canUpgrade ? '' : 'disabled'}"
                            data-upgrade-commander
                            ${canUpgrade ? '' : 'disabled'}>
                        Upgrade to Level ${commanderLevel + 1}
                        <span class="upgrade-cost">${costAmount} Essence</span>
                    </button>
                    ${!canUpgrade ? `<span class="upgrade-hint">Need ${costAmount - essence} more Essence</span>` : ''}
                </div>
            `;
        } else {
            upgradeHtml += `
                <div class="commander-upgrade-action">
                    <span class="max-level">Maximum Rank Achieved</span>
                </div>
            `;
        }

        upgradeEl.innerHTML = upgradeHtml;

        // Attach event listener to upgrade button
        const upgradeBtn = upgradeEl.querySelector('[data-upgrade-commander]');
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', () => this.upgradeCommander());
        }
    }

    /**
     * Update the quest selection section
     */
    updateQuestSelectionSection(campaign) {
        const questsEl = document.getElementById('questSelectionSection');
        if (!questsEl) return;

        const currentQuest = this.game.call('getCurrentQuest');
        const availableQuests = this.game.call('getAvailableQuests') || [];

        if (currentQuest) {
            // Show current quest info
            questsEl.innerHTML = `
                <div class="current-quest-display">
                    <div class="quest-header">
                        <span class="quest-label">Current Quest</span>
                        <span class="quest-tier">Tier ${currentQuest.tier}</span>
                    </div>
                    <div class="quest-details">
                        <span class="quest-length">${this.capitalizeFirst(currentQuest.length)} Quest</span>
                        <span class="quest-nodes">${Object.keys(currentQuest.nodes).length} nodes</span>
                    </div>
                    <p class="quest-instruction">View your quest map in the Atlas tab.</p>
                </div>
            `;
        } else if (availableQuests.length > 0) {
            // Show quest selection
            const lengthLabels = {
                short: { name: 'Short', desc: '3-4 nodes, quick rewards' },
                medium: { name: 'Medium', desc: '5-6 nodes, balanced' },
                long: { name: 'Long', desc: '7-8 nodes, maximum rewards' }
            };

            questsEl.innerHTML = `
                <div class="quest-selection-header">
                    <span class="quest-selection-label">Choose Your Quest</span>
                    <span class="quest-selection-tier">Tier ${availableQuests[0]?.tier || 1}</span>
                </div>
                <div class="quest-selection-grid">
                    ${availableQuests.map(quest => {
                        const label = lengthLabels[quest.length] || { name: quest.length, desc: '' };
                        const nodeCount = Object.keys(quest.nodes).length;
                        return `
                            <div class="quest-option" data-quest-id="${quest.id}">
                                <div class="quest-option-header">${label.name}</div>
                                <div class="quest-option-nodes">${nodeCount} nodes</div>
                                <div class="quest-option-desc">${label.desc}</div>
                                <button class="quest-select-btn" data-select-quest="${quest.id}">
                                    Start Quest
                                </button>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            // Attach event listeners to quest select buttons
            questsEl.querySelectorAll('.quest-select-btn[data-select-quest]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const questId = e.target.dataset.selectQuest;
                    this.selectQuest(questId);
                });
            });
        } else {
            questsEl.innerHTML = `
                <div class="no-quests-available">
                    <p>No quests available.</p>
                </div>
            `;
        }
    }

    /**
     * Capitalize first letter of a string
     */
    capitalizeFirst(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Handle Commander upgrade button
     */
    upgradeCommander() {
        const result = this.game.call('upgradeNpc', 'commander');
        if (result.success) {
            this.showNotification(`Commander upgraded to Level ${result.newLevel}!`, 'success');
            this.updateCurrencyDisplay();
            this.refreshCommanderTab();
        } else {
            this.showNotification(result.error || 'Upgrade failed', 'error');
        }
    }

    /**
     * Handle quest selection
     */
    selectQuest(questId) {
        const quest = this.game.call('selectQuest', questId);
        if (quest) {
            this.showNotification(`${this.capitalizeFirst(quest.length)} quest started!`, 'success');
            this.refreshCommanderTab();
            this.refreshAtlas();
        } else {
            this.showNotification('Failed to select quest', 'error');
        }
    }

    /**
     * Get tier color for scrolls
     */
    getTierColorForScroll(tier) {
        const colors = {
            1: '#ffffff',
            2: '#1eff00',
            3: '#0070dd',
            4: '#a335ee',
            5: '#ff8000'
        };
        return colors[tier] || colors[1];
    }

    // ==================== ORACLE TAB ====================

    /**
     * Refresh the Oracle tab display
     */
    refreshOracle() {
        // Check if player has enough tarot cards to use the Oracle
        const collectedCards = this.game.call('getCollectedTarotCards') || [];
        const oracleContainer = document.querySelector('.oracle-container');
        const oracleLockedOverlay = document.getElementById('oracleLockedOverlay');

        if (collectedCards.length < 3) {
            // Oracle is locked - show locked state
            this.showOracleLockedState(collectedCards.length);
            return;
        }

        // Oracle is unlocked - hide locked overlay if it exists
        if (oracleLockedOverlay) {
            oracleLockedOverlay.style.display = 'none';
        }
        if (oracleContainer) {
            oracleContainer.classList.remove('locked');
        }

        this.refreshOracleScrollsList();
        this.updateOracleDisplay();
        this.updateOracleUpgradeSection();
        this.updateTarotCollectionDisplay();
    }

    /**
     * Show the Oracle locked state
     */
    showOracleLockedState(currentCards) {
        const oracleContainer = document.querySelector('.oracle-container');
        let lockedOverlay = document.getElementById('oracleLockedOverlay');

        if (!lockedOverlay && oracleContainer) {
            // Create locked overlay
            lockedOverlay = document.createElement('div');
            lockedOverlay.id = 'oracleLockedOverlay';
            lockedOverlay.className = 'oracle-locked-overlay';
            oracleContainer.appendChild(lockedOverlay);
        }

        if (lockedOverlay) {
            lockedOverlay.style.display = 'flex';
            lockedOverlay.innerHTML = `
                <div class="oracle-locked-content">
                    <div class="oracle-locked-icon">🔮</div>
                    <h3>The Oracle Awaits</h3>
                    <p>The Oracle requires a connection to the mystical realm.</p>
                    <p>Collect <strong>3 Tarot Cards</strong> to unlock her powers.</p>
                    <div class="oracle-locked-progress">
                        <span class="progress-text">${currentCards} / 3 Cards Collected</span>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${(currentCards / 3) * 100}%"></div>
                        </div>
                    </div>
                    <p class="oracle-locked-hint">Tarot cards drop from missions and can be purchased with Essence.</p>
                </div>
            `;
        }

        if (oracleContainer) {
            oracleContainer.classList.add('locked');
        }
    }

    /**
     * Update the Oracle upgrade section (specialization tree)
     */
    updateOracleUpgradeSection() {
        const upgradeSection = document.getElementById('oracleUpgradeSection');
        if (!upgradeSection) return;

        const pastLevel = this.game.call('getNpcLevel', 'oracle.past') || 0;
        const presentLevel = this.game.call('getNpcLevel', 'oracle.present') || 0;
        const futureLevel = this.game.call('getNpcLevel', 'oracle.future') || 0;

        const pastCost = this.game.call('getNpcUpgradeCost', 'oracle.past');
        const presentCost = this.game.call('getNpcUpgradeCost', 'oracle.present');
        const futureCost = this.game.call('getNpcUpgradeCost', 'oracle.future');

        const canUpgradePast = this.game.call('canUpgradeNpc', 'oracle.past');
        const canUpgradePresent = this.game.call('canUpgradeNpc', 'oracle.present');
        const canUpgradeFuture = this.game.call('canUpgradeNpc', 'oracle.future');

        const branchDescriptions = {
            past: [
                'Not started',
                'Past card effects +25% stronger',
                'Past card effects +50% stronger',
                'Draw 2 Past cards, choose 1'
            ],
            present: [
                'Not started',
                'Present penalties reduced by 25%',
                'Present penalties reduced by 50%',
                'Reroll Present card for free once'
            ],
            future: [
                'Not started',
                'Future reward bonuses +25%',
                'Future reward bonuses +50%',
                'Guaranteed rare item from Future'
            ]
        };

        upgradeSection.innerHTML = `
            <h4>Oracle Specialization</h4>
            <div class="oracle-upgrade-grid">
                ${this.renderOracleBranch('past', 'Past Branch', pastLevel, pastCost, canUpgradePast, branchDescriptions.past, '#3498db')}
                ${this.renderOracleBranch('present', 'Present Branch', presentLevel, presentCost, canUpgradePresent, branchDescriptions.present, '#9b59b6')}
                ${this.renderOracleBranch('future', 'Future Branch', futureLevel, futureCost, canUpgradeFuture, branchDescriptions.future, '#f39c12')}
            </div>
        `;

        // Attach event listeners to oracle upgrade buttons
        upgradeSection.querySelectorAll('[data-upgrade-oracle-branch]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const branchId = e.target.dataset.upgradeOracleBranch;
                this.upgradeOracleBranch(branchId);
            });
        });
    }

    /**
     * Render an Oracle upgrade branch
     */
    renderOracleBranch(branchId, name, level, cost, canUpgrade, descriptions, color) {
        const maxLevel = 3;
        const pips = Array(maxLevel).fill(0).map((_, i) => i < level ? 'filled' : 'empty').join('');

        let upgradeButton = '';
        if (cost) {
            const costAmount = cost.essence || 0;
            upgradeButton = `
                <button class="oracle-branch-upgrade ${canUpgrade ? '' : 'disabled'}"
                        data-upgrade-oracle-branch="${branchId}"
                        ${canUpgrade ? '' : 'disabled'}>
                    Upgrade (${costAmount} Essence)
                </button>
            `;
        } else {
            upgradeButton = '<span class="oracle-branch-maxed">Maxed</span>';
        }

        return `
            <div class="oracle-branch" style="--branch-color: ${color}">
                <div class="oracle-branch-header">${name}</div>
                <div class="oracle-branch-level">
                    ${Array(maxLevel).fill(0).map((_, i) =>
                        `<span class="level-pip ${i < level ? 'filled' : 'empty'}"></span>`
                    ).join('')}
                </div>
                <div class="oracle-branch-desc">${descriptions[level]}</div>
                ${upgradeButton}
            </div>
        `;
    }

    /**
     * Handle Oracle branch upgrade
     */
    upgradeOracleBranch(branchId) {
        const result = this.game.call('upgradeNpc', `oracle.${branchId}`);
        if (result.success) {
            this.showNotification(`Oracle ${branchId} upgraded to level ${result.newLevel}!`, 'success');
            this.updateCurrencyDisplay();
            this.refreshOracle();
        } else {
            this.showNotification(result.error || 'Upgrade failed', 'error');
        }
    }

    /**
     * Get the URL for a texture from the textures collection
     * @param {string} textureId - The texture ID to look up
     * @returns {string} The texture URL or empty string if not found
     */
    getTextureUrl(textureId) {
        if (!textureId) return '';
        const texture = this.collections?.textures?.[textureId];
        if (texture && texture.imagePath) {
            const resourcesPath = this.game.app?.getResourcesPath?.() || './resources/';
            return `${resourcesPath}${texture.imagePath}`;
        }
        return '';
    }

    /**
     * Update the tarot card collection display
     */
    updateTarotCollectionDisplay() {
        const collectionSection = document.getElementById('tarotCollectionSection');
        if (!collectionSection) return;

        const collectedCards = this.game.call('getCollectedTarotCards') || [];
        const tarotCards = this.collections?.tarotCards || {};
        const allCardIds = Object.keys(tarotCards).sort((a, b) =>
            (tarotCards[a].number || 0) - (tarotCards[b].number || 0)
        );

        collectionSection.innerHTML = `
            <h4>Tarot Collection (${collectedCards.length}/${allCardIds.length})</h4>
            <div class="tarot-collection-grid">
                ${allCardIds.map(cardId => {
                    const card = tarotCards[cardId];
                    const isCollected = collectedCards.includes(cardId);
                    const textureUrl = isCollected ? this.getTextureUrl(card.texture) : '';
                    return `
                        <div class="tarot-collection-card ${isCollected ? 'collected' : 'locked'}"
                             title="${isCollected ? card.title : '???'}"
                             ${isCollected ? `data-view-tarot="${cardId}"` : ''}>
                            ${isCollected && textureUrl ?
                                `<img src="${textureUrl}" alt="${card.title}" class="card-texture" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                                 <div class="card-fallback" style="display:none;">
                                    <span class="card-number">${card.number}</span>
                                    <span class="card-name">${card.title}</span>
                                 </div>` :
                                isCollected ?
                                    `<span class="card-number">${card.number}</span>
                                     <span class="card-name">${card.title}</span>` :
                                    `<span class="card-number">${card.number}</span>
                                     <span class="card-locked">?</span>`
                            }
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="tarot-purchase-section">
                <h4>Purchase Cards</h4>
                <p class="purchase-hint">Spend Essence to add cards to your collection.</p>
                <div id="tarotPurchaseList" class="tarot-purchase-list">
                    ${this.renderTarotPurchaseList()}
                </div>
            </div>
        `;

        // Attach event listeners to view collected cards
        collectionSection.querySelectorAll('[data-view-tarot]').forEach(card => {
            card.addEventListener('click', (e) => {
                const cardId = card.dataset.viewTarot;
                this.showTarotCardModal(cardId);
            });
        });

        // Attach event listeners to purchase buttons
        collectionSection.querySelectorAll('[data-purchase-tarot]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const cardId = e.target.dataset.purchaseTarot;
                this.purchaseTarotCard(cardId);
            });
        });
    }

    /**
     * Show a modal with a tarot card in high resolution
     * @param {string} cardId - The tarot card ID to display
     */
    showTarotCardModal(cardId) {
        const tarotCards = this.collections?.tarotCards || {};
        const card = tarotCards[cardId];
        if (!card) return;

        const textureUrl = this.getTextureUrl(card.texture);

        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'tarot-card-modal';
        modal.innerHTML = `
            <div class="tarot-modal-backdrop"></div>
            <div class="tarot-modal-content">
                <div class="tarot-modal-card">
                    ${textureUrl ?
                        `<img src="${textureUrl}" alt="${card.title}" class="tarot-modal-image">` :
                        `<div class="tarot-modal-placeholder">
                            <span class="card-number">${card.number}</span>
                            <span class="card-title">${card.title}</span>
                        </div>`
                    }
                </div>
                <div class="tarot-modal-info">
                    <h3>${card.number}. ${card.title}</h3>
                    <div class="tarot-modal-readings">
                        <div class="reading-section">
                            <h4>Past (Player Buffs)</h4>
                            <p><strong>Upright - ${card.past?.upright?.name}:</strong> ${card.past?.upright?.description}</p>
                            <p><strong>Reversed - ${card.past?.reversed?.name}:</strong> ${card.past?.reversed?.description}</p>
                        </div>
                        <div class="reading-section">
                            <h4>Present (Mission Modifiers)</h4>
                            <p><strong>Upright - ${card.present?.upright?.name}:</strong> ${card.present?.upright?.description}</p>
                            <p><strong>Reversed - ${card.present?.reversed?.name}:</strong> ${card.present?.reversed?.description}</p>
                        </div>
                        <div class="reading-section">
                            <h4>Future (Rewards)</h4>
                            <p><strong>Upright - ${card.future?.upright?.name}:</strong> ${card.future?.upright?.description}</p>
                            <p><strong>Reversed - ${card.future?.reversed?.name}:</strong> ${card.future?.reversed?.description}</p>
                        </div>
                    </div>
                </div>
                <button class="tarot-modal-close">&times;</button>
            </div>
        `;

        document.body.appendChild(modal);

        // Close modal on backdrop click or close button
        modal.querySelector('.tarot-modal-backdrop').addEventListener('click', () => {
            modal.remove();
        });
        modal.querySelector('.tarot-modal-close').addEventListener('click', () => {
            modal.remove();
        });

        // Close on Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    /**
     * Render the list of tarot cards available for purchase
     */
    renderTarotPurchaseList() {
        const uncollectedCards = this.game.call('getUncollectedTarotCards') || [];

        if (uncollectedCards.length === 0) {
            return '<div class="all-cards-collected">All tarot cards collected!</div>';
        }

        // Show first 5 uncollected cards
        const displayCards = uncollectedCards.slice(0, 5);

        return displayCards.map(card => {
            const canAfford = this.game.call('canPurchaseTarotCard', card.id);
            return `
                <div class="tarot-purchase-item ${canAfford ? '' : 'cannot-afford'}">
                    <span class="purchase-card-number">${card.number}</span>
                    <span class="purchase-card-title">${card.title}</span>
                    <button class="purchase-card-btn ${canAfford ? '' : 'disabled'}"
                            data-purchase-tarot="${card.id}"
                            ${canAfford ? '' : 'disabled'}>
                        ${card.cost.essence} Essence
                    </button>
                </div>
            `;
        }).join('');
    }

    /**
     * Handle tarot card purchase
     */
    purchaseTarotCard(cardId) {
        const result = this.game.call('purchaseTarotCard', cardId);
        if (result.success) {
            const tarotCards = this.collections?.tarotCards || {};
            const card = tarotCards[cardId];
            this.showNotification(`Collected: ${card?.title || 'Tarot Card'}!`, 'success');
            this.updateCurrencyDisplay();
            this.refreshOracle();
        } else {
            this.showNotification(result.error || 'Purchase failed', 'error');
        }
    }

    /**
     * Refresh the list of scrolls in the Oracle panel
     */
    refreshOracleScrollsList() {
        const scrollsList = document.getElementById('oracleScrollsList');
        if (!scrollsList) return;

        const items = this.game.call('getInventoryItems') || [];
        const scrolls = items.filter(item => item.itemType === 'missionScroll');

        if (scrolls.length === 0) {
            scrollsList.innerHTML = '<div class="no-scrolls">No scrolls in inventory.<br>Complete missions to find prophecy scrolls.</div>';
            return;
        }

        scrollsList.innerHTML = scrolls.map(scroll => {
            const hasProphecy = scroll.itemData?.modifiers?.length > 0;
            const isSealed = scroll.itemData?.isSealed;
            const tier = scroll.itemData?.tier || scroll.tier || 1;
            const rarity = scroll.rarity || 'common';
            const rarityColor = rarity === 'epic' ? '#9b59b6' :
                               rarity === 'rare' ? '#3498db' :
                               rarity === 'uncommon' ? '#2ecc71' : '#95a5a6';

            let status = 'Blank - needs prophecy';
            if (hasProphecy && isSealed) {
                status = `Sealed (${scroll.itemData.modifiers.length} modifiers)`;
            } else if (hasProphecy) {
                status = `Prophecy revealed (${scroll.itemData.modifiers.length} modifiers)`;
            }

            return `
                <div class="oracle-scroll-item ${hasProphecy ? 'has-prophecy' : ''} ${this.oracleSelectedScrollId === scroll.id ? 'selected' : ''}"
                     data-scroll-id="${scroll.id}">
                    <span class="scroll-item-icon">📜</span>
                    <div class="scroll-item-info">
                        <div class="scroll-item-name" style="color: ${rarityColor};">${scroll.name || 'Prophecy Scroll'}</div>
                        <div class="scroll-item-tier" style="font-size: 0.8rem; color: rgba(255,255,255,0.6);">Tier ${tier}</div>
                        <div class="scroll-item-status">${status}</div>
                    </div>
                </div>
            `;
        }).join('');

        // Add click handlers
        scrollsList.querySelectorAll('.oracle-scroll-item').forEach(item => {
            item.addEventListener('click', () => {
                const scrollId = item.dataset.scrollId;
                this.selectScrollForOracle(scrollId);
            });
        });
    }

    /**
     * Select a scroll to place on the Oracle's altar
     */
    selectScrollForOracle(scrollId) {
        const items = this.game.call('getInventoryItems') || [];
        const scroll = items.find(item => item.id === scrollId);

        if (!scroll) {
            this.showNotification('Scroll not found', 'error');
            return;
        }

        this.oracleSelectedScrollId = scrollId;
        this.oracleSelectedScroll = scroll;

        this.refreshOracleScrollsList();
        this.updateOracleDisplay();
    }

    /**
     * Update the Oracle altar display based on selected scroll
     */
    updateOracleDisplay() {
        const scrollSlot = document.getElementById('oracleScrollSlot');
        const prophecyDisplay = document.getElementById('prophecyDisplay');
        const oracleActions = document.getElementById('oracleActions');
        const readProphecyBtn = document.getElementById('readProphecyBtn');
        const rerollProphecyBtn = document.getElementById('rerollProphecyBtn');
        const sealProphecyBtn = document.getElementById('sealProphecyBtn');

        if (!scrollSlot) return;

        const scroll = this.oracleSelectedScroll;

        if (!scroll) {
            // No scroll selected - show empty state
            scrollSlot.className = 'oracle-scroll-slot empty';
            scrollSlot.innerHTML = '<span class="slot-hint">Place a scroll here</span>';
            if (prophecyDisplay) prophecyDisplay.style.display = 'none';
            if (oracleActions) oracleActions.style.display = 'none';
            return;
        }

        // Show scroll in slot
        const tier = scroll.itemData?.tier || scroll.tier || 1;
        const rarity = scroll.rarity || 'common';
        const rarityColor = rarity === 'epic' ? '#9b59b6' :
                           rarity === 'rare' ? '#3498db' :
                           rarity === 'uncommon' ? '#2ecc71' : '#95a5a6';

        scrollSlot.className = 'oracle-scroll-slot filled';
        scrollSlot.innerHTML = `
            <span class="scroll-icon">📜</span>
            <span class="scroll-name" style="color: ${rarityColor};">${scroll.name || 'Prophecy Scroll'}</span>
            <span class="scroll-tier">Tier ${tier}</span>
        `;

        // Show actions
        if (oracleActions) oracleActions.style.display = 'flex';

        const hasProphecy = scroll.itemData?.modifiers?.length > 0;
        const isSealed = scroll.itemData?.isSealed;

        if (!hasProphecy) {
            // No prophecy yet - show "Read Prophecy" button with cost
            if (readProphecyBtn) {
                readProphecyBtn.style.display = 'block';
                const prophecyCost = this.calculateProphecyCost(scroll);
                const prophecyCostEl = document.getElementById('prophecyCost');
                if (prophecyCostEl) prophecyCostEl.textContent = prophecyCost;

                // Disable if can't afford
                const canAfford = this.game.call('canAfford', { valor: prophecyCost });
                readProphecyBtn.disabled = !canAfford;
                readProphecyBtn.classList.toggle('btn-disabled', !canAfford);
            }
            if (rerollProphecyBtn) rerollProphecyBtn.style.display = 'none';
            if (sealProphecyBtn) sealProphecyBtn.style.display = 'none';
            if (prophecyDisplay) prophecyDisplay.style.display = 'none';
        } else if (isSealed) {
            // Prophecy is sealed - show it but no editing
            if (readProphecyBtn) readProphecyBtn.style.display = 'none';
            if (rerollProphecyBtn) rerollProphecyBtn.style.display = 'none';
            if (sealProphecyBtn) sealProphecyBtn.style.display = 'none';
            this.displayProphecy(scroll);
        } else {
            // Prophecy revealed but not sealed - can reroll or seal
            if (readProphecyBtn) readProphecyBtn.style.display = 'none';
            if (rerollProphecyBtn) {
                rerollProphecyBtn.style.display = 'block';
                const rerollCost = this.calculateRerollCost(scroll);
                const rerollCostEl = document.getElementById('rerollCost');
                if (rerollCostEl) rerollCostEl.textContent = rerollCost;

                // Disable if can't afford
                const canAfford = this.game.call('canAfford', { valor: rerollCost });
                rerollProphecyBtn.disabled = !canAfford;
                rerollProphecyBtn.classList.toggle('btn-disabled', !canAfford);
            }
            if (sealProphecyBtn) sealProphecyBtn.style.display = 'block';
            this.displayProphecy(scroll);
        }
    }

    /**
     * Display the prophecy (tarot reading) for a scroll
     */
    displayProphecy(scroll) {
        const prophecyDisplay = document.getElementById('prophecyDisplay');
        const prophecyModifiers = document.getElementById('prophecyModifiers');
        const prophecyRewardMultiplier = document.getElementById('prophecyRewardMultiplier');

        if (!prophecyDisplay || !prophecyModifiers) return;

        prophecyDisplay.style.display = 'block';

        const modifiers = scroll.itemData?.modifiers || [];
        const tarotReading = scroll.itemData?.tarotReading || [];

        if (modifiers.length === 0) {
            prophecyModifiers.innerHTML = '<div class="no-prophecy">No prophecy has been revealed</div>';
            if (prophecyRewardMultiplier) prophecyRewardMultiplier.textContent = '1.00x';
            return;
        }

        // Display tarot cards in a 3-card spread layout
        const positionLabels = { past: 'Past', present: 'Present', future: 'Future' };

        prophecyModifiers.innerHTML = `
            <div class="tarot-spread">
                ${modifiers.map((mod, index) => {
                    const position = mod.position || (index === 0 ? 'past' : (index === 1 ? 'present' : 'future'));
                    const texturePath = this.getTextureUrl(mod.texture);
                    const cardClass = mod.isReversed ? 'tarot-card reversed' : 'tarot-card';

                    return `
                        <div class="tarot-card-slot" data-position="${position}">
                            <div class="position-label">${positionLabels[position] || position}</div>
                            <div class="${cardClass}" style="${texturePath ? `background-image: url('${texturePath}')` : ''}">
                                ${!texturePath ? `<div class="card-placeholder">${mod.title?.split(' ')[1] || '?'}</div>` : ''}
                                ${mod.isReversed ? '<div class="reversed-indicator">Reversed</div>' : ''}
                            </div>
                            <div class="card-info">
                                <div class="card-name">${mod.title || 'Unknown'}</div>
                                <div class="card-meaning">${mod.subtitle || ''}</div>
                                <div class="card-effect">${mod.description || ''}</div>
                                <div class="card-bonus" style="color: ${(mod.rewardBonus || 0) >= 0 ? '#27ae60' : '#e74c3c'}">
                                    ${(mod.rewardBonus || 0) >= 0 ? '+' : ''}${Math.round((mod.rewardBonus || 0) * 100)}% Reward
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        // Calculate total reward multiplier
        const rewardMultiplier = scroll.itemData?.rewardMultiplier || 1;
        if (prophecyRewardMultiplier) {
            prophecyRewardMultiplier.textContent = rewardMultiplier.toFixed(2) + 'x';
        }
    }

    /**
     * Calculate the cost to read a prophecy (first time)
     */
    calculateProphecyCost(scroll) {
        const tier = scroll.itemData?.tier || 1;
        const baseCost = 5; // Base cost to read a prophecy
        return Math.floor(baseCost * tier);
    }

    /**
     * Calculate the cost to reroll a prophecy
     */
    calculateRerollCost(scroll) {
        const tier = scroll.itemData?.tier || 1;
        const timesRolled = scroll.itemData?.timesRolled || 0;
        const baseCost = 10;
        return Math.floor(baseCost * tier * (1 + timesRolled * 0.5));
    }

    /**
     * Handle "Read Prophecy" button - roll modifiers for the first time
     */
    handleReadProphecy() {
        const scroll = this.oracleSelectedScroll;
        if (!scroll) {
            this.showNotification('No scroll selected', 'error');
            return;
        }

        // Check and deduct cost
        const cost = this.calculateProphecyCost(scroll);
        if (!this.game.call('canAfford', { valor: cost })) {
            this.showNotification('Not enough Valor', 'error');
            return;
        }

        // Deduct cost
        this.game.call('deductCurrency', 'valor', cost);

        // Roll modifiers for the scroll
        const result = this.game.call('rollScrollModifiers', scroll.id);
        if (!result || !result.success) {
            // Refund on failure
            this.game.call('addCurrency', 'valor', cost);
            this.showNotification(result?.error || 'Failed to read prophecy', 'error');
            return;
        }

        // Update our cached scroll with new data
        const items = this.game.call('getInventoryItems') || [];
        this.oracleSelectedScroll = items.find(item => item.id === scroll.id);

        this.showNotification('The Oracle reveals the prophecy...');
        this.updateCurrencyDisplay();
        this.updateOracleDisplay();
        this.refreshOracleScrollsList();
    }

    /**
     * Handle "Reroll Prophecy" button - pay valor to reroll all modifiers
     */
    handleRerollProphecy() {
        const scroll = this.oracleSelectedScroll;
        if (!scroll) {
            this.showNotification('No scroll selected', 'error');
            return;
        }

        const cost = this.calculateRerollCost(scroll);
        if (!this.game.call('canAfford', { valor: cost })) {
            this.showNotification('Not enough Valor', 'error');
            return;
        }

        // Deduct cost
        this.game.call('deductCurrency', 'valor', cost);

        // Reroll modifiers
        const result = this.game.call('rollScrollModifiers', scroll.id);
        if (!result || !result.success) {
            this.showNotification(result?.error || 'Failed to reroll prophecy', 'error');
            return;
        }

        // Update our cached scroll with new data
        const items = this.game.call('getInventoryItems') || [];
        this.oracleSelectedScroll = items.find(item => item.id === scroll.id);

        this.showNotification('The Oracle reveals a new prophecy...');
        this.updateCurrencyDisplay();
        this.updateOracleDisplay();
        this.refreshOracleScrollsList();
    }

    /**
     * Handle "Seal Prophecy" button - lock in the current modifiers
     */
    handleSealProphecy() {
        const scroll = this.oracleSelectedScroll;
        if (!scroll) {
            this.showNotification('No scroll selected', 'error');
            return;
        }

        // Seal the scroll (mark modifiers as permanent)
        const result = this.game.call('sealScrollProphecy', scroll.id);
        if (!result || !result.success) {
            this.showNotification(result?.error || 'Failed to seal prophecy', 'error');
            return;
        }

        // Update our cached scroll with new data
        const items = this.game.call('getInventoryItems') || [];
        this.oracleSelectedScroll = items.find(item => item.id === scroll.id);

        this.showNotification('The prophecy has been sealed!');
        this.updateOracleDisplay();
        this.refreshOracleScrollsList();
    }

    /**
     * Handle removing scroll from oracle altar
     */
    handleRemoveScrollFromOracle() {
        this.oracleSelectedScrollId = null;
        this.oracleSelectedScroll = null;
        this.refreshOracleScrollsList();
        this.updateOracleDisplay();
    }

    onSceneUnload() {
        // Clean up ResizeObserver
        if (this.atlasResizeObserver) {
            this.atlasResizeObserver.disconnect();
            this.atlasResizeObserver = null;
        }

        this.atlasCanvas = null;
        this.atlasCtx = null;
        this.selectedNode = null;
        this.atlasInitialized = false;
    }
}
