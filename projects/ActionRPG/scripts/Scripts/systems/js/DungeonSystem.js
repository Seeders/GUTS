class DungeonSystem extends engine.BaseSystem {
    constructor(game) {
        super(game);
        this.game.dungeonSystem = this;
        this.componentTypes = this.game.componentManager.getComponentTypes();

        // Dungeon configuration
        this.currentFloor = 1;
        this.rooms = [];
        this.corridors = [];

        // Room types
        this.ROOM_SIZE = 300;
        this.MIN_ROOMS = 5;
        this.MAX_ROOMS = 12;
    }

    init() {
        this.game.gameManager.register('generateDungeon', this.generateDungeon.bind(this));
        this.game.gameManager.register('getCurrentFloor', () => this.currentFloor);
        this.game.gameManager.register('nextFloor', this.nextFloor.bind(this));
        this.game.gameManager.register('getRooms', () => this.rooms);
    }

    generateDungeon(floor = 1) {
        this.currentFloor = floor;
        this.rooms = [];
        this.corridors = [];

        const numRooms = this.MIN_ROOMS + Math.floor(Math.random() * (this.MAX_ROOMS - this.MIN_ROOMS));

        // Generate rooms using BSP
        this.generateRooms(numRooms);

        // Connect rooms
        this.connectRooms();

        // Place spawn point in first room
        if (this.rooms.length > 0) {
            const spawn = this.rooms[0];
            this.game.gameManager.call('setSpawnPoint', spawn.x, 0, spawn.z);
        }

        // Place exit in last room
        if (this.rooms.length > 1) {
            const exit = this.rooms[this.rooms.length - 1];
            exit.isExit = true;
        }

        // Spawn enemies in rooms
        this.populateRooms();

        // Spawn boss on every 5th floor
        if (floor % 5 === 0 && this.rooms.length > 1) {
            const bossRoom = this.rooms[this.rooms.length - 1];
            bossRoom.isBossRoom = true;
            this.spawnBoss(bossRoom);
        }

        this.game.triggerEvent('onDungeonGenerated', {
            floor: this.currentFloor,
            rooms: this.rooms.length
        });

        return this.rooms;
    }

    generateRooms(count) {
        const gridSize = Math.ceil(Math.sqrt(count)) + 1;
        const spacing = this.ROOM_SIZE * 1.5;

        for (let i = 0; i < count; i++) {
            const gridX = i % gridSize;
            const gridZ = Math.floor(i / gridSize);

            // Add some randomness to position
            const offsetX = (Math.random() - 0.5) * this.ROOM_SIZE * 0.3;
            const offsetZ = (Math.random() - 0.5) * this.ROOM_SIZE * 0.3;

            const room = {
                id: i,
                x: gridX * spacing + offsetX,
                z: gridZ * spacing + offsetZ,
                width: this.ROOM_SIZE * (0.8 + Math.random() * 0.4),
                height: this.ROOM_SIZE * (0.8 + Math.random() * 0.4),
                type: this.getRandomRoomType(),
                enemies: [],
                cleared: false
            };

            this.rooms.push(room);
        }
    }

    getRandomRoomType() {
        const types = ['normal', 'normal', 'normal', 'treasure', 'shrine', 'trap'];
        return types[Math.floor(Math.random() * types.length)];
    }

    connectRooms() {
        // Connect each room to its nearest neighbor
        for (let i = 1; i < this.rooms.length; i++) {
            const room = this.rooms[i];
            const prev = this.rooms[i - 1];

            this.corridors.push({
                from: prev,
                to: room
            });
        }
    }

    populateRooms() {
        const baseEnemies = 2 + Math.floor(this.currentFloor / 2);

        this.rooms.forEach((room, index) => {
            if (index === 0) return; // Skip spawn room

            const enemyCount = room.type === 'treasure' ?
                baseEnemies + 2 :
                baseEnemies + Math.floor(Math.random() * 3);

            for (let i = 0; i < enemyCount; i++) {
                const x = room.x + (Math.random() - 0.5) * room.width * 0.8;
                const z = room.z + (Math.random() - 0.5) * room.height * 0.8;

                const types = this.getEnemyTypesForFloor();
                const type = types[Math.floor(Math.random() * types.length)];

                const entityId = this.game.gameManager.call('spawnEnemy', type, x, z);
                if (entityId) room.enemies.push(entityId);
            }

            // Spawn loot chest in treasure rooms
            if (room.type === 'treasure') {
                this.spawnTreasure(room);
            }
        });
    }

    getEnemyTypesForFloor() {
        if (this.currentFloor <= 3) return ['peasant', 'scout'];
        if (this.currentFloor <= 6) return ['soldier', 'archer', 'apprentice'];
        if (this.currentFloor <= 9) return ['barbarian', 'ranger', 'elementalist'];
        return ['berserker', 'paladin', 'assassin'];
    }

    spawnTreasure(room) {
        // Spawn extra loot when room is cleared
        room.onCleared = () => {
            this.game.gameManager.call('spawnLoot', room.x, room.z, 'rare');
            this.game.gameManager.call('spawnLoot', room.x + 20, room.z, 'uncommon');
        };
    }

    spawnBoss(room) {
        const bossTypes = {
            5: { type: 'berserker', name: 'Grimjaw the Destroyer', scale: 1.5 },
            10: { type: 'archmage', name: 'Malachar the Dark', scale: 1.5 },
            15: { type: 'paladin', name: 'The Fallen Crusader', scale: 1.8 },
            20: { type: 'assassin', name: 'Shadow Lord', scale: 1.6 }
        };

        const bossConfig = bossTypes[this.currentFloor] || bossTypes[5];

        this.game.gameManager.call('spawnBoss',
            bossConfig.type,
            room.x, room.z,
            bossConfig.name,
            bossConfig.scale
        );
    }

    nextFloor() {
        this.currentFloor++;
        this.generateDungeon(this.currentFloor);
        this.game.gameManager.call('showMessage', `Entering Floor ${this.currentFloor}`);
    }

    checkRoomCleared(room) {
        if (room.cleared) return;

        const allDead = room.enemies.every(id => {
            const health = this.game.getComponent(id, this.componentTypes.HEALTH);
            return !health || health.current <= 0;
        });

        if (allDead) {
            room.cleared = true;
            if (room.onCleared) room.onCleared();

            if (room.isExit) {
                this.game.gameManager.call('showMessage', 'Floor cleared! Press E at exit to continue.');
            }
        }
    }

    update() {
        // Check room clear status
        this.rooms.forEach(room => {
            if (room.enemies.length > 0) {
                this.checkRoomCleared(room);
            }
        });
    }
}
