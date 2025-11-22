/**
 * GUTS Game Server Bundle (CommonJS)
 * Generated: 2025-11-22T00:14:34.428Z
 * Project: TurnBasedWarfare
 */

// ========== SETUP GLOBALS ==========
if (!global.GUTS) global.GUTS = {};
if (!global.window) global.window = global;

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

// Make libraries available IMMEDIATELY in global.GUTS
Object.assign(global.GUTS, Libraries);

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
const abilities_BaseAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BaseAbility.js');
const abilities_BaseAbility = abilities_BaseAbility_module.default || abilities_BaseAbility_module.BaseAbility || abilities_BaseAbility_module;
global.GUTS.BaseAbility = abilities_BaseAbility;

const abilities_ArenaPresenceAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ArenaPresenceAbility.js');
const abilities_ArenaPresenceAbility = abilities_ArenaPresenceAbility_module.default || abilities_ArenaPresenceAbility_module.ArenaPresenceAbility || abilities_ArenaPresenceAbility_module;
const abilities_BattleCryAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BattleCryAbility.js');
const abilities_BattleCryAbility = abilities_BattleCryAbility_module.default || abilities_BattleCryAbility_module.BattleCryAbility || abilities_BattleCryAbility_module;
const abilities_BlizzardAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BlizzardAbility.js');
const abilities_BlizzardAbility = abilities_BlizzardAbility_module.default || abilities_BlizzardAbility_module.BlizzardAbility || abilities_BlizzardAbility_module;
const abilities_BloodlustAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BloodlustAbility.js');
const abilities_BloodlustAbility = abilities_BloodlustAbility_module.default || abilities_BloodlustAbility_module.BloodlustAbility || abilities_BloodlustAbility_module;
const abilities_BuildAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BuildAbility.js');
const abilities_BuildAbility = abilities_BuildAbility_module.default || abilities_BuildAbility_module.BuildAbility || abilities_BuildAbility_module;
const abilities_BurningAuraAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BurningAuraAbility.js');
const abilities_BurningAuraAbility = abilities_BurningAuraAbility_module.default || abilities_BurningAuraAbility_module.BurningAuraAbility || abilities_BurningAuraAbility_module;
const abilities_ChainLightningAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ChainLightningAbility.js');
const abilities_ChainLightningAbility = abilities_ChainLightningAbility_module.default || abilities_ChainLightningAbility_module.ChainLightningAbility || abilities_ChainLightningAbility_module;
const abilities_ChargeAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ChargeAbility.js');
const abilities_ChargeAbility = abilities_ChargeAbility_module.default || abilities_ChargeAbility_module.ChargeAbility || abilities_ChargeAbility_module;
const abilities_ConsecrationAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ConsecrationAbility.js');
const abilities_ConsecrationAbility = abilities_ConsecrationAbility_module.default || abilities_ConsecrationAbility_module.ConsecrationAbility || abilities_ConsecrationAbility_module;
const abilities_CorruptingAuraAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/CorruptingAuraAbility.js');
const abilities_CorruptingAuraAbility = abilities_CorruptingAuraAbility_module.default || abilities_CorruptingAuraAbility_module.CorruptingAuraAbility || abilities_CorruptingAuraAbility_module;
const abilities_CurseAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/CurseAbility.js');
const abilities_CurseAbility = abilities_CurseAbility_module.default || abilities_CurseAbility_module.CurseAbility || abilities_CurseAbility_module;
const abilities_DisruptionBombAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/DisruptionBombAbility.js');
const abilities_DisruptionBombAbility = abilities_DisruptionBombAbility_module.default || abilities_DisruptionBombAbility_module.DisruptionBombAbility || abilities_DisruptionBombAbility_module;
const abilities_DrainLifeAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/DrainLifeAbility.js');
const abilities_DrainLifeAbility = abilities_DrainLifeAbility_module.default || abilities_DrainLifeAbility_module.DrainLifeAbility || abilities_DrainLifeAbility_module;
const abilities_EnchantWeaponAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/EnchantWeaponAbility.js');
const abilities_EnchantWeaponAbility = abilities_EnchantWeaponAbility_module.default || abilities_EnchantWeaponAbility_module.EnchantWeaponAbility || abilities_EnchantWeaponAbility_module;
const abilities_ExplosiveTrapAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ExplosiveTrapAbility.js');
const abilities_ExplosiveTrapAbility = abilities_ExplosiveTrapAbility_module.default || abilities_ExplosiveTrapAbility_module.ExplosiveTrapAbility || abilities_ExplosiveTrapAbility_module;
const abilities_FireBallAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FireBallAbility.js');
const abilities_FireBallAbility = abilities_FireBallAbility_module.default || abilities_FireBallAbility_module.FireBallAbility || abilities_FireBallAbility_module;
const abilities_FireStormAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FireStormAbility.js');
const abilities_FireStormAbility = abilities_FireStormAbility_module.default || abilities_FireStormAbility_module.FireStormAbility || abilities_FireStormAbility_module;
const abilities_FreezingAuraAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FreezingAuraAbility.js');
const abilities_FreezingAuraAbility = abilities_FreezingAuraAbility_module.default || abilities_FreezingAuraAbility_module.FreezingAuraAbility || abilities_FreezingAuraAbility_module;
const abilities_HealAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/HealAbility.js');
const abilities_HealAbility = abilities_HealAbility_module.default || abilities_HealAbility_module.HealAbility || abilities_HealAbility_module;
const abilities_IceShardAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/IceShardAbility.js');
const abilities_IceShardAbility = abilities_IceShardAbility_module.default || abilities_IceShardAbility_module.IceShardAbility || abilities_IceShardAbility_module;
const abilities_InfernoAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/InfernoAbility.js');
const abilities_InfernoAbility = abilities_InfernoAbility_module.default || abilities_InfernoAbility_module.InfernoAbility || abilities_InfernoAbility_module;
const abilities_LightningBoltAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/LightningBoltAbility.js');
const abilities_LightningBoltAbility = abilities_LightningBoltAbility_module.default || abilities_LightningBoltAbility_module.LightningBoltAbility || abilities_LightningBoltAbility_module;
const abilities_MassHealAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MassHealAbility.js');
const abilities_MassHealAbility = abilities_MassHealAbility_module.default || abilities_MassHealAbility_module.MassHealAbility || abilities_MassHealAbility_module;
const abilities_MeteorStrikeAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MeteorStrikeAbility.js');
const abilities_MeteorStrikeAbility = abilities_MeteorStrikeAbility_module.default || abilities_MeteorStrikeAbility_module.MeteorStrikeAbility || abilities_MeteorStrikeAbility_module;
const abilities_MindControlAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MindControlAbility.js');
const abilities_MindControlAbility = abilities_MindControlAbility_module.default || abilities_MindControlAbility_module.MindControlAbility || abilities_MindControlAbility_module;
const abilities_MineGoldAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MineGoldAbility.js');
const abilities_MineGoldAbility = abilities_MineGoldAbility_module.default || abilities_MineGoldAbility_module.MineGoldAbility || abilities_MineGoldAbility_module;
const abilities_MirrorImagesAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MirrorImagesAbility.js');
const abilities_MirrorImagesAbility = abilities_MirrorImagesAbility_module.default || abilities_MirrorImagesAbility_module.MirrorImagesAbility || abilities_MirrorImagesAbility_module;
const abilities_MultiShotAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MultiShotAbility.js');
const abilities_MultiShotAbility = abilities_MultiShotAbility_module.default || abilities_MultiShotAbility_module.MultiShotAbility || abilities_MultiShotAbility_module;
const abilities_PhalanxFormationAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/PhalanxFormationAbility.js');
const abilities_PhalanxFormationAbility = abilities_PhalanxFormationAbility_module.default || abilities_PhalanxFormationAbility_module.PhalanxFormationAbility || abilities_PhalanxFormationAbility_module;
const abilities_PiercingShotAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/PiercingShotAbility.js');
const abilities_PiercingShotAbility = abilities_PiercingShotAbility_module.default || abilities_PiercingShotAbility_module.PiercingShotAbility || abilities_PiercingShotAbility_module;
const abilities_RageAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/RageAbility.js');
const abilities_RageAbility = abilities_RageAbility_module.default || abilities_RageAbility_module.RageAbility || abilities_RageAbility_module;
const abilities_RaiseDeadAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/RaiseDeadAbility.js');
const abilities_RaiseDeadAbility = abilities_RaiseDeadAbility_module.default || abilities_RaiseDeadAbility_module.RaiseDeadAbility || abilities_RaiseDeadAbility_module;
const abilities_ShadowStrikeAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ShadowStrikeAbility.js');
const abilities_ShadowStrikeAbility = abilities_ShadowStrikeAbility_module.default || abilities_ShadowStrikeAbility_module.ShadowStrikeAbility || abilities_ShadowStrikeAbility_module;
const abilities_ShieldWallAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ShieldWallAbility.js');
const abilities_ShieldWallAbility = abilities_ShieldWallAbility_module.default || abilities_ShieldWallAbility_module.ShieldWallAbility || abilities_ShieldWallAbility_module;
const abilities_SmiteAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/SmiteAbility.js');
const abilities_SmiteAbility = abilities_SmiteAbility_module.default || abilities_SmiteAbility_module.SmiteAbility || abilities_SmiteAbility_module;
const abilities_SummonWolfAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/SummonWolfAbility.js');
const abilities_SummonWolfAbility = abilities_SummonWolfAbility_module.default || abilities_SummonWolfAbility_module.SummonWolfAbility || abilities_SummonWolfAbility_module;
const abilities_Tornado_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/Tornado.js');
const abilities_Tornado = abilities_Tornado_module.default || abilities_Tornado_module.Tornado || abilities_Tornado_module;
const abilities_TrackingMark_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/TrackingMark.js');
const abilities_TrackingMark = abilities_TrackingMark_module.default || abilities_TrackingMark_module.TrackingMark || abilities_TrackingMark_module;
const abilities_WindShieldAbility_module = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/WindShieldAbility.js');
const abilities_WindShieldAbility = abilities_WindShieldAbility_module.default || abilities_WindShieldAbility_module.WindShieldAbility || abilities_WindShieldAbility_module;

