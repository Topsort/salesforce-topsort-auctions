**Topsort Sponsored Search Cartridge**

This cartridge integrates Topsort’s auction-based sponsored product placement into Salesforce B2C Commerce (SFCC) search results.

---

## Metadata Import

1. Locate the metadata XML file in the repository under `metadata/topsort_sponsored_metadata.xml`.
2. In Business Manager, navigate to **Administration** > **Site Development** > **Import & Export** > **Import Site Data**.
3. Upload and import `topsort_sponsored_metadata.xml` to register all controllers, pipeline extensions, and site preferences.

---

## Prerequisites

* A running SFCC instance (Sandbox or Production).
* WebDAV access credentials.
* A valid Topsort API key (obtain from your Topsort account).
* Node.js tooling (for local testing and builds, if applicable).

---

## Installation

1. **Upload Cartridge**

   * Mirror your cartridge folder into your SFCC WebDAV repository under `Cartridges/topsort_sponsored`.

2. **Assign Cartridge Path**

   * In Business Manager, go to **Administration** > **Sites** > **Manage Sites** > **Manage Sites**.
   * Select your site, click **Settings**, then the **Cartridge Path**.
   * Add `topsort_sponsored` (and any dependencies, e.g., `app_storefront_base`) at the beginning of the path.

3. **Import Metadata** (see details above)

4. **Configure Custom Preferences**

   * In Business Manager: **Administration** > **Sites** > **Manage Sites** > select your site > **Merchant Tools** > **Custom Preferences** > **topsortSponsoredPreferences**.
   * Create or update:

     * `topsortApiKey` — Your Topsort bearer token.
     * `topsortCookieMaxAge` — Cookie expiration in seconds (default `86400`).

5. **Clear Caches & Rebuild**

   * Clear both the SFCC code and view cache.
   * Restart your sandbox or deployment if necessary.

---

## Configuration

* **Controllers**:

  * `Search-Show` is extended to append sponsored logic.

* **Site Preferences**:

  * `topsortApiKey`: string, required.
  * `topsortCookieMaxAge`: integer, optional.

---

## Usage

1. Perform a search on the storefront (e.g., `/s?q=shoes`).
2. The cartridge will:

   * Fetch auction winners from Topsort.
   * Inject sponsored products at the top of organic results, tagging them with `isSponsored`.
   * Emit impression beacons on render and click events via client-side scripts.

---

## Troubleshooting

* **No sponsored items**: Verify `topsortApiKey` is set correctly and the preference is active.
* **No beacons firing**: Check browser console for errors and ensure `fetch` or `sendBeacon` calls are executing after page load.
* **Controller errors**: Review `logs/SponsoredSearch` in SFCC Log Center for server-side exceptions.

---

## Support

For questions or issues, contact your Topsort integration engineer or SFCC support channel.
