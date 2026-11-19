"use strict";

var ProductMgr = require("dw/catalog/ProductMgr");
var ProductSearchHit = require("dw/catalog/ProductSearchHit");

/**
 * Topsort accepts up to 10000 products.ids per auction but recommends no more than 500.
 * A grid page is at most 48 tiles, while a HITES apparel family can carry 25 variants, so
 * sending every variant of every tile can exceed it.
 */
var MAX_AUCTION_PRODUCT_IDS = 500;

/**
 * Converts a dw.util.Collection, a Java array or a script array into a script array of
 * strings.
 *
 * @param {dw.util.Collection|Array} collection - IDs or products to convert
 * @param {Function} [mapper] - Turns each element into its ID
 * @returns {Array<string>} The IDs, in collection order
 */
function toIdArray(collection, mapper) {
    var ids = [];
    if (!collection) {
        return ids;
    }

    var push = function (element) {
        var id = mapper ? mapper(element) : element;
        if (id !== null && id !== undefined && String(id).length) {
            ids.push(String(id));
        }
    };

    if (typeof collection.iterator === "function") {
        var iterator = collection.iterator();
        while (iterator.hasNext()) {
            push(iterator.next());
        }
        return ids;
    }

    for (var i = 0; i < collection.length; i++) {
        push(collection[i]);
    }
    return ids;
}

/**
 * Removes repeated IDs, keeping the first occurrence of each.
 *
 * @param {Array<string>} ids - IDs that may repeat
 * @returns {Array<string>} IDs in their original order, each once
 */
function unique(ids) {
    var seen = {};
    return ids.filter(function (id) {
        if (Object.prototype.hasOwnProperty.call(seen, id)) {
            return false;
        }
        seen[id] = true;
        return true;
    });
}

/**
 * Returns the sellable IDs of a product as the Topsort catalog knows them.
 *
 * The HITES catalog feed sends variants only: 9 digit IDs for HITES products and 14 digit IDs
 * for marketplace sellers. The 6 and 11 digit masters, and any variation group, do not exist
 * in Topsort, so an auction carrying them can never match a campaign.
 *
 * ProductVariationModel.getVariants() already leaves offline variants out.
 *
 * @param {dw.catalog.Product} product - Product to resolve
 * @returns {Array<string>} Variant IDs with the default variant first, or the product's own
 *     ID when it is neither a master nor a variation group
 */
function getSellableIds(product) {
    if (!product) {
        return [];
    }
    if (!product.master && !product.variationGroup) {
        return [String(product.ID)];
    }

    var variationModel = product.variationModel;
    if (!variationModel) {
        return [];
    }

    var ids = variationModel.defaultVariant ? [String(variationModel.defaultVariant.ID)] : [];
    return unique(ids.concat(toIdArray(variationModel.variants, function (variant) {
        return variant.ID;
    })));
}

/**
 * Returns the Topsort catalog IDs a search hit stands for, best candidate first.
 *
 * A master or variation group hit carries the master or group ID, which is the one place SFRA
 * puts in productSearch.productIds. Its represented products are the variants that matched
 * the query and the selected refinements, so a search filtered to black sends only the black
 * sizes. A hit on a variant assigned directly to the category carries a variant ID and sends
 * only that. A slicing group hit (one tile per colour) carries a variant ID on HITES too
 * (tile-973764001 on a slicing_group tile), which stays first ahead of the other sizes of
 * that colour.
 *
 * @param {dw.catalog.ProductSearchHit} hit - Organic search hit
 * @returns {Array<string>} Catalog IDs for the hit, best candidate first
 */
