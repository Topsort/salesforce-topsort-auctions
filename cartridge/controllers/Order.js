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

        try {
            const client = new HTTPClient();
            client.setTimeout(5000);

            const apiBaseUrl = Site.getCurrent().getCustomPreferenceValue('topsortApiURL') || 'https://api.topsort.com';
            const eventUrl = apiBaseUrl + '/v1/events';
            const apiKey   = Site.getCurrent().getCustomPreferenceValue('topsortApiKey');

            client.open('POST', eventUrl);

            if (apiKey) {
                client.setRequestHeader('Authorization', 'Bearer ' + apiKey);
            }
            client.setRequestHeader('Content-Type', 'application/json');

            const payload = {
                orderNo:       theOrder.orderNo,
                total:         theOrder.totalGrossPrice.value,
                currency:      theOrder.currencyCode,
                createdAt:     new Date().toISOString(),
                opaqueUserId:  opaqueUserId,
                items:         []
            };

            const pliIter = theOrder.allProductLineItems.iterator();
            while (pliIter.hasNext()) {
                const pli = pliIter.next();
                payload.items.push({
                    productId: pli.productID,
                    quantity:  pli.quantityValue,
                    price:     pli.adjustedPrice.value
                });
            }

            client.send(JSON.stringify(payload));

            if (client.statusCode !== 200 && client.statusCode !== 201) {
                Logger.error(
                    'Topsort event POST failed for order {0}: status {1}, response {2}',
                    theOrder.orderNo,
                    client.statusCode,
                    client.text
                );
            }
        } catch (e) {
            Logger.error(
                'Exception sending Topsort event for order {0}: {1}',
                theOrder.orderNo,
                e.message
            );
        }

        return next();
    }
);

module.exports = server.exports();
