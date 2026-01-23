/**
 * CampaignSystem - Core campaign state management and operations.
 *
 * This system handles:
 * - Currency operations (add/deduct/check)
 * - Unlock tracking and validation
 * - Permanent upgrade application
 * - Mission result processing
 * - Campaign progression state
 *
 * Works with CampaignSaveSystem for persistence.
 */
class CampaignSystem extends GUTS.BaseSystem {
    static services = [
        'getCampaignState',
        'addCurrency',
        'deductCurrency',
        'canAfford',
        'getUnlockedUnits',
        'getUnlockedBuildings',
        'isUnitUnlocked',
        'isBuildingUnlocked',
        'unlockUnit',
        'unlockBuilding',
        'purchaseUpgrade',
        'getUpgradeLevel',
        'applyPermanentUpgrades',
        'processMissionResult',
        'processPendingLoot',
        'addItemToInventory',
        'removeItemFromInventory',
        'getInventoryItems',
        'hasInventorySpace',
        'getCurrencies',
        'getPermanentUpgrades',
        'isCampaignActive',
        'createMissionScroll',
        'rollScrollModifiers',
        'rerollScrollModifier',
        'sealScrollProphecy',
        'getScrollRerollCost',
        'getScrollItem',
        'getNpcLevel',
        'getNpcUpgradeCost',
        'canUpgradeNpc',
        'upgradeNpc',
        'getCollectedTarotCards',
        'hasTarotCard',
        'addTarotCard',
        'getAvailableQuests',
        'getTarotCardPurchaseCost',
        'canPurchaseTarotCard',
        'purchaseTarotCard',
        'getUncollectedTarotCards'
    ];

    static serviceDependencies = [
        'getCampaignData',
        'saveCampaign',
        'getCurrentQuest',
        'completeQuestNode',
        'generateAvailableQuests'
    ];

    constructor(game) {
        super(game);
        this.game.campaignSystem = this;
    }

    init() {
    }

    /**
     * Check if a campaign is currently active
     * @returns {boolean} True if campaign is loaded
     */
    isCampaignActive() {
        const data = this.call.getCampaignData();
        return !!data;
    }

    /**
     * Get the current campaign state
     * @returns {Object|null} Campaign data or null
     */
    getCampaignState() {
        return this.call.getCampaignData();
    }

    /**
     * Get current currencies
     * @returns {Object} Currency amounts
     */
    getCurrencies() {
        const data = this.getCampaignState();
        return data ? data.currencies : { valor: 0, glory: 0, essence: 0 };
    }

    /**
     * Get permanent upgrades
     * @returns {Object} Upgrade levels
     */
    getPermanentUpgrades() {
        const data = this.getCampaignState();
        return data ? data.permanentUpgrades : {};
    }

    /**
     * Add currency to the campaign
     * @param {string} type - Currency type (valor, glory, essence)
     * @param {number} amount - Amount to add
     * @returns {boolean} Success status
     */
    addCurrency(type, amount) {
        const data = this.getCampaignState();
        if (!data) return false;

        if (!data.currencies.hasOwnProperty(type)) {
            console.warn('[CampaignSystem] Invalid currency type:', type);
            return false;
        }

        data.currencies[type] += amount;
        this.call.saveCampaign();

        console.log('[CampaignSystem] Added', amount, type, '- New total:', data.currencies[type]);
        return true;
    }

    /**
     * Deduct currency from the campaign
     * @param {string} type - Currency type
     * @param {number} amount - Amount to deduct
     * @returns {boolean} Success status (false if insufficient funds)
     */
    deductCurrency(type, amount) {
        const data = this.getCampaignState();
        if (!data) return false;

        if (!data.currencies.hasOwnProperty(type)) {
            console.warn('[CampaignSystem] Invalid currency type:', type);
            return false;
        }

        if (data.currencies[type] < amount) {
            console.warn('[CampaignSystem] Insufficient', type, ':', data.currencies[type], '<', amount);
            return false;
        }

        data.currencies[type] -= amount;
        this.call.saveCampaign();

        console.log('[CampaignSystem] Deducted', amount, type, '- New total:', data.currencies[type]);
        return true;
    }

    /**
     * Check if player can afford a cost
     * @param {Object} cost - Cost object { valor: x, glory: y, essence: z }
     * @returns {boolean} True if affordable
     */
    canAfford(cost) {
        const data = this.getCampaignState();
        if (!data) return false;

        for (const [type, amount] of Object.entries(cost)) {
            if (data.currencies[type] === undefined || data.currencies[type] < amount) {
                return false;
            }
        }
        return true;
    }

    /**
     * Deduct a multi-currency cost
     * @param {Object} cost - Cost object
     * @returns {boolean} Success status
     */
    deductCost(cost) {
        if (!this.canAfford(cost)) return false;

        const data = this.getCampaignState();
        for (const [type, amount] of Object.entries(cost)) {
            data.currencies[type] -= amount;
        }
        this.call.saveCampaign();
        return true;
    }

    /**
     * Get list of unlocked unit IDs
     * @returns {Array} Array of unit IDs
     */
    getUnlockedUnits() {
        const data = this.getCampaignState();
        return data ? data.unlocks.units : [];
    }

    /**
     * Get list of unlocked building IDs
     * @returns {Array} Array of building IDs
     */
    getUnlockedBuildings() {
        const data = this.getCampaignState();
        return data ? data.unlocks.buildings : [];
    }

    /**
     * Check if a unit is unlocked
     * @param {string} unitId - Unit ID to check
     * @returns {boolean} True if unlocked
     */
    isUnitUnlocked(unitId) {
        const unlocked = this.getUnlockedUnits();
        return unlocked.includes(unitId);
    }

    /**
     * Check if a building is unlocked
     * @param {string} buildingId - Building ID to check
     * @returns {boolean} True if unlocked
     */
    isBuildingUnlocked(buildingId) {
        const unlocked = this.getUnlockedBuildings();
        return unlocked.includes(buildingId);
    }

