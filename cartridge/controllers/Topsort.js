"use strict";

var server = require("server");
var CSRFProtection = require("dw/web/CSRFProtection");
var Logger = require("dw/system/Logger").getLogger("TopsortService");
var topsortBanners = require("*/cartridge/scripts/helpers/topsortBanners");
var topsortEventAuth = require("*/cartridge/scripts/helpers/topsortEventAuth");
var topsortHelpers = require("*/cartridge/scripts/helpers/topsortHelpers");
var topsortSession = require("*/cartridge/scripts/helpers/topsortSession");
var TopsortService = require("*/cartridge/scripts/services/TopsortService");

// A grid renders at most six sponsored tiles, so this leaves headroom for a batch of
// impressions plus clicks while keeping a forged request from relaying a large payload.
var MAX_EVENTS_PER_REQUEST = 24;
// Only interaction events are accepted from the browser. Purchases stay server-side in
// Order.js so they cannot be forged to inflate attributed revenue.
var ACCEPTED_EVENT_TYPES = ["impressions", "clicks"];
var MAX_STRING_LENGTH = 1024;
var MAX_CATEGORY_IDS = 10;
var MAX_REQUEST_LENGTH = 64 * 1024;

/**
 * Returns the value when it is a non-empty string, truncated to a sane length.
 *
 * @param {*} value - Untrusted value from the request body
 * @param {number} maxLength - Maximum number of characters to keep
 * @returns {string|null} The trimmed string, or null when the value is not usable
 */
function toBoundedString(value, maxLength) {
    if (typeof value !== "string" || !value.length) {
        return null;
    }
    return value.length > maxLength ? value.substring(0, maxLength) : value;
}

/**
 * Returns the value when it is a positive integer.
 *
 * @param {*} value - Untrusted value from the request body
 * @returns {number|null} The integer, or null when the value is not a positive integer
 */
function toPositiveInt(value) {
    if (typeof value !== "number" || !isFinite(value)) {
        return null;
    }
    var rounded = Math.floor(value);
    return rounded > 0 ? rounded : null;
}

/**
 * Rebuilds the placement object from the browser payload, keeping only the fields the
 * Topsort events API defines and dropping anything else.
 *
 * @param {Object} raw - Untrusted placement object from the request body
 * @returns {Object} A placement object safe to forward
 */
function sanitizePlacement(raw) {
    var source = raw || {};
    var placement = { path: toBoundedString(source.path, MAX_STRING_LENGTH) || "/" };

    var position = toPositiveInt(source.position);
    if (position) {
        placement.position = position;
    }

    var page = toPositiveInt(source.page);
    if (page) {
        placement.page = page;
    }

    var pageSize = toPositiveInt(source.pageSize);
    if (pageSize) {
        placement.pageSize = pageSize;
    }

    var searchQuery = toBoundedString(source.searchQuery, MAX_STRING_LENGTH);
    if (searchQuery) {
        placement.searchQuery = searchQuery;
    }

    if (Array.isArray(source.categoryIds)) {
        var categoryIds = [];
        for (var i = 0; i < source.categoryIds.length && categoryIds.length < MAX_CATEGORY_IDS; i++) {
            var categoryId = toBoundedString(source.categoryIds[i], MAX_STRING_LENGTH);
            if (categoryId) {
                categoryIds.push(categoryId);
            }
        }
        if (categoryIds.length) {
            placement.categoryIds = categoryIds;
        }
    }

    return placement;
}

/**
 * Rebuilds a single interaction event from the browser payload.
 *
 * The event id, timestamp and opaque user id are all set server-side: the id is the
 * idempotency key Topsort dedupes on, and the opaque user id comes from the shopper's
 * own cookie so one shopper cannot report events as another.
 *
 * @param {Object} raw - Untrusted event object from the request body
 * @param {string} eventType - Event collection being rebuilt
 * @param {string|null} opaqueUserId - Existing opaque user id, when present
 * @param {string} deviceType - Device type resolved from the user agent
 * @returns {Object|null} An event safe to forward, or null when it must be dropped
 */
