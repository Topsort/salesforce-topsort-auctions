'use strict';

const server         = require('server');
const superSearch    = module.superModule;
const HTTPClient     = require('dw/net/HTTPClient');
const ProductMgr     = require('dw/catalog/ProductMgr');
const Site           = require('dw/system/Site');
const Logger         = require('dw/system/Logger').getLogger('SponsoredSearch');
const topsortConfig  = require('*/cartridge/scripts/config/topsort_banners.json');

server.extend(superSearch);

// biome-ignore lint/complexity/useArrowFunction: <explanation>
server.append('Show', function (req, res, next) {
    const viewData        = res.getViewData();
    const originalEntries = viewData.productSearch.productIds || [];
    const productIDs      = originalEntries.map(e => e.productID);
    const searchQuery     = req.querystring.q || '';
    const slots           = productIDs.length;
    const categoryId      = req.querystring.cgid || '';

    const Cookie = require('dw/web/Cookie');
    const UUIDUtils = require('dw/util/UUIDUtils');

    let tsuid = request.httpCookies['tsuid'];
    if (!tsuid) {
        tsuid = new Cookie('tsuid', UUIDUtils.createUUID());
        tsuid.setMaxAge(365 * 24 * 60 * 60);
        tsuid.setHttpOnly(true);
        tsuid.setPath('/');
        response.addHttpCookie(tsuid);
    }
    const tsuidValue = tsuid.value;

    const searchCookie = new Cookie('topsortLastQuery', encodeURIComponent(req.querystring.q || ''));
    searchCookie.setMaxAge(24 * 60 * 60);       // 1 day
    searchCookie.setHttpOnly(true);
    searchCookie.setPath('/');

    response.addHttpCookie(searchCookie);

    const listingsAuction = {
        type: 'listings',
        slots: slots,
        products: { ids: productIDs },
    }

    if (searchQuery) {
        listingsAuction.searchQuery = searchQuery;
    }
    if (categoryId) {
        listingsAuction.category = {id: categoryId};
    }
    const auctions = topsortConfig.map(config => {
        const auction = {
            type: 'banners',
            slots: config.slots,
            slotId: config.slotId
        };

        if (config.type === 'search') {
            auction.searchQuery = searchQuery;
        }

        if (config.type === 'category') {
            auction.category = {id: categoryId};
        }

        return auction;
    });

    auctions.unshift(listingsAuction);

    const auctionRequest = {
        auctions: auctions
    };

    // Use TopsortService for centralized API calls
    const TopsortService = require('*/cartridge/scripts/services/TopsortService');
    const auctionResponse = TopsortService.runAuction(auctionRequest);

    let winners = [];
    let resp = null;

    if (auctionResponse.success) {
        resp = auctionResponse.data;

        if (resp && resp.results) {
            const listingsResult = resp.results.find(result => result.resultType === 'listings');
            if (listingsResult) {
                winners = listingsResult.winners || [];
            }

            // Handle banner results
            const bannerResults = resp.results.filter(result => result.resultType === 'banners');
            topsortConfig.forEach(config => {
                const bannerResult = bannerResults.find(result => result.slotId === config.slotId);
                if (bannerResult) {
                    config.winnerUrl = bannerResult.url;
                    config.resolvedBidId = bannerResult.resolvedBidId;
                }
            });
        }
    } else {
        Logger.error('Topsort auction failed: {0}', auctionResponse.error);
    }

    const entryMap = {};
    originalEntries.forEach(e => { entryMap[e.productID] = e; });

    const reordered = [];

    winners.forEach(w => {
        const id = w.id;
        const bidId = w.resolvedBidId;
        if (entryMap[id]) {
            const entry = entryMap[id];
            entry.isSponsored   = true;
            entry.resolvedBidId = bidId;
            reordered.push(entry);
        } else {
            reordered.push({
                productID:    id,
                isSponsored:  true,
                resolvedBidId: bidId
            });
        }
    });

    const winnerIds = winners.map(w => w.id);
    originalEntries.forEach(entry => {
        if (winnerIds.indexOf(entry.productID) < 0) {
            entry.isSponsored = false;
            reordered.push(entry);
        }
    });

    const banners = resp.results.filter(w => w.resultType === 'banners');
    const bannerWinners = banners[0] && banners[0]["winners"] ? banners[0]["winners"] : [];

    if (bannerWinners.length > 0) {
        viewData.featuredContentUrl = bannerWinners[0]["asset"][0]["url"];
        viewData.featuredContentBidId = bannerWinners[0]["resolvedBidId"];
    } else {
        viewData.featuredContentUrl = null;
        viewData.featuredContentBidId = null;
    }
    viewData.productSearch.productIds = reordered;

    // Get client configuration from TopsortService
    const clientConfig = TopsortService.getClientConfig();
    viewData.topsortApiKey = clientConfig.apiKey;
    viewData.topsortApiURL = clientConfig.apiURL;
    viewData.topsortTrackingEnabled = clientConfig.trackingEnabled;
    viewData.tsuid = tsuidValue;
    res.setViewData(viewData);
    next();
});

module.exports = server.exports();
