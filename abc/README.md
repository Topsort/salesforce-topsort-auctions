# Topsort Auctions Custom (ABC)

Cartridge de integración de Topsort para el storefront de ABC sobre Salesforce B2C Commerce (SFRA).
Cubre los tres formatos publicitarios (productos patrocinados, banners y marcas patrocinadas), el
reporte de eventos de impresión, clic y compra, y el feed de catálogo hacia Topsort.

Este cartridge extiende a `app_abc` y debe ir **al inicio** del cartridge path:

```
plugin_shopper_agent:plugin_conversational_commerce:topsort_auctions_custom:int_powerreviews_sfra:app_abc:...
```

---

## Índice

1. [Qué está implementado](#1-qué-está-implementado)
2. [Preferencias de sitio y metadata](#2-preferencias-de-sitio-y-metadata)
3. [Archivos de configuración](#3-archivos-de-configuración)
4. [Subastas: payloads por tipo](#4-subastas-payloads-por-tipo)
5. [Eventos: payloads por tipo](#5-eventos-payloads-por-tipo)
6. [Atribución](#6-atribución)
7. [Dimensiones esperadas de los creativos](#7-dimensiones-esperadas-de-los-creativos)
8. [Creación de JSON Templates y Placements](#8-creación-de-json-templates-y-placements)
9. [Feed de catálogo](#9-feed-de-catálogo)
10. [Pruebas en modo Mock](#10-pruebas-en-modo-mock)
11. [Troubleshooting](#11-troubleshooting)
12. [Pendientes](#12-pendientes)

---

## 1. Qué está implementado

| Formato | Endpoint de subasta | Dónde se muestra | Archivos principales |
|---|---|---|---|
| Productos patrocinados (listings) | `POST /v2/auctions` | Grilla de resultados, en búsqueda y en categoría | `controllers/Search.js`, `helpers/topsortHelpers.js`, `templates/.../productTiles.isml` |
| Banners | `POST /v2/auctions` (misma llamada que listings) | 6 posiciones fijas en la página de resultados | `controllers/Search.js`, `config/topsort_banners.json`, `templates/.../searchResultsNoDecorator.isml` |
| Marcas patrocinadas (sponsored brands) | `POST /v2/auctions/sponsored-brand` | Solo páginas de categoría | `helpers/sponsoredBrandsHelpers.js`, `config/topsort_sponsored_brands.json`, `templates/.../sponsoredBrand*` |
| Eventos de impresión y clic | `POST /v2/events` (cliente) | — | `static/default/js/product-engagement.js`, `static/default/js/sponsored-brands.js` |
| Evento de compra | `POST /v2/events` (servidor) | `Order-Confirm` | `controllers/Order.js`, `services/TopsortService.js` |
| Feed de catálogo | Archivo TSV que Topsort descarga | Job programado | `services/TopsortProductFeed.js`, `util/TopsortUtil.js`, `helpers/feedHelpers.js` |

### 1.1 Productos patrocinados

Se ejecuta en `Search-Show` y en `Search-UpdateGrid`. Toma los `productIds` que devolvió el motor de
búsqueda, los envía a la subasta y reordena la grilla insertando a los ganadores mediante
`topsortHelpers.placeTheSponsoredProducts()`: los dos primeros ganadores van a las posiciones 0 y 1,
los dos siguientes a las posiciones 7 y 8, y los dos últimos al final.

Después se llama a `normalizeProductsToRowsOfFour()`, que elimina productos no patrocinados de los
últimos 10 resultados hasta que el total sea múltiplo de 4, de modo que la grilla no quede con una
fila incompleta. Esta normalización **no** se aplica cuando hay 10 productos o menos, para no alterar
búsquedas específicas por PLU.

Cada tile ganador recibe `isSponsored = true`, lo que hace que `app_abc/product/productTile.isml`
pinte la etiqueta de la preferencia `topsortFeaturedText`.

### 1.2 Banners

Seis slots definidos en `config/topsort_banners.json`. Los de tipo `search` solo participan cuando hay
término de búsqueda y no hay categoría; los de tipo `category` solo cuando hay `cgid`.

Cada slot declara además en qué dispositivos participa. Los dos laterales (`search-side`,
`category-side`) viven dentro de la barra de refinamientos, que el CSS oculta bajo 1024 px, así que
**solo se subastan en desktop**. Los otros cuatro se subastan en ambos dispositivos, y Topsort
devuelve la variante del creativo que corresponde al `device` enviado.

### 1.3 Marcas patrocinadas

Tres formatos, cada uno con su propio JSON Template y su propio placement en Topsort:

| Formato interno | `slotId` / `externalPlacementId` | Composición | Productos |
|---|---|---|---|
| `heroLogo` | `sponsored-brand-hero-logo` | Imagen (1/2) + logo (1/4) + carrusel (1/4) | 3 a 6 |
| `hero` | `sponsored-brand-hero` | Imagen (1/4) + carrusel (3/4) | exactamente 3 |
| `compact` | `sponsored-brand-compact` | Logo + titular arriba, grilla de 3 productos abajo | exactamente 3 |

Los productos se renderizan con el tile estándar de ABC vía include remoto a `Tile-Show`, para que se
vean idénticos a los de la grilla. La etiqueta de publicidad va **en la fila**, no en cada tile.

**Restricciones de ejecución**, iguales a las de listings y banners:

- Solo en páginas de categoría (`Search-Show` con `cgid`). No corre en búsqueda, ni en `Search-UpdateGrid`,
  ni en home, ni en PDP.
- No corre si la categoría tiene `custom.topsortDisabled = true`.
- No corre si el usuario aplicó cualquier refinamiento que no sea de categoría (color, talla, precio, etc.).

---

## 2. Preferencias de sitio y metadata

Este cartridge es **autosuficiente**: trae su propio metadata y no depende del cartridge
`topsort_auctions`.

```
cartridge/metadata/topsort_custom_metadata.xml   <- atributos personalizados (aditivo, seguro)
cartridge/metadata/topsort_custom_services.xml   <- definición del servicio (ver advertencia)
```

### Importar el metadata

1. **Administration > Site Development > Import & Export**.
2. Subir `topsort_custom_metadata.xml` en **Import & Export Files**.
3. En la sección **MetaData**, seleccionar el archivo e importar.
4. Configurar los valores en **Merchant Tools > Site Preferences > Custom Preferences > Topsort**.

Es una importación **aditiva**: crea o actualiza definiciones de atributos y no toca valores ya
cargados ni credenciales existentes.

### Atributos que define

| Atributo | Tipo | Objeto | Dónde se lee |
|---|---|---|---|
| `topsortEnabled` | boolean | SitePreferences | `TopsortService.getConfig()`. Interruptor general: si está apagado, ninguna subasta se ejecuta. |
| `topsortApiKey` | string | SitePreferences | `TopsortService.getConfig()`. Bearer token, debe ser llave **TSE**. |
| `topsortApiURL` | string | SitePreferences | `TopsortService.getConfig()`. Por defecto `https://api.topsort.com`. |
| `topsortTrackingEnabled` | boolean | SitePreferences | `TopsortService.getConfig()`. Habilita el envío de eventos. |
| `topsortFeaturedText` | string | SitePreferences | `sponsoredBrandRow.isml` y `app_abc/product/productTile.isml`. Etiqueta de publicidad. Si queda vacío, no se pinta etiqueta. |
| `topsortDisabled` | boolean | Category | `topsortHelpers.isTopsortDisabledByCategory()`. Desactiva Topsort en esa categoría. |
| `lpJSONConfig` | text | ServiceCredential | `TopsortService.mockFull()`. Payloads de mock. |

> `lpJSONConfig` lleva prefijo `lp` porque es un atributo compartido con otras integraciones de La
> Polar y puede existir ya en la instancia. Si el import falla por conflicto de tipo, basta con borrar
> ese bloque del XML: significa que ya está definido.

### Atributos que NO define, a propósito

`TopsortUtil.js` lee `product.custom.lpPridarticul` y `product.custom.lpArmarcaID` para las columnas
`item_group_id` y `brand_id` del feed. Son atributos del catálogo de La Polar, no de Topsort, y
declararlos acá arriesgaría un conflicto de tipo con la definición existente. El código ya los lee de
forma defensiva (`product.custom && product.custom.lpX || ""`), así que si faltan el feed sale con esas
columnas vacías en vez de fallar.

### Definición del servicio

`topsort_custom_services.xml` define el servicio `lapolar.topsort` con su perfil y credencial.

> **Advertencia:** importarlo **sobrescribe** la credencial existente, incluyendo la URL y el contenido
> de `lpJSONConfig`. Úsalo solo para levantar una instancia nueva. En un sandbox donde el servicio ya
> está configurado y funcionando, importa únicamente `topsort_custom_metadata.xml`.

---

## 3. Archivos de configuración

### `cartridge/scripts/config/topsort_banners.json`

```json
{
  "slotId": "category-top",
  "type": "category",
  "slots": 1,
  "devices": ["desktop", "mobile"],
  "dimensions": {
    "desktop": { "width": 2610, "height": 660 },
    "mobile": { "width": 1536, "height": 800 }
  }
}
```

| Campo | Significado |
|---|---|
| `slotId` | Se envía como `slotId` en la subasta. Debe coincidir con el slot configurado en Topsort. |
| `type` | `search` o `category`. Determina en qué tipo de página participa el slot. |
| `slots` | Cuántos ganadores pedir. Hoy siempre 1, porque el render usa solo `winners[0]`. |
| `devices` | Dispositivos en los que el slot se subasta. Si el `device` del request no está en la lista, el slot no se pide. Los laterales llevan solo `desktop`. |
| `dimensions` | **Informativo.** Las medidas que hay que registrar en cada variante de la campaña en Topsort. No se envían en la subasta. |

El código lee `slotId`, `type`, `slots` y `devices`. `dimensions` documenta lo que se configura del
lado de Topsort, que es donde se valida el tamaño real del creativo. Ver la sección 7.1.

### `cartridge/scripts/config/topsort_sponsored_brands.json`

```json
{
  "slotId": "sponsored-brand-hero-logo",
  "format": "heroLogo",
  "enabled": true,
  "winners": 1,
  "position": "above-grid",
  "afterTile": null,
  "minProducts": 3,
  "maxProducts": 6,
  "slidesToShow": { "desktop": 1, "mobile": 2 }
}
```

| Campo | Significado |
|---|---|
| `slotId` | Se envía como `placementId` en la subasta. Debe coincidir con el `externalPlacementId` del placement. |
| `format` | `heroLogo`, `hero` o `compact`. Determina qué template se usa. |
| `enabled` | Si es `false`, el slot no participa en la subasta. |
| `winners` | Máximo de ganadores a pedir. Cada ganador genera una fila independiente. |
| `position` | `top`, `above-grid`, `in-grid` o `below-grid`. |
| `afterTile` | Solo para `in-grid`: índice de tile (base 1) tras el cual se inyecta la fila. Conviene un múltiplo de 4 para que caiga en borde de fila en desktop. |
| `minProducts` | Si sobreviven menos productos que este número, la fila se descarta completa. |
| `maxProducts` | Tope de productos a renderizar. |
| `slidesToShow` | Tiles visibles a la vez en el carrusel, por dispositivo. |

Sobre `slidesToShow`: la regla es igualar la densidad de la grilla principal, que muestra 4 tiles por
fila en desktop y 2 en mobile. Entonces `desktop = 4 × (fracción de ancho que ocupa la columna de
productos)`. En `heroLogo` esa columna es 25% → 1; en `hero` es 75% → 3. En `compact` el valor
`desktop` **no se usa**: ese formato se desactiva (`unslick`) sobre 1024 px y la grilla de 3 columnas
la resuelve el CSS.

Solo existen dos buckets de dispositivo, desktop y mobile, con corte en 1024 px. Las tablets usan la
configuración de mobile.

---

## 4. Subastas: payloads por tipo

### 4.1 Listings y banners — `POST /v2/auctions`

Ambos tipos viajan en **una sola llamada**, en el mismo arreglo `auctions`. La subasta de listings va
siempre primero (`auctions.unshift(listingsAuction)`).

```json
{
  "auctions": [
    {
      "type": "listings",
      "slots": 6,
      "products": { "ids": ["PID-1", "PID-2", "PID-3"] },
      "opaqueUserId": "71303ce0-de89-496d-8270-6434589615e8",
      "category": { "id": "catg36089" }
    },
    {
      "type": "banners",
      "slots": 1,
      "slotId": "category-top",
      "opaqueUserId": "71303ce0-de89-496d-8270-6434589615e8",
      "device": "desktop",
      "category": { "id": "catg36089" }
    }
  ]
}
```

Detalles:

- `slots` en listings está fijo en **6**.
- `products.ids` son todos los `productID` que devolvió el motor de búsqueda para esa página.
- Se envía `category.id` **o** `searchQuery`, nunca ambos: si hay `cgid` se usa la categoría, si no se
  usa el término de búsqueda. `topsortHelpers.createListingsAuction()` descarta las propiedades nulas.
- El `id` de categoría se envía en minúsculas (`categoryId.toLowerCase()`). La normalización de tildes
  está comentada en el código a la espera de subir el compatibility mode a 21.12.
- `device` se deduce del `User-Agent` y solo aplica a banners. Hace dos cosas: filtra qué slots se
  subastan (los laterales no se piden en mobile, ver `devices` en la sección 3) y le indica a Topsort
  qué variante del creativo devolver. Una misma campaña tiene una variante mobile y otra desktop para
  el mismo `slotId`, así que la respuesta ya trae el asset con las dimensiones del dispositivo: el
  cartridge no reescala nada ni elige entre varios assets.

### 4.2 Marcas patrocinadas — `POST /v2/auctions/sponsored-brand`

Llamada **separada**, con un formato de request distinto: usa `winners` y `placementId` en vez de
`slots` y `slotId`, y agrupa los targeting dentro de `triggers`.

```json
{
  "auctions": [
    {
      "winners": 1,
      "placementId": "sponsored-brand-hero-logo",
      "triggers": { "category": { "id": "CATG36089" } },
      "opaqueUserId": "71303ce0-de89-496d-8270-6434589615e8"
    },
    {
      "winners": 1,
      "placementId": "sponsored-brand-hero",
      "triggers": { "category": { "id": "CATG36089" } },
      "opaqueUserId": "71303ce0-de89-496d-8270-6434589615e8"
    }
  ]
}
```

Detalles:

- El endpoint acepta como máximo **5** subastas por request; los 3 slots caben en una sola llamada.
- Acá el `cgid` se envía **tal cual**, sin pasar a minúsculas. Esto difiere de listings y banners, que
  sí lo convierten. Es la primera cosa a revisar si un slot no devuelve ganadores.
- Este endpoint **no acepta** el campo `device`. Solo admite `winners`, `placementId`, `triggers`,
  `opaqueUserId`, `geoTargeting`, `page`, `storeId` y `filter`. Desktop y mobile corren la misma
  subasta y solo se diferencian al renderizar.

Respuesta esperada (campañas V2, creadas con JSON Template):

```json
{
  "results": [
    {
      "winners": [
        {
          "rank": 1,
          "type": "url",
          "id": "https://www.marca.cl/landing",
          "resolvedBidId": "ChAGc-G66Wt7...",
          "campaignId": "018f3ff3-0d7c-7b75-bf99-629c62c09dc3",
          "vendorId": "v_8fj2D",
          "content": { "creative": "https://.../imagen.png", "logo": "https://.../logo.png" },
          "productIds": ["PID-1", "PID-2", "PID-3"]
        }
      ],
      "error": false
    }
  ]
}
```

Los campos del template llegan en **`content`**, no en `assets`. El arreglo `assets` (con `role`
`image` / `logo`) solo aparece en campañas legadas V1. `sponsoredBrandsHelpers.pickAsset()` lee
primero `content` y cae a `assets` como respaldo, así que ambas formas se renderizan.

Los resultados se corresponden con las subastas **por índice de arreglo**, no por identificador.

---

## 5. Eventos: payloads por tipo

Todos los eventos van a `POST /v2/events`. Impresiones y clics se envían desde el navegador con
`fetch`; la compra se envía desde el servidor.

### 5.1 Impresión

```json
{
  "impressions": [
    {
      "id": "9f1c8d2a-...",
      "occurredAt": "2026-08-28T18:22:41.123Z",
      "opaqueUserId": "71303ce0-de89-496d-8270-6434589615e8",
      "placement": {
        "path": "/s/ABC/categoria",
        "position": 1,
        "page": 1,
        "pageSize": 12,
        "categoryId": "CATG36089"
      },
      "resolvedBidId": "ChAGc-G66Wt7...",
      "deviceType": "desktop",
      "channel": "onsite"
    }
  ]
}
```

Cuándo se dispara:

- **Tiles patrocinados:** al renderizar, desde el `<script>` inline de `productTiles.isml`.
- **Banners:** al renderizar, desde `searchResultsNoDecorator.isml`.
- **Marcas patrocinadas:** cuando la fila entra en viewport con al menos 50% visible, vía
  `IntersectionObserver`. Se dispara una sola vez por fila.

`position` es la posición del anuncio: para tiles es el índice en la grilla + 1, para banners es un
valor fijo por slot definido en el template, y para marcas patrocinadas es el `rank` del ganador.

### 5.2 Clic

Misma estructura, bajo la llave `clicks`, y se envía con `keepalive: true` para que sobreviva a la
navegación.

```json
{
  "clicks": [
    {
      "id": "3b7e5410-...",
      "occurredAt": "2026-08-28T18:22:58.907Z",
      "opaqueUserId": "71303ce0-de89-496d-8270-6434589615e8",
      "placement": { "path": "/s/ABC/categoria", "position": 1, "page": 1, "pageSize": 12, "categoryId": "CATG36089" },
      "resolvedBidId": "ChAGc-G66Wt7...",
      "deviceType": "desktop",
      "channel": "onsite"
    }
  ]
}
```

Cuándo se dispara:

- **Tiles patrocinados:** al hacer clic en el tile.
- **Banners:** al hacer clic en el banner. Cada wrapper de banner lleva
  `data-ts-banner-bid="<resolvedBidId>"` y `setupContentTracking()` lo localiza con
  `document.querySelector('[data-ts-banner-bid="..."]')`, así que cada banner tiene su propio listener.
- **Marcas patrocinadas:** al hacer clic en el creativo, en el logo o en cualquier tile de la fila.
  El listener está delegado en `document`, así que funciona para todas las filas de la página.

> **Histórico:** hasta agosto 2026 los 4 bloques de banner superiores e inferiores compartían
> `id="featured-content"` y los 2 laterales no tenían `id`. Como `getElementById` devuelve solo el
> primer nodo, **todos** los listeners se apilaban sobre un mismo banner: un clic emitía un evento por
> cada banner de la página, cada uno con un `resolvedBidId` distinto, mientras el resto no reportaba
> ninguno. No era solo subreporte, era misatribución. Se corrigió reemplazando el `id` duplicado por
> `data-ts-banner-bid`. Si comparas reportes históricos de CTR por posición de banner anteriores a esa
> fecha, ten presente esta distorsión.


### 5.3 Compra

Se envía desde el servidor en `Order-Confirm`, vía `TopsortService.sendPurchaseEvent()`.

```json
{
  "purchases": [
    {
      "id": "b21f0e77-...",
      "occurredAt": "2026-08-28T18:40:02.001Z",
      "opaqueUserId": "71303ce0-de89-496d-8270-6434589615e8",
      "items": [
        { "productId": "PID-1", "unitPrice": 19990, "quantity": 2 }
      ],
      "orderId": "00012345",
      "currency": "CLP",
      "total": 39980
    }
  ]
}
```

Detalles:

- `items` incluye **todos** los line items de la orden, no solo los patrocinados. La atribución la
  resuelve Topsort del lado servidor.
- `unitPrice` se calcula como `adjustedPrice.value / quantityValue`, es decir el precio unitario ya con
  descuentos aplicados. Los line items cuyo `unitPrice` da 0 o nulo se omiten.
- `total` es `totalGrossPrice.value` (con impuestos).
- El evento **no** lleva `resolvedBidId`: la conexión con la campaña se hace por `opaqueUserId` y
  `productId`.

---

## 6. Atribución

La atribución se apoya en tres identificadores.

### `opaqueUserId`

Identificador anónimo y estable del usuario. Se guarda en la cookie `tsuid` (UUID, `HttpOnly`,
`Path=/`, vigencia de 365 días) y se genera la primera vez que el usuario llega a una página que
ejecuta una subasta. **El mismo valor** se usa en las subastas y en los tres tipos de evento, que es
lo que permite a Topsort enlazar la impresión, el clic y la compra posterior de una misma persona.

Si la cookie se pierde o se regenera, la compra deja de poder atribuirse a la impresión previa. Por eso
la vigencia larga y por eso `Order.js` vuelve a crear la cookie si no existe, en vez de omitir el
evento.

### `resolvedBidId`

Token opaco que Topsort devuelve por **cada bid ganador** de **cada subasta**. Identifica de forma
única a ese anuncio en esa subasta concreta. Se usa para las impresiones y los clics.

Reglas importantes:

- Es de un solo uso lógico por vista de página. **La respuesta de la subasta no se debe cachear**: si
  se reutiliza, los reportes se corrompen porque varios usuarios comparten el mismo `resolvedBidId`.
- En marcas patrocinadas hay **un solo `resolvedBidId` por fila**, no uno por producto. La impresión
  de la fila, el clic en el creativo y el clic en cualquiera de sus tiles reportan todos ese mismo
  valor. Es lo esperado: la unidad publicitaria es la fila completa.
- Si un slot devuelve varios ganadores, cada uno trae su propio `resolvedBidId` y genera su propia fila
  con su propio tracking. El código recorre todos los ganadores; no se queda solo con el primero.

### Product IDs

Los identificadores de producto son el puente entre el catálogo de SFCC y el de Topsort, y deben
coincidir exactamente con los `id` del feed (columna `id`, que es `product.getID()`).

- En **listings** se envían los `productIds` de la búsqueda y los ganadores se cruzan de vuelta contra
  esos mismos IDs.
- En **marcas patrocinadas** el ganador trae `productIds` (los productos de la campaña).
  `resolveProducts()` verifica cada uno con `ProductMgr.getProduct()` y descarta los que no existen o
  están offline. Si sobreviven menos de `minProducts`, la fila completa se descarta para no mostrar
  una grilla incompleta.
- En **compras** los `productId` de los line items son los que Topsort cruza contra las campañas
  activas del usuario.

### Flujo completo

```
1. Usuario entra a la categoría
   └─ ¿existe cookie tsuid? → si no, se crea (opaqueUserId)

2. Subastas (una llamada a /v2/auctions y otra a /v2/auctions/sponsored-brand)
   └─ Topsort responde con winners, cada uno con su resolvedBidId

3. Render
   ├─ impression → opaqueUserId + resolvedBidId
   └─ click      → opaqueUserId + resolvedBidId

4. Compra (Order-Confirm)
   └─ purchase → opaqueUserId + productId por cada ítem
      └─ Topsort enlaza la compra con la impresión/clic previos del mismo opaqueUserId
```

---

## 7. Dimensiones esperadas de los creativos

Límites duros de Topsort, iguales para todos los formatos:

- Formatos aceptados: **JPEG, PNG, WEBP, GIF, MP4**
- Peso máximo: **5 MB por creativo**

### 7.1 Banners

El template los renderiza con `width: 100%` y `border-radius: 12px`, sin alto fijo, así que la imagen
escala y conserva su proporción. Lo que importa es el **ancho** disponible en cada posición, y ese
ancho depende del dispositivo.

Como Topsort resuelve el creativo según el `device` de la subasta, cada slot necesita **dos variantes
cargadas en la campaña**, una mobile y una desktop. Los laterales son la excepción: solo necesitan
desktop, porque no se subastan en mobile.

#### Anchos renderizados

Dos detalles del layout que condicionan las medidas:

- `.ms-contain-search-desktoplarge` **no** impone `max-width` bajo 1680 px. Ahí el contenedor es
  fluido y sigue al viewport; recién desde 1680 px topa en 1305 px, y desde 3360 px en 2610 px. O sea
  que un viewport de 1600 px renderiza el banner superior más ancho (~1570 px) que uno de 1680 px
  (1305 px).
- Sobre 1024 px la fila se parte en barra de refinamientos (1/3) y columna de resultados (2/3). Bajo
  1024 px la barra se oculta (`ms_hide-under-desktop`) y la columna pasa a ancho completo.

| Slot | Mobile (<768 px) | Tablet (768–1023 px) | Desktop (≥1680 px) |
|---|---|---|---|
| `search-top`, `category-top` | 320–767 px | 768–1023 px | 1305 px |
| `search-bottom`, `category-bottom` | 320–767 px | 768–1023 px | ~870 px |
| `search-side`, `category-side` | no se renderiza | no se renderiza | ~435 px |

#### Dimensiones recomendadas

Como no hay alto fijo, la proporción es decisión de diseño. El criterio: una proporción 4:1 que
funciona a 1305 px se convierte en una franja ilegible a 390 px, así que mobile necesita algo más
cuadrado.

**Desktop**

| Slot | Recomendado | Proporción | Cubre |
|---|---|---|---|
| `search-top`, `category-top` | **2610 × 660 px** | ~4:1 | 1305 px a 2x, y 2610 px a 1x |
| `search-bottom`, `category-bottom` | **1740 × 440 px** | ~4:1 | 870 px a 2x |
| `search-side`, `category-side` | **870 × 1160 px** | 3:4 vertical | 435 px a 2x |

**Mobile**

| Slot | Recomendado | Proporción | Cubre |
|---|---|---|---|
| `search-top`, `category-top` | **1536 × 800 px** | ~2:1 | 768 px a 2x; a 390 px con DPR 3 sigue sobremuestreado |
| `search-bottom`, `category-bottom` | **1536 × 800 px** | ~2:1 | igual que el superior, la columna es de ancho completo bajo 1024 px |
| `search-side`, `category-side` | — | — | no se subastan ni se renderizan en mobile |

Estos valores están replicados en el bloque `dimensions` de `topsort_banners.json` para tenerlos a
mano junto a la configuración, pero el tamaño lo valida Topsort contra el slot de la campaña: si no
coinciden, el creativo se rechaza al cargarlo.

### 7.2 Marcas patrocinadas

Los anchos salen de los cortes definidos en `static/default/css/sponsored-brands.css`, aplicados sobre
una columna de resultados de ~880 px en desktop.

| Formato | Atributo | Caja renderizada | Recomendado (2x) | Ajuste |
|---|---|---|---|---|
| `heroLogo` | `creative` | 50% ≈ 440 px de ancho | 880 × 1000 px | `object-fit: cover` → **se recorta** |
| `heroLogo` | `logo` | 25% ≈ 220 px de ancho | 440 × 440 px | `object-fit: contain` → no se recorta |
| `hero` | `creative` | 25% ≈ 220 px de ancho | 440 × 1000 px | `object-fit: cover` → **se recorta** |
| `compact` | `logo` | 48 × 48 px | 192 × 192 px | `object-fit: contain` → no se recorta |

Consideraciones:

- La **altura** de la fila la define el tile de producto, que en ABC ronda los 450–550 px según el
  contenido (badges, swatches, reviews). Los creativos se estiran a esa altura.
- Como los `creative` usan `object-fit: cover`, la imagen se recorta para llenar la caja. Todo el
  contenido relevante (texto, producto, logo incrustado) debe quedar en la **zona central**.
- Los `logo` usan `object-fit: contain`, así que nunca se recortan. Conviene PNG con fondo
  transparente.
- Bajo 1024 px los tres formatos se apilan: el creativo pasa a ancho completo arriba y los productos
  quedan debajo mostrando 2 a la vez. Un creativo muy vertical se verá desproporcionado en mobile.
- Estas medidas se derivan del CSS actual. Si se cambia un corte de ancho hay que recalcular tanto la
  recomendación de imagen como el `slidesToShow` correspondiente.

---

## 8. Creación de JSON Templates y Placements

Se hace **una sola vez por marketplace**, contra `https://api.topsort.com`, con una llave **TSC**
(gestión de campañas). Ojo: no es la misma llave TSE que se usa en subastas y eventos.

### Paso 1 — Crear los tres JSON Templates

`POST /public/v1/campaign-service/json-templates`

`name` admite hasta 50 caracteres y `description` hasta 100. Hay que **guardar el `id` devuelto** por
cada uno, porque se necesita en el paso 2.

Los campos marcados con `"format": "uri"` y `"x-field-type": "file"` se muestran como carga de archivo
en la UI de creación de campañas. El arreglo `products` controla cuántos productos debe asociar el
anunciante.

**Template 1 — imagen + logo + 3 a 6 productos**

```bash
curl -X POST https://api.topsort.com/public/v1/campaign-service/json-templates \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "ABC Marca Destacada con Logo",
  "description": "Imagen y logo a la izquierda, productos deslizables a la derecha",
  "adFormat": "sponsored_brand",
  "jsonSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["creative", "logo"],
    "properties": {
      "creative": { "type": "string", "title": "Imagen", "format": "uri", "x-field-type": "file" },
      "logo": { "type": "string", "title": "Logo", "format": "uri", "x-field-type": "file" },
      "products": { "type": "array", "title": "Productos", "minItems": 3, "maxItems": 6, "items": { "type": "object" } }
    }
  }
}'
```

**Template 2 — imagen + exactamente 3 productos, sin logo**

```bash
curl -X POST https://api.topsort.com/public/v1/campaign-service/json-templates \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "ABC Marca Destacada",
  "description": "Imagen a la izquierda, tres productos deslizables a la derecha",
  "adFormat": "sponsored_brand",
  "jsonSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["creative"],
    "properties": {
      "creative": { "type": "string", "title": "Imagen", "format": "uri", "x-field-type": "file" },
      "products": { "type": "array", "title": "Productos", "minItems": 3, "maxItems": 3, "items": { "type": "object" } }
    }
  }
}'
```

**Template 3 — logo + titular, y grilla fija de 3 productos**

```bash
curl -X POST https://api.topsort.com/public/v1/campaign-service/json-templates \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "name": "ABC Marca Compacta",
  "description": "Logo con titular arriba y tres productos en grilla",
  "adFormat": "sponsored_brand",
  "jsonSchema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["logo", "headline"],
    "properties": {
      "logo": { "type": "string", "title": "Logo", "format": "uri", "x-field-type": "file" },
      "headline": { "type": "string", "title": "Titular", "minLength": 5, "maxLength": 40 },
      "products": { "type": "array", "title": "Productos", "minItems": 3, "maxItems": 3, "items": { "type": "object" } }
    }
  }
}'
```

### Paso 2 — Crear los tres Placements

`POST /public/v1/placement-service/placements`

El `externalPlacementId` es el valor que el cartridge envía como `placementId`, así que **debe coincidir
exactamente** con el `slotId` de `topsort_sponsored_brands.json`. Debe cumplir el patrón
`^[A-Za-z0-9_-]+$`. El `name` debe tener entre 5 y 50 caracteres. Tanto `logo.min/max` como
`products.assets.min/max` están limitados a exactamente `1` por el esquema de la API.

```bash
curl -X POST https://api.topsort.com/public/v1/placement-service/placements \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "externalPlacementId": "sponsored-brand-hero-logo",
  "name": "ABC Marca Destacada con Logo",
  "jsonTemplateId": "<id del template 1>",
  "logo": { "min": 1, "max": 1 },
  "products": { "min": 3, "max": 6, "assets": { "min": 1, "max": 1 } }
}'
```

```bash
curl -X POST https://api.topsort.com/public/v1/placement-service/placements \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "externalPlacementId": "sponsored-brand-hero",
  "name": "ABC Marca Destacada",
  "jsonTemplateId": "<id del template 2>",
  "products": { "min": 3, "max": 3, "assets": { "min": 1, "max": 1 } }
}'
```

```bash
curl -X POST https://api.topsort.com/public/v1/placement-service/placements \
  -H "Authorization: Bearer $TSC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
  "externalPlacementId": "sponsored-brand-compact",
  "name": "ABC Marca Compacta",
  "jsonTemplateId": "<id del template 3>",
  "logo": { "min": 1, "max": 1 },
  "products": { "min": 3, "max": 3, "assets": { "min": 1, "max": 1 } }
}'
```

Notas de diseño:

- Se omitió a propósito el `title` a nivel de placement en los tres casos, para que el único campo de
  texto sea el `headline` del template 3. Si no, la UI de campañas mostraría dos campos de texto
  compitiendo entre sí.
- Se omitió también `previewTemplate` (`html` / `css`), que es opcional: `placement_service` lo guarda
  tal cual y por defecto queda en `{}`. No afecta al renderizado en el storefront.

### Paso 3 — Crear campañas

Con templates y placements creados, las campañas se arman desde la UI de Topsort eligiendo el
placement correspondiente. Códigos de error útiles al crear por API:

| Código | Significado |
|---|---|
| `400` | El `content` no valida contra el JSON Template del placement. |
| `404` | No existe el vendor, la wallet o el slot. |
| `409` | Ya existe un placement con ese `externalPlacementId`, o la campaña/bid ya existe. |

---

## 9. Feed de catálogo

A diferencia del resto de la integración, el catálogo **no se envía**: el cartridge genera un archivo
plano y lo deja publicado, y es Topsort quien lo descarga por HTTPS según la frecuencia que se
configure de su lado. No hay llamada saliente ni credencial involucrada en este flujo.

### 9.1 Formato: es un TSV con extensión `.csv`

El nombre del archivo termina en `.csv`, pero el separador es **tabulador**, no coma. Sale de
`TopsortUtil.js`, donde se instancia el writer con el carácter 9:

```js
var fileWriter = new dw.io.FileWriter(file, "UTF-8");
var writer     = new dw.io.CSVStreamWriter(fileWriter, String.fromCharCode(9));
```

Es decir: TSV codificado en UTF-8, con el entrecomillado propio de `CSVStreamWriter` (solo entrecomilla
los campos que contienen el separador o comillas). Al configurar la fuente en Topsort hay que
declararlo como **tab-delimited**; leerlo como CSV separado por comas deja todo en una sola columna.

La extensión no se corrige por compatibilidad: cambiarla obliga a actualizar la URL registrada en
Topsort.

### 9.2 Dónde queda y cómo lo obtiene Topsort

```
Libraries/topsort-shared-library/library/feeds/topsortFeed-{siteID}.csv
```

`{siteID}` sale de `Site.getCurrent().ID`, así que cada sitio genera su propio archivo y un
marketplace multisitio necesita una fuente por sitio en Topsort. El directorio se crea con `mkdirs()`
si no existe.

Escribir dentro de la shared library `topsort-shared-library` es lo que hace el archivo alcanzable:
el contenido estático de una library se sirve por HTTPS, y esa URL pública es la que se registra en
Topsort como origen del catálogo. La URL exacta depende de cómo esté mapeada la library en el sitio,
así que conviene confirmarla abriéndola en el navegador antes de registrarla.

### 9.3 Qué productos entran

El job recorre `ProductMgr.queryAllSiteProducts()` y descarta tres tipos:

```js
if (product.isProductSet() || product.isBundle() || product.isMaster()) {
    continue;
}
```

Quedan fuera los product sets, los bundles y los masters. Las variantes sí entran, cada una como fila
propia, y se agrupan por `item_group_id`.

### 9.4 Columnas

| Columna | Origen | Notas |
|---|---|---|
| `id` | `product.getID()` | Es el identificador que se cruza con los `productIds` de las subastas y con los `productId` de los eventos de compra. |
| `title` | `product.getName()`, con fallback al ID | |
| `description` | `title + " - " + (product.brand \|\| "La Polar")` | Derivada, no es la descripción del producto. |
| `availability` | `getAvailabilityStatus()` | `in stock` si está en stock, `preorder` en cualquier otro caso. Nunca emite `out of stock`. |
| `condition` | Fijo | Siempre `new`. |
| `price` | Price book normal | Ver 9.5. |
| `price_sale` | Menor de los price books | Ver 9.5. |
| `link` | `URLUtils.https("Product-Show", "pid", id)` | Pasa por `urlHelpers.replaceHostnameWithCanonicalNameInUrl()` y luego `encodeURI()`. |
| `image_link` | Primera imagen `large` | `httpsURL` de la primera imagen; cadena vacía si el producto no tiene. Pasa por el reemplazo de hostname canónico y `encodeURI()`. |
| `brand` | `product.brand` | Cae a `"La Polar"` si viene vacío. |
| `custom_label_0` | Categoría, nivel más general | Ver 9.6. |
| `custom_label_1` | Categoría, nivel intermedio | Ver 9.6. |
| `custom_label_2` | Categoría primaria del producto | Ver 9.6. |
| `item_group_id` | `custom.lpPridarticul` | Agrupa variantes del mismo artículo. Vacío si el atributo no está seteado. |
| `brand_id` | `custom.lpArmarcaID` | Vacío si el atributo no está seteado. |

> **El orden físico de las columnas no es el orden de las asignaciones en el código.** La fila se arma
> sobre un `dw.util.SortedMap`, y `line.values()` devuelve los valores ordenados por clave interna, no
> por orden de escritura. El resultado es alfabético por el nombre de variable, no por el nombre de la
> columna:
>
> ```
> availability  brand  custom_label_0  custom_label_1  custom_label_2  condition
> description  id  image_link  link  brand_id  item_group_id  price  price_sale  title
> ```
>
> La cabecera y las filas de datos pasan por el mismo mapa, así que siempre quedan alineadas entre sí.
> El detalle importa solo si alguien mapea columnas por posición en vez de por nombre de cabecera.

### 9.5 Precios

Se leen de los price books configurados en `Constants.PRICEBOOK_SITE_PREF_IDS`, que son las site
preferences `lpNormalPricebook`, `lpInternetPricebook` y `lpTlpPricebook`. El **primero** define
`price`, y el **menor de los tres** define `price_sale`. Si un price book no tiene precio para el
producto se omite del cálculo; si ninguno lo tiene, ambas columnas quedan vacías.

Como `price_sale` es el mínimo incluyendo al normal, cuando no hay oferta vigente las dos columnas
traen el mismo valor.

### 9.6 Categorías

`feedHelpers.getThreeCategoryLevelsInReversed()` sube desde `product.primaryCategory` por el árbol y
toma hasta **tres** niveles, del más específico al más general. Después los invierte al escribirlos,
de modo que `custom_label_0` es el más general de los tres capturados y `custom_label_2` la categoría
primaria del producto.

Tres consecuencias que conviene tener presentes:

- Si el árbol es **más profundo que tres niveles**, se capturan los tres ancestros más cercanos, no
  las categorías raíz. Los `custom_label_*` no representan la ruta completa del catálogo.
- Si es **menos profundo**, las etiquetas sobrantes quedan como cadena vacía. Un producto colgado a
  dos niveles deja `custom_label_0` vacío.
- Un producto sin categoría primaria deja las tres vacías.

> Los `custom_label_*` llevan el **ID** de la categoría de SFCC (`category.ID`), no el nombre. De ahí
> salen los identificadores de categoría del catálogo en Topsort, que son los que deben calzar con el
> `category.id` que se envía en las subastas.

> **Ojo con las mayúsculas.** El feed escribe `category.ID` tal cual, mientras que las subastas de
> listings y banners envían `categoryId.toLowerCase()` (ver sección 4.1). Si algún ID de categoría
> tiene mayúsculas, los dos lados no coinciden literalmente y la subasta puede volver sin ganadores.
> Es el primer lugar donde mirar cuando una categoría no devuelve resultados patrocinados.

### 9.7 Operación del job

`scripts/services/TopsortProductFeed.js` expone `start()`, que es el punto de entrada. El cartridge
**no trae `steptypes.json`**, así que el step hay que configurarlo en Business Manager
(**Administration > Operations > Jobs**) apuntando al módulo y a la función `start`.

El writer hace `flush()` cada 700 productos para no acumular todo en memoria, y cierra el writer, el
file writer y el iterador de productos en un bloque `finally`, de modo que un error a mitad de camino
igual libera los recursos. Eso sí, el archivo queda **truncado y publicado**: si el job falla a mitad,
Topsort descarga un catálogo incompleto en vez de fallar. Conviene revisar el resultado del job antes
de asumir que el catálogo está al día.

---

## 10. Pruebas en modo Mock

El servicio `lapolar.topsort` implementa `mockFull`, que lee el JSON de la credencial
(`custom.lpJSONConfig`) y devuelve la entrada correspondiente al tipo de mock. Los tipos están en
`config/topsortMockTypes.json`:

```json
{
    "runAuction": "runAuction",
    "runSponsoredBrandAuction": "runSponsoredBrandAuction",
    "sendEvent": "sendEvent"
}
```

Para previsualizar los tres formatos de marcas sin campañas reales:

1. Ir a **Administration > Operations > Services > Credentials** y abrir la credencial de
   `lapolar.topsort`.
2. Fusionar la llave `runSponsoredBrandAuction` del archivo `sponsored-brands-mock.sample.json`
   (en la raíz de este cartridge) dentro del JSON existente de `lpJSONConfig`, conservando lo que ya
   esté configurado en `runAuction` y `sendEvent`.
3. Poner el perfil del servicio en modo **Mock** y cargar cualquier página de categoría.

> **Hay que reemplazar los `REPLACE-WITH-REAL-PID`** por IDs de productos que existan y estén online en
> la instancia. El cartridge descarta los productos que no puede resolver y omite la fila entera cuando
> sobreviven menos que `minProducts`, así que con IDs falsos no se renderiza nada y solo queda un
> mensaje en el log `SponsoredBrands`.

---

## 11. Troubleshooting

| Síntoma | Dónde mirar |
|---|---|
| No aparece ninguna fila de marca | Que la página sea de categoría (`cgid` presente), que no haya filtros aplicados, y que la categoría no tenga `topsortDisabled`. |
| La subasta responde sin ganadores | El `cgid` se envía tal cual a marcas patrocinadas y en minúsculas a listings/banners. Comparar contra los IDs de categoría del catálogo en Topsort. |
| Una fila desaparece pese a haber ganador | Log `SponsoredBrands`: probablemente sobrevivieron menos productos que `minProducts` porque están offline o no existen. |
| El carrusel no se inicializa | `sponsored-brands.js` espera a que existan `window.$` y `$.fn.slick`. Si `main.js` de `app_abc` no cargó, queda un warning en consola. |
| La fila `in-grid` no se ve | `afterTile` está en 8: si la categoría tiene menos de 8 tiles, el ancla no existe. |
| No se envían eventos | Verificar `topsortTrackingEnabled` y que `ProductEngagement.init()` haya corrido (mira la consola). |
| Un banner registra impresiones pero nunca clics | Revisar que su wrapper tenga `data-ts-banner-bid` con el mismo `resolvedBidId` que recibe `setupContentTracking()`. Si el atributo queda vacío, el `querySelector` no encuentra el nodo. |
| No se ejecuta ninguna subasta en una categoría | Revisar el atributo `topsortDisabled` de esa categoría. Si está en `true`, `Search.js` sale temprano y deja `bannerWinners` como objeto vacío, sin llamar a la API. |
| Errores de servidor | Logs `SponsoredSearch` (listings y banners), `SponsoredBrands` (marcas) y `TopsortService` (HTTP). |
| El catálogo en Topsort llega en una sola columna | El feed es tab-delimited pese a la extensión `.csv`. La fuente en Topsort tiene que estar declarada como TSV, no como CSV separado por comas. |
| Faltan productos en el catálogo de Topsort | Product sets, bundles y masters se excluyen por diseño (solo entran variantes y productos estándar). Si faltan otros, revisar si el job terminó: al fallar a mitad deja el archivo truncado pero publicado, sin marcar error del lado de Topsort. |

---

## 12. Pendientes

- [x] **Crear los tres JSON Templates y los tres Placements de marcas patrocinadas.** Hecho por API
      con llave TSC, según los pasos 1 y 2 de la sección 8. Los `externalPlacementId`
      (`sponsored-brand-hero-logo`, `sponsored-brand-hero`, `sponsored-brand-compact`) ya coinciden
      con los `slotId` de `topsort_sponsored_brands.json`.

- [ ] **Contrastar los slots de banners con los que existen realmente en Topsort.** Lo hace ABC
      desde la UI de Topsort: confirmar que los seis `slotId` de `topsort_banners.json`
      (`search-top`, `search-side`, `search-bottom`, `category-top`, `category-side`,
      `category-bottom`) existan con ese nombre exacto, y reemplazar los assets de las campañas
      activas por creativos que calcen con las dimensiones de la sección 7.1. Cada slot necesita su
      variante desktop y su variante mobile, salvo los dos laterales, que son solo desktop.

- [ ] **Crear las campañas de marcas patrocinadas en la UI de Topsort y testear.** Una campaña por
      cada uno de los tres placements, con los creativos dimensionados según la sección 7.2.
      Verificar en una página de categoría que las tres filas aparezcan en su posición
      (`above-grid`, `in-grid` después del tile 8, y `below-grid`), que los productos asociados
      existan y estén online, y que se reporten impresión y clic.

---

## Referencias

- [Auctions API](https://docs.topsort.com/en/api-reference/auctions)
- [Sponsored Brands — subasta](https://docs.topsort.com/en/knowledge-base/ad-platform/sponsored-brands/sponsored-brands-auction)
- [Create JSON Template](https://docs.topsort.com/en/api-reference/campaign-api/create-json-template)
- [Create a Placement](https://docs.topsort.com/en/api-reference/placement-api/create-a-placement)

