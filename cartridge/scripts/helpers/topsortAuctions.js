"use strict";

/* global request, response */

var Logger         = require("dw/system/Logger").getLogger("SponsoredSearch");
var Site           = require("dw/system/Site");
var ArrayList      = require("dw/util/ArrayList");
var ProductMgr     = require("dw/catalog/ProductMgr");
var collections    = require("*/cartridge/scripts/util/collections");
var topsortHelpers = require("*/cartridge/scripts/helpers/topsortHelpers");
var TopsortService = require("*/cartridge/scripts/services/TopsortService");

// Read-only. SFCC caches required modules across requests, so the entries of this list
// must never be written to: a winner stored here would leak into later requests and
// attribute events to a bid that did not win.
var bannerSlots = require("*/cartridge/scripts/config/topsort_banners.json");

var LISTINGS_SLOTS   = 6;
var USER_ID_COOKIE   = "tsuid";
var LAST_QUERY_COOKIE = "topsortLastQuery";
var DEFAULT_COLUMNS  = 4;

/**
 * Seeds the fail-open values every Topsort template reads, so that a disabled
 * integration, a failed auction or an early return can never leave the render context
 * without them.
 *
 * @param {Object} target - The controller viewData or the Page Designer component model.
 * @param {string} [categoryId] - The category the listing page is showing, if any.
 */
function applyDefaults(target, categoryId) {
    var clientConfig = TopsortService.getClientConfig();

    target.bannerWinners          = target.bannerWinners || {};
    target.topsortApiKey          = clientConfig.apiKey || "";
    target.topsortApiURL          = clientConfig.apiURL || "";
    target.topsortTrackingEnabled = clientConfig.trackingEnabled || false;
    // Templates must not reach for pdict.request: SFRA never puts the request on the
    // pdict, so the category has to be published explicitly.
    target.topsortCategoryId      = categoryId || "";
    target.tsuid                  = target.tsuid || "";
}

/**
 * Determines whether the shopper narrowed the results with a refinement other than the
 * category itself, in which case sponsored placements are suppressed.
 *
 * @param {Object} productSearch - The SFRA product search model.
 * @returns {boolean} True when at least one non-category refinement value is selected.
 */
function hasNonCategoryRefinement(productSearch) {
    var applied = false;

    collections.forEach(new ArrayList(productSearch.refinements || []), function (refinementGroup) {
        if (refinementGroup.isCategoryRefinement) {
            return;
        }

        collections.forEach(new ArrayList(refinementGroup.values || []), function (value) {
            if (value.selected) {
                applied = true;
            }
        });
    });

    return applied;
}

/**
 * Reads the anonymous Topsort user id from the request, creating it when absent.
 *
 * Known limitation: category and search listing pages run behind page cache, so this
 * Set-Cookie may be dropped or shared between shoppers, which degrades attribution.
 * Generating the id client side or from a non-cached remote include is the real fix; the
 * pages are deliberately left cacheable because making them private is far more costly.
 *
 * @returns {string} The opaque user id to send to Topsort.
 */
function resolveOpaqueUserId() {
    var Cookie    = require("dw/web/Cookie");
    var UUIDUtils = require("dw/util/UUIDUtils");

    var existing = request.httpCookies[USER_ID_COOKIE];
    if (existing) {
        return existing.value;
    }

    var cookie = new Cookie(USER_ID_COOKIE, UUIDUtils.createUUID());
    cookie.setMaxAge(365 * 24 * 60 * 60);
    cookie.setHttpOnly(true);
    cookie.setPath("/");
    response.addHttpCookie(cookie);

    return cookie.value;
}

/**
 * Stores the last keyword search so that later events can be attributed to it.
 *
 * @param {string} [searchQuery] - The keyword the shopper searched for.
 */
function rememberSearchQuery(searchQuery) {
    if (!searchQuery) {
        return;
    }

    var Cookie = require("dw/web/Cookie");
    var cookie = new Cookie(LAST_QUERY_COOKIE, encodeURIComponent(searchQuery));
    cookie.setMaxAge(24 * 60 * 60);
    cookie.setHttpOnly(true);
    cookie.setPath("/");
    response.addHttpCookie(cookie);
}

