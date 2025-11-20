"use strict";

var server         = require("server");
var superSearch    = module.superModule;
var Logger         = require("dw/system/Logger").getLogger("SponsoredSearch");
var topsortHelpers = require("*/cartridge/scripts/helpers/topsortHelpers");
var TopsortService = require("*/cartridge/scripts/services/TopsortService");
var ProductMgr     = require("dw/catalog/ProductMgr");
var collections    = require("*/cartridge/scripts/util/collections");
var ArrayList      = require("dw/util/ArrayList");
var topsortConfig  = new ArrayList(require("*/cartridge/scripts/config/topsort_banners.json"));

server.extend(superSearch);

/**
 * Appends auction results to the search results and manages cookies for user tracking.
 *
 * This function modifies the search results by integrating auction data, handling cookies
 * for user identification, and updating the view data with sponsored product information.
 *
 * @param {Object} req - The request object containing query parameters.
 * @param {Object} res - The response object used to modify view data.
 * @param {Function} next - The next middleware function in the chain.
 *
 * @throws {Error} Logs an error message if the Topsort auction fails.
 */
server.append("UpdateGrid", function (req, res, next) {
    var viewData               = res.getViewData();
    var originalEntries        = viewData.productSearch.productIds || [];
    var originalEntriesArrList = new ArrayList(originalEntries);
    var productIDs             = collections.map(originalEntriesArrList, function (e) {
        return e.productID;
    });
    var searchQuery            = req.querystring.q;
    var slots                  = 6;
    var categoryId             = req.querystring.cgid;

    // â€”â€”â€” UPDATED GUARD â€”â€”â€”
    // Disable sponsored only if the user has selected ANY nonâ€category refinement
    var refinements = viewData.productSearch.refinements || [];
    var filtersApplied = false;

    refinements.forEach(function(refGroup) {
        if (!refGroup.isCategoryRefinement) {
            var values = refGroup.values || [];

            values.forEach(function(val) {
                if (val.selected) {
                    filtersApplied = true;
                }
            });
        }
    });

    if (filtersApplied) {
        res.setViewData(viewData);
        return next();
    }
    // â€”â€”â€” end guard â€”â€”â€”

    var Cookie    = require("dw/web/Cookie");
    var UUIDUtils = require("dw/util/UUIDUtils");

    var tsuid = request.httpCookies["tsuid"];
    if (!tsuid) {
        tsuid = new Cookie("tsuid", UUIDUtils.createUUID());
        tsuid.setMaxAge(365 * 24 * 60 * 60);
        tsuid.setHttpOnly(true);
        tsuid.setPath("/");
        response.addHttpCookie(tsuid);
    }
    var tsuidValue = tsuid.value;

    var searchCookie = new Cookie("topsortLastQuery", encodeURIComponent(searchQuery));
    searchCookie.setMaxAge(24 * 60 * 60);
    searchCookie.setHttpOnly(true);
    searchCookie.setPath("/");
    response.addHttpCookie(searchCookie);
    // TODO: When the compatibilty mode is at least 21.12, uncomment the normalization line
    // var sluggedCategoryId = categoryId ? categoryId.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : null;
    var sluggedCategoryId = categoryId ? categoryId.toLowerCase() : null;

    var listingsAuctionPayload = {
        type: "listings",
        slots: slots,
        products: { ids: productIDs },
        opaqueUserId: tsuidValue
    };

    const isCategorySearch = categoryId && sluggedCategoryId;
    const isSearchSearch = searchQuery && !isCategorySearch;

    var listingsAuctionOptionalParams = {
        searchQuery: searchQuery,
        category: categoryId && sluggedCategoryId ? { id: sluggedCategoryId } : null
    };
    var listingsAuction = topsortHelpers.createListingsAuction(listingsAuctionPayload, listingsAuctionOptionalParams);

    var userAgent = request.httpUserAgent || "";
    var isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    var device = isMobile ? "mobile" : "desktop";

    var auctionsUnfiltered = collections.map(topsortConfig, function (config) {
        if (config.type === "category" && !isCategorySearch) return null;
        if (config.type === "search" && !isSearchSearch) return null;

        var auction = {
            type: "banners",
            slots: config.slots,
            slotId: config.slotId,
            opaqueUserId: tsuidValue,
            device: device
        };

        if (config.type === "search")   auction.searchQuery = searchQuery;
        if (config.type === "category" && sluggedCategoryId) auction.category  = { id: sluggedCategoryId };

        return auction;
    });
    var auctions = collections.filter(new ArrayList(auctionsUnfiltered), function (auction) {
        return Boolean(auction);
    });

    auctions.unshift(listingsAuction);

    var auctionResponse  = TopsortService.runAuction({ auctions: auctions });

    var winners            = [];
    var resp               = null;
    var respResultsArrList = null;

    if (auctionResponse.success) {
        resp = auctionResponse.data;
        if (resp && resp.results) {
            respResultsArrList = new ArrayList(resp.results);
            var listingsResult = collections.find(respResultsArrList, function (r) {
                return r.resultType === "listings";
            });
            winners = listingsResult ? listingsResult.winners || [] : [];

            // Match banner results with their corresponding auctions by index
            // Since the API returns results in the same order as the request
            for (var i = 0; i < auctions.length && i < resp.results.length; i++) {
                var auction = auctions[i];
                var result = resp.results[i];

                if (auction.type === "banners" && result.resultType === "banners" && result.winners && result.winners.length > 0) {
                    var winner = result.winners[0];
                    collections.forEach(topsortConfig, function (cfg) {
                        if (cfg.slotId === auction.slotId) {
                            cfg.winnerUrl = winner.asset && winner.asset[0] ? winner.asset[0].url : null;
                            cfg.resolvedBidId = winner.resolvedBidId;
                            cfg.redirectionUrl = winner.id;
                        }
                    });
                }
            }
        }
    } else {
        Logger.error("Topsort auction failed: {0}", auctionResponse.error);
        return next();
    }

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

    var bannerWinners = {};
    collections.forEach(topsortConfig, function (cfg) {
        if (cfg.winnerUrl) {
            bannerWinners[cfg.slotId] = {
                url: cfg.winnerUrl,
                bidId: cfg.resolvedBidId,
                redirectionUrl: cfg.redirectionUrl
            };
        }
    });
    viewData.bannerWinners = bannerWinners;

    var clientConfig = TopsortService.getClientConfig();
    viewData.topsortApiKey          = clientConfig.apiKey;
    viewData.topsortApiURL          = clientConfig.apiURL;
    viewData.topsortTrackingEnabled = clientConfig.trackingEnabled;
    viewData.tsuid                  = tsuidValue;

    res.setViewData(viewData);
    next();
});

