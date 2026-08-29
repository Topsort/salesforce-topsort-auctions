"use strict";

var Site      = require("dw/system/Site");

/**
 * Retrieves up to three category levels from the given category in reversed order.
 * The levels are determined by traversing up the category hierarchy.
 *
 * @param {dw.catalog.Category} category - The starting category from which to retrieve the levels.
 * @returns {Object} An object containing up to three category levels:
 *                   - level1: The third level category ID or empty string.
 *                   - level2: The second level category ID or empty string.
 *                   - level3: The first level category ID or empty string.
 */
function getThreeCategoryLevelsInReversed(category) {
    var categoryLevels = {
        level1: "",
        level2: "",
        level3: ""
    };
    var categories = [];

    while (category !== null && categories.length < 3) {
        categories.push(category.ID);
        category = category.parent;
    }

    var totalLevels = categories.length;

    if (totalLevels > 0) categoryLevels.level3 = categories[0];
    if (totalLevels > 1) categoryLevels.level2 = categories[1];
    if (totalLevels > 2) categoryLevels.level1 = categories[2];

    return categoryLevels;
}

/**
* Constructs a feed price object for a given product, containing both regular and sale prices.
*
* @param {dw.catalog.Product} product - The product for which the feed price object is to be generated.
* @returns {Object} An object containing the price and sale_price properties. If the product is not provided, both properties will be empty strings.
* 
* @property {string} price - The regular price of the product, derived from the normal price book. If the product is not found in the price book, this will be an empty string.
* @property {string} sale_price - The lowest price of the product from the specified price books. If no valid price is found, this will be an empty string.
*
* @description
* This function retrieves the current site preferences for different price books and attempts to find the product"s price in each. It sets the regular price from the first price book and the sale price as the lowest price found across all specified price books. If the product is not provided, it returns an object with empty price strings.
*/
function getFeedPriceObject(product) {
    var Constants = require("*/cartridge/scripts/util/Constants");
    var PRICEBOOK_SITE_PREF_IDS = Constants.PRICEBOOK_SITE_PREF_IDS;
    var feedPriceObject = {
        price: "",
        sale_price: ""
    };

    if (!product) {
        return feedPriceObject;
    }

    var currentSite = Site.getCurrent();
    var lowestPrice = Number.MAX_VALUE;

    for (var i = 0; i < PRICEBOOK_SITE_PREF_IDS.length; i++) {
        var price = getPriceFromPriceBook(product, currentSite.getCustomPreferenceValue(PRICEBOOK_SITE_PREF_IDS[i]));

        if (i === 0 && price !== null) {
            // First index points to the normal price
            feedPriceObject.price = price.toString();
        }

        if (price !== null && price < lowestPrice) {
            lowestPrice = price;
        }
    }

    if (lowestPrice !== Number.MAX_VALUE) {
        feedPriceObject.sale_price = lowestPrice.toString();
    }

    return feedPriceObject;
}

/**
 * Retrieves the price of a product from a specified price book.
 *
 * @param {dw.catalog.Product} product - The product for which to retrieve the price.
 * @param {string} priceBookId - The ID of the price book from which to retrieve the price.
 * @returns {Number|null} The price of the product from the specified price book, or null if not available.
 */
function getPriceFromPriceBook(product, priceBookId) {
    if (!product || !priceBookId) {
        return null;
    }
    
    var priceBookPrice = product.priceModel.getPriceBookPrice(priceBookId);
    return priceBookPrice.valueOrNull;
}

module.exports = {
    getThreeCategoryLevelsInReversed: getThreeCategoryLevelsInReversed,
    getFeedPriceObject: getFeedPriceObject
}
