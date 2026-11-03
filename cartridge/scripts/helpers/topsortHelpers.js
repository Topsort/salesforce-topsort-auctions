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
* Serialises a value as JSON that is safe to emit inside an inline script element.
*
* JSON.stringify escapes quotes and backslashes but leaves "<" and ">" untouched, so a value
* carrying "</script>" closes the block early and the rest of it is parsed as markup. The grid
* templates print these payloads with encoding="off", and they carry request data (the search
* term and the category id) as well as the auction response, so escaping has to happen here.
*
* The characters are emitted as JSON unicode escapes rather than removed: they parse back to
* the original string, so the value that reaches Topsort is unchanged. U+2028 and U+2029 are
* included because they are valid inside a JSON string but terminate a JavaScript line.
*
* @param {Object} value - The value to serialise.
* @returns {string} JSON safe to print with encoding="off" inside a script element.
*/
function toScriptJson(value) {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
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
* The first two sponsored products go to positions 0 and 1, the next two to positions 6 and 7,
* and the remaining two to the end of the grid. Sponsored products that also appear in the
* organic results are moved rather than duplicated, so a grid whose winners all came from the
* organic result set keeps exactly the same products it started with.
*
* This function never discards an organic entry. Dropping search results to make room for ads
* would hide products from the shopper entirely: productIds holds a single page of results and
* the surrounding pagination is computed from the unmodified result count, so anything removed
* here is not pushed onto the next page, it just disappears from browsing.
*
* @param {Array<Object>} sponsoredTop - Array of sponsored product objects to be placed in prioritized positions.
* @param {Array<Object>} originalEntries - Array of original product entry objects.
* @returns {Array<Object>} - New array with sponsored products placed at specified positions among original entries.
*/
function placeTheSponsoredProducts(sponsoredTop, originalEntries) {
    // HERE: logic to place the winners in the correct positions
    // modify this to place the winners in custom positions

    // A winning product cloned into sponsoredTop may also still be present in the
    // organic results. Drop the organic occurrence so each sponsored product is shown
    // once (in its sponsored slot) instead of being duplicated in the grid.
    var sponsoredIds = {};
    for (var s = 0; s < sponsoredTop.length; s++) {
        if (sponsoredTop[s] && sponsoredTop[s].productID) {
            sponsoredIds[sponsoredTop[s].productID] = true;
        }
    }
    var organicEntries = [];
    for (var e = 0; e < originalEntries.length; e++) {
        var entry = originalEntries[e];
        if (entry && entry.productID && sponsoredIds[entry.productID]) {
            continue;
        }
        organicEntries.push(entry);
    }

    // Place first 2 winners at positions 0,1
    var entries = sponsoredTop.slice(0, 2).concat(organicEntries);

    // Place next 2 winners at positions 6,7, keeping the organic entries they displace
    var nextTwoWinners = sponsoredTop.slice(2, 4);
    if (nextTwoWinners.length > 0) {
        entries = entries.slice(0, 6)
            .concat(nextTwoWinners)
            .concat(entries.slice(6));
    }

    // Place the remaining winners at the end of the grid
    return entries.concat(sponsoredTop.slice(4, 6));
}

/**
 * Normalizes an SFCC category ID into the form the Topsort catalog uses.
 *
 * Returns null for an empty id so callers can treat it as "not a category search".
 *
 * HITES SFCC category IDs use underscores (`sweater_mujer`) while the Topsort catalog
 * uses hyphens (`sweater-mujer`). Bid retrieval is exact, so listings auctions that
 * send the SFCC id retrieve zero category-triggered bids. Categories that already have
 * no underscores (`camas`, `smartphone`) are unchanged.
 *
 * Accent stripping is deliberately left out: it would change which categories match on
 * the Topsort side, and `String.prototype.normalize` is not available below compatibility
 * mode 21.12. When that floor is raised, lowercase, underscore replacement, and accent
 * stripping should happen together here rather than at the call sites.
 *
 * @param {string} categoryId - The catalog category ID from SFCC.
 * @returns {string|null} - The normalized category ID, or null if none was given.
 */
function resolveTopsortCategoryId(categoryId) {
    // TODO: When the compatibility mode is at least 21.12, also strip accents:
    // return categoryId.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/_/g, "-");
    return categoryId ? categoryId.toLowerCase().replace(/_/g, "-") : null;
}

/**
 * Derives the device type from the request user agent.
 *
 * Resolved server-side rather than trusted from the browser: the events relay reports this
 * value to Topsort, and banner auctions use it to pick which slots may run at all, so a
 * spoofed value would both misreport device mix and let a mobile client bid on a slot the
 * storefront never renders there.
 *
 * @returns {string} Either "mobile" or "desktop"
 */
function getDeviceType() {
    var userAgent = request.httpUserAgent || "";
    return /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(userAgent) ? "mobile" : "desktop";
}

/**
 * Reports whether this request falls inside the configured auction traffic share.
 *
 * @param {number} percent - Configured share from 0 to 100
 * @returns {boolean} True when the auction may run
 */
function isInAuctionTrafficSample(percent) {
    if (percent === null || percent === undefined) {
        return true;
    }

    var share = Number(percent);
    if (isNaN(share) || share >= 100) {
        return true;
    }
    if (share <= 0) {
        return false;
    }
    return (Math.random() * 100) < share;
}

module.exports = {
    createListingsAuction: createListingsAuction,
    placeTheSponsoredProducts: placeTheSponsoredProducts,
    assignObject: assignObject,
    toScriptJson: toScriptJson,
    resolveTopsortCategoryId: resolveTopsortCategoryId,
    getDeviceType: getDeviceType,
    isInAuctionTrafficSample: isInAuctionTrafficSample
};
