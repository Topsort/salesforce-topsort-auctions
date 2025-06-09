'use strict';

const server          = require('server');
const OrderMgr        = require('dw/order/OrderMgr');
const HTTPClient      = require('dw/net/HTTPClient');
const Logger          = require('dw/system/Logger').getLogger('OrderEvent');
const Site            = require('dw/system/Site');
const csrfProtection  = require('*/cartridge/scripts/middleware/csrf');
const consentTracking = require('*/cartridge/scripts/middleware/consentTracking');
const pageMetaData    = require('*/cartridge/scripts/middleware/pageMetaData');

server.extend(require('app_storefront_base/cartridge/controllers/Order'));

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

        const tsuidCookie = req.httpCookies['tsuid'];
        const opaqueUserId = tsuidCookie ? tsuidCookie.value : null;

        const TopsortService = require('*/cartridge/scripts/services/TopsortService');
        const response = TopsortService.sendPurchaseEvent(theOrder, opaqueUserId);

        if (!response.success) {
            Logger.error(
                'Topsort purchase event failed for order {0}: {1}',
                theOrder.orderNo,
                response.error
            );
        }

        return next();
    }
);

module.exports = server.exports();
