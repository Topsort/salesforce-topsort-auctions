'use strict';

/* global request, response, empty, dw */

var Template = require('dw/util/Template');
var HashMap = require('dw/util/HashMap');
var PageRenderHelper = require('*/cartridge/experience/utilities/PageRenderHelper.js');
var QueryString = require('server').querystring;
var gtmHelper = require('*/cartridge/scripts/gtm');

var topsortAuctions = require('*/cartridge/scripts/helpers/topsortAuctions');

var PRODUCT_LIST_TEMPLATE = 'experience/components/dynamic/productList/productList.isml';

/**
 * Render logic for the product list component.
 *
 * This cartridge overrides the storefront component so that category listing pages, which
 * are rendered by Page Designer rather than by the Search controller, also get Topsort
 * sponsored products and banners. Everything above the Topsort section mirrors the
 * storefront implementation and should be kept in sync with it.
 *
 * @param {dw.experience.ComponentScriptContext} context The Component script context object.
 * @param {dw.util.Map} [modelIn] Additional model values created by another cartridge. This will not be passed in by Commerce Cloud Platform.
 *
 * @returns {string} The markup to be displayed
 */
module.exports.render = function (context, modelIn) {
    var CatalogMgr = require('dw/catalog/CatalogMgr');
    var searchHelper = require('*/cartridge/scripts/helpers/searchHelpers');
    var Resource = require('dw/web/Resource');
    var URLUtils = require('dw/web/URLUtils');
    var productHelper = require('*/cartridge/scripts/helpers/productHelpers');
    var CustomObjectMgr = require('dw/object/CustomObjectMgr');
    var pixelModel = require('*/cartridge/models/pixel/pixel');
    var productBrandCategory = dw.system.Site.getCurrent().getCustomPreferenceValue('productBrandCategory');
    var brandsCategoryMetaDescription = dw.system.Site.getCurrent().getCustomPreferenceValue('brandsCategoryMetaDescription');
    var brandsCategoryMetaTitle = dw.system.Site.getCurrent().getCustomPreferenceValue('brandsCategoryMetaTitle');
    var model = modelIn || new HashMap();

    var component = context.component;
    model.component = component;
    model.regions = PageRenderHelper.getRegionModelRegistry(component);
    var content = context.content;
    model.categoryId = content.category.getID();

    var params = { cgid: model.categoryId }; // Default search, if there is no other params

    if (request.httpParameterMap.get('params')) { // Search params in querystring and add it to params variable
        var objParams = JSON.parse(request.httpParameterMap.get('params').toString());

        if (objParams.hasOwnProperty('custom')) {
            var customObjParams = JSON.parse(objParams.custom.toString());

            var queryStringObj = typeof (customObjParams.queryString) === 'string'
                ? new QueryString(customObjParams.queryString || '')
                : customObjParams.queryString;

            if (Object.keys(customObjParams.queryString).length) {
                params = queryStringObj;
            }
        }
    }

    if (!params.srule) {
        params.srule = '';
    }
    var result = searchHelper.searchPD(params); // Search Products

    model.productSearch = result.productSearch;
    model.apiProductSearch = result.apiProductSearch;
    model.maxSlots = result.maxSlots;
    model.refineurl = result.refineurl;
    model.canonicalUrl = result.canonicalUrl;
    model.category = result.category;

    // Calculate Pagination
    var pageSizeSelector = [];
    var defaultURL = model.productSearch.productSearch.url('Search-Show');
    var pageSize = model.productSearch.pageSize;
    var currentPage = model.productSearch.pageNumber;
    var nextPage = pageSize * (currentPage + 1);
    var previousPage = currentPage > 1 ? pageSize * (currentPage - 1) : 0;
    var startCount = (nextPage - pageSize) + 1;
    var totalCount = model.productSearch.count;
    var finishCount = nextPage > totalCount ? totalCount : nextPage;
    var maxPage = Math.ceil(totalCount / pageSize);
    var sortOptions = model.productSearch.productSort.options;
    var breadcrumbs = [{ htmlValue: Resource.msg('label.breadcrumbs.ini', 'search', null), url: URLUtils.url('Home-Show') }];
    var contentSearch = searchHelper.setupContentSearch(params);
    model.pixel = pixelModel(model.productSearch, 'Search');

    for (var i = 12; i <= 48; i += 12) {
        var pageSizeURL = model.productSearch.productSearch.url('Search-Show');
        pageSizeSelector.push({
            htmlValue: i,
            selected: pageSize == i,
            url: pageSizeURL.append('start', '0').append('sz', i).toString().replace(/%2C/g, '')
        });
    }

    // Calculate breadcrumbs and url for brands
    if (model.productSearch.isCategorySearch) { // This should be always true because PLP pages are assigned to categories
        var category = CatalogMgr.getCategory(params.cgid);

        breadcrumbs = breadcrumbs.concat(productHelper.getAllBreadcrumbs(params.cgid, null, []).reverse());
        model.parentCategoryName = category && category.parent ? category.parent.displayName : '';
        model.schemaData = [];

        var resetViewMode = (params.start == null);
        if (resetViewMode) {
            model.defaultViewMode = category.custom.defaultViewMode.value || 'grid';
        }

        // Brands category
        var brandParam = !empty(params.preferences) ? params.preferences.brand : null;
        var productCount = model.productSearch.count;
        var isBrandCategoryPage = !empty(productBrandCategory) ? productBrandCategory === params.cgid : false;

        if (isBrandCategoryPage) {
            searchHelper.brandRedirect(productCount, brandParam);
        }

        model.isBrandCategoryPage = isBrandCategoryPage;
        model.brandParam = !empty(brandParam) ? brandParam : null;
        model.brandsCategoryMetaDescription = !empty(brandParam) && !empty(brandsCategoryMetaDescription) ? dw.util.StringUtils.format(brandsCategoryMetaDescription, brandParam) : null;
        model.brandsCategoryMetaTitle = !empty(brandParam) && !empty(brandsCategoryMetaTitle) ? dw.util.StringUtils.format(brandsCategoryMetaTitle, brandParam) : null;

        // structured data for PD
        model.schemaData = require('*/cartridge/scripts/helpers/structuredDataHelper').getListingPageSchema(model.productSearch.productIds, result.canonicalUrl);

        // Check marketplace category to show image and description
        if (model.category) {
            var marketPlace = CustomObjectMgr.getCustomObject('Marketplace', model.category.ID);
            if (marketPlace) {
                model.marketplace = {
                    name: marketPlace.custom.name,
                    address: marketPlace.custom.address,
                    rut: marketPlace.custom.rut,
                    razonSocial: marketPlace.custom.razonSocial,
                    legalRepresentative: marketPlace.custom.legal_representative,
                    imgUrl: marketPlace.custom.image ? marketPlace.custom.image.absURL : null
                };
            }
        }
    } else {
        breadcrumbs.push({ htmlValue: Resource.msgf('label.breadcrumbs.searchkey', 'search', null, params.q) });
    }

    // Calculate url for sort options
    sortOptions.forEach(function (option) {
        option.url = option.url.replace(/sz=[0-9]+/, 'sz=' + pageSize);
    });

    model.contentSearch = contentSearch;
    model.productSearch.productSort.options = sortOptions;
    model.breadcrumbs = breadcrumbs;
    model.pageSizeSelector = pageSizeSelector;
    model.paging = {
        pageURL: defaultURL.append('sz', pageSize).toString().replace(/%2C/g, ''),
        pageSize: pageSize,
        currentPage: currentPage,
        startCount: maxPage === 0 ? 0 : startCount,
        nextPage: nextPage,
        previousPage: previousPage,
        totalCount: totalCount,
        finishCount: finishCount,
        maxPage: maxPage === 0 ? 1 : maxPage
    };

    model.ga4PLPData = gtmHelper.mountGA4PLP('view_item_list', model.category.ID, model.category.displayName, model.productSearch.productIds);

    // Component Regions
    var gridCol = '4';
    if (content.displayFormat && content.displayFormat.value === 'row') {
        gridCol = '12';
    }

    var hideSidebar = false;
    if (model.productSearch.isCategorySearch && model.category && model.category.custom && model.category.custom.viewMode && (model.category.custom.viewMode == 'grid3NoSidebar' || model.category.custom.viewMode == 'grid4NoSidebar')) {
        hideSidebar = true;
    }
    var grid4 = hideSidebar && model.category.custom.viewMode == 'grid4NoSidebar';
    if (grid4) {
        model.gridClassName = 'region col-6 col-lg-3 px-0 hites-plp-component-wrapper';
    } else {
        model.gridClassName = 'region col-6 col-lg-4 px-0 hites-plp-component-wrapper';
    }
    model.grid4 = grid4;
    model.isEditMode = PageRenderHelper.isInEditMode();

    // instruct 1 hour relative pagecache
    var expires = new Date();
    expires.setHours(expires.getHours() + 1);
    response.setExpires(expires);
    response.setVaryBy('price_promotion');

    // Topsort: category listing pages are always category based, so there is no keyword to
    // bid on and only the category auctions apply. decorate() seeds its own fail-open
    // defaults, so the template renders an ordinary grid whenever Topsort is off or the
    // auction does not come through.
    topsortAuctions.decorate(model, {
        categoryId: model.categoryId,
        userAgent: request.httpHeaders.get('user-agent') || request.httpUserAgent,
        columns: grid4 ? 4 : 3
    });

    return new Template(PRODUCT_LIST_TEMPLATE).render(model).text;
};