    /**
     * Unlock a unit
     * @param {string} unitId - Unit ID to unlock
     * @returns {boolean} Success status
     */
    unlockUnit(unitId) {
        const data = this.getCampaignState();
        if (!data) return false;

        if (!data.unlocks.units.includes(unitId)) {
            data.unlocks.units.push(unitId);
            this.call.saveCampaign();
            console.log('[CampaignSystem] Unlocked unit:', unitId);
        }
        return true;
    }

    /**
     * Unlock a building
     * @param {string} buildingId - Building ID to unlock
     * @returns {boolean} Success status
     */
    unlockBuilding(buildingId) {
        const data = this.getCampaignState();
        if (!data) return false;

        if (!data.unlocks.buildings.includes(buildingId)) {
            data.unlocks.buildings.push(buildingId);
            this.call.saveCampaign();
            console.log('[CampaignSystem] Unlocked building:', buildingId);
        }
        return true;
    }

    /**
     * Purchase a permanent upgrade
     * @param {string} upgradeId - Upgrade ID from campaignUpgrades collection
     * @returns {boolean} Success status
     */
    purchaseUpgrade(upgradeId) {
        const data = this.getCampaignState();
        if (!data) return false;

        // Get upgrade definition from collections
        const upgrades = this.collections.campaignUpgrades;
        const upgrade = upgrades ? upgrades[upgradeId] : null;

        if (!upgrade) {
            console.warn('[CampaignSystem] Unknown upgrade:', upgradeId);
            return false;
        }

        // Check current level
        const currentLevel = data.permanentUpgrades[upgrade.effect.stat] || 0;
        const effectiveLevel = Math.floor(currentLevel / upgrade.effect.value);

        if (upgrade.maxLevel && effectiveLevel >= upgrade.maxLevel) {
            console.warn('[CampaignSystem] Upgrade at max level:', upgradeId);
            return false;
        }

        // Check cost
        if (!this.canAfford(upgrade.cost)) {
            console.warn('[CampaignSystem] Cannot afford upgrade:', upgradeId);
            return false;
        }

        // Check requirements
        if (upgrade.requires && upgrade.requires.length > 0) {
            // Future: Check prerequisite upgrades
        }

        // Deduct cost and apply upgrade
        this.deductCost(upgrade.cost);
        data.permanentUpgrades[upgrade.effect.stat] =
            (data.permanentUpgrades[upgrade.effect.stat] || 0) + upgrade.effect.value;

        this.call.saveCampaign();
        console.log('[CampaignSystem] Purchased upgrade:', upgradeId,
                    '- New', upgrade.effect.stat, ':', data.permanentUpgrades[upgrade.effect.stat]);

        return true;
    }

    /**
     * Get current level of a permanent upgrade stat
     * @param {string} stat - Stat name (e.g., 'startingGold', 'unitDamage')
     * @returns {number} Current level/value
     */
    getUpgradeLevel(stat) {
        const data = this.getCampaignState();
        return data ? (data.permanentUpgrades[stat] || 0) : 0;
    }

    /**
     * Apply permanent upgrades to a mission config
     * @param {Object} baseConfig - Base mission configuration
     * @returns {Object} Modified config with upgrades applied
     */
    applyPermanentUpgrades(baseConfig) {
        const data = this.getCampaignState();
        if (!data) return baseConfig;

        const config = { ...baseConfig };
        const upgrades = data.permanentUpgrades;

        // Apply starting gold bonus
        if (upgrades.startingGold) {
            config.startingGold = (config.startingGold || 100) + upgrades.startingGold;
        }

        // Store upgrade modifiers for unit creation
        config.campaignModifiers = {
            unitDamageBonus: upgrades.unitDamage || 0,
            unitHealthBonus: upgrades.unitHealth || 0,
            buildingHealthBonus: upgrades.buildingHealth || 0,
            rewardMultiplier: 1 + ((upgrades.missionRewards || 0) / 100)
        };

        return config;
    }

