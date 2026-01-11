/**
 * ChatSystem - Global chat library for multiplayer games
 * Provides lobby chat (when not in a game) and in-game chat (during matches)
 *
 * Usage:
 * 1. Add "ChatSystem" to your config's libraries list
 * 2. Instantiate in your project: new GUTS.ChatSystem(game, collections)
 * 3. Call init() to create the UI and set up listeners
 * 4. Call onGameJoined() when entering a game room
 * 5. Call onGameLeft() when leaving a game room
 */
class ChatSystem {
    constructor(game, collections) {
        this.game = game;
        this.collections = collections;
        this.game.chatSystem = this;

        // Chat state
        this.messages = [];
        this.maxMessages = 100;
        this.isExpanded = true;
        this.unreadCount = 0;
        this.currentContext = 'lobby'; // 'lobby' or 'game'

        // DOM references
        this.chatContainer = null;
        this.messageList = null;
        this.inputField = null;

        // Network unsubscribers
        this.networkUnsubscribers = [];

        // CSS injected flag
        this.cssInjected = false;
    }

    init() {
        this.injectStyles();
        this.initializeUI();
        this.setupNetworkListeners();
    }

    injectStyles() {
        if (this.cssInjected) return;

        // Get CSS from the chat interface in collections
        const chatInterface = this.collections?.interfaces?.chat;
        if (chatInterface?.css) {
            const styleSheet = document.createElement('style');
            styleSheet.id = 'chat-system-styles';
            styleSheet.textContent = chatInterface.css;
            document.head.appendChild(styleSheet);
            this.cssInjected = true;
        } else {
            console.warn('[ChatSystem] Chat interface CSS not found in collections');
        }
    }

    initializeUI() {
        // Get HTML from the chat interface in collections
        const chatInterface = this.collections?.interfaces?.chat;
        if (chatInterface?.html) {
            document.body.insertAdjacentHTML('beforeend', chatInterface.html);
        } else {
            console.warn('[ChatSystem] Chat interface HTML not found in collections');
            return;
        }

        // Cache DOM references
        this.chatContainer = document.getElementById('chatPanel');
        this.messageList = document.getElementById('chatMessages');
        this.inputField = document.getElementById('chatInput');

        this.setupEventListeners();
    }

