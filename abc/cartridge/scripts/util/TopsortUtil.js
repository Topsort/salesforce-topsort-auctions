"use strict";

var Site                     = require("dw/system/Site");
var File                     = require("dw/io/File");
var ProductAvailabilityModel = require("dw/catalog/ProductAvailabilityModel");
var urlHelper                = require("*/cartridge/scripts/helpers/urlHelpers");
var feedHelpers              = require("*/cartridge/scripts/helpers/feedHelpers");

/**
 * Create GS feed using all valid products
 * @param {SeekableIterator} allProducts
 */
function createTopsortFeed(allProducts) {
    // TODO: The topsort feed job is copied from Facebook feed job, therefore this job needs to be refactored to decrease duplication percentage
    var line         = new dw.util.SortedMap();

    var productCount = 0;
    var currentSite  = Site.getCurrent();
    var siteID       = currentSite.ID;
    var path         = "Libraries/topsort-shared-library/library/feeds";
    var dirs         = new File(path);
    var file         = new File(path + "/" + "topsortFeed-" + siteID + ".csv");

    dirs.mkdirs();
    var fileWriter   = new dw.io.FileWriter(file, "UTF-8");
    var writer       = new dw.io.CSVStreamWriter(fileWriter, String.fromCharCode(9));

    line.id = "id";
    line.title = "title";
    line.description = "description";
    line.availability = "availability";
    line.condition = "condition";
    line.price = "price";
    line.link = "link";
    line.image_link = "image_link";
    line.brand = "brand";
    line.sale_price = "price_sale";
    line.category_level_1 = "custom_label_0";
    line.category_level_2 = "custom_label_1";
    line.category_level_3 = "custom_label_2";
    line.lpPridarticul = "item_group_id";
    line.lpArmarcaID = "brand_id";

    try {
        writer.writeNext(line.values().toArray());

        line.condition  = "new";

        while (allProducts.hasNext()) {
            var product = allProducts.next();

            if (product.isProductSet() || product.isBundle() || product.isMaster()) {
                continue;
            }

            var availability = product.getAvailabilityModel().getAvailabilityStatus();
            var images = product.getImages("large");
            var imageUrl = images && images.length && images[0].httpsURL ? images[0].httpsURL.toString() : "";
            var title = product.getName() || product.getID();
            var link  = urlHelper.replaceHostnameWithCanonicalNameInUrl(dw.web.URLUtils.https("Product-Show", "pid", product.ID).toString());
            var imageLink = urlHelper.replaceHostnameWithCanonicalNameInImage(imageUrl);
            var categoryLevels = feedHelpers.getThreeCategoryLevelsInReversed(product.primaryCategory);
            var feedPriceObject = feedHelpers.getFeedPriceObject(product);

            line.id               = product.getID();
            line.title            = title;
            line.description      = title + " - " + (product.brand || "La Polar");
            line.link             = encodeURI(link);
            line.image_link       = encodeURI(imageLink);
            line.availability     = availability == ProductAvailabilityModel.AVAILABILITY_STATUS_IN_STOCK ? "in stock" : "preorder";
            line.price            = feedPriceObject.price;
            line.sale_price       = feedPriceObject.sale_price;
            line.brand            = !empty(product.brand) ? product.brand : "La Polar";
            line.category_level_1 = categoryLevels.level1;
            line.category_level_2 = categoryLevels.level2;
            line.category_level_3 = categoryLevels.level3;
            line.lpPridarticul    = product.custom && product.custom.lpPridarticul || "";
            line.lpArmarcaID      = product.custom && product.custom.lpArmarcaID || "";

            writer.writeNext(line.values().toArray());
            productCount++;

            if (productCount % 700 == 0) {
                fileWriter.flush();
            }
        }
    }
    finally {
        writer.close();
        fileWriter.close();
        allProducts.close();
    }

    return file;
}

module.exports.createTopsortFeed = createTopsortFeed;
