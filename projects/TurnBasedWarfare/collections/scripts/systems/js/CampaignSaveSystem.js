/**
 * CampaignSaveSystem - Handles campaign profile persistence via localStorage.
 *
 * This system manages:
 * - Campaign profile creation, loading, deletion
 * - Campaign state persistence (currencies, unlocks, atlas progress)
 * - Campaign index for listing available profiles
 * - Export/import functionality
 *
 * Campaign data is stored separately from in-battle saves:
 * - Campaign saves: tbw_campaign_{uuid}
 * - Campaign index: tbw_campaign_index
 */
class CampaignSaveSystem extends GUTS.BaseSystem {
    static services = [
        'createCampaign',
        'loadCampaign',
        'saveCampaign',
        'deleteCampaign',
        'listCampaigns',
        'getCampaignData',
        'exportCampaign',
        'importCampaign',
        'generateCampaignId',
        'generateNewQuest',
        'generateAvailableQuests',
        'selectQuest',
        'getCurrentQuest',
        'getQuestNodes',
        'isQuestNodeUnlocked',
        'isQuestNodeCompleted',
        'completeQuestNode',
        'isQuestComplete',
        'getQuestProgress'
    ];

    constructor(game) {
        super(game);
        this.game.campaignSaveSystem = this;

        // Save format version for compatibility
        this.SAVE_VERSION = 1;

        // localStorage key prefixes
        this.CAMPAIGN_PREFIX = 'tbw_campaign_';
        this.INDEX_KEY = 'tbw_campaign_index';

        // Currently loaded campaign data
        this.currentCampaign = null;
    }

    init() {
        // Check if we need to restore campaign from game.state (after scene reload)
        this.restoreCampaignIfNeeded();
    }

    /**
     * Check if we have an active campaign ID stored in game.state and reload it
     * This handles the case where we return to campaign scene after a mission
     */
    restoreCampaignIfNeeded() {
        const campaignId = this.game.state.activeCampaignId;
        if (campaignId && !this.currentCampaign) {
            console.log('[CampaignSaveSystem] Restoring campaign from game.state:', campaignId);
            this.loadCampaign(campaignId);
        }
    }

    /**
     * Generate a unique campaign ID
     * @returns {string} UUID-like identifier
     */
    generateCampaignId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Create a new campaign profile
     * @param {string} commanderName - Player's chosen name
     * @returns {Object} The new campaign data
     */
    createCampaign(commanderName = 'Commander') {
        const campaignId = this.generateCampaignId();
        const timestamp = Date.now();

        // Get default starting unlocks
        const defaultUnlocks = this.getDefaultUnlocks();

        const campaignData = {
            // Metadata
            version: this.SAVE_VERSION,
            campaignId: campaignId,
            commanderName: commanderName,
            createdAt: timestamp,
            lastPlayedAt: timestamp,

            // Atlas progression (legacy - keeping for compatibility)
            atlas: {
                unlockedNodes: ['node_001'], // Start with first node unlocked
                completedNodes: [],
                currentTier: 1,
                furthestNode: 'node_001'
            },

            // Quest system - player selects from available quests
            currentQuest: null,      // Active quest (or null if none selected)
            availableQuests: [],     // 3 quests to choose from (short/medium/long)

            // NPC upgrade levels
            npcLevels: {
                commander: 1,        // 1-5, determines quest tier
                oracle: {
                    past: 0,         // 0-3, enhances past card effects
                    present: 0,      // 0-3, reduces present penalties
                    future: 0        // 0-3, boosts future rewards
                }
            },

            // Collected tarot cards (need 3+ to use Oracle)
            collectedTarotCards: [],

            // Currencies (tiered system)
            currencies: {
                valor: 0,      // Common - earned from all missions
                glory: 0,      // Rare - earned from harder missions
                essence: 0     // Epic - earned from boss/special nodes
            },

            // Commander inventory (slot-based)
            inventory: {
                maxSlots: 20,
                items: []
            },

            // Unlocked content
            unlocks: defaultUnlocks,

            // Permanent upgrades purchased
            permanentUpgrades: {
                startingGold: 0,
                unitDamage: 0,
                unitHealth: 0,
                buildingHealth: 0,
                inventorySlots: 0,
                missionRewards: 0
            },

            // Statistics
            statistics: {
                missionsCompleted: 0,
                missionsFailed: 0,
                questsCompleted: 0,
                totalBattleTime: 0,
                unitsKilled: 0,
                unitsLost: 0,
                goldEarned: 0,
                scrollsUsed: 0,
                tarotCardsCollected: 0
            }
        };

        // Generate initial available quests (3 quests at tier 1)
        campaignData.availableQuests = this.generateAvailableQuests(1);

        // Save to localStorage
        this.saveCampaignData(campaignId, campaignData);

        // Update index
        this.updateCampaignIndex(campaignId, commanderName, timestamp);

        // Set as current campaign
        this.currentCampaign = campaignData;

        // Store campaign ID in game.state so it persists across scene changes
        this.game.state.activeCampaignId = campaignId;

        console.log('[CampaignSaveSystem] Created new campaign:', campaignId, 'for', commanderName);

        return campaignData;
    }

