"use strict";

var server         = require("server");
var superSearch    = module.superModule;
var Logger         = require("dw/system/Logger").getLogger("SponsoredSearch");
var topsortHelpers = require("*/cartridge/scripts/helpers/topsortHelpers");
var sponsoredBrandsHelpers = require("*/cartridge/scripts/helpers/sponsoredBrandsHelpers");
var TopsortService = require("*/cartridge/scripts/services/TopsortService");
var ProductMgr     = require("dw/catalog/ProductMgr");
var Cookie         = require("dw/web/Cookie");
var UUIDUtils      = require("dw/util/UUIDUtils");
var collections    = require("*/cartridge/scripts/util/collections");
var ArrayList      = require("dw/util/ArrayList");
var bannerSlots    = require("*/cartridge/scripts/config/topsort_banners.json");

var LISTINGS_SLOTS = 6;
var MOBILE_USER_AGENT = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

server.extend(superSearch);

/**
 * Reads the Topsort opaque user ID from its cookie, creating the cookie when the shopper
 * does not have one yet.
 *
 * @returns {string} The opaque user ID.
 */
function getOrCreateTsuid() {
    var tsuid = request.httpCookies["tsuid"];

    if (!tsuid) {
        tsuid = new Cookie("tsuid", UUIDUtils.createUUID());
        tsuid.setMaxAge(365 * 24 * 60 * 60);
        tsuid.setHttpOnly(true);
        tsuid.setPath("/");
        response.addHttpCookie(tsuid);
    }

    return tsuid.value;
}

/**
 * Buckets the request into the two device types Topsort targets.
 *
 * The banner auction sends this so Topsort can resolve the creative sized for the device, and
 * the slot configuration uses it to decide which positions are worth bidding on at all.
 *
 * @param {Object} req - The request object.
 * @returns {string} Either "mobile" or "desktop".
 */
function getDeviceType(req) {
    var userAgent = req.httpHeaders.get("user-agent") || req.httpUserAgent || "";
    return MOBILE_USER_AGENT.test(userAgent) ? "mobile" : "desktop";
}

/**
 * Runs the listings and banners auctions for a product listing page, reorders the grid with the
 * sponsored winners and exposes the winning banners on the view data.
 *
 * `Search-Show` and `Search-UpdateGrid` need identical handling, so both delegate here.
 *
 * @param {Object} req - The request object containing query parameters.
 * @param {Object} res - The response object used to modify view data.
 * @param {Function} next - The next middleware function in the chain.
 * @param {dw.catalog.Category|null} category - The category being listed, when there is one.
 * @returns {void}
 *
 * @throws {Error} Logs an error message if the Topsort auction fails.
 */
function applySponsoredListingsAndBanners(req, res, next, category) {
    var viewData = res.getViewData();

    // Set on every exit path so the templates always read a defined map. The winners are rebuilt
    // per request, which is what keeps a slot that won earlier from rendering with an already
    // consumed resolvedBidId when it is not auctioned again.
    viewData.bannerWinners = {};

    if (topsortHelpers.isTopsortDisabledByCategory(category)) {
        res.setViewData(viewData);
        return next();
    }

    // Sponsored results are suppressed when the shopper narrowed the grid in a way the auction
    // has no knowledge of.
    if (topsortHelpers.hasNonCategoryRefinements(viewData.productSearch.refinements)) {
        res.setViewData(viewData);
        return next();
    }

    var originalEntries        = viewData.productSearch.productIds || [];
    var originalEntriesArrList = new ArrayList(originalEntries);
    var productIDs             = collections.map(originalEntriesArrList, function (e) {
        return e.productID;
    });

    var searchQuery = req.querystring.q;
    var categoryId  = req.querystring.cgid;
    var tsuidValue  = getOrCreateTsuid();

    // Only written when there is a term to record. Category pages have no `q`, and writing them
    // through would store the string "undefined" and clobber the shopper's actual last search.
    if (searchQuery) {
        var searchCookie = new Cookie("topsortLastQuery", encodeURIComponent(searchQuery));
        searchCookie.setMaxAge(24 * 60 * 60);
        searchCookie.setHttpOnly(true);
        searchCookie.setPath("/");
        response.addHttpCookie(searchCookie);
    }

    // TODO: When the compatibilty mode is at least 21.12, uncomment the normalization line
    // var sluggedCategoryId = categoryId ? categoryId.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : null;
    var sluggedCategoryId = categoryId ? categoryId.toLowerCase() : null;

    var isCategorySearch = Boolean(categoryId && sluggedCategoryId);
    var isSearchSearch   = Boolean(searchQuery && !isCategorySearch);

    var listingsAuction = topsortHelpers.createListingsAuction({
        type: "listings",
        slots: LISTINGS_SLOTS,
        products: { ids: productIDs },
        opaqueUserId: tsuidValue
    }, {
        searchQuery: searchQuery,
        category: isCategorySearch ? { id: sluggedCategoryId } : null
    });

    var auctions = topsortHelpers.buildBannerAuctions(bannerSlots, {
        device: getDeviceType(req),
        opaqueUserId: tsuidValue,
        searchQuery: searchQuery,
        categoryId: sluggedCategoryId,
        isCategorySearch: isCategorySearch,
        isSearchSearch: isSearchSearch
    });

    auctions.unshift(listingsAuction);

    var auctionResponse = TopsortService.runAuction({ auctions: auctions });

    if (!auctionResponse.success) {
        Logger.error("Topsort auction failed: {0}", auctionResponse.error);
        res.setViewData(viewData);
        return next();
    }

    var resp    = auctionResponse.data;
    var results = resp && resp.results ? resp.results : [];

    var listingsResult = collections.find(new ArrayList(results), function (r) {
        return r.resultType === "listings";
    });
    var winners = listingsResult ? listingsResult.winners || [] : [];

    viewData.bannerWinners = topsortHelpers.collectBannerWinners(auctions, results);

    var skippedProductIds = [];
    var sponsoredTop = collections.reduce(new ArrayList(winners), function (acc, w) {
        var product = ProductMgr.getProduct(w.id);
        if (!product) {
            skippedProductIds.push(w.id);
            return acc;
        }

        var orig = collections.find(originalEntriesArrList, function (e) {
            return e.productID === w.id;
        });
        if (orig) {
            var sponsoredProduct = {};
            topsortHelpers.assignObject(sponsoredProduct, orig);
            sponsoredProduct.isSponsored = true;
            sponsoredProduct.resolvedBidId = w.resolvedBidId;
            acc.push(sponsoredProduct);
            return acc;
        }
        acc.push({
            productID:     w.id,
            isSponsored:   true,
            resolvedBidId: w.resolvedBidId
        });
        return acc;
    }, []);

    if (skippedProductIds.length) {
        Logger.error("Product IDs were not found in the instance according to the Topsort response. These product will be skipped:\n {0}", skippedProductIds.join(", "));
    }

    var productsWithSponsored = topsortHelpers.placeTheSponsoredProducts(sponsoredTop, originalEntries);
    viewData.productSearch.productIds = topsortHelpers.normalizeProductsToRowsOfFour(productsWithSponsored);

    var clientConfig = TopsortService.getClientConfig();
    viewData.topsortApiKey          = clientConfig.apiKey;
    viewData.topsortApiURL          = clientConfig.apiURL;
    viewData.topsortTrackingEnabled = clientConfig.trackingEnabled;
    viewData.tsuid                  = tsuidValue;

    res.setViewData(viewData);
    next();
}

