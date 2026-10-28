"use strict";

var Logger = require("dw/system/Logger").getLogger("SponsoredSearch");
var URLUtils = require("dw/web/URLUtils");
var topsortEventAuth = require("*/cartridge/scripts/helpers/topsortEventAuth");
var topsortHelpers = require("*/cartridge/scripts/helpers/topsortHelpers");
var topsortSession = require("*/cartridge/scripts/helpers/topsortSession");
var TopsortService = require("*/cartridge/scripts/services/TopsortService");
var slotConfig = require("*/cartridge/scripts/config/topsort_banners.json");

/**
 * Returns the configured slot with this id.
 *
 * This is the allowlist for the whole feature. Every banner is fetched through a remote
 * include whose query string a shopper can edit, and slotId lands in the auction request, so
 * an unknown id has to be rejected here rather than forwarded to Topsort.
 *
 * @param {string} slotId - Slot id from the request
 * @returns {Object|null} The slot configuration, or null when the id is not configured
 */
function getSlot(slotId) {
    if (!slotId) {
        return null;
    }

    for (var i = 0; i < slotConfig.length; i += 1) {
        if (slotConfig[i].slotId === slotId) {
            return slotConfig[i];
        }
    }

    return null;
}

/**
 * Reports whether the slot is rendered on this device.
 *
 * The side slots only exist in the desktop layout, so on mobile they are skipped before the
 * auction rather than only hidden with CSS. Bidding on a slot that is never painted would
 * charge advertisers for an impression the shopper cannot see.
 *
 * @param {Object} slot - Slot configuration
 * @param {string} deviceType - "mobile" or "desktop"
 * @returns {boolean} True when the slot may run on this device
 */
function isSlotOnDevice(slot, deviceType) {
    return (slot.devices || []).indexOf(deviceType) !== -1;
}

/**
 * Builds the auction request for one banner slot.
 *
 * The trigger comes from the slot's configured page type, never from the query string: a
 * category slot always sends a category and a search slot always sends a search query, so a
 * crafted request cannot turn a home slot into a keyword-targeted one.
 *
 * Home slots deliberately send neither. The banners API treats an auction with no category
 * and no search query as a landing page auction, which is what the three home slots are.
 *
 * @param {Object} slot - Slot configuration
 * @param {Object} ctx - Page context
 * @param {string} [ctx.categoryId] - Raw SFCC category id, for category slots
 * @param {string} [ctx.searchQuery] - Shopper search term, for search slots
 * @param {string} deviceType - "mobile" or "desktop"
 * @param {string} opaqueUserId - Topsort opaque user id
 * @returns {Object} The auction request object
 */
function buildAuction(slot, ctx, deviceType, opaqueUserId) {
    var auction = {
        type: "banners",
        slots: slot.slots || 1,
        slotId: slot.slotId,
        device: deviceType
    };

    if (opaqueUserId) {
        auction.opaqueUserId = opaqueUserId;
    }

    if (slot.page === "search" && ctx.searchQuery) {
        auction.searchQuery = ctx.searchQuery;
    }

    if (slot.page === "category") {
        var sluggedCategoryId = topsortHelpers.resolveTopsortCategoryId(ctx.categoryId);
        if (sluggedCategoryId) {
            auction.category = { id: sluggedCategoryId };
        }
    }

    return auction;
}

/**
 * Resolves the destination a banner click should navigate to.
 *
 * The winner id is whatever the advertiser configured, so it reaches the page as an href and
 * has to be treated as untrusted. Only http and https are allowed through: a "javascript:"
 * or "data:" destination would otherwise be a stored cross-site scripting hole that any
 * vendor with campaign access could open.
 *
 * @param {Object} winner - A winner from the auction response
 * @returns {string|null} A safe destination, or null when the banner should not be a link
 */
function resolveDestination(winner) {
    if (!winner || !winner.id) {
        return null;
    }

    if (winner.type === "product") {
        return URLUtils.url("Product-Show", "pid", winner.id).toString();
    }

    if (/^https?:\/\//i.test(winner.id)) {
        return winner.id;
    }

    // Campaign destinations are sometimes returned as a bare domain. Promote only a
    // domain-shaped value to HTTPS, while continuing to reject executable schemes,
    // protocol-relative URLs, whitespace and other untrusted href values.
    return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s]*)?$/i.test(winner.id)
        ? "https://" + winner.id
        : null;
}

/**
 * Maps the assets of a winning bid onto the shape the template renders.
 *
 * Topsort can return the same creative at several sizes so the browser can pick one, which is
 * what the picture element in the template is for. They are sorted narrowest first because
 * that is the order the source elements have to be declared in for the media queries to work.
 *
 * Dimensions are optional in Topsort responses. Valid dimensions are preserved for srcset
 * hints, while an asset without them still renders responsively from its URL.
 *
 * @param {Object} winner - A winner from the auction response
 * @param {string} allowedHosts - Comma-separated exact host allowlist
 * @returns {Array} Assets as { url, width, height, mimeType }, narrowest first
 */
