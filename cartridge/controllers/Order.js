"use strict";

var server = require("server");
var Logger = require("dw/system/Logger").getLogger("TopsortService");
var OrderMgr = require("dw/order/OrderMgr");
var Transaction = require("dw/system/Transaction");
var topsortSession = require("*/cartridge/scripts/helpers/topsortSession");
var TopsortService = require("*/cartridge/scripts/services/TopsortService");

server.extend(module.superModule);

/**
 * Reports the confirmed order to Topsort as a purchase event.
 *
 * The order is looked up with its token so a purchase is only reported for a shopper who
 * actually holds the confirmation link. The base route rejects an untokenized request but
 * renders the error without ending the middleware chain, so this step has to validate
 * ownership itself rather than assume it already happened.
 *
 * Reporting is recorded on the order so a refresh of the confirmation page, or the
 * duplicate-order redirect, does not report the same purchase twice.
 *
 * @param {Object} req - The request object containing the query string with the order ID.
 */
function reportPurchase(req) {
    if (!TopsortService.getConfig().trackingEnabled) {
        return;
    }

    var orderNo = req.querystring.ID;
    var token = req.querystring.token;

    if (!orderNo || !token) {
        return;
    }

    var theOrder = OrderMgr.getOrder(orderNo, token);
    if (!theOrder) {
        return;
    }

    if (theOrder.custom.topsortPurchaseTracked) {
        return;
    }

    var opaqueUserId = topsortSession.resolveOpaqueUser().id;

    // The event id is derived from the order number rather than randomised, so that if
    // this call is retried Topsort treats it as the same purchase. Marking the order is
    // what stops a duplicate being sent at all; the stable id is the backstop.
    var result = TopsortService.sendPurchaseEvent(theOrder, opaqueUserId, "order-" + theOrder.orderNo);

    if (!result.success) {
        Logger.error("Topsort purchase event failed for order {0}: {1}", orderNo, result.error);
        return;
    }

    Transaction.wrap(function () {
        theOrder.custom.topsortPurchaseTracked = true;
    });
}

/**
 * Appends the Confirm route to report the order as a purchase event to Topsort.
 *
 * Nothing here may reach the shopper. This route renders the confirmation of an order that
 * has already been paid for, so a failure in ad reporting has to end as a log line rather
 * than as the error page: a shopper who sees one assumes the payment failed and orders
 * again. Orders left with topsortPurchaseTracked unset are the record of what was missed.
 *
 * @param {Object} req - The request object containing the query string with the order ID.
 * @param {Object} res - The response object used to send the HTTP response.
 * @param {Function} next - The next middleware function in the stack.
 */
server.append("Confirm", function (req, res, next) {
    try {
        reportPurchase(req);
    } catch (e) {
        Logger.error("Topsort purchase reporting failed for order {0}: {1}", req.querystring.ID, e.message);
    }

    return next();
});

module.exports = server.exports();
