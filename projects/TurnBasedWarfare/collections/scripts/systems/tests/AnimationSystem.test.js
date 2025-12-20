import { describe, it, expect, beforeEach } from 'vitest';
import { TestGameContext } from '../../../../../../tests/TestGameContext.js';

describe('AnimationSystem', () => {
    let game;
    let animationSystem;
    let enums;

    beforeEach(() => {
        game = new TestGameContext();

        // Register mock services needed by AnimationSystem
        game.register('getCamera', () => ({
            isOrthographicCamera: false,
            position: { x: 100, y: 100, z: 100 }
        }));
        game.register('getEntityRenderer', () => ({
            billboardAnimations: new Map(),
            applyBillboardAnimationFrame: () => {}
        }));
        game.register('getUnitTypeDef', () => null);
        game.register('getSpriteAnimationData', (index) => animationSystem.spriteAnimationCache.get(index));

        animationSystem = game.createSystem(GUTS.AnimationSystem);
        enums = game.getEnums();
    });

    describe('getBallisticAngleName', () => {
        it('should return Up90 for nearly vertical upward velocity', () => {
            // Pitch >= 67.5 degrees (nearly straight up)
            const vy = 100;
            const vx = 10;
            const vz = 10;
            expect(animationSystem.getBallisticAngleName(vy, vx, vz)).toBe('Up90');
        });

        it('should return Up45 for ascending velocity', () => {
            // Pitch between 22.5 and 67.5 degrees
            const vy = 50;
            const vx = 50;
            const vz = 0;
            expect(animationSystem.getBallisticAngleName(vy, vx, vz)).toBe('Up45');
        });

        it('should return Level for horizontal velocity', () => {
            // Pitch between -22.5 and 22.5 degrees
            const vy = 10;
            const vx = 100;
            const vz = 0;
            expect(animationSystem.getBallisticAngleName(vy, vx, vz)).toBe('Level');
        });

        it('should return Down45 for descending velocity', () => {
            // Pitch between -67.5 and -22.5 degrees
            const vy = -50;
            const vx = 50;
            const vz = 0;
            expect(animationSystem.getBallisticAngleName(vy, vx, vz)).toBe('Down45');
        });

        it('should return Down90 for nearly vertical downward velocity', () => {
            // Pitch <= -67.5 degrees (nearly straight down)
            const vy = -100;
            const vx = 10;
            const vz = 10;
            expect(animationSystem.getBallisticAngleName(vy, vx, vz)).toBe('Down90');
        });

        it('should handle zero horizontal velocity going up', () => {
            const vy = 100;
            const vx = 0;
            const vz = 0;
            expect(animationSystem.getBallisticAngleName(vy, vx, vz)).toBe('Up90');
        });

        it('should handle zero horizontal velocity going down', () => {
            const vy = -100;
            const vx = 0;
            const vz = 0;
            expect(animationSystem.getBallisticAngleName(vy, vx, vz)).toBe('Down90');
        });

        it('should handle zero velocity as Level', () => {
            const vy = 0;
            const vx = 0;
            const vz = 0;
            expect(animationSystem.getBallisticAngleName(vy, vx, vz)).toBe('Level');
        });

        it('should handle diagonal horizontal velocity correctly', () => {
            // Diagonal horizontal should still calculate pitch correctly
            const vy = 50;
            const vx = 35.36; // sqrt(50^2 / 2) for 45-degree horizontal
            const vz = 35.36;
            expect(animationSystem.getBallisticAngleName(vy, vx, vz)).toBe('Up45');
        });

        it('should return correct angle at boundary (22.5 degrees)', () => {
            // At exactly 22.5 degrees, should return Up45
            const angle = 22.5 * Math.PI / 180;
            const horizontalSpeed = 100;
            const vy = Math.tan(angle) * horizontalSpeed;
            expect(animationSystem.getBallisticAngleName(vy, horizontalSpeed, 0)).toBe('Up45');
        });

        it('should return correct angle just below boundary (22.5 degrees)', () => {
            // Just below 22.5 degrees should return Level
            const angle = 22.4 * Math.PI / 180;
            const horizontalSpeed = 100;
            const vy = Math.tan(angle) * horizontalSpeed;
            expect(animationSystem.getBallisticAngleName(vy, horizontalSpeed, 0)).toBe('Level');
        });
    });

    describe('updateProjectileBallisticAngle', () => {
        it('should not update if velocity is null', () => {
            const entityId = game.createEntityWith({
                animationState: {
                    spriteAnimationSet: 0,
                    spriteDirection: 0,
                    spriteAnimationType: 0,
                    spriteFrameIndex: 0,
                    ballisticAngle: -1,
                    lastBallisticDirection: null
                }
            });

            animationSystem.updateProjectileBallisticAngle(entityId, game.getComponent(entityId, 'animationState'), null);

            const animState = game.getComponent(entityId, 'animationState');
            expect(animState.ballisticAngle).toBe(-1);
        });

        it('should not update if animState is null', () => {
            const entityId = game.createEntityWith({});
            const velocity = { vx: 100, vy: 50, vz: 0 };

            // Should not throw
            animationSystem.updateProjectileBallisticAngle(entityId, null, velocity);
        });

        it('should not update if no ballistic animations exist', () => {
            const entityId = game.createEntityWith({
                animationState: {
                    spriteAnimationSet: 0,
                    spriteDirection: 0,
                    spriteAnimationType: 0,
                    spriteFrameIndex: 0,
                    ballisticAngle: -1,
                    lastBallisticDirection: null
                }
            });

            // Cache animation data without ballistic animations
            animationSystem.spriteAnimationCache.set(0, {
                animations: { idle: {} },
                fps: 4,
                rawAnimSetData: {
                    idleSpriteAnimations: ['testIdleDown']
                }
            });

            const velocity = { vx: 100, vy: 50, vz: 0 };
            animationSystem.updateProjectileBallisticAngle(entityId, game.getComponent(entityId, 'animationState'), velocity);

            const animState = game.getComponent(entityId, 'animationState');
            expect(animState.ballisticAngle).toBe(-1);
        });

        it('should update ballistic angle when ballistic animations exist', () => {
            const entityId = game.createEntityWith({
                animationState: {
                    spriteAnimationSet: 0,
                    spriteDirection: 0,
                    spriteAnimationType: 0,
                    spriteFrameIndex: 0,
                    ballisticAngle: -1,
                    lastBallisticDirection: null
                }
            });

            // Cache animation data with ballistic animations
            animationSystem.spriteAnimationCache.set(0, {
                animations: { idle: {} },
                fps: 4,
                rawAnimSetData: {
                    animationCollection: 'testSpritesAnimations',
                    idleSpriteAnimations: ['testIdleDown'],
                    ballisticIdleSpriteAnimationsUp45: [
                        'testIdleDownUp45', 'testIdleDownLeftUp45', 'testIdleLeftUp45',
                        'testIdleUpLeftUp45', 'testIdleUpUp45', 'testIdleUpRightUp45',
                        'testIdleRightUp45', 'testIdleDownRightUp45'
                    ]
                }
            });

            // Get the component reference to pass to updateProjectileBallisticAngle
            const animStateRef = game.getComponent(entityId, 'animationState');

            // Verify animationTypeNames is available
            expect(animationSystem.animationTypeNames).toBeDefined();
            expect(animationSystem.animationTypeNames[0]).toBeDefined();

            const velocity = { vx: 50, vy: 50, vz: 0 }; // 45-degree ascending
            animationSystem.updateProjectileBallisticAngle(entityId, animStateRef, velocity);

            // The animState reference should be the same object - angleIndex 1 = Up45
            expect(animStateRef.ballisticAngle).toBe(1);
            expect(animStateRef.lastBallisticDirection).toBe(0);
        });

        it('should not update if angle and direction have not changed', () => {
            const entityId = game.createEntityWith({
                animationState: {
                    spriteAnimationSet: 0,
                    spriteDirection: 0,
                    spriteAnimationType: 0,
                    spriteFrameIndex: 0,
                    ballisticAngle: 1, // Up45 = index 1
                    lastBallisticDirection: 0
                }
            });

            // Cache animation data with ballistic animations
            animationSystem.spriteAnimationCache.set(0, {
                animations: { idle: {} },
                fps: 4,
                rawAnimSetData: {
                    animationCollection: 'testSpritesAnimations',
                    idleSpriteAnimations: ['testIdleDown'],
                    ballisticIdleSpriteAnimationsUp45: [
                        'testIdleDownUp45', 'testIdleDownLeftUp45', 'testIdleLeftUp45',
                        'testIdleUpLeftUp45', 'testIdleUpUp45', 'testIdleUpRightUp45',
                        'testIdleRightUp45', 'testIdleDownRightUp45'
                    ]
                }
            });

            const velocity = { vx: 50, vy: 50, vz: 0 }; // Same angle

            // Track if cache was accessed for loading animations (it shouldn't be)
            const cachedData = animationSystem.spriteAnimationCache.get(0);
            cachedData.ballisticAnimations = { 'ballisticIdleSpriteAnimationsUp45': { loaded: true } };

            animationSystem.updateProjectileBallisticAngle(entityId, game.getComponent(entityId, 'animationState'), velocity);

            // Angle should remain the same
            const animState = game.getComponent(entityId, 'animationState');
            expect(animState.ballisticAngle).toBe(1); // Up45 = index 1
        });

        it('should update when direction changes but angle stays same', () => {
            const entityId = game.createEntityWith({
                animationState: {
                    spriteAnimationSet: 0,
                    spriteDirection: 1, // Changed from 0
                    spriteAnimationType: 0,
                    spriteFrameIndex: 0,
                    ballisticAngle: 1, // Up45 = index 1
                    lastBallisticDirection: 0 // Old direction
                }
            });

            // Cache animation data with ballistic animations
            animationSystem.spriteAnimationCache.set(0, {
                animations: { idle: {} },
                fps: 4,
                rawAnimSetData: {
                    animationCollection: 'testSpritesAnimations',
                    idleSpriteAnimations: ['testIdleDown'],
                    ballisticIdleSpriteAnimationsUp45: [
                        'testIdleDownUp45', 'testIdleDownLeftUp45', 'testIdleLeftUp45',
                        'testIdleUpLeftUp45', 'testIdleUpUp45', 'testIdleUpRightUp45',
                        'testIdleRightUp45', 'testIdleDownRightUp45'
                    ]
                }
            });

            const velocity = { vx: 50, vy: 50, vz: 0 };
            animationSystem.updateProjectileBallisticAngle(entityId, game.getComponent(entityId, 'animationState'), velocity);

            const animState = game.getComponent(entityId, 'animationState');
            expect(animState.lastBallisticDirection).toBe(1); // Updated to current direction
        });
    });

    describe('sprite direction calculation', () => {
        it('should calculate correct direction from rotation in perspective mode', () => {
            const entityId = game.createEntityWith({
                transform: {
                    position: { x: 0, y: 0, z: 0 },
                    rotation: { x: 0, y: 0, z: 0 }
                },
                animationState: {
                    spriteDirection: 0,
                    spriteAnimationType: 0,
                    isSprite: true
                }
            });

            // Mock setBillboardAnimationDirection to capture the direction
            let capturedDirection = null;
            game.register('setBillboardAnimationDirection', (id, dir) => {
                capturedDirection = dir;
            });

            const animState = game.getComponent(entityId, 'animationState');
            animationSystem.updateSpriteDirectionFromRotation(entityId, animState);

            // Direction should be calculated based on rotation and camera position
            expect(capturedDirection).not.toBeNull();
        });
    });

    describe('ballistic angle trajectory simulation', () => {
        it('should progress through angles during ballistic arc', () => {
            // Simulate a ballistic trajectory
            const angles = [];

            // Launch phase (going up)
            // Up90 requires pitch >= 67.5 degrees, so vy/horizontal >= tan(67.5) ≈ 2.414
            angles.push(animationSystem.getBallisticAngleName(100, 20, 0)); // Strong upward (78.7 degrees)
            angles.push(animationSystem.getBallisticAngleName(50, 50, 0));  // 45 degrees up
            angles.push(animationSystem.getBallisticAngleName(10, 50, 0));  // Nearly level (11.3 degrees)

            // Apex
            angles.push(animationSystem.getBallisticAngleName(0, 50, 0));   // Level

            // Descent phase (going down)
            angles.push(animationSystem.getBallisticAngleName(-10, 50, 0)); // Nearly level (-11.3 degrees)
            angles.push(animationSystem.getBallisticAngleName(-50, 50, 0)); // 45 degrees down
            // Down90 requires pitch <= -67.5 degrees
            angles.push(animationSystem.getBallisticAngleName(-100, 20, 0)); // Strong downward (-78.7 degrees)

            expect(angles[0]).toBe('Up90');
            expect(angles[1]).toBe('Up45');
            expect(angles[2]).toBe('Level');
            expect(angles[3]).toBe('Level');
            expect(angles[4]).toBe('Level');
            expect(angles[5]).toBe('Down45');
            expect(angles[6]).toBe('Down90');
        });
    });
});
