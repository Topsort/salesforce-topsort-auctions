# Topsort × HITES — Cartridge Guide

This branch (`feat/agus/hites-integration`) contains the **production-ready** `topsort_auctions_custom` cartridge as deployed to HITES via Bitbucket PR **HITE01A-795** (merged to `develop` in `viseocommerce/hites`).

Use this document to understand how the integration works on the HITES SFRA storefront, what to configure in Business Manager, and how to validate it in QA.

---

## What this cartridge does

| Feature | Where it runs | What happens |
|---|---|---|
| **Sponsored listings** | Search pages + category PLPs | Calls Topsort `/v2/auctions`, merges winners into the product grid |
| **Banner auctions** | Search + category pages | Up to 6 slots (`search-top`, `search-side`, `search-bottom`, `category-top`, `category-side`, `category-bottom`) |
| **Impression / click tracking** | Browser (`product-engagement.js`) | Sends events to Topsort `/v2/events` |
| **Purchase tracking** | `Order-Confirm` | Sends purchase events server-side via `TopsortService` |
| **"Patrocinado" label** | Product tile | Gray label below price on sponsored SKUs |
| **SKU deduplication** | Grid merge logic | If a SKU wins auction, its organic duplicate is removed from the grid |

Everything is **fail-open**: if Topsort is disabled, misconfigured, or the API errors, the storefront renders normally without sponsored content.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  product-engagement.js  →  POST api.topsort.com/v2/events       │
└───────────────────────────────▲─────────────────────────────────┘
                                │ impressions / clicks
┌───────────────────────────────┴─────────────────────────────────┐
│  topsort_auctions_custom (this cartridge, first in cartridge path) │
├─────────────────────────────────────────────────────────────────────┤
│  Search.js          → append Show / ShowAjax (search + AJAX grid)  │
│  productList.js     → Page Designer category PLP component         │
│  Order.js           → append Confirm (purchase events)           │
│  Tile.js            → passes isSponsored to product tile         │
│  TopsortService.js  → HTTP client (LocalServiceRegistry)        │
│  topsortHelpers.js  → placement, dedup, grid normalization       │
└───────────────────────────────▲─────────────────────────────────────┘
                                │ POST api.topsort.com/v2/auctions
┌───────────────────────────────┴─────────────────────────────────┐
│  HITES SFRA (app_storefront_hites + module_pagedesigner)         │
└──────────────────────────────────────────────────────────────────┘
```

### Two render paths on HITES

HITES uses **two different flows** for product listing pages. This cartridge handles both:

#### 1. Search pages (`Search-Show` / `Search-ShowAjax`)

- **Controller:** `cartridge/controllers/Search.js` appends to `Show` and `ShowAjax`.
- **Template:** `templates/default/search/searchResultsNoDecorator.isml` (banners + tracking init).
- **Grid:** `templates/default/search/components/productTiles.isml` (per-tile tracking scripts).
- **Tile:** `templates/default/product/productTile.isml` override renders **"Patrocinado"**.

#### 2. Category PLPs via Page Designer

HITES category pages call `res.page()` and never set `productSearch` in `Search.js`. Topsort runs in the **PD component** instead:

- **Component script:** `experience/components/dynamic/productList.js` (auction + winner matching).
- **Templates** (cartridge overrides, take precedence over `module_pagedesigner`):
  - `experience/.../productList/productList.isml` — loads `product-engagement.js` + init.
  - `experience/.../productList/categoryResults.isml` — category banners.
  - `experience/.../productList/productGrid_hites.isml` — grid loop + per-product tracking.

The PD component must be assigned to category pages in Page Designer (HITES already does this).

---

## File map

```
cartridge/
├── client/default/
│   ├── js/product-engagement.js      # Browser tracking library (webpack entry)
│   └── css/topsort-sponsored.scss    # "Patrocinado" label styles (webpack entry)
├── controllers/
│   ├── Search.js                     # Search + ShowAjax auction integration
│   ├── Order.js                      # Purchase events on Order-Confirm
│   └── Tile.js                       # isSponsored flag on Tile-Show
├── experience/
│   ├── components/dynamic/productList.js   # PD category auction logic
│   ├── components/dynamic/productList.json # PD component metadata
│   └── pages/productList.js                # PD page script
├── scripts/
│   ├── services/TopsortService.js    # API client (auctions, events, purchases)
│   ├── helpers/topsortHelpers.js     # Placement, dedup, row-of-4 normalization
│   ├── util/collections.js           # Array helpers
│   └── config/
│       ├── topsort_banners.json      # Banner slot definitions
│       └── topsortMockTypes.json     # Service mock config
├── metadata/
│   └── topsort_sponsored_metadata.xml  # Site prefs definition (reference)
└── templates/default/
    ├── product/productTile.isml        # "Patrocinado" label in tile
    ├── search/
    │   ├── searchResultsNoDecorator.isml
    │   └── components/productTiles.isml
    └── experience/.../productList/   # PD template overrides (3 files)
