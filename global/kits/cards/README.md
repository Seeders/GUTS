# Cards kit

Card games: a deck, dragging cards, and card rendering, with card/cardVisual/draggable components and rank/suit enums.

**Requires kits:** none (core only)

## Systems

| System | Services it provides |
|---|---|
| `CardDeckSystem` | `createStandardDeck`, `createDeck`, `shuffleDeck`, `dealCard`, `dealCards`, `returnToDeck`, `returnAllToDeck`, `getDeckCount`, `getDeckCards`, `getDeckOrder`, `getAllCards`, `getCardsBySuit`, `getCardsByRank`, `findCard`, `findCards`, `setDeckOrder`, `moveToFront`, `setSeed`, `getCard` |
| `CardDragSystem` | `startDrag`, `endDrag`, `cancelDrag`, `isDragging`, `getDraggedCard`, `getDraggedCards`, `setDraggableFilter`, `getCardAtPosition` |
| `CardRenderSystem` | `createCardElement`, `removeCardElement`, `getCardElement`, `updateCardPosition`, `flipCard`, `setCardFaceUp`, `getCardWidth`, `getCardHeight`, `getSuitSymbol`, `getSuitName`, `getRankName`, `isRedSuit` |

## What your game supplies

**Components.** These systems read or write these components, so your game defines their schemas in `collections/data/components` (this kit ships `card`, `cardVisual`, `draggable` as a reference):

`card`, `cardLocation`, `cardVisual`, `draggable`

**Services.** These systems call these services, which no engine system provides. Provide the ones your game needs from one of your systems (`static services = [...]`); a missing service is a no-op that logs one warning:

`isGameOver`

## Using it

List the systems you want in your game.json `systems`. To limit a project to some kits, add `"kits": ["cards"]` (required kits come along). Without a `kits` list every kit is available.

To change a system, subclass it in your project's `collections/scripts/systems/js/CardDeckSystem.js` (a project file with the same name as an engine file replaces it):

```js
import Base from '@global/scripts/systems/js/CardDeckSystem.js';

class CardDeckSystem extends Base {
    // override what you need
}
```