const Abilities = {
  BaseAbility: abilities_BaseAbility,
  ArenaPresenceAbility: abilities_ArenaPresenceAbility,
  BattleCryAbility: abilities_BattleCryAbility,
  BlizzardAbility: abilities_BlizzardAbility,
  BloodlustAbility: abilities_BloodlustAbility,
  BuildAbility: abilities_BuildAbility,
  BurningAuraAbility: abilities_BurningAuraAbility,
  ChainLightningAbility: abilities_ChainLightningAbility,
  ChargeAbility: abilities_ChargeAbility,
  ConsecrationAbility: abilities_ConsecrationAbility,
  CorruptingAuraAbility: abilities_CorruptingAuraAbility,
  CurseAbility: abilities_CurseAbility,
  DisruptionBombAbility: abilities_DisruptionBombAbility,
  DrainLifeAbility: abilities_DrainLifeAbility,
  EnchantWeaponAbility: abilities_EnchantWeaponAbility,
  ExplosiveTrapAbility: abilities_ExplosiveTrapAbility,
  FireBallAbility: abilities_FireBallAbility,
  FireStormAbility: abilities_FireStormAbility,
  FreezingAuraAbility: abilities_FreezingAuraAbility,
  HealAbility: abilities_HealAbility,
  IceShardAbility: abilities_IceShardAbility,
  InfernoAbility: abilities_InfernoAbility,
  LightningBoltAbility: abilities_LightningBoltAbility,
  MassHealAbility: abilities_MassHealAbility,
  MeteorStrikeAbility: abilities_MeteorStrikeAbility,
  MindControlAbility: abilities_MindControlAbility,
  MineGoldAbility: abilities_MineGoldAbility,
  MirrorImagesAbility: abilities_MirrorImagesAbility,
  MultiShotAbility: abilities_MultiShotAbility,
  PhalanxFormationAbility: abilities_PhalanxFormationAbility,
  PiercingShotAbility: abilities_PiercingShotAbility,
  RageAbility: abilities_RageAbility,
  RaiseDeadAbility: abilities_RaiseDeadAbility,
  ShadowStrikeAbility: abilities_ShadowStrikeAbility,
  ShieldWallAbility: abilities_ShieldWallAbility,
  SmiteAbility: abilities_SmiteAbility,
  SummonWolfAbility: abilities_SummonWolfAbility,
  Tornado: abilities_Tornado,
  TrackingMark: abilities_TrackingMark,
  WindShieldAbility: abilities_WindShieldAbility
};

// Make all abilities available in global.GUTS
Object.assign(global.GUTS, Abilities);

// ========== CLASS REGISTRY ==========
const ClassRegistry = {
  getManager: (name) => Managers[name],
  getSystem: (name) => Systems[name],
  getLibrary: (name) => Libraries[name],
  getAbilities: (name) => Abilities[name]
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
  init: function(gutsEngine) {
    if (this.initialized) return;
    this.initialized = true;
    global.GUTS.engine = gutsEngine;
    console.log("✅ COMPILED_GAME initialized on server");
  }
};

// Also expose in global.GUTS for compatibility
global.GUTS.managers = Managers;
global.GUTS.systems = Systems;
global.GUTS.abilities = Abilities;

module.exports = global.COMPILED_GAME;