    /**
     * Process mission completion results
     * @param {Object} result - Mission result { victory, nodeId, scroll, stats }
     * @returns {Object} Rewards earned
     */
    processMissionResult(result) {
        const data = this.getCampaignState();
        if (!data) return null;

        const rewards = {
            currencies: { valor: 0, glory: 0, essence: 0 },
            items: [],
            nodeCompleted: false,
            questComplete: false,
            isBossNode: false
        };

        // Update statistics
        if (result.victory) {
            data.statistics.missionsCompleted++;
        } else {
            data.statistics.missionsFailed++;
        }

        if (result.stats) {
            data.statistics.unitsKilled += result.stats.unitsKilled || 0;
            data.statistics.unitsLost += result.stats.unitsLost || 0;
            data.statistics.goldEarned += result.stats.goldEarned || 0;
        }

        // Only award rewards on victory
        if (result.victory) {
            // Get node data from current quest (procedural nodes)
            const quest = this.call.getCurrentQuest();
            const node = quest?.nodes?.[result.nodeId] || null;

            if (node && node.baseRewards) {
                // Calculate base valor reward multiplier
                let valorMultiplier = 1;

                // Apply scroll reward multiplier to valor
                if (result.scroll && result.scroll.rewardMultiplier) {
                    valorMultiplier *= result.scroll.rewardMultiplier;
                }

                // Apply permanent upgrade bonus
                const upgradeBonus = data.permanentUpgrades.missionRewards || 0;
                valorMultiplier *= (1 + upgradeBonus / 100);

                // VALOR: Base node reward (always earned)
                if (node.baseRewards.valor) {
                    rewards.currencies.valor = Math.floor(node.baseRewards.valor * valorMultiplier);
                }

                // GLORY: Earned from scroll modifiers (harder prophecies = more glory)
                // Glory is NOT a base reward - it comes from taking on challenges
                if (result.scroll && result.scroll.modifiers && result.scroll.modifiers.length > 0) {
                    // Each modifier contributes glory based on its reward bonus
                    let gloryFromModifiers = 0;
                    for (const mod of result.scroll.modifiers) {
                        // Base glory per modifier: 5, scaled by modifier's reward bonus
                        const modifierGlory = 5 + Math.floor((mod.rewardBonus || 0) * 20);
                        gloryFromModifiers += modifierGlory;
                    }
                    // Scale by node tier
                    gloryFromModifiers *= (node.tier || 1);
                    rewards.currencies.glory = gloryFromModifiers;
                }

                // ESSENCE: Earned from defeating bosses (quest completion)
                if (node.isBoss) {
                    rewards.isBossNode = true;
                    // Base essence from boss + tier bonus
                    const bossEssence = 10 + (quest.tier * 5);
                    rewards.currencies.essence = bossEssence;
                }

                // Apply currency rewards
                for (const [type, amount] of Object.entries(rewards.currencies)) {
                    if (amount > 0) {
                        data.currencies[type] += amount;
                    }
                }

                // SCROLL DROPS: Chance to get a prophecy scroll
                const scrollDrop = this.rollScrollDrop(node, quest);
                if (scrollDrop) {
                    // Add scroll to inventory using proper method to assign slotIndex
                    const addedScroll = this.addItemToInventory(scrollDrop);
                    if (addedScroll) {
                        rewards.items.push(addedScroll);
                        console.log('[CampaignSystem] Scroll dropped:', addedScroll.name, addedScroll.rarity);
                    }
                }

                // TAROT CARD DROPS: Chance to get a collectible tarot card
                const tarotCardDrop = this.rollTarotCardDrop(node, quest);
                if (tarotCardDrop) {
                    const added = this.addTarotCard(tarotCardDrop);
                    if (added) {
                        rewards.tarotCard = tarotCardDrop;
                        console.log('[CampaignSystem] Tarot card dropped:', tarotCardDrop);
                    }
                }
            }

            // Mark quest node as completed using quest system
            if (result.nodeId) {
                const completionResult = this.call.completeQuestNode( result.nodeId);
                if (completionResult && completionResult.success) {
                    rewards.nodeCompleted = !completionResult.alreadyCompleted;
                    rewards.questComplete = completionResult.questComplete;
                    rewards.unlockedNodes = completionResult.unlockedNodes || [];

                    if (completionResult.questComplete) {
                        console.log('[CampaignSystem] QUEST COMPLETE! Essence awarded:', rewards.currencies.essence);
                    }
                }
            }
        }

        // Save updated state
        this.call.saveCampaign();

        console.log('[CampaignSystem] Processed mission result:',
                    result.victory ? 'VICTORY' : 'DEFEAT',
                    'Rewards:', rewards);

        return rewards;
    }

    /**
     * Roll for a prophecy scroll drop from a completed mission
     * Higher tier nodes have better drop rates and higher rarity scrolls
     * @param {Object} node - The completed node
     * @param {Object} quest - The current quest
     * @returns {Object|null} A scroll item or null if no drop
     */
    rollScrollDrop(node, quest) {
        const tier = node?.tier || 1;
        const isBoss = node?.isBoss || false;

        // Base drop chance: 20% + 5% per tier, boss guarantees drop
        const baseDropChance = isBoss ? 1.0 : (0.20 + (tier - 1) * 0.05);

        if (Math.random() > baseDropChance) {
            return null; // No drop
        }

        // Determine rarity (higher tiers = better odds for rare scrolls)
        // Boss nodes always drop at least uncommon
        const rarityRoll = Math.random();
        let rarity, rarityName;

        if (isBoss) {
            // Boss: 40% uncommon, 40% rare, 20% epic
            if (rarityRoll < 0.40) {
                rarity = 'uncommon';
                rarityName = 'Uncommon';
            } else if (rarityRoll < 0.80) {
                rarity = 'rare';
                rarityName = 'Rare';
            } else {
                rarity = 'epic';
                rarityName = 'Epic';
            }
        } else {
            // Regular nodes: Common > Uncommon > Rare, scaled by tier
            const uncommonChance = 0.15 + (tier - 1) * 0.05;
            const rareChance = 0.05 + (tier - 1) * 0.03;

            if (rarityRoll < rareChance) {
                rarity = 'rare';
                rarityName = 'Rare';
            } else if (rarityRoll < rareChance + uncommonChance) {
                rarity = 'uncommon';
                rarityName = 'Uncommon';
            } else {
                rarity = 'common';
                rarityName = 'Common';
            }
        }

        // Create the scroll item
        const scroll = {
            id: this.generateItemId(),
            name: `${rarityName} Prophecy Scroll`,
            itemType: 'missionScroll',
            rarity: rarity,
            tier: tier,
            itemData: {
                modifiers: [], // Empty until taken to Oracle
                rewardMultiplier: 1,
                timesRolled: 0
            }
        };

        return scroll;
    }

    /**
     * Roll for a tarot card drop from a completed mission
     * Boss nodes have higher drop chance, can only drop cards not yet collected
     * @param {Object} node - The completed node
     * @param {Object} quest - The current quest
     * @returns {string|null} Tarot card ID or null if no drop
     */
    rollTarotCardDrop(node, quest) {
        const isBoss = node?.isBoss || false;
        const tier = node?.tier || 1;

        // Drop chance: 10% base, +5% per tier, boss = 50% chance
        const dropChance = isBoss ? 0.50 : (0.10 + (tier - 1) * 0.05);

        if (Math.random() > dropChance) {
            return null; // No drop
        }

        // Get uncollected tarot cards
        const tarotCards = this.collections.tarotCards;
        if (!tarotCards) {
            return null;
        }

        const collectedCards = this.getCollectedTarotCards();
        const uncollectedCardIds = Object.keys(tarotCards).filter(
            cardId => !collectedCards.includes(cardId)
        );

        if (uncollectedCardIds.length === 0) {
            console.log('[CampaignSystem] All tarot cards already collected, no drop');
            return null;
        }

        // Pick a random uncollected card
        const randomIndex = Math.floor(Math.random() * uncollectedCardIds.length);
        const droppedCardId = uncollectedCardIds[randomIndex];

        return droppedCardId;
    }

