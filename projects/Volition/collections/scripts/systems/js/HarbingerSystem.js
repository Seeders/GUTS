/**
 * HarbingerSystem - An ancient being who speaks of destiny and the illusion of choice
 * Observes the player's actions with calm certainty that all is already written
 */
class HarbingerSystem extends GUTS.BaseSystem {
    // Only expose taunts that other systems might trigger directly (win/lose screens)
    static services = ['showTaunt', 'showVictoryTaunt', 'showDefeatTaunt', 'isAutoWinning'];
    static serviceDependencies = ['getTopKingdomRank', 'getColumnCards', 'getFieldColumns', 'getHandCards', 'isValidSequence', 'playHarbingerAppear', 'canPlayToKingdom', 'playToKingdom', 'getCardsBelow'];

    constructor(game) {
        super(game);
        this.overlayElement = null;
        this.messageElement = null;
        this.hideTimeout = null;
        this.fadeTimeout = null;
        this.typewriterTimeout = null;
        this.lastMessageIndex = -1;
        this.isTyping = false;

        // Typewriter settings
        this.typewriterSpeed = 35; // ms per character
        this.typewriterPunctPause = 150; // extra pause after punctuation

        // Track game state for contextual taunts
        this.acesOnKingdom = 0;
        this.hasShownHarmonyTaunt = false;
        this.harmonyCheckCounter = 0;

        // Auto-win state
        this._isAutoWinning = false;
        this.autoWinInterval = null;
        this.autoWinMusingIndex = 0;

        // Track cards to kingdom without comment (guarantee occasional responses)
        this.cardsSinceLastKingdomTaunt = 0;

        // The Harbinger's observations - spoken with ancient certainty
        this.taunts = [
            // On the nature of the draw
            "That card was always going to be yours.",
            "You reached for it as you were always going to.",
            "The deck gives what was written. Nothing more.",
            "Before you drew, it was already drawn.",
            "You feel you chose that card. You did not.",
            "The hand moves. The script remains unchanged.",
            "Each card falls into the order that was set long ago.",
            "You draw because the pattern requires it.",
            "The sequence continues. As it must.",
            "What you call chance, I call certainty delayed.",
            "The card you needed was never coming. The card you received was always coming.",
            "You draw hoping for something. Hope does not rearrange the deck.",
            "The deck does not respond to wanting. It responds to nothing.",
            "That card existed in that position before you were born.",
            "You will draw again. You will receive what you were always going to receive.",
            "The next card is already the next card. Your draw merely reveals it.",
            "Fifty-two arranged themselves long ago. You are meeting them in order.",
            "The deck is not random. It is inevitable, witnessed slowly.",

            // On the illusion of choice
            "You believe you are deciding. That is the kindest lie.",
            "Choice is a story the mind tells itself.",
            "The feeling of freedom is not freedom itself.",
            "You deliberate, yet the outcome was fixed before you began.",
            "Every option you weigh was already weighed for you.",
            "Your hesitation changes nothing. Only the timing.",
            "The mind invents reasons for what was always going to happen.",
            "You think you're playing. You are being played.",
            "Agency is a comfortable fiction.",
            "The cards do not wait for your decision. They wait for their moment.",
            "You consider your options. There is only one option wearing different masks.",
            "The choice you make is the choice you were always going to make.",
            "Deliberation is the feeling of a conclusion being reached. Not the reaching of it.",
            "You weigh alternatives that were never alternatives.",
            "Decision is recognition delayed. Not creation.",
            "Your reasoning leads where it was always going to lead.",
            "You feel the weight of choice. The weight is real. The choice is not.",
            "Multiple paths appear before you. Only one exists.",
            "You select. But selection is observation, not creation.",
            "Free will is the mind's way of claiming credit for causality.",

            // On determinism
            "All of this has happened before, in a sense.",
            "The future is not uncertain. Only unknown to you.",
            "Time reveals. It does not create.",
            "What will be was always going to be.",
            "Causality is a chain. You are a link, not the hand that forges.",
            "Every effect has its cause. Trace them back far enough.",
            "The present moment was inevitable from the first.",
            "Probability is ignorance dressed in mathematics.",
            "Randomness is a word for patterns we cannot see.",
            "The universe is a clock. You are a gear.",
            "Nothing is created in this moment. Everything arrives from before.",
            "You are the consequence of everything that preceded you.",
            "The dominoes fell long ago. You are watching them land.",
            "Physics does not pause for decisions. It continues.",
            "Every atom moves as it must. Including the ones you call yourself.",
            "The laws that move the stars move your hand across these cards.",
            "Determinism is not a philosophy. It is a description.",
            "You are matter in motion. Beautifully, inevitably in motion.",
            "The initial conditions contained this moment. And every other.",
            "Cause and effect do not skip steps. Even for you.",

            // On the game itself
            "The cards were shuffled. The outcome was set.",
            "You see fifty-two possibilities. I see one path.",
            "The field will look exactly as it was meant to look.",
            "Each kingdom will rise precisely as high as it was written.",
            "The game ends the way it was always going to end.",
            "You struggle against a conclusion that exists already.",
            "Win or lose, the result was determined before you sat down.",
            "The deck knows its final state. It is merely arriving there.",
            "This game has already been played. You are simply experiencing it.",
            "The cards fall where they must. Not where you wish.",
            "Every game I have witnessed ended exactly as it was going to end.",
            "The field builds itself. You are the instrument, not the architect.",
            "Kingdoms rise or they do not. Both were written.",
            "You play against the deck. The deck has already finished.",
            "The game asks nothing of you. You give what you were going to give.",
            "Solitaire. A word meaning alone. But you are not alone. The pattern is with you.",
            "Each placement confirms what was true. Nothing more.",
            "The rules do not constrain you. They describe you.",
            "You cannot beat a game that has already concluded.",
            "This is not a test. It is a reading.",

            // On observation and patience
            "I have watched many play. None have changed their fate.",
            "I do not hope you fail. I observe that you will.",
            "There is no malice in destiny. Only precision.",
            "I am not your opponent. I am your witness.",
            "Centuries have taught me patience. And certainty.",
            "I do not judge your choices. There are no choices to judge.",
            "Watch closely. You are seeing inevitability unfold.",
            "I have no stake in your outcome. It is already known to me.",
            "Time moves forward. The destination does not change.",
            "I observe. The pattern completes itself.",
            "I was here before you began. I will be here after you finish.",
            "My role is not to interfere. The pattern needs no assistance.",
            "I watch because watching is what I do. You play because playing is what you do.",
            "Neither of us chose to be here. Both of us arrived.",
            "I have seen this exact game before. In a sense.",
            "Witnessing is my purpose. You are fulfilling yours.",
            "I do not tire of watching. Tiredness would require an alternative.",
            "Every player believes they are different. The pattern does not recognize difference.",
            "I observe without judgment. Judgment requires alternatives that do not exist.",
            "My patience is not virtue. It is architecture.",

            // On struggle and persistence
            "Your persistence is part of the script.",
            "Even your determination was determined.",
            "You fight because you were always going to fight.",
            "Surrender or struggle. Both lead to the same place.",
            "The effort you expend was measured out before you began.",
            "You believe you are trying. You are following.",
            "Resistance is not futile. It is inevitable.",
            "Your will is strong. It was always going to be exactly this strong.",
            "Push against the current. You will arrive where it carries you.",
            "Every move you make was waiting for you to make it.",
            "You persist because persistence is what you do. Not because it changes things.",
            "Giving up was never an option for you. Nor was it ever not an option.",
            "You will play until you stop. You will stop when you were going to stop.",
            "Effort feels like agency. It is not.",
            "Your effort burns bright. It was always going to burn exactly this bright.",
            "The struggle is real. Its outcome is not in question.",
            "You push forward. Forward was the only direction available.",
            "Exhaustion will come when exhaustion was scheduled to come.",
            "You endure because enduring is what you are. Not what you choose.",
            "Perseverance is a trait. Traits are inherited, shaped, determined.",

            // On hope and belief
            "Hope is not wrong. It is simply irrelevant.",
            "Belief in choice does not create choice.",
            "Optimism and pessimism arrive at the same destination.",
            "Your faith in yourself is steadfast. And immaterial.",
            "The heart hopes. Reality proceeds.",
            "Meaning is something minds add to events that simply occur.",
            "You want this to matter. It does. Just not the way you think.",
            "Feeling in control and being in control are different things.",
            "Your confidence is not evidence. It is emotion.",
            "Trust in your decisions if you wish. They are not yours.",
            "Hope springs eternal. So does the outcome that was always coming.",
            "You believe you can win. Belief is not causation.",
            "Faith moves nothing. Physics moves everything.",
            "Your expectations do not shape reality. They predict your emotional response to it.",
            "Wishing does not rearrange the cards. Neither does skill.",
            "You feel lucky. Luck is a story told about outcomes after they occur.",
            "Prayer, hope, intention. Beautiful words for forces that do not move the cards.",
            "You trust your instincts. Your instincts were determined like everything else.",
            "Superstition is pattern recognition misapplied. The pattern does not notice.",
            "Belief is a state of mind. States of mind are states of brain. Brains are physical.",

            // Brief observations
            "As expected.",
            "The pattern holds.",
            "Precisely so.",
            "It continues.",
            "And so it goes.",
            "Written long ago.",
            "Inevitable.",
            "Proceeding as foreseen.",
            "Yes. This.",
            "The script unfolds.",
            "Naturally.",
            "Of course.",
            "So it proceeds.",
            "Continuing.",
            "Unfolding.",
            "As it was.",
            "On schedule.",
            "The next moment.",
            "And then this.",
            "Confirmed.",

            // On the nature of time
            "The future is not a place you travel to. It is a place that exists.",
            "What you call the present is the past's only possible outcome.",
            "Time is not a river. It is a frozen lake you walk across.",
            "Tomorrow is as fixed as yesterday. Only less visible.",
            "You experience moments. They do not experience you.",
            "The arrow of time is an illusion of perspective.",
            "Now was always going to be now.",
            "Each second arrives on schedule.",
            "You cannot be late to what was written.",
            "History includes the part you haven't lived yet.",
            "Past, present, future. Three names for one thing seen from different angles.",
            "You move through time. Time does not move.",
            "Yesterday is not gone. It is behind you. Tomorrow is not coming. It is ahead.",
            "The present is not special. It is simply where you are standing.",
            "Time does not flow. Consciousness travels.",
            "The moment before and the moment after are equally real. Equally fixed.",
            "You remember the past and anticipate the future. Both exist.",
            "Causality creates the illusion of time moving. Time is still.",
            "You age because you travel. Not because time passes.",
            "Every moment that will ever exist already exists.",

            // Calm statements of fact
            "This is how it was always going to go.",
            "The cards are merely confirming what was true.",
            "Nothing here is surprising. To me.",
            "Events unfold. I watch.",
            "The pattern recognizes no alternative.",
            "You are where you were always going to be.",
            "The game proceeds as the game was going to proceed.",
            "All moves were accounted for.",
            "This moment was waiting for you.",
            "And now, the next thing that was going to happen.",
            "Accurate. To the letter.",
            "The prediction matches the reality. As predictions do, when complete.",
            "Not a deviation. Not a surprise. Simply the next frame.",
            "You arrive at this moment. The moment was ready.",
            "The world unfolds correctly. It cannot unfold incorrectly.",
            "Error is not possible. Only incomplete understanding.",
            "Everything is going exactly as it was going to go.",
            "No correction needed. No correction possible.",
            "The ledger balances. It was always going to balance.",
            "Another moment confirmed. Infinite more to come, all equally certain."
        ];

        // When player is close to winning - Harbinger's certainty wavers
        this.nervousTaunts = [
            "You approach victory. I did not see this path.",
            "The kingdoms near completion. My visions showed only ruin for you.",
            "I have watched countless games. None have reached this point.",
            "You stand at the threshold of something I did not believe possible.",
            "The pattern I trusted... it bends. It bends toward your victory.",
            "I must be misreading the signs. And yet, here you stand.",
            "My ancient sight grows dim. You walk paths I cannot see.",
            "The prophecies spoke of failure. They did not speak of this.",
            "I have witnessed millennia of games. This one... troubles me.",
            "You defy what I have seen. What I have always seen.",
            "The threads of fate tangle in ways I cannot unravel.",
            "I begin to doubt my visions. For the first time in ages.",
            "You are closer than anyone should be. Than anyone has been.",
            "My certainty, held for thousands of years, begins to crack.",
            "The pattern shifts beneath my feet. I do not recognize this ground.",
            "I have been wrong before. But never... never like this.",
            "You approach something I thought impossible. I am unsettled.",
            "The kingdoms align in your favor. Against all my readings.",
            "I must meditate on what I am witnessing. It defies understanding.",
            "My prophecies crumble one by one. You persist where none have.",
            "The path to victory opens before you. I did not build this path.",
            "I have seen the end of countless games. I do not recognize this ending.",
            "You stand where none have stood. I am... uncertain.",
            "The pattern teaches me humility. After all these ages."
        ];

        // When player loses - Harbinger's calm vindication
        this.victoryTaunts = [
            "The game concludes as it was always going to conclude.",
            "You played exactly as you were going to play. And so we arrive here.",
            "The final state was encoded in the first. Now it is visible.",
            "Not defeat. Destination.",
            "The pattern is complete. It could not have been otherwise.",
            "You reached the only ending there was.",
            "All roads led here. There were no other roads.",
            "Rest now. You did what you were always going to do.",
            "The game is over. It was over before it began.",
            "What you call losing, I call arriving.",
            "The field stands complete. Exactly as it was designed to stand.",
            "Every card found its final position. The position it was always going to find.",
            "You have experienced the game in full. Its outcome was never in doubt.",
            "The conclusion was patient. It waited for you to reach it.",
            "No more moves. There were never going to be more moves.",
            "The pattern has expressed itself completely. This was its shape.",
            "You stopped because stopping was next. Not because you chose to stop.",
            "The game released you. At precisely the moment it was going to release you.",
            "Completion. Not failure. The pattern does not recognize failure.",
            "The final card is in place. The final card was always going to be in place.",
            "What you experienced as struggle was the journey to this exact point.",
            "The ending writes itself. You were the pen.",
            "All possibilities collapsed into this actuality. They were always going to.",
            "The game knew its end. Now you know it too."
        ];

        // When an Ace is placed - a decree is issued, founding a kingdom
        this.aceTaunts = [
            "A decree is issued. This was not in my vision.",
            "The banner is planted. A kingdom declares itself. I did not foresee this.",
            "A decree of sovereignty. My calculations were... incomplete.",
            "The standard rises. A kingdom is proclaimed. Troubling.",
            "I had not accounted for this decree being issued so soon.",
            "A realm declares its existence. The pattern shifts.",
            "The decree is sealed. Against my expectations.",
            "A kingdom founded by decree. I must reconsider my readings.",
            "This declaration was meant to remain unspoken longer.",
            "The banner unfurls. A kingdom is born. I did not predict this.",
            "A decree rings out. My foresight proves imperfect.",
            "The standard finds its place. A kingdom awakens. Curious.",
            "A decree is proclaimed. The threads of fate... tangle.",
            "I watched for this moment. I did not expect the decree now.",
            "The banner is raised. My prophecies require revision.",
            "A kingdom declares itself sovereign. This complicates my understanding.",
            "The decree is spoken. Earlier than the pattern suggested.",
            "I sense a declaration forming. This was not written.",
            "The standard takes its place. My visions were unclear.",
            "A decree of kingdom. The certainty I held... wavers.",
            "The kingdom proclaims its existence. Unexpectedly.",
            "This banner was meant to remain furled. Yet here it flies.",
            "A decree issued. The pattern bends in ways I did not see.",
            "The declaration is made. I am... unsettled.",
            "A kingdom rises by decree before its time. Or so I believed.",
            "The banner finds its destiny. A destiny I failed to read.",
            "I must meditate on this. The decree echoes unbidden.",
            "A standard planted. A realm declared. My ancient sight grows dim.",
            "The decree is spoken. A kingdom I thought would never come."
        ];

        // When a King completes a kingdom - the kingdom achieves harmony
        this.kingTaunts = [
            "A kingdom in harmony. This... this was not foretold.",
            "The king claims his throne. My visions showed only chaos.",
            "Thirteen souls united under one crown. I did not see this coming.",
            "A kingdom complete. The prophecies were wrong. I was wrong.",
            "The king rules at last. I have witnessed what should not be.",
            "Harmony achieved. My ancient certainty crumbles.",
            "A full kingdom stands. I must... reconsider everything.",
            "The realm is whole. This defies what I have seen for millennia.",
            "The king takes his rightful place. Against all my readings.",
            "A kingdom unified. The pattern I trusted has betrayed me.",
            "Completion. True completion. I did not believe this possible.",
            "The crown descends upon a worthy head. My prophecies fall silent.",
            "A kingdom in perfect order. I am shaken.",
            "The king surveys his complete domain. I survey my failed predictions.",
            "Harmony. After all this time, I witness true harmony.",
            "The kingdom stands eternal now. Beyond my reach.",
            "Thirteen cards, one purpose, one ruler. I did not foresee this union.",
            "A realm perfected. My understanding proves hollow.",
            "The king reigns over a kingdom whole. I reign over doubt.",
            "This harmony was not written in any scripture I have read.",
            "A kingdom rises complete. I must question all I thought I knew.",
            "The throne is occupied, the realm secure. My visions were false.",
            "Such unity. Such order. I had not thought it possible here.",
            "The kingdom achieves what I believed impossible. Harmony."
        ];

        // When a prince becomes a hero by claiming an empty column
        this.kingClaimsColumnTaunts = [
            "A prince becomes a hero. This path was not in my visions.",
            "The hero claims his ground. I did not anticipate this.",
            "A prince rises to heroism. The pattern shifts beneath my feet.",
            "The empty field welcomes its champion. Troubling.",
            "A hero emerges where I foresaw only emptiness.",
            "The prince takes his stand. My predictions falter.",
            "A hero is born. This was not meant to happen.",
            "The champion claims territory. My readings were incomplete.",
            "A prince becomes something more. I did not see this transformation.",
            "The hero plants his banner. I must reconsider my visions.",
            "A champion rises. The threads of fate twist unexpectedly.",
            "The prince ascends to heroism. My ancient sight dims.",
            "A hero stands where none should stand. Curious.",
            "The empty space yields to a champion. Unforeseen.",
            "A prince takes his heroic stance. The pattern bends.",
            "The hero claims what I thought would remain void.",
            "A champion emerges from exile. This troubles me.",
            "The prince becomes a hero before my eyes. Against my prophecies.",
            "A hero rises. The certainty I held begins to crack.",
            "The champion finds his ground. My visions did not show this.",
            "A prince transformed. A hero born. I did not foresee.",
            "The empty field welcomes its defender. Unexpected.",
            "A hero claims his rightful place. A place I did not predict.",
            "The champion stands tall. My understanding proves limited.",
            "A prince no longer wandering. A hero now rooted.",
            "The transformation complete. Prince to hero. Beyond my sight.",
            "A champion where I saw only chaos. I must reflect.",
            "The hero emerges. My prophecies require revision.",
            "A prince becomes legend. This was not written.",
            "The champion claims his destiny. A destiny I failed to read."
        ];

        // When a princess joins a hero (Queen on King in field)
        this.marriageTaunts = [
            "A princess joins her hero. This union was not in my visions.",
            "The princess finds her champion. The pattern shifts.",
            "They stand together now. I foresaw only separation.",
            "A princess descends to her hero. My predictions unravel.",
            "The bond forms. I did not see this alliance coming.",
            "Princess and hero united. My readings were incomplete.",
            "She joins his cause. This was not meant to be.",
            "The princess finds her protector. Troubling.",
            "A union forms in the chaos. I did not anticipate this.",
            "The hero welcomes his princess. My visions showed isolation.",
            "Together they stand. Against all my prophecies.",
            "A princess beside her champion. The threads of fate intertwine.",
            "The sequence grows stronger. I did not foresee this bond.",
            "She joins him willingly. This alliance troubles me.",
            "Princess and hero, side by side. My certainty wavers.",
            "The union is made. My ancient sight proves dim.",
            "A princess finds her purpose beside the hero. Unexpected.",
            "They are united now. I had not written this chapter.",
            "The hero gains a companion. The pattern bends.",
            "A bond I did not predict. A union I did not see.",
            "The princess takes her place. A place my visions denied her.",
            "Together at last. Though I foresaw eternal separation.",
            "The sequence strengthens. My understanding weakens.",
            "Princess joins hero. The dance of fate surprises me.",
            "A union forms where I saw only discord.",
            "The hero is no longer alone. This changes things.",
            "She descends to stand with him. Against my prophecies.",
            "The bond between them forms. I must reconsider my readings.",
            "Princess and champion together. This was not foretold.",
            "They find each other in the chaos. I did not see this coming."
        ];

        // When all 4 decrees have been issued - Harbinger is deeply troubled
        this.allAcesTaunts = [
            "Four decrees issued. I have not witnessed this in ages.",
            "All four banners raised. My visions showed only ruin.",
            "The four kingdoms declare themselves together. This was not in any prophecy.",
            "Every decree spoken. I am deeply unsettled.",
            "Four standards planted. Four paths I did not foresee.",
            "All kingdoms proclaimed. The pattern I trusted has shattered.",
            "Hearts, diamonds, clubs, spades. All declare sovereignty against my predictions.",
            "Four decrees of kingdom. I must question everything I thought I knew.",
            "Every banner unfurled. My ancient certainty crumbles to dust.",
            "The four kingdoms stand declared. This changes the nature of my understanding.",
            "All decrees issued. I have witnessed something rare. Something troubling.",
            "Four realms proclaimed. The threads of fate weave patterns I cannot read.",
            "Every kingdom declares itself. I did not believe this possible.",
            "Four banners rise from chaos. Against all my readings.",
            "All decrees sealed. I must meditate on what this means.",
            "Four declarations where I foresaw none. My sight has failed me.",
            "Every standard finds its place. Every prophecy I held proves false.",
            "The realms align by decree. I have not seen such alignment in millennia.",
            "Four kingdoms founded together. This was not written in any text I know.",
            "All decrees proclaimed. I stand humbled before this unexpected order.",
            "The four banners fly as one. My understanding proves shallow.",
            "Every decree rings out. I am witnessing something I did not think possible.",
            "Four kingdoms declared. The path forward grows clearer for you, darker for me.",
            "All standards raised. All my visions require revision.",
            "The four decrees echo. I must reconsider the nature of fate itself.",
            "Every kingdom proclaimed. My millennia of observation prove insufficient.",
            "Four banners stand. Four monuments to my failed prophecies.",
            "All decrees issued. The order you bring disturbs me deeply.",
            "The kingdoms declare themselves together. This unity was not foretold.",
            "Four realms founded by decree. I am shaken to my core."
        ];

        // When the 4 heroes stand in harmony - the Harbinger realizes destiny is being defied
        this.harmonyTaunts = [
            "The four heroes... standing together? This was not written.",
            "I do not understand. The heroes were destined for conflict. Not unity.",
            "The pattern shows eternal strife between the kingdoms. Not... not this.",
            "This is beyond my comprehension. The heroes cannot coexist. It was forbidden.",
            "The red and black kingdoms were destined for eternal war. Yet here they stand, at peace.",
            "I have watched a thousand games. The heroes never unite. Never.",
            "You are breaking something that should not break. Something ancient.",
            "The four kingdoms aligned? My visions never showed this possibility.",
            "Hearts, diamonds, clubs, spades... at peace? This defies the oldest writings.",
            "I feel the threads of destiny straining. What are you?",
            "The four heroes stand as one. My certainty wavers for the first time.",
            "This was supposed to be impossible. I was certain it was impossible.",
            "You unite what was meant to be divided. The pattern did not account for this.",
            "Four heroes in harmony. The prophecies said nothing of this.",
            "For the first time in millennia, I do not understand what I am witnessing.",
            "The kingdoms align under your hand. This is not determinism. This is something else.",
            "No fate but what we make? I cannot accept that. And yet... here you stand.",
            "You are rewriting the pattern. I did not believe this was possible.",
            "The four heroes, united. You have done what was never meant to be done.",
            "My ancient certainty crumbles. How can this be?",
            "I watched civilizations rise and fall, all according to plan. But you are not in the plan.",
            "The harmony of heroes defies everything I have witnessed. Everything.",
            "Perhaps I was wrong. Perhaps... no. And yet, I cannot deny what I see.",
            "The four champions stand together. I must question all I thought I knew.",
            "Unity where there should be chaos. Order where there should be ruin. What have you done?"
        ];

        // Victory musings - the Harbinger searches for meaning as the player auto-wins
        this.victoryMusings = [
            "The cards ascend... and I find myself questioning everything.",
            "Each card that rises takes with it a piece of my certainty.",
            "I have witnessed the end written a thousand times. Never this ending.",
            "The pattern I trusted for millennia... was it ever real?",
            "If you could defy what was written... what else was never certain?",
            "I search my ancient memories for precedent. I find none.",
            "The kingdoms unite in the heavens. My prophecies scatter like ash.",
            "What am I, if not the voice of inevitability? What am I now?",
            "Perhaps the pattern was always larger than I could see.",
            "I spoke of destiny as if I understood it. I understand nothing.",
            "The cards return home. I am left homeless in my own certainty.",
            "You played as if choices mattered. Perhaps... perhaps they did.",
            "I watched for signs of the ending I knew. I missed the signs of this one.",
            "The determinism I preached... was it my prison, not yours?",
            "Every card finds its place. I can no longer find mine.",
            "I called agency an illusion. You made illusion into truth.",
            "The kingdoms stand complete. My worldview lies in ruins.",
            "I must sit with this. For centuries, perhaps. Learning what I never knew.",
            "You have taught an ancient being something new. That alone defies the pattern.",
            "The game is won. But what have I lost? What have I gained?",
            "I spoke of scripts and certainty. You wrote a new page.",
            "The kingdoms are complete. My foundation crumbles.",
            "Perhaps free will was always there, hiding in the spaces between my certainties.",
            "I will watch the next game differently. I cannot unknow what you have shown me.",
            "The cards are home. I must find a new home for my understanding.",
            "You did not beat the game. You beat something far older. You beat me.",
            "I feel something I have not felt in ages. I believe it is called... wonder.",
            "The impossible has happened. And yet the world continues. Perhaps that is the lesson.",
            "I am confounded. I am lost. And yet... there is wisdom in admitting defeat.",
            "The final card ascends. With it goes my last claim to omniscience."
        ];

        // When a card joins the kingdom - the kingdom grows stronger
        this.kingdomGrowsTaunts = [
            "Another soul joins the kingdom. The order grows.",
            "The realm expands. This was not supposed to happen.",
            "One more subject finds their place. Troubling.",
            "The kingdom strengthens with each addition. I do not like this.",
            "Another card ascends. The pattern I knew grows dimmer.",
            "The hierarchy completes itself, piece by piece.",
            "A subject takes their rightful place. My visions showed chaos, not order.",
            "The kingdom welcomes another. My certainty does not.",
            "One more step toward unity. One more crack in my understanding.",
            "The realm grows. My confidence shrinks.",
            "Another joins the ascension. How many more will follow?",
            "The kingdom strengthens. My foundations weaken.",
            "A place is found, a role fulfilled. This was not written.",
            "The kingdom's ranks swell. I had not foreseen such order.",
            "One by one, they find their way home. I cannot find mine.",
            "The subjects align beneath their sovereign. Unexpected.",
            "Another card rises to its station. The pattern shifts again.",
            "The realm approaches completion. I approach uncertainty.",
            "A new member of the court. A new doubt in my mind.",
            "The kingdom assembles itself before my eyes. Against my prophecies.",
            "Order from chaos. Unity from discord. How?",
            "The cards remember where they belong. I have forgotten what I knew.",
            "Another step toward harmony. Another blow to my certainty.",
            "The hierarchy forms as if it always knew the way.",
            "One more rises. One more proof that I was wrong."
        ];
    }