```

---

## Installation on HITES

This cartridge alone is not enough. The HITES Bitbucket repo (`viseocommerce/hites`) also includes project-level changes from HITE01A-795:

| Change | Location in HITES repo | Required? |
|---|---|---|
| Cartridge code | `cartridges/topsort_auctions_custom/` | Yes |
| Webpack bundle entry | `webpack.config.js` | Yes |
| Service definition | `metadata/services.xml` | Yes (import) |
| Site preferences | `metadata/meta/SitePreferences-Metadata.xml` | Yes (import) |
| PD templates (legacy copy) | `module_pagedesigner/...` | Optional* |
| `package-lock.json` fix | root | Yes (featherlight / build fix) |

\*The cartridge now overrides the PD templates via cartridge path precedence. The copies in `module_pagedesigner` are redundant but harmless.

### 1. Cartridge path

In Business Manager → Site → HITES → Settings:

```
topsort_auctions_custom : app_storefront_hites : module_pagedesigner : ...
```

`topsort_auctions_custom` **must be first**.

### 2. Metadata import

Import from the HITES `metadata/` folder (not only the cartridge XML):

| File | Creates |
|---|---|
| `metadata/services.xml` | Service `topsort`, credential `topsort.http.cred`, profile `topsort.http.prof` |
| `metadata/meta/SitePreferences-Metadata.xml` | Prefs: `topsortEnabled`, `topsortApiKey`, `topsortApiURL`, `topsortTrackingEnabled` |

The cartridge file `metadata/topsort_sponsored_metadata.xml` is a **standalone reference** for greenfield installs. On HITES, the project metadata files above are authoritative.

### 3. Site preferences (values)

Merchant Tools → Site Preferences → Custom Preferences → **Topsort**:

| Preference | Value |
|---|---|
| `topsortEnabled` | `true` |
| `topsortTrackingEnabled` | `true` |
| `topsortApiKey` | API key from Topsort |
| `topsortApiURL` | `https://api.topsort.com` |

### 4. Build client assets

From the HITES project root (Node **10.18.0**):

```bash
yarn install
yarn run webpack:prd   # or webpack:dev for watch + upload
```

This compiles `product-engagement.js` and `topsort-sponsored.css` into `cartridges/topsort_auctions_custom/cartridge/static/`.

`webpack.config.js` must include:

```js
WebpackBundle.forCartridge("topsort_auctions_custom")
```

### 5. Post-deploy

- Invalidate page + code cache in BM.
- Confirm service `topsort` is enabled under Administration → Operations → Services.

---

## Runtime behavior

### When auctions run

Auctions execute when **all** of these are true:

1. `topsortEnabled` site pref is `true`.
2. Valid `topsortApiKey` and reachable `topsortApiURL`.
3. No **non-category** refinements are active (facets/filters disable sponsored products by design).
4. `productSearch` exists with product IDs (Search path) or PD component has results (category path).

### Sponsored product placement

`topsortHelpers.placeTheSponsoredProducts()` inserts up to 6 winners:

| Winners | Positions (0-based) |
|---|---|
| 1–2 | 0, 1 (top of grid) |
| 3–4 | 7, 8 |
| 5–6 | second-to-last, last |

