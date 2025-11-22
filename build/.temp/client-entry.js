/**
 * GUTS Game Client Bundle
 * Generated: 2025-11-22T00:14:34.424Z
 * Project: TurnBasedWarfare
 */

// ========== ENGINE ==========
import ModuleManager from '/home/user/GUTS/engine/ModuleManager.js';
import BaseEngine from '/home/user/GUTS/engine/BaseEngine.js';
import Engine from '/home/user/GUTS/engine/Engine.js';

// ========== LIBRARIES ==========
import * as lib_threejs from 'three';
import lib_BaseECSGame from '/home/user/GUTS/global/libraries/js/BaseECSGame.js';
import * as lib_three_MeshBVH from '/home/user/GUTS/global/libraries/js/three_MeshBVH.js';
import * as lib_three_SkeletonUtils from '/home/user/GUTS/global/libraries/js/three_SkeletonUtils.js';
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
import * as lib_three_OrbitControls from 'three/examples/jsm/controls/OrbitControls.js';
import * as lib_GLTFLoader from '/home/user/GUTS/global/libraries/js/GLTFLoader.js';
import lib_ECSGame from '/home/user/GUTS/global/libraries/js/ECSGame.js';
import * as lib_three_EffectComposer from 'three/examples/jsm/postprocessing/EffectComposer.js';
import * as lib_three_RenderPixelatedPass from 'three/examples/jsm/postprocessing/RenderPixelatedPass.js';
import * as lib_three_OutputPass from 'three/examples/jsm/postprocessing/OutputPass.js';
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
  BaseECSGame: (lib_BaseECSGame.BaseECSGame || lib_BaseECSGame.default || lib_BaseECSGame),
  three_MeshBVH: lib_three_MeshBVH,
  SkeletonUtils: (lib_three_SkeletonUtils.SkeletonUtils || lib_three_SkeletonUtils),
  SceneManager: (lib_SceneManager.SceneManager || lib_SceneManager.default || lib_SceneManager),
  ShapeFactory: (lib_ShapeFactory.ShapeFactory || lib_ShapeFactory.default || lib_ShapeFactory),
  EnvironmentObjectSpawner: (lib_EnvironmentObjectSpawner.EnvironmentObjectSpawner || lib_EnvironmentObjectSpawner.default || lib_EnvironmentObjectSpawner),
  ImageManager: (lib_ImageManager.ImageManager || lib_ImageManager.default || lib_ImageManager),
  SpatialGrid: (lib_SpatialGrid.SpatialGrid || lib_SpatialGrid.default || lib_SpatialGrid),
  CoordinateTranslator: (lib_CoordinateTranslator.CoordinateTranslator || lib_CoordinateTranslator.default || lib_CoordinateTranslator),
  CanvasUtility: (lib_CanvasUtility.CanvasUtility || lib_CanvasUtility.default || lib_CanvasUtility),
  TerrainImageProcessor: (lib_TerrainImageProcessor.TerrainImageProcessor || lib_TerrainImageProcessor.default || lib_TerrainImageProcessor),
  TileMap: (lib_TileMap.TileMap || lib_TileMap.default || lib_TileMap),
  Entity: (lib_Entity.Entity || lib_Entity.default || lib_Entity),
  Component: (lib_Component.Component || lib_Component.default || lib_Component),
  GameState: (lib_GameState.GameState || lib_GameState.default || lib_GameState),
  ModelManager: (lib_ModelManager.ModelManager || lib_ModelManager.default || lib_ModelManager),
  OrbitControls: (lib_three_OrbitControls.OrbitControls || lib_three_OrbitControls),
  GLTFLoader: lib_GLTFLoader,
  ECSGame: (lib_ECSGame.ECSGame || lib_ECSGame.default || lib_ECSGame),
  EffectComposer: (lib_three_EffectComposer.EffectComposer || lib_three_EffectComposer),
  RenderPixelatedPass: (lib_three_RenderPixelatedPass.RenderPixelatedPass || lib_three_RenderPixelatedPass),
  OutputPass: (lib_three_OutputPass.OutputPass || lib_three_OutputPass),
  GameModeConfigs: (lib_GameModeConfigs.GameModeConfigs || lib_GameModeConfigs.default || lib_GameModeConfigs),
  UIComponents: (lib_UIComponents.UIComponents || lib_UIComponents.default || lib_UIComponents),
  NotificationSystem: (lib_NotificationSystem.NotificationSystem || lib_NotificationSystem.default || lib_NotificationSystem),
  GameLoader: (lib_GameLoader.GameLoader || lib_GameLoader.default || lib_GameLoader),
  GameUtils: (lib_GameUtils.GameUtils || lib_GameUtils.default || lib_GameUtils),
  PlacementPreview: (lib_PlacementPreview.PlacementPreview || lib_PlacementPreview.default || lib_PlacementPreview),
  EnemyStrategy: (lib_EnemyStrategy.EnemyStrategy || lib_EnemyStrategy.default || lib_EnemyStrategy),
  MultiplayerECSGame: (lib_MultiplayerECSGame.MultiplayerECSGame || lib_MultiplayerECSGame.default || lib_MultiplayerECSGame),
  ClientNetworkManager: (lib_ClientNetworkManager.ClientNetworkManager || lib_ClientNetworkManager.default || lib_ClientNetworkManager),
  BaseSystem: (lib_BaseSystem.BaseSystem || lib_BaseSystem.default || lib_BaseSystem),
  SeededRandom: (lib_SeededRandom.SeededRandom || lib_SeededRandom.default || lib_SeededRandom),
  DesyncDebugger: (lib_DesyncDebugger.DesyncDebugger || lib_DesyncDebugger.default || lib_DesyncDebugger),
  FantasyUIEnhancements: (lib_FantasyUIEnhancements.FantasyUIEnhancements || lib_FantasyUIEnhancements.default || lib_FantasyUIEnhancements),
  MinHeap: (lib_MinHeap.MinHeap || lib_MinHeap.default || lib_MinHeap),
  PerformanceProfiler: (lib_PerformanceProfiler.PerformanceProfiler || lib_PerformanceProfiler.default || lib_PerformanceProfiler),
  PerformanceMonitor: (lib_PerformanceMonitor.PerformanceMonitor || lib_PerformanceMonitor.default || lib_PerformanceMonitor),
  TerrainDataManager: (lib_TerrainDataManager.TerrainDataManager || lib_TerrainDataManager.default || lib_TerrainDataManager),
  WorldRenderer: (lib_WorldRenderer.WorldRenderer || lib_WorldRenderer.default || lib_WorldRenderer),
  EntityRenderer: (lib_EntityRenderer.EntityRenderer || lib_EntityRenderer.default || lib_EntityRenderer),
  RaycastHelper: (lib_RaycastHelper.RaycastHelper || lib_RaycastHelper.default || lib_RaycastHelper)
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
  ComponentManager: (mgr_ComponentManager.ComponentManager || mgr_ComponentManager.default || mgr_ComponentManager),
  GameManager: (mgr_GameManager.GameManager || mgr_GameManager.default || mgr_GameManager),
  GameModeManager: (mgr_GameModeManager.GameModeManager || mgr_GameModeManager.default || mgr_GameModeManager),
  KeyboardManager: (mgr_KeyboardManager.KeyboardManager || mgr_KeyboardManager.default || mgr_KeyboardManager),
  LoadingManager: (mgr_LoadingManager.LoadingManager || mgr_LoadingManager.default || mgr_LoadingManager),
  ResultsManager: (mgr_ResultsManager.ResultsManager || mgr_ResultsManager.default || mgr_ResultsManager),
  SaveManager: (mgr_SaveManager.SaveManager || mgr_SaveManager.default || mgr_SaveManager),
  ScreenManager: (mgr_ScreenManager.ScreenManager || mgr_ScreenManager.default || mgr_ScreenManager),
  UnitCreationManager: (mgr_UnitCreationManager.UnitCreationManager || mgr_UnitCreationManager.default || mgr_UnitCreationManager),
  SquadManager: (mgr_SquadManager.SquadManager || mgr_SquadManager.default || mgr_SquadManager),
  MultiplayerNetworkManager: (mgr_MultiplayerNetworkManager.MultiplayerNetworkManager || mgr_MultiplayerNetworkManager.default || mgr_MultiplayerNetworkManager),
  InputManager: (mgr_InputManager.InputManager || mgr_InputManager.default || mgr_InputManager)
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
import * as sys_EffectsSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/EffectsSystem.js';
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
  GridSystem: (sys_GridSystem.GridSystem || sys_GridSystem.default || sys_GridSystem),
  TerrainSystem: (sys_TerrainSystem.TerrainSystem || sys_TerrainSystem.default || sys_TerrainSystem),
  WorldSystem: (sys_WorldSystem.WorldSystem || sys_WorldSystem.default || sys_WorldSystem),
  PostProcessingSystem: (sys_PostProcessingSystem.PostProcessingSystem || sys_PostProcessingSystem.default || sys_PostProcessingSystem),
  RenderSystem: (sys_RenderSystem.RenderSystem || sys_RenderSystem.default || sys_RenderSystem),
  AISystem: (sys_AISystem.AISystem || sys_AISystem.default || sys_AISystem),
  CommandQueueSystem: (sys_CommandQueueSystem.CommandQueueSystem || sys_CommandQueueSystem.default || sys_CommandQueueSystem),
  MovementSystem: (sys_MovementSystem.MovementSystem || sys_MovementSystem.default || sys_MovementSystem),
  CombatAISystem: (sys_CombatAISystem.CombatAISystem || sys_CombatAISystem.default || sys_CombatAISystem),
  ProjectileSystem: (sys_ProjectileSystem.ProjectileSystem || sys_ProjectileSystem.default || sys_ProjectileSystem),
  AnimationSystem: (sys_AnimationSystem.AnimationSystem || sys_AnimationSystem.default || sys_AnimationSystem),
  ArmyDisplaySystem: (sys_ArmyDisplaySystem.ArmyDisplaySystem || sys_ArmyDisplaySystem.default || sys_ArmyDisplaySystem),
  EffectsSystem: sys_EffectsSystem,
  MultiplayerPlacementSystem: (sys_MultiplayerPlacementSystem.MultiplayerPlacementSystem || sys_MultiplayerPlacementSystem.default || sys_MultiplayerPlacementSystem),
  MultiplayerUISystem: (sys_MultiplayerUISystem.MultiplayerUISystem || sys_MultiplayerUISystem.default || sys_MultiplayerUISystem),
  ShopSystem: (sys_ShopSystem.ShopSystem || sys_ShopSystem.default || sys_ShopSystem),
  TeamHealthSystem: (sys_TeamHealthSystem.TeamHealthSystem || sys_TeamHealthSystem.default || sys_TeamHealthSystem),
  HealthBarSystem: (sys_HealthBarSystem.HealthBarSystem || sys_HealthBarSystem.default || sys_HealthBarSystem),
  UnitRadiusSystem: (sys_UnitRadiusSystem.UnitRadiusSystem || sys_UnitRadiusSystem.default || sys_UnitRadiusSystem),
  EquipmentSystem: (sys_EquipmentSystem.EquipmentSystem || sys_EquipmentSystem.default || sys_EquipmentSystem),
  DeathSystem: (sys_DeathSystem.DeathSystem || sys_DeathSystem.default || sys_DeathSystem),
  DamageSystem: (sys_DamageSystem.DamageSystem || sys_DamageSystem.default || sys_DamageSystem),
  AbilitySystem: (sys_AbilitySystem.AbilitySystem || sys_AbilitySystem.default || sys_AbilitySystem),
  ParticleSystem: (sys_ParticleSystem.ParticleSystem || sys_ParticleSystem.default || sys_ParticleSystem),
  SquadExperienceSystem: (sys_SquadExperienceSystem.SquadExperienceSystem || sys_SquadExperienceSystem.default || sys_SquadExperienceSystem),
  LifetimeSystem: (sys_LifetimeSystem.LifetimeSystem || sys_LifetimeSystem.default || sys_LifetimeSystem),
  SchedulingSystem: (sys_SchedulingSystem.SchedulingSystem || sys_SchedulingSystem.default || sys_SchedulingSystem),
  GoldMineSystem: (sys_GoldMineSystem.GoldMineSystem || sys_GoldMineSystem.default || sys_GoldMineSystem),
  PathfindingSystem: (sys_PathfindingSystem.PathfindingSystem || sys_PathfindingSystem.default || sys_PathfindingSystem),
  FogOfWarSystem: (sys_FogOfWarSystem.FogOfWarSystem || sys_FogOfWarSystem.default || sys_FogOfWarSystem),
  SelectedUnitSystem: (sys_SelectedUnitSystem.SelectedUnitSystem || sys_SelectedUnitSystem.default || sys_SelectedUnitSystem),
  UnitOrderSystem: (sys_UnitOrderSystem.UnitOrderSystem || sys_UnitOrderSystem.default || sys_UnitOrderSystem),
  MiniMapSystem: (sys_MiniMapSystem.MiniMapSystem || sys_MiniMapSystem.default || sys_MiniMapSystem),
  CameraControlSystem: (sys_CameraControlSystem.CameraControlSystem || sys_CameraControlSystem.default || sys_CameraControlSystem),
  DamageNumberSystem: (sys_DamageNumberSystem.DamageNumberSystem || sys_DamageNumberSystem.default || sys_DamageNumberSystem),
  VisionSystem: (sys_VisionSystem.VisionSystem || sys_VisionSystem.default || sys_VisionSystem),
  SupplySystem: (sys_SupplySystem.SupplySystem || sys_SupplySystem.default || sys_SupplySystem)
};

