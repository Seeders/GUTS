/**
 * ChatManager - Reusable chat library for integrating chat into any UI
 *
 * Usage:
 *   const chat = new GUTS.ChatManager(game, {
 *       messagesContainerId: 'lobbyChatMessages',
 *       inputId: 'lobbyChatInput',
 *       sendButtonId: 'lobbyChatSendBtn',
 *       context: 'lobby'  // 'lobby' or 'game'
 *   });
 *   chat.init();
 *
 *   // When done:
 *   chat.dispose();
 */
class ChatManager {
    constructor(game, options = {}) {
        this.game = game;
        this.options = {
            messagesContainerId: options.messagesContainerId || 'chatMessages',
            inputId: options.inputId || 'chatInput',
            sendButtonId: options.sendButtonId || 'chatSendBtn',
            context: options.context || 'lobby', // 'lobby' or 'game'
            maxMessages: options.maxMessages || 100,
            showTimestamp: options.showTimestamp !== false,
            onMessageReceived: options.onMessageReceived || null,
            onMessageSent: options.onMessageSent || null
        };

        this.messages = [];
        this.networkListener = null;
        this.boundHandlers = {};
    }

    init() {
        this.setupInputListeners();
        this.setupNetworkListener();
    }

    setupInputListeners() {
        const input = document.getElementById(this.options.inputId);
        const sendBtn = document.getElementById(this.options.sendButtonId);

        this.boundHandlers.send = () => this.sendMessage();
        this.boundHandlers.keypress = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        };

        sendBtn?.addEventListener('click', this.boundHandlers.send);
        input?.addEventListener('keypress', this.boundHandlers.keypress);
    }

    setupNetworkListener() {
        const nm = this.game.clientNetworkManager;
        if (nm) {
            this.networkListener = nm.listen('CHAT_MESSAGE', (data) => {
                // Only handle messages for our context
                if (data.context === this.options.context) {
                    this.receiveMessage(data);
                }
            });
        }
    }

    sendMessage() {
        const input = document.getElementById(this.options.inputId);
        if (!input) return;

        const content = input.value.trim();
        if (!content) return;

        const nm = this.game.clientNetworkManager;
        if (nm?.socket) {
            nm.socket.emit('CHAT_MESSAGE', {
                content: content,
                context: this.options.context
            });

            if (this.options.onMessageSent) {
                this.options.onMessageSent(content);
            }
        }

        input.value = '';
    }

    receiveMessage(data) {
        this.messages.push(data);

        // Trim old messages
        if (this.messages.length > this.options.maxMessages) {
            this.messages.shift();
        }

        this.displayMessage(data);

        if (this.options.onMessageReceived) {
            this.options.onMessageReceived(data);
        }
    }

    displayMessage(data) {
        const container = document.getElementById(this.options.messagesContainerId);
        if (!container) return;

        // Remove empty placeholder if present
        const emptyMsg = container.querySelector('.chat-empty');
        if (emptyMsg) emptyMsg.remove();

        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${data.type === 'system' ? 'system' : ''}`;

        if (data.type === 'system') {
            messageEl.innerHTML = `<span class="chat-system-text">${this.escapeHtml(data.content)}</span>`;
        } else {
            let html = '';
            if (this.options.showTimestamp) {
                const time = new Date(data.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                html += `<span class="chat-time">${time}</span>`;
            }
            html += `<span class="chat-sender">${this.escapeHtml(data.sender)}:</span>`;
            html += `<span class="chat-text">${this.escapeHtml(data.content)}</span>`;
            messageEl.innerHTML = html;
        }

        container.appendChild(messageEl);
        container.scrollTop = container.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    clearMessages() {
        this.messages = [];
        const container = document.getElementById(this.options.messagesContainerId);
        if (container) {
            container.innerHTML = '<div class="chat-empty">No messages yet. Say hello!</div>';
        }
    }

    setContext(context) {
        this.options.context = context;
    }

    dispose() {
        // Remove input listeners
        const input = document.getElementById(this.options.inputId);
        const sendBtn = document.getElementById(this.options.sendButtonId);

        if (this.boundHandlers.send) {
            sendBtn?.removeEventListener('click', this.boundHandlers.send);
        }
        if (this.boundHandlers.keypress) {
            input?.removeEventListener('keypress', this.boundHandlers.keypress);
        }

        // Remove network listener
        if (this.networkListener) {
            this.networkListener();
            this.networkListener = null;
        }

        this.boundHandlers = {};
        this.messages = [];
    }
}

// Assign to global.GUTS for both browser and server
if (typeof global !== 'undefined' && global.GUTS) {
    global.GUTS.ChatManager = ChatManager;
}
if (typeof window !== 'undefined' && window.GUTS) {
    window.GUTS.ChatManager = ChatManager;
}

// ES6 exports for webpack bundling
export default ChatManager;
export { ChatManager };
