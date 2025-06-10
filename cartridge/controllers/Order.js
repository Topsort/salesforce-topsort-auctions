'use strict';

const server          = require('server');
const OrderMgr        = require('dw/order/OrderMgr');
const HTTPClient      = require('dw/net/HTTPClient');
const Logger          = require('dw/system/Logger').getLogger('OrderEvent');
const Site            = require('dw/system/Site');
const csrfProtection  = require('*/cartridge/scripts/middleware/csrf');
const consentTracking = require('*/cartridge/scripts/middleware/consentTracking');
const pageMetaData    = require('*/cartridge/scripts/middleware/pageMetaData');

server.extend(module.superModule);

server.append(
    'Confirm',
    consentTracking.consent,
    server.middleware.https,
    csrfProtection.generateToken,
    pageMetaData.computedPageMetaData,
    (req, res, next) => {
        const orderNo  = req.querystring.ID;
        const theOrder = OrderMgr.getOrder(orderNo);
        if (!theOrder) {
            return next();
        }

        let tsuid = request.httpCookies['tsuid'];
        if (!tsuid) {
            tsuid = new Cookie('tsuid', UUIDUtils.createUUID());
            tsuid.setMaxAge(365 * 24 * 60 * 60);
            tsuid.setHttpOnly(true);
            tsuid.setPath('/');
            response.addHttpCookie(tsuid);
        }

        const opaqueUserId = tsuid.value;

        const TopsortService = require('*/cartridge/scripts/services/TopsortService');
        const topsortResponse = TopsortService.sendPurchaseEvent(theOrder, opaqueUserId);

        return next();
    }
);

module.exports = server.exports();