// ========== ABILITIES ==========
// Import BaseAbility first so other abilities can extend from it
import abilities_BaseAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BaseAbility.js';

import abilities_ArenaPresenceAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ArenaPresenceAbility.js';
import abilities_BattleCryAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BattleCryAbility.js';
import abilities_BlizzardAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BlizzardAbility.js';
import abilities_BloodlustAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BloodlustAbility.js';
import abilities_BuildAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BuildAbility.js';
import abilities_BurningAuraAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BurningAuraAbility.js';
import abilities_ChainLightningAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ChainLightningAbility.js';
import abilities_ChargeAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ChargeAbility.js';
import abilities_ConsecrationAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ConsecrationAbility.js';
import abilities_CorruptingAuraAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/CorruptingAuraAbility.js';
import abilities_CurseAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/CurseAbility.js';
import abilities_DisruptionBombAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/DisruptionBombAbility.js';
import abilities_DrainLifeAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/DrainLifeAbility.js';
import abilities_EnchantWeaponAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/EnchantWeaponAbility.js';
import abilities_ExplosiveTrapAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ExplosiveTrapAbility.js';
import abilities_FireBallAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FireBallAbility.js';
import abilities_FireStormAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FireStormAbility.js';
import abilities_FreezingAuraAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FreezingAuraAbility.js';
import abilities_HealAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/HealAbility.js';
import abilities_IceShardAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/IceShardAbility.js';
import abilities_InfernoAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/InfernoAbility.js';
import abilities_LightningBoltAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/LightningBoltAbility.js';
import abilities_MassHealAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MassHealAbility.js';
import abilities_MeteorStrikeAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MeteorStrikeAbility.js';
import abilities_MindControlAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MindControlAbility.js';
import abilities_MineGoldAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MineGoldAbility.js';
import abilities_MirrorImagesAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MirrorImagesAbility.js';
import abilities_MultiShotAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MultiShotAbility.js';
import abilities_PhalanxFormationAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/PhalanxFormationAbility.js';
import abilities_PiercingShotAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/PiercingShotAbility.js';
import abilities_RageAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/RageAbility.js';
import abilities_RaiseDeadAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/RaiseDeadAbility.js';
import abilities_ShadowStrikeAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ShadowStrikeAbility.js';
import abilities_ShieldWallAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ShieldWallAbility.js';
import abilities_SmiteAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/SmiteAbility.js';
import abilities_SummonWolfAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/SummonWolfAbility.js';
import abilities_Tornado from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/Tornado.js';
import abilities_TrackingMark from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/TrackingMark.js';
import abilities_WindShieldAbility from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/WindShieldAbility.js';

