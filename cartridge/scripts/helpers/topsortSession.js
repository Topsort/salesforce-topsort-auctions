"use strict";

var Cookie = require("dw/web/Cookie");
var UUIDUtils = require("dw/util/UUIDUtils");
var topsortEventAuth = require("*/cartridge/scripts/helpers/topsortEventAuth");

var COOKIE_NAME = "tsuid";
var COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

// Module state in SFCC lasts one request, so this only ever reports on the request that set
// it. See wasOpaqueUserMinted.
var opaqueUserMinted = false;

/**
 * Issues the tsuid cookie on the current response.
 *
 * SameSite cannot be set from script. dw.web.Cookie has no method for it, and writing the
 * header by hand is not an alternative: the platform rejects it with "Header name Set-Cookie
 * is not allowed to be set or added", which throws on every first visit. The attribute comes
 * from the instance-wide cookie setting in Business Manager instead, so the protection the
 * SameSite attribute was carrying here has to be argued for there rather than in this file.
 *
 * Topsort-Event independently enforces same-origin JSON, CSRF, and a shopper-bound bid proof,
 * so its safety does not depend on this cookie carrying a SameSite attribute.
 *
 * @param {string} value - The opaque user id to store
 */
function issueCookie(value) {
    var cookie = new Cookie(COOKIE_NAME, value);
    cookie.setPath("/");
    cookie.setMaxAge(COOKIE_MAX_AGE);
    cookie.setHttpOnly(true);
    cookie.setSecure(true);
    response.addHttpCookie(cookie);
}

/**
 * Resolves the Topsort opaque user id for the current shopper from the tsuid cookie,
 * creating the cookie when the shopper does not have one yet.
 *
 * Topsort requires the same opaque user id on the auction request and on every event
 * reported against that auction, so this is the only place the id is resolved.
 *
 * The value must never be rendered into a cacheable response: a cached page would hand
 * the first shopper's id to everybody served from that cache entry. Callers that render
 * into a cacheable response must check isNew and disable the page cache, because SFCC
 * does not store Set-Cookie headers in the page cache and the cookie would be lost.
 *
 * @returns {Object} result - Resolved shopper identity
 * @returns {string} result.id - The opaque user id to send to Topsort
 * @returns {boolean} result.isNew - True when the cookie was created on this request
 */
function resolveOpaqueUser() {
    var existing = request.httpCookies[COOKIE_NAME];
    var existingId = existing ? existing.value : null;
    if (existingId) {
        return { id: existingId, isNew: false };
    }

    var id = getSessionOpaqueUserId() || UUIDUtils.createUUID();
    issueCookie(id);
    opaqueUserMinted = true;

    return { id: id, isNew: true };
}

/**
 * Reads the existing Topsort identity without creating one.
 *
 * Remote includes must use this function. Separate includes cannot observe a cookie issued
 * by a sibling response, so minting inside each fragment gives one page several identities.
 * The shared session fallback keeps their auctions and events on one pseudonymous identity
 * until a normal storefront request creates the cookie.
 *
 * @returns {string|null} Existing cookie id or a pseudonymous session fallback
 */
function getOpaqueUserId() {
    var existing = request.httpCookies[COOKIE_NAME];
    if (existing) {
        return existing.value;
    }

    // Remote includes for one page share the SFCC session even though they cannot observe
    // sibling response cookies. Hashing the session id gives every fragment and its event
    // relay the same temporary identity without exposing the storefront session token.
    return getSessionOpaqueUserId();
}

function getSessionOpaqueUserId() {
    return session && session.sessionID
        ? topsortEventAuth.createOpaqueUserId(session.sessionID)
        : null;
}

/**
 * Reports whether the tsuid cookie was created during this request.
 *
 * This is the same fact as the isNew flag on resolveOpaqueUser, for callers that cannot see
 * that result. The Page Designer component decides whether its response may be cached after
 * the grid template has already run the auction, so it has no return value to inspect.
 *
 * It matters because SFCC does not store Set-Cookie headers in the page cache: caching a
 * response that mints the cookie means the shopper never receives it, so the next request
 * mints another one and no opaque user id survives long enough to connect an auction to the
 * events reported against it.
 *
 * @returns {boolean} True when this request issued a new tsuid cookie
 */
function wasOpaqueUserMinted() {
    return opaqueUserMinted;
}

module.exports = {
    getOpaqueUserId: getOpaqueUserId,
    resolveOpaqueUser: resolveOpaqueUser,
    wasOpaqueUserMinted: wasOpaqueUserMinted
};