    /**
     * Get default unlocks for a new campaign
     * @returns {Object} Default unlocks
     */
    getDefaultUnlocks() {
        return {
            // Tier 1 base units available from start
            units: [
                '1_s_barbarian',
                '1_sd_soldier',
                '1_d_archer',
                '1_i_apprentice',
                '1_is_acolyte',
                '1_di_scout'
            ],
            // Basic buildings available from start
            buildings: [
                'townHall',
                'barracks',
                'fletchersHall',
                'mageTower',
                'cottage'
            ],
            // No upgrades unlocked initially
            upgrades: []
        };
    }

    /**
     * Load a campaign by ID
     * @param {string} campaignId - Campaign ID to load
     * @returns {Object|null} Campaign data or null if not found
     */
    loadCampaign(campaignId) {
        const key = this.CAMPAIGN_PREFIX + campaignId;
        const saveJson = localStorage.getItem(key);

        if (!saveJson) {
            console.warn('[CampaignSaveSystem] Campaign not found:', campaignId);
            return null;
        }

        try {
            const campaignData = JSON.parse(saveJson);

            // Version check
            if (campaignData.version !== this.SAVE_VERSION) {
                console.warn('[CampaignSaveSystem] Campaign version mismatch, may need migration');
                // Future: Add migration logic here
            }

            // Update last played timestamp
            campaignData.lastPlayedAt = Date.now();
            this.saveCampaignData(campaignId, campaignData);

            // Set as current campaign
            this.currentCampaign = campaignData;

            // Store campaign ID in game.state so it persists across scene changes
            this.game.state.activeCampaignId = campaignId;

            console.log('[CampaignSaveSystem] Loaded campaign:', campaignId);

            return campaignData;
        } catch (error) {
            console.error('[CampaignSaveSystem] Error loading campaign:', error);
            return null;
        }
    }

    /**
     * Save the current campaign state
     * @returns {boolean} Success status
     */
    saveCampaign() {
        if (!this.currentCampaign) {
            console.warn('[CampaignSaveSystem] No campaign loaded to save');
            return false;
        }

        this.currentCampaign.lastPlayedAt = Date.now();
        this.saveCampaignData(this.currentCampaign.campaignId, this.currentCampaign);

        // Update index with new timestamp
        this.updateCampaignIndex(
            this.currentCampaign.campaignId,
            this.currentCampaign.commanderName,
            this.currentCampaign.lastPlayedAt
        );

        console.log('[CampaignSaveSystem] Saved campaign:', this.currentCampaign.campaignId);
        return true;
    }

    /**
     * Save campaign data to localStorage
     * @param {string} campaignId - Campaign ID
     * @param {Object} data - Campaign data to save
     */
    saveCampaignData(campaignId, data) {
        const key = this.CAMPAIGN_PREFIX + campaignId;
        localStorage.setItem(key, JSON.stringify(data));
    }

    /**
     * Delete a campaign
     * @param {string} campaignId - Campaign ID to delete
     */
    deleteCampaign(campaignId) {
        const key = this.CAMPAIGN_PREFIX + campaignId;
        localStorage.removeItem(key);

        // Update index
        this.removeCampaignFromIndex(campaignId);

        // Clear current if it was the deleted one
        if (this.currentCampaign && this.currentCampaign.campaignId === campaignId) {
            this.currentCampaign = null;
        }

        console.log('[CampaignSaveSystem] Deleted campaign:', campaignId);
    }

    /**
     * List all saved campaigns
     * @returns {Array} Array of campaign metadata
     */
    listCampaigns() {
        const indexJson = localStorage.getItem(this.INDEX_KEY);
        if (!indexJson) {
            return [];
        }

        try {
            const index = JSON.parse(indexJson);
            return Object.entries(index).map(([id, meta]) => ({
                campaignId: id,
                commanderName: meta.name,
                lastPlayedAt: meta.lastPlayed,
                lastPlayedDate: new Date(meta.lastPlayed).toLocaleString()
            })).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
        } catch (error) {
            console.error('[CampaignSaveSystem] Error reading campaign index:', error);
            return [];
        }
    }