const Abilities = {
  BaseAbility: abilities_BaseAbility,
  ArenaPresenceAbility: (abilities_ArenaPresenceAbility.ArenaPresenceAbility || abilities_ArenaPresenceAbility.default || abilities_ArenaPresenceAbility),
  BattleCryAbility: (abilities_BattleCryAbility.BattleCryAbility || abilities_BattleCryAbility.default || abilities_BattleCryAbility),
  BlizzardAbility: (abilities_BlizzardAbility.BlizzardAbility || abilities_BlizzardAbility.default || abilities_BlizzardAbility),
  BloodlustAbility: (abilities_BloodlustAbility.BloodlustAbility || abilities_BloodlustAbility.default || abilities_BloodlustAbility),
  BuildAbility: (abilities_BuildAbility.BuildAbility || abilities_BuildAbility.default || abilities_BuildAbility),
  BurningAuraAbility: (abilities_BurningAuraAbility.BurningAuraAbility || abilities_BurningAuraAbility.default || abilities_BurningAuraAbility),
  ChainLightningAbility: (abilities_ChainLightningAbility.ChainLightningAbility || abilities_ChainLightningAbility.default || abilities_ChainLightningAbility),
  ChargeAbility: (abilities_ChargeAbility.ChargeAbility || abilities_ChargeAbility.default || abilities_ChargeAbility),
  ConsecrationAbility: (abilities_ConsecrationAbility.ConsecrationAbility || abilities_ConsecrationAbility.default || abilities_ConsecrationAbility),
  CorruptingAuraAbility: (abilities_CorruptingAuraAbility.CorruptingAuraAbility || abilities_CorruptingAuraAbility.default || abilities_CorruptingAuraAbility),
  CurseAbility: (abilities_CurseAbility.CurseAbility || abilities_CurseAbility.default || abilities_CurseAbility),
  DisruptionBombAbility: (abilities_DisruptionBombAbility.DisruptionBombAbility || abilities_DisruptionBombAbility.default || abilities_DisruptionBombAbility),
  DrainLifeAbility: (abilities_DrainLifeAbility.DrainLifeAbility || abilities_DrainLifeAbility.default || abilities_DrainLifeAbility),
  EnchantWeaponAbility: (abilities_EnchantWeaponAbility.EnchantWeaponAbility || abilities_EnchantWeaponAbility.default || abilities_EnchantWeaponAbility),
  ExplosiveTrapAbility: (abilities_ExplosiveTrapAbility.ExplosiveTrapAbility || abilities_ExplosiveTrapAbility.default || abilities_ExplosiveTrapAbility),
  FireBallAbility: (abilities_FireBallAbility.FireBallAbility || abilities_FireBallAbility.default || abilities_FireBallAbility),
  FireStormAbility: (abilities_FireStormAbility.FireStormAbility || abilities_FireStormAbility.default || abilities_FireStormAbility),
  FreezingAuraAbility: (abilities_FreezingAuraAbility.FreezingAuraAbility || abilities_FreezingAuraAbility.default || abilities_FreezingAuraAbility),
  HealAbility: (abilities_HealAbility.HealAbility || abilities_HealAbility.default || abilities_HealAbility),
  IceShardAbility: (abilities_IceShardAbility.IceShardAbility || abilities_IceShardAbility.default || abilities_IceShardAbility),
  InfernoAbility: (abilities_InfernoAbility.InfernoAbility || abilities_InfernoAbility.default || abilities_InfernoAbility),
  LightningBoltAbility: (abilities_LightningBoltAbility.LightningBoltAbility || abilities_LightningBoltAbility.default || abilities_LightningBoltAbility),
  MassHealAbility: (abilities_MassHealAbility.MassHealAbility || abilities_MassHealAbility.default || abilities_MassHealAbility),
  MeteorStrikeAbility: (abilities_MeteorStrikeAbility.MeteorStrikeAbility || abilities_MeteorStrikeAbility.default || abilities_MeteorStrikeAbility),
  MindControlAbility: (abilities_MindControlAbility.MindControlAbility || abilities_MindControlAbility.default || abilities_MindControlAbility),
  MineGoldAbility: (abilities_MineGoldAbility.MineGoldAbility || abilities_MineGoldAbility.default || abilities_MineGoldAbility),
  MirrorImagesAbility: (abilities_MirrorImagesAbility.MirrorImagesAbility || abilities_MirrorImagesAbility.default || abilities_MirrorImagesAbility),
  MultiShotAbility: (abilities_MultiShotAbility.MultiShotAbility || abilities_MultiShotAbility.default || abilities_MultiShotAbility),
  PhalanxFormationAbility: (abilities_PhalanxFormationAbility.PhalanxFormationAbility || abilities_PhalanxFormationAbility.default || abilities_PhalanxFormationAbility),
  PiercingShotAbility: (abilities_PiercingShotAbility.PiercingShotAbility || abilities_PiercingShotAbility.default || abilities_PiercingShotAbility),
  RageAbility: (abilities_RageAbility.RageAbility || abilities_RageAbility.default || abilities_RageAbility),
  RaiseDeadAbility: (abilities_RaiseDeadAbility.RaiseDeadAbility || abilities_RaiseDeadAbility.default || abilities_RaiseDeadAbility),
  ShadowStrikeAbility: (abilities_ShadowStrikeAbility.ShadowStrikeAbility || abilities_ShadowStrikeAbility.default || abilities_ShadowStrikeAbility),
  ShieldWallAbility: (abilities_ShieldWallAbility.ShieldWallAbility || abilities_ShieldWallAbility.default || abilities_ShieldWallAbility),
  SmiteAbility: (abilities_SmiteAbility.SmiteAbility || abilities_SmiteAbility.default || abilities_SmiteAbility),
  SummonWolfAbility: (abilities_SummonWolfAbility.SummonWolfAbility || abilities_SummonWolfAbility.default || abilities_SummonWolfAbility),
  Tornado: (abilities_Tornado.Tornado || abilities_Tornado.default || abilities_Tornado),
  TrackingMark: (abilities_TrackingMark.TrackingMark || abilities_TrackingMark.default || abilities_TrackingMark),
  WindShieldAbility: (abilities_WindShieldAbility.WindShieldAbility || abilities_WindShieldAbility.default || abilities_WindShieldAbility)
};