server.append("Show", function (req, res, next) {
    var viewData               = res.getViewData();
    var originalEntries        = viewData.productSearch.productIds || [];
    var originalEntriesArrList = new ArrayList(originalEntries);
    var productIDs             = collections.map(originalEntriesArrList, function (e) {
        return e.productID;
    });
    var searchQuery            = req.querystring.q;
    var slots                  = 6;
    var categoryId             = req.querystring.cgid;

    // â€”â€”â€” UPDATED GUARD â€”â€”â€”
    // Disable sponsored only if the user has selected ANY nonâ€category refinement
    var refinements = viewData.productSearch.refinements || [];
    var filtersApplied = false;

    refinements.forEach(function(refGroup) {
        if (!refGroup.isCategoryRefinement) {
            var values = refGroup.values || [];

            values.forEach(function(val) {
                if (val.selected) {
                    filtersApplied = true;
                }
            });
        }
    });

    if (filtersApplied) {
        res.setViewData(viewData);
        return next();
    }
    // â€”â€”â€” end guard â€”â€”â€”

    var Cookie    = require("dw/web/Cookie");
    var UUIDUtils = require("dw/util/UUIDUtils");

    var tsuid = request.httpCookies["tsuid"];
    if (!tsuid) {
        tsuid = new Cookie("tsuid", UUIDUtils.createUUID());
        tsuid.setMaxAge(365 * 24 * 60 * 60);
        tsuid.setHttpOnly(true);
        tsuid.setPath("/");
        response.addHttpCookie(tsuid);
    }
    var tsuidValue = tsuid.value;

    var searchCookie = new Cookie("topsortLastQuery", encodeURIComponent(searchQuery));
    searchCookie.setMaxAge(24 * 60 * 60);
    searchCookie.setHttpOnly(true);
    searchCookie.setPath("/");
    response.addHttpCookie(searchCookie);
    // TODO: When the compatibilty mode is at least 21.12, uncomment the normalization line
    // var sluggedCategoryId = categoryId ? categoryId.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : null;
    var sluggedCategoryId = categoryId ? categoryId.toLowerCase() : null;

    var listingsAuctionPayload = {
        type: "listings",
        slots: slots,
        products: { ids: productIDs },
        opaqueUserId: tsuidValue
    };

    const isCategorySearch = categoryId && sluggedCategoryId;
    const isSearchSearch = searchQuery && !isCategorySearch;

    var listingsAuctionOptionalParams = {
        searchQuery: searchQuery,
        category: categoryId && sluggedCategoryId ? { id: sluggedCategoryId } : null
    };
    var listingsAuction = topsortHelpers.createListingsAuction(listingsAuctionPayload, listingsAuctionOptionalParams);

    var userAgent = request.httpUserAgent || "";
    var isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    var device = isMobile ? "mobile" : "desktop";

    var auctionsUnfiltered = collections.map(topsortConfig, function (config) {
        if (config.type === "category" && !isCategorySearch) return null;
        if (config.type === "search" && !isSearchSearch) return null;

        var auction = {
            type: "banners",
            slots: config.slots,
            slotId: config.slotId,
            opaqueUserId: tsuidValue,
            device: device
        };

        if (config.type === "search")   auction.searchQuery = searchQuery;
        if (config.type === "category" && sluggedCategoryId) auction.category  = { id: sluggedCategoryId };

        return auction;
    });
    var auctions = collections.filter(new ArrayList(auctionsUnfiltered), function (auction) {
        return Boolean(auction);
    });

    auctions.unshift(listingsAuction);

    var auctionResponse  = TopsortService.runAuction({ auctions: auctions });

    var winners            = [];
    var resp               = null;
    var respResultsArrList = null;

    if (auctionResponse.success) {
        resp = auctionResponse.data;
        if (resp && resp.results) {
            respResultsArrList = new ArrayList(resp.results);
            var listingsResult = collections.find(respResultsArrList, function (r) {
                return r.resultType === "listings";
            });
            winners = listingsResult ? listingsResult.winners || [] : [];

            // Match banner results with their corresponding auctions by index
            // Since the API returns results in the same order as the request
            for (var i = 0; i < auctions.length && i < resp.results.length; i++) {
                var auction = auctions[i];
                var result = resp.results[i];

                if (auction.type === "banners" && result.resultType === "banners" && result.winners && result.winners.length > 0) {
                    var winner = result.winners[0];
                    collections.forEach(topsortConfig, function (cfg) {
                        if (cfg.slotId === auction.slotId) {
                            cfg.winnerUrl = winner.asset && winner.asset[0] ? winner.asset[0].url : null;
                            cfg.resolvedBidId = winner.resolvedBidId;
                            cfg.redirectionUrl = winner.id;
                        }
                    });
                }
            }
        }
    } else {
        Logger.error("Topsort auction failed: {0}", auctionResponse.error);
        return next();
    }

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

    var bannerWinners = {};
    collections.forEach(topsortConfig, function (cfg) {
        if (cfg.winnerUrl) {
            bannerWinners[cfg.slotId] = {
                url: cfg.winnerUrl,
                bidId: cfg.resolvedBidId,
                redirectionUrl: cfg.redirectionUrl
            };
        }
    });
    viewData.bannerWinners = bannerWinners;

    var clientConfig = TopsortService.getClientConfig();
    viewData.topsortApiKey          = clientConfig.apiKey;
    viewData.topsortApiURL          = clientConfig.apiURL;
    viewData.topsortTrackingEnabled = clientConfig.trackingEnabled;
    viewData.tsuid                  = tsuidValue;

    res.setViewData(viewData);
    next();
});


module.exports = server.exports();
