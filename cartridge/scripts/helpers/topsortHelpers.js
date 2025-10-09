"use strict"; 

var collections = require("*/cartridge/scripts/util/collections");

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
* Extracts and returns the list of banner winners from the Topsort auction response,
* and sets the URL and bid ID of the first winner in the provided bannerWinnerContent object.
*
* @param {ArrayList} respResults - The Topsort auction response object containing results.
* @returns {Object} - An array of banner winner objects, or an empty array if none found.
*/
function getBannerWinnerContent(respResults) {
    var bannerWinnerContent = {
        url: null,
        bidId: null,
        redirectionUrl: null
    };

    var banners = respResults ? collections.filter(respResults, function (r) {
        return r.resultType === "banners";
    }) : [];
    var bannerWinners = banners[0] && banners[0].winners ? banners[0].winners : [];

    if (bannerWinners.length) {
        bannerWinnerContent.url   = bannerWinners[0].asset[0].url;
        bannerWinnerContent.bidId = bannerWinners[0].resolvedBidId;
        bannerWinnerContent.redirectionUrl = bannerWinners[0].url;
        bannerWinnerContent.id = bannerWinners[0].id;
    }

    return bannerWinnerContent;
}

module.exports = {
    createListingsAuction: createListingsAuction,
    placeTheSponsoredProducts: placeTheSponsoredProducts,
    getBannerWinnerContent: getBannerWinnerContent,
    assignObject: assignObject
};