/**
 * @param {string} [userAgent] - The request user agent.
 * @returns {string} Either "mobile" or "desktop".
 */
function detectDevice(userAgent) {
    return /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent || "")
        ? "mobile"
        : "desktop";
}

/**
 * Builds one banner auction per configured slot that applies to the current page type.
 *
 * @param {Object} context - Auction context.
 * @param {boolean} context.isCategorySearch - True on category listing pages.
 * @param {boolean} context.isKeywordSearch - True on keyword search pages.
 * @param {string} context.opaqueUserId - The anonymous Topsort user id.
 * @param {string} context.device - Either "mobile" or "desktop".
 * @param {string} [context.searchQuery] - The keyword the shopper searched for.
 * @param {string} [context.categoryId] - The normalized category id.
 * @returns {Array<Object>} The banner auctions to request.
 */
function buildBannerAuctions(context) {
    var applicableSlots = collections.filter(new ArrayList(bannerSlots), function (slot) {
        if (slot.type === "category") {
            return context.isCategorySearch;
        }
        if (slot.type === "search") {
            return context.isKeywordSearch;
        }
        return false;
    });

    return applicableSlots.map(function (slot) {
        var auction = {
            type: "banners",
            slots: slot.slots,
            slotId: slot.slotId,
            opaqueUserId: context.opaqueUserId,
            device: context.device
        };

        if (slot.type === "search") {
            auction.searchQuery = context.searchQuery;
        }
        if (slot.type === "category") {
            auction.category = { id: context.categoryId };
        }

        return auction;
    });
}

/**
 * Turns listing auction winners into product entries the grid templates can render,
 * reusing the organic entry when the winner is already part of the results.
 *
 * @param {Array<Object>} winners - Listing winners returned by Topsort.
 * @param {Array<Object>} originalEntries - The organic search result entries.
 * @returns {Array<Object>} The sponsored entries, in winning order.
 */
function buildSponsoredEntries(winners, originalEntries) {
    var originalEntriesArrList = new ArrayList(originalEntries);
    var skippedProductIds      = [];

    var sponsoredEntries = collections.reduce(new ArrayList(winners), function (acc, winner) {
        if (!ProductMgr.getProduct(winner.id)) {
            skippedProductIds.push(winner.id);
            return acc;
        }

        var organicEntry = collections.find(originalEntriesArrList, function (entry) {
            return entry.productID === winner.id;
        });

        if (organicEntry) {
            var sponsoredEntry = {};
            topsortHelpers.assignObject(sponsoredEntry, organicEntry);
            sponsoredEntry.isSponsored   = true;
            sponsoredEntry.resolvedBidId = winner.resolvedBidId;
            acc.push(sponsoredEntry);
            return acc;
        }

        acc.push({
            productID:     winner.id,
            isSponsored:   true,
            resolvedBidId: winner.resolvedBidId
        });
        return acc;
    }, []);

    if (skippedProductIds.length) {
        Logger.error("Product IDs were not found in the instance according to the Topsort response. These product will be skipped:\n {0}", skippedProductIds.join(", "));
    }

    return sponsoredEntries;
}

/**
 * Collects the winning banner for each requested slot into a request-local map.
 *
 * @param {Array<Object>} auctions - The auctions that were requested, in order.
 * @param {Array<Object>} results - The results Topsort returned, in the same order.
 * @returns {Object} A map of slot id to banner winner.
 */
function collectBannerWinners(auctions, results) {
    var bannerWinners = {};

    for (var i = 0; i < auctions.length && i < results.length; i++) {
        var auction = auctions[i];
        var result  = results[i];

        if (!result || auction.type !== "banners" || result.resultType !== "banners") {
            continue;
        }
        if (!result.winners || !result.winners.length) {
            continue;
        }

        var winner   = result.winners[0];
        var assetUrl = winner.asset && winner.asset[0] ? winner.asset[0].url : null;
        if (!assetUrl) {
            continue;
        }

        bannerWinners[auction.slotId] = {
            url:            assetUrl,
            bidId:          winner.resolvedBidId,
            redirectionUrl: winner.url,
            winnerId:       winner.id
        };
    }

    return bannerWinners;
}