// ========== CLASS REGISTRY ==========
const ClassRegistry = {
  getManager: (name) => Managers[name],
  getSystem: (name) => Systems[name],
  getLibrary: (name) => Libraries[name],
  getAbilities: (name) => Abilities[name],
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

// Setup window.THREE if it exists in libraries
if (Libraries.THREE) {
  window.THREE = Libraries.THREE;
  
  // Add Three.js addons to window.THREE namespace
  Object.keys(Libraries).forEach(key => {
    if (key.startsWith('three_') || ['OrbitControls', 'GLTFLoader', 'EffectComposer', 'OutputPass', 'RenderPixelatedPass', 'SkeletonUtils'].includes(key)) {
      const addon = Libraries[key];
      if (typeof addon === 'object' && addon !== null) {
        // If it's a namespace with multiple exports, merge them
        Object.assign(window.THREE, addon);
      } else {
        // If it's a single class, add it by name
        window.THREE[key] = addon;
      }
    }
  });
}

Object.assign(window.GUTS, {
  managers: Managers,
  systems: Systems,
  abilities: Abilities
});

// Assign all individual classes directly to window.GUTS for direct access
Object.assign(window.GUTS, Managers);
Object.assign(window.GUTS, Systems);
Object.assign(window.GUTS, Abilities);

// Setup COMPILED_GAME namespace
window.COMPILED_GAME = {
  ready: Promise.resolve(),
  initialized: false,
  libraryClasses: Libraries,
  managers: Managers,
  systems: Systems,
  abilities: Abilities,
  classRegistry: ClassRegistry,
  init: function(gutsEngine) {
    if (this.initialized) return;
    this.initialized = true;
    window.GUTS.engine = gutsEngine;
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