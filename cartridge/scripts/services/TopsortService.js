"use strict";

var Site = require("dw/system/Site");
var Logger = require("dw/system/Logger").getLogger("TopsortService");
var LocalServiceRegistry = require("dw/svc/LocalServiceRegistry");
var topsortMockTypes = require("*/cartridge/scripts/config/topsortMockTypes.json");

/**
 * Define the Topsort API service
 */
var topsortService;
try {
    topsortService = LocalServiceRegistry.createService("topsort", {
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
            // Comm logging is off in services.xml, but it can be switched back on in
            // Business Manager, so redact the marketplace key here rather than relying on
            // that flag to keep it out of the logs.
            return msg ? msg.replace(/(Bearer\s+)[\w.-]+/gi, "$1***") : msg;
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
} catch (e) {
    Logger.error("Failed to initialize Topsort service: {0}. Please configure the 'topsort' service in Business Manager under Administration > Operations > Services", e.message);
    topsortService = null;
}
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
            bannersEnabled: current.getCustomPreferenceValue("topsortBannersEnabled"),
            bannerAssetHosts: current.getCustomPreferenceValue("topsortBannerAssetHosts"),
            trackingEnabled: current.getCustomPreferenceValue("topsortTrackingEnabled"),
            auctionTrafficPercent: current.getCustomPreferenceValue("topsortAuctionTrafficPercent")
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
        // Check if service is initialized
        if (!topsortService) {
            Logger.warn("Topsort service is not configured. Please configure the 'topsort' service in Business Manager.");
            return {
                success: false,
                error: "Topsort service is not configured in Business Manager"
            };
        }

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
     * @param {string} [eventId] - Idempotency key Topsort dedupes on. Pass a value derived
     *                             from the order so a retry is not counted as a second
     *                             purchase; omit it only for genuinely one-off sends.
     * @returns {Object} Event response
     */
    sendPurchaseEvent: function (order, opaqueUserId, eventId) {
        if (!this.getConfig().trackingEnabled) {
            return { success: false, error: "Product analytics is disabled" };
        }

        var items = [];
        var pliIter = order.allProductLineItems.iterator();
        while (pliIter.hasNext()) {
            var pli = pliIter.next();

            // Money.getValue() throws when the amount is not available, which
            // allProductLineItems can produce for bonus and option line items. This runs on
            // Order-Confirm, so an unavailable price has to skip its item rather than escape
            // as an exception. A zero unit price is skipped for a different reason: the
            // events API declares unitPrice with exclusiveMinimum 0, so a fully discounted
            // item would take the whole batch down with it.
            if (pli.adjustedPrice && pli.adjustedPrice.available && pli.quantityValue > 0) {
                var unitPrice = pli.adjustedPrice.value / pli.quantityValue;

                if (unitPrice > 0) {
                    items.push({
                        productId: pli.productID,
                        unitPrice: unitPrice,
                        quantity: pli.quantityValue
                    });
                }
            }
        }

        // items is declared minItems 1, so an order whose every line came out free or
        // unpriced has nothing that can be reported rather than a smaller event to send.
        if (!items.length) {
            Logger.warn("Skipping the Topsort purchase event for order {0}: no line item has a reportable unit price", order.orderNo);
            return { success: false, error: "No line item has a reportable unit price" };
        }

        // Only the fields the purchase schema declares. It is additionalProperties: false,
        // so an extra orderId, currency or total rejects the batch and the order goes
        // unattributed - which is the one event the whole integration is measured on.
        var eventData = {
            purchases: [{
                id: eventId || require("dw/util/UUIDUtils").createUUID(),
                occurredAt: new Date().toISOString(),
                opaqueUserId: opaqueUserId,
                items: items
            }]
        };

        return this.sendEvent(eventData);
    },

    /**
     * Get the tracking configuration that is safe to render into a storefront page.
     *
     * The API key is intentionally absent. It authenticates auctions and events for the
     * whole marketplace, so it stays server-side; the browser posts events to the
     * Topsort-Event controller, which attaches the key.
     *
     * @returns {Object} Configuration for client-side tracking
     */
    getClientConfig: function () {
        return {
            trackingEnabled: this.getConfig().trackingEnabled
        };
    }
};

module.exports = TopsortService;
