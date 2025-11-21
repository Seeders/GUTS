/**
 * GUTS Game Client Bundle
 * Generated: 2025-11-21T21:58:06.826Z
 * Project: TurnBasedWarfare
 */

// ========== ENGINE ==========
import ModuleManager from '/home/user/GUTS/engine/ModuleManager.js';
import BaseEngine from '/home/user/GUTS/engine/BaseEngine.js';
import Engine from '/home/user/GUTS/engine/Engine.js';

// ========== LIBRARIES ==========
import lib_threejs from '/home/user/GUTS/node_modules/three/build/three.module.min.js';
import lib_BaseECSGame from '/home/user/GUTS/global/libraries/js/BaseECSGame.js';
import lib_three_MeshBVH from '/home/user/GUTS/global/libraries/js/three_MeshBVH.js';
import lib_three_SkeletonUtils from '/home/user/GUTS/global/libraries/js/three_SkeletonUtils.js';
import lib_SceneManager from '/home/user/GUTS/global/libraries/js/SceneManager.js';
import lib_ShapeFactory from '/home/user/GUTS/global/libraries/js/ShapeFactory.js';
import lib_EnvironmentObjectSpawner from '/home/user/GUTS/global/libraries/js/EnvironmentObjectSpawner.js';
import lib_ImageManager from '/home/user/GUTS/global/libraries/js/ImageManager.js';
import lib_SpatialGrid from '/home/user/GUTS/global/libraries/js/SpatialGrid.js';
import lib_CoordinateTranslator from '/home/user/GUTS/global/libraries/js/CoordinateTranslator.js';
import lib_CanvasUtility from '/home/user/GUTS/global/libraries/js/CanvasUtility.js';
import lib_TerrainImageProcessor from '/home/user/GUTS/global/libraries/js/TerrainImageProcessor.js';
import lib_TileMap from '/home/user/GUTS/global/libraries/js/TileMap.js';
import lib_Entity from '/home/user/GUTS/global/libraries/js/Entity.js';
import lib_Component from '/home/user/GUTS/global/libraries/js/Component.js';
import lib_GameState from '/home/user/GUTS/global/libraries/js/GameState.js';
import lib_ModelManager from '/home/user/GUTS/global/libraries/js/ModelManager.js';
import lib_GLTFLoader from '/home/user/GUTS/global/libraries/js/GLTFLoader.js';
import lib_ECSGame from '/home/user/GUTS/global/libraries/js/ECSGame.js';
import lib_GameModeConfigs from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/GameModeConfigs.js';
import lib_UIComponents from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/UIComponents.js';
import lib_NotificationSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/NotificationSystem.js';
import lib_GameLoader from '/home/user/GUTS/global/libraries/js/GameLoader.js';
import lib_GameUtils from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/GameUtils.js';
import lib_PlacementPreview from '/home/user/GUTS/global/libraries/js/PlacementPreview.js';
import lib_EnemyStrategy from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/EnemyStrategy.js';
import lib_MultiplayerECSGame from '/home/user/GUTS/global/libraries/js/MultiplayerECSGame.js';
import lib_ClientNetworkManager from '/home/user/GUTS/global/libraries/js/ClientNetworkManager.js';
import lib_BaseSystem from '/home/user/GUTS/global/libraries/js/BaseSystem.js';
import lib_SeededRandom from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/SeededRandom.js';
import lib_DesyncDebugger from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/DesyncDebugger.js';
import lib_FantasyUIEnhancements from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/FantasyUIEnhancements.js';
import lib_MinHeap from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/MinHeap.js';
import lib_PerformanceProfiler from '/home/user/GUTS/global/libraries/js/PerformanceProfiler.js';
import lib_PerformanceMonitor from '/home/user/GUTS/global/libraries/js/PerformanceMonitor.js';
import lib_TerrainDataManager from '/home/user/GUTS/global/libraries/js/TerrainDataManager.js';
import lib_WorldRenderer from '/home/user/GUTS/global/libraries/js/WorldRenderer.js';
import lib_EntityRenderer from '/home/user/GUTS/global/libraries/js/EntityRenderer.js';
import lib_RaycastHelper from '/home/user/GUTS/global/libraries/js/RaycastHelper.js';

