/**
 * GUTS Game Server Bundle (CommonJS)
 * Generated: 2025-11-21T22:36:40.527Z
 * Project: TurnBasedWarfare
 */

// ========== SETUP GLOBALS ==========
if (!global.engine) global.engine = {};
if (!global.window) global.window = global;
// Setup app.appClasses for abilities and other dynamic classes
if (!global.engine.app) global.engine.app = {};
if (!global.engine.app.appClasses) global.engine.app.appClasses = {};

// ========== LIBRARIES ==========
const lib_BaseSystem_module = require('/home/user/GUTS/global/libraries/js/BaseSystem.js');
const lib_BaseSystem = lib_BaseSystem_module.default || lib_BaseSystem_module.BaseSystem || lib_BaseSystem_module;
const lib_GameRoom_module = require('/home/user/GUTS/global/libraries/js/GameRoom.js');
const lib_GameRoom = lib_GameRoom_module.default || lib_GameRoom_module.GameRoom || lib_GameRoom_module;
const lib_ServerGameRoom_module = require('/home/user/GUTS/global/libraries/js/ServerGameRoom.js');
const lib_ServerGameRoom = lib_ServerGameRoom_module.default || lib_ServerGameRoom_module.ServerGameRoom || lib_ServerGameRoom_module;
const lib_GameState_module = require('/home/user/GUTS/global/libraries/js/GameState.js');
const lib_GameState = lib_GameState_module.default || lib_GameState_module.GameState || lib_GameState_module;
const lib_BaseECSGame_module = require('/home/user/GUTS/global/libraries/js/BaseECSGame.js');
const lib_BaseECSGame = lib_BaseECSGame_module.default || lib_BaseECSGame_module.BaseECSGame || lib_BaseECSGame_module;
const lib_GameUtils_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/GameUtils.js');
const lib_GameUtils = lib_GameUtils_module.default || lib_GameUtils_module.GameUtils || lib_GameUtils_module;
const lib_ServerECSGame_module = require('/home/user/GUTS/global/libraries/js/ServerECSGame.js');
const lib_ServerECSGame = lib_ServerECSGame_module.default || lib_ServerECSGame_module.ServerECSGame || lib_ServerECSGame_module;
const lib_ServerEventManager_module = require('/home/user/GUTS/global/libraries/js/ServerEventManager.js');
const lib_ServerEventManager = lib_ServerEventManager_module.default || lib_ServerEventManager_module.ServerEventManager || lib_ServerEventManager_module;
const lib_ServerNetworkManager_module = require('/home/user/GUTS/global/libraries/js/ServerNetworkManager.js');
const lib_ServerNetworkManager = lib_ServerNetworkManager_module.default || lib_ServerNetworkManager_module.ServerNetworkManager || lib_ServerNetworkManager_module;
const lib_ServerSceneManager_module = require('/home/user/GUTS/global/libraries/js/ServerSceneManager.js');
const lib_ServerSceneManager = lib_ServerSceneManager_module.default || lib_ServerSceneManager_module.ServerSceneManager || lib_ServerSceneManager_module;
const lib_SeededRandom_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/SeededRandom.js');
const lib_SeededRandom = lib_SeededRandom_module.default || lib_SeededRandom_module.SeededRandom || lib_SeededRandom_module;
const lib_MinHeap_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/MinHeap.js');
const lib_MinHeap = lib_MinHeap_module.default || lib_MinHeap_module.MinHeap || lib_MinHeap_module;
const lib_DesyncDebugger_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/DesyncDebugger.js');
const lib_DesyncDebugger = lib_DesyncDebugger_module.default || lib_DesyncDebugger_module.DesyncDebugger || lib_DesyncDebugger_module;
const lib_TerrainDataManager_module = require('/home/user/GUTS/global/libraries/js/TerrainDataManager.js');
const lib_TerrainDataManager = lib_TerrainDataManager_module.default || lib_TerrainDataManager_module.TerrainDataManager || lib_TerrainDataManager_module;
const lib_EnvironmentObjectSpawner_module = require('/home/user/GUTS/global/libraries/js/EnvironmentObjectSpawner.js');
const lib_EnvironmentObjectSpawner = lib_EnvironmentObjectSpawner_module.default || lib_EnvironmentObjectSpawner_module.EnvironmentObjectSpawner || lib_EnvironmentObjectSpawner_module;
const lib_CoordinateTranslator_module = require('/home/user/GUTS/global/libraries/js/CoordinateTranslator.js');
const lib_CoordinateTranslator = lib_CoordinateTranslator_module.default || lib_CoordinateTranslator_module.CoordinateTranslator || lib_CoordinateTranslator_module;

