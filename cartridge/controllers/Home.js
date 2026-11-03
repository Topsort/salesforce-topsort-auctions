"use strict";

var server = require("server");
var Logger = require("dw/system/Logger").getLogger("SponsoredSearch");
var Resource = require("dw/web/Resource");
var URLUtils = require("dw/web/URLUtils");
var TopsortService = require("*/cartridge/scripts/services/TopsortService");

server.extend(module.superModule);

/**
 * Builds the URL the home banner script is loaded from, carrying its configuration.
 *
 * HITES edits the home page as plain HTML in content slots, so there is no template of ours
 * to render configuration into. It rides on the script's own query string instead, which
 * topsort-home-banners.js reads back from document.currentScript. Nothing in it is
 * per-shopper, so it is safe inside the cached home page.
 *
 * The URL has to be absolute: assets.addJs only keeps a URL as given when it contains "//",
 * and banners.js passes window.TS.url to new URL(), which throws on a relative one.
 *
 * @returns {string} Absolute URL of topsort-home-banners.js with its configuration
 */
function getHomeBannersScriptUrl() {
    var config = TopsortService.getConfig();
    // Banners without tracking would show advertisers creatives nobody is billed for, so the
    // home slots only run when all three switches are on.
    var enabled = config.enabled && config.bannersEnabled && config.trackingEnabled;

    var params = {
        enabled: enabled ? "1" : "0",
        // banners.js and analytics.js append "/v2/auctions" and "/v2/events" to this, which
        // lands in the path query parameter Topsort-BannersApi dispatches on.
        api: URLUtils.https("Topsort-BannersApi").toString() + "?path=",
        analytics: URLUtils.httpsStatic("/lib/topsort/analytics-2.12.1.iife.js").toString(),
        banners: URLUtils.httpsStatic("/lib/topsort/banners-0.12.0.iife.js").toString(),
        label: Resource.msg("label.sponsored", "topsort", null),
        alt: Resource.msg("label.banner.alt", "topsort", null)
    };

    return URLUtils.httpsStatic("/js/topsort-home-banners.js").toString() + "?"
        + Object.keys(params).map(function (key) {
            return key + "=" + encodeURIComponent(params[key]);
        }).join("&");
}

/**
 * Home-Show : Loads banners.js for the sponsored home slots.
 *
 * The slots themselves are placeholders HITES pastes into the home content slots. The script
 * is added whether or not banners are enabled, because it is also what removes those
 * placeholders when they are off - otherwise a disabled slot is a blank carousel slide.
 *
 * Only scripts and styles are added, so the home page keeps its cache behaviour.
 */
server.append("Show", function (req, res, next) {
    try {
        var assets = require("*/cartridge/scripts/assets");
        assets.addCss("/css/topsort-sponsored.css");
        assets.addJs(getHomeBannersScriptUrl());
    } catch (e) {
        // The home page must render even if this does; the placeholders then stay empty.
        Logger.error("Topsort home banners could not be added to Home-Show: {0}", e.message);
    }

    return next();
});

module.exports = server.exports();