const Libraries = {
  THREE: lib_threejs,
  BaseECSGame: lib_BaseECSGame,
  three_MeshBVH: lib_three_MeshBVH,
  SkeletonUtils: lib_three_SkeletonUtils,
  SceneManager: lib_SceneManager,
  ShapeFactory: lib_ShapeFactory,
  EnvironmentObjectSpawner: lib_EnvironmentObjectSpawner,
  ImageManager: lib_ImageManager,
  SpatialGrid: lib_SpatialGrid,
  CoordinateTranslator: lib_CoordinateTranslator,
  CanvasUtility: lib_CanvasUtility,
  TerrainImageProcessor: lib_TerrainImageProcessor,
  TileMap: lib_TileMap,
  Entity: lib_Entity,
  Component: lib_Component,
  GameState: lib_GameState,
  ModelManager: lib_ModelManager,
  GLTFLoader: lib_GLTFLoader,
  ECSGame: lib_ECSGame,
  GameModeConfigs: lib_GameModeConfigs,
  UIComponents: lib_UIComponents,
  NotificationSystem: lib_NotificationSystem,
  GameLoader: lib_GameLoader,
  GameUtils: lib_GameUtils,
  PlacementPreview: lib_PlacementPreview,
  EnemyStrategy: lib_EnemyStrategy,
  MultiplayerECSGame: lib_MultiplayerECSGame,
  ClientNetworkManager: lib_ClientNetworkManager,
  BaseSystem: lib_BaseSystem,
  SeededRandom: lib_SeededRandom,
  DesyncDebugger: lib_DesyncDebugger,
  FantasyUIEnhancements: lib_FantasyUIEnhancements,
  MinHeap: lib_MinHeap,
  PerformanceProfiler: lib_PerformanceProfiler,
  PerformanceMonitor: lib_PerformanceMonitor,
  TerrainDataManager: lib_TerrainDataManager,
  WorldRenderer: lib_WorldRenderer,
  EntityRenderer: lib_EntityRenderer,
  RaycastHelper: lib_RaycastHelper
};

// ========== MANAGERS ==========
import mgr_ComponentManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/ComponentManager.js';
import mgr_GameManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/GameManager.js';
import mgr_GameModeManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/GameModeManager.js';
import mgr_KeyboardManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/KeyboardManager.js';
import mgr_LoadingManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/LoadingManager.js';
import mgr_ResultsManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/ResultsManager.js';
import mgr_SaveManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/SaveManager.js';
import mgr_ScreenManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/ScreenManager.js';
import mgr_UnitCreationManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/UnitCreationManager.js';
import mgr_SquadManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/SquadManager.js';
import mgr_MultiplayerNetworkManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/MultiplayerNetworkManager.js';
import mgr_InputManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/InputManager.js';

const Managers = {
  ComponentManager: mgr_ComponentManager,
  GameManager: mgr_GameManager,
  GameModeManager: mgr_GameModeManager,
  KeyboardManager: mgr_KeyboardManager,
  LoadingManager: mgr_LoadingManager,
  ResultsManager: mgr_ResultsManager,
  SaveManager: mgr_SaveManager,
  ScreenManager: mgr_ScreenManager,
  UnitCreationManager: mgr_UnitCreationManager,
  SquadManager: mgr_SquadManager,
  MultiplayerNetworkManager: mgr_MultiplayerNetworkManager,
  InputManager: mgr_InputManager
};

// ========== SYSTEMS ==========
import sys_GridSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/GridSystem.js';
import sys_TerrainSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/TerrainSystem.js';
import sys_WorldSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/WorldSystem.js';
import sys_PostProcessingSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/PostProcessingSystem.js';
import sys_RenderSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/RenderSystem.js';
import sys_AISystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/AISystem.js';
import sys_CommandQueueSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/CommandQueueSystem.js';
import sys_MovementSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/MovementSystem.js';
import sys_CombatAISystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/CombatAISystem.js';
import sys_ProjectileSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ProjectileSystem.js';
import sys_AnimationSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/AnimationSystem.js';
import sys_ArmyDisplaySystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ArmyDisplaySystem.js';
import sys_EffectsSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/EffectsSystem.js';
import sys_MultiplayerPlacementSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/MultiplayerPlacementSystem.js';
import sys_MultiplayerUISystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/MultiplayerUISystem.js';
import sys_ShopSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ShopSystem.js';
import sys_TeamHealthSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/TeamHealthSystem.js';
import sys_HealthBarSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/HealthBarSystem.js';
import sys_UnitRadiusSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/UnitRadiusSystem.js';
import sys_EquipmentSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/EquipmentSystem.js';
import sys_DeathSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/DeathSystem.js';
import sys_DamageSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/DamageSystem.js';
import sys_AbilitySystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/AbilitySystem.js';
import sys_ParticleSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ParticleSystem.js';
import sys_SquadExperienceSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SquadExperienceSystem.js';
import sys_LifetimeSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/LifetimeSystem.js';
import sys_SchedulingSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SchedulingSystem.js';
import sys_GoldMineSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/GoldMineSystem.js';
import sys_PathfindingSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/PathfindingSystem.js';
import sys_FogOfWarSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/FogOfWarSystem.js';
import sys_SelectedUnitSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SelectedUnitSystem.js';
import sys_UnitOrderSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/UnitOrderSystem.js';
import sys_MiniMapSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/MiniMapSystem.js';
import sys_CameraControlSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/CameraControlSystem.js';
import sys_DamageNumberSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/DamageNumberSystem.js';
import sys_VisionSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/VisionSystem.js';
import sys_SupplySystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SupplySystem.js';