function sanitizeEvent(raw, eventType, opaqueUserId, deviceType) {
    var resolvedBidId = raw ? toBoundedString(raw.resolvedBidId, MAX_STRING_LENGTH) : null;
    var eventToken = raw ? toBoundedString(raw.eventToken, MAX_STRING_LENGTH) : null;
    var eventOpaqueUserId = opaqueUserId;

    // Only sponsored interactions are reported from the storefront; without a
    // resolvedBidId Topsort has nothing to attribute the event to.
    if (!resolvedBidId) {
        return null;
    }

    if (!topsortEventAuth.validateEventToken(eventToken, resolvedBidId, eventOpaqueUserId)) {
        // A first-page remote include cannot see a cookie issued by its parent response.
        // Those banner auctions are intentionally anonymous, so accept only a token that
        // proves that exact anonymous context and keep the resulting event anonymous too.
        eventOpaqueUserId = null;
        if (!topsortEventAuth.validateEventToken(eventToken, resolvedBidId, eventOpaqueUserId)) {
            return null;
        }
    }

    var event = {
        id:            topsortEventAuth.createEventId(eventType, resolvedBidId, eventOpaqueUserId),
        occurredAt:    new Date().toISOString(),
        resolvedBidId: resolvedBidId,
        placement:     sanitizePlacement(raw.placement),
        deviceType:    deviceType,
        channel:       "onsite"
    };

    if (eventOpaqueUserId) {
        event.opaqueUserId = eventOpaqueUserId;
    }
    return event;
}

function isSameOriginRequest() {
    var origin = request.httpHeaders.get("origin");
    var host = request.httpHost || request.httpHeaders.get("host");
    var expectedOrigin = host ? "https://" + host : null;
    return Boolean(origin && expectedOrigin && origin.toLowerCase() === expectedOrigin.toLowerCase());
}

function isJsonRequest() {
    var contentType = request.httpHeaders.get("content-type") || "";
    return /^application\/json(?:\s*;|$)/i.test(contentType);
}

/**
 * Relays the interaction events in the request body to Topsort.
 *
 * @param {Object} res - The response object used to send the HTTP response.
 */
function relayEvents(res) {
    if (!TopsortService.getConfig().trackingEnabled) {
        res.json({ success: false });
        return;
    }

    var requestBody = request.httpParameterMap.requestBodyAsString || "";
    if (requestBody.length > MAX_REQUEST_LENGTH) {
        res.setStatusCode(413);
        res.json({ success: false });
        return;
    }

    var payload;
    try {
        payload = JSON.parse(requestBody);
    } catch (e) {
        Logger.warn("Topsort-Event received a request body that is not valid JSON");
        res.setStatusCode(400);
        res.json({ success: false });
        return;
    }

    if (!payload || typeof payload !== "object") {
        res.setStatusCode(400);
        res.json({ success: false });
        return;
    }

    var opaqueUserId = topsortSession.getOpaqueUserId();
    var deviceType = topsortHelpers.getDeviceType();
    var eventData = {};
    var eventCount = 0;

    ACCEPTED_EVENT_TYPES.forEach(function (eventType) {
        var rawEvents = payload[eventType];
        if (!Array.isArray(rawEvents)) {
            return;
        }

        var sanitized = [];
        for (var i = 0; i < rawEvents.length && eventCount < MAX_EVENTS_PER_REQUEST; i++) {
            var event = sanitizeEvent(rawEvents[i], eventType, opaqueUserId, deviceType);
            if (event) {
                sanitized.push(event);
                eventCount++;
            }
        }

        if (sanitized.length) {
            eventData[eventType] = sanitized;
        }
    });

    if (!eventCount) {
        res.json({ success: false });
        return;
    }

    // Keep this first valid anonymous batch anonymous so it matches the auctions that
    // produced its bid proofs, then issue one identity for all future requests.
    if (!opaqueUserId) {
        topsortSession.resolveOpaqueUser();
    }

    var result = TopsortService.sendEvent(eventData);
    if (!result.success) {
        Logger.error("Topsort event reporting failed: {0}", result.error);
    }

    res.json({ success: result.success });
}

