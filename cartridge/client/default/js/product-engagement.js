"use strict";

/**
 * Engagement module for tracking sponsored product interactions and views.
 *
 * Events are posted to the storefront's own Topsort-Event controller, never directly to
 * the Topsort API: the marketplace API key authenticates auctions as well as events, so it
 * must not be present in the page. The controller attaches the key, resolves the shopper's
 * opaque user id from their cookie, and stamps the event id and timestamp.
 *
 * Banners are fetched through remote includes, which are separate requests and so each emit
 * their own copy of the loading tag. Building the module only when it is missing keeps the
 * repeated executions harmless: one instance, one impression queue, one set of observers.
 *
 * @namespace ProductEngagement
 */
window.ProductEngagement = window.ProductEngagement || (function () {
    // Topsort counts an impression when a promotable "has become visible to the consumer",
    // so a tile has to be at least half in view and stay there rather than merely having
    // been rendered. These match the usual display viewability standard.
    var VISIBLE_RATIO = 0.5;
    var DWELL_MS = 1000;

    var config = {};
    var initialized = false;
    var pendingImpressions = [];
    var flushHandle = null;

    /**
     * Initialize the engagement module
     * @param {Object} engagementConfig - Configuration object
     * @param {string} engagementConfig.eventUrl - Storefront URL of the Topsort-Event route
     * @param {boolean} engagementConfig.trackingEnabled - Whether events should be reported
     */
    function init(engagementConfig) {
        config = engagementConfig || {};
        initialized = Boolean(config.eventUrl);
    }

    /**
     * Detect device type
     * @returns {string} 'mobile' or 'desktop'
     */
    function getDeviceType() {
        return /Mobi/.exec(navigator.userAgent) ? "mobile" : "desktop";
    }

    /**
     * Post a batch of events to the storefront relay
     * @param {Object} payload - Object with impressions and/or clicks arrays
     * @param {boolean} keepalive - Keep the request alive across a navigation
     */
    function post(payload, keepalive) {
        if (!initialized || !config.trackingEnabled) {
            return;
        }

        fetch(config.eventUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: "same-origin",
            keepalive: keepalive || false
        }).catch(function (error) {
            console.error("Product engagement failed:", error); // eslint-disable-line no-console
        });
    }

    /**
     * Build the placement object describing where on the page the product was shown
     * @param {Object} params - Product engagement parameters
     * @returns {Object} Placement payload
     */
    function buildPlacement(params) {
        var placement = {
            path: window.location.pathname,
            position: params.position || 1,
            page: params.page || 1,
            pageSize: params.pageSize || 12
        };

        if (params.categoryId) {
            placement.categoryIds = [params.categoryId];
        }

        if (params.searchQuery) {
            placement.searchQuery = params.searchQuery;
        }

        return placement;
    }

    /**
     * Build a single event body. The event id, timestamp and opaque user id are added
     * server-side, so they are deliberately not sent from here.
     * @param {Object} params - Product engagement parameters
     * @returns {Object} Event payload
     */
    function buildEvent(params) {
        return {
            resolvedBidId: params.resolvedBidId,
            eventToken: params.eventToken,
            placement: buildPlacement(params),
            deviceType: getDeviceType()
        };
    }

    /**
     * Send every impression queued so far in a single request
     */
    function flushImpressions() {
        flushHandle = null;

        if (!pendingImpressions.length) {
            return;
        }

        var batch = pendingImpressions;
        pendingImpressions = [];
        post({ impressions: batch }, false);
    }

    /**
     * Queue an impression. Tiles register one by one as the grid is parsed, so the batch
     * is flushed on the next tick to report a whole grid in one request.
     * @param {Object} params - Product engagement parameters
     */
    function recordView(params) {
        pendingImpressions.push(buildEvent(params));

        if (flushHandle === null) {
            flushHandle = window.setTimeout(flushImpressions, 0);
        }
    }

    /**
     * Report a click immediately, since a navigation usually follows it
     * @param {Object} params - Product engagement parameters
     */
    function recordInteraction(params) {
        post({ clicks: [buildEvent(params)] }, true);
    }

    /**
     * Decide whether an observer entry counts as the tile being on screen. A tile taller
     * than the viewport can never reach VISIBLE_RATIO, so treat any intersection as visible
     * in that case rather than never reporting it.
     * @param {IntersectionObserverEntry} entry - Entry reported by the observer
     * @returns {boolean} True when the tile should start its dwell timer
     */
    function isOnScreen(entry) {
        if (entry.intersectionRatio >= VISIBLE_RATIO) {
            return true;
        }
        return entry.isIntersecting && entry.boundingClientRect.height > window.innerHeight;
    }

    /**
     * Queue the impression once the tile has actually been on screen for the dwell time.
     * Scrolling back out before the timer elapses cancels it, so tiles the shopper scrolled
     * straight past are not reported.
     * @param {Element} element - The tile element to watch
     * @param {Object} params - Product engagement parameters
     * @param {Function} [onView] - Optional callback used to dedupe several banner clones
     */
    function observeImpression(element, params, onView) {
        var reportView = onView || function () {
            recordView(params);
        };

        if (typeof window.IntersectionObserver !== "function") {
            // Documented Topsort fallback: report at render time when viewability cannot
            // be measured.
            reportView();
            return;
        }

        var dwellHandle = null;

        var observer = new window.IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (isOnScreen(entry)) {
                    if (dwellHandle === null) {
                        dwellHandle = window.setTimeout(function () {
                            observer.disconnect();
                            reportView();
                        }, DWELL_MS);
                    }
                } else if (dwellHandle !== null) {
                    window.clearTimeout(dwellHandle);
                    dwellHandle = null;
                }
            });
        }, { threshold: [0, VISIBLE_RATIO] });

        observer.observe(element);
    }

    /**
     * Set up engagement tracking for a sponsored product item
     * @param {Object} params - Product engagement parameters
     */
    function setupItemTracking(params) {
        if (!initialized || !config.trackingEnabled) {
            return;
        }

        // Without a resolvedBidId there is nothing for Topsort to attribute the event to.
        if (!params || !params.resolvedBidId || !params.eventToken) {
            return;
        }

        var element = document.getElementById("tile-" + params.productId);

        if (!element) {
            // Nothing to observe, so fall back to reporting at render time rather than
            // losing the impression entirely.
            recordView(params);
            return;
        }

        observeImpression(element, params);

        element.addEventListener("click", function () {
            recordInteraction(params);
        });
    }

    /**
     * Set up engagement tracking for a sponsored banner
     *
     * Banners use the same viewability rules as tiles, so a banner the shopper scrolls
     * straight past is not reported. The one extra rule is the visibility check below.
     *
     * @param {Object} params - Banner engagement parameters
     * @param {string} params.resolvedBidId - Bid this banner was won with
     * @param {number} params.position - Placement position configured for the slot
     * @param {string} [params.categoryId] - Category being browsed
     * @param {string} [params.searchQuery] - Shopper search term
     */
    function setupContentTracking(params) {
        if (!initialized || !config.trackingEnabled) {
            return;
        }

        if (!params || !params.resolvedBidId || !params.eventToken) {
            return;
        }

        function bindElements() {
            var candidates = document.querySelectorAll("[data-ts-bid-id]");
            var impressionRecorded = false;

            Array.prototype.forEach.call(candidates, function (element) {
                if (element.getAttribute("data-ts-bid-id") !== params.resolvedBidId
                        || element.getAttribute("data-ts-tracking-bound") === params.resolvedBidId) {
                    return;
                }

                element.setAttribute("data-ts-tracking-bound", params.resolvedBidId);
                element.addEventListener("click", function () {
                    recordInteraction(params);
                });

                var image = element.querySelector(".ts-banner__image");
                if (!image) {
                    return;
                }

                function startObservation() {
                    if (impressionRecorded) {
                        return;
                    }
                    // IntersectionObserver detects translated Slick slides correctly. Its
                    // fallback must use slick-active because offscreen slides still have an
                    // offsetParent while Slick moves them with transforms.
                    if (typeof window.IntersectionObserver !== "function") {
                        var $slide = window.jQuery
                            ? window.jQuery(element).closest(".slick-slide")
                            : null;
                        var isHidden = element.offsetParent === null
                            || ($slide && $slide.length && !$slide.hasClass("slick-active"));

                        if (isHidden) {
                            var $slider = $slide && $slide.length ? $slide.closest(".slick-slider") : null;
                            if ($slider && $slider.length) {
                                var onSlideChange = function () {
                                    if (impressionRecorded) {
                                        $slider.off("afterChange", onSlideChange);
                                        return;
                                    }
                                    if ($slide.hasClass("slick-active") && element.offsetParent !== null) {
                                        $slider.off("afterChange", onSlideChange);
                                        observeImpression(element, params, function () {
                                            if (!impressionRecorded) {
                                                impressionRecorded = true;
                                                recordView(params);
                                            }
                                        });
                                    }
                                };
                                $slider.on("afterChange", onSlideChange);
                            }
                            return;
                        }
                    }
                    observeImpression(element, params, function () {
                        if (!impressionRecorded) {
                            impressionRecorded = true;
                            recordView(params);
                        }
                    });
                }

                if (image.complete) {
                    if (image.naturalWidth > 0) {
                        startObservation();
                    }
                    return;
                }

                image.addEventListener("load", startObservation);
                image.addEventListener("error", function () {
                    element.style.display = "none";
                });
            });
        }

        // Slick creates its infinite-loop clones on DOM ready. Bind on the next task so the
        // original banner and every clone receive click and impression handling.
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", function () {
                window.setTimeout(bindElements, 0);
            });
        } else {
            window.setTimeout(bindElements, 0);
        }
    }

    return {
        init: init,
        setupItemTracking: setupItemTracking,
        setupContentTracking: setupContentTracking
    };
})();