const Libraries = {
  BaseSystem: lib_BaseSystem,
  GameRoom: lib_GameRoom,
  ServerGameRoom: lib_ServerGameRoom,
  GameState: lib_GameState,
  BaseECSGame: lib_BaseECSGame,
  GameUtils: lib_GameUtils,
  ServerECSGame: lib_ServerECSGame,
  ServerEventManager: lib_ServerEventManager,
  ServerNetworkManager: lib_ServerNetworkManager,
  ServerSceneManager: lib_ServerSceneManager,
  SeededRandom: lib_SeededRandom,
  MinHeap: lib_MinHeap,
  DesyncDebugger: lib_DesyncDebugger,
  TerrainDataManager: lib_TerrainDataManager,
  EnvironmentObjectSpawner: lib_EnvironmentObjectSpawner,
  CoordinateTranslator: lib_CoordinateTranslator
};

// Make libraries available IMMEDIATELY in global.engine
Object.assign(global.engine, Libraries);

// ========== MANAGERS ==========
const mgr_ComponentManager_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/ComponentManager.js');
const mgr_ComponentManager = mgr_ComponentManager_module.default || mgr_ComponentManager_module.ComponentManager || mgr_ComponentManager_module;
const mgr_GameManager_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/GameManager.js');
const mgr_GameManager = mgr_GameManager_module.default || mgr_GameManager_module.GameManager || mgr_GameManager_module;
const mgr_UnitCreationManager_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/UnitCreationManager.js');
const mgr_UnitCreationManager = mgr_UnitCreationManager_module.default || mgr_UnitCreationManager_module.UnitCreationManager || mgr_UnitCreationManager_module;
const mgr_SquadManager_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/SquadManager.js');
const mgr_SquadManager = mgr_SquadManager_module.default || mgr_SquadManager_module.SquadManager || mgr_SquadManager_module;

const Managers = {
  ComponentManager: mgr_ComponentManager,
  GameManager: mgr_GameManager,
  UnitCreationManager: mgr_UnitCreationManager,
  SquadManager: mgr_SquadManager
};

// ========== SYSTEMS ==========
const sys_GridSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/GridSystem.js');
const sys_GridSystem = sys_GridSystem_module.default || sys_GridSystem_module.GridSystem || sys_GridSystem_module;
const sys_TerrainSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/TerrainSystem.js');
const sys_TerrainSystem = sys_TerrainSystem_module.default || sys_TerrainSystem_module.TerrainSystem || sys_TerrainSystem_module;
const sys_AISystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/AISystem.js');
const sys_AISystem = sys_AISystem_module.default || sys_AISystem_module.AISystem || sys_AISystem_module;
const sys_CommandQueueSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/CommandQueueSystem.js');
const sys_CommandQueueSystem = sys_CommandQueueSystem_module.default || sys_CommandQueueSystem_module.CommandQueueSystem || sys_CommandQueueSystem_module;
const sys_MovementSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/MovementSystem.js');
const sys_MovementSystem = sys_MovementSystem_module.default || sys_MovementSystem_module.MovementSystem || sys_MovementSystem_module;
const sys_CombatAISystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/CombatAISystem.js');
const sys_CombatAISystem = sys_CombatAISystem_module.default || sys_CombatAISystem_module.CombatAISystem || sys_CombatAISystem_module;
const sys_ProjectileSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ProjectileSystem.js');
const sys_ProjectileSystem = sys_ProjectileSystem_module.default || sys_ProjectileSystem_module.ProjectileSystem || sys_ProjectileSystem_module;
const sys_TeamHealthSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/TeamHealthSystem.js');
const sys_TeamHealthSystem = sys_TeamHealthSystem_module.default || sys_TeamHealthSystem_module.TeamHealthSystem || sys_TeamHealthSystem_module;
const sys_DeathSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/DeathSystem.js');
const sys_DeathSystem = sys_DeathSystem_module.default || sys_DeathSystem_module.DeathSystem || sys_DeathSystem_module;
const sys_DamageSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/DamageSystem.js');
const sys_DamageSystem = sys_DamageSystem_module.default || sys_DamageSystem_module.DamageSystem || sys_DamageSystem_module;
const sys_AbilitySystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/AbilitySystem.js');
const sys_AbilitySystem = sys_AbilitySystem_module.default || sys_AbilitySystem_module.AbilitySystem || sys_AbilitySystem_module;
const sys_SquadExperienceSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SquadExperienceSystem.js');
const sys_SquadExperienceSystem = sys_SquadExperienceSystem_module.default || sys_SquadExperienceSystem_module.SquadExperienceSystem || sys_SquadExperienceSystem_module;
const sys_ServerBattlePhaseSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ServerBattlePhaseSystem.js');
const sys_ServerBattlePhaseSystem = sys_ServerBattlePhaseSystem_module.default || sys_ServerBattlePhaseSystem_module.ServerBattlePhaseSystem || sys_ServerBattlePhaseSystem_module;
const sys_ServerPlacementSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ServerPlacementSystem.js');
const sys_ServerPlacementSystem = sys_ServerPlacementSystem_module.default || sys_ServerPlacementSystem_module.ServerPlacementSystem || sys_ServerPlacementSystem_module;
const sys_LifetimeSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/LifetimeSystem.js');
const sys_LifetimeSystem = sys_LifetimeSystem_module.default || sys_LifetimeSystem_module.LifetimeSystem || sys_LifetimeSystem_module;
const sys_SchedulingSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SchedulingSystem.js');
const sys_SchedulingSystem = sys_SchedulingSystem_module.default || sys_SchedulingSystem_module.SchedulingSystem || sys_SchedulingSystem_module;
const sys_PathfindingSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/PathfindingSystem.js');
const sys_PathfindingSystem = sys_PathfindingSystem_module.default || sys_PathfindingSystem_module.PathfindingSystem || sys_PathfindingSystem_module;
const sys_GoldMineSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/GoldMineSystem.js');
const sys_GoldMineSystem = sys_GoldMineSystem_module.default || sys_GoldMineSystem_module.GoldMineSystem || sys_GoldMineSystem_module;
const sys_VisionSystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/VisionSystem.js');
const sys_VisionSystem = sys_VisionSystem_module.default || sys_VisionSystem_module.VisionSystem || sys_VisionSystem_module;
const sys_SupplySystem_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SupplySystem.js');
const sys_SupplySystem = sys_SupplySystem_module.default || sys_SupplySystem_module.SupplySystem || sys_SupplySystem_module;