function mapAssets(winner, allowedHosts) {
    var assets = [];
    var rawAssets = winner.asset || [];

    for (var i = 0; i < rawAssets.length; i += 1) {
        var asset = rawAssets[i];
        if (asset && isAllowedAssetUrl(asset.url, allowedHosts)) {
            var dimensions = asset.dimensions || {};
            var width = toPositiveDimension(dimensions.width);
            var height = toPositiveDimension(dimensions.height);
            assets.push({
                url: asset.url,
                width: width,
                height: height,
                mimeType: asset.mimeType || null
            });
        }
    }

    assets.sort(function (a, b) {
        return (a.width || 0) - (b.width || 0);
    });

    return assets;
}

function toPositiveDimension(value) {
    return typeof value === "number" && isFinite(value) && value > 0 && Math.floor(value) === value
        ? value
        : null;
}

/**
 * Validates a creative URL before it reaches src or srcset.
 *
 * @param {*} url - URL supplied by the auction response
 * @param {string} allowedHosts - Comma-separated exact host allowlist
 * @returns {boolean} True for an HTTPS URL on an allowed host
 */
function isAllowedAssetUrl(url, allowedHosts) {
    if (typeof url !== "string" || /[\s,]/.test(url)) {
        return false;
    }

    var match = /^https:\/\/([^\/?#:]+)(?::(\d+))?(?:[\/?#]|$)/i.exec(url);
    if (!match || (match[2] && match[2] !== "443")) {
        return false;
    }

    var host = match[1].toLowerCase();
    var hosts = String(allowedHosts || "").split(",");
    for (var i = 0; i < hosts.length; i += 1) {
        if (hosts[i].replace(/^\s+|\s+$/g, "").toLowerCase() === host) {
            return true;
        }
    }
    return false;
}

/**
 * Extracts the winning banner from an auction response.
 *
 * Only one banner is ever requested per slot, so only the first winner is read. A response
 * with no banners result, no winners, or a winner carrying no usable asset is treated the
 * same as no bid at all: the slot renders nothing.
 *
 * @param {Object} data - Parsed body of the /v2/auctions response
 * @returns {Object|null} The winner as { resolvedBidId, destination, assets }, or null
 */
function extractWinner(data, allowedAssetHosts) {
    if (!data || !data.results) {
        return null;
    }

    var bannersResult = data.results.filter(function (result) {
        return result.resultType === "banners";
    })[0];

    if (!bannersResult || !bannersResult.winners || !bannersResult.winners.length) {
        return null;
    }

    var winner = bannersResult.winners[0];
    var assets = mapAssets(winner, allowedAssetHosts);

    // Without a creative there is nothing to paint, and without a resolvedBidId Topsort has
    // nothing to attribute the impression to, so neither is worth rendering an empty box for.
    if (!assets.length || !winner.resolvedBidId) {
        return null;
    }

    return {
        resolvedBidId: winner.resolvedBidId,
        destination: resolveDestination(winner),
        assets: assets
    };
}

/**
 * Runs the auction for one banner slot and returns the winner to render.
 *
 * Fail-open, like the listings path: when the integration is off, the slot is unknown, the
 * slot does not run on this device, or the API errors out, this returns null and the caller
 * renders nothing. A banner that does not load must never be the reason a page looks broken.
 *
 * @param {string} slotId - Slot id from the request
 * @param {Object} ctx - Page context with optional categoryId and searchQuery
 * @returns {Object|null} A renderable banner, or null when the slot stays empty
 */
function resolveBanner(slotId, ctx) {
    var config = TopsortService.getConfig();

    if (!config.enabled || !config.bannersEnabled) {
        return null;
    }

    if (!topsortHelpers.isInAuctionTrafficSample(config.auctionTrafficPercent)) {
        return null;
    }

    var slot = getSlot(slotId);

    if (!slot) {
        Logger.warn("Topsort banner requested for an unconfigured slot: {0}", slotId);
        return null;
    }

    var deviceType = topsortHelpers.getDeviceType();

    if (!isSlotOnDevice(slot, deviceType)) {
        return null;
    }

    var opaqueUserId = topsortSession.getOpaqueUserId();
    var auction = buildAuction(slot, ctx || {}, deviceType, opaqueUserId);
    var auctionResponse = TopsortService.runAuction({ auctions: [auction] });

    if (!auctionResponse.success) {
        Logger.error("Topsort banner auction failed for slot {0}: {1}", slotId, auctionResponse.error);
        return null;
    }

    var winner = extractWinner(auctionResponse.data, config.bannerAssetHosts);

    if (!winner) {
        return null;
    }

    winner.slotId = slot.slotId;
    winner.position = slot.position || 1;
    // How wide the banner renders, so the browser can choose between the sizes Topsort
    // returned. The side rail is a fixed narrow column while every other placement runs the
    // width of its container, and without this hint the browser assumes the full viewport
    // and downloads the largest creative for a 200px slot.
    winner.sizes = slot.sizes || null;
    winner.eventToken = topsortEventAuth.createEventToken(winner.resolvedBidId, opaqueUserId);
    // Echoed back into the impression and click so Topsort sees the same context the auction
    // ran with, rather than the path of this fragment.
    winner.categoryId = auction.category ? auction.category.id : null;
    winner.searchQuery = auction.searchQuery || null;

    return winner;
}

module.exports = {
    getSlot: getSlot,
    isSlotOnDevice: isSlotOnDevice,
    isAllowedAssetUrl: isAllowedAssetUrl,
    buildAuction: buildAuction,
    extractWinner: extractWinner,
    resolveBanner: resolveBanner
};