const Systems = {
  GridSystem: sys_GridSystem,
  TerrainSystem: sys_TerrainSystem,
  WorldSystem: sys_WorldSystem,
  PostProcessingSystem: sys_PostProcessingSystem,
  RenderSystem: sys_RenderSystem,
  AISystem: sys_AISystem,
  CommandQueueSystem: sys_CommandQueueSystem,
  MovementSystem: sys_MovementSystem,
  CombatAISystem: sys_CombatAISystem,
  ProjectileSystem: sys_ProjectileSystem,
  AnimationSystem: sys_AnimationSystem,
  ArmyDisplaySystem: sys_ArmyDisplaySystem,
  EffectsSystem: sys_EffectsSystem,
  MultiplayerPlacementSystem: sys_MultiplayerPlacementSystem,
  MultiplayerUISystem: sys_MultiplayerUISystem,
  ShopSystem: sys_ShopSystem,
  TeamHealthSystem: sys_TeamHealthSystem,
  HealthBarSystem: sys_HealthBarSystem,
  UnitRadiusSystem: sys_UnitRadiusSystem,
  EquipmentSystem: sys_EquipmentSystem,
  DeathSystem: sys_DeathSystem,
  DamageSystem: sys_DamageSystem,
  AbilitySystem: sys_AbilitySystem,
  ParticleSystem: sys_ParticleSystem,
  SquadExperienceSystem: sys_SquadExperienceSystem,
  LifetimeSystem: sys_LifetimeSystem,
  SchedulingSystem: sys_SchedulingSystem,
  GoldMineSystem: sys_GoldMineSystem,
  PathfindingSystem: sys_PathfindingSystem,
  FogOfWarSystem: sys_FogOfWarSystem,
  SelectedUnitSystem: sys_SelectedUnitSystem,
  UnitOrderSystem: sys_UnitOrderSystem,
  MiniMapSystem: sys_MiniMapSystem,
  CameraControlSystem: sys_CameraControlSystem,
  DamageNumberSystem: sys_DamageNumberSystem,
  VisionSystem: sys_VisionSystem,
  SupplySystem: sys_SupplySystem
};

// ========== ABILITIES ==========
import ability_ArenaPresenceAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ArenaPresenceAbility.js';
import ability_BaseAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BaseAbility.js';
import ability_BattleCryAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BattleCryAbility.js';
import ability_BlizzardAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BlizzardAbility.js';
import ability_BloodlustAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BloodlustAbility.js';
import ability_BuildAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BuildAbility.js';
import ability_BurningAuraAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BurningAuraAbility.js';
import ability_ChainLightningAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ChainLightningAbility.js';
import ability_ChargeAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ChargeAbility.js';
import ability_ConsecrationAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ConsecrationAbility.js';
import ability_CorruptingAuraAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/CorruptingAuraAbility.js';
import ability_CurseAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/CurseAbility.js';
import ability_DisruptionBombAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/DisruptionBombAbility.js';
import ability_DrainLifeAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/DrainLifeAbility.js';
import ability_EnchantWeaponAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/EnchantWeaponAbility.js';
import ability_ExplosiveTrapAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ExplosiveTrapAbility.js';
import ability_FireBallAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FireBallAbility.js';
import ability_FireStormAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FireStormAbility.js';
import ability_FreezingAuraAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FreezingAuraAbility.js';
import ability_HealAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/HealAbility.js';
import ability_IceShardAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/IceShardAbility.js';
import ability_InfernoAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/InfernoAbility.js';
import ability_LightningBoltAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/LightningBoltAbility.js';
import ability_MassHealAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MassHealAbility.js';
import ability_MeteorStrikeAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MeteorStrikeAbility.js';
import ability_MindControlAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MindControlAbility.js';
import ability_MineGoldAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MineGoldAbility.js';
import ability_MirrorImagesAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MirrorImagesAbility.js';
import ability_MultiShotAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MultiShotAbility.js';
import ability_PhalanxFormationAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/PhalanxFormationAbility.js';
import ability_PiercingShotAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/PiercingShotAbility.js';
import ability_RageAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/RageAbility.js';
import ability_RaiseDeadAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/RaiseDeadAbility.js';
import ability_ShadowStrikeAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ShadowStrikeAbility.js';
import ability_ShieldWallAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ShieldWallAbility.js';
import ability_SmiteAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/SmiteAbility.js';
import ability_SummonWolfAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/SummonWolfAbility.js';
import ability_Tornado from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/Tornado.js';
import ability_TrackingMark from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/TrackingMark.js';
import ability_WindShieldAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/WindShieldAbility.js';

