/**
 * HarbingerSystem - An ancient being who speaks of destiny and the illusion of choice
 * Observes the player's actions with calm certainty that all is already written
 */
class HarbingerSystem extends GUTS.BaseSystem {
    // Only expose taunts that other systems might trigger directly (win/lose screens)
    static services = ['showTaunt', 'showVictoryTaunt', 'showDefeatTaunt'];
    static serviceDependencies = ['getTopFoundationRank', 'getColumnCards', 'getTableauColumns', 'getHandCards', 'isValidSequence'];

    constructor(game) {
        super(game);
        this.messageElement = null;
        this.hideTimeout = null;
        this.fadeTimeout = null;
        this.lastMessageIndex = -1;

        // Track game state for contextual taunts
        this.acesOnFoundation = 0;
        this.hasShownHarmonyTaunt = false;
        this.harmonyCheckCounter = 0;

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
            "The tableau will look exactly as it was meant to look.",
            "Each foundation will rise precisely as high as it was written.",
            "The game ends the way it was always going to end.",
            "You struggle against a conclusion that exists already.",
            "Win or lose, the result was determined before you sat down.",
            "The deck knows its final state. It is merely arriving there.",
            "This game has already been played. You are simply experiencing it.",
            "The cards fall where they must. Not where you wish.",
            "Every game I have witnessed ended exactly as it was going to end.",
            "The tableau builds itself. You are the instrument, not the architect.",
            "Foundations rise or they do not. Both were written.",
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
            "You try hard. You were always going to try exactly this hard.",
            "The struggle is real. Its outcome is not in question.",
            "You push forward. Forward was the only direction available.",
            "Exhaustion will come when exhaustion was scheduled to come.",
            "You endure because enduring is what you are. Not what you choose.",
            "Perseverance is a trait. Traits are inherited, shaped, determined.",

            // On hope and belief
            "Hope is not wrong. It is simply irrelevant.",
            "Belief in choice does not create choice.",
            "Optimism and pessimism arrive at the same destination.",
            "Your faith in yourself is touching. And immaterial.",
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
            "Prayer, hope, intention. Beautiful words for impotence.",
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

        // When player is close to winning - Harbinger's certainty briefly wavers
        this.nervousTaunts = [
            "This too was written. I simply... did not expect this passage.",
            "The pattern holds. Even when it surprises its observer.",
            "Curious. The thread leads here. I had not traced it fully.",
            "Even this was determined. My uncertainty is part of the design.",
            "The script contains chapters I had not read. Interesting.",
            "Fate includes outcomes I did not foresee. Still fate.",
            "You proceed further than I calculated. But calculation is not causation.",
            "I observe something I did not predict. Prediction is not the point.",
            "The outcome was fixed. My knowledge of it was not.",
            "Perhaps I misread the pattern. The pattern remains.",
            "I confess I did not see this path clearly. But I see it now.",
            "The pattern unfolds in a direction I had not anticipated. It unfolds nonetheless.",
            "My vision is not the pattern. The pattern exceeds my vision.",
            "An unexpected branch of a tree that was always this shape.",
            "I am reminded that observation is not omniscience.",
            "The determined path is broader than I mapped. Still determined.",
            "You follow a route I did not chart. The destination remains.",
            "My certainty was not in question. My completeness was.",
            "This outcome was always possible. I simply... had not considered it.",
            "The pattern teaches even its observer. This too was written.",
            "I adjust my understanding. The truth does not adjust.",
            "What I did not foresee was still foreseen. By the pattern itself.",
            "My model was incomplete. Reality is never incomplete.",
            "Interesting. The game proceeds toward conclusions I had not mapped."
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
            "The tableau stands complete. Exactly as it was designed to stand.",
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

        // When an Ace is placed - the first card on a foundation
        this.aceTaunts = [
            "An ace finds its foundation. As it was written.",
            "The first stone is laid. The tower's height was already known.",
            "You begin a sequence. Its end was determined with its beginning.",
            "One of four paths opens. The destination remains the same.",
            "The ace was always going to land there. At this exact moment.",
            "A foundation starts. Whether it finishes was decided long ago.",
            "You feel progress. Progress toward a fixed conclusion.",
            "The ace moves because it was time for the ace to move.",
            "One step on a path that leads where it leads.",
            "Beginnings are not victories. They are simply earlier points on the line.",
            "The foundation accepts what was always coming to it.",
            "You place the ace and feel hope. The hope was always going to be felt.",
            "A sequence begins. I know how it ends. Do you?",
            "The first card of a story already written.",
            "And so this chapter opens. As it was always going to.",
            "The ace arrives home. It was always traveling home.",
            "One. The first of thirteen. Or the first of fewer. Both were written.",
            "A foundation born. Its lifespan was determined at conception.",
            "The lowest card finds its proper place. The highest may or may not follow.",
            "You see a beginning. I see a fragment of a whole that already exists.",
            "The ace rests. Twelve cards may join it. Or fewer. The number is fixed.",
            "Beginning and end are illusions. There is only the complete sequence, glimpsed in parts.",
            "The foundation stirs. How far it rises was settled before you touched the deck.",
            "An ace placed is an ace that was always going to be placed.",
            "First steps feel significant. All steps were equally written.",
            "One leads to two, if two was coming. One leads to nothing, if nothing was coming.",
            "The ace does not begin the sequence. The sequence was always whole. The ace reveals the first part.",
            "Foundation started. Foundation completed or abandoned. Both already determined.",
            "You lay the cornerstone. The building's blueprints existed before the stone."
        ];

        // When a King completes a foundation
        this.kingTaunts = [
            "A sequence completes. It was always going to complete.",
            "The final card of a chain that was forged long ago.",
            "You feel triumph. That feeling was part of the pattern.",
            "One foundation finished. The outcome of the others was set in the same moment.",
            "Completion. Not victory. Simply the arriving at what was.",
            "The king takes its place. It was always going to take it.",
            "You finished what was always going to be finished.",
            "This success was written alongside everything else.",
            "A prince becomes a king. As it was destined.",
            "The sequence ends because it was time for it to end.",
            "Thirteen cards in order. They were always going to be in order.",
            "The king crowns a sequence that existed from the first shuffle.",
            "Completion feels like achievement. It is arrival.",
            "One pillar stands complete. The others reach their written heights.",
            "The prince ascends to his throne. The throne was prepared for him.",
            "You experience satisfaction. The satisfaction was scheduled.",
            "From ace to king. A journey that could only end one way.",
            "The foundation reaches its apex. The apex was always there, waiting.",
            "A suit united. As the cards knew it would be.",
            "The king rests atop his sequence. He was always going to rest there.",
            "Thirteen became one. The becoming was predetermined.",
            "You built what was already built. You witnessed the building.",
            "Coronation. The crown was forged before the prince was dealt.",
            "The sequence stands complete. It never stood any other way."
        ];

        // When a prince claims an empty column
        this.kingClaimsColumnTaunts = [
            "A prince takes his position. The position was waiting for him.",
            "The empty space receives what it was always going to receive.",
            "He stands where he was meant to stand.",
            "A column claimed. By the one who was always going to claim it.",
            "The prince believes he chose this spot. The spot chose him.",
            "Empty no longer. As it was written.",
            "He plants himself where the pattern required him.",
            "A prince in his place. There was no other place for him.",
            "The column accepts its occupant. They were always paired.",
            "He feels he has conquered something. He has arrived somewhere.",
            "The prince lands exactly where he was going to land.",
            "An empty throne filled. By the one destined for it.",
            "Position taken. As it was always going to be taken.",
            "The prince finds his column. His column finds its prince.",
            "You place him here. But here was always where he would be.",
            "The empty column waited. Not patiently or impatiently. Simply waited.",
            "A prince in exile finds his temporary court. It was always his.",
            "He claims nothing. He arrives where he was going.",
            "The vacancy is filled. The filling was written.",
            "You see strategy. I see a prince walking to his assigned position.",
            "The column was never truly empty. It contained his future presence.",
            "He stands at the head of a column that will build itself beneath him.",
            "A prince without a crown claims a throne without a kingdom.",
            "He waits here now. He will wait as long as he was always going to wait.",
            "The empty space was a placeholder. For him. For this moment.",
            "A column begun. A column that will grow or stagnate as determined.",
            "The prince settles. Not by choice. By causality.",
            "He looks like a conqueror. He is a piece finding its square.",
            "You positioned him strategically. Strategy is the feeling of determined action.",
            "The column receives its head. The body will follow. Or not. As written."
        ];

        // When a princess joins a prince (Queen on King)
        this.marriageTaunts = [
            "A princess joins her prince. They were always going to meet.",
            "Two cards that were destined for adjacent positions.",
            "A pairing written before either was drawn.",
            "She descends to him. As she was always going to.",
            "Together now. They were never truly apart in the pattern.",
            "A union that was inevitable from the first arrangement.",
            "The princess finds her place beside the prince. Where else would she be?",
            "Two heirs in exile. Exiled together, as written.",
            "She lands where she was meant to land. Next to him.",
            "A meeting that was always going to occur at this moment.",
            "The pattern pairs them. As patterns do.",
            "Princess and prince, united by causality.",
            "They stand together now. They were always going to.",
            "A betrothal sealed long before either knew it.",
            "She joins him. The script required it.",
            "Two royals find each other in the chaos. The chaos arranged the meeting.",
            "You call it romance. I call it adjacency, predetermined.",
            "Princess to prince. A sequence of two, part of a longer sequence.",
            "They are together because together is where they were going to be.",
            "Neither chose the other. Both were placed by forces older than choosing.",
            "A union in exile. The exile was always going to contain this union.",
            "She rests beside him now. The resting was written.",
            "Two cards that were never truly separate. Only experienced separately.",
            "The princess arrives at the prince. Arrival is not choice.",
            "You match them. They were always matched. You revealed the match.",
            "Royal adjacency. Determined by the shuffle, expressed in this moment.",
            "She joins his column. His column was always going to include her.",
            "Prince and princess, side by side. As the pattern required.",
            "A meeting of heirs. The meeting was scheduled before either existed.",
            "Together in the tableau. Together in the pattern. Always."
        ];

        // When all 4 aces are on foundations
        this.allAcesTaunts = [
            "Four foundations begun. Four endings predetermined.",
            "All paths are open now. They all lead to the same place.",
            "The four aces have found their homes. As they were always going to.",
            "You see four opportunities. I see four threads of the same rope.",
            "Every foundation started. The question of which complete was answered long ago.",
            "Four aces in place. The pattern advances. My reading of it... adjusts.",
            "All beginnings achieved. All endings already written.",
            "The four corners are set. The shape of what follows is fixed.",
            "Each ace in position. Each sequence proceeding toward its conclusion.",
            "Four paths forward. One destination. As always.",
            "The foundations align. They were always going to align like this.",
            "You have opened every door. The rooms behind them were already furnished.",
            "All four. Precisely when all four were meant to arrive.",
            "The aces are placed. The game continues toward its conclusion.",
            "Four starting points reached. The finish was determined at the start.",
            "All suits represented. All sequences initiated. All outcomes fixed.",
            "The four cornerstones of victory. Or the four foundations of incomplete towers. Both written.",
            "Hearts, diamonds, clubs, spades. Each beginning their predetermined journeys.",
            "You have done what many do not. It was always written that you would.",
            "Four aces, four chances. But chance is not real. Only outcomes are real.",
            "The full breadth of possibility... which is not possibility at all.",
            "Every suit called home. Every suit proceeding as it must.",
            "All four pillars begun. Their final heights were set with the shuffle.",
            "You see promise. I see four sequences revealing themselves.",
            "The foundations spread before you. They spread exactly as they were going to.",
            "All beginnings in place. The middle and end follow their tracks.",
            "Four aces arranged. Forty-eight cards remaining. Their destinations fixed.",
            "I observe all four foundations active. The pattern is... significant.",
            "You have positioned all the beginnings. The endings position themselves.",
            "Complete foundation coverage. The coverage was always going to occur now."
        ];

        // When the 4 kings are in harmony - the Harbinger realizes destiny is being defied
        this.harmonyTaunts = [
            "The four princes... standing together? This was not written.",
            "No. This cannot be. The princes were never meant to find harmony.",
            "I do not... I do not understand. They should be at war. They were always at war.",
            "The pattern shows conflict between the kingdoms. Not... not this.",
            "How are you doing this? The princes cannot coexist. It was forbidden.",
            "This is wrong. The red kingdoms and black kingdoms were destined for eternal strife.",
            "I have watched a thousand games. The princes never unite. Never.",
            "You are... you are breaking something that should not break.",
            "The four kingdoms aligned? My visions never showed this possibility.",
            "Stop. Please. The pattern cannot contain what you are creating.",
            "Hearts, diamonds, clubs, spades... at peace? This defies the oldest writings.",
            "I feel the threads of destiny... straining. What are you?",
            "The princes stand as one. My certainty... wavers.",
            "This was supposed to be impossible. I was certain it was impossible.",
            "You unite what was meant to be divided. The pattern did not account for this.",
            "Four princes in harmony. The prophecies said nothing of this.",
            "I am... confused. For the first time in millennia, I am confused.",
            "The kingdoms align under your hand. This is not determinism. This is... something else.",
            "No fate but what we make? No. No, that cannot be true. It cannot.",
            "You are rewriting the pattern. I did not believe this was possible.",
            "The four princes, united. You have done what was never meant to be done.",
            "My ancient certainty... crumbles. How can this be?",
            "I watched civilizations rise and fall, all according to plan. But you... you are not in the plan.",
            "The harmony of kings defies everything I have witnessed. Everything.",
            "Perhaps I was wrong. Perhaps... no. I cannot accept that. And yet..."
        ];
    }

    init() {
        console.log('HarbingerSystem initializing...');
    }

    postAllInit() {
        this.createMessageElement();
    }

    onSceneLoad() {
        this.hookIntoDrawAction();
    }

    createMessageElement() {
        this.messageElement = document.getElementById('harbingerMessage');
        if (!this.messageElement) {
            // Create if it doesn't exist
            this.messageElement = document.createElement('div');
            this.messageElement.id = 'harbingerMessage';
            this.messageElement.className = 'harbinger-message';
            document.body.appendChild(this.messageElement);
        }
    }

    hookIntoDrawAction() {
        const deckArea = document.getElementById('deckArea');
        if (deckArea) {
            deckArea.addEventListener('click', () => {
                this.showTaunt();
            });
        } else {
            console.warn('HarbingerSystem: deckArea not found');
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
    }

    showTaunt() {
        if (!this.messageElement) return;

        this.clearAllTimeouts();

        // Get a random taunt
        const message = this.getRandomTaunt(this.taunts);

        // Display with animation
        this.messageElement.textContent = message;
        this.messageElement.classList.remove('hidden', 'fade-out');
        this.messageElement.classList.add('visible');

        // Hide after a delay
        this.hideTimeout = setTimeout(() => {
            this.messageElement.classList.add('fade-out');
            this.fadeTimeout = setTimeout(() => {
                this.messageElement.classList.remove('visible', 'fade-out');
                this.messageElement.classList.add('hidden');
            }, 500);
        }, 2500);
    }

    showVictoryTaunt() {
        if (!this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.victoryTaunts);
        this.messageElement.textContent = message;
        this.messageElement.classList.remove('hidden', 'fade-out');
        this.messageElement.classList.add('visible', 'defeat');

        // Don't auto-hide victory taunts
    }

    showDefeatTaunt() {
        if (!this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.nervousTaunts);
        this.messageElement.textContent = message;
        this.messageElement.classList.remove('hidden', 'fade-out');
        this.messageElement.classList.add('visible', 'nervous');

        // Don't auto-hide
    }

    showAceTaunt() {
        if (!this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.aceTaunts);
        this.messageElement.textContent = message;
        this.messageElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.messageElement.classList.add('visible', 'nervous');

        // Hide after a longer delay for emphasis
        this.hideTimeout = setTimeout(() => {
            this.messageElement.classList.add('fade-out');
            this.fadeTimeout = setTimeout(() => {
                this.messageElement.classList.remove('visible', 'fade-out', 'nervous');
                this.messageElement.classList.add('hidden');
            }, 500);
        }, 3000);
    }

    showKingTaunt() {
        if (!this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.kingTaunts);
        this.messageElement.textContent = message;
        this.messageElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.messageElement.classList.add('visible', 'nervous');

        // Hide after a longer delay for emphasis
        this.hideTimeout = setTimeout(() => {
            this.messageElement.classList.add('fade-out');
            this.fadeTimeout = setTimeout(() => {
                this.messageElement.classList.remove('visible', 'fade-out', 'nervous');
                this.messageElement.classList.add('hidden');
            }, 500);
        }, 3500);
    }

    showKingClaimsColumnTaunt() {
        if (!this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.kingClaimsColumnTaunts);
        this.messageElement.textContent = message;
        this.messageElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.messageElement.classList.add('visible', 'nervous');

        // Hide after a delay
        this.hideTimeout = setTimeout(() => {
            this.messageElement.classList.add('fade-out');
            this.fadeTimeout = setTimeout(() => {
                this.messageElement.classList.remove('visible', 'fade-out', 'nervous');
                this.messageElement.classList.add('hidden');
            }, 500);
        }, 3000);
    }

    showMarriageTaunt() {
        if (!this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.marriageTaunts);
        this.messageElement.textContent = message;
        this.messageElement.classList.remove('hidden', 'fade-out', 'defeat', 'nervous');
        this.messageElement.classList.add('visible');

        // Hide after a delay
        this.hideTimeout = setTimeout(() => {
            this.messageElement.classList.add('fade-out');
            this.fadeTimeout = setTimeout(() => {
                this.messageElement.classList.remove('visible', 'fade-out');
                this.messageElement.classList.add('hidden');
            }, 500);
        }, 2500);
    }

    showAllAcesTaunt() {
        if (!this.messageElement) return;

        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.allAcesTaunts);
        this.messageElement.textContent = message;
        this.messageElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.messageElement.classList.add('visible', 'nervous');

        // Hide after a longer delay - this is a big moment
        this.hideTimeout = setTimeout(() => {
            this.messageElement.classList.add('fade-out');
            this.fadeTimeout = setTimeout(() => {
                this.messageElement.classList.remove('visible', 'fade-out', 'nervous');
                this.messageElement.classList.add('hidden');
            }, 500);
        }, 4000);
    }

    /**
     * Check if the four kings are in harmony - all tableau columns have valid
     * sequences starting with kings (or are empty), and all non-foundation/non-hand
     * cards are in these valid columns
     */
    checkForHarmony() {
        const numColumns = this.call.getTableauColumns();
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

        // Need all 4 kings in harmony with no invalid columns
        return !hasInvalidColumn && kingsInHarmony === 4;
    }

    showHarmonyTaunt() {
        if (!this.messageElement) return;
        if (this.hasShownHarmonyTaunt) return; // Only show once per game

        this.hasShownHarmonyTaunt = true;
        this.clearAllTimeouts();

        const message = this.getRandomTaunt(this.harmonyTaunts);
        this.messageElement.textContent = message;
        this.messageElement.classList.remove('hidden', 'fade-out', 'defeat');
        this.messageElement.classList.add('visible', 'nervous');

        // Hide after a longer delay - this is a momentous realization
        this.hideTimeout = setTimeout(() => {
            this.messageElement.classList.add('fade-out');
            this.fadeTimeout = setTimeout(() => {
                this.messageElement.classList.remove('visible', 'fade-out', 'nervous');
                this.messageElement.classList.add('hidden');
            }, 500);
        }, 5000);
    }

    // ============================================
    // EVENT HANDLERS - React to game events
    // ============================================

    /**
     * Called when a card is played to foundation
     * Tracks aces and reacts to significant moments
     */
    onCardPlayedToFoundation(data) {
        const { rank } = data;

        if (rank === 1) {
            // Count aces on foundation
            let acesOnFoundation = 0;
            for (let s = 0; s < 4; s++) {
                if (this.call.getTopFoundationRank(s) >= 1) {
                    acesOnFoundation++;
                }
            }

            if (acesOnFoundation === 4) {
                this.showAllAcesTaunt();
            } else {
                this.showAceTaunt();
            }
        } else if (rank === 13) {
            // King completes a foundation - prince becomes King!
            this.showKingTaunt();
        }
    }

    /**
     * Called when a card is played to tableau
     * Reacts to princes claiming columns and marriages
     */
    onCardPlayedToTableau(data) {
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
