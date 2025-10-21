# Implementation Instructions for Topsort Auctions Cartridge v1.1.0

This guide provides step-by-step instructions for implementing the new features introduced in v1.1.0, including multi-banner support, product grid normalization, and device detection.

---

## Table of Contents

1. [Overview of Changes](#overview-of-changes)
2. [Prerequisites](#prerequisites)
3. [Implementation Steps](#implementation-steps)
   - [Step 1: Update Banner Configuration](#step-1-update-banner-configuration)
   - [Step 2: Implement Multi-Banner Display](#step-2-implement-multi-banner-display)
   - [Step 3: Configure Product Placement](#step-3-configure-product-placement)
   - [Step 4: Test Implementation](#step-4-test-implementation)
4. [Advanced Configuration](#advanced-configuration)
5. [Troubleshooting](#troubleshooting)

---

## Overview of Changes

Version 1.1.0 introduces the following major enhancements:

1. **Multi-Banner Support**: Support for up to 6 banner slots (3 for category pages, 3 for search pages)
2. **Device Detection**: Banners can be targeted to mobile or desktop devices
3. **Product Grid Normalization**: Products are automatically arranged in rows of 4
4. **Enhanced Helper Utilities**: New helper functions for auction creation and product placement
5. **Dual Endpoint Support**: Works with both `Search.Show` and `Search.UpdateGrid`

---

## Prerequisites

- Existing Topsort Auctions Cartridge v1.0.x installed
- Access to Business Manager
- WebDAV or IDE access to cartridge files
- Basic understanding of SFCC ISML templates

---

## Implementation Steps

### Step 1: Update Banner Configuration

1. **Navigate to Banner Configuration File**
   - Location: `/cartridge/scripts/config/topsort_banners.json`

2. **Update Configuration for Multiple Banners**

   Replace the existing configuration with the new 6-slot structure:

   ```json
   [
     { "slotId": "category-top", "slots": 1, "type": "category" },
     { "slotId": "category-side", "slots": 1, "type": "category" },
     { "slotId": "category-bottom", "slots": 1, "type": "category" },
     { "slotId": "search-top", "slots": 1, "type": "search" },
     { "slotId": "search-side", "slots": 1, "type": "search" },
     { "slotId": "search-bottom", "slots": 1, "type": "search" }
   ]
   ```

3. **Understanding Configuration Fields**
   - `slotId`: Unique identifier for the banner slot (must match ISML template references)
   - `slots`: Number of banner slots to request from auction (usually 1)
   - `type`: Either `"search"` (for search results) or `"category"` (for category browsing)

---

### Step 2: Implement Multi-Banner Display

The cartridge automatically handles banner auctions, but you need to ensure your templates display the banners correctly.

#### Category Pages

Add the following banner slots to your category page template:

```isml
<!-- Top Banner (Above Search Results) -->
<isset name="categoryTopBanner" value="${pdict.bannerWinners['category-top']}" scope="page" />
<isif condition="${categoryTopBanner && categoryTopBanner.url}">
    <div class="featured-content-container" style="margin-bottom: 1rem;">
        <a href="${categoryTopBanner.redirectionUrl}" target="_blank" rel="noopener">
            <img src="${categoryTopBanner.url}" alt="Featured Content" style="width: 100%; border-radius: 12px;" />
        </a>
    </div>

    <isif condition="${categoryTopBanner.bidId}">
        <script>
        if (window.ProductEngagement) {
            ProductEngagement.setupContentTracking({
                userId: '${pdict.tsuid || ""}',
                position: 1,
                page: ${pdict.productSearch.page || 1},
                pageSize: ${pdict.productSearch.hitsPerPage || 12},
                categoryId: '${pdict.request.querystring.cgid || ""}',
                resolvedBidId: '${categoryTopBanner.bidId || ""}'
            });
        }
        </script>
    </isif>
</isif>

<!-- Side Banner (In Refinement Sidebar) -->
<isset name="categorySideBanner" value="${pdict.bannerWinners['category-side']}" scope="page" />
<isif condition="${categorySideBanner && categorySideBanner.url}">
    <div class="refinement-bar__banner" style="padding: 1rem 0;">
        <a href="${categorySideBanner.redirectionUrl}" target="_blank" rel="noopener">
            <img src="${categorySideBanner.url}" alt="Category Banner" style="width: 100%; border-radius: 12px;" />
        </a>
    </div>

    <isif condition="${categorySideBanner.bidId}">
        <script>
        if (window.ProductEngagement) {
            ProductEngagement.setupContentTracking({
                userId: '${pdict.tsuid || ""}',
                position: 2,
                page: ${pdict.productSearch.page || 1},
                pageSize: ${pdict.productSearch.hitsPerPage || 12},
                categoryId: '${pdict.request.querystring.cgid || ""}',
                resolvedBidId: '${categorySideBanner.bidId || ""}'
            });
        }
        </script>
    </isif>
</isif>

<!-- Bottom Banner (Below Product Grid) -->
<isset name="categoryBottomBanner" value="${pdict.bannerWinners['category-bottom']}" scope="page" />
<isif condition="${categoryBottomBanner && categoryBottomBanner.url}">
    <div class="featured-content-container" style="margin-top: 1rem;">
        <a href="${categoryBottomBanner.redirectionUrl}" target="_blank" rel="noopener">
            <img src="${categoryBottomBanner.url}" alt="Featured Content" style="width: 100%; border-radius: 12px;" />
        </a>
    </div>

    <isif condition="${categoryBottomBanner.bidId}">
        <script>
        if (window.ProductEngagement) {
            ProductEngagement.setupContentTracking({
                userId: '${pdict.tsuid || ""}',
                position: 3,
                page: ${pdict.productSearch.page || 1},
                pageSize: ${pdict.productSearch.hitsPerPage || 12},
                categoryId: '${pdict.request.querystring.cgid || ""}',
                resolvedBidId: '${categoryBottomBanner.bidId || ""}'
            });
        }
        </script>
    </isif>
</isif>
```

#### Search Pages

Add similar banner slots for search pages using `search-top`, `search-side`, and `search-bottom` slot IDs.

---

### Step 3: Configure Product Placement

The product placement and grid normalization are handled automatically by the cartridge. However, you can customize the behavior by modifying the helper functions.

#### Understanding Product Placement Logic

The cartridge places sponsored products in specific positions:

1. **First 2 winners**: Positions 0 and 1 (top of grid)
2. **Next 2 winners**: Positions 6 and 7 (after first row on desktop)
3. **Last 2 winners**: Second-to-last and last positions

#### Customizing Product Placement

To customize placement logic:

1. Open `/cartridge/scripts/helpers/topsortHelpers.js`
2. Locate the `placeTheSponsoredProducts` function
3. Modify the placement arrays as needed:

```javascript
// Example: Place all sponsored products at the top
function placeTheSponsoredProducts(sponsoredProducts, originalEntries) {
    return sponsoredProducts.concat(originalEntries);
}
```

#### Grid Normalization

The `normalizeProductsToRowsOfFour` function ensures products display in complete rows:

- If product count is divisible by 4, no changes
- Otherwise, randomly removes 1-3 non-sponsored products from the last 10 items
- Maintains sponsored product positions

**Note**: Grid normalization is automatically applied. To disable it, comment out the call in `Search.js`:

```javascript
// viewData.productSearch.productIds = topsortHelpers.normalizeProductsToRowsOfFour(productsWithSponsored);
viewData.productSearch.productIds = productsWithSponsored;
```

---

### Step 4: Test Implementation

#### Testing Checklist

1. **Verify Banner Display**
   - [ ] Top banner displays on category pages
   - [ ] Side banner displays in refinement sidebar
   - [ ] Bottom banner displays below product grid
   - [ ] Same for search pages with search-specific banners

2. **Verify Device Targeting**
   - [ ] Test on mobile device (or use browser DevTools mobile emulation)
   - [ ] Test on desktop browser
   - [ ] Verify correct banners are served for each device type

3. **Verify Product Placement**
   - [ ] Sponsored products appear in correct positions
   - [ ] "Featured" label displays on sponsored products
   - [ ] Product grid displays in rows of 4

4. **Verify Event Tracking**
   - [ ] Banner impression events fire on page load
   - [ ] Banner click events fire when banner is clicked
   - [ ] Product impression events fire for sponsored products
   - [ ] Product click events fire when sponsored products are clicked

#### Testing Commands

Use browser DevTools Console to verify tracking:

```javascript
// Check if ProductEngagement is initialized
console.log(window.ProductEngagement);

// Monitor network requests to Topsort API
// Filter by "topsort" or "events" in Network tab
```

---

## Advanced Configuration

### Custom Banner Positions

To add additional banner positions:

1. **Update `topsort_banners.json`**:
   ```json
   { "slotId": "custom-position", "slots": 1, "type": "category" }
   ```

2. **Add ISML template code**:
   ```isml
   <isset name="customBanner" value="${pdict.bannerWinners['custom-position']}" scope="page" />
   ```

3. **Update position tracking**:
   ```javascript
   position: 4, // Use next available position number
   ```

### Dynamic Banner Configuration

To enable/disable banners dynamically based on business logic:

1. Create a custom site preference for banner control
2. Modify `Search.js` to filter banner configurations:

```javascript
var activeBanners = collections.filter(topsortConfig, function(config) {
    return Site.getCurrent().getCustomPreferenceValue('enable_' + config.slotId);
});
```

### Product Placement Strategies

Different placement strategies can be implemented:

**Strategy 1: Top-Heavy**
```javascript
// Place all sponsored products at the top
return sponsoredProducts.concat(originalEntries);
```

**Strategy 2: Even Distribution**
```javascript
// Place sponsored products every N positions
var result = [];
var sponsoredIndex = 0;
for (var i = 0; i < originalEntries.length; i++) {
    if (i % 3 === 0 && sponsoredIndex < sponsoredProducts.length) {
        result.push(sponsoredProducts[sponsoredIndex++]);
    }
    result.push(originalEntries[i]);
}
```

**Strategy 3: Random Placement**
```javascript
// Randomly insert sponsored products
var combined = originalEntries.slice();
sponsoredProducts.forEach(function(product) {
    var randomIndex = Math.floor(Math.random() * combined.length);
    combined.splice(randomIndex, 0, product);
});
```

---

## Troubleshooting

### Banners Not Displaying

**Possible Causes**:
1. Banner configuration doesn't match ISML template slot IDs
2. No winning bids from auction
3. Template cache not cleared

**Solutions**:
- Verify `slotId` values in `topsort_banners.json` match ISML template references
- Check Business Manager logs for auction errors
- Clear template cache: Business Manager > Administration > Sites > Manage Sites > [Your Site] > Cache

### Products Not Arranged in Rows of 4

**Possible Causes**:
1. Grid normalization function not being called
2. CSS styling overriding grid layout

**Solutions**:
- Verify `normalizeProductsToRowsOfFour` is called in `Search.js`
- Check CSS grid classes in your theme
- Inspect HTML to confirm correct number of product tiles

### Device Detection Not Working

**Possible Causes**:
1. User agent string not being parsed correctly
2. Auction not receiving device parameter

**Solutions**:
- Check `request.httpUserAgent` value in debugger
- Verify device parameter in auction request payload
- Test with different user agent strings

### Event Tracking Not Firing

**Possible Causes**:
1. `ProductEngagement` module not initialized
2. `resolvedBidId` missing from view data
3. Tracking disabled in site preferences

**Solutions**:
- Verify `ProductEngagement.init()` is called before tracking functions
- Check `pdict.topsortTrackingEnabled` is `true`
- Inspect network requests for event payloads

---

## Support

For additional support:
- Refer to the main [README.md](README.md) for general cartridge documentation
- Check [CHANGELOG.md](CHANGELOG.md) for version-specific changes
- Contact your Topsort integration engineer with:
  - Cartridge version number
  - Business Manager logs
  - Example request/response payloads
  - Screenshots of configuration