server.append("UpdateGrid", function (req, res, next) {
    var CatalogMgr = require("dw/catalog/CatalogMgr");

    return applySponsoredListingsAndBanners(req, res, next, CatalogMgr.getCategory(req.querystring.cgid));
});

server.append("Show", function (req, res, next) {
    return applySponsoredListingsAndBanners(req, res, next, res.getViewData().category);
});

/**
 * Runs the sponsored brand auctions for a category listing page and exposes the winning rows
 * on the view data, grouped by the position each slot is configured for.
 *
 * This is kept as its own append so that a failure here cannot affect the sponsored listings
 * and banners handled above, and vice versa.
 *
 * @param {Object} req - The request object containing query parameters.
 * @param {Object} res - The response object used to modify view data.
 * @param {Function} next - The next middleware function in the chain.
 */
server.append("Show", function (req, res, next) {
    var viewData   = res.getViewData();
    var categoryId = req.querystring.cgid;

    viewData.sponsoredBrands = sponsoredBrandsHelpers.groupByPosition([]);

    // Sponsored brands only run on category listing pages.
    if (!categoryId) {
        res.setViewData(viewData);
        return next();
    }

    if (topsortHelpers.isTopsortDisabledByCategory(viewData.category)) {
        res.setViewData(viewData);
        return next();
    }

    var productSearch = viewData.productSearch;

    if (!productSearch || topsortHelpers.hasNonCategoryRefinements(productSearch.refinements)) {
        res.setViewData(viewData);
        return next();
    }

    var slots = sponsoredBrandsHelpers.getEnabledSlots();

    if (!slots.length) {
        res.setViewData(viewData);
        return next();
    }

    var tsuidValue      = getOrCreateTsuid();
    var auctions        = sponsoredBrandsHelpers.buildAuctions(slots, categoryId, tsuidValue);
    var auctionResponse = TopsortService.runSponsoredBrandAuction({ auctions: auctions });

    if (!auctionResponse.success) {
        Logger.error("Topsort sponsored brand auction failed: {0}", auctionResponse.error);
        res.setViewData(viewData);
        return next();
    }

    var resp = auctionResponse.data;
    var rows = sponsoredBrandsHelpers.normalizeWinners(slots, resp ? resp.results : []);

    viewData.sponsoredBrands = sponsoredBrandsHelpers.groupByPosition(rows);

    // The listings append sets these too, but it returns early on its own failures, so the
    // tracking data the sponsored brand templates need is set here as well.
    var clientConfig = TopsortService.getClientConfig();
    viewData.topsortApiKey          = clientConfig.apiKey;
    viewData.topsortApiURL          = clientConfig.apiURL;
    viewData.topsortTrackingEnabled = clientConfig.trackingEnabled;
    viewData.tsuid                  = tsuidValue;

    res.setViewData(viewData);
    next();
});


module.exports = server.exports();
