"use strict";

/**
 * Fills the sponsored home page slots with banners.js.
 *
 * HITES edits the home page as plain HTML in content slots, so each slot is a placeholder
 * they paste where the banner goes:
 *
 *   <div class="clp-hero-banner ts-home-slot ts-home-slot--slide" data-ts-slot="home-slider-5"></div>
 *   <div class="clp-hero-banner ts-home-slot ts-home-slot--slide" data-ts-slot="home-slider-6"></div>
 *   <div class="ts-home-slot ts-home-slot--full" data-ts-slot="home-banner-full"></div>
 *
 * banners.js runs the auction and renders the winner, and analytics.js reports impressions
 * and clicks. Neither talks to api.topsort.com: window.TS.url points both at the storefront's
 * Topsort-BannersApi route, which attaches the API key and the shopper's opaque user id
 * server-side, so the key never reaches the page and banner clicks carry the same identity
 * as the purchases reported from Order-Confirm.
 *
 * The hero carousel is slick, which clones slides for its infinite loop, and every connected
 * <topsort-banner> runs an auction of its own. So the placeholders stay inert divs that
 * clones copy harmlessly: <topsort-banner> is only created inside the original slide, after
 * the carousel is built, and it is unwrapped into plain markup as soon as it renders. The
 * clones are then given a copy of that markup.
 *
 * A slot that does not end up with a banner - no winner, an error, banners switched off, or
 * a browser banners.js cannot run in - is removed, so the carousel never shows a blank slide.
 *
 * Configuration arrives on this script's own query string, built by Home-Show.
 */
