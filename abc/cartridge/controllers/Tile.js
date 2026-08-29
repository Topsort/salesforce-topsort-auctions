"use strict";

var server = require("server");
server.extend(module.superModule);

/**
* Controller endpoint for the "Show" route that updates the view data with sponsorship status.
* @param {dw.system.Request} req - The HTTP request object.
* @param {dw.system.Response} res - The HTTP response object.
* @param {Function} next - The callback to pass control to the next middleware.
* 
* Adds the 'isSponsored' query string parameter to the response's view data and proceeds to the next middleware.
*/
server.append("Show", function (req, res, next) {
    var viewData = res.getViewData();
    viewData.isSponsored = req.querystring.isSponsored === "true";
    res.setViewData(viewData);
    next();
});

module.exports = server.exports();
