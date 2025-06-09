## **Topsort Sponsored Search Cartridge**

This cartridge integrates Topsort’s auction-based sponsored product placement into Salesforce B2C Commerce (SFCC) search results, including both product listings and promotional banners.

---

## Metadata Import

1. **Open Import & Export**
   In Business Manager, navigate to **Administration** > **Site Development** > **Import & Export**.
2. **Upload Metadata File**
   Under **Import & Export Files**, upload:

   ```
   /cartridge/metadata/topsort_sponsored_metadata.xml
   ```

   ![Import & Export Files](https://i.imgur.com/bW9ndOl.png)
3. **Select and Import**
   Switch to the **MetaData** section, select the uploaded `topsort_sponsored_metadata.xml`, and click **Import**.
   ![Select Metadata File](https://i.imgur.com/8GR2Ns1.png)
   ![Import Metadata](https://i.imgur.com/I9fn9RI.png)
4. **Configure Preferences**
   After importing, go to **Merchant Tools** > **Select Your Site** > **Site Preferences** > **Custom Preferences** > **Topsort** to set your API settings.
   ![Custom Preferences](https://i.imgur.com/VGR1oQk.png)

---

## Prerequisites

* SFCC instance (Sandbox or Production) with WebDAV access
* Topsort API key (Bearer token)
* Node.js (optional, for local testing/build scripts)

---

## Installation

1. **Upload Cartridge**
   Mirror the cartridge directory into your SFCC WebDAV under:

   ```
   Cartridges/topsort_sponsored
   ```
2. **Cartridge Path**
   In Business Manager: **Administration** > **Sites** > **Manage Sites** > **Manage Sites** > **Settings** > **Cartridge Path**.
   Add `topsort_sponsored` (and any dependencies, e.g., `app_storefront_base`) at the front.
3. **Clear & Rebuild**

   * Clear code and view caches.
   * Restart your sandbox if needed.

---

## Custom Preferences

In **Merchant Tools** > **Select Your Site** > **Site Preferences** > **Custom Preferences** > **Topsort**:

* **topsortApiURL** — Base URL for Topsort API (e.g., `https://api.topsort.com`).
* **topsortApiKey** — Your Topsort bearer token.
* **topsortCookieMaxAge** — Cookie TTL in seconds (default: `86400`).

---

## Configuration Files

* **Banner Slots**

  * File: `/cartridge/scripts/config/topsort_banners.json`
  * Defines banner slot IDs, slot counts, and types (`search` or `category`).

  ```json
  [
    { "slotId": "banner-1", "slots": 1, "type": "search" },
    { "slotId": "cat-banner", "slots": 2, "type": "category" }
  ]
  ```

---

## Controller Logic

### Search Controller

* **File**: `/cartridges/topsort_auctions/cartridge/controllers/Search.js`
* **Flow**:

  1. Extend base `Search-Show` controller.
  2. Read `viewData.productSearch.productIds`, extract `productIDs`, `searchQuery` (q), and `categoryId` (cgid).
  3. Manage cookies:

     * `tsuid`: generate/return a UUID cookie for user tracking.
     * `topsortLastQuery`: store last search query.
  4. Build auctions array:

     * **Listings auction**: type=`listings`, slots = number of products, include `searchQuery` or `category`.
     * **Banner auctions**: iterate `topsort_banners.json`, map each config to an auction object.
  5. Call `TopsortService.runAuction(auctionRequest)`.
  6. On success:

     * Extract `winners` for listings and set `isSponsored` and `resolvedBidId` on matching entries.
     * Reorder `productSearch.productIds` to place sponsored items first.
     * Extract banner winner URL and bid ID into `viewData.featuredContentUrl` and `viewData.featuredContentBidId`.
  7. Populate additional `viewData`:

     * `topsortApiKey`, `topsortApiURL`, `topsortTrackingEnabled` (from `TopsortService.getClientConfig()`).
     * `tsuid` for client-side tracking.
  8. `res.setViewData(viewData)` and call `next()`.

### Order Controller

* **File**: `/cartridge/controllers/Order.js`
* **Flow**:

  1. Extend `Order-Confirm` endpoint.
  2. Retrieve order by `req.querystring.ID`.
  3. Read `tsuid` cookie for `opaqueUserId`.
  4. Call `TopsortService.sendPurchaseEvent(order, opaqueUserId)` to record conversion.
  5. Log errors if event fails.

---

## Service Wrapper

* **File**: `/cartridge/scripts/services/TopsortService.js`
* **Responsibilities**:

  * `runAuction(request)`: performs HTTP call to Topsort auction API.
  * `sendPurchaseEvent(order, userId)`: POSTs purchase data.
  * `getClientConfig()`: returns API key, URL, and tracking flag for front-end.

---

## Front-End Integration (ISML & JS)

### Product Tiles

* **File**: `/cartridge/templates/default/search/components/productTiles.isml`
* **Sponsored Markup**:

  ```html
  <div class="featured-item-label">Featured</div>
  <script>
    ProductEngagement.setupItemTracking({
      productId: '${product.productID}',
      userId: '${pdict.tsuid}',
      position: ${loopStatus.index+1},
      page: ${pdict.productSearch.page},
      pageSize: ${pdict.productSearch.hitsPerPage},
      categoryId: '${pdict.request.querystring.cgid}',
      resolvedBidId: '${product.resolvedBidId}'
    });
  </script>
  ```
* Customize the `.featured-item-label` or reposition as needed.

### Banner Display

* **File**: `/cartridge/templates/default/search/searchResultsNoDecorator.isml`
* **Banner HTML**:

  ```html
  <div id="featured-content" class="featured-content-container">
    <a href="${pdict.featuredContentUrl}" target="_blank">
      <img src="${pdict.featuredContentUrl}" alt="Featured Content" style="width:100%;" />
    </a>
  </div>
  <script>
    ProductEngagement.setupContentTracking({
      userId: '${pdict.tsuid}',
      position: 1,
      page: ${pdict.productSearch.page},
      pageSize: ${pdict.productSearch.hitsPerPage},
      categoryId: '${pdict.request.querystring.cgid}',
      resolvedBidId: '${pdict.featuredContentBidId}'
    });
  </script>
  ```
* Feel free to move this block; include the `<script>` to retain tracking.

### Client-Side SDK

* **Include**:

  ```html
  <script src="${URLUtils.staticURL('/js/product-engagement.js')}"></script>
  <script>
    ProductEngagement.init({
      apiURL: '${pdict.topsortApiURL}',
      apiKey: '${pdict.topsortApiKey}',
      trackingEnabled: ${pdict.topsortTrackingEnabled}
    });
  </script>
  ```
* Ensures event calls from front-end components reach Topsort.

---

## Usage

1. Search on storefront (`/s?q=example`).
2. View products; sponsored items appear first with a "Featured" label.
3. Banners display above results when configured.
4. Impression and click events are tracked automatically.

---

## Troubleshooting

* **No sponsored items**: Check `topsortApiKey`, cookie TTL, and that auctions return winners.
* **No banners**: Verify `topsort_banners.json` mapping and `featuredContentUrl` in view data.
* **Missing events**: Open console to see if `ProductEngagement` calls execute; ensure `trackingEnabled` is `true`.
* **Server errors**: Inspect `logs/SponsoredSearch` and `logs/OrderEvent` for stack traces.

---

## Support

Reach out to your Topsort integration engineer or SFCC support with cartridge logs and configuration screenshots.