(function () {
    var SLOT_SELECTOR = ".ts-home-slot[data-ts-slot]";
    // A slot still waiting after this long is given up on, rather than left as a blank slide
    // the shopper can swipe to. The server answers well within it: its service timeout is 500 ms.
    var SETTLE_TIMEOUT_MS = 5000;

    var config = readConfig(document.currentScript);

    // Captured now, while the document has just been parsed and before the carousel is
    // initialised on ready, so these are the original slots and never slick's clones.
    var slots = Array.prototype.slice.call(document.querySelectorAll(SLOT_SELECTOR));

    if (!slots.length) {
        return;
    }

    var supported = Boolean(window.customElements && window.fetch && window.Promise
        && window.IntersectionObserver);

    if (config.enabled !== "1" || !supported || !config.api) {
        // Still before slick counts its slides, so plain removal is enough.
        slots.forEach(removeNode);
        return;
    }

    window.TS = {
        // banners.js refuses to render without a token. Topsort-BannersApi ignores it and
        // authenticates with the real key server-side.
        token: "storefront",
        url: config.api,
        // Without this analytics.js mints its own "tsuid" cookie from script, which collides
        // with the HttpOnly one the storefront uses. Topsort-BannersApi replaces the value
        // with the shopper's real opaque user id.
        getUserId: function () {
            return "storefront";
        }
    };
    window.TS_BANNERS = { getBannerElement: buildBannerElement };

    // analytics.js queues a click and sends it 250 ms later, so the navigation the click
    // starts usually cancels it; the queued copy is only retried on the next page that loads
    // analytics.js, and only the home page does. Banner clicks are therefore also reported
    // here at once, with keepalive. The copy analytics.js may send later is not billed twice:
    // Topsort-BannersApi derives the event id from the event type, bid and shopper, and
    // Topsort deduplicates on it.
    document.addEventListener("click", function (event) {
        var banner = event.target.closest && event.target.closest(".ts-home-slot .ts-banner[data-ts-resolved-bid]");
        if (banner) {
            reportClick(banner.getAttribute("data-ts-resolved-bid"));
        }
    }, true);

    var groups = [];
    loadScripts([config.analytics, config.banners], function () {
        slots.forEach(function (slot) {
            settle(slot, null);
        });
    });
    whenDocumentReady(function () {
        slots.forEach(startSlot);
    });

    /**
     * Reads the configuration from the script URL's query string.
     *
     * @param {HTMLScriptElement|null} script - This script element
     * @returns {Object} The query parameters, decoded
     */
    function readConfig(script) {
        var result = {};
        var query = script && script.src.split("?")[1];

        (query || "").split("&").forEach(function (pair) {
            var separator = pair.indexOf("=");
            if (separator > 0) {
                result[pair.substring(0, separator)] = decodeURIComponent(pair.substring(separator + 1));
            }
        });

        return result;
    }

    /**
     * Loads the scripts one after another, analytics.js first so it is listening before the
     * first banner renders.
     *
     * @param {Array} urls - Script URLs, in load order
     * @param {Function} onError - Called once if any of them fails to load
     */
    function loadScripts(urls, onError) {
        if (!urls.length) {
            return;
        }

        var script = document.createElement("script");
        script.src = urls[0];
        script.onload = function () {
            loadScripts(urls.slice(1), onError);
        };
        script.onerror = onError;
        document.head.appendChild(script);
    }

    /**
     * Runs the callback once the carousel has been built.
     *
     * This script is deferred, so it runs before DOMContentLoaded and therefore before the
     * storefront's own jQuery ready handlers. Queuing onto jQuery's ready from
     * DOMContentLoaded places the callback after them, which is where the carousel is built.
     *
     * @param {Function} callback - Called once
     */
    function whenDocumentReady(callback) {
        function onReady() {
            if (window.jQuery) {
                window.jQuery(callback);
            } else {
                callback();
            }
        }

        if (document.readyState === "complete") {
            onReady();
        } else {
            document.addEventListener("DOMContentLoaded", onReady);
        }
    }

    /**
     * Returns the slick carousel a slot sits in, or null when it is not in one.
     *
     * @param {Element} slot - An original slot
     * @returns {Object|null} The carousel as a jQuery object
     */
    function getCarousel(slot) {
        if (!window.jQuery) {
            return null;
        }
        var carousel = window.jQuery(slot).closest(".slick-initialized");
        return carousel.length ? carousel : null;
    }

    /**
     * Returns the group of slots that share a carousel.
     *
     * Removing a slide rebuilds slick's clones from the slides as they are at that moment, so
     * a removal while another slot's <topsort-banner> is still in the carousel would clone
     * it, and the clone would run an auction of its own. Removals in a carousel are therefore
     * held until every slot in it has settled.
     *
     * @param {Object|null} carousel - The slot's carousel
     * @returns {Object} The group
     */
    function getGroup(carousel) {
        for (var i = 0; i < groups.length; i += 1) {
            if (carousel && groups[i].carousel && groups[i].carousel[0] === carousel[0]) {
                return groups[i];
            }
        }
        var group = { carousel: carousel, pending: 0, removals: [] };
        groups.push(group);
        return group;
    }

    /**
     * Starts the auction for one slot.
     *
     * @param {Element} slot - An original slot
     */
    function startSlot(slot) {
        if (slot.tsState) {
            // Already given up on, because the libraries failed to load.
            return;
        }

        var carousel = getCarousel(slot);
        var group = carousel ? getGroup(carousel) : getGroup(null);
        var banner = document.createElement("topsort-banner");

        banner.setAttribute("id", slot.getAttribute("data-ts-slot"));
        banner.addEventListener("statechange", function (event) {
            if (event.target === banner) {
                settle(slot, event.detail && event.detail.status === "ready" ? banner : null);
            }
        });

        slot.tsState = { group: group, banner: banner };
        group.pending += 1;
        slot.appendChild(banner);

        setTimeout(function () {
            settle(slot, null);
        }, SETTLE_TIMEOUT_MS);
    }

    /**
     * Records the outcome of one slot: keeps the banner, or schedules the slot for removal.
     *
     * @param {Element} slot - An original slot
     * @param {Element|null} banner - The <topsort-banner> that rendered a winner, or null
     */
    function settle(slot, banner) {
        var state = slot.tsState;

        if (!state) {
            // The libraries failed before this slot started.
            slot.tsState = { settled: true };
            removeNode(slot);
            return;
        }

        if (state.settled) {
            return;
        }
        state.settled = true;

        var rendered = banner && banner.querySelector(".ts-banner");

        if (rendered) {
            slot.appendChild(rendered);
        }
        // Plain markup only from here on, whatever the outcome. Any later rebuild of the
        // carousel - including the one slickRemove does - clones the slides as they are, and
        // a cloned <topsort-banner> would run an auction of its own.
        removeNode(state.banner);

        if (rendered) {
            slot.classList.add("ts-home-slot--filled");
            mirrorToClones(slot, rendered);
        } else {
            state.group.removals.push(slot);
        }

        state.group.pending -= 1;
        if (state.group.pending === 0) {
            flushRemovals(state.group);
        }
    }

    /**
     * Copies a rendered banner into slick's clones of its slot.
     *
     * analytics.js counts an impression once per page and bid, so the copy shown when the
     * carousel wraps around does not report a second one.
     *
     * @param {Element} slot - An original slot
     * @param {Element} rendered - The banner rendered into it
     */
    function mirrorToClones(slot, rendered) {
        var slotId = slot.getAttribute("data-ts-slot");
        var copies = document.querySelectorAll(SLOT_SELECTOR);

        for (var i = 0; i < copies.length; i += 1) {
            if (copies[i] !== slot && copies[i].getAttribute("data-ts-slot") === slotId) {
                copies[i].innerHTML = "";
                copies[i].appendChild(rendered.cloneNode(true));
                copies[i].classList.add("ts-home-slot--filled");
            }
        }
    }

    /**
     * Removes the slots of a group that ended up without a banner.
     *
     * @param {Object} group - A group whose slots have all settled
     */
    function flushRemovals(group) {
        var removals = group.removals;
        group.removals = [];

        if (!group.carousel) {
            removals.forEach(removeNode);
            return;
        }

        // Highest index first, because slick renumbers the slides after each removal.
        removals.map(function (slot) {
            return Number(window.jQuery(slot).closest(".slick-slide").attr("data-slick-index"));
        }).sort(function (a, b) {
            return b - a;
        }).forEach(function (index) {
            group.carousel.slick("slickRemove", index);
        });
    }

    /**
     * Builds the banner markup. Called by banners.js for every winner.
     *
     * Mirrors topsort/banner.isml, so a home banner looks and is styled like every other
     * Topsort banner on the site. The winner was vetted by Topsort-BannersApi: href is only
     * ever an http(s) or product URL and every creative URL is on the allowed asset hosts.
     * It is still written through DOM properties rather than HTML.
     *
     * @param {Object} winner - Winner from Topsort-BannersApi
     * @returns {HTMLElement} The banner element
     */
    function buildBannerElement(winner) {
        var wrapper = document.createElement("div");
        wrapper.className = "ts-banner";
        // What analytics.js looks for: the bid to attribute impressions and clicks to, and
        // the element whose clicks count.
        wrapper.setAttribute("data-ts-resolved-bid", winner.resolvedBidId);
        wrapper.setAttribute("data-ts-clickable", "");

        var image = document.createElement("img");
        image.className = "ts-banner__image";
        image.src = winner.asset[0].url;
        if (winner.srcset) {
            image.srcset = winner.srcset;
        }
        if (winner.sizes) {
            image.sizes = winner.sizes;
        }
        if (winner.width) {
            image.width = winner.width;
        }
        if (winner.height) {
            image.height = winner.height;
        }
        image.alt = config.alt || "";
        image.loading = "lazy";

        var picture = document.createElement("picture");
        picture.appendChild(image);

        var content = picture;
        if (winner.href) {
            content = document.createElement("a");
            content.className = "ts-banner__link";
            content.href = winner.href;
            content.rel = "nofollow sponsored";
            content.appendChild(picture);
        }
        wrapper.appendChild(content);

        var label = document.createElement("span");
        label.className = "ts-banner__label";
        label.textContent = config.label || "";
        wrapper.appendChild(label);

        return wrapper;
    }

    /**
     * Reports a banner click to Topsort-BannersApi, surviving the navigation it triggers.
     *
     * @param {string} resolvedBidId - Signed bid of the clicked banner
     */
    function reportClick(resolvedBidId) {
        fetch(config.api + "/v2/events", {
            method: "POST",
            keepalive: true,
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                clicks: [{
                    resolvedBidId: resolvedBidId,
                    placement: { path: window.location.pathname + window.location.search }
                }]
            })
        }).catch(function () {
            // Nothing to do: analytics.js keeps its own copy queued for a later page.
        });
    }

    function removeNode(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
}());
