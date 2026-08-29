/**
 * Sponsored brand rows: carousel setup and engagement tracking.
 *
 * Every row on the page is handled independently, so a slot that returns several winners
 * produces several rows, each with its own carousel and its own resolved bid.
 *
 * @namespace SponsoredBrands
 */
window.SponsoredBrands = (function () {
    'use strict';

    // Matches the "desktop" value in app_lapolar_core's client/default/js/util/breakpoints.js.
    // Slick's responsive breakpoints are max-width by default, so anything narrower than this,
    // tablets included, falls into the mobile bucket.
    var DESKTOP_BREAKPOINT = 1024;

    var ARROW_VIEWPORT = '10 12 56 56';
    var ARROW_PATH = 'M44.7 56.7c-.2.2-.4.3-.7.3s-.5-.1-.7-.3l-16-15.5c-.4-.4-.4-1 0-1.4l16-15.5c.4-.4 1-.4 1.4 0 .4.4.4 1 0 1.4L29.4 40.5l15.3 14.8c.4.4.4 1 0 1.4';

    var PREV_ARROW = '<button type="button" class="slick-prev pull-left" aria-label="Mostrar productos anteriores"><svg class="slick-svg-inline" xmlns="http://www.w3.org/2000/svg" viewBox="' + ARROW_VIEWPORT + '"><path fill="#FFF" d="' + ARROW_PATH + '"/></svg></button>';
    var NEXT_ARROW = '<button type="button" class="slick-next pull-right" aria-label="Mostrar productos siguientes"><svg class="slick-svg-inline rotate-180" xmlns="http://www.w3.org/2000/svg" viewBox="' + ARROW_VIEWPORT + '"><path fill="#FFF" d="' + ARROW_PATH + '"/></svg></button>';

    var READY_RETRY_MS = 100;
    var READY_MAX_ATTEMPTS = 50;

    var initialized = false;

    /**
     * Read an integer data attribute, falling back when it is missing or unparseable.
     * @param {Element} element - Element carrying the attribute
     * @param {string} name - Full attribute name
     * @param {number} fallback - Value to use when the attribute is unusable
     * @returns {number} The parsed value
     */
    function intAttr(element, name, fallback) {
        var parsed = parseInt(element.getAttribute(name), 10);
        return isNaN(parsed) ? fallback : parsed;
    }

    /**
     * Build the engagement payload for a row from its data attributes.
     * @param {Element} row - The .ts-sb-row element
     * @returns {Object} Parameters for ProductEngagement
     */
    function trackingParams(row) {
        return {
            userId: row.getAttribute('data-ts-uid') || '',
            position: intAttr(row, 'data-ts-rank', 1),
            page: intAttr(row, 'data-ts-page', 1),
            pageSize: intAttr(row, 'data-ts-page-size', 12),
            categoryId: row.getAttribute('data-ts-category') || '',
            resolvedBidId: row.getAttribute('data-ts-bid') || ''
        };
    }

    /**
     * Turn a row's product strip into a Slick carousel.
     *
     * The compact format inverts the usual arrangement: it is a static grid on desktop and a
     * swipeable strip below the breakpoint, which Slick expresses as a mobile-first config
     * that unslicks itself once the viewport is wide enough.
     *
     * @param {Element} row - The .ts-sb-row element
     */
    function initCarousel(row) {
        var $carousel = window.$(row).find('.ts-sb-carousel');

        if (!$carousel.length || $carousel.hasClass('slick-initialized')) {
            return;
        }

        var format = row.getAttribute('data-ts-format');
        var desktopSlides = intAttr(row, 'data-ts-slides-desktop', 1);
        var mobileSlides = intAttr(row, 'data-ts-slides-mobile', 2);

        if (format === 'compact') {
            $carousel.slick({
                mobileFirst: true,
                slidesToShow: mobileSlides,
                slidesToScroll: 1,
                infinite: false,
                arrows: false,
                dots: true,
                prevArrow: PREV_ARROW,
                nextArrow: NEXT_ARROW,
                responsive: [{
                    breakpoint: DESKTOP_BREAKPOINT,
                    settings: 'unslick'
                }]
            });
            return;
        }

        $carousel.slick({
            slidesToShow: desktopSlides,
            slidesToScroll: 1,
            infinite: false,
            arrows: true,
            dots: false,
            speed: 400,
            prevArrow: PREV_ARROW,
            nextArrow: NEXT_ARROW,
            responsive: [{
                breakpoint: DESKTOP_BREAKPOINT,
                settings: {
                    slidesToShow: mobileSlides,
                    slidesToScroll: 1,
                    arrows: false,
                    dots: true
                }
            }]
        });
    }

    /**
     * Report the impression for a row, at most once.
     * @param {Element} row - The .ts-sb-row element
     */
    function recordImpression(row) {
        if (row.getAttribute('data-ts-seen') === 'true') {
            return;
        }

        row.setAttribute('data-ts-seen', 'true');

        if (window.ProductEngagement) {
            window.ProductEngagement.recordView(trackingParams(row));
        }
    }

    /**
     * Fire each row's impression once at least half of it has been scrolled into view.
     * Browsers without IntersectionObserver report immediately instead.
     * @param {Array<Element>} rows - The .ts-sb-row elements
     */
    function observeImpressions(rows) {
        if (!window.IntersectionObserver) {
            rows.forEach(recordImpression);
            return;
        }

        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    recordImpression(entry.target);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });

        rows.forEach(function (row) {
            observer.observe(row);
        });
    }

    /**
     * Attribute clicks on the creative and on the product tiles to the row they belong to.
     */
    function bindClicks() {
        document.addEventListener('click', function (event) {
            var target = event.target;

            if (!target || !target.closest) {
                return;
            }

            var trackable = target.closest('[data-ts-sb-creative], [data-ts-sb-product]');

            if (!trackable) {
                return;
            }

            var row = trackable.closest('[data-ts-sb-row]');

            if (!row || !window.ProductEngagement) {
                return;
            }

            window.ProductEngagement.recordInteraction(trackingParams(row));
        });
    }

    /**
     * Set up every sponsored brand row currently in the document.
     */
    function setup() {
        if (initialized) {
            return;
        }

        var rows = [].slice.call(document.querySelectorAll('[data-ts-sb-row]'));

        if (!rows.length) {
            return;
        }

        initialized = true;
        rows.forEach(initCarousel);
        observeImpressions(rows);
        bindClicks();
    }

    /**
     * main.js is deferred, so jQuery and Slick are normally in place by DOMContentLoaded.
     * Poll briefly rather than depend on that ordering holding.
     * @param {number} attempt - The current attempt count
     */
    function whenReady(attempt) {
        if (window.$ && window.$.fn && window.$.fn.slick) {
            setup();
            return;
        }

        if (attempt >= READY_MAX_ATTEMPTS) {
            console.warn('Sponsored brands: jQuery or Slick never became available, carousels will not initialize');
            return;
        }

        setTimeout(function () {
            whenReady(attempt + 1);
        }, READY_RETRY_MS);
    }

    /**
     * Entry point.
     */
    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                whenReady(0);
            });
        } else {
            whenReady(0);
        }
    }

    init();

    return {
        init: init,
        setup: setup
    };
})();
