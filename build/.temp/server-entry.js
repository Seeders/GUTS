/**
 * GUTS Game Server Bundle
 * Generated: 2025-11-21T21:58:06.829Z
 * Project: TurnBasedWarfare
 */

// ========== LIBRARIES ==========
import lib_BaseSystem from '/home/user/GUTS/global/libraries/js/BaseSystem.js';
import lib_GameRoom from '/home/user/GUTS/global/libraries/js/GameRoom.js';
import lib_ServerGameRoom from '/home/user/GUTS/global/libraries/js/ServerGameRoom.js';
import lib_GameState from '/home/user/GUTS/global/libraries/js/GameState.js';
import lib_BaseECSGame from '/home/user/GUTS/global/libraries/js/BaseECSGame.js';
import lib_GameUtils from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/GameUtils.js';
import lib_ServerECSGame from '/home/user/GUTS/global/libraries/js/ServerECSGame.js';
import lib_ServerEventManager from '/home/user/GUTS/global/libraries/js/ServerEventManager.js';
import lib_ServerNetworkManager from '/home/user/GUTS/global/libraries/js/ServerNetworkManager.js';
import lib_ServerSceneManager from '/home/user/GUTS/global/libraries/js/ServerSceneManager.js';
import lib_SeededRandom from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/SeededRandom.js';
import lib_MinHeap from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/MinHeap.js';
import lib_DesyncDebugger from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/DesyncDebugger.js';
import lib_TerrainDataManager from '/home/user/GUTS/global/libraries/js/TerrainDataManager.js';
import lib_EnvironmentObjectSpawner from '/home/user/GUTS/global/libraries/js/EnvironmentObjectSpawner.js';
import lib_CoordinateTranslator from '/home/user/GUTS/global/libraries/js/CoordinateTranslator.js';

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

// ========== MANAGERS ==========
import mgr_ComponentManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/ComponentManager.js';
import mgr_GameManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/GameManager.js';
import mgr_UnitCreationManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/UnitCreationManager.js';
import mgr_SquadManager from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/SquadManager.js';

const Managers = {
  ComponentManager: mgr_ComponentManager,
  GameManager: mgr_GameManager,
  UnitCreationManager: mgr_UnitCreationManager,
  SquadManager: mgr_SquadManager
};

// ========== SYSTEMS ==========
import sys_GridSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/GridSystem.js';
import sys_TerrainSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/TerrainSystem.js';
import sys_AISystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/AISystem.js';
import sys_CommandQueueSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/CommandQueueSystem.js';
import sys_MovementSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/MovementSystem.js';
import sys_CombatAISystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/CombatAISystem.js';
import sys_ProjectileSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ProjectileSystem.js';
import sys_TeamHealthSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/TeamHealthSystem.js';
import sys_DeathSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/DeathSystem.js';
import sys_DamageSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/DamageSystem.js';
import sys_AbilitySystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/AbilitySystem.js';
import sys_SquadExperienceSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SquadExperienceSystem.js';
import sys_ServerBattlePhaseSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ServerBattlePhaseSystem.js';
import sys_ServerPlacementSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ServerPlacementSystem.js';
import sys_LifetimeSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/LifetimeSystem.js';
import sys_SchedulingSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SchedulingSystem.js';
import sys_PathfindingSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/PathfindingSystem.js';
import sys_GoldMineSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/GoldMineSystem.js';
import sys_VisionSystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/VisionSystem.js';
import sys_SupplySystem from '/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SupplySystem.js';

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
  getAbility: (name) => Abilities[name]
};

// ========== GLOBAL SETUP ==========
global.COMPILED_GAME = {
  libraryClasses: Libraries,
  managers: Managers,
  systems: Systems,
  abilities: Abilities,
  classRegistry: ClassRegistry
};

module.exports = global.COMPILED_GAME;