class EnemyAISystem extends BaseSystem {
    constructor(game) {
        super(game);
        this.game = game;
    }

    update(deltaTime, now) {
        const enemies = this.game.getEntitiesWith('EnemyAI', 'Position', 'Velocity');

        for (const enemyId of enemies) {
            const ai = this.game.getComponent(enemyId, 'EnemyAI');
            const position = this.game.getComponent(enemyId, 'Position');
            const velocity = this.game.getComponent(enemyId, 'Velocity');

            // Find player
            const player = this.findPlayer();
            if (!player) continue;

            const playerPosition = this.game.getComponent(player, 'Position');
            const dx = playerPosition.x - position.x;
            const dz = playerPosition.z - position.z;
            const distanceToPlayer = Math.sqrt(dx * dx + dz * dz);

            switch (ai.state) {
                case 'idle':
                    this.handleIdleState(enemyId, ai, distanceToPlayer, player);
                    velocity.vx = 0;
                    velocity.vz = 0;
                    break;

                case 'patrol':
                    this.handlePatrolState(enemyId, ai, position, velocity, distanceToPlayer, player);
                    break;

                case 'chase':
                    this.handleChaseState(enemyId, ai, position, velocity, dx, dz, distanceToPlayer, player);
                    break;

                case 'attack':
                    this.handleAttackState(enemyId, ai, position, velocity, dx, dz, distanceToPlayer, player);
                    break;
            }

            // Update facing direction
            if (velocity.vx !== 0 || velocity.vz !== 0) {
                const facing = this.game.getComponent(enemyId, 'Facing');
                if (facing) {
                    facing.angle = Math.atan2(velocity.vx, velocity.vz);
                }
            }
        }
    }

    handleIdleState(enemyId, ai, distanceToPlayer, player) {
        if (distanceToPlayer <= ai.aggroRange) {
            ai.state = 'chase';
            ai.target = player;
        }
    }

    handlePatrolState(enemyId, ai, position, velocity, distanceToPlayer, player) {
        // Aggro check
        if (distanceToPlayer <= ai.aggroRange) {
            ai.state = 'chase';
            ai.target = player;
            return;
        }

        // Move to next patrol point
        if (ai.patrolPath.length === 0) {
            ai.state = 'idle';
            return;
        }

        const targetPoint = ai.patrolPath[ai.currentPatrolIndex];
        const dx = targetPoint.x - position.x;
        const dz = targetPoint.z - position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance < 0.5) {
            // Reached patrol point, move to next
            ai.currentPatrolIndex = (ai.currentPatrolIndex + 1) % ai.patrolPath.length;
        } else {
            // Move towards patrol point
            const moveSpeed = 2;
            velocity.vx = (dx / distance) * moveSpeed;
            velocity.vz = (dz / distance) * moveSpeed;
        }
    }

    handleChaseState(enemyId, ai, position, velocity, dx, dz, distanceToPlayer, player) {
        // Check if player is out of chase range
        if (distanceToPlayer > ai.chaseRange) {
            ai.state = ai.patrolPath.length > 0 ? 'patrol' : 'idle';
            ai.target = null;
            velocity.vx = 0;
            velocity.vz = 0;
            return;
        }

        // Check if in attack range
        if (distanceToPlayer <= ai.attackRange) {
            ai.state = 'attack';
            velocity.vx = 0;
            velocity.vz = 0;
            return;
        }

        // Chase player
        const moveSpeed = 3;
        velocity.vx = (dx / distanceToPlayer) * moveSpeed;
        velocity.vz = (dz / distanceToPlayer) * moveSpeed;
    }

    handleAttackState(enemyId, ai, position, velocity, dx, dz, distanceToPlayer, player) {
        // Check if player moved out of attack range
        if (distanceToPlayer > ai.attackRange * 1.2) {
            ai.state = 'chase';
            return;
        }

        // Check if player is too far away
        if (distanceToPlayer > ai.chaseRange) {
            ai.state = ai.patrolPath.length > 0 ? 'patrol' : 'idle';
            ai.target = null;
            return;
        }

        // Stay still and face player
        velocity.vx = 0;
        velocity.vz = 0;

        const facing = this.game.getComponent(enemyId, 'Facing');
        if (facing) {
            facing.angle = Math.atan2(dx, dz);
        }
    }

    findPlayer() {
        const players = this.game.getEntitiesWith('PlayerController');
        return players.values().next().value;
    }
}