const Systems = {
  GridSystem: sys_GridSystem,
  TerrainSystem: sys_TerrainSystem,
  AISystem: sys_AISystem,
  CommandQueueSystem: sys_CommandQueueSystem,
  MovementSystem: sys_MovementSystem,
  CombatAISystem: sys_CombatAISystem,
  ProjectileSystem: sys_ProjectileSystem,
  TeamHealthSystem: sys_TeamHealthSystem,
  DeathSystem: sys_DeathSystem,
  DamageSystem: sys_DamageSystem,
  AbilitySystem: sys_AbilitySystem,
  SquadExperienceSystem: sys_SquadExperienceSystem,
  ServerBattlePhaseSystem: sys_ServerBattlePhaseSystem,
  ServerPlacementSystem: sys_ServerPlacementSystem,
  LifetimeSystem: sys_LifetimeSystem,
  SchedulingSystem: sys_SchedulingSystem,
  PathfindingSystem: sys_PathfindingSystem,
  GoldMineSystem: sys_GoldMineSystem,
  VisionSystem: sys_VisionSystem,
  SupplySystem: sys_SupplySystem
};

// ========== ABILITIES ==========
// Require BaseAbility first so other abilities can extend from it
const ability_BaseAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BaseAbility.js');
const ability_BaseAbility = ability_BaseAbility_module.default || ability_BaseAbility_module.BaseAbility || ability_BaseAbility_module;
global.engine.app.appClasses['BaseAbility'] = ability_BaseAbility;