    setupEventListeners() {
        const header = document.getElementById('chatHeader');
        const sendBtn = document.getElementById('chatSendBtn');
        const toggle = document.getElementById('chatToggle');

        // Click header to toggle (but not the toggle button itself)
        header?.addEventListener('click', (e) => {
            if (e.target.id !== 'chatToggle') {
                this.toggleChatPanel();
            }
        });

        toggle?.addEventListener('click', () => this.toggleChatPanel());
        sendBtn?.addEventListener('click', () => this.sendCurrentMessage());

        this.inputField?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendCurrentMessage();
            }
        });

        // Prevent game input when typing in chat
        this.inputField?.addEventListener('keydown', (e) => {
            e.stopPropagation();
        });
    }

    setupNetworkListeners() {
        const nm = this.game.clientNetworkManager;
        if (!nm) {
            // Retry after a short delay if network manager isn't ready yet
            setTimeout(() => this.setupNetworkListeners(), 100);
            return;
        }

        this.networkUnsubscribers.push(
            nm.listen('CHAT_MESSAGE', (data) => {
                this.handleIncomingMessage(data);
            })
        );

        // Listen for connection state to update context badge
        this.networkUnsubscribers.push(
            nm.listen('CONNECTED', () => {
                this.updateContextBadge();
            })
        );
    }

    handleIncomingMessage(message) {
        // Only show messages for current context
        if (message.context !== this.currentContext) return;

        this.addMessage(message);

        if (!this.isExpanded) {
            this.unreadCount++;
            this.updateUnreadBadge();
        }
    }

    addMessage(message) {
        this.messages.push(message);

        // Limit message history
        if (this.messages.length > this.maxMessages) {
            this.messages.shift();
        }

        this.renderMessage(message);
        this.scrollToBottom();
    }

    renderMessage(message) {
        // Remove empty state if present
        const emptyState = this.messageList?.querySelector('.chat-empty');
        if (emptyState) {
            emptyState.remove();
        }

        const messageEl = document.createElement('div');
        messageEl.className = 'chat-message';

        const time = new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        if (message.type === 'system') {
            messageEl.classList.add('system');
            messageEl.innerHTML = `<span class="chat-content">${this.escapeHtml(message.content)}</span>`;
        } else {
            const nm = this.game.clientNetworkManager;
            const isOwn = nm && message.senderId === nm.playerId;
            messageEl.classList.add(isOwn ? 'own' : 'other');
            messageEl.innerHTML = `
                <span class="chat-time">${time}</span>
                <span class="chat-sender">${this.escapeHtml(message.sender)}:</span>
                <span class="chat-content">${this.escapeHtml(message.content)}</span>
            `;
        }

        this.messageList?.appendChild(messageEl);
    }

    sendCurrentMessage() {
        const content = this.inputField?.value?.trim();
        if (!content) return;

        this.sendChatMessage(content);
        this.inputField.value = '';
        this.inputField.focus();
    }

    sendChatMessage(content) {
        const nm = this.game.clientNetworkManager;
        if (!nm?.isConnected) {
            console.warn('[ChatSystem] Cannot send message - not connected');
            return;
        }

        nm.call('CHAT_MESSAGE', {
            content: content,
            context: this.currentContext
        });
    }

    toggleChatPanel() {
        this.isExpanded = !this.isExpanded;

        const body = document.getElementById('chatBody');
        const toggle = document.getElementById('chatToggle');

        if (body) {
            body.classList.toggle('collapsed', !this.isExpanded);
        }
        if (toggle) {
            toggle.textContent = this.isExpanded ? '-' : '+';
        }

        if (this.isExpanded) {
            this.unreadCount = 0;
            this.updateUnreadBadge();
            this.scrollToBottom();
            this.inputField?.focus();
        }
    }

    updateUnreadBadge() {
        const badge = document.getElementById('chatUnreadBadge');
        if (badge) {
            badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
            badge.style.display = this.unreadCount > 0 ? 'inline' : 'none';
        }
    }

    updateContextBadge() {
        const badge = document.getElementById('chatContextBadge');
        if (badge) {
            badge.textContent = this.currentContext === 'lobby' ? 'Lobby' : 'Game';
        }
    }

    scrollToBottom() {
        if (this.messageList) {
            this.messageList.scrollTop = this.messageList.scrollHeight;
        }
    }

    getChatContext() {
        return this.currentContext;
    }

    setChatContext(context) {
        if (context !== 'lobby' && context !== 'game') {
            console.warn('[ChatSystem] Invalid context:', context);
            return;
        }

        this.currentContext = context;
        this.messages = []; // Clear messages on context switch
        this.unreadCount = 0;

        if (this.messageList) {
            this.messageList.innerHTML = '<div class="chat-empty">No messages yet. Say hello!</div>';
        }

        this.updateContextBadge();
        this.updateUnreadBadge();
    }

    // Called when entering game room
    onGameJoined() {
        this.setChatContext('game');
    }

    // Called when leaving game room
    onGameLeft() {
        this.setChatContext('lobby');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Clean up when chat is destroyed
    dispose() {
        // Remove network listeners
        this.networkUnsubscribers.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this.networkUnsubscribers = [];

        // Remove DOM elements
        this.chatContainer?.remove();

        // Remove injected styles
        const styleSheet = document.getElementById('chat-system-styles');
        styleSheet?.remove();

        // Clear reference from game
        if (this.game.chatSystem === this) {
            delete this.game.chatSystem;
        }
    }
}

// Assign to global.GUTS
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.ChatSystem = ChatSystem;
}

// ES6 exports for webpack bundling
export default ChatSystem;
export { ChatSystem };