    /**
     * Update the campaign index
     * @param {string} campaignId - Campaign ID
     * @param {string} name - Commander name
     * @param {number} timestamp - Last played timestamp
     */
    updateCampaignIndex(campaignId, name, timestamp) {
        let index = {};
        const indexJson = localStorage.getItem(this.INDEX_KEY);

        if (indexJson) {
            try {
                index = JSON.parse(indexJson);
            } catch (error) {
                index = {};
            }
        }

        index[campaignId] = {
            name: name,
            lastPlayed: timestamp
        };

        localStorage.setItem(this.INDEX_KEY, JSON.stringify(index));
    }

    /**
     * Remove a campaign from the index
     * @param {string} campaignId - Campaign ID to remove
     */
    removeCampaignFromIndex(campaignId) {
        const indexJson = localStorage.getItem(this.INDEX_KEY);
        if (!indexJson) return;

        try {
            const index = JSON.parse(indexJson);
            delete index[campaignId];
            localStorage.setItem(this.INDEX_KEY, JSON.stringify(index));
        } catch (error) {
            // Ignore
        }
    }

    /**
     * Get the currently loaded campaign data
     * @returns {Object|null} Current campaign data
     */
    getCampaignData() {
        return this.currentCampaign;
    }

    /**
     * Export campaign as downloadable JSON file
     * @param {string} campaignId - Campaign ID to export (defaults to current)
     */
    exportCampaign(campaignId = null) {
        const id = campaignId || (this.currentCampaign ? this.currentCampaign.campaignId : null);
        if (!id) {
            console.warn('[CampaignSaveSystem] No campaign to export');
            return;
        }

        const key = this.CAMPAIGN_PREFIX + id;
        const saveJson = localStorage.getItem(key);
        if (!saveJson) {
            console.warn('[CampaignSaveSystem] Campaign not found for export:', id);
            return;
        }

        const campaignData = JSON.parse(saveJson);
        const json = JSON.stringify(campaignData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `campaign_${campaignData.commanderName}_${id.substring(0, 8)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Import campaign from file
     * @param {File} file - JSON file to import
     * @returns {Promise<Object>} Imported campaign data
     */
    async importCampaign(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const campaignData = JSON.parse(e.target.result);

                    // Validate basic structure
                    if (!campaignData.campaignId || !campaignData.commanderName) {
                        reject(new Error('Invalid campaign file format'));
                        return;
                    }

                    // Generate new ID to avoid conflicts
                    const newId = this.generateCampaignId();
                    campaignData.campaignId = newId;
                    campaignData.lastPlayedAt = Date.now();

                    // Save imported campaign
                    this.saveCampaignData(newId, campaignData);
                    this.updateCampaignIndex(newId, campaignData.commanderName, campaignData.lastPlayedAt);

                    resolve(campaignData);
                } catch (error) {
                    reject(new Error('Invalid campaign file format'));
                }
            };
            reader.onerror = () => reject(new Error('Error reading file'));
            reader.readAsText(file);
        });
    }

    onSceneUnload() {
        // Auto-save current campaign when leaving scene
        if (this.currentCampaign) {
            this.saveCampaign();
        }
    }

    // ===== QUEST GENERATION SYSTEM =====

    /**
     * Get available levels from the levels collection
     * Returns levels that have published: true
     */
    getAvailableLevels() {
        const levels = this.collections?.levels || {};
        const available = [];

        for (const [key, level] of Object.entries(levels)) {
            if (level.published) {
                available.push({
                    level: key,
                    title: level.title || key,
                    icon: 'node_forest'
                });
            }
        }

        console.log('[CampaignSaveSystem] Available levels for quest generation:', available.map(l => l.level));
        return available;
    }

    /**
     * Boss templates for final quest nodes
     */
    getBossTemplates() {
        return [
            { title: 'The Warlord', description: 'A scarred veteran who has conquered a hundred battlefields. His army is vast and disciplined.' },
            { title: 'The Necromancer', description: 'Death is merely a door to this dark sorcerer. The fallen rise again to serve.' },
            { title: 'The Dragon Knight', description: 'Clad in scales of dragon-forged steel, this champion fears nothing.' },
            { title: 'The Beast Lord', description: 'Commander of monstrous creatures from the deep wilds.' },
            { title: 'The Shadow King', description: 'None have seen his face and lived. His assassins strike from nowhere.' }
        ];
    }

    /**
     * Generate a new quest with procedural nodes
     * Creates a branching path structure like Starfox 64
     * @param {number} tier - Quest tier (affects difficulty and rewards)
     * @param {string} length - Quest length: 'short', 'medium', or 'long'
     * @returns {Object} Generated quest data
     */
    generateNewQuest(tier = null, length = 'medium') {
        // Determine tier - use provided tier, or campaign commander level, or default to 1
        const questTier = tier || this.currentCampaign?.npcLevels?.commander || 1;

        // Quest structure: layers of nodes with branching paths
        // Short: 3-4 layers, Medium: 5-6 layers, Long: 7-8 layers
        let numLayers;
        switch (length) {
            case 'short':
                numLayers = 3 + Math.floor(Math.random() * 2); // 3-4 layers
                break;
            case 'long':
                numLayers = 7 + Math.floor(Math.random() * 2); // 7-8 layers
                break;
            case 'medium':
            default:
                numLayers = 5 + Math.floor(Math.random() * 2); // 5-6 layers
                break;
        }

        const nodesPerLayer = [1]; // Start with 1 node

        // Generate layer sizes (branching structure)
        for (let i = 1; i < numLayers - 1; i++) {
            // Middle layers have 2-3 nodes
            nodesPerLayer.push(Math.random() < 0.6 ? 2 : 3);
        }
        nodesPerLayer.push(1); // End with 1 boss node

        const availableLevels = this.getAvailableLevels();
        const bossTemplates = this.getBossTemplates();

        // If no levels are available, cannot generate quest
        if (availableLevels.length === 0) {
            console.warn('[CampaignSaveSystem] No published levels available for quest generation');
            return null;
        }

        const nodes = {};
        const nodesByLayer = [];
        let nodeIndex = 0;

        // Generate nodes for each layer
        for (let layer = 0; layer < numLayers; layer++) {
            const layerNodes = [];
            const count = nodesPerLayer[layer];
            const isBossLayer = layer === numLayers - 1;

            for (let i = 0; i < count; i++) {
                const nodeId = `quest_node_${nodeIndex++}`;

                let node;
                // Mission types available for nodes
                const missionTypes = ['hunt', 'skirmish'];

                if (isBossLayer) {
                    // Boss node - pick a random level
                    const bossTemplate = bossTemplates[Math.floor(Math.random() * bossTemplates.length)];
                    const levelData = availableLevels[Math.floor(Math.random() * availableLevels.length)];
                    node = {
                        id: nodeId,
                        title: levelData.title,
                        description: bossTemplate.description,
                        tier: questTier,
                        isBoss: true,
                        layer: layer,
                        position: this.calculateNodePosition(layer, i, count, numLayers),
                        connections: [], // Will be filled with backward connections
                        level: levelData.level,
                        baseDifficulty: questTier + 2,
                        missionType: 'hunt', // Boss nodes are always hunt missions
                        baseRewards: {
                            valor: 30 + (questTier * 20)
                        },
                        icon: 'node_stronghold'
                    };
                } else {
                    // Regular node - pick a random level and mission type
                    const levelData = availableLevels[Math.floor(Math.random() * availableLevels.length)];
                    const missionType = missionTypes[Math.floor(Math.random() * missionTypes.length)];

                    const nodeDifficulty = layer + Math.floor(questTier / 2);
                    node = {
                        id: nodeId,
                        title: levelData.title,
                        description: `${missionType === 'hunt' ? 'Hunt enemies in' : 'Battle through'} ${levelData.title}.`,
                        tier: questTier,
                        isBoss: false,
                        layer: layer,
                        position: this.calculateNodePosition(layer, i, count, numLayers),
                        connections: [], // Will be filled after all nodes created
                        level: levelData.level,
                        baseDifficulty: nodeDifficulty,
                        missionType: missionType,
                        baseRewards: {
                            valor: 10 + (nodeDifficulty * 5)
                        },
                        icon: levelData.icon
                    };
                }

                nodes[nodeId] = node;
                layerNodes.push(nodeId);
            }
            nodesByLayer.push(layerNodes);
        }

        // Create connections between layers (forward connections)
        for (let layer = 0; layer < numLayers - 1; layer++) {
            const currentLayerNodes = nodesByLayer[layer];
            const nextLayerNodes = nodesByLayer[layer + 1];

            // Ensure every node in current layer connects to at least one node in next layer
            // And every node in next layer is reachable from at least one node in current layer
            currentLayerNodes.forEach((nodeId, idx) => {
                const node = nodes[nodeId];

                // Connect to at least one node in next layer
                // Use position-based logic to create natural branching
                if (nextLayerNodes.length === 1) {
                    // Only one target - everyone connects to it
                    node.connections.push(nextLayerNodes[0]);
                } else {
                    // Multiple targets - create branching paths
                    // Each node connects to 1-2 nodes in next layer based on position
                    const primaryTarget = Math.min(idx, nextLayerNodes.length - 1);
                    node.connections.push(nextLayerNodes[primaryTarget]);

                    // Chance to connect to adjacent node too (creates alternate paths)
                    if (Math.random() < 0.5) {
                        const secondaryTarget = primaryTarget + (Math.random() < 0.5 ? 1 : -1);
                        if (secondaryTarget >= 0 && secondaryTarget < nextLayerNodes.length) {
                            if (!node.connections.includes(nextLayerNodes[secondaryTarget])) {
                                node.connections.push(nextLayerNodes[secondaryTarget]);
                            }
                        }
                    }
                }
            });

            // Ensure all next layer nodes are reachable
            nextLayerNodes.forEach(nextNodeId => {
                const hasIncoming = currentLayerNodes.some(nodeId =>
                    nodes[nodeId].connections.includes(nextNodeId)
                );
                if (!hasIncoming) {
                    // Pick a random node from current layer to connect
                    const randomNode = currentLayerNodes[Math.floor(Math.random() * currentLayerNodes.length)];
                    if (!nodes[randomNode].connections.includes(nextNodeId)) {
                        nodes[randomNode].connections.push(nextNodeId);
                    }
                }
            });
        }

        // Create the quest object
        const quest = {
            id: this.generateCampaignId(),
            tier: questTier,
            length: length,
            generatedAt: Date.now(),
            nodes: nodes,
            nodesByLayer: nodesByLayer,
            startNodeId: nodesByLayer[0][0],
            bossNodeId: nodesByLayer[numLayers - 1][0],
            unlockedNodes: [nodesByLayer[0][0]], // Start with first node unlocked
            completedNodes: [],
            isComplete: false
        };

        console.log('[CampaignSaveSystem] Generated quest:', quest.id,
                    'Tier:', questTier, 'Length:', length,
                    'Layers:', numLayers, 'Nodes:', Object.keys(nodes).length);

        return quest;
    }

    /**
     * Generate 3 available quests (short, medium, long) at the given tier
     * @param {number} tier - Quest tier (1-5)
     * @returns {Array} Array of 3 quest objects
     */
    generateAvailableQuests(tier) {
        const quests = [
            this.generateNewQuest(tier, 'short'),
            this.generateNewQuest(tier, 'medium'),
            this.generateNewQuest(tier, 'long')
        ];

        console.log('[CampaignSaveSystem] Generated 3 available quests at tier', tier);
        return quests;
    }

    /**
     * Select a quest from available quests to be the current quest
     * @param {string} questId - ID of the quest to select
     * @returns {Object|null} The selected quest or null if not found
     */
    selectQuest(questId) {
        if (!this.currentCampaign) {
            console.warn('[CampaignSaveSystem] No campaign loaded');
            return null;
        }

        // Find the quest in available quests
        const questIndex = this.currentCampaign.availableQuests.findIndex(q => q.id === questId);
        if (questIndex === -1) {
            console.warn('[CampaignSaveSystem] Quest not found in available quests:', questId);
            return null;
        }

        // Move quest from available to current
        const selectedQuest = this.currentCampaign.availableQuests[questIndex];
        this.currentCampaign.currentQuest = selectedQuest;

        // Remove from available quests (don't regenerate yet - wait until quest completes)
        this.currentCampaign.availableQuests.splice(questIndex, 1);

        this.saveCampaign();

        console.log('[CampaignSaveSystem] Selected quest:', questId, 'Length:', selectedQuest.length);
        return selectedQuest;
    }

    /**
     * Calculate node position for rendering
     */
    calculateNodePosition(layer, indexInLayer, nodesInLayer, totalLayers) {
        const canvasWidth = 800;
        const canvasHeight = 500;
        const margin = 80;

        // X position based on layer (left to right)
        const layerWidth = (canvasWidth - margin * 2) / (totalLayers - 1);
        const x = margin + layer * layerWidth;

        // Y position based on index within layer (spread vertically)
        const availableHeight = canvasHeight - margin * 2;
        let y;
        if (nodesInLayer === 1) {
            y = canvasHeight / 2;
        } else {
            const spacing = availableHeight / (nodesInLayer - 1);
            y = margin + indexInLayer * spacing;
        }

        // Add slight randomization for organic feel
        const jitterX = (Math.random() - 0.5) * 30;
        const jitterY = (Math.random() - 0.5) * 20;

        return {
            x: Math.round(x + jitterX),
            y: Math.round(y + jitterY)
        };
    }

    /**
     * Get the current quest
     * @returns {Object|null} Current quest or null if no quest is active
     */
    getCurrentQuest() {
        if (!this.currentCampaign) return null;
        return this.currentCampaign.currentQuest;
    }

    /**
     * Get all nodes in the current quest
     * @returns {Object} Map of node ID to node data
     */
    getQuestNodes() {
        const quest = this.getCurrentQuest();
        return quest ? quest.nodes : {};
    }

    /**
     * Check if a quest node is unlocked
     * @param {string} nodeId - Node ID to check
     * @returns {boolean} True if unlocked
     */
    isQuestNodeUnlocked(nodeId) {
        const quest = this.getCurrentQuest();
        if (!quest) return false;
        return quest.unlockedNodes.includes(nodeId);
    }

    /**
     * Check if a quest node is completed
     * @param {string} nodeId - Node ID to check
     * @returns {boolean} True if completed
     */
    isQuestNodeCompleted(nodeId) {
        const quest = this.getCurrentQuest();
        if (!quest) return false;
        return quest.completedNodes.includes(nodeId);
    }

    /**
     * Mark a quest node as completed and unlock connected nodes
     * @param {string} nodeId - Node ID to complete
     * @returns {Object} Result with unlocked nodes and quest completion status
     */
    completeQuestNode(nodeId) {
        if (!this.currentCampaign || !this.currentCampaign.currentQuest) {
            return { success: false, error: 'No quest active' };
        }

        const quest = this.currentCampaign.currentQuest;
        const node = quest.nodes[nodeId];

        if (!node) {
            return { success: false, error: 'Node not found' };
        }

        if (quest.completedNodes.includes(nodeId)) {
            return { success: true, alreadyCompleted: true };
        }

        // Mark node as completed
        quest.completedNodes.push(nodeId);

        // Unlock connected nodes
        const newlyUnlocked = [];
        for (const connectedId of node.connections) {
            if (!quest.unlockedNodes.includes(connectedId)) {
                quest.unlockedNodes.push(connectedId);
                newlyUnlocked.push(connectedId);
            }
        }

        // Check if boss node was completed
        let questComplete = false;
        if (node.isBoss) {
            quest.isComplete = true;
            questComplete = true;
            this.currentCampaign.statistics.questsCompleted =
                (this.currentCampaign.statistics.questsCompleted || 0) + 1;

            // Clear current quest - player must select a new one from Commander
            this.currentCampaign.currentQuest = null;

            // Regenerate 3 new available quests at the Commander's tier
            const commanderTier = this.currentCampaign.npcLevels?.commander || 1;
            this.currentCampaign.availableQuests = this.generateAvailableQuests(commanderTier);

            console.log('[CampaignSaveSystem] Quest completed! New quests available at tier', commanderTier);
        }

        this.saveCampaign();

        console.log('[CampaignSaveSystem] Completed quest node:', nodeId,
                    'Unlocked:', newlyUnlocked,
                    'Quest complete:', questComplete);

        return {
            success: true,
            nodeId: nodeId,
            unlockedNodes: newlyUnlocked,
            questComplete: questComplete,
            isBossNode: node.isBoss
        };
    }

    /**
     * Check if current quest is complete
     * @returns {boolean} True if quest is complete
     */
    isQuestComplete() {
        const quest = this.getCurrentQuest();
        return quest ? quest.isComplete : false;
    }

    /**
     * Get quest progress information
     * @returns {Object} Progress stats
     */
    getQuestProgress() {
        const quest = this.getCurrentQuest();
        if (!quest) return null;

        const totalNodes = Object.keys(quest.nodes).length;
        const completedCount = quest.completedNodes.length;
        const unlockedCount = quest.unlockedNodes.length;

        return {
            totalNodes,
            completedNodes: completedCount,
            unlockedNodes: unlockedCount,
            progressPercent: Math.round((completedCount / totalNodes) * 100),
            tier: quest.tier,
            isComplete: quest.isComplete
        };
    }
}
