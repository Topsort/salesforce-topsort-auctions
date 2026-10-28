"use strict";

var HashMap = require("dw/util/HashMap");
var Logger = require("dw/system/Logger").getLogger("SponsoredSearch");
var topsortListings = require("*/cartridge/scripts/helpers/topsortListings");
var topsortSession = require("*/cartridge/scripts/helpers/topsortSession");

var base = module.superModule;

/**
 * Render logic for the product list component.
 *
 * All of the listing behaviour is inherited from the cartridge below this one; the only
 * thing added here is the page cache decision for sponsored placements.
 *
 * The auction itself runs in productGrid_hites.isml rather than in this script. The base
 * component builds its model internally and returns finished markup, so there is no seam to
 * merge winners into productIds before the grid is rendered. Copying the base render just to
 * insert that step meant a 200 line duplicate that silently went stale whenever the HITES
 * component changed, so the grid template drives the auction and this wrapper only reacts to
 * the outcome.
 *
 * @param {dw.experience.ComponentScriptContext} context The Component script context object.
 * @param {dw.util.Map} [modelIn] Additional model values created by another cartridge. This will not be passed in by Commerce Cloud Platform.
 *
 * @returns {string} The markup to be displayed
 */
module.exports.render = function (context, modelIn) {
    // The base render populates whichever map it is handed, so passing one in gives access
    // to the finished model - productIds included - after the markup has been rendered.
    var model = modelIn || new HashMap();

    var markup = base.render(context, model);

    // The base render already asked for a one hour page cache. Sponsored placements carry
    // resolvedBidIds belonging to a single auction, so a cached copy would report every
    // later shopper's impressions against these bids. Expiring the response in the past
    // overrides that request under either of the ways repeated setExpires calls can be
    // resolved (last call wins, or shortest expiry wins).
    var hasSponsored;
    try {
        hasSponsored = topsortListings.hasSponsoredProducts(model.productSearch);
    } catch (e) {
        // The markup is already rendered and may contain bid ids. Since it is no longer
        // possible to tell, the response is treated as if it does: an hour of extra
        // dynamic category pages costs far less than an hour of every shopper's
        // impressions being reported against one shopper's bids.
        Logger.error("Could not determine whether the Page Designer grid carries sponsored placements: {0}", e.message);
        hasSponsored = true;
    }

    // A tsuid minted on this request is the second reason the response cannot be cached, and
    // it applies even when the auction returned nothing: SFCC keeps no Set-Cookie in the
    // page cache, so caching here would drop the cookie and leave the shopper minting a new
    // opaque user id on every request.
    if (hasSponsored || topsortSession.wasOpaqueUserMinted()) {
        response.setExpires(new Date(0));
    }

    return markup;
};
