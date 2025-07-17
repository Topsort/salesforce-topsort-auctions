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
    const searchQuery     = req.querystring.q;
    const slots           = 6;
    const categoryId      = req.querystring.cgid;


    // ——— UPDATED GUARD ———
    // Disable sponsored only if the user has selected ANY non‐category refinement
    const filtersApplied = (viewData.productSearch.refinements || []).some(refGroup => {
        if (refGroup.isCategoryRefinement) {
            return false;
        }
        return (refGroup.values || []).some(val => val.selected);
    });
    if (filtersApplied) {
        res.setViewData(viewData);
        return next();
    }
    // ——— end guard ———


    const Cookie    = require('dw/web/Cookie');
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

    const searchCookie = new Cookie('topsortLastQuery', encodeURIComponent(searchQuery));
    searchCookie.setMaxAge(24 * 60 * 60);
    searchCookie.setHttpOnly(true);
    searchCookie.setPath('/');
    response.addHttpCookie(searchCookie);

    const sluggedCategoryId = categoryId ? categoryId.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : null;

    const listingsAuction = {
        type: 'listings',
        slots: slots,
        products: { ids: productIDs },
        opaqueUserId: tsuidValue
    };
    if (searchQuery)  listingsAuction.searchQuery = searchQuery;
    if (categoryId && sluggedCategoryId)   listingsAuction.category    = { id: sluggedCategoryId };

    const auctions = topsortConfig.map(config => {
        if (config.type === 'category' && !categoryId) return null;
        if (config.type === 'search' && !searchQuery) return null;

        const auction = {
            type: 'banners',
            slots: config.slots,
            slotId: config.slotId,
            opaqueUserId: tsuidValue
        };
        if (config.type === 'search')   auction.searchQuery = searchQuery;
        if (config.type === 'category' && sluggedCategoryId) auction.category    = { id: sluggedCategoryId };
        return auction;
    }).filter(Boolean);

    auctions.unshift(listingsAuction);

    const TopsortService   = require('*/cartridge/scripts/services/TopsortService');
    const auctionResponse  = TopsortService.runAuction({ auctions });

    let winners = [];
    let resp    = null;

    if (auctionResponse.success) {
        resp = auctionResponse.data;
        if (resp && resp.results) {
            const listingsResult = resp.results.find(r => r.resultType === 'listings');
            winners = listingsResult ? listingsResult.winners || [] : [];

            const bannerResults = resp.results.filter(r => r.resultType === 'banners');
            topsortConfig.forEach(cfg => {
                const br = bannerResults.find(r => r.slotId === cfg.slotId);
                if (br) {
                    cfg.winnerUrl     = br.url;
                    cfg.resolvedBidId = br.resolvedBidId;
                }
            });
        }
    } else {
        Logger.error('Topsort auction failed: {0}', auctionResponse.error);
    }

    const sponsoredTop = winners.map(w => {
        const orig = originalEntries.find(e => e.productID === w.id);
        if (orig) {
            return Object.assign({}, orig, {
                isSponsored:   true,
                resolvedBidId: w.resolvedBidId
            });
        }
        return {
            productID:     w.id,
            isSponsored:   true,
            resolvedBidId: w.resolvedBidId
        };
    });

    // HERE: logic to place the winners in the correct positions
    // modify this to place the winners in custom positions

    // Place first 2 winners at positions 0,1
    const firstTwoWinners = sponsoredTop.slice(0, 2);
    const withFirst = firstTwoWinners
        .concat(originalEntries);
    
    // Place next 2 winners at positions 7,8
    const nextTwoWinners = sponsoredTop.slice(2, 4);
    const withMiddle = withFirst.slice(0, 6)
        .concat(nextTwoWinners)
        .concat(withFirst.slice(7));

    // Place last 2 winners at second-to-last and last positions
    const lastTwoWinners = sponsoredTop.slice(4, 6);
    if (lastTwoWinners.length > 0) {
        const withLast = withMiddle.slice(0, -2)
            .concat(lastTwoWinners)
            .concat(withMiddle.slice(-2, withMiddle.length - lastTwoWinners.length));
        viewData.productSearch.productIds = withLast;
    } else {
        viewData.productSearch.productIds = withMiddle;
    }

    const banners       = resp && resp.results ? resp.results.filter(r => r.resultType === 'banners') : [];
    const bannerWinners = banners[0] && banners[0].winners ? banners[0].winners : [];
    if (bannerWinners.length) {
        viewData.featuredContentUrl   = bannerWinners[0].asset[0].url;
        viewData.featuredContentBidId = bannerWinners[0].resolvedBidId;
    } else {
        viewData.featuredContentUrl   = null;
        viewData.featuredContentBidId = null;
    }

    const clientConfig = TopsortService.getClientConfig();
    viewData.topsortApiKey          = clientConfig.apiKey;
    viewData.topsortApiURL          = clientConfig.apiURL;
    viewData.topsortTrackingEnabled = clientConfig.trackingEnabled;
    viewData.tsuid                  = tsuidValue;

    res.setViewData(viewData);
    next();
});

module.exports = server.exports();
