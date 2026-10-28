"use strict";

var Encoding = require("dw/crypto/Encoding");
var Mac = require("dw/crypto/Mac");
var Site = require("dw/system/Site");
var Bytes = require("dw/util/Bytes");

function toBase64Url(value) {
    return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sign(value) {
    var key = Site.getCurrent().getCustomPreferenceValue("topsortApiKey") || "";
    if (!key) {
        return "";
    }

    var mac = new Mac(Mac.HMAC_SHA_256);
    return toBase64Url(Encoding.toBase64(mac.digest(new Bytes(value), new Bytes(key))));
}

function constantTimeEquals(left, right) {
    if (typeof left !== "string" || typeof right !== "string" || !left.length || !right.length) {
        return false;
    }

    var mismatch = left.length ^ right.length;
    var length = Math.max(left.length, right.length);
    for (var i = 0; i < length; i += 1) {
        mismatch |= (left.charCodeAt(i % left.length) || 0)
            ^ (right.charCodeAt(i % right.length) || 0);
    }
    return mismatch === 0;
}

function createEventToken(resolvedBidId, opaqueUserId) {
    return sign(["bid", opaqueUserId || "", resolvedBidId].join("|"));
}

function validateEventToken(token, resolvedBidId, opaqueUserId) {
    return constantTimeEquals(token, createEventToken(resolvedBidId, opaqueUserId));
}

function createOpaqueUserId(sessionId) {
    return sign(["user", sessionId || ""].join("|"));
}

function createEventId(eventType, resolvedBidId, opaqueUserId) {
    return "storefront-" + sign([
        "event",
        eventType,
        opaqueUserId || "",
        resolvedBidId
    ].join("|"));
}

module.exports = {
    createEventId: createEventId,
    createEventToken: createEventToken,
    createOpaqueUserId: createOpaqueUserId,
    validateEventToken: validateEventToken
};
