"use strict";

var server          = require("server");
var OrderMgr        = require("dw/order/OrderMgr");
var Cookie          = require("dw/web/Cookie");
var UUIDUtils       = require("dw/util/UUIDUtils");
var csrfProtection  = require("*/cartridge/scripts/middleware/csrf");
var consentTracking = require("*/cartridge/scripts/middleware/consentTracking");
var pageMetaData    = require("*/cartridge/scripts/middleware/pageMetaData");
var TopsortService = require("*/cartridge/scripts/services/TopsortService");

server.extend(module.superModule);

/**
 * Appends the Confirm route to the server, handling order confirmation logic.
 *
 * This function retrieves an order based on the order number from the query string,
 * generates a unique user identifier if not already present, and sends a purchase event
 * to the Topsort service.
 *
 * @param {Object} req - The request object containing the query string with the order ID.
 * @param {Object} res - The response object used to send the HTTP response.
 * @param {Function} next - The next middleware function in the stack.
 *
 * @throws {Error} If the Topsort service fails to send the purchase event.
 */
server.append(
    "Confirm",
    consentTracking.consent,
    server.middleware.https,
    csrfProtection.generateToken,
    pageMetaData.computedPageMetaData,
    function (req, res, next) {
        var orderNo  = req.querystring.ID;
        var theOrder = OrderMgr.getOrder(orderNo);
        if (!theOrder) {
            return next();
        }

        var tsuid = request.httpCookies["tsuid"];
        if (!tsuid) {
            tsuid = new Cookie("tsuid", UUIDUtils.createUUID());
            tsuid.setMaxAge(365 * 24 * 60 * 60);
            tsuid.setHttpOnly(true);
            tsuid.setPath("/");
            response.addHttpCookie(tsuid);
        }

        var opaqueUserId = tsuid.value;

        TopsortService.sendPurchaseEvent(theOrder, opaqueUserId);

        return next();
    }
);

module.exports = server.exports();
