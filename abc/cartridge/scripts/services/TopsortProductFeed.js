"use strict";

var ProductMgr  = require("dw/catalog/ProductMgr");
var topsortUtil = require("*/cartridge/scripts/util/TopsortUtil");

function start() {
    // TODO: The topsort feed job is copied from Facebook feed job, therefore this job needs to be refactored to decrease duplication percentage
    var allProducts = ProductMgr.queryAllSiteProducts();
    topsortUtil.createTopsortFeed(allProducts);
}

exports.start = start;