Before placement, **deduplication** removes organic entries whose `productID` matches a sponsored winner.

`normalizeProductsToRowsOfFour()` trims the grid to keep rows of 4 (HITES grid layout).

### Banner slots

Configured in `scripts/config/topsort_banners.json`. Each entry maps a `slotId` to auction type (`search` or `category`). Templates render a banner only when `pdict.bannerWinners[slotId]` has a URL.

To change slot geometry or add slots, edit the JSON and the corresponding ISML blocks in the search / category templates.

### User identity (`tsuid` cookie)

- Set on first auction request (server-side).
- Passed to browser tracking as `userId`.
- Used for purchase events on `Order-Confirm`.
- HttpOnly, 1-year TTL.

### Tracking events

| Event | Trigger | Layer |
|---|---|---|
| Impression | Product tile visible / banner rendered | Browser (`ProductEngagement.setupItemTracking` / `setupContentTracking`) |
| Click | User clicks sponsored product or banner | Browser |
| Purchase | Order confirmation page loads | Server (`TopsortService.sendPurchaseEvent`) |

Tracking only fires when `topsortTrackingEnabled` is `true`.

### "Patrocinado" label

- Rendered in `templates/default/product/productTile.isml` when `pdict.isSponsored === true`.
- `Tile.js` sets `isSponsored` from the `Tile-Show` querystring.
- Styled by `topsort-sponsored.scss` (gray, small, right-aligned below price).
- Hardcoded text: **Patrocinado** (HITES CL requirement).

---

## QA checklist

### Search

- [ ] `/busqueda?q=smart` — products visible, no blank grid.
- [ ] Sponsored products show **Patrocinado** bottom-right of price.
- [ ] Winners at positions 0–1 and 6–7 (when 4+ sponsored).
- [ ] No duplicate SKUs (sponsored + organic).
- [ ] Applying a filter does not break the page (sponsored hidden, by design).

### Category (Page Designer)

- [ ] Category PLP (e.g. smartphones) — products visible.
- [ ] Patrocinado on sponsored tiles.
- [ ] Banners render when campaigns exist (`category-top`, `category-side`, `category-bottom`).

### Tracking

- [ ] Network: `api.topsort.com/v2/auctions` (server).
- [ ] Network: `api.topsort.com/v2/events` (browser).
- [ ] Purchase event after buying a sponsored product.

### Kill switch

- [ ] `topsortEnabled = false` → site behaves exactly as before Topsort.

### Regression

- [ ] Facets / filters on category pages still work.
- [ ] PDP, cart, checkout unaffected.
- [ ] Client JS healthy (no `featherlight` / `spinner` console errors after webpack build).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Blank product grid | Client JS build broken or `loading` class stuck | Run `yarn run webpack:prd`; check console for featherlight/spinner errors |
| No sponsored products | API key, prefs, or active filters | Check site prefs; remove non-category refinements |
| No Patrocinado label | `isSponsored` not passed or CSS not built | Verify cartridge path; rebuild webpack |
| `TypeError` on search page | Old template using `pdict.request.querystring` | Ensure latest `searchResultsNoDecorator.isml` (uses `topsortCategoryId`) |
| PD category crash | Missing `productSearch` guard | Ensure latest `Search.js` and `productList.js` |
| No purchase events | Order controller not loaded | Verify cartridge path includes `topsort_auctions_custom` |
| Service errors in logs | Metadata not imported | Import `metadata/services.xml` from HITES repo |

Logs: `SponsoredSearch` and `TopsortService` log categories in BM.

---

## Relationship to other branches

| Branch | Purpose |
|---|---|
| `main` | Generic Topsort SFCC cartridge (pre-HITES customizations) |
| `hitesv2` | Earlier HITES reconcile (superseded by this branch) |
| `feat/agus/hites-integration` | **Current** — full HITES integration including PD, Patrocinado, dedup, fail-open guards |

---

## Support

For HITES deployment issues, refer to the merged Bitbucket PR **HITE01A-795** on `viseocommerce/hites`. For Topsort API / campaign configuration, contact the Topsort integrations team.
