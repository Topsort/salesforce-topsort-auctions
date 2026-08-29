"use strict"; 

/**
* Creates a new auction listing object by merging a required payload with optional parameters.
* Properties from optionalParams will overwrite those in payload if they exist and are not null.
*
* @param {Object} payload - The base object containing required auction listing properties.
* @param {Object} optionalParams - An object containing optional properties to add or override in the listing.
* @returns {Object} A new object representing the auction listing with merged properties.
*/
function createListingsAuction(payload, optionalParams) {
    var listingAuction = {};
    assignObject(listingAuction, payload);
    assignObject(listingAuction, optionalParams);
    return listingAuction;
}

/**
* Assigns all enumerable own properties from the payload object to the target object.
* Only properties that exist directly on the payload (not inherited) are copied.
*
* @param {Object} object - The target object to which properties will be assigned.
* @param {Object} payload - The source object containing properties to assign.
*/
function assignObject(object, payload) {
    if (object && payload) {
        for (var key in payload) {
            if (Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== null) {
                object[key] = payload[key];
            }
        }
    }
}

/**
* Places sponsored products into specific positions within the original product entries array.
*
* The function inserts the first two sponsored products at the beginning (positions 0 and 1),
* the next two at positions 7 and 8, and the last two at the second-to-last and last positions
* of the resulting array. The remaining original entries are preserved in their relative order.
*
* @param {Array<Object>} sponsoredTop - Array of sponsored product objects to be placed in prioritized positions.
* @param {Array<Object>} originalEntries - Array of original product entry objects.
* @returns {Array<Object>} - New array with sponsored products placed at specified positions among original entries.
*/
function placeTheSponsoredProducts(sponsoredTop, originalEntries) {
    // HERE: logic to place the winners in the correct positions
    // modify this to place the winners in custom positions

    // Place first 2 winners at positions 0,1
    var firstTwoWinners = sponsoredTop.slice(0, 2);
    var entriesWithFirstWinners = originalEntries;
    if (firstTwoWinners.length > 0) {
        entriesWithFirstWinners = firstTwoWinners.concat(originalEntries);
    }

    // Place next 2 winners at positions 7,8
    var nextTwoWinners = sponsoredTop.slice(2, 4);
    var entriesWithMiddleWinners = entriesWithFirstWinners;
    if (nextTwoWinners.length > 0) {
        entriesWithMiddleWinners = entriesWithFirstWinners.slice(0, 6)
            .concat(nextTwoWinners)
            .concat(entriesWithFirstWinners.slice(6));
    }

    // Place last 2 winners at second-to-last and last positions
    var lastTwoWinners = sponsoredTop.slice(4, 6);
    var finalEntries = entriesWithMiddleWinners;
    if (lastTwoWinners.length > 0) {
        finalEntries = entriesWithMiddleWinners.slice(0, -2)
            .concat(entriesWithMiddleWinners.slice(-2, entriesWithMiddleWinners.length))
            .concat(lastTwoWinners);
    }

    return finalEntries;
}

/**
* Normalizes the product array to ensure it contains a multiple of 4 products.
* If the count is not divisible by 4, it randomly removes non-sponsored products
* from the last 10 least relevant products to make it divisible by 4.
* Only applies normalization when there are more than 10 products to avoid removing
* results from specific searches (e.g., PLU searches).
*
* @param {Array<Object>} products - Array of product objects (sponsored and non-sponsored).
* @returns {Array<Object>} - Normalized array with product count as a multiple of 4.
*/
function normalizeProductsToRowsOfFour(products) {
    var totalCount = products.length;
    var remainder = totalCount % 4;

    // Don't normalize if already divisible by 4 or if there are 10 or fewer products
    if (remainder === 0 || totalCount <= 10) {
        return products;
    }

    var toRemove = remainder;

    // Find the last 10 non-sponsored products
    var lastNonSponsored = [];
    for (var i = products.length - 1; i >= 0 && lastNonSponsored.length < 10; i--) {
        if (!products[i].isSponsored) {
            lastNonSponsored.push({ index: i, product: products[i] });
        }
    }

    if (lastNonSponsored.length === 0) {
        return products;
    }

    // Randomly select products to remove from the last 10 non-sponsored
    var toRemoveCount = Math.min(toRemove, lastNonSponsored.length);
    var indicesToRemove = [];

    // Shuffle and select random indices
    for (var j = 0; j < toRemoveCount; j++) {
        var randomIndex = Math.floor(Math.random() * lastNonSponsored.length);
        indicesToRemove.push(lastNonSponsored[randomIndex].index);
        lastNonSponsored.splice(randomIndex, 1);
    }

    // Sort indices in descending order to remove from end to start
    indicesToRemove.sort(function(a, b) { return b - a; });

    // Create new array without the removed products
    var result = [];
    for (var k = 0; k < products.length; k++) {
        var shouldRemove = false;
        for (var m = 0; m < indicesToRemove.length; m++) {
            if (k === indicesToRemove[m]) {
                shouldRemove = true;
                break;
            }
        }
        if (!shouldRemove) {
            result.push(products[k]);
        }
    }

    return result;
}

