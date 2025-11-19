class CombatAISystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.combatAISystems = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();
        
        this.DEFAULT_UNIT_RADIUS = 25;
        this.ATTACK_RANGE_BUFFER = 10;
        this.ALLY_SPACING_DISTANCE = 10;
        this.ENEMY_SPACING_DISTANCE = 5;
        this.AVOIDANCE_RADIUS_MULTIPLIER = 1;
        this.STRONG_AVOIDANCE_FORCE = 50;
        this.GENTLE_AVOIDANCE_FORCE = 10;

        this.TARGET_SWITCH_COOLDOWN = 0.3;
        this.MOVEMENT_DECISION_INTERVAL = 0.05;

        this.MIN_ATTACK_ANIMATION_TIME = 0.4;
        this.STATE_CHANGE_COOLDOWN = 0.1;

        this.DAMAGE_TIMING_RATIO = 0.5;

        // Use placement grid size (half of terrain grid) for position threshold
        this.TARGET_POSITION_THRESHOLD = this.game.getCollections().configs.game.gridSize / 2 * 0.5;
        // Debug logging
        this.DEBUG_ENEMY_DETECTION = true; // Set to false to disable debug
    }

    init() {
        this.game.gameManager.register('setRetaliatoryTarget', this.setRetaliatoryTarget.bind(this));
        this.game.gameManager.register('startDeathProcess', this.startDeathProcess.bind(this));
        this.game.gameManager.register('calculateAnimationSpeed', this.calculateAnimationSpeed.bind(this));
    }

    // Called once when phase transitions to placement - synchronized across all clients
    onPlacementPhaseStart() {
        const CT = this.componentTypes;
        const combatUnits = this.game.getEntitiesWith(CT.AI_STATE);

        for (let i = 0; i < combatUnits.length; i++) {
            const entityId = combatUnits[i];
            const aiState = this.game.getComponent(entityId, CT.AI_STATE);
            if (aiState) {
                if (aiState.state !== 'idle') {
                    this.changeAIState(aiState, 'idle');
                }
                // Clear targetPosition to prevent stale movement data in next round
                aiState.targetPosition = null;
            }
            // Don't clear targets - let units remember their last target for next round
        }
    }

    update() {
        const CT = this.componentTypes;
        if (this.game.state.phase !== 'battle') {
            return;
        }

        const combatUnits = this.game.getEntitiesWith(
            CT.POSITION, CT.COMBAT, CT.TEAM, CT.AI_STATE
        );
        for (let i = 0; i < combatUnits.length; i++) {
            const entityId = combatUnits[i];
            const pos = this.game.getComponent(entityId, CT.POSITION);
            const combat = this.game.getComponent(entityId, CT.COMBAT);
            const team = this.game.getComponent(entityId, CT.TEAM);
            const aiState = this.game.getComponent(entityId, CT.AI_STATE);
            const vel = this.game.getComponent(entityId, CT.VELOCITY);
            const collision = this.game.getComponent(entityId, CT.COLLISION);
            const unitType = this.game.getComponent(entityId, CT.UNIT_TYPE);

            if (!pos || !vel || !combat || !team || !aiState){
                 continue;
            }
            
            // DEBUG: Log combat range and position
            const preventEnemiesInRangeCheck = aiState.meta ? aiState.meta.preventEnemiesInRangeCheck : false; 
            if (!aiState.meta.initialized) {
                aiState.meta = {
                    lastDecisionTime: 0,
                    targetLockTime: 0,
                    lastStateChange: 0,
                    lastAttackStart: 0,
                    initialized: true
                };
            }
            const aiMeta = aiState.meta;

            const enemiesInVisionRange = preventEnemiesInRangeCheck ? [] : (this.getAllEnemiesInVision(entityId, pos, unitType, team, combat) || []);
            
            // DEBUG: Log enemies found
            if (aiState.target) {
                const targetHealth = this.game.getComponent(aiState.target, this.componentTypes.HEALTH);
                const targetDeathState = this.game.getComponent(aiState.target, this.componentTypes.DEATH_STATE);
                if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
                    aiState.target = null;                                    
                    this.onLostTarget(entityId);  
                }
            }
            if(aiState.targetPosition){
                const distance = Math.sqrt(
                    Math.pow( aiState.targetPosition.x - pos.x, 2) + 
                    Math.pow( aiState.targetPosition.z - pos.z, 2)
                );
                aiState.targetDistance = distance;
            } else {
                aiState.targetDistance = 0;
            }
            if (enemiesInVisionRange.length === 0) {
                if(aiState.targetPosition){
                    if(aiState.targetDistance > this.TARGET_POSITION_THRESHOLD && !vel.anchored){
                        if(aiState.state !== 'chasing'){
                            this.changeAIState(aiState, 'chasing');
                        }
                    } else {
                        if (aiState.state !== 'idle') {
                            
                            let currentAI = this.game.gameManager.call('getCurrentAIControllerId', entityId);
                            if(currentAI == "CombatAISystem"){
                                this.onLostTarget(entityId);
                            }
                            this.changeAIState(aiState, 'idle');
                        }
                    }
                }   
            }

            if (aiMeta.nextMoveTime == null) aiMeta.nextMoveTime = 0;
    
            if (aiState.state !== 'waiting') {
                aiMeta.nextMoveTime = this.game.state.now + this.MOVEMENT_DECISION_INTERVAL;
                this.makeAIDecision(entityId, pos, combat, team, aiState, enemiesInVisionRange, collision);
                aiMeta.lastDecisionTime = this.game.state.now;
            }

            this.handleCombat(entityId, pos, combat, aiState, collision);
        }
    }

    getAllEnemiesInVision(entityId, pos, unitType, team, combat) {
        const allUnits = this.game.getEntitiesWith(
            this.componentTypes.POSITION,
            this.componentTypes.TEAM,
            this.componentTypes.HEALTH
        );

        const visionRange = combat.visionRange;

        const enemies = allUnits.filter(otherId => {
            if (otherId === entityId) return false;

            const otherTeam = this.game.getComponent(otherId, this.componentTypes.TEAM);
            const otherHealth = this.game.getComponent(otherId, this.componentTypes.HEALTH);
            const otherDeathState = this.game.getComponent(otherId, this.componentTypes.DEATH_STATE);
            const otherPos = this.game.getComponent(otherId, this.componentTypes.POSITION);

            if (!otherTeam || otherTeam.team === team.team) return false;
            if (!otherHealth || otherHealth.current <= 0) return false;
            if (otherDeathState && otherDeathState.isDying) return false;
            if (!otherPos) return false;

            return this.isInVisionRange(entityId, otherId, visionRange) && this.game.gameManager.call('hasLineOfSight', pos, otherPos, unitType, entityId);
        });

        // Sort for deterministic order (prevents desync)
        return enemies.sort((a, b) => String(a).localeCompare(String(b)));
    }


    changeAIState(aiState, newState) {

        const aiMeta = aiState.meta;
        if (this.game.state.now - aiMeta.lastStateChange < this.STATE_CHANGE_COOLDOWN) return false;
        if (aiState.state === 'attacking') {
            const attackDuration = this.game.state.now - aiMeta.lastAttackStart;
            if (attackDuration < this.MIN_ATTACK_ANIMATION_TIME) return false;
        }
        if (aiState.state !== newState) {
            aiState.state = newState;
            aiMeta.lastStateChange = this.game.state.now;
            if (newState === 'attacking') aiMeta.lastAttackStart = this.game.state.now;
            return true;
        }
        return false;
    }

    makeAIDecision(entityId, pos, combat, team, aiState, enemiesInVisionRange, collision) {
        // CHANGED: Always try to find the best target from ALL enemies
        let targetEnemy = this.findBestTarget(entityId, pos, combat.range, enemiesInVisionRange, aiState);
        
        if (!targetEnemy) {
            aiState.target = null;
            this.onLostTarget(entityId);
            return;
        }
        
        const targetHealth = this.game.getComponent(targetEnemy, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(targetEnemy, this.componentTypes.DEATH_STATE);
        if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
            aiState.target = null;
            return;
        }
        
        const enemyPos = this.game.getComponent(targetEnemy, this.componentTypes.POSITION);
        if (!enemyPos) return;

        let currentCombatAi = this.game.gameManager.call('getAIControllerData', entityId, "CombatAISystem");
        let currentAI = this.game.gameManager.call('getCurrentAIControllerId', entityId);

        // Set the target
        currentCombatAi.target = targetEnemy;
        aiState.target = targetEnemy;

        // Check if we have direct line of sight to the target
        const unitType = this.game.getComponent(entityId, this.componentTypes.UNIT_TYPE);
        const hasLOS = this.game.gameManager.call('hasLineOfSight', pos, enemyPos, unitType, entityId);
        const hasDirectPath = this.game.gameManager.call('hasDirectWalkablePath', pos, enemyPos, entityId);

        if (hasLOS && hasDirectPath) {
            // Can see AND walk directly - use steering only
            aiState.path = null;
            aiState.useDirectMovement = true;
        } 

        if(currentAI != "CombatAISystem"){
            // Queue attack command through command queue system
            if (this.game.commandQueueSystem) {
                // Queue attack command with ATTACK priority
                this.game.gameManager.call('queueCommand', entityId, {
                    type: 'attack',
                    controllerId: "CombatAISystem",
                    targetPosition: null,
                    target: targetEnemy,
                    meta: {},
                    priority: this.game.commandQueueSystem.PRIORITY.ATTACK,
                    interruptible: true
                }, true); // true = interrupt lower priority commands
            }
        }
        if (this.isInAttackRange(entityId, targetEnemy, combat)) {
            // Check if this is a spell caster and if abilities are available
   
            this.changeAIState(aiState, 'attacking');
        } else {
            if(aiState.state !== 'chasing'){
                this.changeAIState(aiState, 'chasing');
            }
        }
    }

    findBestTarget(entityId, pos, range, enemiesInVisionRange, aiState) {
        const aiMeta = aiState.meta;
        let bestTarget = null;
        let bestScore = -Infinity;
        
        // If unit is currently attacking, stick with current target unless switching would be much better
        if (aiState.target && enemiesInVisionRange.includes(aiState.target)) {
            const currentTargetHealth = this.game.getComponent(aiState.target, this.componentTypes.HEALTH);
            const currentTargetDeathState = this.game.getComponent(aiState.target, this.componentTypes.DEATH_STATE);
            const currentTargetPos = this.game.getComponent(aiState.target, this.componentTypes.POSITION);

            const isCurrentTargetValid = currentTargetHealth && 
                                       currentTargetHealth.current > 0 && 
                                       (!currentTargetDeathState || !currentTargetDeathState.isDying) &&
                                       currentTargetPos;
            
            if (isCurrentTargetValid) {
                // Calculate current target score
                const currentDistance = Math.sqrt(
                    Math.pow(currentTargetPos.x - pos.x, 2) + 
                    Math.pow(currentTargetPos.z - pos.z, 2)
                );
                const currentHealthRatio = currentTargetHealth.current / (currentTargetHealth.max || currentTargetHealth.current);
                const currentScore = this.calculateTargetScore(currentDistance, currentHealthRatio, true);
                
                // Only switch if we find a significantly better target
                bestScore = currentScore * 1.2; // 20% bonus for current target (sticky targeting)
                bestTarget = aiState.target;
            }
        }
        
        // Evaluate all enemies to find the best target
        enemiesInVisionRange.forEach(enemyId => {
            const enemyPos = this.game.getComponent(enemyId, this.componentTypes.POSITION);
            const enemyHealth = this.game.getComponent(enemyId, this.componentTypes.HEALTH);
            const enemyDeathState = this.game.getComponent(enemyId, this.componentTypes.DEATH_STATE);
            
            if (!enemyPos || !enemyHealth || enemyHealth.current <= 0) return;
            if (enemyDeathState && enemyDeathState.isDying) return;
            
            const distance = Math.sqrt(
                Math.pow(enemyPos.x - pos.x, 2) + 
                Math.pow(enemyPos.z - pos.z, 2)
            );

            const healthRatio = enemyHealth.current / (enemyHealth.max || enemyHealth.current);
            const isCurrentTarget = (enemyId === aiState.target);
            
            const score = this.calculateTargetScore(distance, healthRatio, isCurrentTarget);

            // Use deterministic tie-breaking (entity ID) to prevent desync
            if (score > bestScore || (score === bestScore && bestTarget !== null && String(enemyId).localeCompare(String(bestTarget)) < 0)) {
                bestScore = score;
                bestTarget = enemyId;
            }

        });
        
        if (bestTarget !== aiState.target) {
            aiMeta.targetLockTime = this.game.state.now;
        }
        
        return bestTarget;
    }

    calculateTargetScore(distance, healthRatio, isCurrentTarget) {
        let score = 0;
        
        // Distance factor - closer is better, but not overwhelmingly so
        // Use logarithmic scaling so very far enemies are still viable
        const maxDistance = 20000; // Assume max battlefield size
        const distanceFactor = Math.max(0, (maxDistance - distance) / maxDistance);
        score += distanceFactor * 100;    

        
        // Current target bonus for stability
        if (isCurrentTarget) {
            score += 50000;
        }
        
        
        return score;
    }

    onLostTarget(entityId) {
        let aiState = this.game.getComponent(entityId, this.game.componentTypes.AI_STATE);
        aiState.useDirectMovement = false;
        aiState.target = null;

        // Complete the current attack command through the command queue
        // This lets the queue handle what comes next (idle or next queued command)
        if (this.game.commandQueueSystem) {
            const currentCommand = this.game.gameManager.call('getCurrentCommand', entityId);
            if (currentCommand && currentCommand.type === 'attack') {
                this.game.gameManager.call('completeCurrentCommand', entityId);
            }
        }
    }

    handleCombat(entityId, pos, combat, aiState, collision) {
        const aiMeta = aiState.meta;
        if (!aiState.target || aiState.state !== 'attacking'){
           // console.log('no target or not attacking', aiState); 
            return;
        }
        
        const targetPos = this.game.getComponent(aiState.target, this.componentTypes.POSITION);
        const targetHealth = this.game.getComponent(aiState.target, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(aiState.target, this.componentTypes.DEATH_STATE);
        
        if (!targetPos || !targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) {
            aiState.target = null;
            this.onLostTarget(entityId);       
            return;
        }
        
        if (!this.isInAttackRange(entityId, aiState.target, combat, 5)) {
            this.changeAIState(aiState, 'chasing');
            console.log('not in attack range');
            return;
        }
        
        // Handle melee units with damage > 0
        if (combat.damage > 0) {
            const effectiveAttackSpeed = this.getEffectiveAttackSpeed(entityId, combat.attackSpeed);
            if ((this.game.state.now - combat.lastAttack) >= 1 / effectiveAttackSpeed) {
                this.initiateAttack(entityId, aiState.target, combat);
                combat.lastAttack = this.game.state.now;
                aiMeta.lastAttackStart = this.game.state.now;
            }
        }           
    }

    log(){
        if(arguments[0].indexOf("barbarian") >= 0){
            console.log(...arguments)
        }
    }
    
    initiateAttack(attackerId, targetId, combat) {
        const targetHealth = this.game.getComponent(targetId, this.componentTypes.HEALTH);
        const targetDeathState = this.game.getComponent(targetId, this.componentTypes.DEATH_STATE);
        if (!targetHealth || targetHealth.current <= 0 || (targetDeathState && targetDeathState.isDying)) return;

        // Make the attacker face the target
        const attackerPos = this.game.getComponent(attackerId, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        const facing = this.game.getComponent(attackerId, this.componentTypes.FACING);

        if (attackerPos && targetPos && facing) {
            const dx = targetPos.x - attackerPos.x;
            const dz = targetPos.z - attackerPos.z;
            const angleToTarget = Math.atan2(dz, dx);
            facing.angle = angleToTarget;
        }

        if(this.game.gameManager.has('triggerSinglePlayAnimation')){
            const animationSpeed = this.calculateAnimationSpeed(attackerId, combat.attackSpeed);
            const minAnimationTime = 1 / combat.attackSpeed * 0.8; // 80% of attack interval
            this.game.gameManager.call('triggerSinglePlayAnimation', attackerId, 'attack', animationSpeed, minAnimationTime);
        }

        if (combat.projectile) {
            this.scheduleProjectileLaunch(attackerId, targetId, combat);
        } else {
            this.scheduleMeleeDamage(attackerId, targetId, combat);
        }
    }

    calculateAnimationSpeed(attackerId, animationSpeed) {
        const attackInterval = 1 / animationSpeed;
        
        // Default fallback duration
        let baseAnimationDuration = 0.8;
        
        if (this.game.gameManager.has('getEntityAnimations')) {
            // NEW: Get duration from VAT bundle instead of mixer actions
            const CT = this.componentTypes;
            const renderable = this.game.getComponent(attackerId, CT.RENDERABLE);
            
            if (renderable) {
                const batchInfo = this.game.renderSystem?.getBatchInfo(
                    renderable.objectType, 
                    renderable.spawnType
                );
                
                if (batchInfo) {
                    const bundle = this.game.modelManager?.getVATBundle(
                        renderable.objectType, 
                        renderable.spawnType
                    );
                    
                    if (bundle?.meta?.clips) {
                        // Find attack clip duration
                        const attackClip = bundle.meta.clips.find(clip => 
                            clip.name === 'attack' || clip.name === 'combat' || clip.name === 'fight'
                        );
                        if (attackClip) {
                            baseAnimationDuration = attackClip.duration;
                        }
                    }
                }
            }
            
            // OLD SYSTEM COMPATIBILITY (remove this once VAT is working):
            // Keep this as fallback in case you need it temporarily
            const entityAnimations = this.game.gameManager.call('getEntityAnimations');
            if (entityAnimations) {
                const animationActions = entityAnimations.get(attackerId);
                if (animationActions && animationActions.attack) {
                    const attackAction = animationActions.attack;
                    if (attackAction.getClip) {
                        baseAnimationDuration = attackAction.getClip().duration;
                    }
                }
            }
        }
        
        // Calculate speed to fit animation into attack interval
        const targetAnimationDuration = Math.max(attackInterval * 0.9, 0.2);
        let resultSpeed = baseAnimationDuration / targetAnimationDuration;
        
        return resultSpeed;
    }

    scheduleMeleeDamage(attackerId, targetId, combat) {
        if (!this.game.damageSystem) {
            console.warn('DamageSystem not found, cannot schedule melee damage');
            return;
        }

        const attackInterval = 1 / combat.attackSpeed;
        const damageDelay = attackInterval * this.DAMAGE_TIMING_RATIO;
    
        const element = this.getDamageElement(attackerId, combat);
        
        this.game.gameManager.call('scheduleDamage',
            attackerId,
            targetId,
            combat.damage,
            element,
            damageDelay,
            {
                isMelee: true,
                weaponRange: combat.range + this.ATTACK_RANGE_BUFFER + 1
            }
        );
    }

    scheduleProjectileLaunch(attackerId, targetId, combat) {
        const attackInterval = 1 / combat.attackSpeed;
        const launchDelay = attackInterval * this.DAMAGE_TIMING_RATIO;
        
        // Clean generic scheduling
        this.game.gameManager.call('scheduleAction', () => {
            this.fireProjectileAttack(attackerId, targetId, combat.projectile);
        }, launchDelay, attackerId);
    }

    fireProjectileAttack(attackerId, targetId, projectileTypeId) {
        if (!this.game.projectileSystem) return;
        const projectileData = this.game.getCollections().projectiles[projectileTypeId];
        if (!projectileData) return;
        this.game.gameManager.call('fireProjectile', attackerId, targetId, {
            id: projectileTypeId,
            ...projectileData
        });
    }

    getDamageElement(entityId, combat) {
        if (combat.element) {
            return combat.element;
        }
        
        const weaponElement = this.getWeaponElement(entityId);
        if (weaponElement) {
            return weaponElement;
        }
        
        return this.game.damageSystem?.ELEMENT_TYPES?.PHYSICAL || 'physical';
    }

    getWeaponElement(entityId) {
        if (!this.game.equipmentSystem) return null;
        
        const equipment = this.game.getComponent(entityId, this.componentTypes.EQUIPMENT);
        if (!equipment) return null;
        
        const mainHandItem = equipment.slots.mainHand;
        if (mainHandItem) {
            const itemData = this.game.gameManager.call('getItemData', mainHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }

        const offHandItem = equipment.slots.offHand;
        if (offHandItem) {
            const itemData = this.game.gameManager.call('getItemData', offHandItem);
            if (itemData && itemData.stats && itemData.stats.element) {
                return itemData.stats.element;
            }
        }
        
        return null;
    }

    calculateDistances(pos1, pos2, collision1, collision2) {
        const dx = pos2.x - pos1.x;
        const dz = pos2.z - pos1.z;
        const centerToCenterDistance = Math.sqrt(dx * dx + dz * dz);
        const radius1 = this.getUnitRadius(collision1);
        const radius2 = this.getUnitRadius(collision2);
        const edgeToEdgeDistance = Math.max(0, centerToCenterDistance - radius1 - radius2);
        const distanceToTargetEdge = Math.max(0, centerToCenterDistance - radius2);
        return {
            centerToCenter: centerToCenterDistance,
            edgeToEdge: edgeToEdgeDistance,
            attackerCenterToTargetEdge: distanceToTargetEdge,
            attackerRadius: radius1,
            targetRadius: radius2
        };
    }

    isInAttackRange(attackerId, targetId, combat, extraBuffer = 0) {
        const attackerPos = this.game.getComponent(attackerId, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        const attackerCollision = this.game.getComponent(attackerId, this.componentTypes.COLLISION);
        const targetCollision = this.game.getComponent(targetId, this.componentTypes.COLLISION);
        if (!attackerPos || !targetPos) return false;

        const distances = this.calculateDistances(attackerPos, targetPos, attackerCollision, targetCollision);
        const effectiveRange = combat.range + this.ATTACK_RANGE_BUFFER + extraBuffer;
        return distances.attackerCenterToTargetEdge <= effectiveRange;
    }

    isInVisionRange(viewerId, targetId, visionRange) {
        const viewerPos = this.game.getComponent(viewerId, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        const viewerCollision = this.game.getComponent(viewerId, this.componentTypes.COLLISION);
        const targetCollision = this.game.getComponent(targetId, this.componentTypes.COLLISION);
        if (!viewerPos || !targetPos) return false;

        const distances = this.calculateDistances(viewerPos, targetPos, viewerCollision, targetCollision);
        return distances.attackerCenterToTargetEdge <= visionRange;
    }

    isWithinEdgeToEdgeRange(attackerId, targetId, maxRange) {
        const attackerPos = this.game.getComponent(attackerId, this.componentTypes.POSITION);
        const targetPos = this.game.getComponent(targetId, this.componentTypes.POSITION);
        const attackerCollision = this.game.getComponent(attackerId, this.componentTypes.COLLISION);
        const targetCollision = this.game.getComponent(targetId, this.componentTypes.COLLISION);
        if (!attackerPos || !targetPos) return false;
        const distances = this.calculateDistances(attackerPos, targetPos, attackerCollision, targetCollision);
        return distances.edgeToEdge <= maxRange;
    }

    getUnitRadius(collision) {
        if (collision && collision.radius) {
            return Math.max(this.DEFAULT_UNIT_RADIUS, collision.radius);
        }
        return this.DEFAULT_UNIT_RADIUS;
    }

    startDeathProcess(entityId) {

        const ComponentTypes = this.game.componentManager.getComponentTypes();
        const Components = this.game.componentManager.getComponents();
        const existingDeathState = this.game.getComponent(entityId, ComponentTypes.DEATH_STATE);
        if (existingDeathState && existingDeathState.isDying) return;
        
        if (this.game.damageSystem) {
            this.game.gameManager.call('clearAllStatusEffects', entityId);
        }
        
        this.game.addComponent(entityId, ComponentTypes.DEATH_STATE, Components.DeathState(true, this.game.state.now, 2.0));
        if (this.game.hasComponent(entityId, ComponentTypes.AI_STATE)) {
            this.game.removeComponent(entityId, ComponentTypes.AI_STATE);
        }
        const velocity = this.game.getComponent(entityId, ComponentTypes.VELOCITY);
        if (velocity) { velocity.x = 0; velocity.y = 0; velocity.z = 0; }
        
        if (this.game.hasComponent(entityId, ComponentTypes.COMBAT)) {
            this.game.removeComponent(entityId, ComponentTypes.COMBAT);
        }
        
        if (this.game.animationSystem) {
            this.game.gameManager.call('playDeathAnimation', entityId);
        }
        if(this.game.abilitySystem){
            this.game.gameManager.call('removeEntityAbilities', entityId);
        }
    }
    
    applyDamage(sourceId, targetId, damage, element, options = {}) {
        if (!this.game.damageSystem) {
            console.warn('DamageSystem not found, cannot apply damage');
            return { damage: 0, prevented: true, reason: 'no_damage_system' };
        }
                
        return this.game.gameManager.call('applyDamage', sourceId, targetId, damage, element, options);
    }

    applySplashDamage(sourceId, centerPos, damage, element, radius, options = {}) {
        if (!this.game.damageSystem) {
            console.warn('DamageSystem not found, cannot apply splash damage');
            return [];
        }
        
        return this.game.gameManager.call('applySplashDamage', sourceId, centerPos, damage, element, radius, options);
    }

    curePoison(targetId, stacksToRemove = null) {
        if (!this.game.damageSystem) {
            console.warn('DamageSystem not found, cannot cure poison');
            return false;
        }

        return this.game.gameManager.call('curePoison', targetId, stacksToRemove);
    }

    getPoisonStacks(entityId) {
        if (!this.game.damageSystem) {
            return 0;
        }

        return this.game.gameManager.call('getPoisonStacks', entityId);
    }

    getEffectiveAttackSpeed(entityId, baseAttackSpeed) {
        const attackerMods = this.game.gameManager.call('getAttackerModifiers', entityId);
        return baseAttackSpeed * (attackerMods.attackSpeedMultiplier || 1.0);
    }

    getStatusEffects(entityId) {
        if (!this.game.damageSystem) {
            return { poison: [] };
        }

        return this.game.gameManager.call('getStatusEffects', entityId);
    }

    setRetaliatoryTarget(entityId, attackerId) {
        const aiState = this.game.getComponent(entityId, this.componentTypes.AI_STATE);
        if (!aiState) return;
        
        if (aiState.target) return;
        
        const attackerHealth = this.game.getComponent(attackerId, this.componentTypes.HEALTH);
        const attackerDeathState = this.game.getComponent(attackerId, this.componentTypes.DEATH_STATE);
        if (!attackerHealth || attackerHealth.current <= 0) return;
        if (attackerDeathState && attackerDeathState.isDying) return;
        
        const attackerTeam = this.game.getComponent(attackerId, this.componentTypes.TEAM);
        const defenderTeam = this.game.getComponent(entityId, this.componentTypes.TEAM);
        if (attackerTeam && defenderTeam && attackerTeam.team === defenderTeam.team) return;
        
        aiState.target = attackerId;
    }

    debugStatusEffects() {
        if (!this.game.damageSystem) {
            return;
        }

        this.game.gameManager.call('debugStatusEffects');
    }
}