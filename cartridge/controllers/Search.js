"use strict";

var server = require("server");
var Logger = require("dw/system/Logger").getLogger("SponsoredSearch");
var superSearch = module.superModule;
var topsortHelpers = require("*/cartridge/scripts/helpers/topsortHelpers");
var topsortListings = require("*/cartridge/scripts/helpers/topsortListings");

server.extend(superSearch);

/**
 * Runs a listings auction and merges winners into search view data.
 * Fail-open: when Topsort is disabled or the API fails, the organic grid is left intact.
 *
 * @param {Object} req - The request object containing query parameters.
 * @param {Object} res - The response object used to modify view data.
 */
function applyListingsAuction(req, res) {
    var viewData = res.getViewData();
    // HITES renders Page Designer category pages via res.page() and returns before
    // productSearch is set. The productList PD component handles Topsort in that case.
    if (!viewData.productSearch) {
        return;
    }

    // Placement context for the tracking calls the grid renders per sponsored tile. The
    // tracking library loads itself from topsort/trackingInit, and the API key is never
    // exposed: the browser reports events through Topsort-Event instead.
    viewData.topsortCategoryId = topsortHelpers.resolveTopsortCategoryId(
        req.querystring && req.querystring.cgid
    ) || "";
    viewData.topsortSearchQuery = (req.querystring && req.querystring.q) || "";

    var auction;
    try {
        auction = topsortListings.applyListingsAuction(viewData.productSearch, {
            categoryId: req.querystring.cgid,
            searchQuery: req.querystring.q
        });
    } catch (e) {
        // The grid is a product listing page first and an ad slot second, so an auction
        // that throws leaves the organic results to render on their own. The response is
        // held back from the cache because it is no longer possible to tell how far the
        // merge got, or whether a tsuid cookie was minted on the way.
        Logger.error("Topsort auction failed for the search grid: {0}", e.message);
        auction = { cacheable: false };
    }

    if (!auction.cacheable) {
        // Sponsored placements and the resolvedBidIds rendered alongside them belong to
        // this one auction, and the tsuid cookie cannot be stored in the page cache.
        // Serving a cached copy of this page would report later shoppers' impressions
        // against these bids, under the first shopper's opaque user id.
        res.cachePeriod = 0; // eslint-disable-line no-param-reassign
    }

    res.setViewData(viewData);
}

server.append("ShowAjax", function (req, res, next) {
    applyListingsAuction(req, res);
    next();
});

server.append("Show", function (req, res, next) {
    applyListingsAuction(req, res);
    next();
});

server.append("UpdateGrid", function (req, res, next) {
    // UpdateGrid serves both the sort control and the "show more" button, and the two need
    // opposite treatment. Sorting asks for start=0 and its response replaces the grid, so
    // without the auction the shopper loses every sponsored product the moment they sort.
    // "Show more" asks for a later start and its response is appended below the tiles
    // already on screen, where a fresh auction would place winners that are very likely to
    // be showing above it already - a second tile with the same tile-<pid> id, double
    // impressions, and a position that restarts at 1 partway down the page.
    if (!req.querystring.start || Number(req.querystring.start) === 0) {
        applyListingsAuction(req, res);
    }

    next();
});

module.exports = server.exports();
