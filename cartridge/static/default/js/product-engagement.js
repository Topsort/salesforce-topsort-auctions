/**
 * Engagement module for tracking product interactions and views.
 *
 * @namespace ProductEngagement
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
        return /Mobi/.exec(navigator.userAgent) ? 'mobile' : 'desktop';
    }

    /**
     * Send analytics data to API
     * @param {Object} eventData - Event payload
     * @param {Object} options - Additional options
     */
    function sendEvent(eventData, options) {
        if (!config.trackingEnabled || !config.apiURL || !config.apiKey) {
            console.warn('Product engagement not properly configured');
            return Promise.resolve();
        }

        var opts = options || {};
        var url = config.apiURL + '/v2/events';

        return fetch(url, {
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
            return Promise.resolve();
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

        return sendEvent(eventData, { keepalive: true });
    }

    /**
     * Set up engagement tracking for a product item
     * @param {Object} params - Product engagement parameters
     */
    function setupItemTracking(params) {
        recordView(params);

        var element = document.getElementById('tile-' + params.productId);
        if (!element) {
            console.warn('ProductEngagement: tile-' + params.productId + ' not found');
            return;
        }

        element.addEventListener('click', function(e) {
            var node = e.target;
            var link = null;
            while (node && node !== element.parentNode) {
                if (node.tagName === 'A') {
                    link = node;
                    break;
                }
                node = node.parentNode;
            }

            var href = link && link.href;
            var opensNewTab = link && (link.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey);

            if (href && !opensNewTab) {
                e.preventDefault();
                var navigated = false;
                var go = function() {
                    if (navigated) {
                        return;
                    }
                    navigated = true;
                    window.location.href = href;
                };
                recordInteraction(params).then(go);
                setTimeout(go, 2000);
            } else {
                recordInteraction(params);
            }
        });
    }

    /**
     * Set up engagement for featured content
     * @param {Object} params - Content engagement parameters
     */
    function setupContentTracking(params) {
        recordView(params);

        var elementId = params.elementId || 'featured-content';
        var element = document.getElementById(elementId);

        if (element) {
            var link = element.querySelector('a');
            var clickTarget = link || element;

            clickTarget.addEventListener('click', function(e) {
                recordInteraction(params);
            });
        }
    }

    return {
        init: init,
        setupItemTracking: setupItemTracking,
        setupContentTracking: setupContentTracking
    };
})();
