"use strict";

var Logger        = require("dw/system/Logger").getLogger("SponsoredBrands");
var ProductMgr    = require("dw/catalog/ProductMgr");
var slotConfig    = require("*/cartridge/scripts/config/topsort_sponsored_brands.json");

var POSITIONS = ["top", "above-grid", "in-grid", "below-grid"];

/**
* Returns the slots that are switched on in the configuration file, in configuration order.
*
* @returns {Array<Object>} The enabled slot configurations.
*/
function getEnabledSlots() {
    var enabled = [];

    for (var i = 0; i < slotConfig.length; i += 1) {
        if (slotConfig[i].enabled) {
            enabled.push(slotConfig[i]);
        }
    }

    return enabled;
}

/**
* Builds one sponsored brand auction per enabled slot. The category ID is passed through
* untouched, so it must match the category IDs in the Topsort catalog exactly.
*
* @param {Array<Object>} slots - The enabled slot configurations.
* @param {string} categoryId - The raw cgid of the category being viewed.
* @param {string} opaqueUserId - The tsuid cookie value.
* @returns {Array<Object>} The auction request objects.
*/
function buildAuctions(slots, categoryId, opaqueUserId) {
    var auctions = [];

    for (var i = 0; i < slots.length; i += 1) {
        auctions.push({
            winners: slots[i].winners || 1,
            placementId: slots[i].slotId,
            triggers: {
                category: { id: categoryId }
            },
            opaqueUserId: opaqueUserId
        });
    }

    return auctions;
}

/**
* Reads a creative URL from a winner. Template driven (V2) campaigns return their fields in
* `content`, while legacy (V1) brand campaigns return an `assets` array tagged by role, so
* both are checked before giving up.
*
* @param {Object} winner - A single auction winner.
* @param {string} contentKey - The property name in the JSON template schema.
* @param {string} assetRole - The equivalent role in the legacy assets array.
* @returns {string|null} The asset URL, or null when the winner carries neither.
*/
function pickAsset(winner, contentKey, assetRole) {
    var content = winner.content || {};

    if (content[contentKey]) {
        return content[contentKey];
    }

    var assets = winner.assets || [];

    for (var i = 0; i < assets.length; i += 1) {
        if (assets[i].role === assetRole) {
            return assets[i].url;
        }
    }

    return null;
}

/**
* Filters the campaign's products down to the ones that can actually be rendered, keeping
* the order Topsort returned them in.
*
* @param {Array<string>} productIds - The product IDs attached to the winning campaign.
* @param {number} maxProducts - The most products this format can display.
* @returns {Array<string>} The renderable product IDs.
*/
function resolveProducts(productIds, maxProducts) {
    var ids = productIds || [];
    var resolved = [];
    var skipped = [];

    for (var i = 0; i < ids.length && resolved.length < maxProducts; i += 1) {
        var product = ProductMgr.getProduct(ids[i]);

        if (product && product.online) {
            resolved.push(ids[i]);
        } else {
            skipped.push(ids[i]);
        }
    }

    if (skipped.length) {
        Logger.error("Sponsored brand products were not found or are offline in the instance. These products will be skipped:\n {0}", skipped.join(", "));
    }

    return resolved;
}

/**
* Turns the auction response into one renderable row per winner.
*
* Results map to the requested auctions by array index. Every winner of every result becomes
* its own row with its own resolvedBidId, so a slot returning several winners renders several
* rows rather than only the first one.
*
* @param {Array<Object>} slots - The enabled slot configurations, in the order they were requested.
* @param {Array<Object>} results - The `results` array from the auction response.
* @returns {Array<Object>} The rows to render.
*/
function normalizeWinners(slots, results) {
    var rows = [];
    var auctionResults = results || [];

    for (var i = 0; i < slots.length && i < auctionResults.length; i += 1) {
        var slot = slots[i];
        var winners = auctionResults[i] && auctionResults[i].winners ? auctionResults[i].winners : [];

        for (var j = 0; j < winners.length; j += 1) {
            var winner = winners[j];
            var content = winner.content || {};
            var slides = slot.slidesToShow || {};
            var products = resolveProducts(winner.productIds, slot.maxProducts);

            if (products.length < slot.minProducts) {
                Logger.error("Sponsored brand winner on slot {0} resolved only {1} of the {2} products required by the format. The row will be skipped.", slot.slotId, products.length, slot.minProducts);
                continue;
            }

            rows.push({
                slotId: slot.slotId,
                format: slot.format,
                position: slot.position,
                afterTile: slot.afterTile,
                slidesToShow: {
                    desktop: slides.desktop || 1,
                    mobile: slides.mobile || 2
                },
                resolvedBidId: winner.resolvedBidId,
                campaignId: winner.campaignId,
                vendorId: winner.vendorId,
                rank: winner.rank,
                creativeUrl: pickAsset(winner, "creative", "image"),
                logoUrl: pickAsset(winner, "logo", "logo"),
                headline: content.headline || winner.title || "",
                linkUrl: winner.type === "url" ? winner.id : null,
                products: products
            });
        }
    }

    return rows;
}

/**
* Buckets the rows by the position their slot is configured for, so each template include
* only renders the rows that belong to it.
*
* @param {Array<Object>} rows - The normalized rows.
* @returns {Object} The rows keyed by position.
*/
function groupByPosition(rows) {
    var grouped = {};

    for (var i = 0; i < POSITIONS.length; i += 1) {
        grouped[POSITIONS[i]] = [];
    }

    for (var j = 0; j < rows.length; j += 1) {
        var position = rows[j].position;

        if (grouped[position]) {
            grouped[position].push(rows[j]);
        } else {
            Logger.error("Sponsored brand slot {0} is configured with the unknown position \"{1}\". The row will not be rendered.", rows[j].slotId, position);
        }
    }

    return grouped;
}

module.exports = {
    getEnabledSlots: getEnabledSlots,
    buildAuctions: buildAuctions,
    pickAsset: pickAsset,
    resolveProducts: resolveProducts,
    normalizeWinners: normalizeWinners,
    groupByPosition: groupByPosition
};
