"use strict";

var server          = require("server");
var superSearch     = module.superModule;
var topsortAuctions = require("*/cartridge/scripts/helpers/topsortAuctions");

server.extend(superSearch);

// Search results render three tiles per row on desktop (col-lg-4).
var SEARCH_GRID_COLUMNS = 3;

/**
 * Appends Topsort auction results to the search view data, so that the grid can show
 * sponsored products and the banner slots can show their winners.
 *
 * @param {Object} req - The request object containing query parameters.
 * @param {Object} res - The response object used to modify view data.
 * @param {Function} next - The next middleware function in the chain.
 */
function appendAuctionResults(req, res, next) {
    var viewData = res.getViewData();

    // Category listing pages are delegated to Page Designer, which returns from the
    // route before a productSearch exists. The productList component runs the auction in
    // that flow, so there is nothing to append here.
    if (!viewData || !viewData.productSearch || !viewData.productSearch.productIds) {
        return next();
    }

    topsortAuctions.decorate(viewData, {
        searchQuery: req.querystring.q,
        categoryId: req.querystring.cgid,
        userAgent: req.httpHeaders.get("user-agent") || req.httpUserAgent,
        columns: SEARCH_GRID_COLUMNS
    });

    res.setViewData(viewData);
    return next();
}

server.append("Show", appendAuctionResults);
server.append("UpdateGrid", appendAuctionResults);

// Storefronts differ in which route serves a refined grid, so cover the AJAX variant too
// when the base controller provides it.
if (server.routes && server.routes.ShowAjax) {
    server.append("ShowAjax", appendAuctionResults);
}

module.exports = server.exports();
