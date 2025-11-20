class CommandQueueSystem extends engine.BaseSystem {
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
    }

    init() {
        // Register methods with GameManager
        this.game.gameManager.register('queueCommand', this.queueCommand.bind(this));
        this.game.gameManager.register('executeCommand', this.executeCommand.bind(this));
        this.game.gameManager.register('clearCommands', this.clearCommands.bind(this));
        this.game.gameManager.register('getCurrentCommand', this.getCurrentCommand.bind(this));
        this.game.gameManager.register('canInterruptCommand', this.canInterruptCommand.bind(this));
        this.game.gameManager.register('completeCurrentCommand', this.completeCurrentCommand.bind(this));
    }

    /**
     * Queue a command for a unit
     * @param {string} entityId - The unit entity ID
     * @param {object} commandData - Command data (type, controllerId, targetPosition, etc.)
     * @param {boolean} interrupt - Whether to interrupt current command if priority is higher
     * @returns {boolean} - Whether the command was queued/executed
     */
    queueCommand(entityId, commandData, interrupt = true) {
        const ComponentTypes = this.game.componentTypes;
        const Components = this.game.componentManager.getComponents();

        // Ensure unit has a command queue
        let commandQueue = this.game.getComponent(entityId, ComponentTypes.COMMAND_QUEUE);
        if (!commandQueue) {
            commandQueue = Components.CommandQueue();
            this.game.addComponent(entityId, ComponentTypes.COMMAND_QUEUE, commandQueue);
        }

        // Create the command
        // Use provided createdTime if available (for client->server sync), otherwise use current time
        const createdTime = commandData.createdTime || this.game.state.now;
        const command = Components.Command(
            commandData.type,
            commandData.controllerId,
            commandData.targetPosition,
            commandData.target,
            commandData.meta || {},
            commandData.priority || this.PRIORITY.MOVE,
            commandData.interruptible !== false, // Default to true
            createdTime
        );

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
        const ComponentTypes = this.game.componentTypes;
        const Components = this.game.componentManager.getComponents();

        // Get command queue
        let commandQueue = this.game.getComponent(entityId, ComponentTypes.COMMAND_QUEUE);
        if (!commandQueue) {
            commandQueue = Components.CommandQueue();
            this.game.addComponent(entityId, ComponentTypes.COMMAND_QUEUE, commandQueue);
        }

        // Set as current command
        commandQueue.currentCommand = command;

        // Get AI state
        const aiState = this.game.getComponent(entityId, ComponentTypes.AI_STATE);
        if (!aiState) return;

        // CRITICAL: Always clear the path when executing a new command
        aiState.path = [];
        aiState.pathIndex = 0;
        aiState.useDirectMovement = false;

        // Get controller data for this command
        let controllerData = this.game.aiSystem.getAIControllerData(entityId, command.controllerId);

        // Update controller data with command parameters
        controllerData.targetPosition = command.targetPosition;
        controllerData.target = command.target;
        controllerData.meta = command.meta;
        controllerData.state = command.targetPosition || command.target ? 'chasing' : 'idle';

        // Switch to the command's controller
        this.game.aiSystem.setCurrentAIController(entityId, command.controllerId, controllerData);

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
        const ComponentTypes = this.game.componentTypes;
        const commandQueue = this.game.getComponent(entityId, ComponentTypes.COMMAND_QUEUE);

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
        const ComponentTypes = this.game.componentTypes;
        const commandQueue = this.game.getComponent(entityId, ComponentTypes.COMMAND_QUEUE);
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
        const ComponentTypes = this.game.componentTypes;
        const commandQueue = this.game.getComponent(entityId, ComponentTypes.COMMAND_QUEUE);

        if (!commandQueue) return;

        // Move current command to history
        if (commandQueue.currentCommand) {
            commandQueue.commandHistory.push({
                ...commandQueue.currentCommand,
                completedTime: this.game.state.now
            });
            commandQueue.currentCommand = null;
        }

        // Execute next command in queue if available
        if (commandQueue.commands.length > 0) {
            const nextCommand = commandQueue.commands.shift();
            this.executeCommand(entityId, nextCommand);
        } else {
            // No more commands, return to idle
            const aiState = this.game.getComponent(entityId, ComponentTypes.AI_STATE);
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
     * Called every frame to check if commands need to be processed
     */
    onPlacementPhaseStart() {
        const ComponentTypes = this.game.componentTypes;
        const entities = this.game.getEntitiesWith(ComponentTypes.COMMAND_QUEUE, ComponentTypes.AI_STATE);

        for (let i = 0; i < entities.length; i++) {
            const entityId = entities[i];
            const commandQueue = this.game.getComponent(entityId, ComponentTypes.COMMAND_QUEUE);
                
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
        // Nothing to clean up - component will be removed automatically
    }
}