function getHitCatalogIds(hit) {
    var ownId = String(hit.productID);
    // Compared as script strings: HITES's own code compares hitType loosely, and a strict
    // comparison against a host string would silently send the master ID again.
    var hitType = String(hit.hitType);
    var isGroupedHit = hitType === String(ProductSearchHit.HIT_TYPE_PRODUCT_MASTER)
        || hitType === String(ProductSearchHit.HIT_TYPE_VARIATION_GROUP);
    var isSlicingHit = hitType === String(ProductSearchHit.HIT_TYPE_SLICING_GROUP);

    if (!isGroupedHit && !isSlicingHit) {
        return [ownId];
    }

    var represented = unique(toIdArray(hit.representedProductIDs)).filter(function (id) {
        return !isGroupedHit || id !== ownId;
    });

    if (!represented.length) {
        // The product of a slicing hit is the master, whose variants span every colour, so
        // falling back to them would let another colour's winner take this colour's tile.
        if (isSlicingHit && !(hit.product && String(hit.product.ID) === ownId)) {
            return [ownId];
        }
        return getSellableIds(hit.product);
    }

    var firstRepresented = hit.firstRepresentedProductID ? String(hit.firstRepresentedProductID) : null;
    var preferred = represented.indexOf(ownId) !== -1 ? ownId : firstRepresented;
    if (preferred && represented.indexOf(preferred) > 0) {
        represented.splice(represented.indexOf(preferred), 1);
        represented.unshift(preferred);
    }
    return represented;
}

/**
 * Returns the Topsort catalog IDs an organic grid entry stands for, best candidate first.
 *
 * @param {Object} entry - SFRA productSearch.productIds entry
 * @returns {Array<string>} Catalog IDs, or an empty array when none can be resolved
 */
function getEntryCatalogIds(entry) {
    if (!entry || !entry.productID) {
        return [];
    }
    if (entry.productSearchHit) {
        return getHitCatalogIds(entry.productSearchHit);
    }
    return getSellableIds(ProductMgr.getProduct(entry.productID));
}

/**
 * Builds products.ids for a listings auction from the organic grid entries.
 *
 * Every variant a tile represents is offered, because campaigns target individual sizes
 * (963517002, not just 963517001) and only the targeted ID can win. The list is filled one
 * layer at a time - the best candidate of every tile, then the second of every tile, and so
 * on - so when maxIds cuts it short every tile still competes with at least one variant.
 *
 * entryByCatalogId covers every resolved ID, including the ones the cap left out of the
 * request, so a winner that reaches the auction through a keyword or category bid is still
 * matched back to the tile already showing its product instead of being injected twice. An
 * entry keyed by the winning ID itself (a variant assigned directly to the category) takes
 * precedence over a master tile that also represents it, so the master tile stays organic.
 *
 * @param {Array<Object>} entries - SFRA productSearch.productIds entries
 * @param {number} [maxIds] - Most IDs to send, MAX_AUCTION_PRODUCT_IDS by default
 * @returns {{ids: Array<string>, entryByCatalogId: Object}} The IDs for products.ids, and
 *     the organic entry each resolved catalog ID belongs to
 */
function buildAuctionProductIds(entries, maxIds) {
    var limit = maxIds || MAX_AUCTION_PRODUCT_IDS;
    var catalogIdsPerEntry = (entries || []).map(getEntryCatalogIds);
    var entryByCatalogId = {};
    var ids = [];

    catalogIdsPerEntry.forEach(function (catalogIds, index) {
        var ownId = catalogIds.length ? String(entries[index].productID) : null;
        if (ownId && catalogIds.indexOf(ownId) !== -1 && !Object.prototype.hasOwnProperty.call(entryByCatalogId, ownId)) {
            entryByCatalogId[ownId] = entries[index];
        }
    });

    catalogIdsPerEntry.forEach(function (catalogIds, index) {
        catalogIds.forEach(function (id) {
            if (!Object.prototype.hasOwnProperty.call(entryByCatalogId, id)) {
                entryByCatalogId[id] = entries[index];
            }
        });
    });

    var queued = {};
    for (var depth = 0; ids.length < limit; depth++) {
        var reachedAnyEntry = false;
        for (var i = 0; i < catalogIdsPerEntry.length && ids.length < limit; i++) {
            var id = catalogIdsPerEntry[i][depth];
            if (id === undefined) {
                continue;
            }
            reachedAnyEntry = true;
            if (!Object.prototype.hasOwnProperty.call(queued, id)) {
                queued[id] = true;
                ids.push(id);
            }
        }
        if (!reachedAnyEntry) {
            break;
        }
    }

    return { ids: ids, entryByCatalogId: entryByCatalogId };
}

module.exports = {
    MAX_AUCTION_PRODUCT_IDS: MAX_AUCTION_PRODUCT_IDS,
    buildAuctionProductIds: buildAuctionProductIds
};
