/**
 * GUTS Game Server Bundle (CommonJS)
 * Generated: 2025-11-21T22:21:20.063Z
 * Project: TurnBasedWarfare
 */

// ========== SETUP GLOBALS ==========
if (!global.engine) global.engine = {};
if (!global.window) global.window = global;

// ========== LIBRARIES ==========
const lib_BaseSystem = require('/home/user/GUTS/global/libraries/js/BaseSystem.js');
const lib_GameRoom = require('/home/user/GUTS/global/libraries/js/GameRoom.js');
const lib_ServerGameRoom = require('/home/user/GUTS/global/libraries/js/ServerGameRoom.js');
const lib_GameState = require('/home/user/GUTS/global/libraries/js/GameState.js');
const lib_BaseECSGame = require('/home/user/GUTS/global/libraries/js/BaseECSGame.js');
const lib_GameUtils = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/GameUtils.js');
const lib_ServerECSGame = require('/home/user/GUTS/global/libraries/js/ServerECSGame.js');
const lib_ServerEventManager = require('/home/user/GUTS/global/libraries/js/ServerEventManager.js');
const lib_ServerNetworkManager = require('/home/user/GUTS/global/libraries/js/ServerNetworkManager.js');
const lib_ServerSceneManager = require('/home/user/GUTS/global/libraries/js/ServerSceneManager.js');
const lib_SeededRandom = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/SeededRandom.js');
const lib_MinHeap = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/MinHeap.js');
const lib_DesyncDebugger = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/libraries/js/DesyncDebugger.js');
const lib_TerrainDataManager = require('/home/user/GUTS/global/libraries/js/TerrainDataManager.js');
const lib_EnvironmentObjectSpawner = require('/home/user/GUTS/global/libraries/js/EnvironmentObjectSpawner.js');
const lib_CoordinateTranslator = require('/home/user/GUTS/global/libraries/js/CoordinateTranslator.js');

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
const mgr_ComponentManager = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/ComponentManager.js');
const mgr_GameManager = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/GameManager.js');
const mgr_UnitCreationManager = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/UnitCreationManager.js');
const mgr_SquadManager = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/managers/js/SquadManager.js');

const Managers = {
  ComponentManager: mgr_ComponentManager,
  GameManager: mgr_GameManager,
  UnitCreationManager: mgr_UnitCreationManager,
  SquadManager: mgr_SquadManager
};

// ========== SYSTEMS ==========
const sys_GridSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/GridSystem.js');
const sys_TerrainSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/TerrainSystem.js');
const sys_AISystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/AISystem.js');
const sys_CommandQueueSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/CommandQueueSystem.js');
const sys_MovementSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/MovementSystem.js');
const sys_CombatAISystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/CombatAISystem.js');
const sys_ProjectileSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ProjectileSystem.js');
const sys_TeamHealthSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/TeamHealthSystem.js');
const sys_DeathSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/DeathSystem.js');
const sys_DamageSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/DamageSystem.js');
const sys_AbilitySystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/AbilitySystem.js');
const sys_SquadExperienceSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SquadExperienceSystem.js');
const sys_ServerBattlePhaseSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ServerBattlePhaseSystem.js');
const sys_ServerPlacementSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/ServerPlacementSystem.js');
const sys_LifetimeSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/LifetimeSystem.js');
const sys_SchedulingSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SchedulingSystem.js');
const sys_PathfindingSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/PathfindingSystem.js');
const sys_GoldMineSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/GoldMineSystem.js');
const sys_VisionSystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/VisionSystem.js');
const sys_SupplySystem = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/systems/js/SupplySystem.js');

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
const ability_ArenaPresenceAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ArenaPresenceAbility.js');
const ability_BaseAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BaseAbility.js');
const ability_BattleCryAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BattleCryAbility.js');
const ability_BlizzardAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BlizzardAbility.js');
const ability_BloodlustAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BloodlustAbility.js');
const ability_BuildAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BuildAbility.js');
const ability_BurningAuraAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/BurningAuraAbility.js');
const ability_ChainLightningAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ChainLightningAbility.js');
const ability_ChargeAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ChargeAbility.js');
const ability_ConsecrationAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ConsecrationAbility.js');
const ability_CorruptingAuraAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/CorruptingAuraAbility.js');
const ability_CurseAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/CurseAbility.js');
const ability_DisruptionBombAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/DisruptionBombAbility.js');
const ability_DrainLifeAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/DrainLifeAbility.js');
const ability_EnchantWeaponAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/EnchantWeaponAbility.js');
const ability_ExplosiveTrapAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ExplosiveTrapAbility.js');
const ability_FireBallAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FireBallAbility.js');
const ability_FireStormAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FireStormAbility.js');
const ability_FreezingAuraAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/FreezingAuraAbility.js');
const ability_HealAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/HealAbility.js');
const ability_IceShardAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/IceShardAbility.js');
const ability_InfernoAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/InfernoAbility.js');
const ability_LightningBoltAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/LightningBoltAbility.js');
const ability_MassHealAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MassHealAbility.js');
const ability_MeteorStrikeAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MeteorStrikeAbility.js');
const ability_MindControlAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MindControlAbility.js');
const ability_MineGoldAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MineGoldAbility.js');
const ability_MirrorImagesAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MirrorImagesAbility.js');
const ability_MultiShotAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/MultiShotAbility.js');
const ability_PhalanxFormationAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/PhalanxFormationAbility.js');
const ability_PiercingShotAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/PiercingShotAbility.js');
const ability_RageAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/RageAbility.js');
const ability_RaiseDeadAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/RaiseDeadAbility.js');
const ability_ShadowStrikeAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ShadowStrikeAbility.js');
const ability_ShieldWallAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/ShieldWallAbility.js');
const ability_SmiteAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/SmiteAbility.js');
const ability_SummonWolfAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/SummonWolfAbility.js');
const ability_Tornado = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/Tornado.js');
const ability_TrackingMark = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/TrackingMark.js');
const ability_WindShieldAbility = require('/home/user/GUTS/projects/TurnBasedWarfare/scripts/Scripts/abilities/js/WindShieldAbility.js');

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

// Also expose in global.engine for compatibility
global.engine.managers = Managers;
global.engine.systems = Systems;
global.engine.abilities = Abilities;

module.exports = global.COMPILED_GAME;