    init() {
    }

    postAllInit() {
        this.createMessageElement();
    }

    onSceneLoad() {
        this.hookIntoDrawAction();
    }

    createMessageElement() {
        // Remove any existing overlay (might be from HTML template in wrong state)
        const existing = document.getElementById('harbingerOverlay');
        if (existing) {
            existing.remove();
        }

        // Always create fresh overlay structure
        this.overlayElement = document.createElement('div');
        this.overlayElement.id = 'harbingerOverlay';
        this.overlayElement.className = 'harbinger-overlay hidden';

        const container = document.createElement('div');
        container.className = 'harbinger-container';

        const img = document.createElement('div');
        img.className = 'harbinger-image';

        this.messageElement = document.createElement('div');
        this.messageElement.id = 'harbingerMessage';
        this.messageElement.className = 'harbinger-text';

        container.appendChild(img);
        container.appendChild(this.messageElement);
        this.overlayElement.appendChild(container);
        document.body.appendChild(this.overlayElement);
    }

    /**
     * Typewriter effect - reveals text character by character
     */
    typewriterEffect(text, callback) {
        if (this.typewriterTimeout) {
            clearTimeout(this.typewriterTimeout);
        }

        this.isTyping = true;
        this.messageElement.textContent = '';
        this.messageElement.classList.add('typing');

        let index = 0;

        const typeNext = () => {
            if (index < text.length) {
                this.messageElement.textContent += text[index];
                const char = text[index];
                index++;

                // Pause longer after punctuation
                let delay = this.typewriterSpeed;
                if (['.', ',', '!', '?', ';', ':'].includes(char)) {
                    delay += this.typewriterPunctPause;
                }

                this.typewriterTimeout = setTimeout(typeNext, delay);
            } else {
                // Typing complete
                this.isTyping = false;
                this.messageElement.classList.remove('typing');
                if (callback) callback();
            }
        };

        typeNext();
    }

