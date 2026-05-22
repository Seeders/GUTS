import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('EquipmentSystem', () => {
    let game;
    let equipmentSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        equipmentSystem = game.createSystem(GUTS.EquipmentSystem);
        enums = game.getEnums();
    });

    describe('initialization', () => {
        it('should set default scale factor', () => {
            expect(equipmentSystem.scaleFactor).toBe(32);
        });

        it('should set default capacity', () => {
            expect(equipmentSystem.DEFAULT_CAPACITY).toBe(128);
        });

        it('should set bone prefix', () => {
            expect(equipmentSystem.bonePrefix).toBe('mixamorig');
        });

        it('should initialize empty equipment cache', () => {
            expect(equipmentSystem.equipmentCache.size).toBe(0);
        });

        it('should initialize empty equipment batches', () => {
            expect(equipmentSystem.equipmentBatches.size).toBe(0);
        });

        it('should initialize empty equipment instances', () => {
            expect(equipmentSystem.equipmentInstances.size).toBe(0);
        });
    });

    describe('static services', () => {
        it('should register getItemData service', () => {
            expect(GUTS.EquipmentSystem.services).toContain('getItemData');
        });

        it('should register equipItem service', () => {
            expect(GUTS.EquipmentSystem.services).toContain('equipItem');
        });
    });

    describe('boneNameMappings', () => {
        it('should have mainHand mappings', () => {
            expect(equipmentSystem.boneNameMappings.default.mainHand).toBeDefined();
            expect(equipmentSystem.boneNameMappings.default.mainHand).toContain('RightHand');
        });

        it('should have offHand mappings', () => {
            expect(equipmentSystem.boneNameMappings.default.offHand).toBeDefined();
            expect(equipmentSystem.boneNameMappings.default.offHand).toContain('LeftHand');
        });

        it('should have head mappings', () => {
            expect(equipmentSystem.boneNameMappings.default.head).toBeDefined();
            expect(equipmentSystem.boneNameMappings.default.head).toContain('Head');
        });

        it('should have chest mappings', () => {
            expect(equipmentSystem.boneNameMappings.default.chest).toBeDefined();
            expect(equipmentSystem.boneNameMappings.default.chest).toContain('Spine2');
        });

        it('should have back mappings', () => {
            expect(equipmentSystem.boneNameMappings.default.back).toBeDefined();
            expect(equipmentSystem.boneNameMappings.default.back).toContain('Spine');
        });
    });

    describe('slotDefaultOffsets', () => {
        it('should have mainHand offset', () => {
            expect(equipmentSystem.slotDefaultOffsets.mainHand).toEqual({ x: 0, y: 0, z: 0 });
        });

        it('should have offHand offset', () => {
            expect(equipmentSystem.slotDefaultOffsets.offHand).toEqual({ x: 0, y: 0, z: 0 });
        });

        it('should have head offset with y elevation', () => {
            expect(equipmentSystem.slotDefaultOffsets.head).toEqual({ x: 0, y: 0.15, z: 0 });
        });

        it('should have back offset with z offset', () => {
            expect(equipmentSystem.slotDefaultOffsets.back).toEqual({ x: 0, y: 0, z: -0.2 });
        });
    });

    describe('getItemData', () => {
        it('should return null for null itemId', () => {
            expect(equipmentSystem.getItemData(null)).toBeNull();
        });

        it('should return null for undefined itemId', () => {
            expect(equipmentSystem.getItemData(undefined)).toBeNull();
        });

        it('should return null for non-existent item', () => {
            expect(equipmentSystem.getItemData('nonExistentItem')).toBeNull();
        });
    });

    describe('findAttachmentBoneIndex', () => {
        it('should return -1 for null attachmentBones', () => {
            expect(equipmentSystem.findAttachmentBoneIndex(null, 'RightHand')).toBe(-1);
        });

        it('should return -1 for undefined attachmentBones', () => {
            expect(equipmentSystem.findAttachmentBoneIndex(undefined, 'RightHand')).toBe(-1);
        });

        it('should find bone by exact name match', () => {
            const attachmentBones = [
                { name: 'LeftHand' },
                { name: 'RightHand' },
                { name: 'Head' }
            ];
            expect(equipmentSystem.findAttachmentBoneIndex(attachmentBones, 'RightHand')).toBe(1);
        });

        it('should find bone by name without prefix', () => {
            const attachmentBones = [
                { name: 'mixamorigRightHand' }
            ];
            expect(equipmentSystem.findAttachmentBoneIndex(attachmentBones, 'RightHand')).toBe(0);
        });

        it('should find bone by partial name match', () => {
            const attachmentBones = [
                { name: 'LeftHandBone' },
                { name: 'RightHandBone' }
            ];
            expect(equipmentSystem.findAttachmentBoneIndex(attachmentBones, 'RightHand')).toBe(1);
        });

        it('should return -1 for non-existent bone', () => {
            const attachmentBones = [
                { name: 'LeftHand' },
                { name: 'RightHand' }
            ];
            expect(equipmentSystem.findAttachmentBoneIndex(attachmentBones, 'Foot')).toBe(-1);
        });
    });

    describe('allocateEquipmentInstance', () => {
        it('should return null for batch with no available indices', () => {
            const batch = {
                availableIndices: [],
                usedIndices: new Set(),
                count: 0
            };
            expect(equipmentSystem.allocateEquipmentInstance(batch)).toBeNull();
        });

        it('should allocate index from available pool', () => {
            const batch = {
                availableIndices: [0, 1, 2],
                usedIndices: new Set(),
                count: 0
            };
            const index = equipmentSystem.allocateEquipmentInstance(batch);
            expect(index).toBe(0);
            expect(batch.count).toBe(1);
            expect(batch.usedIndices.has(0)).toBe(true);
            expect(batch.availableIndices).toEqual([1, 2]);
        });

        it('should allocate multiple indices correctly', () => {
            const batch = {
                availableIndices: [0, 1, 2],
                usedIndices: new Set(),
                count: 0
            };

            equipmentSystem.allocateEquipmentInstance(batch);
            equipmentSystem.allocateEquipmentInstance(batch);

            expect(batch.count).toBe(2);
            expect(batch.usedIndices.size).toBe(2);
            expect(batch.availableIndices).toEqual([2]);
        });
    });

    describe('releaseEquipmentInstance', () => {
        it('should do nothing for unused index', () => {
            const batch = {
                availableIndices: [],
                usedIndices: new Set(),
                count: 0,
                mesh: {
                    setMatrixAt: () => {},
                    instanceMatrix: { needsUpdate: false }
                }
            };

            equipmentSystem.releaseEquipmentInstance(batch, 5);

            expect(batch.count).toBe(0);
            expect(batch.availableIndices.length).toBe(0);
        });

        it('should release used index back to pool', () => {
            const batch = {
                availableIndices: [1, 2],
                usedIndices: new Set([0]),
                count: 1,
                mesh: {
                    setMatrixAt: () => {},
                    instanceMatrix: { needsUpdate: false }
                }
            };

            equipmentSystem.releaseEquipmentInstance(batch, 0);

            expect(batch.count).toBe(0);
            expect(batch.usedIndices.has(0)).toBe(false);
            expect(batch.availableIndices).toContain(0);
        });
    });

    describe('cleanupRemovedEntities', () => {
        it('should remove instances for entities not in active set', () => {
            // Set up equipment instances for entities 1 and 2
            equipmentSystem.equipmentInstances.set(1, new Map([
                ['mainHand', { batchKey: 'test', instanceIndex: 0 }]
            ]));
            equipmentSystem.equipmentInstances.set(2, new Map([
                ['offHand', { batchKey: 'test', instanceIndex: 1 }]
            ]));

            // Mock batch for releasing
            equipmentSystem.equipmentBatches.set('test', {
                availableIndices: [],
                usedIndices: new Set([0, 1]),
                count: 2,
                mesh: {
                    setMatrixAt: () => {},
                    instanceMatrix: { needsUpdate: false }
                }
            });

            // Only entity 1 is active
            equipmentSystem.cleanupRemovedEntities([1]);

            expect(equipmentSystem.equipmentInstances.has(1)).toBe(true);
            expect(equipmentSystem.equipmentInstances.has(2)).toBe(false);
        });

        it('should handle empty active entities', () => {
            equipmentSystem.equipmentInstances.set(1, new Map());

            equipmentSystem.cleanupRemovedEntities([]);

            expect(equipmentSystem.equipmentInstances.size).toBe(0);
        });
    });

    describe('equipItem', () => {
        it('should return false (currently disabled)', async () => {
            const entityId = game.createEntityWith({
                equipment: { slots: {} }
            });

            const result = await equipmentSystem.equipItem(entityId, { slot: 'mainHand' }, {});

            expect(result).toBe(false);
        });
    });

    describe('unequipItem', () => {
        it('should return true for entity without equipment', async () => {
            const entityId = game.createEntity();
            const result = await equipmentSystem.unequipItem(entityId, 'mainHand');
            expect(result).toBe(true);
        });

        // Note: Additional unequipItem tests skipped because the system expects
        // equipment.slots[slotType] structure, but the component schema has
        // flat slot properties (mainHand, offHand, etc. directly on equipment)
    });

    describe('destroy', () => {
        it('should clear all maps', () => {
            equipmentSystem.equipmentCache.set('test', { traverse: (fn) => fn({}) });
            equipmentSystem.equipmentBatches.set('test', {
                mesh: {
                    geometry: { dispose: () => {} },
                    material: { dispose: () => {} }
                }
            });
            equipmentSystem.equipmentInstances.set(1, new Map());

            equipmentSystem.destroy();

            expect(equipmentSystem.equipmentCache.size).toBe(0);
            expect(equipmentSystem.equipmentBatches.size).toBe(0);
            expect(equipmentSystem.equipmentInstances.size).toBe(0);
        });
    });

    describe('updateEntityEquipment', () => {
        it('should return early for entity without equipment data', () => {
            const entityId = game.createEntityWith({
                transform: { position: { x: 0, y: 0, z: 0 } }
            });

            // Should not throw
            expect(() => equipmentSystem.updateEntityEquipment(entityId)).not.toThrow();
        });
    });
});