    /**
     * Generate a unique item ID
     */
    generateItemId() {
        return 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Process pending loot collected during a mission
     * Called when returning to campaign after a mission
     * @returns {Object} Summary of processed loot
     */
    processPendingLoot() {
        const pendingLoot = this.game.state.pendingLoot;
        if (!pendingLoot || pendingLoot.length === 0) {
            return { currencies: {}, items: [] };
        }

        const data = this.getCampaignState();
        if (!data) {
            console.warn('[CampaignSystem] No campaign data, cannot process loot');
            return { currencies: {}, items: [] };
        }

        const result = {
            currencies: { valor: 0, glory: 0, essence: 0 },
            items: []
        };

        for (const loot of pendingLoot) {
            if (loot.type === 'currency') {
                // Add currency
                const currency = loot.currency;
                const amount = loot.amount || 0;
                if (data.currencies.hasOwnProperty(currency)) {
                    data.currencies[currency] += amount;
                    result.currencies[currency] += amount;
                    console.log('[CampaignSystem] Added', amount, currency, 'from loot');
                }
            } else {
                // Add item to inventory
                const item = this.addItemToInventory({
                    itemType: loot.itemType || loot.type,
                    itemData: loot.itemData || {},
                    rarity: loot.rarity,
                    tier: loot.tier,
                    amount: loot.amount || 1,
                    name: loot.name || loot.type,
                    icon: loot.icon,
                    color: loot.color
                });

                if (item) {
                    result.items.push(item);
                    console.log('[CampaignSystem] Added item to inventory:', item.name);
                } else {
                    console.warn('[CampaignSystem] Could not add item to inventory (full?):', loot.name);
                }
            }
        }

        // Clear pending loot
        this.game.state.pendingLoot = [];

        // Save campaign
        this.call.saveCampaign();

        console.log('[CampaignSystem] Processed pending loot:', result);
        return result;
    }

    /**
     * Add an item to the campaign inventory
     * @param {Object} item - Item to add { itemType, itemData, amount, name, icon, color }
     * @returns {Object|null} Added item with slot index, or null if inventory full
     */
    addItemToInventory(item) {
        const data = this.getCampaignState();
        if (!data) return null;

        const maxSlots = data.inventory.maxSlots || 20;
        const items = data.inventory.items;

        // Check for stackable items (materials, consumables)
        if (item.itemType === 'material' || item.itemType === 'consumable') {
            const existingItem = items.find(i =>
                i.itemType === item.itemType &&
                i.itemData?.materialId === item.itemData?.materialId &&
                i.itemData?.consumableId === item.itemData?.consumableId
            );

            if (existingItem) {
                existingItem.amount = (existingItem.amount || 1) + (item.amount || 1);
                return existingItem;
            }
        }

        // Find first empty slot
        const usedSlots = new Set(items.map(i => i.slotIndex));
        let freeSlot = -1;
        for (let i = 0; i < maxSlots; i++) {
            if (!usedSlots.has(i)) {
                freeSlot = i;
                break;
            }
        }

        if (freeSlot === -1) {
            console.warn('[CampaignSystem] Inventory full, cannot add item');
            return null;
        }

        // Create new item with slot
        const newItem = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            slotIndex: freeSlot,
            itemType: item.itemType,
            itemData: item.itemData || {},
            rarity: item.rarity,
            tier: item.tier,
            amount: item.amount || 1,
            name: item.name || item.itemType,
            icon: item.icon || 'item',
            color: item.color || '#ffffff',
            obtainedAt: Date.now()
        };

        items.push(newItem);
        return newItem;
    }

    /**
     * Remove an item from inventory by slot index or item id
     * @param {number|string} slotOrId - Slot index or item ID
     * @returns {Object|null} Removed item or null
     */
    removeItemFromInventory(slotOrId) {
        const data = this.getCampaignState();
        if (!data) return null;

        const items = data.inventory.items;
        let index;

        if (typeof slotOrId === 'number') {
            index = items.findIndex(i => i.slotIndex === slotOrId);
        } else {
            index = items.findIndex(i => i.id === slotOrId);
        }

        if (index === -1) return null;

        const removed = items.splice(index, 1)[0];
        this.call.saveCampaign();
        return removed;
    }

    /**
     * Get all inventory items
     * @returns {Array} Array of inventory items
     */
    getInventoryItems() {
        const data = this.getCampaignState();
        return data ? data.inventory.items : [];
    }

    /**
     * Check if inventory has space for more items
     * @returns {boolean} True if there's space
     */
    hasInventorySpace() {
        const data = this.getCampaignState();
        if (!data) return false;

        const maxSlots = data.inventory.maxSlots || 20;
        const usedSlots = data.inventory.items.length;
        return usedSlots < maxSlots;
    }

    // ===== SCROLL ROLLING MECHANICS =====

    /**
     * Create a new mission scroll for a completed node
     * @param {string} nodeId - The atlas node ID this scroll is for
     * @param {number} tier - Optional tier override (defaults to node tier)
     * @returns {Object|null} The created scroll item, or null if failed
     */
    createMissionScroll(nodeId, tier = null) {
        const atlasNodes = this.collections.atlasNodes;
        const node = atlasNodes ? atlasNodes[nodeId] : null;

        if (!node) {
            console.warn('[CampaignSystem] Cannot create scroll for unknown node:', nodeId);
            return null;
        }

        const scrollTier = tier || node.tier || 1;
        const maxModifiers = Math.min(3, Math.floor(scrollTier / 2) + 1);

        // Create scroll item data
        const scrollItem = {
            itemType: 'missionScroll',
            name: `${node.title} Scroll`,
            icon: 'scroll',
            color: this.getTierColor(scrollTier),
            itemData: {
                nodeId: nodeId,
                tier: scrollTier,
                modifiers: [],
                maxModifiers: maxModifiers,
                rewardMultiplier: 1,
                timesRolled: 0
            }
        };

        // Add to inventory
        const addedItem = this.addItemToInventory(scrollItem);
        if (addedItem) {
            console.log('[CampaignSystem] Created mission scroll:', addedItem.name);
            this.call.saveCampaign();
        }

        return addedItem;
    }