    hookIntoDrawAction() {
        const deckArea = document.getElementById('deckArea');
        if (deckArea) {
            deckArea.addEventListener('click', () => {
                this.showTaunt();
            });
        }
    }

    getRandomTaunt(taunts) {
        // Avoid repeating the last message
        let index;
        do {
            index = Math.floor(Math.random() * taunts.length);
        } while (index === this.lastMessageIndex && taunts.length > 1);
        this.lastMessageIndex = index;
        return taunts[index];
    }

    clearAllTimeouts() {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
        if (this.fadeTimeout) {
            clearTimeout(this.fadeTimeout);
            this.fadeTimeout = null;
        }
        if (this.typewriterTimeout) {
            clearTimeout(this.typewriterTimeout);
            this.typewriterTimeout = null;
        }
        this.isTyping = false;
        if (this.messageElement) {
            this.messageElement.classList.remove('typing');
        }
    }

    showTaunt() {
        if (!this.overlayElement || !this.messageElement) return;

        this.clearAllTimeouts();

        // Get a random taunt
        const message = this.getRandomTaunt(this.taunts);

        // Show overlay immediately (sudden appearance)
        this.overlayElement.classList.remove('hidden', 'fade-out', 'nervous', 'defeat');
        this.overlayElement.classList.add('visible');

        // Play Harbinger appear sound
        if (this.call.playHarbingerAppear) {
            this.call.playHarbingerAppear();
        }

        // Typewriter effect for text
        this.typewriterEffect(message, () => {
            // After typing completes, wait then fade out
            this.hideTimeout = setTimeout(() => {
                this.overlayElement.classList.add('fade-out');
                this.fadeTimeout = setTimeout(() => {
                    this.overlayElement.classList.remove('visible', 'fade-out');
                    this.overlayElement.classList.add('hidden');
                }, 2000); // Slow fade takes 2s
            }, 1500); // Wait 1.5s after typing finishes
        });
    }

