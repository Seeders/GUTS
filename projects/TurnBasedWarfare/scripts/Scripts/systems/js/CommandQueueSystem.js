class CommandQueueSystem extends GUTS.BaseSystem {
    constructor(game) {
        super(game);
        this.game.commandQueueSystem = this;

        // Command priority levels
        this.PRIORITY = {
            IDLE: 0,           // Default/automatic behavior (mining, patrolling)
            MOVE: 10,          // Player move commands
            BUILD: 20,         // Building construction
            ATTACK: 30,        // Attack commands
            ABILITY: 40,       // Special abilities
            FORCED: 100        // Force commands (cannot be interrupted)
        };

        // Store per-entity AI controller data (migrated from AISystem)
        this.entityAIControllers = new Map();
    }

    init() {
        // Register command queue methods with GameManager
        this.game.gameManager.register('queueCommand', this.queueCommand.bind(this));
        this.game.gameManager.register('executeCommand', this.executeCommand.bind(this));
        this.game.gameManager.register('clearCommands', this.clearCommands.bind(this));
        this.game.gameManager.register('getCurrentCommand', this.getCurrentCommand.bind(this));
        this.game.gameManager.register('canInterruptCommand', this.canInterruptCommand.bind(this));
        this.game.gameManager.register('completeCurrentCommand', this.completeCurrentCommand.bind(this));

        // Register AI controller methods with GameManager (migrated from AISystem)
        this.game.gameManager.register('getAIControllerData', this.getAIControllerData.bind(this));
        this.game.gameManager.register('setAIControllerData', this.setAIControllerData.bind(this));
        this.game.gameManager.register('setCurrentAIController', this.setCurrentAIController.bind(this));
        this.game.gameManager.register('getCurrentAIController', this.getCurrentAIController.bind(this));
        this.game.gameManager.register('getCurrentAIControllerId', this.getCurrentAIControllerId.bind(this));
        this.game.gameManager.register('removeAIController', this.removeAIController.bind(this));
        this.game.gameManager.register('removeCurrentAIController', this.removeCurrentAIController.bind(this));
        this.game.gameManager.register('hasAIControllerData', this.hasAIControllerData.bind(this));
    }

    /**
     * Queue a command for a unit
     * @param {string} entityId - The unit entity ID
     * @param {object} commandData - Command data (type, controllerId, targetPosition, etc.)
     * @param {boolean} interrupt - Whether to interrupt current command if priority is higher
     * @returns {boolean} - Whether the command was queued/executed
     */
    queueCommand(entityId, commandData, interrupt = true) {
        const Components = this.game.gameManager.call('getComponents');

        // Ensure unit has a command queue
        let commandQueue = this.game.getComponent(entityId, "commandQueue");
        if (!commandQueue) {
            commandQueue = { commands: [], currentCommand: null, commandHistory: [] };
            this.game.addComponent(entityId, "commandQueue", commandQueue);
        }

        // Create the command
        // Use provided createdTime if available (for client->server sync), otherwise use current time
        const createdTime = commandData.createdTime || this.game.state.now;
        const command = {
            type: commandData.type,
            controllerId: commandData.controllerId,
            targetPosition: commandData.targetPosition,
            target: commandData.target,
            meta: commandData.meta || {},
            priority: commandData.priority || this.PRIORITY.MOVE,
            interruptible: commandData.interruptible !== false, // Default to true
            createdTime: createdTime,
            id: null
        };

        // Override the command ID with a deterministic ID based on entity ID and time
        // This ensures the same command has the same ID on both client and server
        command.id = `cmd_${entityId}_${createdTime}_${commandData.type}`;

        // Check if we should interrupt current command
        if (interrupt && commandQueue.currentCommand) {
            if (this.canInterruptCommand(entityId, command.priority)) {
                // Store current command as cancelled in history
                commandQueue.commandHistory.push({
                    ...commandQueue.currentCommand,
                    cancelled: true,
                    cancelTime: this.game.state.now
                });

                // Execute new command immediately
                this.executeCommand(entityId, command);
                return true;
            } else {
                // Queue it for later
                commandQueue.commands.push(command);
                // Sort by priority (highest first), with command ID as tie-breaker for determinism
                commandQueue.commands.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
                return true;
            }
        } else if (!commandQueue.currentCommand) {
            // No current command, execute immediately
            this.executeCommand(entityId, command);
            return true;
        } else {
            // Queue it for later
            commandQueue.commands.push(command);
            // Sort by priority (highest first), with command ID as tie-breaker for determinism
            commandQueue.commands.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
            return true;
        }
    }

    /**
     * Execute a command for a unit
     * @param {string} entityId - The unit entity ID
     * @param {object} command - The command to execute
     */
    executeCommand(entityId, command) {
        const Components = this.game.gameManager.call('getComponents');

        // Get command queue
        let commandQueue = this.game.getComponent(entityId, "commandQueue");
        if (!commandQueue) {
            commandQueue = { commands: [], currentCommand: null, commandHistory: [] };
            this.game.addComponent(entityId, "commandQueue", commandQueue);
        }

        // Set as current command
        commandQueue.currentCommand = command;

        // Get AI state
        const aiState = this.game.getComponent(entityId, "aiState");
        if (!aiState) return;

        // CRITICAL: Always clear the path when executing a new command
        aiState.path = [];
        aiState.pathIndex = 0;
        aiState.useDirectMovement = false;

        // Get controller data for this command
        let controllerData = this.getAIControllerData(entityId, command.controllerId);

        // Update controller data with command parameters
        controllerData.targetPosition = command.targetPosition;
        controllerData.target = command.target;
        controllerData.meta = command.meta;
        controllerData.state = command.targetPosition || command.target ? 'chasing' : 'idle';

        // Switch to the command's controller
        this.setCurrentAIController(entityId, command.controllerId, controllerData);

        // Debug logging
        if (this.game.debug) {
            console.log(`[CommandQueue] Executing ${command.type} command for ${entityId}`, {
                controllerId: command.controllerId,
                targetPosition: command.targetPosition,
                priority: command.priority
            });
        }
    }

    /**
     * Clear all commands for a unit
     * @param {string} entityId - The unit entity ID
     */
    clearCommands(entityId) {
        const commandQueue = this.game.getComponent(entityId, "commandQueue");

        if (commandQueue) {
            commandQueue.commands = [];
            if (commandQueue.currentCommand) {
                commandQueue.commandHistory.push({
                    ...commandQueue.currentCommand,
                    cancelled: true,
                    cancelTime: this.game.state.now
                });
                commandQueue.currentCommand = null;
            }
        }
    }

    /**
     * Get current command for a unit
     * @param {string} entityId - The unit entity ID
     * @returns {object|null} - The current command or null
     */
    getCurrentCommand(entityId) {
        const commandQueue = this.game.getComponent(entityId, "commandQueue");
        return commandQueue?.currentCommand || null;
    }

    /**
     * Check if a command can be interrupted by a higher priority command
     * @param {string} entityId - The unit entity ID
     * @param {number} newPriority - Priority of the new command
     * @returns {boolean} - Whether the current command can be interrupted
     */
    canInterruptCommand(entityId, newPriority) {
        const currentCommand = this.getCurrentCommand(entityId);

        if (!currentCommand) return true;
        if (!currentCommand.interruptible) return false;

        return newPriority > currentCommand.priority;
    }

    /**
     * Complete the current command and move to next in queue
     * @param {string} entityId - The unit entity ID
     */
    completeCurrentCommand(entityId) {
        const commandQueue = this.game.getComponent(entityId, "commandQueue");

        if (!commandQueue) return;

        // Move current command to history
        if (commandQueue.currentCommand) {
            // Check if this was a player order
            const isPlayerOrder = commandQueue.currentCommand.meta?.isPlayerOrder === true;

            commandQueue.commandHistory.push({
                ...commandQueue.currentCommand,
                completedTime: this.game.state.now
            });
            commandQueue.currentCommand = null;

            // If a player order just completed, mark it so abilities don't auto-resume this round
            if (isPlayerOrder) {
                commandQueue.playerOrderCompletedThisRound = true;
            }
        }

        // Execute next command in queue if available
        if (commandQueue.commands.length > 0) {
            const nextCommand = commandQueue.commands.shift();
            this.executeCommand(entityId, nextCommand);
        } else {
            // No more commands, return to idle
            const aiState = this.game.getComponent(entityId, "aiState");
            if (aiState) {
                aiState.state = 'idle';
                aiState.targetPosition = null;
                aiState.target = null;
                aiState.path = [];
                aiState.pathIndex = 0;
                aiState.meta = {};
                aiState.aiControllerId = "";
            }
        }
    }

    /**
     * Update command queue system
     */
    onPlacementPhaseStart() {
        const entities = this.game.getEntitiesWith("commandQueue", "aiState");

        for (let i = 0; i < entities.length; i++) {
            const entityId = entities[i];
            const commandQueue = this.game.getComponent(entityId, "commandQueue");

            // Clear the player order completed flag - new round, abilities can auto-resume
            commandQueue.playerOrderCompletedThisRound = false;

            if (commandQueue.currentCommand) {
                const cmd = commandQueue.currentCommand;
                const isPlayerOrder = cmd.meta?.isPlayerOrder === true;

                // Only clear non-player commands
                if (!isPlayerOrder) {
                    this.completeCurrentCommand(entityId);
                }
            }

            if (commandQueue.commands && commandQueue.commands.length > 0) {
                commandQueue.commands = commandQueue.commands.filter(cmd => {
                    const isPlayerOrder = cmd.meta?.isPlayerOrder === true;
                    // Keep player orders, remove AI-generated combat/move commands
                    if (!isPlayerOrder) {
                        return false;
                    }
                    return true;
                });
            }
        }
    }

    /**
     * Clean up command queue when entity is destroyed
     */
    entityDestroyed(entityId) {
        // Clean up AI controller data
        this.entityAIControllers.delete(entityId);
    }

    // ============================================
    // AI Controller Management Methods (migrated from AISystem)
    // ============================================

    /**
     * Get AI controller data for an entity
     * @param {string} entityId - The entity ID
     * @param {string} aiControllerId - The controller ID
     * @returns {object} - The controller data
     */
    getAIControllerData(entityId, aiControllerId) {
        let entityControllersMap = this.getEntityAIControllers(entityId);
        const CT = this.game.gameManager.call('getComponents');
        return entityControllersMap.get(aiControllerId) || CT.aiState('idle');
    }

    /**
     * Set AI controller data for an entity
     * @param {string} entityId - The entity ID
     * @param {string} aiControllerId - The controller ID
     * @param {object} data - The controller data
     * @param {boolean} overwriteControllerId - Whether to overwrite the controller ID in data
     */
    setAIControllerData(entityId, aiControllerId, data, overwriteControllerId = true) {
        let entityControllersMap = this.getEntityAIControllers(entityId);
        if (overwriteControllerId) {
            data.aiControllerId = aiControllerId;
        }
        entityControllersMap.set(aiControllerId, data);
    }

    /**
     * Check if AI controller data exists for an entity
     * @param {string} entityId - The entity ID
     * @param {string} aiControllerId - The controller ID
     * @returns {boolean} - Whether the controller data exists
     */
    hasAIControllerData(entityId, aiControllerId) {
        let entityControllersMap = this.getEntityAIControllers(entityId);
        return entityControllersMap.has(aiControllerId);
    }

    /**
     * Set the current AI controller for an entity
     * @param {string} entityId - The entity ID
     * @param {string} aiControllerId - The controller ID
     * @param {object} data - The controller data
     */
    setCurrentAIController(entityId, aiControllerId, data) {
        this.setAIControllerData(entityId, aiControllerId, data);
        this.setAIControllerData(entityId, "AISystem", data, false);

        let aiState = this.game.getComponent(entityId, "aiState");
        aiState.targetPosition = data.targetPosition;
        aiState.target = data.target;
        aiState.meta = data.meta;
        aiState.aiControllerId = aiControllerId;

        // CRITICAL: Always clear path when switching controllers
        // This prevents units from continuing old paths before executing new commands
        aiState.path = [];
        aiState.pathIndex = 0;
        aiState.useDirectMovement = false;

        // Update state based on new target
        if (data.targetPosition || data.target) {
            aiState.state = data.state || 'chasing';
        } else {
            aiState.state = data.state || 'idle';
        }
    }

    /**
     * Get the current AI controller data for an entity
     * @param {string} entityId - The entity ID
     * @returns {object} - The current controller data
     */
    getCurrentAIController(entityId) {
        return this.getAIControllerData(entityId, "AISystem");
    }

    /**
     * Get the current AI controller ID for an entity
     * @param {string} entityId - The entity ID
     * @returns {string} - The current controller ID
     */
    getCurrentAIControllerId(entityId) {
        return this.getAIControllerData(entityId, "AISystem").aiControllerId;
    }

    /**
     * Remove AI controller data for an entity
     * @param {string} entityId - The entity ID
     * @param {string} aiControllerId - The controller ID
     */
    removeAIController(entityId, aiControllerId) {
        let entityControllersMap = this.getEntityAIControllers(entityId);
        entityControllersMap.delete(aiControllerId);
    }

    /**
     * Remove the current AI controller for an entity
     * @param {string} entityId - The entity ID
     */
    removeCurrentAIController(entityId) {
        const currentAiControllerId = this.getCurrentAIControllerId(entityId);
        this.removeAIController(entityId, currentAiControllerId);
        const CT = this.game.gameManager.call('getComponents');
        this.setAIControllerData(entityId, "AISystem", CT.aiState('idle'), false);
    }

    /**
     * Get the AI controllers map for an entity
     * @param {string} entityId - The entity ID
     * @returns {Map} - The entity's AI controllers map
     */
    getEntityAIControllers(entityId) {
        let entityControllersMap = this.entityAIControllers.get(entityId);
        if (!entityControllersMap) {
            entityControllersMap = new Map();
            this.entityAIControllers.set(entityId, entityControllersMap);
        }
        return entityControllersMap;
    }
}