    /**
     * Get tier color for items
     * @param {number} tier - Item tier
     * @returns {string} Hex color
     */
    getTierColor(tier) {
        const colors = {
            1: '#ffffff',  // White - Common
            2: '#1eff00',  // Green - Uncommon
            3: '#0070dd',  // Blue - Rare
            4: '#a335ee',  // Purple - Epic
            5: '#ff8000'   // Orange - Legendary
        };
        return colors[tier] || colors[1];
    }

    /**
     * Roll a tarot reading (3 cards) on a mission scroll
     * Uses the Major Arcana to generate prophecy modifiers
     * @param {string} scrollId - The inventory item ID of the scroll
     * @returns {Object|null} Updated scroll data, or null if failed
     */
    rollScrollModifiers(scrollId) {
        const data = this.getCampaignState();
        if (!data) return null;

        const scroll = data.inventory.items.find(i => i.id === scrollId);
        if (!scroll || scroll.itemType !== 'missionScroll') {
            console.warn('[CampaignSystem] Invalid scroll ID:', scrollId);
            return null;
        }

        const tarotCards = this.collections.tarotCards;
        if (!tarotCards || Object.keys(tarotCards).length === 0) {
            console.warn('[CampaignSystem] No tarot cards defined');
            return null;
        }

        // Only use collected tarot cards for prophecies
        const collectedCardIds = this.getCollectedTarotCards();
        if (collectedCardIds.length < 3) {
            console.warn('[CampaignSystem] Need at least 3 collected tarot cards for a reading');
            return { success: false, error: 'Need at least 3 collected tarot cards for a prophecy reading.' };
        }

        // Draw 3 random cards from collected cards only (no duplicates)
        const collectedCards = collectedCardIds.map(id => tarotCards[id]).filter(Boolean);
        const drawnCards = [];
        const availableCards = [...collectedCards];

        const positions = ['past', 'present', 'future'];

        for (let i = 0; i < 3 && availableCards.length > 0; i++) {
            const index = Math.floor(Math.random() * availableCards.length);
            const card = availableCards.splice(index, 1)[0];
            const position = positions[i];

            // 50% chance upright vs reversed
            const isReversed = Math.random() < 0.5;

            // Get the reading based on position and orientation
            const positionData = card[position];
            const reading = isReversed ? positionData.reversed : positionData.upright;

            drawnCards.push({
                id: card.id,
                cardNumber: card.number,
                title: card.title,
                texture: card.texture,
                isReversed: isReversed,
                readingName: reading.name,
                description: reading.description,
                effects: reading.effects || [],
                position: position
            });
        }

        // Calculate reward bonus from effects
        // Each position affects rewards differently:
        // - Past (player buffs): Helpful effects reduce rewards, handicaps increase rewards
        // - Present (challenges): Harder challenges increase rewards
        // - Future (rewards): Direct reward modifiers
        let totalRewardMultiplier = 1;

        // Build modifiers from the tarot reading
        const rolledModifiers = drawnCards.map(card => {
            // Calculate reward bonus for this specific card based on position
            let cardRewardBonus = 0;

            if (card.effects) {
                for (const effect of card.effects) {
                    // Future position: Direct reward effects
                    if (effect.target === 'rewards' && effect.stat === 'multiplier') {
                        if (effect.operation === 'add') {
                            cardRewardBonus += effect.value;
                        } else if (effect.operation === 'multiply') {
                            cardRewardBonus += (effect.value - 1);
                        }
                    }
                }
            }

            // Position-based reward adjustments for non-reward effects
            if (card.position === 'past') {
                // Past cards buff the player - helpful = less reward, harmful = more reward
                // Check if this is a beneficial or harmful effect
                const isBeneficial = this.isPastCardBeneficial(card.effects);
                if (cardRewardBonus === 0) {
                    // No explicit reward modifier, calculate based on effect type
                    cardRewardBonus = isBeneficial ? -0.10 : 0.15; // Buffs reduce rewards, debuffs increase
                }
            } else if (card.position === 'present') {
                // Present cards modify the mission - challenges increase rewards
                const isChallenge = this.isPresentCardChallenge(card.effects);
                if (cardRewardBonus === 0) {
                    // No explicit reward modifier, calculate based on challenge level
                    cardRewardBonus = isChallenge ? 0.20 : -0.05; // Challenges increase rewards, easy modifiers decrease
                }
            }
            // Future cards use their explicit reward modifiers (already calculated above)

            // Accumulate total reward multiplier
            totalRewardMultiplier += cardRewardBonus;

            return {
                id: card.id,
                title: `${card.title} ${card.isReversed ? '(Reversed)' : '(Upright)'}`,
                subtitle: card.readingName,
                description: card.description,
                effects: card.effects,
                texture: card.texture,
                isReversed: card.isReversed,
                position: card.position,
                rewardBonus: cardRewardBonus
            };
        });

        // Update scroll data with tarot reading
        scroll.itemData.modifiers = rolledModifiers;
        scroll.itemData.tarotReading = drawnCards;
        scroll.itemData.timesRolled = (scroll.itemData.timesRolled || 0) + 1;

        // Set the calculated reward multiplier
        scroll.itemData.rewardMultiplier = totalRewardMultiplier;

        // Update scroll name to reflect the reading
        scroll.name = scroll.name.replace(/ \(.*\)$/, '');
        scroll.name += ` (${drawnCards.length} cards)`;

        this.call.saveCampaign();

        console.log('[CampaignSystem] Drew tarot reading:',
                    drawnCards.map(c => `${c.title} ${c.isReversed ? 'R' : 'U'}`).join(', '));

        return { success: true, scrollData: scroll.itemData, tarotReading: drawnCards };
    }