const Abilities = {
  ArenaPresenceAbility: ability_ArenaPresenceAbility,
  BaseAbility: ability_BaseAbility,
  BattleCryAbility: ability_BattleCryAbility,
  BlizzardAbility: ability_BlizzardAbility,
  BloodlustAbility: ability_BloodlustAbility,
  BuildAbility: ability_BuildAbility,
  BurningAuraAbility: ability_BurningAuraAbility,
  ChainLightningAbility: ability_ChainLightningAbility,
  ChargeAbility: ability_ChargeAbility,
  ConsecrationAbility: ability_ConsecrationAbility,
  CorruptingAuraAbility: ability_CorruptingAuraAbility,
  CurseAbility: ability_CurseAbility,
  DisruptionBombAbility: ability_DisruptionBombAbility,
  DrainLifeAbility: ability_DrainLifeAbility,
  EnchantWeaponAbility: ability_EnchantWeaponAbility,
  ExplosiveTrapAbility: ability_ExplosiveTrapAbility,
  FireBallAbility: ability_FireBallAbility,
  FireStormAbility: ability_FireStormAbility,
  FreezingAuraAbility: ability_FreezingAuraAbility,
  HealAbility: ability_HealAbility,
  IceShardAbility: ability_IceShardAbility,
  InfernoAbility: ability_InfernoAbility,
  LightningBoltAbility: ability_LightningBoltAbility,
  MassHealAbility: ability_MassHealAbility,
  MeteorStrikeAbility: ability_MeteorStrikeAbility,
  MindControlAbility: ability_MindControlAbility,
  MineGoldAbility: ability_MineGoldAbility,
  MirrorImagesAbility: ability_MirrorImagesAbility,
  MultiShotAbility: ability_MultiShotAbility,
  PhalanxFormationAbility: ability_PhalanxFormationAbility,
  PiercingShotAbility: ability_PiercingShotAbility,
  RageAbility: ability_RageAbility,
  RaiseDeadAbility: ability_RaiseDeadAbility,
  ShadowStrikeAbility: ability_ShadowStrikeAbility,
  ShieldWallAbility: ability_ShieldWallAbility,
  SmiteAbility: ability_SmiteAbility,
  SummonWolfAbility: ability_SummonWolfAbility,
  Tornado: ability_Tornado,
  TrackingMark: ability_TrackingMark,
  WindShieldAbility: ability_WindShieldAbility
};

// ========== CLASS REGISTRY ==========
const ClassRegistry = {
  getManager: (name) => Managers[name],
  getSystem: (name) => Systems[name],
  getLibrary: (name) => Libraries[name],
  getAbility: (name) => Abilities[name],
  getAllManagers: () => Managers,
  getAllSystems: () => Systems,
  getAllLibraries: () => Libraries,
  getAllAbilities: () => Abilities
};

// ========== GLOBAL SETUP ==========

// Setup window.GUTS for backwards compatibility
if (!window.GUTS) {
  window.GUTS = {};
}

// Register all libraries in window.GUTS
Object.assign(window.GUTS, Libraries);

// Setup window.engine context for class inheritance
if (!window.engine) {
  window.engine = {};
}

// Register libraries in engine context
Object.assign(window.engine, Libraries);

// Also expose managers, systems, abilities globally
Object.assign(window.engine, {
  managers: Managers,
  systems: Systems,
  abilities: Abilities
});

// Setup COMPILED_GAME namespace
window.COMPILED_GAME = {
  ready: Promise.resolve(),
  initialized: false,
  libraryClasses: Libraries,
  managers: Managers,
  systems: Systems,
  abilities: Abilities,
  classRegistry: ClassRegistry,
  init: function(engine) {
    if (this.initialized) return;
    this.initialized = true;
    window.engine = engine;
    console.log("✅ COMPILED_GAME initialized");
  }
};

// ========== EXPORTS ==========
export {
  ModuleManager,
  BaseEngine,
  Engine,
  Libraries,
  Managers,
  Systems,
  Abilities
};

export default window.COMPILED_GAME;