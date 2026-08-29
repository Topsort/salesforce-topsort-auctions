"use strict";

var base = module.superModule;
var assign = require("server/assign");

/**
 * Filter method for dw.util.Collection subclass instances
 * @param {dw.util.Collection} collection - Collection subclass instance to filter
 * @param {Function} callback - Function to test each element of the collection
 * @param {Object} [scope] - Optional execution scope to pass to the callback
 * @returns {Array} Array of elements that pass the test
 */
function filter(collection, callback, scope) {
    if (typeof callback !== "function") {
        throw new TypeError(callback + " is not a function");
    }

    var result = [];
    var iterator = collection.iterator();
    var index = 0;

    while (iterator.hasNext()) {
        var item = iterator.next();
        if (scope ? callback.call(scope, item, index, collection) : callback(item, index, collection)) {
            result.push(item);
        }
        index++;
    }

    return result;
}

module.exports = assign({}, base, {
    filter: filter
});