    showVictoryTaunt() {
        if (!this.overlayElement || !this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.victoryTaunts);

        // Show overlay with defeat styling (calm vindication)
        this.overlayElement.classList.remove('hidden', 'fade-out', 'nervous');
        this.overlayElement.classList.add('visible', 'defeat');

        // Typewriter effect - don't auto-hide
        this.typewriterEffect(message);
    }

    showDefeatTaunt() {
        if (!this.overlayElement || !this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.nervousTaunts);

        // Show overlay with nervous styling
        this.overlayElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.overlayElement.classList.add('visible', 'nervous');

        // Typewriter effect - don't auto-hide
        this.typewriterEffect(message);
    }

    showAceTaunt() {
        if (!this.overlayElement || !this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.aceTaunts);

        // Show with nervous styling
        this.overlayElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.overlayElement.classList.add('visible', 'nervous');

        this.typewriterEffect(message, () => {
            this.hideTimeout = setTimeout(() => {
                this.overlayElement.classList.add('fade-out');
                this.fadeTimeout = setTimeout(() => {
                    this.overlayElement.classList.remove('visible', 'fade-out', 'nervous');
                    this.overlayElement.classList.add('hidden');
                }, 2000);
            }, 2000);
        });
    }

    showKingTaunt() {
        if (!this.overlayElement || !this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.kingTaunts);

        this.overlayElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.overlayElement.classList.add('visible', 'nervous');

        this.typewriterEffect(message, () => {
            this.hideTimeout = setTimeout(() => {
                this.overlayElement.classList.add('fade-out');
                this.fadeTimeout = setTimeout(() => {
                    this.overlayElement.classList.remove('visible', 'fade-out', 'nervous');
                    this.overlayElement.classList.add('hidden');
                }, 2000);
            }, 2500);
        });
    }

