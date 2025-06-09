'use strict';

const HTTPClient = require('dw/net/HTTPClient');
const Site = require('dw/system/Site');
const Logger = require('dw/system/Logger').getLogger('ProductService');

/**
 * ProductService - Centralized service for product engagement API interactions
 */
const TopsortService = {
    /**
     * Get configuration from site preferences
     * @returns {Object} Configuration object
     */
    getConfig: function() {
        const current = Site.getCurrent();
        return {
            apiKey: current.getCustomPreferenceValue('topsortApiKey'),
            apiURL: current.getCustomPreferenceValue('topsortApiURL') || 'https://api.topsort.com',
            enabled: current.getCustomPreferenceValue('topsortEnabled'),
            trackingEnabled: current.getCustomPreferenceValue('topsortTrackingEnabled')
        };
    },

    /**
     * Make HTTP request to Topsort API
     * @param {string} endpoint - API endpoint path
     * @param {Object} data - Request payload
     * @param {Object} options - Additional options (timeout, method)
     * @returns {Object} Response object with success flag and data/error
     */
    callAPI: function(endpoint, data, options) {
        const config = this.getConfig();
        const client = new HTTPClient();
        const defaults = {
            method: 'POST',
            timeout: 5000
        };
        const opts = Object.assign({}, defaults, options);

        try {
            const url = config.apiURL + endpoint;
            client.open(opts.method, url);
            client.setTimeout(opts.timeout);
            client.setRequestHeader('Content-Type', 'application/json');
            client.setRequestHeader('User-Agent', 'TopsortSFCC@1.0.0');

            if (config.apiKey) {
                client.setRequestHeader('Authorization', 'Bearer ' + config.apiKey);
            }

            client.send(JSON.stringify(data));

            if (client.statusCode === 200 || client.statusCode === 201) {
                return {
                    success: true,
                    data: JSON.parse(client.getText())
                };
            } else {
                Logger.error('Product API error: {0} - {1}', client.statusCode, client.text);
                return {
                    success: false,
                    error: 'API request failed with status: ' + client.statusCode
                };
            }
        } catch (e) {
            Logger.error('Product API exception: {0}', e.message);
            return {
                success: false,
                error: e.message
            };
        }
    },

    /**
     * Run auction request
     * @param {Object} auctionData - Auction request data
     * @returns {Object} Auction response
     */
    runAuction: function(auctionData) {
        if (!this.getConfig().enabled) {
            return { success: false, error: 'Product engagement is disabled' };
        }
        return this.callAPI('/v2/auctions', auctionData);
    },

    /**
     * Send event (impression, click, purchase)
     * @param {Object} eventData - Event data
     * @returns {Object} Event response
     */
    sendEvent: function(eventData) {
        if (!this.getConfig().trackingEnabled) {
            return { success: false, error: 'Product analytics is disabled' };
        }
        return this.callAPI('/v2/events', eventData);
    },

    /**
     * Send purchase event
     * @param {dw.order.Order} order - Order object
     * @param {string} opaqueUserId - User ID from cookie
     * @returns {Object} Event response
     */
    sendPurchaseEvent: function(order, opaqueUserId) {
        if (!this.getConfig().trackingEnabled) {
            return { success: false, error: 'Product analytics is disabled' };
        }

        const items = [];
        const pliIter = order.allProductLineItems.iterator();
        while (pliIter.hasNext()) {
            const pli = pliIter.next();
            items.push({
                productId: pli.productID,
                unitPrice: pli.adjustedPrice.value / pli.quantityValue,
                quantity: pli.quantityValue
            });
        }

        const eventData = {
            purchases: [{
                id: require('dw/util/UUIDUtils').createUUID(),
                occurredAt: new Date().toISOString(),
                opaqueUserId: opaqueUserId,
                items: items,
                orderId: order.orderNo,
                currency: order.currencyCode,
                total: order.totalGrossPrice.value
            }]
        };

        return this.sendEvent(eventData);
    },

    /**
     * Get client-side tracking configuration
     * @returns {Object} Configuration for client-side tracking
     */
    getClientConfig: function() {
        const config = this.getConfig();
        return {
            apiURL: config.apiURL,
            apiKey: config.apiKey,
            trackingEnabled: config.trackingEnabled
        };
    }
};

module.exports = TopsortService;