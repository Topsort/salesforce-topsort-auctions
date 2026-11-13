"use strict";

var server = require("server");
var Logger = require("dw/system/Logger").getLogger("SponsoredSearch");

server.extend(module.superModule);

/**
 * Default-Start : Registers the banner stylesheet for the sponsored home slots.
 *
 * The site root does not go through Home-Show: HITES's Default-Start renders home/homePage
 * itself. Without this append the root serves the same home page and the same banners as
 * Home-Show, but without topsort-sponsored.css, so they render unstyled. Same body as the
 * Home-Show append in Home.js; see there for why the stylesheet is registered here and not
 * by the banner fragment.
 */
server.append("Start", function (req, res, next) {
    try {
        require("*/cartridge/scripts/assets").addCss("/css/topsort-sponsored.css");
    } catch (e) {
        // The home page must render even if this does; the banners then render unstyled.
        Logger.error("Topsort banner styles could not be added to Default-Start: {0}", e.message);
    }

    return next();
});

module.exports = server.exports();