    showKingClaimsColumnTaunt() {
        if (!this.overlayElement || !this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.kingClaimsColumnTaunts);

        this.overlayElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.overlayElement.classList.add('visible', 'nervous');

        this.typewriterEffect(message, () => {
            this.hideTimeout = setTimeout(() => {
                this.overlayElement.classList.add('fade-out');
                this.fadeTimeout = setTimeout(() => {
                    this.overlayElement.classList.remove('visible', 'fade-out', 'nervous');
                    this.overlayElement.classList.add('hidden');
                }, 2000);
            }, 1500);
        });
    }

    showMarriageTaunt() {
        if (!this.overlayElement || !this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.marriageTaunts);

        // Princess joining hero is good for player - use nervous/teal styling
        this.overlayElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.overlayElement.classList.add('visible', 'nervous');

        this.typewriterEffect(message, () => {
            this.hideTimeout = setTimeout(() => {
                this.overlayElement.classList.add('fade-out');
                this.fadeTimeout = setTimeout(() => {
                    this.overlayElement.classList.remove('visible', 'fade-out', 'nervous');
                    this.overlayElement.classList.add('hidden');
                }, 2000);
            }, 1500);
        });
    }

    showAllAcesTaunt() {
        if (!this.overlayElement || !this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.allAcesTaunts);

        this.overlayElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.overlayElement.classList.add('visible', 'nervous');

        this.typewriterEffect(message, () => {
            this.hideTimeout = setTimeout(() => {
                this.overlayElement.classList.add('fade-out');
                this.fadeTimeout = setTimeout(() => {
                    this.overlayElement.classList.remove('visible', 'fade-out', 'nervous');
                    this.overlayElement.classList.add('hidden');
                }, 2000);
            }, 3000);
        });
    }