/**
* Builds the banner auctions for the current request.
*
* A slot participates only when its targeting matches the current page (`search` slots need a
* search term, `category` slots need a category) and when its `devices` list includes the current
* device. The side slots are desktop only, so filtering here keeps the request from paying for
* impressions on positions the layout hides below the desktop breakpoint.
*
* @param {Array<Object>} slotConfigs - The slot definitions from topsort_banners.json.
* @param {Object} ctx - Request context.
* @param {string} ctx.device - Either "mobile" or "desktop".
* @param {string} ctx.opaqueUserId - The tsuid cookie value.
* @param {string} [ctx.searchQuery] - The search term, when the page is a search.
* @param {string} [ctx.categoryId] - The normalized category id, when the page is a category.
* @param {boolean} ctx.isCategorySearch - Whether the page is a category listing.
* @param {boolean} ctx.isSearchSearch - Whether the page is a keyword search.
* @returns {Array<Object>} The auction payloads to append to the auctions request.
*/
function buildBannerAuctions(slotConfigs, ctx) {
    var configs = slotConfigs || [];
    var auctions = [];

    for (var i = 0; i < configs.length; i += 1) {
        var config = configs[i];

        if (config.type === "category" && !ctx.isCategorySearch) continue;
        if (config.type === "search" && !ctx.isSearchSearch) continue;
        if (config.devices && config.devices.indexOf(ctx.device) === -1) continue;

        var auction = {
            type: "banners",
            slots: config.slots,
            slotId: config.slotId,
            opaqueUserId: ctx.opaqueUserId,
            device: ctx.device
        };

        if (config.type === "search") {
            auction.searchQuery = ctx.searchQuery;
        }
        if (config.type === "category" && ctx.categoryId) {
            auction.category = { id: ctx.categoryId };
        }

        auctions.push(auction);
    }

    return auctions;
}

/**
* Maps banner auction results back to their slots, keyed by slot id.
*
* Topsort returns the results in the same order as the requested auctions, so the two arrays are
* walked in parallel. The returned object is built fresh on every call: the slot configuration is
* a module level object shared across requests, so writing winners onto it used to leak a losing
* slot's previous winner (and its already consumed resolvedBidId) into later requests.
*
* @param {Array<Object>} auctions - The auctions sent, in request order.
* @param {Array<Object>} results - The `results` array from the auction response.
* @returns {Object} Winners keyed by slot id, each with `url`, `bidId` and `redirectionUrl`.
*/
function collectBannerWinners(auctions, results) {
    var auctionList = auctions || [];
    var resultList = results || [];
    var bannerWinners = {};

    for (var i = 0; i < auctionList.length && i < resultList.length; i += 1) {
        var auction = auctionList[i];
        var result = resultList[i];

        if (!auction || auction.type !== "banners") continue;
        if (!result || result.resultType !== "banners") continue;
        if (!result.winners || !result.winners.length) continue;

        var winner = result.winners[0];
        var asset = winner.asset && winner.asset[0] ? winner.asset[0] : null;

        if (!asset || !asset.url) continue;

        bannerWinners[auction.slotId] = {
            url: asset.url,
            bidId: winner.resolvedBidId,
            redirectionUrl: winner.id
        };
    }

    return bannerWinners;
}

/**
* Determines if Topsort is disabled for a given category based on its custom attribute.
* @param {dw.catalog.Category} category - The category object to check.
* @returns {boolean} True if Topsort is disabled for the category; otherwise, false.
*/
function isTopsortDisabledByCategory(category) {
    return category && category.custom.topsortDisabled || false;
}

/**
* Determines whether the shopper has selected any refinement other than a category one.
* Sponsored results are suppressed in that case, since the shopper has narrowed the
* results in a way the auction has no knowledge of.
*
* @param {Array<Object>} refinements - The refinement groups from the product search model.
* @returns {boolean} True if at least one non-category refinement value is selected.
*/
function hasNonCategoryRefinements(refinements) {
    var refinementGroups = refinements || [];
    var filtersApplied = false;

    refinementGroups.forEach(function (refGroup) {
        if (!refGroup.isCategoryRefinement) {
            var values = refGroup.values || [];

            values.forEach(function (val) {
                if (val.selected) {
                    filtersApplied = true;
                }
            });
        }
    });

    return filtersApplied;
}

module.exports = {
    createListingsAuction: createListingsAuction,
    placeTheSponsoredProducts: placeTheSponsoredProducts,
    buildBannerAuctions: buildBannerAuctions,
    collectBannerWinners: collectBannerWinners,
    assignObject: assignObject,
    normalizeProductsToRowsOfFour: normalizeProductsToRowsOfFour,
    isTopsortDisabledByCategory: isTopsortDisabledByCategory,
    hasNonCategoryRefinements: hasNonCategoryRefinements
};
