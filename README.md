# salesforce_topsort_auctions

Topsort retail media for the HITES SFRA storefront. Two formats:

- **Sponsored listings** — an auction on search and category listing pages whose winning
  products are merged into the grid and labelled **Patrocinado**.
- **Sponsored banners** — seven image slots across the home page, search and category pages,
  each filled by its own auction. See [Sponsored banners](#sponsored-banners).

Impressions, clicks and purchases are reported back to Topsort through a server-side relay,
so the marketplace API key never reaches the browser.

Everything is **fail-open**: when the integration is disabled, misconfigured, refined by the
shopper, or the API errors out, the storefront renders exactly as it would without this
cartridge. Every route this cartridge appends to is wrapped, so an unexpected exception in
Topsort code ends as a log line and never as an error page — see
[Error containment](#error-containment).

> **Banner review findings are resolved in code.** Before enabling them, import the updated
> metadata, configure the creative host allowlist, and start with a low auction traffic share.
> See [Resolved review findings](#resolved-review-findings).

> **This is the only Topsort cartridge on the HITES path.** `metadata/sites/HITES/site.xml`
> lists `salesforce_topsort_auctions` first and no other Topsort cartridge at all. If a
> sandbox code version still carries `topsort_auctions` or `topsort_auctions_custom` from an
> earlier prototype, they are dead weight — see [Cartridge inventory](#cartridge-inventory).

---

## Contents

- [HITES integration boundary and shutdown](#hites-integration-boundary-and-shutdown)
- [Resolved review findings](#resolved-review-findings)
- [Cartridge inventory](#cartridge-inventory)
- [What is implemented](#what-is-implemented)
- [Architecture](#architecture)
- [File map](#file-map)
- [Runtime behaviour](#runtime-behaviour)
- [Sponsored banners](#sponsored-banners)
- [Error containment](#error-containment)
- [Page cache impact](#page-cache-impact)
- [Configuration reference](#configuration-reference)
- [Deployment steps](#deployment-steps)
- [Known issue: services.xml XSD validation](#known-issue-servicesxml-xsd-validation)
- [QA checklist](#qa-checklist)
- [Not implemented and open items](#not-implemented-and-open-items)

---

## HITES integration boundary and shutdown

All runtime code for sponsored listings, banners and event reporting lives in
`salesforce_topsort_auctions`. Removing that cartridge from the HITES Cartridge Path stops its
controllers, template overrides, scripts and tracking code.

The installation is not completely self-contained as SFCC content and configuration. The
following records live outside the cartridge:

- Site preferences, service credentials and the `topsort` service profile in Business Manager.
- The Cartridge Path and active code version.
- The three `Topsort - Sponsored Banner` component placements on the Page Designer home page.
- Banner slots, campaigns and creatives configured in Topsort.

Those external records do not execute Topsort code after the cartridge is removed. They remain
as configuration and content references. For a clean physical rollback, HITES should also
remove the three Page Designer components or restore the previous home page version.

HITES can disable the integration without a deployment by setting:

```text
topsortEnabled = false
topsortBannersEnabled = false
topsortTrackingEnabled = false
```

`topsortEnabled` stops listing and banner auctions. `topsortTrackingEnabled` separately stops
browser and purchase events. `topsortBannersEnabled` can be used alone when only banners need
to be disabled.

The complete production setup and rollback procedure is maintained in the
[HITES production rollout manual](https://docs.google.com/document/d/11wEJBo7MKx56KtSbIDYzZbE0bD_IOtJ91LR7va36Rg4/edit?tab=t.0#heading=h.g5elkdc0eykm).

---

## Resolved review findings

From an adversarial review of the banner work on **2026-08-31**, run as four independent
passes (runtime, security, premortem, cold-start implementer). Every item below was verified
against the code afterwards; findings that did not survive verification are listed at the end
so nobody chases them again.

All blocking and high findings are resolved in the implementation:

- Banner fragments and events share an HMAC-derived SFCC session identity until `tsuid`
  exists, avoiding competing first-visit identities without exposing the session token.
- Category context is normalized once and only the slot's actual trigger reaches events.
- The service timeout is 500 ms, rate limiting is enabled, and the shared auction traffic
  percentage controls both listings and banner fragments.
- The event relay requires same-origin JSON with a valid CSRF token. Bid proofs are signed,
  and stable event ids stop replayed interactions from becoming new billable events.
- Creative URLs require HTTPS, reject `srcset` delimiters, and must match the configured
  `topsortBannerAssetHosts` allowlist.
- Banner tracking binds every slick clone by bid data, waits for the image to load before
  measuring viewability, and listing AJAX refreshes replace both banner placements.

The descriptions below are retained as the historical failure mechanisms that each fix must
continue to cover.

### Blocking

**C1 — Each banner fragment mints its own `tsuid`, so auctions and events report different users.**
`topsortBanners.js:217` calls `topsortSession.resolveOpaqueUser()`, which reads
`request.httpCookies` at `topsortSession.js:56`. Every remote include is a separate *request*,
and none of them can see a cookie a sibling fragment set microseconds earlier, because the
browser has not received anything yet. A first-time visitor on the home page therefore runs
three auctions under three different UUIDs, and the impressions the browser posts afterwards
carry a fourth one minted by `Topsort-Event`. At most one of the three auctions can ever be
attributed. The surviving cookie then governs the whole session, so this is not confined to
the first page view. See [the resolved design](#first-visit-identity-on-remote-includes), which was
originally written as a minor caveat and understated it as a single throwaway id.

*Fix directions:* either mint the `tsuid` in a request whose `Set-Cookie` does reach the
browser (a `Home-Show` append, which costs the home page its cache and undoes the reason for
the remote include), or accept degraded first-visit attribution and stop minting inside the
fragment — pass a request-scoped id through, or let the fragment run anonymously when no
cookie exists rather than inventing one per slot.

**C2 — Banner events report the unslugged category id while the auction sends the slugged one.**
`topsortBanners.js:81` slugs the id for the auction
(`resolveTopsortCategoryId`, `sweater_mujer` → `sweater-mujer`), but `:241` echoes the raw
`ctx.categoryId` into `winner.categoryId`, which reaches `placement.categoryIds` on every
impression and click. Category banner reporting will be empty on the Topsort side. This is the
same defect commit `9f60103cf` fixed for listings, reintroduced on the banner path. A second
form of it: on a search scoped to a category both `q` and `cgid` reach the fragment and both
are echoed, so the event claims a category the auction never bid on.

*Fix:* slug it once in `resolveBanner` and echo the slugged value, and echo only the trigger
the slot's `page` type actually used.

**C3 — Up to 4.5s added to the home page, on 100% of views including cache hits.**
`metadata/services.xml` sets `topsort.http.prof` `timeout-millis` to **1500** with the rate
limiter disabled. Remote includes render serially, so three home slots is 3 × 1500 ms worst
case; a PLP is 2 × 1500 ms for banners plus 1500 ms for listings on an uncached render.

This is the hole in the [page cache chapter](#banners-do-not-change-any-of-this). That section
is literally true — no page loses its cache entry — and that is exactly what makes it
misleading. The listings integration's cost is paid on the cache-*miss* fraction. The banner
cost is paid on **every home page view**, because a cache hit still has to resolve three
fragments. The circuit breaker does not help: it opens on errors, not on slowness, and at
`cb-calls 10` roughly four page views elapse before it can trip.

*Fix applied:* `timeout-millis` is 500 ms and the rate limiter is enabled as a load-shedding
valve. See [Page cache impact](#page-cache-impact).

**C4 — There is no ramp control for banners, and the listings one does not exist on this site.**
`resolveBanner` gates on two booleans only (`topsortBanners.js:200`), so banners are 0-to-100
with C3's latency attached. Worse, `topsortAuctionTrafficPercent` — which
[step 3](#3-set-preference-values) tells the operator to set to `1` — **is not defined in
`metadata/meta/SitePreferences-Metadata.xml`**, the file this README names as authoritative.
`isInAuctionTrafficSample` reads `null` and returns `true`, so listings also run on 100% of
traffic today. Neither format has a working ramp.

*Fix:* copy the `topsortAuctionTrafficPercent` definition from
`cartridge/metadata/topsort_sponsored_metadata.xml` into the project metadata, and give
banners either the same sampling or a per-slot enable list.

### High

**H1 — The listings commit removed `SameSite=Lax` from the `tsuid` cookie.**
`topsortSession.js:30` now uses `dw.web.Cookie`, which has no `SameSite` setter. The change is
correct in itself — the previous hand-written header threw
`Header name Set-Cookie is not allowed to be set or added` on every first visit, which is the
crash it was fixing — but the attribute was not re-established anywhere. The instance setting
on bdpn-007 is `None`. Combined with `Topsort-Event` having no CSRF token and no `Origin`
check, a third-party page can use real shoppers' browsers, with their genuine `tsuid`, as a
source of chargeable clicks. Ship the `Origin` check and CSRF token before this reaches
production.

**H2 — `srcset` is concatenated from unvalidated advertiser URLs.**
`banner.isml:37` joins `asset.url + ' ' + asset.width + 'w'`. The `srcset` grammar is space and
comma delimited, so HTML escaping is not the relevant defence: an asset URL containing
`" 1w, https://evil.example/beacon.png"` injects a second candidate and exfiltrates the IP and
User-Agent of every shopper served that slot. `resolveDestination` treats the winner's `id` as
untrusted (`topsortBanners.js:92-110`) but `asset.url` from the same response gets no check at
all. Validate each asset URL is `https:` on an allowlisted host and reject any containing
whitespace or a comma.

**H3 — Slick clones the carousel slides, producing duplicate DOM ids.**
`carousel.js` never sets `infinite`, so slick defaults it to `true` and clones slides for the
infinite loop. Each clone carries `id="ts-banner-home-slider-5"`, so the document has more than
one element with that id; `getElementById` in `setupContentTracking` returns whichever comes
first, and `cloneNode` does not copy event listeners, so a click on a cloned slide reports
nothing. Track by a `data-` attribute and bind to every match, or set `infinite: false` on the
hero.

**H4 — PLP refinements pay for two banner auctions and discard both.**
`app_storefront_hites/.../js/search/search.js:78` replaces `.product-grid` and
`.product-filters-wrapper`. The side banner is a *sibling* of the latter (deliberately, so it
can be sticky) and the footer banner is outside the former, so neither replacement inserts the
new fragment. Every filter click runs two blocking auctions whose output is thrown away, and
the shopper keeps looking at the pre-refinement creative.

**H5 — Impressions fire on the reserved box, not the loaded creative.**
`banner.isml` emits `loading="lazy"` together with `width`/`height`, so the wrapper reaches
full height before the image is fetched. `observeImpression` starts its dwell timer on that
reserved box and there is no load or error handler, so a 404 or a slow creative CDN bills an
impression for a blank slot.

### Medium and notes

- **Two components with the same `slotId`** produce a duplicate DOM id and bind both trackers
  to one element. Nothing in `topsortbanner.json` or `getSlot` prevents it.
- **`sizes: "100vw"` is wrong for the home slots** unless the merchandiser ticks
  `full_width_layout`, which `herobannercarousel.json` defaults to `false` — the hero is capped
  at the 1340px container, so the browser over-fetches.
- **The empty-slot removal script does not work on AJAX-injected fragments.** jQuery re-homes
  script nodes to `document.head`, so `document.currentScript.parentNode` is not the wrapper.
  Leaves a visible gap after a sort or refinement.
- **`banner.isml:7` claims the stylesheet keys off `ts-banner--<slot>`.** No such rule exists;
  the SCSS only styles `.ts-banner-slot--*`. Stale comment.
- **The `trackingInit` `request.custom` guard cannot dedupe across fragments**, since each is
  its own request. The module is idempotent so behaviour is correct, but a home page with three
  winning banners still emits three render-blocking `<script src>` tags into the hero.
- **`topsort-sponsored.scss` imports Bootstrap's default breakpoints, not the HITES ones**
  (`sm: 576px` vs `544px`). Only affects the Patrocinado label alignment; `lg` matches.

### Findings that did not survive verification

Recorded so the next reviewer does not spend time on them:

- *"Home banners can never report an impression because `offsetParent` is null on a hidden
  `.carousel-item`."* Wrong component. The hero is `layouts.herobannercarousel`, which uses
  **slick**, not Bootstrap. The tracking script runs at parse time, before slick initialises on
  `$(document).ready`, when the slides are ordinary visible divs. The real defect in this area
  is H3.
- *"The removal script desyncs the carousel indicators and can strip `carousel-item active`."*
  Same wrong component. Slick builds its dots at init from the live DOM, which happens after
  the removal script has run.

---

## Cartridge inventory

There is one site, `HITES`, and its cartridge path is:

```
salesforce_topsort_auctions:plugin_pagedesigner_sfra:app_storefront_hites:module_pagedesigner:int_viseo_gtm:int_osflicensemanager:lib_productlist:plugin_productcompare:int_dis:app_storefront_base
```

`salesforce_topsort_auctions` is the only Topsort cartridge in it, it is first, and it is the
only one webpack builds.

Two other Topsort cartridges exist as folders in the s007 sandbox snapshot
(`cartridges-s007-31-aug/code_david/`) and are **not used by anything**:

| Cartridge | Status |
| --- | --- |
| `topsort_auctions` | Upstream reference cartridge. Not on the path, not in this repo, not uploaded by the snapshot's own `dw.json`. Superseded by this cartridge. |
| `topsort_auctions_custom` | Hites-specific overlay on top of it, including an earlier banner attempt. Same story. Its banner slots are the ancestors of the ones documented below. |

Neither executes: their `Search.js`, `topsort_banners.json` and banner template blocks are
never resolved. Leaving them on a sandbox code version is confusing rather than dangerous —
there is a second `Search.js` for anyone reading to trip over. To clear them from a sandbox:

```bash
# From a checkout that has a dw.json pointing at the sandbox and code version in question.
# Removing them locally and re-uploading does not delete them server side, so delete the
# folders through the WebDAV code endpoint instead:
curl -X DELETE -u "$SFCC_USER:$SFCC_PASSWORD" \
  "https://<instance>.dx.commercecloud.salesforce.com/on/demandware.servlet/webdav/Sites/Cartridges/<code-version>/topsort_auctions"
curl -X DELETE -u "$SFCC_USER:$SFCC_PASSWORD" \
  "https://<instance>.dx.commercecloud.salesforce.com/on/demandware.servlet/webdav/Sites/Cartridges/<code-version>/topsort_auctions_custom"
```

Then invalidate the code cache in Business Manager.

---

## What is implemented

| Feature | Where it runs | Notes |
| --- | --- | --- |
| Sponsored listings auction | Search pages, category PLPs (both Page Designer and non‑PD) | `POST /v2/auctions`, up to 6 slots |
| Winner placement | Product grid | Positions 0–1, 6–7, and the end of the grid |
| SKU deduplication | Product grid | A winner already in the organic results is moved, not duplicated |
| "Patrocinado" label | Product tile and banner | Localised through a resource bundle |
| Sponsored banners | Home page, search and category pages | Seven slots, one auction each, fetched through a remote include |
| Impression tracking | Browser | Fires on real viewport visibility, batched per grid |
| Click tracking | Browser | Fires on tile or banner click, `keepalive` so it survives navigation |
| Purchase tracking | `Order-Confirm` | Server-side, token-validated, idempotent |
| Server-side event relay | `Topsort-Event` | Keeps the marketplace API key out of the page |
| Kill switches | Site preferences | Set `topsortEnabled = false` and `topsortTrackingEnabled = false` for a complete operational shutdown; `topsortBannersEnabled = false` turns off banners alone |

### Routes

| Route | Type | Purpose |
| --- | --- | --- |
| `Search-Show` | append | Auction for search and non-PD category pages |
| `Search-ShowAjax` | append | Same, for the AJAX grid |
| `Search-UpdateGrid` | append | Same, for the sort control. Skipped for "show more" — see [Sorting and "show more"](#sorting-and-show-more) |
| `Order-Confirm` | append | Purchase event |
| `Tile-Show` | append | Passes `isSponsored` through to the tile |
| `Topsort-Event` | new (POST) | Relays browser impressions and clicks to Topsort |
| `Topsort-Banner` | new (GET, remote include only) | Runs the auction for one banner slot and renders the winner |

---

## Architecture

```
Browser
  product-engagement.js
        │  impressions / clicks (no API key)
        ▼
  POST Topsort-Event  ──────────────┐
                                    │  adds API key, resolves opaqueUserId
                                    ▼
salesforce_topsort_auctions         POST api.topsort.com/v2/events
  ├─ Search.js .................... auction for search + non-PD category
  ├─ productGrid_hites.isml ....... auction for the Page Designer grid
  ├─ Order.js ..................... purchase events
  ├─ Topsort.js ................... event relay endpoint
  ├─ topsortListings.js ........... auction orchestration, winner vetting
  ├─ topsortHelpers.js ............ placement + dedup
  ├─ topsortSession.js ............ tsuid opaque user id cookie
  └─ TopsortService.js ............ HTTP client (LocalServiceRegistry)
        │
        ▼  POST api.topsort.com/v2/auctions
HITES SFRA (app_storefront_hites + module_pagedesigner)
```

### Two render paths

HITES reaches a product grid two different ways, and the auction runs **exactly once** per
request either way.

**1. Search and non-Page-Designer category pages.** `Search.js` appends to `Show` and
`ShowAjax` and runs the auction against `viewData.productSearch`.

**2. Page Designer category PLPs.** `Search-Show` calls `res.page()` and returns before
`productSearch` exists, so the controller skips cleanly and the auction runs from
`productGrid_hites.isml` instead.

The auction lives in the grid template on the PD path for a specific reason: the component
script below this cartridge builds its model internally and returns finished markup, leaving
no seam to merge winners into `productIds` beforehand. The alternative was copying ~200 lines
of the HITES component, which silently went stale whenever that component changed. Instead
`experience/components/dynamic/productList.js` is a 43-line wrapper that delegates to
`module.superModule` and only reacts to the cache outcome.

Because only the PD chain reaches `productGrid_hites.isml`, and only the non-PD chain is
handled by the controller, there is no path where both fire.

---

## File map

```
cartridge/
├── client/default/
│   ├── js/product-engagement.js .......... browser tracking library (webpack entry)
│   └── css/topsort-sponsored.scss ........ Patrocinado label + banner styles (webpack entry)
├── controllers/
│   ├── Search.js ......................... auction on Show / ShowAjax
│   ├── Order.js .......................... purchase event on Confirm
│   ├── Tile.js ........................... isSponsored flag for the tile
│   └── Topsort.js ........................ Topsort-Event relay + Topsort-Banner fragment
├── experience/components/
│   ├── dynamic/productList.js ............ thin wrapper over the HITES PD component
│   ├── dynamic/productList.json .......... PD component definition
│   ├── assets/topsortbanner.js ........... PD banner component render
│   └── assets/topsortbanner.json ......... PD banner component definition
├── scripts/
│   ├── config/topsort_banners.json ....... the seven banner slots
│   ├── services/TopsortService.js ........ auctions, events, purchases
│   └── helpers/
│       ├── topsortListings.js ............ listings orchestration + winner vetting
│       ├── topsortBanners.js ............. banner slot allowlist, auction, winner mapping
│       ├── topsortHelpers.js ............. placement, dedup, device type, script escaping
│       └── topsortSession.js ............. tsuid cookie / opaque user id
├── templates/
│   ├── default/
│   │   ├── topsort/trackingInit.isml ..... loads + initialises the tracking library
│   │   ├── topsort/banner.isml ........... the banner fragment itself
│   │   ├── topsort/bannerSlot.isml ....... places a slot on a listing page
│   │   ├── product/productTile.isml ...... Patrocinado label
│   │   ├── search/components/productTiles.isml ......... grid (search / non-PD category)
│   │   ├── search/searchResultsNoDecorator.isml ........ override: banner slots
│   │   ├── search/categoryResultsNoDecorator.isml ...... override: banner slots
│   │   ├── experience/.../assets/topsortbanner.isml .... PD banner component markup
│   │   ├── experience/.../productList/categoryResults.isml ... override: banner slots
│   │   └── experience/.../productGrid_hites.isml ....... grid (Page Designer) + auction
│   └── resources/topsort.properties ...... label.sponsored, label.banner.alt
└── metadata/topsort_sponsored_metadata.xml  standalone reference copy (see Deployment)
```

### ISML overrides that need a diff check

ISML has no `module.superModule`, so these five files are full copies of templates owned by
other cartridges. A later change upstream is silently discarded on this site, so diff each
pair when merging a HITES release:

| This cartridge | Copied from |
| --- | --- |
| `search/components/productTiles.isml` | `app_storefront_hites` |
| `search/searchResultsNoDecorator.isml` | `app_storefront_hites` |
| `search/categoryResultsNoDecorator.isml` | `app_storefront_hites` |
| `experience/.../productList/categoryResults.isml` | `module_pagedesigner` |
| `experience/.../productList/productGrid_hites.isml` | `module_pagedesigner` |

Each override is the original plus a marked Topsort block, so `diff` against the original
should show additions only.

`trackingInit.isml` is included from **both** grid templates rather than from the page
templates. HITES reaches a grid through search results, `categoryResultsNoDecorator`, the PD
component, and the AJAX variants of all of them; including it at the grid level means every
one of those paths is covered and none can be missed. It reads the tracking preference itself
so no controller has to plumb a flag through view data.

---

## Runtime behaviour

### When the auction runs

All of the following must hold:

1. `topsortEnabled` is `true`.
2. The `topsort` service is configured and enabled in Business Manager.
3. The grid has at least one organic product.
4. The request falls inside `topsortAuctionTrafficPercent` — see
   [Traffic share](#traffic-share).
5. No **non-category** refinement is selected — sponsored products are suppressed on refined
   result sets by design. A category refinement alone does not suppress them.

### Auction triggers

The request always carries `products.ids` — the organic result set for this page — plus
exactly one context trigger:

| Page | Request |
| --- | --- |
| Search | `products` + `searchQuery` |
| Category PLP | `products` + `category` |

`searchQuery` and `category` are separate triggers, and a search refined by a category
arrives with both `q` and `cgid` set. The shopper's own query is the stronger statement of
intent, so it wins and `category` is dropped — the request is always one of the two shapes
above, never a hybrid.

For the search shape this is the documented behaviour: Topsort's *combining products and
`searchQuery`* example states that the auction pool is the product set **plus** products
whose keywords match, which is why a winner can arrive from outside this page's results and
why [winner vetting](#winner-vetting) exists.

The category shape behaves the same way, and for the same reason: the auction engine derives a
*set* of triggers from one auction context and retrieves bids for all of them in a single
lookup, so `category` is unioned in exactly as `searchQuery` is. **A category page can
therefore return winners that were not in this page's organic results**, which is why winner
vetting applies to category pages and not only to search.

> Ignore the `SponsoredListingsAuction` schema description in the public API reference, which
> claims "Exactly **one** of the following fields must be set: `products`, `category`". It is
> stale. Nothing enforces it — the schema requires only `type` and `slots`, with no `oneOf` —
> the Auctions API guide describes product ids, category ids and search query as combinable
> *triggers*, the engine unions them, and a live `products` + `category` request returns `200`.

### Traffic share

`topsortAuctionTrafficPercent` (0–100, default 100) is the setting between "Topsort off" and
"Topsort on all of production". It is checked before anything expensive happens — before the
refinements model is built, before a `tsuid` cookie is minted and before the auction call — so
a sampled-out request costs nothing and, crucially, **stays page cacheable**.

The draw is per request, not per shopper, because load is what is being sampled. Below 100 a
shopper sees sponsored products on some page views and not others, so treat this as a ramp
control during rollout and load testing rather than as a permanent setting.

### Sorting and "show more"

Both controls post to `Search-UpdateGrid`, and they need opposite treatment, so the append
runs the auction only when `start` is `0`.

Sorting sends `start=0` and its response **replaces** the grid, so without an auction the
shopper loses every sponsored product the moment they sort — which is what used to happen.

"Show more" sends a later `start` and its response is **appended** below the tiles already on
screen. A fresh auction there would return much the same winners as the first one, placing a
second tile for a product still visible further up the page: the same `tile-<pid>` DOM id
twice, two impressions for one product, and a `position` that restarts at 1 halfway down the
grid. Sponsored placements therefore belong to the first screen of results only.

### Winner placement

`topsortHelpers.placeTheSponsoredProducts()` places up to 6 winners:

| Winners | Grid positions (0-based) |
| --- | --- |
| 1–2 | 0, 1 |
| 3–4 | 6, 7 |
| 5–6 | end of grid |

**No organic product is ever discarded.** `productIds` holds a single page of results and the
surrounding pagination is computed from the unmodified result count, so anything removed here
would not move to the next page — it would disappear from browsing entirely. A winner already
present in the organic results is moved rather than duplicated, so a grid whose winners all
came from the organic set keeps exactly the products it started with.

### Winner vetting

A listings auction that combines `products.ids` with a `searchQuery` or a `category` also
admits keyword and category bids, so Topsort can legitimately return a product this page's
search never matched. The two cases are handled differently:

- **Winner already in the organic results** — reused as-is. The search engine has already
  vetted it, and the tile keeps its `productSearchHit`.
- **Winner from a keyword or category bid** — must be `online`, `searchable`,
  `assignedToSiteCatalog` and `orderable` before it enters the grid. Rejected ids are logged
  at `warn` under the `SponsoredSearch` category, which usually means the Topsort catalog feed
  is out of sync with the site catalog.

### Event tracking

| Event | Trigger | Layer |
| --- | --- | --- |
| Impression | Tile ≥50% visible for 1 continuous second | Browser |
| Click | Shopper clicks a sponsored tile | Browser |
| Purchase | Order confirmation page | Server |

Impressions are queued and flushed together, so a grid with six sponsored tiles produces
**one** request rather than six. Where `IntersectionObserver` is unavailable, or the tile
element cannot be found, the library falls back to reporting at render time — the documented
Topsort fallback — so no impression is lost.

The browser never talks to `api.topsort.com`. It posts to `Topsort-Event`, which attaches the
API key and rebuilds every field that affects attribution:

- `opaqueUserId` comes from the shopper's own `tsuid` cookie, so one shopper cannot report
  events as another.
- `id` and `occurredAt` are stamped server-side.
- `deviceType` is derived from the request user agent, not trusted from the browser.
- Only `impressions` and `clicks` are accepted. **Purchases are refused** so they cannot be
  forged to inflate attributed revenue.
- Unknown fields are stripped and the batch is capped at 24 events.

### Purchase events

`Order-Confirm` looks the order up **with its token**, so reporting cannot be triggered by
guessing order numbers. This check is done here rather than assumed, because the base HITES
route renders its error page without ending the middleware chain.

Reporting is recorded on the order in `custom.topsortPurchaseTracked`, so refreshing the
confirmation page or hitting the duplicate-order redirect does not report the purchase twice.
The event id is also derived from the order number (`order-<orderNo>`) rather than randomised,
which is the idempotency key Topsort deduplicates on, as a backstop if the flag write fails.

The event body carries only `id`, `occurredAt`, `opaqueUserId` and `items`. The purchase
schema is `additionalProperties: false`, so the order number, currency and order total —
which an earlier revision sent, and which look like exactly the things Topsort would want —
reject the batch outright. The order number still reaches Topsort through the event id.

### User identity

The `tsuid` cookie holds the Topsort opaque user id. `HttpOnly; Secure`, path `/`, 1-year TTL,
created on first auction and resolved server-side everywhere
(`topsortSession.resolveOpaqueUser`). It is never rendered into the page, because a cached
page would otherwise hand the first shopper's id to everybody served from that cache entry.

**`SameSite` cannot be set from script, and this is a live security gap.** `Topsort-Event`
accepts any `resolvedBidId` presented alongside a valid `tsuid`, so a cookie that travels
cross-site lets a third party page turn a shopper's browser into a source of chargeable
clicks. `dw.web.Cookie` has no method for the attribute, and writing the header by hand is
not an option — the platform rejects it outright:

```
java.lang.IllegalArgumentException: Header name Set-Cookie is not allowed to be set or added.
```

That exception is thrown on every first visit, which is why an earlier revision of this
cartridge silently rendered the organic grid on every request.

`SameSite` therefore comes from the instance-wide cookie setting in Business Manager. On the
bdpn-007 sandbox it is currently `None`, which is the permissive end and leaves the gap above
wide open. Until it is `Lax`, the `Origin` check and CSRF token listed under
[open items](#not-implemented-and-open-items) are the only defence on `Topsort-Event`.

**Verify on the sandbox** that `Set-Cookie: tsuid=…` carries `HttpOnly` and `Secure` on a
first PLP visit, that the cookie persists to the next request, and check which `SameSite`
value the instance is appending.

---

## Sponsored banners

Seven image slots, each filled by its own auction. Banners are a separate format from
sponsored listings: different config, different placements, and their own kill switch
(`topsortBannersEnabled`). Turning banners off leaves listings running untouched, and vice
versa.

### Slot inventory

| `slotId` | Page | Devices | Where it renders |
| --- | --- | --- | --- |
| `home-slider-5` | Home | desktop, mobile | 5th slide of the hero carousel |
| `home-slider-6` | Home | desktop, mobile | 6th slide of the hero carousel |
| `home-banner-full` | Home | desktop, mobile | The full width "banner full" row, 5th row of the page |
| `search-side` | Search | **desktop only** | Left rail under the filters, sticky |
| `search-bottom` | Search | desktop, mobile | Full width, below the whole grid |
| `category-side` | Category | **desktop only** | Left rail under the filters, sticky |
| `category-bottom` | Category | desktop, mobile | Full width, below the whole grid |

The side slots are **not auctioned on mobile**. The left rail does not exist below the `lg`
breakpoint, so bidding for it would charge advertisers for an impression that can never be
seen. This is enforced at request time by the `devices` list in the config, not only in CSS.

Slots live in `cartridge/scripts/config/topsort_banners.json`:

| Field | Meaning |
| --- | --- |
| `slotId` | Must match the `slotId` created in Topsort, exactly |
| `page` | `home`, `search` or `category`. Decides the auction trigger |
| `slots` | Winners requested. Always 1 here — a slot renders one banner |
| `position` | Reported as `placement.position` on impressions and clicks |
| `devices` | Which devices auction this slot at all |
| `sizes` | The CSS `sizes` hint, so the browser picks the right creative for the space |

The config is the **allowlist**. A `slotId` that is not in it is rejected before an auction is
built, which matters because the slot arrives in a query string a shopper can edit.

### Why banners are a remote include

Every banner is fetched by `Topsort-Banner`, a fragment pulled in with `<isinclude url="…">`,
rather than auctioned inside the page that shows it.

A response holding a `resolvedBidId` **cannot be page cached**: a cached copy would report
every later shopper's impression against one shopper's bid, under that shopper's opaque user
id. The pages banners were asked for are the home page and the PLPs, which are the most
cached pages on the storefront. Auctioning in the page would have meant expiring the home page
on every render that won a banner.

A remote include keeps the split honest. The surrounding page keeps its cache entry and only
the fragment is dynamic (`cachePeriod = 0`), so **enabling banners changes no page's caching
behaviour**. PLP caching stays driven solely by sponsored listings, exactly as it is today —
`topsortListings.js` is not involved in banners at all.

The price is **one auction per rendered slot** instead of one per page: up to three on the
home page, up to two on a PLP. The storefront already remote-includes every product tile, so
the extra sub-requests are not new in kind, but they do sit on the critical path. Cutting the
service timeout (see [Page cache impact](#page-cache-impact)) matters more with banners on.

```
Home page (cached)                 PLP (cached unless listings won)
  └─ PD component ×3                 └─ bannerSlot.isml ×2
       └─ isinclude ──┐                   └─ isinclude ──┐
                      ▼                                  ▼
                 Topsort-Banner  (server.middleware.include, cachePeriod = 0)
                      │  slotId allowlist → device check → topsortBannersEnabled
                      ▼
                 POST /v2/auctions   { "auctions": [ { "type": "banners", … } ] }
                      ▼
                 topsort/banner.isml → ProductEngagement.setupContentTracking
                      ▼
                 POST Topsort-Event  (impression, click)
```

### Auction payload

One auction per request, always one slot. The trigger comes from the slot's configured `page`,
never from the query string, so a crafted URL cannot turn a home slot into a keyword-targeted
one.

**Home** — neither `category` nor `searchQuery`. That absence is what makes it a landing page
auction:

```json
{ "auctions": [ {
  "type": "banners",
  "slots": 1,
  "slotId": "home-slider-5",
  "opaqueUserId": "b1e0…",
  "device": "desktop"
} ] }
```

**Category** — adds `category`. The id is slugged by `topsortHelpers.resolveTopsortCategoryId`,
which lowercases and turns `_` into `-`, because HITES category ids are `sweater_mujer` while
the Topsort catalog holds `sweater-mujer` and bid retrieval is exact:

```json
{ "auctions": [ {
  "type": "banners", "slots": 1, "slotId": "category-bottom",
  "opaqueUserId": "b1e0…", "device": "mobile",
  "category": { "id": "sweater-mujer" }
} ] }
```

**Search** — adds `searchQuery` instead. A search scoped to a category sends the search shape:
the shopper's own query is the stronger statement of intent, and it also picks which slot runs
(`search-side` rather than `category-side`). This mirrors what listings do.

### Response and rendering

```json
{ "results": [ {
  "resultType": "banners",
  "winners": [ {
    "rank": 1, "type": "url", "id": "https://www.hites.com/campana",
    "resolvedBidId": "0198…",
    "asset": [
      { "url": "https://…-1x.png", "mimeType": "image/png", "dimensions": { "width": 1440, "height": 400 } },
      { "url": "https://…-2x.png", "mimeType": "image/png", "dimensions": { "width": 2880, "height": 800 } }
    ]
  } ]
} ] }
```

Assets are sorted narrowest first and emitted as an `srcset` with width descriptors inside a
`<picture>`, together with the slot's `sizes` hint, so the browser downloads one file sized for
the space it actually occupies. A winner with no usable asset, or with no `resolvedBidId`, is
treated as no bid: nothing renders.

The destination is `winners.id`. It is advertiser-controlled, so it is filtered before it
becomes an `href`: `type: "product"` is turned into a `Product-Show` URL, and anything else is
only used when it starts with `http://` or `https://`. Without that check a `javascript:`
destination would be a stored XSS hole open to any vendor with campaign access.

Every banner carries the **Patrocinado** label, overlaid on the creative so it cannot change
the height of a carousel slide.

### When no bid wins

The fragment renders no banner, and emits a short script that removes the wrapper element it
was included into — but only when that wrapper turned out to hold nothing else.

This exists for the carousel. Page Designer wraps every component in a `div` of its own, and an
empty one inside the hero carousel is a blank slide the shopper can swipe to. The script runs
while the document is parsed and the carousel is initialised on `$(document).ready`, so the
node is gone before slick counts its slides.

### Events

Banners use the same rules as tiles: an impression at 50% visible for one continuous second, a
click reported immediately with `keepalive`. Both go through `Topsort-Event`, which needs no
banner-specific handling — it forwards anything carrying a `resolvedBidId`.

One extra rule applies to banners. `setupContentTracking` drops the banner when
`element.offsetParent` is `null`, which is the case for a side banner on a viewport where the
left rail is hidden. Without it the no-`IntersectionObserver` fallback would report an
impression for a banner that was never painted.

### First-visit identity on remote includes

A remote include is a separate request. It cannot see a cookie issued by its parent response
or by a sibling fragment before the browser receives that response.

Banner fragments therefore never mint `tsuid`. When the browser already has one, the auction,
signed bid proof, and event use it. Otherwise all fragments and the event relay derive the
same temporary opaque id by HMAC-signing the SFCC session id. The raw storefront session token
never leaves the application.

This preserves auction and event attribution without placing competing UUIDs on one page or
giving up the surrounding page cache. The normal listings path still creates the durable
`tsuid` cookie when an eligible product listing page runs.

### Placing the home page banners

The three home slots are filled by a Page Designer component, **Topsort - Sponsored Banner**
(`assets.topsortbanner`), with a `slotId` picker limited to the three home slot ids.

1. Open the `homePage` page in Page Designer.
2. Drop one into the Hero Banner Carousel `slides` region at position 5, set its slot to
   `home-slider-5`. Repeat at position 6 with `home-slider-6`.
3. Drop one into the full width "banner full" row, set its slot to `home-banner-full`.

Both regions use `component_type_exclusions`, which is a denylist, so this new type is allowed
without any change to `module_pagedesigner`. In the editor the component draws a labelled
placeholder — a banner has no winner at design time and would otherwise be invisible and
unselectable.

The search and category placements need no merchandising: they are in the template overrides.

### Creating the slots in Topsort

Slots are created once per marketplace against `https://api.topsort.com` with a **TSC
management key**. This is *not* the TSE key in `topsortApiKey`, which only authenticates
auctions and events.

`POST /public/v1/media-service/slots`, one call per slot. The marketplace is taken from the
key, so there is no id in the body. `slotId` must match `topsort_banners.json` exactly.
Landing page slots carry a `page` object; category and search slots do not. At least one of
`desktop` and `mobile` dimensions is required, and a `409` means the `slotId` already exists.

**Home** — all three are `landing`, and share one landing page record. Repeat with
`home-slider-6` and `home-banner-full`:

```bash
curl -X POST https://api.topsort.com/public/v1/media-service/slots \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "slotId": "home-slider-5",
  "position": "landing",
  "page": { "name": "Hites Homepage", "url": "https://www.hites.com/" },
  "dimensions": {
    "desktop": { "width": 2880, "height": 800 },
    "mobile":  { "width": 1500, "height": 1200 }
  }
}'
```

**Search** — `position: "search"`, no `page`. `search-side` is desktop only, so it declares
only a desktop dimension:

```bash
curl -X POST https://api.topsort.com/public/v1/media-service/slots \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "slotId": "search-side",
  "position": "search",
  "dimensions": { "desktop": { "width": 610, "height": 800 } }
}'
```

```bash
curl -X POST https://api.topsort.com/public/v1/media-service/slots \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "slotId": "search-bottom",
  "position": "search",
  "dimensions": {
    "desktop": { "width": 2880, "height": 640 },
    "mobile":  { "width": 1500, "height": 800 }
  }
}'
```

**Category** — the same two shapes with `position: "category"`. Written out rather than left as
"identical to search", because these are irreversible once an advertiser uploads to them:

```bash
curl -X POST https://api.topsort.com/public/v1/media-service/slots \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "slotId": "category-side",
  "position": "category",
  "dimensions": { "desktop": { "width": 610, "height": 800 } }
}'
```

```bash
curl -X POST https://api.topsort.com/public/v1/media-service/slots \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "slotId": "category-bottom",
  "position": "category",
  "dimensions": {
    "desktop": { "width": 2880, "height": 640 },
    "mobile":  { "width": 1500, "height": 800 }
  }
}'
```

To check what exists already. Note this is a `POST` with a JSON body and **no `-G`** — an
earlier revision of this file combined `-G` with `-X POST`, which moves the body into the
query string unencoded and sends an empty POST:

```bash
curl -X POST "https://api.topsort.com/public/v1/media-service/slots/query?position=landing" \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "orderBy": [ { "dimension": "slot_external_id", "direction": "asc" } ] }'
```

### Creative dimensions

> **Confirm these with design before creating the slots.** Topsort validates a creative
> against the slot it is uploaded to, so a size fixed here is a size advertisers are stuck
> with. The numbers below are derived from the layout, not from delivered artwork.

The rendered width comes from the HITES grid: Bootstrap 4, `lg` at 992px, and
`$container-max-widths` topping out at 1340px at `xl`.

| Slot | Rendered width | Suggested creative | Ratio |
| --- | --- | --- | --- |
| `home-slider-5`, `home-slider-6`, `home-banner-full` | Full viewport | **2880 × 800** desktop, **1500 × 1200** mobile | 3.6:1 / 1.25:1 |
| `search-side`, `category-side` | ~205px at `lg`, ~305px at `xl` | **610 × 800** desktop only | 3:4 vertical |
| `search-bottom`, `category-bottom` | Full viewport | **2880 × 640** desktop, **1500 × 800** mobile | 4.5:1 / 1.9:1 |

Two things drive these:

- **Mobile needs a squarer creative.** A 4:1 strip that reads well at 1440px is an illegible
  band at 390px, which is why the home and footer slots have a different mobile shape rather
  than a scaled copy of the desktop one.
- **The side rail is narrow.** At `lg` it is roughly 205px of content inside the 940px
  container, so a 610px creative already covers it at 2×. The `sizes` hint in the slot config
  is what stops the browser downloading the full width creative for it.

Topsort's own hard limits, the same for every slot: JPEG, PNG, WEBP, GIF or MP4, at most 5 MB
per creative.

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| No banner anywhere | `topsortEnabled` or `topsortBannersEnabled` is off. Both are needed |
| `Topsort banner requested for an unconfigured slot` in the log | The `slotId` in the template or PD component is not in `topsort_banners.json` |
| Banner renders on desktop but not mobile | Expected for the side slots. Anything else means the creative for that device was never uploaded |
| Empty slide in the hero carousel | The removal script did not run. Check the fragment actually rendered — an error in `Topsort-Banner` renders nothing at all, including the script |
| Side banner scrolls away instead of sticking | It ended up inside `.product-filters-wrapper`, which is `overflow: hidden` and clips a sticky descendant. It has to be a sibling |
| Auction returns 200 with no winners | No campaign is bidding on that slot, or the creative does not match the slot dimensions and was rejected at upload |
| Impressions but no clicks | The winner had no usable destination — `id` was neither a product nor an `http(s)` URL, so no link was rendered |

---

## Error containment

This cartridge is first in the cartridge path and appends to `Order-Confirm`, so a defect in
ad code is otherwise a defect in checkout. Every entry point is wrapped:

| Entry point | On exception |
| --- | --- |
| `Order-Confirm` append | Logged; the confirmation page renders normally. The order keeps `topsortPurchaseTracked = false`, which is the record of what was missed |
| `Search-Show` / `-ShowAjax` append | Logged; the organic grid renders and the response is held **out** of the page cache, because it is no longer possible to tell how far the merge got |
| `productGrid_hites.isml` auction | Logged; the organic grid renders. Winners are merged in one step at the end, so nothing is left half-merged and the page stays cacheable |
| `productList.js` cache decision | Logged; the response is treated **as if** it carried sponsored placements. An hour of extra dynamic category pages is cheaper than an hour of every shopper's impressions being billed against one shopper's bids |
| `Topsort-Event` | Logged; answers `{ success: false }` rather than surfacing the error page to a caller who controls the request body |
| `Topsort-Banner` | Logged; the fragment renders nothing, and the page around it is unaffected. Because it is a remote include, even a hard failure here is contained to the fragment rather than the page |

`TopsortService.sendPurchaseEvent` skips line items whose `adjustedPrice` is unavailable —
`Money.getValue()` throws on unavailable amounts, and `allProductLineItems` includes bonus and
option line items. It also skips items whose unit price is `0`, because the events API
declares `unitPrice` with `exclusiveMinimum: 0` and would reject the whole batch. An order
left with no reportable item at all returns a failure instead of sending an empty `items`
array, which `minItems: 1` would reject.

The trade this makes is that failures are now **silent to the shopper**, so they have to be
loud somewhere else. Alert on the `SponsoredSearch` and `TopsortService` log categories, and
reconcile orders left with `topsortPurchaseTracked = false` — otherwise the first sign of an
outage is Topsort's monthly invoice.

---

## Page cache impact

**Read this before going live — it changes PLP caching characteristics.**

`Search-Show` normally caches for 1 hour (`applyShortPromotionSensitiveCache`), and the PD
component asks for a 1 hour relative page cache. A response carrying auction results **cannot**
be cached: it contains `resolvedBidId` values belonging to one specific auction, so a cached
copy would report every later shopper's impressions against those bids, under the first
shopper's opaque user id.

So the cache is suppressed when, and only when:

- sponsored placements were merged into the grid, or
- a new `tsuid` cookie was minted on this request (SFCC does not store `Set-Cookie` in the page
  cache, so that response has to be dynamic for the cookie to stick).

Pages still cache normally when Topsort is disabled, when the shopper has refined the results,
and when the auction returns no winners. Setting `topsortEnabled = false` restores the previous
caching behaviour completely.

### Banners do not change any of this

Everything above is about **sponsored listings**. Banners were built specifically so they would
not extend it: each one is fetched through the `Topsort-Banner` remote include, which is itself
uncacheable, while the page that includes it keeps its own cache entry untouched. The home page
stays fully cached and PLP caching stays driven solely by listings.

What banners add instead is **requests**, not cache misses: up to three extra sub-requests on
the home page and two on a PLP, each making one call to Topsort. Those calls are on the
critical path of rendering the fragment, so the case for cutting `timeout-millis` below applies
more strongly with banners enabled. `topsortBannersEnabled = false` removes them entirely.

> **Read the paragraph above sceptically — it is true and it is misleading.** Keeping the cache
> entry is not the same as keeping the cache *benefit*. Listings cost is paid on the cache-miss
> fraction; banner cost is paid on **every** home page view, because a cache hit still has to
> resolve three fragments and each one blocks on Topsort for up to the 500 ms service timeout.
> Worst case is now 1.5s when every call reaches its timeout. The rate limiter sheds excess
> demand before it can consume another storefront thread.

Because auctions now sit on the critical path of every uncached render, the service profile is
configured with a 500 ms timeout, rate limiting, and an enabled circuit breaker. See
[Configuration reference](#configuration-reference).

> **This is a capacity change, not just a caching change.** Removing the page cache from PLPs
> multiplies application server load by the previous hit ratio, and each of those renders then
> holds a thread waiting on a third party. The circuit breaker opens on *errors*, so it does
> not cover the likeliest degradation — Topsort staying up but getting slow. Ramp with
> `topsortAuctionTrafficPercent` and load-test the uncached PLP path at peak concurrency
> before going to 100.

> **Verify on the sandbox:** on the Page Designer path the cache suppression works by calling
> `response.setExpires(new Date(0))` *after* the base component has already requested a 1 hour
> cache. A past date was chosen so it wins under either way repeated `setExpires` calls can be
> resolved (last call wins, or shortest expiry wins). Confirm the `Expires` response header on a
> PD category page that has sponsored products before trusting this in production.

---

## Configuration reference

### Site preferences — group **Topsort**

| Preference | Type | Default | Purpose |
| --- | --- | --- | --- |
| `topsortEnabled` | boolean | `false` | Master switch for listing and banner auctions. Event reporting has its own switch |
| `topsortBannersEnabled` | boolean | `false` | Sponsored banners only. Independent of listings, so banners can be ramped or killed on their own |
| `topsortBannerAssetHosts` | string | empty | Comma-separated exact hostnames allowed to serve banner creatives. Empty rejects every creative |
| `topsortApiKey` | string | – | Marketplace API key. **Server-side only** |
| `topsortApiURL` | string | `https://api.topsort.com` | API host |
| `topsortTrackingEnabled` | boolean | `true` | Impression / click / purchase reporting |
| `topsortAuctionTrafficPercent` | int 0–100 | `100` | Share of listing and banner auction requests. An unset value behaves as `100` |

### Order attribute

| Attribute | Type | Purpose |
| --- | --- | --- |
| `topsortPurchaseTracked` | boolean | Purchase already reported; prevents double counting |

### Service

| Id | Kind | Setting |
| --- | --- | --- |
| `topsort` | HTTP service | `comm-log-enabled = false` |
| `topsort.http.cred` | credential | `https://api.topsort.com` |
| `topsort.http.prof` | profile | `timeout 500ms`, `100 calls / 1000ms`, `cb-enabled true`, `cb-calls 10`, `cb-millis 10000` |

Comm logging is off on purpose: the request carries the API key in an `Authorization` header.
It can be re-enabled in Business Manager for debugging — `TopsortService.filterLogMessage`
redacts `Bearer <key>` to `Bearer ***` so the key still does not reach the logs.

Rate limiting intentionally fails open by dropping ads when storefront demand exceeds the
configured service capacity.

---

## Deployment steps

### 1. Code

Already wired up in the repo — no action needed, listed for completeness:

- Cartridge path in `metadata/sites/HITES/site.xml`. `salesforce_topsort_auctions` **must be
  first**:
  ```
  salesforce_topsort_auctions:plugin_pagedesigner_sfra:app_storefront_hites:module_pagedesigner:...
  ```
- Webpack entry in `webpack.config.js`: `WebpackBundle.forCartridge("salesforce_topsort_auctions")`.

The Bitbucket pipeline copies every directory under `cartridges/` and runs webpack itself, so
no deploy-script change is required.

### 2. Import metadata

Import from the project `metadata/` folder — **not** the cartridge's own XML:

| File | Creates |
| --- | --- |
| `metadata/services.xml` | service `topsort`, credential `topsort.http.cred`, profile `topsort.http.prof` |
| `metadata/meta/SitePreferences-Metadata.xml` | the seven `topsort*` site preferences |
| `metadata/meta/Order-Metadata.xml` | `topsortPurchaseTracked` |
| `metadata/sites/HITES/site.xml` | the cartridge path |

`cartridge/metadata/topsort_sponsored_metadata.xml` is a **standalone reference** for a
greenfield install. On HITES the project files above are authoritative; do not import both.

> `metadata/meta/SitePreferences-Metadata.xml` had a stray duplicate
> `<custom-attribute-definitions>` tag that made the whole file malformed and therefore
> un-importable. It was removed as part of this work; the file now validates against
> `xsds/metadata.xsd`. If you are cherry-picking, make sure that fix comes along.

### 3. Set preference values

Merchant Tools → Site Preferences → Custom Preferences → **Topsort**:

| Preference | Value |
| --- | --- |
| `topsortApiKey` | key from Topsort |
| `topsortApiURL` | `https://api.topsort.com` |
| `topsortBannerAssetHosts` | exact creative CDN hostname from a real auction response |
| `topsortTrackingEnabled` | `true` |
| `topsortAuctionTrafficPercent` | `1` to start. Raise it while watching storefront response times |
| `topsortEnabled` | `true` — set this **last**, after the rest is verified |
| `topsortBannersEnabled` | leave `false` until the seven slots exist in Topsort and the home page components are placed — see [step 6](#6-banners) below |

The project metadata and the cartridge reference metadata define the same Topsort preferences.

### 4. Enable the service

Administration → Operations → Services → confirm `topsort` is enabled and pointing at the
`topsort.http.prof` profile and `topsort.http.cred` credential.

### 5. Build client assets

From the project root:

```bash
yarn install
yarn run webpack:prd      # or webpack:dev while developing
```

This compiles `product-engagement.js` and `topsort-sponsored.css` into
`cartridge/static/default/`. Both are gitignored, so they must be built by the pipeline or
uploaded by your IDE — they are not committed.

> Node version: `.nvmrc` pins **16.20.2** for local development, while the Bitbucket image is
> `node:10.18.1` and `package.json` declares `>=10.15.3`. The three disagree. This predates the
> Topsort work but is worth reconciling, since the same webpack config has to build under both.

### 6. Banners

Banners need three things that listings do not, and `topsortBannersEnabled` should stay `false`
until all three are done:

1. **Create the seven slots in Topsort** with a TSC management key — see
   [Creating the slots in Topsort](#creating-the-slots-in-topsort). The `slotId` values must
   match `cartridge/scripts/config/topsort_banners.json` exactly.
2. **Place the home page components.** Three instances of **Topsort - Sponsored Banner** in
   Page Designer — see
   [Placing the home page banners](#placing-the-home-page-banners). The search and category
   placements are in the template overrides and need no merchandising.
3. **Have at least one campaign bidding**, otherwise every slot correctly renders nothing and
   there is nothing to verify.

Then set `topsortBannersEnabled = true` and walk the [banner QA](#banners).

### 7. Post-deploy

- Invalidate the page cache and the code cache in Business Manager.
- Confirm the Page Designer listing component is assigned to the category pages (HITES already
  does this).
- Walk the [QA checklist](#qa-checklist).

---

## Known issue: services.xml XSD validation

`metadata/services.xml` does **not** validate against the repo's own schema:

```
$ xmllint --noout --schema xsds/services.xsd metadata/services.xml
metadata/services.xml:519: element service-credential: Schemas validity error :
  Element '...service-credential': This element is not expected.
  Expected is ( ...service ).
metadata/services.xml fails to validate
```

**Cause.** The schema requires a strict sequence — every `<service-credential>`, then every
`<service-profile>`, then every `<service>`. The first `<service>` element appears at line 341,
but five MarketingCloud blocks sit after it:

| Line | Element |
| --- | --- |
| 519 | `<service-credential service-credential-id="marketingcloud.sftp">` |
| 525 | `<service-credential service-credential-id="marketingcloud.rest.auth">` |
| 531 | `<service-profile service-profile-id="marketingcloud.rest">` |
| 541 | `<service-profile service-profile-id="marketingcloud.soap">` |
| 551 | `<service-profile service-profile-id="marketingcloud.sftp">` |

**This is not caused by the Topsort work.** It reproduces identically on `HEAD`, at the
equivalent line 504 — the 15-line offset is just the Topsort credential and profile blocks
added above it. The Topsort entries themselves are correctly ordered.

**Impact.** The MarketingCloud integration is live, so SFCC's importer evidently tolerates the
ordering; this is not known to block the import. What it does affect:

- The repo's PR linter (`osf-builder-suite-xml-linter`, per the root `README.md`) will flag
  `services.xml`.
- Any XSD-based pre-import validation you add will reject the file.
- The Topsort service definitions live in this same file, so if the import is ever rejected,
  Topsort loses its service along with everything else.

**Fix.** Move those five MarketingCloud blocks above the first `<service>` element. Purely
mechanical — no value changes. Deliberately **not** done as part of the Topsort work, since it
touches an unrelated integration and should be reviewed by whoever owns MarketingCloud.
Confirm the `services.xml` import succeeds before relying on Topsort in production.

---

## QA checklist

### Search

- [ ] `/busqueda?q=<term>` renders products; grid is not blank.
- [ ] Sponsored tiles show **Patrocinado** below the price.
- [ ] Winners appear at positions 0–1, 6–7 and at the end of the grid.
- [ ] No SKU appears twice (sponsored + organic).
- [ ] **Product count is unchanged** vs `topsortEnabled = false` when all winners came from the
      organic results.
- [ ] Applying a facet hides sponsored products and does not break the page.
- [ ] Changing the sort order **keeps** sponsored tiles in the grid.
- [ ] "Show more" appends organic products only, and no product appears twice across the two
      chunks with a duplicated `tile-<pid>` id.

### Category

- [ ] Page Designer category PLP renders, with Patrocinado on sponsored tiles.
- [ ] Non-PD category page (the `categoryResultsNoDecorator` path) also renders **and fires
      tracking** — this path was previously missing the tracking library.
- [ ] Pagination and facets still work.

### Tracking

- [ ] Page source contains **no API key** — search the HTML for `Bearer` and for the key value.
- [ ] No browser request goes directly to `api.topsort.com`.
- [ ] Scrolling a sponsored tile into view fires **one** `Topsort-Event` request; a grid of six
      sponsored tiles produces one batched request, not six.
- [ ] Scrolling past a tile quickly (under 1s) fires **no** impression.
- [ ] Clicking a sponsored tile fires a click event.
- [ ] Buying a sponsored product produces a purchase event that Topsort **accepts** — check
      the `TopsortService` log for a rejected batch, not just that a call was made.
- [ ] The same product winning two bids in one auction renders **one** tile.
- [ ] Refreshing the order confirmation page does **not** produce a second purchase event.
- [ ] `Order-Confirm?ID=<someone else's order>` without a valid token produces no event.

### Security

- [ ] `?cgid=</script><img src=x onerror=alert(1)>` renders a grid with **no** alert and no
      broken markup — an unknown `cgid` falls back to an unscoped catalog search, so this URL
      does reach a populated grid with sponsored tiles. Repeat with `?q=`.
- [ ] View source on that page: the payload appears inside the tracking call as `\u003c`,
      and the `<script>` block is intact.
- [ ] The `tsuid` `Set-Cookie` header carries `HttpOnly` and `Secure`. Note which `SameSite`
      value the instance appends — see [User identity](#user-identity).

### Banners

Placement and layout:

- [ ] Home page: slides 5 and 6 of the hero carousel are banners, full bleed, and the carousel
      still reports the same number of slides as before when both win.
- [ ] Home page: the "banner full" row renders a full width banner.
- [ ] Search and category: the side banner sits under the filters and **sticks** while the
      results scroll, rather than scrolling away with the filter box.
- [ ] Search and category: the footer banner is below everything and spans the **full
      viewport**, not just the results column.
- [ ] Mobile: no side banner rendered. Note the fragment request is **not** visible in the
      browser network panel — a remote include is resolved server-side — and the sub-request
      *is* still issued on mobile, because `bannerSlot.isml` emits the include unconditionally
      and the device check runs inside the fragment. Verify by log or by the absence of an
      auction for that slot, not by the network panel.
- [ ] Every banner carries the **Patrocinado** label.

The empty case, which is the one that breaks layouts:

- [ ] With `topsortBannersEnabled = false`, the home page and PLPs look exactly as they did
      before this cartridge — **no empty slide** in the carousel and no gap where a banner
      would be.
- [ ] Same with banners on but no campaign bidding on a slot.
- [ ] Swiping the hero carousel end to end never lands on a blank slide.

Auction and events:

- [ ] `Topsort-Banner` requested directly in a browser does **not** return a banner.
      `server.middleware.include` raises `Error('Params do not match route')`, which surfaces
      as a 500-class error page, not a 404. Expect an entry in the error log for every direct
      hit, including from crawlers.
- [ ] `?slotId=not-a-real-slot` renders nothing and logs a warning under `SponsoredSearch`.
- [ ] A category banner auction sends the **slugged** category id (`sweater-mujer`, not
      `sweater_mujer`).
- [ ] A search scoped to a category runs `search-side` / `search-bottom` with `searchQuery`,
      not the category slots.
- [ ] Scrolling a banner into view fires one impression; scrolling past it in under a second
      fires none.
- [ ] Clicking a banner fires a click and navigates.
- [ ] A banner whose winner is a bare id renders **without** a link rather than an `href` of
      `12345`.

Caching — this is the point of the remote include:

- [ ] The home page returns the **same `Expires` header** with banners on as with them off.
- [ ] A PLP with no sponsored listings returns its usual 1 hour `Expires` even when a banner
      won.
- [ ] The `Topsort-Banner` fragment itself is uncacheable, and two consecutive page loads
      produce two different `resolvedBidId` values.
- [ ] **Check whether the fragment's `Set-Cookie` reaches the browser**: clear cookies, land
      directly on the home page, and see whether `tsuid` is set. This is the open question in
      [First-visit identity](#first-visit-identity-on-remote-includes) and [C1](#blocking).

### Caching and traffic share

- [ ] A PLP with sponsored products returns an already-expired `Expires` header.
- [ ] A PLP with no winners still returns a 1 hour `Expires`.
- [ ] The `tsuid` cookie is set once and persists across requests.
- [ ] First visit to a **Page Designer** category PLP that returns no winners still sets
      `tsuid` and returns an already-expired `Expires` — the cookie has to survive a request
      that merged nothing.
- [ ] `topsortAuctionTrafficPercent = 0` → no auction call, no sponsored tiles, and the PLP
      returns a 1 hour `Expires` — this is the load-shedding position and it must cache.
- [ ] `topsortAuctionTrafficPercent = 50` → roughly half of repeated PLP requests carry
      sponsored tiles, and only those are uncached.

### Kill switch and resilience

- [ ] `topsortEnabled = false`, `topsortBannersEnabled = false` and
      `topsortTrackingEnabled = false` → storefront performs no Topsort auctions or event
      reporting, and previous caching behaviour is restored.
- [ ] With a deliberately wrong API key, PLPs still render the organic grid (fail-open) and the
      error is logged under `TopsortService`.
- [ ] With the `topsort` service pointed at an unreachable host, the order confirmation page
      still renders after a real checkout. This is the one that matters most.

Logs: `SponsoredSearch` and `TopsortService` log categories in Business Manager.

---

## Not implemented and open items

### Banner formats not implemented

[Sponsored banners](#sponsored-banners) covers the seven image slots that were asked for. Two
neighbouring things are deliberately out:

- **Top-of-page banners.** The upstream cartridge also has `search-top` and `category-top`.
  They were specified out of the HITES placement list, so they are not in
  `topsort_banners.json`. Adding one is a config entry plus an include in the listing
  templates — no new code.
- **Sponsored brands.** A separate format (`POST /v2/auctions/sponsored-brand`), a creative
  plus a product carousel rather than a plain image. Nothing here supports it.

Also not done for banners:

- **No per-slot traffic control.** Banners share `topsortAuctionTrafficPercent` with listings.
  A separate allowlist would be needed to ramp placements independently.
- **One auction per slot, not per page.** Three home slots mean three calls. Batching them
  would mean auctioning in the page, which is what would cost the home page its cache — the
  trade is explained in [Why banners are a remote include](#why-banners-are-a-remote-include).

### Carried over from code review, not addressed

| Item | Notes |
| --- | --- |
| PD component duplication | Reduced from ~200 duplicated lines to a 43-line `module.superModule` wrapper. `productList.json` is still a byte-for-byte copy of the upstream component definition, because Page Designer requires the `.json` and `.js` to sit in the same cartridge. |
| Pagination vs injected winners | When a keyword or category bid wins with a product that was not in the page's organic results, the grid grows beyond `pageSize` while `productSearch.count` stays at the organic total, so "showing X of N" can be slightly off. Pre-existing; only affects out-of-set winners. |
| Event relay replay | Resolved with shopper-bound HMAC bid proofs and permanent ids derived from event type, bid, and identity. |
| `Topsort-Event` CSRF exposure | Resolved with same-origin, JSON content type, request size, CSRF, and signed bid validation. |
| Page Designer grid regions shift | Resolved by indexing regions with the organic product counter rather than the merged grid counter. |
| Tracking library repeated on fragments and AJAX grids | Resolved with one asynchronous script element, a setup queue, and idempotent reconfiguration when a fresh CSRF URL arrives. |

### Repo-level items outside this cartridge

Flagged during review, left alone because they are not Topsort's to change:

- `metadata/services.xml` XSD ordering — see [above](#known-issue-servicesxml-xsd-validation).
- `metadata/services.xml` now uses a 500 ms timeout and enables the rate limiter.
- `metadata/meta/SitePreferences-Metadata.xml` now includes the auction traffic percentage
  and banner asset host allowlist.
- The five ISML overrides are full copies of their originals. ISML has no `module.superModule`,
  so a later upstream change to any of them is silently discarded on this site. Worth a
  pipeline check that diffs the pairs — the list is under
  [ISML overrides that need a diff check](#isml-overrides-that-need-a-diff-check).
- `.nvmrc` / `package.json` `engines` / Bitbucket node image disagree on the Node version.
- `webpack.config.js` dropped the `fibers` sass option on this branch — a global SCSS build
  change affecting all bundles, unrelated to Topsort.
- `yarn.lock` was re-resolved on this branch, while the pipeline runs `npm install`.
