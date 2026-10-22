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
        iconElement.innerHTML = icon;
        
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
        // Glyph names from the foundation icon set (.ico-* in loading.css).
        const icons = {
            info: 'flag',
            success: 'check',
            warning: 'bolt',
            error: 'close',
            achievement: 'star',
            gold: 'coin',
            battle: 'swords',
            victory: 'crown',
            defeat: 'skull'
        };

        return `<i class="ico ico-${icons[type] || icons.info}" aria-hidden="true"></i>`;
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
        // Styled by the foundation sheet (ui/interfaces/css/loading.css, TOASTS).
    }
}
