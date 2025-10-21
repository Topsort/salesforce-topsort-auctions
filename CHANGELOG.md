# Changelog

## 1.1.0 (20 Oct, 2025)

### New Features
* Added core infrastructure for sponsored products with helper utilities and collection functions
* Implemented multi-banner support with up to 6 configurable banner slots (3 for category pages, 3 for search pages)
* Added device detection (mobile/desktop) for targeted banner auctions
* Introduced product grid normalization to ensure products display in complete rows of 4
* Added support for both `Search.Show` and `Search.UpdateGrid` endpoints
* Implemented product validation to skip invalid auction winners

### Enhancements
* Refactored service layer to use LocalServiceRegistry for improved reliability
* Enhanced banner placement with position-based tracking (top, side, bottom)
* Added index-based banner result matching for improved accuracy
* Improved banner configuration with independent slot IDs and types

### Bug Fixes
* Fixed product removal calculation in grid normalization function

## 1.0.1 (17 Jul, 2025)
* Added guard to disable sponsored products when non-category facets/refinements are applied to search results

## 1.0.0 (9 Jun, 2025)

* Initial release of Topsort Sponsored Search Cartridge
* Added **Metadata Import** steps with screenshots for Business Manager setup
* Defined **Prerequisites**, **Installation**, and **Custom Preferences** sections
* Provided **Configuration Files** example for banner slot management
* Detailed **Controller Logic** for `Search.js` and `Order.js` with cookie handling, auction construction, and response processing
* Outlined **Service Wrapper** interface in `TopsortService.js`
* Included **Front-End Integration** snippets for ISML templates (`productTiles.isml`, `searchResultsNoDecorator.isml`) and client-side SDK initialization
* Documented **Usage**, **Troubleshooting**, and **Support** guidelines