    /**
     * Reroll a specific tarot card in the reading
     * @param {string} scrollId - The inventory item ID of the scroll
     * @param {number} cardIndex - Index of card to reroll (0=past, 1=present, 2=future)
     * @returns {Object|null} Updated scroll data, or null if failed
     */
    rerollScrollModifier(scrollId, cardIndex) {
        const data = this.getCampaignState();
        if (!data) return null;

        const scroll = data.inventory.items.find(i => i.id === scrollId);
        if (!scroll || scroll.itemType !== 'missionScroll') {
            console.warn('[CampaignSystem] Invalid scroll ID:', scrollId);
            return null;
        }

        const modifiers = scroll.itemData.modifiers || [];
        const tarotReading = scroll.itemData.tarotReading || [];

        if (cardIndex < 0 || cardIndex >= modifiers.length) {
            console.warn('[CampaignSystem] Invalid card index:', cardIndex);
            return null;
        }

        // Check and deduct reroll cost
        const cost = this.getScrollRerollCost(scrollId);
        if (!this.canAfford(cost)) {
            console.warn('[CampaignSystem] Cannot afford reroll cost');
            return null;
        }

        this.deductCost(cost);

        // Get available tarot cards from collected cards only, excluding current ones
        const tarotCards = this.collections.tarotCards;
        const currentCardIds = modifiers.map(m => m.id);
        const collectedCardIds = this.getCollectedTarotCards();

        const availableCards = collectedCardIds
            .map(id => tarotCards[id])
            .filter(c => c && !currentCardIds.includes(c.id));

        if (availableCards.length === 0) {
            console.warn('[CampaignSystem] No alternative collected cards available');
            return scroll.itemData;
        }

        // Draw a new random card
        const newCard = availableCards[Math.floor(Math.random() * availableCards.length)];
        const isReversed = Math.random() < 0.5;
        const position = cardIndex === 0 ? 'past' : (cardIndex === 1 ? 'present' : 'future');

        // Get the reading based on position and orientation
        const positionData = newCard[position];
        const reading = isReversed ? positionData.reversed : positionData.upright;

        const oldModifier = modifiers[cardIndex];

        // Calculate reward bonus for the new card based on position
        let cardRewardBonus = 0;
        const cardEffects = reading.effects || [];

        // First check for explicit reward modifiers
        for (const effect of cardEffects) {
            if (effect.target === 'rewards' && effect.stat === 'multiplier') {
                if (effect.operation === 'add') {
                    cardRewardBonus += effect.value;
                } else if (effect.operation === 'multiply') {
                    cardRewardBonus += (effect.value - 1);
                }
            }
        }

        // Position-based reward adjustments for non-reward effects
        if (position === 'past' && cardRewardBonus === 0) {
            const isBeneficial = this.isPastCardBeneficial(cardEffects);
            cardRewardBonus = isBeneficial ? -0.10 : 0.15;
        } else if (position === 'present' && cardRewardBonus === 0) {
            const isChallenge = this.isPresentCardChallenge(cardEffects);
            cardRewardBonus = isChallenge ? 0.20 : -0.05;
        }

        // Update the tarot reading
        const newCardData = {
            id: newCard.id,
            cardNumber: newCard.number,
            title: newCard.title,
            texture: newCard.texture,
            isReversed: isReversed,
            readingName: reading.name,
            description: reading.description,
            effects: cardEffects,
            position: position
        };

        if (tarotReading[cardIndex]) {
            tarotReading[cardIndex] = newCardData;
        }

        // Update the modifier
        modifiers[cardIndex] = {
            id: newCard.id,
            title: `${newCard.title} ${isReversed ? '(Reversed)' : '(Upright)'}`,
            subtitle: reading.name,
            description: reading.description,
            effects: cardEffects,
            texture: newCard.texture,
            isReversed: isReversed,
            position: position,
            rewardBonus: cardRewardBonus
        };

        // Recalculate total reward multiplier from all modifiers
        let totalRewardMultiplier = 1;
        for (const mod of modifiers) {
            totalRewardMultiplier += (mod.rewardBonus || 0);
        }
        scroll.itemData.rewardMultiplier = totalRewardMultiplier;

        this.call.saveCampaign();

        console.log('[CampaignSystem] Rerolled card', oldModifier.title, '->',
                    newCard.title, (isReversed ? 'Reversed' : 'Upright'));

        return scroll.itemData;
    }

    /**
     * Seal a scroll's prophecy (lock in modifiers, prevent further rerolling)
     * @param {string} scrollId - The inventory item ID of the scroll
     * @returns {Object} Result with success flag
     */
    sealScrollProphecy(scrollId) {
        const data = this.getCampaignState();
        if (!data) return { success: false, error: 'No campaign data' };

        const scroll = data.inventory.items.find(i => i.id === scrollId);
        if (!scroll || scroll.itemType !== 'missionScroll') {
            return { success: false, error: 'Invalid scroll' };
        }

        if (!scroll.itemData.modifiers || scroll.itemData.modifiers.length === 0) {
            return { success: false, error: 'Scroll has no prophecy to seal' };
        }

        if (scroll.itemData.isSealed) {
            return { success: false, error: 'Scroll is already sealed' };
        }

        // Seal the prophecy
        scroll.itemData.isSealed = true;

        this.call.saveCampaign();

        console.log('[CampaignSystem] Sealed prophecy on scroll:', scrollId);

        return { success: true };
    }

    /**
     * Get the cost to reroll a modifier on a scroll
     * @param {string} scrollId - The inventory item ID of the scroll
     * @returns {Object} Cost object { valor, glory, essence }
     */
    getScrollRerollCost(scrollId) {
        const data = this.getCampaignState();
        if (!data) return { valor: 999 };

        const scroll = data.inventory.items.find(i => i.id === scrollId);
        if (!scroll || scroll.itemType !== 'missionScroll') {
            return { valor: 999 };
        }

        // Base cost scales with tier and times rolled
        const tier = scroll.itemData.tier || 1;
        const timesRolled = scroll.itemData.timesRolled || 0;

        // Cost formula: base * tier * (1 + timesRolled * 0.5)
        const baseCost = 10;
        const cost = Math.floor(baseCost * tier * (1 + timesRolled * 0.5));

        return { valor: cost };
    }

