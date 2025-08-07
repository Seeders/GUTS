// ================================
// FILE: js/ui/NotificationSystem.js - User Notifications
// ================================

class NotificationSystem {
    static notifications = [];
    static maxNotifications = 5;
    static defaultDuration = 3000;
    static container = null;
    
    static initialize() {
        this.createContainer();
        this.addNotificationCSS();
    }
    
    static createContainer() {
        if (this.container) return;
        
        this.container = document.createElement('div');
        this.container.id = 'notification-container';
        this.container.className = 'notification-container';
        document.body.appendChild(this.container);
    }
    
    static show(message, type = 'info', duration = null, options = {}) {
        this.createContainer();
        
        const notification = this.createNotification(message, type, duration || this.defaultDuration, options);
        this.addNotification(notification);
        
        return notification;
    }
    
    static createNotification(message, type, duration, options) {
        const notification = document.createElement('div');
        const id = 'notification-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        notification.id = id;
        notification.className = `notification notification-${type}`;
        notification.setAttribute('data-type', type);
        
        // Create notification content
        const content = document.createElement('div');
        content.className = 'notification-content';
        
        // Add icon based on type
        const icon = this.getTypeIcon(type);
        const iconElement = document.createElement('span');
        iconElement.className = 'notification-icon';
        iconElement.textContent = icon;
        
        // Add message
        const messageElement = document.createElement('span');
        messageElement.className = 'notification-message';
        messageElement.textContent = message;
        
        // Add close button if closable
        let closeButton = null;
        if (options.closable !== false) {
            closeButton = document.createElement('button');
            closeButton.className = 'notification-close';
            closeButton.innerHTML = '&times;';
            closeButton.type = 'button';
            closeButton.addEventListener('click', () => {
                this.remove(id);
            });
        }
        
        // Add progress bar for timed notifications
        let progressBar = null;
        if (duration > 0) {
            progressBar = document.createElement('div');
            progressBar.className = 'notification-progress';
            progressBar.innerHTML = '<div class="notification-progress-fill"></div>';
        }
        
        // Assemble notification
        content.appendChild(iconElement);
        content.appendChild(messageElement);
        if (closeButton) content.appendChild(closeButton);
        
        notification.appendChild(content);
        if (progressBar) notification.appendChild(progressBar);
        
        // Add click handler for the entire notification if specified
        if (options.onClick) {
            notification.style.cursor = 'pointer';
            notification.addEventListener('click', (e) => {
                if (e.target !== closeButton) {
                    options.onClick();
                    if (options.closeOnClick !== false) {
                        this.remove(id);
                    }
                }
            });
        }
        
        // Store notification data
        notification._notificationData = {
            id,
            type,
            duration,
            createdAt: Date.now(),
            progressBar,
            options
        };
        
        return notification;
    }
    
    static addNotification(notification) {
        // Remove excess notifications
        while (this.notifications.length >= this.maxNotifications) {
            const oldest = this.notifications.shift();
            if (oldest && oldest.parentElement) {
                oldest.parentElement.removeChild(oldest);
            }
        }
        
        // Add to container and tracking array
        this.container.appendChild(notification);
        this.notifications.push(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.add('notification-show');
        }, 10);
        
        // Setup auto-removal timer
        const data = notification._notificationData;
        if (data.duration > 0) {
            this.setupAutoRemoval(notification);
        }
        
