"use strict";

var server = require("server");
var Logger = require("dw/system/Logger").getLogger("SponsoredSearch");

server.extend(module.superModule);

/**
 * Home-Show : Registers the banner stylesheet for the sponsored home slots.
 *
 * The home slots are $include('Topsort-Banner', ...)$ snippets inside the HTML content slots
 * HITES edits in Business Manager, so there is no template of ours on the page to register
 * the stylesheet from. The fragment cannot do it either: a remote include renders no
 * decorator, so an assets.addCss inside it is collected and thrown away with the fragment's
 * own request. The PLPs register it from bannerSlot.isml for the same reason.
 *
 * Only a stylesheet is added, so the home page keeps its cache behaviour.
 */
server.append("Show", function (req, res, next) {
    try {
        require("*/cartridge/scripts/assets").addCss("/css/topsort-sponsored.css");
    } catch (e) {
        // The home page must render even if this does; the banners then render unstyled.
        Logger.error("Topsort banner styles could not be added to Home-Show: {0}", e.message);
    }

    return next();
});

module.exports = server.exports();
