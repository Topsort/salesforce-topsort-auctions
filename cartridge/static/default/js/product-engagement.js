/**
 * Product Engagement Module
 * Centralized module for handling user interactions and analytics
 */
window.ProductEngagement = (function() {
    'use strict';

    var config = {};
    var initialized = false;

    /**
     * Initialize the engagement module
     * @param {Object} engagementConfig - Configuration object
     */
    function init(engagementConfig) {
        config = engagementConfig || {};
        initialized = true;
    }

    /**
     * Generate a unique ID for events
     * @returns {string} UUID
     */
    function generateEventId() {
        return crypto.randomUUID();
    }

    /**
     * Get current timestamp in ISO format
     * @returns {string} ISO timestamp
     */
    function getCurrentTimestamp() {
        return new Date().toISOString();
    }

    /**
     * Detect device type
     * @returns {string} 'mobile' or 'desktop'
     */
    function getDeviceType() {
        return navigator.userAgent.match(/Mobi/) ? 'mobile' : 'desktop';
    }

    /**
     * Send analytics data to API
     * @param {Object} eventData - Event payload
     * @param {Object} options - Additional options
     */
    function sendEvent(eventData, options) {
        if (!config.trackingEnabled || !config.apiURL || !config.apiKey) {
            console.warn('Product engagement not properly configured');
            return;
        }

        var opts = options || {};
        var url = config.apiURL + '/v2/events';

        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + config.apiKey
            },
            body: JSON.stringify(eventData),
            keepalive: opts.keepalive || false
        }).catch(function(error) {
            console.error('Product engagement failed:', error);
        });
    }

    /**
     * Record view event
     * @param {Object} params - View parameters
     */
    function recordView(params) {
        if (!initialized) {
            console.warn('ProductEngagement not initialized');
            return;
        }

        var eventData = {
            impressions: [{
                id: generateEventId(),
                occurredAt: getCurrentTimestamp(),
                opaqueUserId: params.userId || '',
                placement: {
                    path: window.location.pathname,
                    position: params.position || 1,
                    page: params.page || 1,
                    pageSize: params.pageSize || 12,
                    categoryId: params.categoryId || ''
                },
                resolvedBidId: params.resolvedBidId || '',
                deviceType: getDeviceType(),
                channel: params.channel || 'onsite'
            }]
        };

        sendEvent(eventData);
    }

    /**
     * Record interaction event
     * @param {Object} params - Interaction parameters
     */
    function recordInteraction(params) {
        if (!initialized) {
            console.warn('ProductEngagement not initialized');
            return;
        }

        var eventData = {
            clicks: [{
                id: generateEventId(),
                occurredAt: getCurrentTimestamp(),
                opaqueUserId: params.userId || '',
                placement: {
                    path: window.location.pathname,
                    position: params.position || 1,
                    page: params.page || 1,
                    pageSize: params.pageSize || 12,
                    categoryId: params.categoryId || ''
                },
                resolvedBidId: params.resolvedBidId || '',
                deviceType: getDeviceType(),
                channel: params.channel || 'onsite'
            }]
        };

        sendEvent(eventData, { keepalive: true });
    }

    /**
     * Set up engagement tracking for a product item
     * @param {Object} params - Product engagement parameters
     */
    function setupItemTracking(params) {
        recordView(params);

        var element = document.getElementById('tile-' + params.productId);
        if (element) {
            element.addEventListener('click', function() {
                var interactionParams = Object.assign({}, params, {
                    channel: 'offsite'
                });
                recordInteraction(interactionParams);
            });
        }
    }

    /**
     * Set up engagement for featured content
     * @param {Object} params - Content engagement parameters
     */
    function setupContentTracking(params) {
        recordView(params);

        var element = document.getElementById('featured-content');
        if (element) {
            element.addEventListener('click', function() {
                recordInteraction(params);
            });
        }
    }

    return {
        init: init,
        recordView: recordView,
        recordInteraction: recordInteraction,
        setupItemTracking: setupItemTracking,
        setupContentTracking: setupContentTracking
    };
})();