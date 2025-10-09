"use strict";

var Site = require("dw/system/Site");
var Logger = require("dw/system/Logger").getLogger("TopsortService");
var LocalServiceRegistry = require("dw/svc/LocalServiceRegistry");
var topsortMockTypes = require("*/cartridge/scripts/config/topsortMockTypes.json");

/**
 * Define the Topsort API service
 */
var topsortService = LocalServiceRegistry.createService("lapolar.topsort", {
    createRequest: function (svc, params) {
        var config = TopsortService.getConfig();
        svc.setRequestMethod(params.method);
        svc.setURL(config.apiURL + params.endpoint);
        svc.addHeader("Content-Type", "application/json");
        svc.addHeader("User-Agent", "TopsortSFCC@1.0.0");

        if (config.apiKey) {
            svc.addHeader("Authorization", "Bearer " + config.apiKey);
        }

        return JSON.stringify(params.data);
    },
    parseResponse: function (svc, client) {
        return JSON.parse(client.text);
    },
    filterLogMessage: function (msg) {
        return msg;
    },
    getRequestLogMessage: function (request) {
        return request;
    },
    getResponseLogMessage: function (response) {
        try {
            var jsonResponse = JSON.parse(response.text);
            return JSON.stringify(jsonResponse, null, 4);
        } catch (e) {
            return response.text;
        }
    },
    mockFull : function (svc, params) {
        var serviceCredentials   = svc.getConfiguration().getCredential();
        var serviceConfiguration = JSON.parse(serviceCredentials.custom.lpJSONConfig);

        return serviceConfiguration && serviceConfiguration[params.mockType]
            ? serviceConfiguration[params.mockType]
            : null;
    }
});
/**
 * ProductService - Centralized service for product engagement API interactions
 */
var TopsortService = {
    /**
     * Get configuration from site preferences
     * @returns {Object} Configuration object
     */
    getConfig: function () {
        var current = Site.getCurrent();
        return {
            apiKey: current.getCustomPreferenceValue("topsortApiKey"),
            apiURL: current.getCustomPreferenceValue("topsortApiURL") || "https://api.topsort.com",
            enabled: current.getCustomPreferenceValue("topsortEnabled"),
            trackingEnabled: current.getCustomPreferenceValue("topsortTrackingEnabled")
        };
    },

    /**
     * Make HTTP request to Topsort API using LocalServiceRegistry
     * @param {string} endpoint - API endpoint path
     * @param {Object} data - Request payload
     * @param {string} mockType - Mock response type
     * @returns {Object} Response object with success flag and data/error
     */
    callAPI: function (endpoint, data, mockType) {
        try {
            var response = topsortService.call({
                endpoint: endpoint,
                data: data,
                method: "POST",
                mockType: mockType
            });

            if (response.status === "OK") {
                return {
                    success: true,
                    data: response.object
                };
            } else {
                Logger.error("Error in TopsortService.js - callAPI() with details: {0}", response.errorMessage);
                return {
                    success: false,
                    error: "API request failed with status: " + response.errorMessage
                };
            }
        } catch (e) {
            Logger.error("Exception caught in TopsortService.js - callAPI() with details: {0}", e.message);
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
    runAuction: function (auctionData) {
        if (!this.getConfig().enabled) {
            return { success: false, error: "Product engagement is disabled" };
        }
        return this.callAPI("/v2/auctions", auctionData, topsortMockTypes.runAuction);
    },

    /**
     * Send event (impression, click, purchase)
     * @param {Object} eventData - Event data
     * @returns {Object} Event response
     */
    sendEvent: function (eventData) {
        if (!this.getConfig().trackingEnabled) {
            return { success: false, error: "Product analytics is disabled" };
        }
        return this.callAPI("/v2/events", eventData, topsortMockTypes.sendEvent);
    },

    /**
     * Send purchase event
     * @param {dw.order.Order} order - Order object
     * @param {string} opaqueUserId - User ID from cookie
     * @returns {Object} Event response
     */
    sendPurchaseEvent: function (order, opaqueUserId) {
        if (!this.getConfig().trackingEnabled) {
            return { success: false, error: "Product analytics is disabled" };
        }

        var items = [];
        var pliIter = order.allProductLineItems.iterator();
        while (pliIter.hasNext()) {
            var pli = pliIter.next();
            var unitPrice = pli.adjustedPrice.value / pli.quantityValue;

            if (unitPrice) {
                items.push({
                    productId: pli.productID,
                    unitPrice: unitPrice,
                    quantity: pli.quantityValue
                });
            }
        }

        var eventData = {
            purchases: [{
                id: require("dw/util/UUIDUtils").createUUID(),
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
    getClientConfig: function () {
        var config = this.getConfig();
        return {
            apiURL: config.apiURL,
            apiKey: config.apiKey,
            trackingEnabled: config.trackingEnabled
        };
    }
};

module.exports = TopsortService;
