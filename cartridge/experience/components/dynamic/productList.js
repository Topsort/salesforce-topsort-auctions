'use strict';

/* global response */

var Template = require('dw/util/Template');
var HashMap = require('dw/util/HashMap');
var PageRenderHelper = require('*/cartridge/experience/utilities/PageRenderHelper.js');
var QueryString = require('server').querystring;
const gtmHelper = require("*/cartridge/scripts/gtm");

var Logger         = require("dw/system/Logger").getLogger("SponsoredSearch");
var topsortHelpers = require("*/cartridge/scripts/helpers/topsortHelpers");
var TopsortService = require("*/cartridge/scripts/services/TopsortService");
var ProductMgr     = require("dw/catalog/ProductMgr");
var collections    = require("*/cartridge/scripts/util/collections");
var ArrayList      = require("dw/util/ArrayList");
var topsortConfig  = new ArrayList(require("*/cartridge/scripts/config/topsort_banners.json"));

/**
 * Render logic for the product list component
 * @param {dw.experience.ComponentScriptContext} context The Component script context object.
 * @param {dw.util.Map} [modelIn] Additional model values created by another cartridge. This will not be passed in by Commerce Cloud Platform.
 *
 * @returns {string} The markup to be displayed
 */
module.exports.render = function (context, modelIn) {
    var CatalogMgr = require('dw/catalog/CatalogMgr');
    var ProductSearchModel = require('dw/catalog/ProductSearchModel');
    var searchHelper = require('*/cartridge/scripts/helpers/searchHelpers');
    var Resource   = require("dw/web/Resource");
    var URLUtils   = require("dw/web/URLUtils");
    var productHelper = require("*/cartridge/scripts/helpers/productHelpers");
    var ProductSearch = require('*/cartridge/models/search/productSearch');
    var CustomObjectMgr  = require("dw/object/CustomObjectMgr");
    var pixelModel       = require("*/cartridge/models/pixel/pixel");
    var productBrandCategory          = dw.system.Site.getCurrent().getCustomPreferenceValue("productBrandCategory");
    var brandsCategoryMetaDescription = dw.system.Site.getCurrent().getCustomPreferenceValue("brandsCategoryMetaDescription");
    var brandsCategoryMetaTitle       = dw.system.Site.getCurrent().getCustomPreferenceValue("brandsCategoryMetaTitle");
    var component, content, params, hasParams, result, productSearch
    var model = modelIn || new HashMap();

    var component = context.component;
    model.component = component;
    model.regions = PageRenderHelper.getRegionModelRegistry(component);
    var content = context.content;
    model.categoryId = content.category.getID();

    var params = { cgid: model.categoryId}; //Default search, if there is no other params


    if(request.httpParameterMap.get("params")) { //Search params in querystring and add it to params variable

        var objParams = JSON.parse(request.httpParameterMap.get("params").toString());
     
        if(objParams.hasOwnProperty('custom') )
        {
            var customObjParams =  JSON.parse(objParams.custom.toString())       
            
            var tipo = typeof(customObjParams.queryString);

            var queryStringObj = typeof(customObjParams.queryString) == "string" ? new QueryString(customObjParams.queryString || '') : customObjParams.queryString;           

            if(Object.keys(customObjParams.queryString).length){         
                params = queryStringObj
            }  
        }
    }

    if(!params.srule){
        params.srule = "";
    }
    var result = searchHelper.searchPD(params); //Search Products

    model.productSearch = result.productSearch;
    model.apiProductSearch = result.apiProductSearch;
    model.maxSlots = result.maxSlots;
    model.refineurl = result.refineurl;
    model.canonicalUrl = result.canonicalUrl;
    model.category = result.category;


    // Calculate Pagination
    var pageSizeSelector = [];
    var defaultURL       = model.productSearch.productSearch.url("Search-Show");
    var pageSize         = model.productSearch.pageSize;
    var currentPage      = model.productSearch.pageNumber;
    var nextPage         = pageSize * (currentPage + 1);
    var previousPage     = currentPage > 1 ? pageSize * (currentPage - 1) : 0;
    var startCount       = (nextPage - pageSize) + 1;
    var totalCount       = model.productSearch.count;
    var finishCount      = nextPage > totalCount ? totalCount : nextPage;
    var maxPage          = Math.ceil(totalCount / pageSize);
    var sortOptions      = model.productSearch.productSort.options;
    var breadcrumbs      = [{ htmlValue: Resource.msg("label.breadcrumbs.ini", "search", null), url: URLUtils.url("Home-Show") }];
    var contentSearch    = searchHelper.setupContentSearch(params);
    model.pixel       = pixelModel(model.productSearch, "Search");

    for (var i = 12; i <= 48; i+= 12) {
        var pageSizeURL = model.productSearch.productSearch.url("Search-Show");
        pageSizeSelector.push({
            htmlValue: i,
            selected: pageSize == i,
            url: pageSizeURL.append("start", "0").append("sz", i).toString().replace(/%2C/g, "")
        });
    }

    // Calculate breadcrumbs and url for brands
    if (model.productSearch.isCategorySearch) { //This should be always true because PLP pages are assigned to categories
        var category = CatalogMgr.getCategory(params.cgid);

        breadcrumbs = breadcrumbs.concat(productHelper.getAllBreadcrumbs(params.cgid, null, []).reverse());
        model.parentCategoryName = category && category.parent ? category.parent.displayName : "";
        model.schemaData = [];

        var resetViewMode = (params.start == null);
        if (resetViewMode) {
            model.defaultViewMode = category.custom.defaultViewMode.value || "grid";
        }

        // Brands category
        var brandParam                    = !empty(params.preferences) ? params.preferences.brand : null;
        var productCount                  = model.productSearch.count;
        var isBrandCategoryPage           = !empty(productBrandCategory) ? productBrandCategory === params.cgid : false;

        if (isBrandCategoryPage) {
            searchHelper.brandRedirect(productCount, brandParam);
        }

        model.isBrandCategoryPage           = isBrandCategoryPage;
        model.brandParam                    = !empty(brandParam) ? brandParam : null;
        model.brandsCategoryMetaDescription = !empty(brandParam) && !empty(brandsCategoryMetaDescription) ? dw.util.StringUtils.format(brandsCategoryMetaDescription, brandParam) : null;
        model.brandsCategoryMetaTitle       = !empty(brandParam) && !empty(brandsCategoryMetaTitle) ? dw.util.StringUtils.format(brandsCategoryMetaTitle, brandParam) : null;

        //structured data for PD
        var schema = require("*/cartridge/scripts/helpers/structuredDataHelper").getListingPageSchema(model.productSearch.productIds, result.canonicalUrl);
        model.schemaData = schema;

        //Check marketplace category to show image and description
        if(model.category){
            var marketPlace = CustomObjectMgr.getCustomObject("Marketplace", model.category.ID);
            if(marketPlace){
                let data = {
                    name: marketPlace.custom.name,
                    address: marketPlace.custom.address,
                    rut: marketPlace.custom.rut,
                    razonSocial: marketPlace.custom.razonSocial,
                    legalRepresentative: marketPlace.custom.legal_representative,
                    imgUrl: marketPlace.custom.image ? marketPlace.custom.image.absURL : null
                }
                model.marketplace = data;
            }
        }
    } else {
        breadcrumbs.push({ htmlValue: Resource.msgf("label.breadcrumbs.searchkey", "search", null, params.q)});
    }

    //Calculate url for sort options
    sortOptions.forEach(function (option) {
        option.url = option.url.replace(/sz=[0-9]+/, "sz=" + pageSize);
    });

    model.contentSearch = contentSearch;
    model.productSearch.productSort.options = sortOptions;
    model.breadcrumbs = breadcrumbs;
    model.pageSizeSelector = pageSizeSelector;
    model.paging = {
        pageURL: defaultURL.append("sz", pageSize).toString().replace(/%2C/g, ""),
        pageSize: pageSize,
        currentPage: currentPage,
        startCount: maxPage === 0 ? 0 : startCount,
        nextPage: nextPage,
        previousPage: previousPage,
        totalCount: totalCount,
        finishCount: finishCount,
        maxPage: maxPage === 0 ? 1 : maxPage
    };

    model.ga4PLPData = gtmHelper.mountGA4PLP("view_item_list", model.category.ID, model.category.displayName, model.productSearch.productIds);
    // Component Regions
    var gridCol = '4';
    if (content.displayFormat && content.displayFormat.value === 'row') {
        gridCol = '12';
    }

    var hideSidebar = false;
    if(model.productSearch.isCategorySearch && model.category && model.category.custom && model.category.custom.viewMode && (model.category.custom.viewMode == "grid3NoSidebar" || model.category.custom.viewMode == "grid4NoSidebar")){
        hideSidebar = true;
    }
    var grid4 = hideSidebar && model.category.custom.viewMode == "grid4NoSidebar";
    // model.gridClassName = 'region col-6 col-lg-4 px-0';
    if(grid4){
        model.gridClassName = 'region col-6 col-lg-3 px-0 hites-plp-component-wrapper';
    }
    else {
        model.gridClassName = 'region col-6 col-lg-4 px-0 hites-plp-component-wrapper';
    }
    model.isEditMode = PageRenderHelper.isInEditMode();

    // instruct 1 hour relative pagecache
    var expires = new Date();
    expires.setHours(expires.getHours() + 1);
    response.setExpires(expires);
    response.setVaryBy('price_promotion');


    ///TOPSORT LOGIC
    var viewData               = model;
    var originalEntries        = viewData.productSearch.productIds || [];
    var originalEntriesArrList = new ArrayList(originalEntries);
    var productIDs             = collections.map(originalEntriesArrList, function (e) {
        return e.productID;
    });
    var searchQuery            = null; //Search query is not needed for category pages, and PLP should be category based
    var slots                  = 6;
    var categoryId             = model.categoryId;

    // Fail-open defaults so the rendered template never breaks if Topsort is disabled,
    // an auction fails, or the refinement guard short-circuits before winners/config are set.
    model.bannerWinners          = model.bannerWinners || {};
    model.topsortTrackingEnabled = model.topsortTrackingEnabled || false;
    model.topsortCategoryId      = categoryId || "";

    // Disable sponsored only if the user has selected ANY non-category refinement
    var refinements = viewData.productSearch.refinements || [];
    var filtersApplied = false;

    collections.forEach(new ArrayList(refinements), function(refGroup) {
        if (!refGroup.isCategoryRefinement) {
            var values = refGroup.values || [];

            collections.forEach(new ArrayList(values), function(val) {
                if (val.selected) {
                    filtersApplied = true;
                }
            });
        }
    });

    if (filtersApplied) {
        return new Template('experience/components/dynamic/productList/productList.isml').render(model).text;
    }

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

    // TODO: When the compatibilty mode is at least 21.12, uncomment the normalization line
    // var sluggedCategoryId = categoryId ? categoryId.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : null;
    var sluggedCategoryId = categoryId ? categoryId.toLowerCase() : null;

    var listingsAuctionPayload = {
        type: "listings",
        slots: slots,
        products: { ids: productIDs },
        opaqueUserId: tsuidValue
    };

    var isCategorySearch = categoryId && sluggedCategoryId;
    var isSearchSearch = searchQuery && !isCategorySearch;

    var listingsAuctionOptionalParams = {
        searchQuery: searchQuery,
        category: categoryId && sluggedCategoryId ? { id: sluggedCategoryId } : null
    };

    var listingsAuction = topsortHelpers.createListingsAuction(listingsAuctionPayload, listingsAuctionOptionalParams);

    var userAgent = request.httpHeaders.get("user-agent") || request.httpUserAgent || "";
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
        return new Template('experience/components/dynamic/productList/productList.isml').render(model).text;
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
    model.productSearch.productIds = topsortHelpers.normalizeProductsToRowsOfFour(productsWithSponsored);
    
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

    model.bannerWinners = bannerWinners;

    var clientConfig = TopsortService.getClientConfig();
    model.topsortApiKey          = clientConfig.apiKey;
    model.topsortApiURL          = clientConfig.apiURL;
    model.topsortTrackingEnabled = clientConfig.trackingEnabled;
    model.tsuid                  = tsuidValue;    
    ///END TOPSORT LOGIC


    return new Template('experience/components/dynamic/productList/productList.isml').render(model).text;
};