        // Setup progress bar animation
        if (data.progressBar) {
            this.animateProgressBar(notification);
        }
    }
    
    static setupAutoRemoval(notification) {
        const data = notification._notificationData;
        
        setTimeout(() => {
            this.remove(data.id);
        }, data.duration);
    }
    
    static animateProgressBar(notification) {
        const data = notification._notificationData;
        const progressFill = notification.querySelector('.notification-progress-fill');
        
        if (progressFill) {
            progressFill.style.transition = `width ${data.duration}ms linear`;
            setTimeout(() => {
                progressFill.style.width = '0%';
            }, 10);
        }
    }
    
    static remove(id) {
        const notification = document.getElementById(id);
        if (!notification) return;
        
        // Animate out
        notification.classList.add('notification-hide');
        
        setTimeout(() => {
            if (notification.parentElement) {
                notification.parentElement.removeChild(notification);
            }
            
            // Remove from tracking array
            this.notifications = this.notifications.filter(n => n.id !== id);
        }, 300);
    }
    
    static clear(type = null) {
        const notificationsToRemove = type 
            ? this.notifications.filter(n => n._notificationData.type === type)
            : [...this.notifications];
        
        notificationsToRemove.forEach(notification => {
            this.remove(notification._notificationData.id);
        });
    }
    
    static getTypeIcon(type) {
        const icons = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            achievement: '🏆',
            gold: '💰',
            battle: '⚔️',
            victory: '🎉',
            defeat: '💀'
        };
        
        return icons[type] || icons.info;
    }
    
    // Convenience methods for common notification types
    static success(message, duration = null, options = {}) {
        return this.show(message, 'success', duration, options);
    }
    
    static error(message, duration = 5000, options = {}) {
        return this.show(message, 'error', duration, options);
    }
    
    static warning(message, duration = 4000, options = {}) {
        return this.show(message, 'warning', duration, options);
    }
    
    static info(message, duration = null, options = {}) {
        return this.show(message, 'info', duration, options);
    }
    
    static achievement(message, duration = 5000, options = {}) {
        return this.show(message, 'achievement', duration, options);
    }
    
    static gold(message, duration = 3000, options = {}) {
        return this.show(message, 'gold', duration, options);
    }
    
    static battle(message, duration = 2000, options = {}) {
        return this.show(message, 'battle', duration, options);
    }
    
    static victory(message, duration = 4000, options = {}) {
        return this.show(message, 'victory', duration, options);
    }
    
    static defeat(message, duration = 4000, options = {}) {
        return this.show(message, 'defeat', duration, options);
    }
    
    // Persistent notification (no auto-removal)
    static persistent(message, type = 'info', options = {}) {
        return this.show(message, type, 0, { closable: true, ...options });
    }
    
    static addNotificationCSS() {
        if (document.querySelector('#notification-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            .notification-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 1500;
                pointer-events: none;
                max-width: 400px;
            }
            
            .notification {
                background: #1a1a2e;
                border: 2px solid;
                border-radius: 8px;
                margin-bottom: 10px;
                min-height: 60px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                overflow: hidden;
                opacity: 0;
                transform: translateX(100%);
                transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
                pointer-events: auto;
                font-family: 'Courier New', monospace;
                position: relative;
            }
            
            .notification-show {
                opacity: 1;
                transform: translateX(0);
            }
            
            .notification-hide {
                opacity: 0;
                transform: translateX(100%);
                margin-bottom: 0;
                min-height: 0;
            }
            
            .notification-content {
                display: flex;
                align-items: center;
                padding: 1rem;
                position: relative;
                z-index: 1;
            }
            
            .notification-icon {
                font-size: 1.2rem;
                margin-right: 0.8rem;
                flex-shrink: 0;
            }
            
            .notification-message {
                flex: 1;
                color: #fff;
                font-size: 0.9rem;
                line-height: 1.4;
            }
            
            .notification-close {
                background: none;
                border: none;
                color: rgba(255, 255, 255, 0.6);
                font-size: 1.2rem;
                cursor: pointer;
                padding: 0;
                margin-left: 0.5rem;
                width: 24px;
                height: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: all 0.2s;
                flex-shrink: 0;
            }
            
            .notification-close:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
            }
            
            .notification-progress {
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 3px;
                background: rgba(255, 255, 255, 0.1);
            }
            
            .notification-progress-fill {
                width: 100%;
                height: 100%;
                background: currentColor;
                transition: none;
            }
            
            /* Type-specific styles */
            .notification-info {
                border-color: #0088ff;
                background: linear-gradient(135deg, #001133 0%, #002244 100%);
                color: #4dc3ff;
            }
            
            .notification-success {
                border-color: #00ff00;
                background: linear-gradient(135deg, #001100 0%, #003300 100%);
                color: #88ff88;
            }
            
            .notification-warning {
                border-color: #ffaa00;
                background: linear-gradient(135deg, #331100 0%, #442200 100%);
                color: #ffcc66;
            }
            
            .notification-error {
                border-color: #ff4444;
                background: linear-gradient(135deg, #330000 0%, #442222 100%);
                color: #ff8888;
            }
            
            .notification-achievement {
                border-color: #ffd700;
                background: linear-gradient(135deg, #332200 0%, #443300 100%);
                color: #ffee88;
                box-shadow: 0 4px 12px rgba(255, 215, 0, 0.2);
            }
            
            .notification-gold {
                border-color: #ffd700;
                background: linear-gradient(135deg, #2d2200 0%, #443300 100%);
                color: #ffe066;
            }
            
            .notification-battle {
                border-color: #ff6600;
                background: linear-gradient(135deg, #330000 0%, #441100 100%);
                color: #ff9966;
            }
            
            .notification-victory {
                border-color: #00ff88;
                background: linear-gradient(135deg, #001122 0%, #003344 100%);
                color: #66ffaa;
                animation: victoryGlow 2s ease-in-out infinite;
            }
            
            @keyframes victoryGlow {
                0%, 100% { box-shadow: 0 4px 12px rgba(0, 255, 136, 0.2); }
                50% { box-shadow: 0 6px 20px rgba(0, 255, 136, 0.4); }
            }
            
            .notification-defeat {
                border-color: #ff0000;
                background: linear-gradient(135deg, #220000 0%, #330000 100%);
                color: #ff6666;
            }
            
            /* Hover effects for clickable notifications */
            .notification[style*="cursor: pointer"]:hover {
                transform: scale(1.02);
                box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
            }
            
            /* Mobile responsiveness */
            @media (max-width: 768px) {
                .notification-container {
                    top: 10px;
                    right: 10px;
                    left: 10px;
                    max-width: none;
                }
                
                .notification {
                    margin-bottom: 8px;
                }
                
                .notification-content {
                    padding: 0.8rem;
                }
                
                .notification-message {
                    font-size: 0.85rem;
                }
            }
            
            /* Animation for notification entrance */
            @keyframes notificationSlide {
                from {
                    opacity: 0;
                    transform: translateX(100%);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
            
            /* Special effects for achievement notifications */
            .notification-achievement {
                position: relative;
                overflow: visible;
            }
            
            .notification-achievement::before {
                content: '✨';
                position: absolute;
                top: -5px;
                right: -5px;
                font-size: 1.5rem;
                animation: sparkle 1.5s ease-in-out infinite;
            }
            
            @keyframes sparkle {
                0%, 100% { opacity: 0.5; transform: scale(1) rotate(0deg); }
                50% { opacity: 1; transform: scale(1.2) rotate(180deg); }
            }
        `;
        document.head.appendChild(style);
    }
}


/*
// ================================
// USAGE EXAMPLES
// ================================

// Basic notifications
NotificationSystem.info('Game initialized successfully!');
NotificationSystem.success('Unit deployed!');
NotificationSystem.warning('Low gold remaining!');
NotificationSystem.error('Invalid placement location!');

// Game-specific notifications
NotificationSystem.gold('Earned 50 gold!', 3000);
NotificationSystem.battle('Round 3 begins!', 2000);
NotificationSystem.victory('Victory achieved!', 4000);
NotificationSystem.defeat('Defeat! Try again.', 4000);
NotificationSystem.achievement('First Victory unlocked!', 5000);

// Custom notifications with options
NotificationSystem.show('Click to view army stats', 'info', 5000, {
    onClick: () => {
        console.log('Opening army stats...');
    },
    closeOnClick: true
});

// Persistent notification (stays until manually closed)
NotificationSystem.persistent('Game paused - click to resume', 'warning', {
    onClick: () => {
        // Resume game logic
        NotificationSystem.clear('warning');
    }
});

// Custom duration and styling
NotificationSystem.show('Custom message', 'success', 10000, {
    closable: false  // No close button
});

// Clear notifications
NotificationSystem.clear();           // Clear all
NotificationSystem.clear('error');    // Clear only error notifications
*/