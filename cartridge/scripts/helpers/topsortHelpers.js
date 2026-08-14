"use strict";

var DEFAULT_COLUMNS = 4;

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
* Builds the ordered grid entries, giving sponsored products the first two positions, the
* seventh and eighth, and the last two of the page.
*
* Sponsored products take over organic positions instead of being added to them, so the
* number of tiles keeps matching the page size that the paging model reports. A winner
* that was already among the organic results is shown once, in its sponsored position.
*
* @param {Array<Object>} sponsoredTop - Array of sponsored product objects to be placed in prioritized positions.
* @param {Array<Object>} originalEntries - Array of original product entry objects.
* @returns {Array<Object>} - New array with sponsored products placed at specified positions among original entries.
*/
function placeTheSponsoredProducts(sponsoredTop, originalEntries) {
    var totalSlots = originalEntries.length;

    if (!sponsoredTop.length || !totalSlots) {
        return originalEntries;
    }

    // The winners were cloned from the organic entries, so the organic copies have to go:
    // otherwise the product renders twice and both tiles share the same DOM id.
    var isPromoted = {};
    for (var s = 0; s < sponsoredTop.length; s++) {
        if (sponsoredTop[s] && sponsoredTop[s].productID) {
            isPromoted[sponsoredTop[s].productID] = true;
        }
    }

    var organicEntries = [];
    for (var o = 0; o < originalEntries.length; o++) {
        var entry = originalEntries[o];
        if (entry && entry.productID && isPromoted[entry.productID]) {
            continue;
        }
        organicEntries.push(entry);
    }

    // Never let sponsored products take over more than half of a page, which would
    // otherwise happen on pages with very few results.
    var placementLimit  = Math.min(sponsoredTop.length, Math.floor(totalSlots / 2));
    var candidateSlots  = [0, 1, 6, 7, totalSlots - 2, totalSlots - 1];
    var sponsoredBySlot = {};
    var placed          = 0;

    for (var c = 0; c < candidateSlots.length && placed < placementLimit; c++) {
        var slot = candidateSlots[c];
        if (slot < 0 || slot >= totalSlots || sponsoredBySlot[slot] !== undefined) {
            continue;
        }
        sponsoredBySlot[slot] = placed;
        placed++;
    }

    var finalEntries = [];
    var organicIndex = 0;

    for (var i = 0; i < totalSlots; i++) {
        if (sponsoredBySlot[i] !== undefined) {
            finalEntries.push(sponsoredTop[sponsoredBySlot[i]]);
        } else if (organicIndex < organicEntries.length) {
            finalEntries.push(organicEntries[organicIndex]);
            organicIndex++;
        }
    }

    return finalEntries;
}

/**
* Drops the trailing non-sponsored products needed to leave the grid with complete rows.
* Products are removed from the tail rather than at random so that the same request always
* renders the same grid, and sponsored products are never removed.
*
* Only applies when there are more than 10 products, to avoid trimming the results of
* narrow searches such as a PLU lookup.
*
* @param {Array<Object>} products - Array of product objects (sponsored and non-sponsored).
* @param {number} [columns] - Tiles per row the grid is rendering.
* @returns {Array<Object>} - Array whose length is a multiple of the column count.
*/
function normalizeProductsToRows(products, columns) {
    var perRow    = columns > 0 ? columns : DEFAULT_COLUMNS;
    var remainder = products.length % perRow;

    if (remainder === 0 || products.length <= 10) {
        return products;
    }

    var result    = products.slice();
    var remaining = remainder;

    for (var i = result.length - 1; i >= 0 && remaining > 0; i--) {
        if (!result[i].isSponsored) {
            result.splice(i, 1);
            remaining--;
        }
    }

    return result;
}

module.exports = {
    createListingsAuction: createListingsAuction,
    placeTheSponsoredProducts: placeTheSponsoredProducts,
    assignObject: assignObject,
    normalizeProductsToRows: normalizeProductsToRows
};