    /**
     * Get a scroll item by ID
     * @param {string} scrollId - The inventory item ID of the scroll
     * @returns {Object|null} The scroll item or null
     */
    getScrollItem(scrollId) {
        const data = this.getCampaignState();
        if (!data) return null;

        const scroll = data.inventory.items.find(i => i.id === scrollId);
        if (!scroll || scroll.itemType !== 'missionScroll') {
            return null;
        }

        return scroll;
    }

    // ===== NPC UPGRADE SYSTEM =====

    /**
     * NPC upgrade cost table
     * Commander: 1-5 levels, each unlocks higher tier quests
     * Oracle branches: 0-3 levels each
     */
    getNpcUpgradeCosts() {
        return {
            commander: {
                2: { essence: 15 },
                3: { essence: 30 },
                4: { essence: 50 },
                5: { essence: 75 }
            },
            oracle: {
                past: {
                    1: { essence: 10 },
                    2: { essence: 25 },
                    3: { essence: 50 }
                },
                present: {
                    1: { essence: 10 },
                    2: { essence: 25 },
                    3: { essence: 50 }
                },
                future: {
                    1: { essence: 10 },
                    2: { essence: 25 },
                    3: { essence: 50 }
                }
            }
        };
    }

    /**
     * Get the current level of an NPC
     * @param {string} npcId - 'commander' or 'oracle.past', 'oracle.present', 'oracle.future'
     * @returns {number} Current level
     */
    getNpcLevel(npcId) {
        const data = this.getCampaignState();
        if (!data || !data.npcLevels) return npcId === 'commander' ? 1 : 0;

        if (npcId === 'commander') {
            return data.npcLevels.commander || 1;
        } else if (npcId.startsWith('oracle.')) {
            const branch = npcId.split('.')[1];
            return data.npcLevels.oracle?.[branch] || 0;
        }

        return 0;
    }

    /**
     * Get the cost to upgrade an NPC to the next level
     * @param {string} npcId - 'commander' or 'oracle.past', 'oracle.present', 'oracle.future'
     * @returns {Object|null} Cost object or null if at max level
     */
    getNpcUpgradeCost(npcId) {
        const currentLevel = this.getNpcLevel(npcId);
        const costs = this.getNpcUpgradeCosts();

        if (npcId === 'commander') {
            const nextLevel = currentLevel + 1;
            if (nextLevel > 5) return null; // Max level
            return costs.commander[nextLevel] || null;
        } else if (npcId.startsWith('oracle.')) {
            const branch = npcId.split('.')[1];
            const nextLevel = currentLevel + 1;
            if (nextLevel > 3) return null; // Max level
            return costs.oracle[branch]?.[nextLevel] || null;
        }

        return null;
    }

    /**
     * Check if an NPC can be upgraded
     * @param {string} npcId - 'commander' or 'oracle.past', 'oracle.present', 'oracle.future'
     * @returns {boolean} True if can upgrade
     */
    canUpgradeNpc(npcId) {
        const cost = this.getNpcUpgradeCost(npcId);
        if (!cost) return false; // At max level
        return this.canAfford(cost);
    }

    /**
     * Upgrade an NPC to the next level
     * @param {string} npcId - 'commander' or 'oracle.past', 'oracle.present', 'oracle.future'
     * @returns {Object} Result with success flag and new level
     */
    upgradeNpc(npcId) {
        const data = this.getCampaignState();
        if (!data) return { success: false, error: 'No campaign data' };

        const cost = this.getNpcUpgradeCost(npcId);
        if (!cost) return { success: false, error: 'At max level' };

        if (!this.canAfford(cost)) {
            return { success: false, error: 'Cannot afford upgrade' };
        }

        // Deduct the cost
        this.deductCost(cost);

        // Ensure npcLevels exists
        if (!data.npcLevels) {
            data.npcLevels = {
                commander: 1,
                oracle: { past: 0, present: 0, future: 0 }
            };
        }

        let newLevel;
        if (npcId === 'commander') {
            data.npcLevels.commander = (data.npcLevels.commander || 1) + 1;
            newLevel = data.npcLevels.commander;

            // Regenerate available quests at the new tier
            data.availableQuests = this.call.generateAvailableQuests( newLevel);

            console.log('[CampaignSystem] Commander upgraded to level', newLevel);
        } else if (npcId.startsWith('oracle.')) {
            const branch = npcId.split('.')[1];
            if (!data.npcLevels.oracle) {
                data.npcLevels.oracle = { past: 0, present: 0, future: 0 };
            }
            data.npcLevels.oracle[branch] = (data.npcLevels.oracle[branch] || 0) + 1;
            newLevel = data.npcLevels.oracle[branch];

            console.log('[CampaignSystem] Oracle', branch, 'upgraded to level', newLevel);
        }

        this.call.saveCampaign();

        return { success: true, newLevel: newLevel };
    }

    // ===== TAROT CARD COLLECTION =====

    /**
     * Get all collected tarot cards
     * @returns {Array} Array of card IDs
     */
    getCollectedTarotCards() {
        const data = this.getCampaignState();
        return data?.collectedTarotCards || [];
    }

    /**
     * Check if a tarot card is collected
     * @param {string} cardId - The tarot card ID
     * @returns {boolean} True if collected
     */
    hasTarotCard(cardId) {
        const collected = this.getCollectedTarotCards();
        return collected.includes(cardId);
    }

