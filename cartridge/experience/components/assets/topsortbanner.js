"use strict";

var HashMap = require("dw/util/HashMap");
var Template = require("dw/util/Template");
var PageRenderHelper = require("*/cartridge/experience/utilities/PageRenderHelper.js");

/**
 * Render logic for the Topsort sponsored banner component.
 *
 * Deliberately thin: the auction runs in the Topsort-Banner controller, which the template
 * reaches through a remote include. Doing it that way is what lets the home page keep its
 * page cache - a response carrying a resolvedBidId cannot be cached, so if the auction ran
 * here this component would have to expire the whole home page on every winning render.
 *
 * That also means there is no cache handling in this script, unlike the product list
 * component next to it.
 *
 * @param {dw.experience.ComponentScriptContext} context The Component script context object.
 * @returns {string} The markup to be displayed
 */
module.exports.render = function (context) {
    var model = new HashMap();

    model.slotId = context.content.slotId;
    // Page Designer renders components server side with no shopper on the other end. Without
    // this the component is an invisible, unselectable strip in the editor, because a slot
    // with no winning campaign renders nothing at all.
    model.isEditMode = PageRenderHelper.isInEditMode();

    return new Template("experience/components/assets/topsortbanner").render(model).text;
};