const ability_ArenaPresenceAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ArenaPresenceAbility.js');
const ability_ArenaPresenceAbility = ability_ArenaPresenceAbility_module.default || ability_ArenaPresenceAbility_module.ArenaPresenceAbility || ability_ArenaPresenceAbility_module;
const ability_BattleCryAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BattleCryAbility.js');
const ability_BattleCryAbility = ability_BattleCryAbility_module.default || ability_BattleCryAbility_module.BattleCryAbility || ability_BattleCryAbility_module;
const ability_BlizzardAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BlizzardAbility.js');
const ability_BlizzardAbility = ability_BlizzardAbility_module.default || ability_BlizzardAbility_module.BlizzardAbility || ability_BlizzardAbility_module;
const ability_BloodlustAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BloodlustAbility.js');
const ability_BloodlustAbility = ability_BloodlustAbility_module.default || ability_BloodlustAbility_module.BloodlustAbility || ability_BloodlustAbility_module;
const ability_BuildAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BuildAbility.js');
const ability_BuildAbility = ability_BuildAbility_module.default || ability_BuildAbility_module.BuildAbility || ability_BuildAbility_module;
const ability_BurningAuraAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BurningAuraAbility.js');
const ability_BurningAuraAbility = ability_BurningAuraAbility_module.default || ability_BurningAuraAbility_module.BurningAuraAbility || ability_BurningAuraAbility_module;
const ability_ChainLightningAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ChainLightningAbility.js');
const ability_ChainLightningAbility = ability_ChainLightningAbility_module.default || ability_ChainLightningAbility_module.ChainLightningAbility || ability_ChainLightningAbility_module;
const ability_ChargeAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ChargeAbility.js');
const ability_ChargeAbility = ability_ChargeAbility_module.default || ability_ChargeAbility_module.ChargeAbility || ability_ChargeAbility_module;
const ability_ConsecrationAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ConsecrationAbility.js');
const ability_ConsecrationAbility = ability_ConsecrationAbility_module.default || ability_ConsecrationAbility_module.ConsecrationAbility || ability_ConsecrationAbility_module;
const ability_CorruptingAuraAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/CorruptingAuraAbility.js');
const ability_CorruptingAuraAbility = ability_CorruptingAuraAbility_module.default || ability_CorruptingAuraAbility_module.CorruptingAuraAbility || ability_CorruptingAuraAbility_module;
const ability_CurseAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/CurseAbility.js');
const ability_CurseAbility = ability_CurseAbility_module.default || ability_CurseAbility_module.CurseAbility || ability_CurseAbility_module;
const ability_DisruptionBombAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/DisruptionBombAbility.js');
const ability_DisruptionBombAbility = ability_DisruptionBombAbility_module.default || ability_DisruptionBombAbility_module.DisruptionBombAbility || ability_DisruptionBombAbility_module;
const ability_DrainLifeAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/DrainLifeAbility.js');
const ability_DrainLifeAbility = ability_DrainLifeAbility_module.default || ability_DrainLifeAbility_module.DrainLifeAbility || ability_DrainLifeAbility_module;
const ability_EnchantWeaponAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/EnchantWeaponAbility.js');
const ability_EnchantWeaponAbility = ability_EnchantWeaponAbility_module.default || ability_EnchantWeaponAbility_module.EnchantWeaponAbility || ability_EnchantWeaponAbility_module;
const ability_ExplosiveTrapAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ExplosiveTrapAbility.js');
const ability_ExplosiveTrapAbility = ability_ExplosiveTrapAbility_module.default || ability_ExplosiveTrapAbility_module.ExplosiveTrapAbility || ability_ExplosiveTrapAbility_module;
const ability_FireBallAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FireBallAbility.js');
const ability_FireBallAbility = ability_FireBallAbility_module.default || ability_FireBallAbility_module.FireBallAbility || ability_FireBallAbility_module;
const ability_FireStormAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FireStormAbility.js');
const ability_FireStormAbility = ability_FireStormAbility_module.default || ability_FireStormAbility_module.FireStormAbility || ability_FireStormAbility_module;
const ability_FreezingAuraAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FreezingAuraAbility.js');
const ability_FreezingAuraAbility = ability_FreezingAuraAbility_module.default || ability_FreezingAuraAbility_module.FreezingAuraAbility || ability_FreezingAuraAbility_module;
const ability_HealAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/HealAbility.js');
const ability_HealAbility = ability_HealAbility_module.default || ability_HealAbility_module.HealAbility || ability_HealAbility_module;
const ability_IceShardAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/IceShardAbility.js');
const ability_IceShardAbility = ability_IceShardAbility_module.default || ability_IceShardAbility_module.IceShardAbility || ability_IceShardAbility_module;
const ability_InfernoAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/InfernoAbility.js');
const ability_InfernoAbility = ability_InfernoAbility_module.default || ability_InfernoAbility_module.InfernoAbility || ability_InfernoAbility_module;
const ability_LightningBoltAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/LightningBoltAbility.js');
const ability_LightningBoltAbility = ability_LightningBoltAbility_module.default || ability_LightningBoltAbility_module.LightningBoltAbility || ability_LightningBoltAbility_module;
const ability_MassHealAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MassHealAbility.js');
const ability_MassHealAbility = ability_MassHealAbility_module.default || ability_MassHealAbility_module.MassHealAbility || ability_MassHealAbility_module;
const ability_MeteorStrikeAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MeteorStrikeAbility.js');
const ability_MeteorStrikeAbility = ability_MeteorStrikeAbility_module.default || ability_MeteorStrikeAbility_module.MeteorStrikeAbility || ability_MeteorStrikeAbility_module;
const ability_MindControlAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MindControlAbility.js');
const ability_MindControlAbility = ability_MindControlAbility_module.default || ability_MindControlAbility_module.MindControlAbility || ability_MindControlAbility_module;
const ability_MineGoldAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MineGoldAbility.js');
const ability_MineGoldAbility = ability_MineGoldAbility_module.default || ability_MineGoldAbility_module.MineGoldAbility || ability_MineGoldAbility_module;
const ability_MirrorImagesAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MirrorImagesAbility.js');
const ability_MirrorImagesAbility = ability_MirrorImagesAbility_module.default || ability_MirrorImagesAbility_module.MirrorImagesAbility || ability_MirrorImagesAbility_module;
const ability_MultiShotAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MultiShotAbility.js');
const ability_MultiShotAbility = ability_MultiShotAbility_module.default || ability_MultiShotAbility_module.MultiShotAbility || ability_MultiShotAbility_module;
const ability_PhalanxFormationAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/PhalanxFormationAbility.js');
const ability_PhalanxFormationAbility = ability_PhalanxFormationAbility_module.default || ability_PhalanxFormationAbility_module.PhalanxFormationAbility || ability_PhalanxFormationAbility_module;
const ability_PiercingShotAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/PiercingShotAbility.js');
const ability_PiercingShotAbility = ability_PiercingShotAbility_module.default || ability_PiercingShotAbility_module.PiercingShotAbility || ability_PiercingShotAbility_module;
const ability_RageAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/RageAbility.js');
const ability_RageAbility = ability_RageAbility_module.default || ability_RageAbility_module.RageAbility || ability_RageAbility_module;
const ability_RaiseDeadAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/RaiseDeadAbility.js');
const ability_RaiseDeadAbility = ability_RaiseDeadAbility_module.default || ability_RaiseDeadAbility_module.RaiseDeadAbility || ability_RaiseDeadAbility_module;
const ability_ShadowStrikeAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ShadowStrikeAbility.js');
const ability_ShadowStrikeAbility = ability_ShadowStrikeAbility_module.default || ability_ShadowStrikeAbility_module.ShadowStrikeAbility || ability_ShadowStrikeAbility_module;
const ability_ShieldWallAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ShieldWallAbility.js');
const ability_ShieldWallAbility = ability_ShieldWallAbility_module.default || ability_ShieldWallAbility_module.ShieldWallAbility || ability_ShieldWallAbility_module;
const ability_SmiteAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/SmiteAbility.js');
const ability_SmiteAbility = ability_SmiteAbility_module.default || ability_SmiteAbility_module.SmiteAbility || ability_SmiteAbility_module;
const ability_SummonWolfAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/SummonWolfAbility.js');
const ability_SummonWolfAbility = ability_SummonWolfAbility_module.default || ability_SummonWolfAbility_module.SummonWolfAbility || ability_SummonWolfAbility_module;
const ability_Tornado_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/Tornado.js');
const ability_Tornado = ability_Tornado_module.default || ability_Tornado_module.Tornado || ability_Tornado_module;
const ability_TrackingMark_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/TrackingMark.js');
const ability_TrackingMark = ability_TrackingMark_module.default || ability_TrackingMark_module.TrackingMark || ability_TrackingMark_module;
const ability_WindShieldAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/WindShieldAbility.js');
const ability_WindShieldAbility = ability_WindShieldAbility_module.default || ability_WindShieldAbility_module.WindShieldAbility || ability_WindShieldAbility_module;

const Abilities = {
  BaseAbility: ability_BaseAbility,
  ArenaPresenceAbility: ability_ArenaPresenceAbility,
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

// Make all abilities available in global.engine.app.appClasses
Object.assign(global.engine.app.appClasses, Abilities);

// ========== CLASS REGISTRY ==========
const ClassRegistry = {
  getManager: (name) => Managers[name],
  getSystem: (name) => Systems[name],
  getLibrary: (name) => Libraries[name],
  getAbility: (name) => Abilities[name]
};

// ========== GLOBAL SETUP ==========
global.COMPILED_GAME = {
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
    global.engine = engine;
    console.log("✅ COMPILED_GAME initialized on server");
  }
};

// Also expose in global.engine for compatibility
global.engine.managers = Managers;
global.engine.systems = Systems;
global.engine.abilities = Abilities;

module.exports = global.COMPILED_GAME;