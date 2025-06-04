'use strict';

const server      = require('server');
const superSearch = module.superModule;
const HTTPClient  = require('dw/net/HTTPClient');
const ProductMgr  = require('dw/catalog/ProductMgr');
const Site        = require('dw/system/Site');
const Logger      = require('dw/system/Logger').getLogger('SponsoredSearch');
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
            auction.search = searchQuery;
        }
        
        return auction;
    });
    
    auctions.unshift(listingsAuction);

    const auctionRequest = {
        auctions: auctions
    };

    const client = new HTTPClient();
    let winners = [];
    try {
        const apiUrl = 'https://api.topsort.com/v2/auctions';
        client.open('POST', apiUrl);
        client.setTimeout(5000);
        client.setRequestHeader('Content-Type', 'application/json');
        const apiKey = Site.getCurrent().getCustomPreferenceValue('topsortApiKey');
        if (apiKey) {
            client.setRequestHeader('Authorization', 'Bearer ' + apiKey);
        }
        client.send(JSON.stringify(auctionRequest));

            
        const resp = JSON.parse(client.getText());
        const result = resp.results[0]
        const listingsResult = resp.results.filter(r => r["resultType"] === "listings")[0]
        const bannerResults = resp.results.filter(r => r["resultType"] === "banners")

        topsortConfig.forEach(config => {
            const bannerResult = bannerResults.find(r => r["slotId"] === config.slotId)
            if (bannerResult) {
                config.winnerUrl = bannerResult.url
                config.resolvedBidId = bannerResult.resolvedBidId
            }
        })

        if (result && Array.isArray(result.winners)) {
            winners = result.winners;
        } else if (result && result.error) {
            Logger.error('Topsort returned error: {0}', result.error);
        }

    } catch (e) {
        Logger.error('Error calling Topsort API: {0}', e.message);
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

    const bannerWinnerIds = winners.filter(w => w.type === 'banners').map(w => w.id);

    viewData.bannerUrl = topsortConfig.find(config => config.slotId === 'banner-top-search').url;
    viewData.productSearch.productIds = reordered;
    viewData.topsortApiKey = apiKey;
    viewData.tsuid = tsuidValue;
    res.setViewData(viewData);
    next();
});

module.exports = server.exports();