    /**
     * Add a tarot card to the collection
     * @param {string} cardId - The tarot card ID
     * @returns {boolean} True if added (false if already owned)
     */
    addTarotCard(cardId) {
        const data = this.getCampaignState();
        if (!data) return false;

        // Ensure array exists
        if (!data.collectedTarotCards) {
            data.collectedTarotCards = [];
        }

        // Check if already collected
        if (data.collectedTarotCards.includes(cardId)) {
            console.log('[CampaignSystem] Tarot card already collected:', cardId);
            return false;
        }

        // Validate card exists
        const tarotCards = this.collections.tarotCards;
        if (!tarotCards || !tarotCards[cardId]) {
            console.warn('[CampaignSystem] Unknown tarot card:', cardId);
            return false;
        }

        data.collectedTarotCards.push(cardId);
        data.statistics.tarotCardsCollected = (data.statistics.tarotCardsCollected || 0) + 1;

        this.call.saveCampaign();

        console.log('[CampaignSystem] Collected tarot card:', cardId,
                    'Total:', data.collectedTarotCards.length);

        return true;
    }

    /**
     * Get available quests from campaign
     * @returns {Array} Array of available quest objects
     */
    getAvailableQuests() {
        const data = this.getCampaignState();
        return data?.availableQuests || [];
    }

    // ===== TAROT CARD PURCHASE SYSTEM =====

    /**
     * Get the cost to purchase a tarot card from the Oracle
     * Cost varies by card number (higher = more expensive)
     * @param {string} cardId - The tarot card ID
     * @returns {Object} Cost object { essence: number }
     */
    getTarotCardPurchaseCost(cardId) {
        const tarotCards = this.collections.tarotCards;
        const card = tarotCards?.[cardId];

        if (!card) {
            return { essence: 999 };
        }

        // Cost: 5 + (card number / 4) essence, rounded up
        // Card 0 (The Fool) = 5 essence
        // Card 11 = 8 essence
        // Card 21 (The World) = 11 essence
        const baseCost = 5;
        const tierBonus = Math.ceil(card.number / 4);
        return { essence: baseCost + tierBonus };
    }

    /**
     * Check if a tarot card can be purchased
     * @param {string} cardId - The tarot card ID
     * @returns {boolean} True if can purchase
     */
    canPurchaseTarotCard(cardId) {
        // Check if already collected
        if (this.hasTarotCard(cardId)) {
            return false;
        }

        // Check if can afford
        const cost = this.getTarotCardPurchaseCost(cardId);
        return this.canAfford(cost);
    }

    /**
     * Purchase a tarot card from the Oracle
     * @param {string} cardId - The tarot card ID
     * @returns {Object} Result with success flag
     */
    purchaseTarotCard(cardId) {
        if (this.hasTarotCard(cardId)) {
            return { success: false, error: 'Card already collected' };
        }

        const cost = this.getTarotCardPurchaseCost(cardId);
        if (!this.canAfford(cost)) {
            return { success: false, error: 'Cannot afford card' };
        }

        // Deduct cost
        this.deductCost(cost);

        // Add card to collection
        const added = this.addTarotCard(cardId);
        if (!added) {
            return { success: false, error: 'Failed to add card' };
        }

        return { success: true, cardId: cardId };
    }

    /**
     * Get list of tarot cards available for purchase (not yet collected)
     * @returns {Array} Array of card objects with id and purchase cost
     */
    getUncollectedTarotCards() {
        const tarotCards = this.collections.tarotCards || {};
        const collectedCards = this.getCollectedTarotCards();

        return Object.entries(tarotCards)
            .filter(([cardId, card]) => !collectedCards.includes(cardId))
            .map(([cardId, card]) => ({
                id: cardId,
                number: card.number,
                title: card.title,
                cost: this.getTarotCardPurchaseCost(cardId)
            }))
            .sort((a, b) => a.number - b.number);
    }

    // ===== TAROT CARD EFFECT ANALYSIS =====

    /**
     * Determine if a Past position card's effects are beneficial to the player
     * Beneficial effects (buffs) reduce rewards, harmful effects (debuffs) increase rewards
     * @param {Array} effects - Array of effect objects
     * @returns {boolean} True if effects are beneficial
     */
    isPastCardBeneficial(effects) {
        if (!effects || effects.length === 0) return true; // Default to beneficial

        // Check each effect to determine if it helps or hinders the player
        for (const effect of effects) {
            // Negative values for player stats are harmful
            if (effect.target === 'player' || effect.target === 'player_units') {
                if (effect.operation === 'add' && effect.value < 0) return false;
                if (effect.operation === 'multiply' && effect.value < 1) return false;
                if (effect.operation === 'set' && effect.stat === 'noFlee') return true; // Can't flee is double-edged
            }
        }

        return true; // Most past effects are beneficial buffs
    }

    /**
     * Determine if a Present position card's effects make the mission harder
     * Challenges increase rewards, easy modifiers decrease rewards
     * @param {Array} effects - Array of effect objects
     * @returns {boolean} True if effects make the mission harder
     */
    isPresentCardChallenge(effects) {
        if (!effects || effects.length === 0) return false; // Default to neutral

        // Keywords/stats that indicate challenge
        const challengeStats = [
            'extraPacks', 'extraEnemies', 'enemyDamage', 'enemyHealth',
            'noHealing', 'noStealth', 'decoyEnemies', 'randomSpawns',
            'reducedVision', 'fasterEnemies'
        ];

        // Keywords/stats that indicate easier mission
        const easyStats = [
            'noFogOfWar', 'revealEnemies', 'slowEnemies', 'weakerEnemies',
            'fewerEnemies', 'noTimeLimit'
        ];

        for (const effect of effects) {
            if (effect.target === 'mission' || effect.target === 'all_units' || effect.target === 'enemies') {
                // Check if stat indicates challenge
                if (challengeStats.some(s => effect.stat?.includes(s))) return true;
                if (easyStats.some(s => effect.stat?.includes(s))) return false;

                // Extra packs/enemies = harder
                if (effect.stat === 'extraPacks' && effect.value > 0) return true;

                // Accuracy reduction affects everyone - slight challenge
                if (effect.stat === 'accuracy' && effect.value < 1) return true;
            }
        }

        return true; // Default present cards to being challenges (they modify the mission)
    }

    onSceneUnload() {
    }
}
