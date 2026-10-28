"use strict";

var Logger = require("dw/system/Logger").getLogger("SponsoredSearch");
var ProductMgr = require("dw/catalog/ProductMgr");
var topsortEventAuth = require("*/cartridge/scripts/helpers/topsortEventAuth");
var topsortHelpers = require("*/cartridge/scripts/helpers/topsortHelpers");
var topsortSession = require("*/cartridge/scripts/helpers/topsortSession");
var TopsortService = require("*/cartridge/scripts/services/TopsortService");

var SLOTS = 6;
var BRAND_REFINEMENT_ID = "brand";

/**
 * Returns a stable string representation of a selected refinement value.
 *
 * @param {Object} value - SFRA refinement value
 * @returns {string} Refinement value suitable for the auction context
 */
function getRefinementValue(value) {
    if (value.value !== null && value.value !== undefined) {
        return String(value.value);
    }
    if (value.valueFrom !== undefined && value.valueTo !== undefined) {
        return String(value.valueFrom) + "-" + String(value.valueTo);
    }
    if (value.displayValue !== null && value.displayValue !== undefined) {
        return String(value.displayValue);
    }
    return "";
}

/**
 * Collects selected filters other than the category navigation refinement.
 *
 * HITES extends the SFRA refinement model with the underlying definition id, so filter
 * types can be identified without relying on translated display names.
 *
 * @param {Object} productSearch - SFRA productSearch model
 * @returns {Array<Object>} Selected filter id/value pairs
 */
function getSelectedFilters(productSearch) {
    return (productSearch.refinements || []).reduce(function (selected, refGroup) {
        if (!refGroup || refGroup.isCategoryRefinement) {
            return selected;
        }

        (refGroup.values || []).forEach(function (value) {
            var refinementValue = value && value.selected ? getRefinementValue(value) : "";
            if (refinementValue) {
                selected.push({
                    id: String(refGroup.id || refGroup.displayName || "filter"),
                    value: refinementValue
                });
            }
        });

        return selected;
    }, []);
}

/**
 * Reports whether the shopper selected a brand filter.
 *
 * @param {Array<Object>} selectedFilters - Selected filter id/value pairs
 * @returns {boolean} True when brand is among the selected filters
 */
function hasSelectedBrandFilter(selectedFilters) {
    return selectedFilters.some(function (filter) {
        return filter.id.toLowerCase() === BRAND_REFINEMENT_ID;
    });
}

/**
 * Appends selected filter context to a search query or category id.
 *
 * @param {string|null} context - Original search query or normalized category id
 * @param {Array<Object>} selectedFilters - Selected filter id/value pairs
 * @returns {string|null} Context with selected filters appended
 */
function appendFiltersToContext(context, selectedFilters) {
    if (!context || !selectedFilters.length) {
        return context;
    }

    return context + " " + selectedFilters.map(function (filter) {
        return filter.id + ":" + filter.value;
    }).join(" ");
}

/**
 * Extracts the winners of the listings auction from a Topsort auction response.
 *
 * @param {Object} data - Parsed body of the /v2/auctions response
 * @returns {Array} The listings winners, or an empty array when there are none
 */
function extractListingsWinners(data) {
    if (!data || !data.results) {
        return [];
    }

    var listingsResult = data.results.filter(function (r) {
        return r.resultType === "listings";
    })[0];

    return listingsResult ? listingsResult.winners || [] : [];
}

/**
 * Reports whether a product the search engine did not return is safe to place in the grid.
 *
 * Nothing has vetted these products: a listings auction combining products.ids with a
 * searchQuery or a category also admits keyword and category bids, so a winner can be a
 * product this page's search never matched. Everything the storefront relies on to show a
 * sellable tile is therefore checked here, rather than letting an offline, unsearchable or
 * unbuyable product be advertised.
 *
 * @param {dw.catalog.Product} product - Product resolved from the winning bid
 * @returns {boolean} True when the product may be injected into the grid
 */
function isInjectable(product) {
    return Boolean(product)
        && product.online
        && product.searchable
        && product.assignedToSiteCatalog
        && Boolean(product.availabilityModel)
        && product.availabilityModel.orderable;
}

/**
 * Builds the sponsored entries for the auction winners.
 *
 * Winners already present in this page of organic results reuse that entry, so the tile
 * keeps its productSearchHit and the search engine's own visibility rules stand. Winners
 * from keyword or category bids are vetted by isInjectable before being added.
 *
 * @param {Array} winners - Listings winners from the auction response
 * @param {Array} originalEntries - The organic productIds entries
 * @param {string} opaqueUserId - Shopper identity used for the auction
 * @returns {Array} Sponsored entries, in auction order
 */