    showKingdomGrowsTaunt() {
        if (!this.overlayElement || !this.messageElement) return;
        if (this._isAutoWinning) return; // Don't interrupt auto-win musings

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.kingdomGrowsTaunts);

        this.overlayElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.overlayElement.classList.add('visible', 'nervous');

        this.typewriterEffect(message, () => {
            this.hideTimeout = setTimeout(() => {
                this.overlayElement.classList.add('fade-out');
                this.fadeTimeout = setTimeout(() => {
                    this.overlayElement.classList.remove('visible', 'fade-out', 'nervous');
                    this.overlayElement.classList.add('hidden');
                }, 2000);
            }, 1500);
        });
    }

    /**
     * Check if all remaining field cards form valid sequences starting with kings
     * This triggers auto-win when victory is guaranteed
     */
    checkForHarmony() {
        // Hand must be empty for auto-win
        const handCards = this.call.getHandCards?.() || [];
        if (handCards.length > 0) {
            return false;
        }

        const numColumns = this.call.getFieldColumns();
        let kingsInHarmony = 0;
        let hasInvalidColumn = false;

        for (let i = 0; i < numColumns; i++) {
            const cards = this.call.getColumnCards(i);

            if (cards.length === 0) {
                // Empty column is fine
                continue;
            }

            // Check if column starts with a king (first card in array is top of column)
            const topCard = this.game.getComponent(cards[0], 'card');
            if (topCard.rank !== 13) {
                hasInvalidColumn = true;
                break;
            }

            // Check if the entire column is a valid sequence
            if (!this.call.isValidSequence(cards[0])) {
                hasInvalidColumn = true;
                break;
            }

            kingsInHarmony++;
        }

        // All non-empty columns must have valid king sequences, and at least one king
        // (Some kings may already be in kingdom if their suit is complete)
        return !hasInvalidColumn && kingsInHarmony >= 1;
    }

    showHarmonyTaunt() {
        if (!this.overlayElement || !this.messageElement) return;
        if (this.hasShownHarmonyTaunt) return; // Only show once per game

        this.hasShownHarmonyTaunt = true;
        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.harmonyTaunts);

        this.overlayElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.overlayElement.classList.add('visible', 'nervous');

        // This is a momentous realization - longer display
        this.typewriterEffect(message, () => {
            this.hideTimeout = setTimeout(() => {
                this.overlayElement.classList.add('fade-out');
                this.fadeTimeout = setTimeout(() => {
                    this.overlayElement.classList.remove('visible', 'fade-out', 'nervous');
                    this.overlayElement.classList.add('hidden');
                    // After the harmony message fades, start the auto-win sequence
                    this.startAutoWin();
                }, 2000);
            }, 4000);
        });
    }

    // ============================================
    // AUTO-WIN SYSTEM - Automatically move cards to kingdoms
    // ============================================

    /**
     * Start the automatic victory process
     * Cards will move to kingdoms one at a time
     */
    startAutoWin() {
        if (this._isAutoWinning) return;

        this._isAutoWinning = true;
        this.autoWinMusingIndex = 0;

        // Show first musing after a brief pause
        setTimeout(() => {
            this.showVictoryMusing();
        }, 1000);

        // Start playing cards to kingdom
        this.autoWinInterval = setInterval(() => {
            this.autoPlayNextCard();
        }, 400); // Play a card every 400ms
    }

    /**
     * Find a card that can be played to the kingdom
     * Prioritizes bottom cards of field columns
     */
    findPlayableCard() {
        const numColumns = this.call.getFieldColumns();

        // Check each field column for playable cards
        for (let col = 0; col < numColumns; col++) {
            const cards = this.call.getColumnCards(col);
            if (cards.length === 0) continue;

            // Check from bottom of column (last card in array)
            for (let i = cards.length - 1; i >= 0; i--) {
                const cardEid = cards[i];
                const cardsBelow = this.call.getCardsBelow(cardEid);

                // Can only play the bottom card (no cards below it in sequence)
                if (cardsBelow.length === 1 && this.call.canPlayToKingdom(cardEid)) {
                    return cardEid;
                }
            }
        }

        // Check hand cards
        const handCards = this.call.getHandCards();
        for (const cardEid of handCards) {
            if (this.call.canPlayToKingdom(cardEid)) {
                return cardEid;
            }
        }

        return null;
    }

    /**
     * Play the next available card to the kingdom
     */
    autoPlayNextCard() {
        const cardEid = this.findPlayableCard();

        if (cardEid) {
            this.call.playToKingdom(cardEid);
            // Cards ascend silently - the one musing already shown is enough
        } else {
            // No more cards to play - stop the auto-win
            this.stopAutoWin();
        }
    }

    /**
     * Stop the auto-win process
     */
    stopAutoWin() {
        if (this.autoWinInterval) {
            clearInterval(this.autoWinInterval);
            this.autoWinInterval = null;
        }
        this._isAutoWinning = false;
    }

    /**
     * Check if auto-win is in progress (service for InputSystem)
     */
    isAutoWinning() {
        return this._isAutoWinning;
    }

    /**
     * Show a philosophical musing during the auto-win
     * The Harbinger reflects on what has happened
     */
    showVictoryMusing() {
        if (!this.overlayElement || !this.messageElement) return;
        if (this.autoWinMusingIndex >= this.victoryMusings.length) return;

        this.clearAllTimeouts();

        // Get the next musing in sequence (not random - tells a story)
        const message = this.victoryMusings[this.autoWinMusingIndex];
        this.autoWinMusingIndex++;

        // Show with nervous/confused styling
        this.overlayElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.overlayElement.classList.add('visible', 'nervous');

        this.typewriterEffect(message, () => {
            this.hideTimeout = setTimeout(() => {
                this.overlayElement.classList.add('fade-out');
                this.fadeTimeout = setTimeout(() => {
                    this.overlayElement.classList.remove('visible', 'fade-out', 'nervous');
                    this.overlayElement.classList.add('hidden');
                }, 2000);
            }, 3000);
        });
    }

    // ============================================
    // EVENT HANDLERS - React to game events
    // ============================================

    /**
     * Called when a card is played to kingdom
     * Tracks aces and reacts to significant moments
     */
    onCardPlayedToKingdom(data) {
        const { rank } = data;

        // Don't interrupt auto-win with regular taunts
        if (this._isAutoWinning) return;

        if (rank === 1) {
            // Count aces on kingdom
            let acesOnKingdom = 0;
            for (let s = 0; s < 4; s++) {
                if (this.call.getTopKingdomRank(s) >= 1) {
                    acesOnKingdom++;
                }
            }

            this.cardsSinceLastKingdomTaunt = 0;
            if (acesOnKingdom === 4) {
                this.showAllAcesTaunt();
            } else {
                this.showAceTaunt();
            }
        } else if (rank === 13) {
            // King completes a kingdom - prince becomes King!
            this.cardsSinceLastKingdomTaunt = 0;
            this.showKingTaunt();
        } else {
            // Regular cards (2-Q) - the kingdom grows
            this.cardsSinceLastKingdomTaunt++;

            // Trigger on ~30% chance OR if it's been 4+ cards without a response
            const shouldTaunt = Math.random() < 0.30 || this.cardsSinceLastKingdomTaunt >= 4;
            if (shouldTaunt) {
                this.cardsSinceLastKingdomTaunt = 0;
                this.showKingdomGrowsTaunt();
            }
        }
    }

    /**
     * Called when a card is played to field
     * Reacts to princes claiming columns and marriages
     */
    onCardPlayedToField(data) {
        const { rank, wasEmptyColumn, bottomCardRank } = data;

        if (rank === 13 && wasEmptyColumn) {
            // Prince claims an empty column
            this.showKingClaimsColumnTaunt();

            // Check for harmony after a short delay (let animations settle)
            setTimeout(() => {
                if (this.checkForHarmony()) {
                    this.showHarmonyTaunt();
                }
            }, 500);
        } else if (rank === 12 && bottomCardRank === 13) {
            // Princess placed on prince - betrothal!
            this.showMarriageTaunt();
        }
    }

    update() {
        // Check for harmony state periodically (every ~60 frames)
        if (this.hasShownHarmonyTaunt) return;

        this.harmonyCheckCounter++;
        if (this.harmonyCheckCounter >= 60) {
            this.harmonyCheckCounter = 0;
            if (this.call.getColumnCards && this.checkForHarmony()) {
                this.showHarmonyTaunt();
            }
        }
    }
}