/**
 * Topsort-Event : Server-side relay for sponsored impression and click events.
 *
 * The browser posts events here instead of calling api.topsort.com directly, so the
 * marketplace API key never reaches the page. Every field that affects attribution is
 * rebuilt server-side; the browser supplies the resolvedBidId, its signed proof, and placement.
 *
 * The body is attacker-controlled, so an unhandled failure here is reachable from outside.
 * It answers with the same shape it would for a rejected batch rather than surfacing the
 * error page, which would otherwise report the internals of this endpoint to whoever asked.
 *
 * @name Base/Topsort-Event
 * @function
 * @memberof Topsort
 * @param {httpparameter} - body - JSON with impressions and/or clicks arrays
 * @param {category} - non-sensitive
 * @param {returns} - json
 * @param {serverfunction} - post
 */
server.post("Event", server.middleware.https, function (req, res, next) {
    res.cachePeriod = 0; // eslint-disable-line no-param-reassign

    if (!isSameOriginRequest() || !isJsonRequest() || !CSRFProtection.validateRequest()) {
        res.setStatusCode(403);
        res.json({ success: false });
        return next();
    }

    try {
        relayEvents(res);
    } catch (e) {
        Logger.error("Topsort-Event could not relay the batch: {0}", e.message);
        res.json({ success: false });
    }

    return next();
});

/**
 * Topsort-Banner : Renders one sponsored banner slot, as a remote include.
 *
 * Banners are fetched here rather than auctioned inside the page so that no page has to give
 * up its page cache to carry them. A response holding a resolvedBidId cannot be cached - a
 * cached copy would report every later shopper's impression against one shopper's bid - and
 * the home page and the PLPs are the most cached pages on the storefront. A remote include
 * keeps that split honest: the surrounding page stays in cache and only this fragment is
 * dynamic, so enabling banners changes no page's caching behaviour.
 *
 * The price of that is one auction per rendered slot instead of one per page. The storefront
 * already remote-includes every product tile, so the extra sub-requests are not new in kind,
 * but they do sit on the critical path - see the page cache notes in the README.
 *
 * server.middleware.include makes this unreachable by navigating to it, so the only thing a
 * shopper can steer is the query string of an include the template already emitted. slotId is
 * matched against the configured slots and the auction trigger comes from that configuration,
 * never from the request.
 *
 * @name Base/Topsort-Banner
 * @function
 * @memberof Topsort
 * @param {middleware} - server.middleware.include
 * @param {querystringparameter} - slotId - Configured banner slot to render
 * @param {querystringparameter} - cgid - Category being browsed, for category slots
 * @param {querystringparameter} - q - Search term, for search slots
 * @param {category} - non-sensitive
 * @param {renders} - isml
 * @param {serverfunction} - get
 */
server.get("Banner", server.middleware.include, function (req, res, next) {
    // Never cache the fragment itself: it carries a resolvedBidId that belongs to this one
    // auction. This is also what keeps the including page's own cache entry meaningful.
    res.cachePeriod = 0; // eslint-disable-line no-param-reassign

    var banner = null;

    try {
        banner = topsortBanners.resolveBanner(req.querystring.slotId, {
            categoryId: toBoundedString(req.querystring.cgid, MAX_STRING_LENGTH),
            searchQuery: toBoundedString(req.querystring.q, MAX_STRING_LENGTH)
        });
    } catch (e) {
        // An ad that fails to resolve is never a reason to break the page around it.
        Logger.error("Topsort-Banner could not resolve slot {0}: {1}", req.querystring.slotId, e.message);
    }

    res.render("topsort/banner", {
        banner: banner,
        preserveWrapper: req.querystring.preserveWrapper === "true"
    });

    return next();
});

module.exports = server.exports();