/**
 * @returns {boolean} True when row normalization is switched on for this site.
 */
function isRowNormalizationEnabled() {
    return Boolean(Site.getCurrent().getCustomPreferenceValue("topsortNormalizeRows"));
}

/**
 * Runs the listing and banner auctions for a product listing page and writes the results
 * onto the given render context.
 *
 * The function is intentionally fail-open: on every early return the context still holds
 * the defaults from applyDefaults, so templates render an ordinary, unsponsored page.
 *
 * @param {Object} target - The controller viewData or the Page Designer component model.
 *   Must expose a productSearch model with a productIds array.
 * @param {Object} params - Page context.
 * @param {string} [params.searchQuery] - The keyword the shopper searched for.
 * @param {string} [params.categoryId] - The category the listing page is showing.
 * @param {string} [params.userAgent] - The request user agent.
 * @param {number} [params.columns] - Tiles per row, used only by row normalization.
 */
function decorate(target, params) {
    var options    = params || {};
    var categoryId = options.categoryId || null;

    applyDefaults(target, categoryId);

    // Nothing below has any effect while the integration is off, and running it anyway
    // would write cookies and call the service on every request just to be refused.
    if (!TopsortService.getConfig().enabled) {
        return;
    }

    var productSearch = target.productSearch;
    if (!productSearch || !productSearch.productIds) {
        return;
    }
    if (hasNonCategoryRefinement(productSearch)) {
        return;
    }

    var opaqueUserId = resolveOpaqueUserId();
    target.tsuid = opaqueUserId;
    rememberSearchQuery(options.searchQuery);

    // TODO: When the compatibility mode is at least 21.12, normalize accents as well:
    // categoryId.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    var sluggedCategoryId = categoryId ? categoryId.toLowerCase() : null;
    var isCategorySearch  = Boolean(sluggedCategoryId);
    var isKeywordSearch   = Boolean(options.searchQuery) && !isCategorySearch;

    var originalEntries = productSearch.productIds;
    var productIds      = collections.map(new ArrayList(originalEntries), function (entry) {
        return entry.productID;
    });

    var listingsAuction = topsortHelpers.createListingsAuction({
        type: "listings",
        slots: LISTINGS_SLOTS,
        products: { ids: productIds },
        opaqueUserId: opaqueUserId
    }, {
        searchQuery: options.searchQuery,
        category: isCategorySearch ? { id: sluggedCategoryId } : null
    });

    var auctions = [listingsAuction].concat(buildBannerAuctions({
        isCategorySearch: isCategorySearch,
        isKeywordSearch: isKeywordSearch,
        opaqueUserId: opaqueUserId,
        device: detectDevice(options.userAgent),
        searchQuery: options.searchQuery,
        categoryId: sluggedCategoryId
    }));

    var auctionResponse = TopsortService.runAuction({ auctions: auctions });
    if (!auctionResponse.success) {
        Logger.error("Topsort auction failed: {0}", auctionResponse.error);
        return;
    }

    var results = (auctionResponse.data && auctionResponse.data.results) || [];

    target.bannerWinners = collectBannerWinners(auctions, results);

    var listingsResult = collections.find(new ArrayList(results), function (result) {
        return result.resultType === "listings";
    });
    var listingWinners = listingsResult && listingsResult.winners ? listingsResult.winners : [];

    var sponsoredEntries = buildSponsoredEntries(listingWinners, originalEntries);
    if (sponsoredEntries.length) {
        productSearch.productIds = topsortHelpers.placeTheSponsoredProducts(sponsoredEntries, originalEntries);
    }

    if (isRowNormalizationEnabled()) {
        productSearch.productIds = topsortHelpers.normalizeProductsToRows(
            productSearch.productIds,
            options.columns || DEFAULT_COLUMNS
        );
    }
}

module.exports = {
    decorate: decorate
};