function buildSponsoredEntries(winners, originalEntries, opaqueUserId) {
    var skippedProductIds = [];
    // Two bids on the same product can both win a single auction. Placing it twice renders
    // two tiles carrying the same tile-<pid> id, so the shopper sees one tile while Topsort
    // is sent two impressions, and one click on it is reported - and charged - twice.
    var seenProductIds = {};

    var sponsored = winners.reduce(function (acc, w) {
        if (!w || !w.id || seenProductIds[w.id]) {
            return acc;
        }
        seenProductIds[w.id] = true;

        var orig = originalEntries.filter(function (e) {
            return e.productID === w.id;
        })[0];

        // Already on the page organically: reuse the entry and just flag it as sponsored.
        if (orig) {
            var sponsoredProduct = {};
            topsortHelpers.assignObject(sponsoredProduct, orig);
            sponsoredProduct.isSponsored = true;
            sponsoredProduct.isInjected = false;
            sponsoredProduct.resolvedBidId = w.resolvedBidId;
            sponsoredProduct.eventToken = topsortEventAuth.createEventToken(w.resolvedBidId, opaqueUserId);
            acc.push(sponsoredProduct);
            return acc;
        }

        if (!isInjectable(ProductMgr.getProduct(w.id))) {
            skippedProductIds.push(w.id);
            return acc;
        }

        acc.push({
            productID:     w.id,
            isSponsored:   true,
            isInjected:    true,
            resolvedBidId: w.resolvedBidId,
            eventToken:    topsortEventAuth.createEventToken(w.resolvedBidId, opaqueUserId)
        });
        return acc;
    }, []);

    if (skippedProductIds.length) {
        Logger.warn("Topsort returned winners that cannot be shown on this site (offline, not searchable, not in the site catalog or not orderable). Skipped: {0}", skippedProductIds.join(", "));
    }

    return sponsored;
}

/**
 * Reports whether a product grid carries sponsored placements.
 *
 * The Page Designer component uses this after rendering to decide whether the response may
 * be page cached, because the component script has no other way to learn what the grid
 * template did.
 *
 * @param {Object} productSearch - SFRA productSearch model
 * @returns {boolean} True when at least one entry is a sponsored placement
 */
function hasSponsoredProducts(productSearch) {
    if (!productSearch || !productSearch.productIds) {
        return false;
    }

    return productSearch.productIds.some(function (entry) {
        return Boolean(entry && entry.isSponsored);
    });
}

/**
 * Runs the listings auction for a product grid and merges the winners into
 * productSearch.productIds in place.
 *
 * Fail-open: when Topsort is disabled, the request falls outside the configured share of
 * traffic, a brand filter is selected, or the API call fails, the organic grid is left
 * exactly as it was and the response stays cacheable.
 *
 * @param {Object} productSearch - SFRA productSearch model whose productIds are merged
 * @param {Object} options - Auction context
 * @param {string} [options.categoryId] - Category being browsed, when applicable
 * @param {string} [options.searchQuery] - Shopper search term, when applicable
 * @returns {Object} result - Outcome of the auction
 * @returns {number} result.sponsoredCount - Number of sponsored entries merged in
 * @returns {boolean} result.cacheable - False when this response must not be page cached
 */
function applyListingsAuction(productSearch, options) {
    var result = { sponsoredCount: 0, cacheable: true };
    var config = TopsortService.getConfig();

    if (!config.enabled) {
        return result;
    }

    if (!productSearch || !productSearch.productIds || !productSearch.productIds.length) {
        return result;
    }

    // Checked before anything else costs a request: a sampled-out request has to leave the
    // page cacheable, so it must return before the refinements model is built and before a
    // tsuid cookie is minted.
    if (!topsortHelpers.isInAuctionTrafficSample(config.auctionTrafficPercent)) {
        return result;
    }

    var selectedFilters = getSelectedFilters(productSearch);
    if (hasSelectedBrandFilter(selectedFilters)) {
        return result;
    }

    // A freshly minted tsuid cookie cannot survive the page cache, so the response that
    // sets it has to be served dynamically.
    var opaqueUser = topsortSession.resolveOpaqueUser();
    result.cacheable = !opaqueUser.isNew;

    var originalEntries = productSearch.productIds;
    var productIDs = originalEntries.map(function (e) {
        return e.productID;
    });

    // searchQuery and category are separate auction triggers, and a search refined by a
    // category arrives with both q and cgid set. The shopper's own query is the stronger
    // statement of intent, so it wins: the request carries products + searchQuery for a
    // search and products + category for a category page, and never a hybrid of the two.
    var searchQuery = options && options.searchQuery ? options.searchQuery : null;
    var categoryId = !searchQuery && options && options.categoryId ? options.categoryId : null;
    var sluggedCategoryId = topsortHelpers.resolveTopsortCategoryId(categoryId);
    searchQuery = appendFiltersToContext(searchQuery, selectedFilters);
    sluggedCategoryId = appendFiltersToContext(sluggedCategoryId, selectedFilters);

    var listingsAuction = topsortHelpers.createListingsAuction({
        type: "listings",
        slots: SLOTS,
        products: { ids: productIDs },
        opaqueUserId: opaqueUser.id
    }, {
        searchQuery: searchQuery,
        category: sluggedCategoryId ? { id: sluggedCategoryId } : null
    });

    var auctionResponse = TopsortService.runAuction({ auctions: [listingsAuction] });

    if (!auctionResponse.success) {
        Logger.error("Topsort auction failed: {0}", auctionResponse.error);
        return result;
    }

    var sponsoredTop = buildSponsoredEntries(
        extractListingsWinners(auctionResponse.data),
        originalEntries,
        opaqueUser.id
    );

    if (!sponsoredTop.length) {
        return result;
    }

    productSearch.productIds = topsortHelpers.placeTheSponsoredProducts(sponsoredTop, originalEntries); // eslint-disable-line no-param-reassign
    result.sponsoredCount = sponsoredTop.length;
    // The grid now carries resolvedBidIds that belong to this single auction. Caching
    // the page would report every later shopper's impressions against these bids.
    result.cacheable = false;

    return result;
}

module.exports = {
    applyListingsAuction: applyListingsAuction,
    hasSponsoredProducts: hasSponsoredProducts
};
