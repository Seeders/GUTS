# Social kit

Players together: parties (invites, leader, kick, shared credit queries), chat channels (say, yell, party, whisper, commands), face-to-face trading that changes hands all at once or not at all, and the shared world’s saved flags and actions.

**Requires kits:** none (core only)

## Systems

| System | Services it provides |
|---|---|
| `ChatSystem` | `sendChat`, `registerChatChannel` |
| `PartySystem` | `partyInvite`, `partyRespond`, `partyLeave`, `partyKick`, `partyMemberGone`, `partyIdOf`, `partyOf`, `partyMembers`, `sameParty`, `partyList` |
| `TradeSystem` | `tradeAsk`, `tradeAnswer`, `tradeOffer`, `tradePull`, `tradeGold`, `tradeAccept`, `tradeCancel`, `tradeMemberGone`, `tradeOf`, `tradeView` |
| `WorldStateSystem` | `worldFlag`, `setWorldFlag`, `incWorldFlag`, `worldState`, `worldStateChanged`, `touchWorldState`, `runWorldActions`, `registerWorldAction`, `testWorldCondition`, `saveWorldStateNow` |

## Setting it up

List the systems where the game's rules run (the server of a multiplayer game): `PartySystem`,
`ChatSystem`, `TradeSystem`, `WorldStateSystem`, as many as you need. Players are ids: whatever
your game uses for a player (an entity id, an actor id).

The kit holds the state and the rules; your game moves the messages. Every call returns
`{ ok, reason }`, and what happened arrives as events any of your systems can handle:

| Event | When |
|---|---|
| `onPartyInvite { from, to }`, `onPartyDeclined`, `onPartyChanged { party, joined / left / kicked, disbanded, members }` | parties |
| `onChatMessage { to: [ids], msg }`, `onChatCommand { from, text, handled }` | chat (deliver `msg` to each id) |
| `onTradeRequest`, `onTradeDeclined`, `onTradeUpdate { trade }`, `onTradeClosed { trade, reason, done }` | trades (`tradeView(trade, id)` is one side's view) |
| `onWorldStateChanged { what }` | flags or sections changed this tick |

and the kit asks your game (provide these services from one of your systems):

| Service | For |
|---|---|
| `socialName(id)`, `socialPlayers()`, `socialNearby(id, radius)`, `socialFindPlayer(name)` | chat |
| `socialCanTrade(a, b)`, `socialTradable(id, item)`, `socialCountItem(id, item)`, `socialGold(id)`, `socialTakeItem`, `socialGiveItem` (returns how many fit), `socialAddGold`, `socialSnapshot(id)`, `socialRestore(id, snap)` | trading |
| `loadWorldState()`, `saveWorldState(state)` (or override `loadState` / `saveState`) | the world's memory |

When a player leaves the game, call `partyMemberGone(id)` and `tradeMemberGone(id)`.

Settings, all optional (`collections/settings/configs/social.json`):

```json
{ "partySize": 5, "inviteLife": 120, "sayRadius": 600, "maxLength": 240, "commandPrefix": "/",
  "tradeAskLife": 30, "tradeMaxItems": 20, "worldSections": ["quests"], "saveEvery": 30,
  "conditions": "KdLogic" }
```

## World state and actions

```js
this.call.setWorldFlag('mill_burned', 1);
this.call.registerWorldAction('give', (a, ctx) => giveItem(ctx.player, a.give, a.n || 1));
this.call.runWorldActions([{ set: 'met_ruler' }, { inc: 'visits' }, { give: 'key', when: 'f:met_ruler' }], { player });
```

An action is an object whose first registered key names it (`set`, `inc`, `unset` are built in).
`when` conditions go to `testWorldCondition(cond, ctx)`: override it, or name a library with
`test(cond, ctx)` in `conditions`; without one, `{ flag, is }` objects are understood.

## Making it yours

Subclass to keep your own network messages and words (`class MyPartySystem extends GUTS.PartySystem`,
listed in the scene instead, with the kit class still in the config's systems so it is compiled,
and listed before your subclass). A subclass with its own `serviceDependencies` should include the
kit's: `static serviceDependencies = [...GUTS.TradeSystem.serviceDependencies, 'myService']`.

## What your game supplies

**Components.** This kit ships reference schemas for none. A project that lists its kits in game.json gets the schemas of the core and of those kits, except where it has its own file of the same name (yours wins). Its systems use these, which the core or this kit's required kits provide: none.

**Services.** These systems call these services, which no engine system provides. Provide the ones your game needs from one of your systems (`static services = [...]`); a missing service is a no-op that logs one warning:

`loadWorldState`, `saveWorldState`, `socialAddGold`, `socialCanTrade`, `socialCountItem`, `socialFindPlayer`, `socialGiveItem`, `socialGold`, `socialName`, `socialNearby`, `socialPlayers`, `socialRestore`, `socialSnapshot`, `socialTakeItem`, `socialTradable`

## Using it

List the systems you want in your game.json `systems`. To limit a project to some kits, add `"kits": ["social"]` (required kits come along). Without a `kits` list every kit is available.

To change a system, subclass it in your project's `collections/scripts/systems/js/ChatSystem.js` (a project file with the same name as an engine file replaces it):

```js
import Base from '@global/scripts/systems/js/ChatSystem.js';

class ChatSystem extends Base {
    // override what you need
}
```
