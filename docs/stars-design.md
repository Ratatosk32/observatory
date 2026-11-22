> Design notes written while the project was built. Where the shipped site differs, the README describes the shipped behaviour.

# Stars mode: "Rubin's restless sky"

Design for the second mode of the Rubin visualisation. The first mode follows asteroids; this one shows everything else that changed in Rubin's 2026 alert stream, from flaring stars a few dozen parsecs away to supernovae billions of light years away. The implementer builds from this file and `site/data/stars.json`; nothing here needs the network at run time.

**At a glance (built 2026-11-22):**
- `site/data/stars.json`: 3.85 MB, 4,780 non-Solar-System objects. They come from 8,689 sample alerts: 1,362 from `explore` and 7,327 from `tags`.
- 16,970 "sparks": one per object per night, out of 170,609 raw alert and source rows.
- 975 light curves (165,465 exposures, binned), 56 featured objects with forced photometry and science/template/difference stamps.
- 145 nights of Fink statistics, 25 Oct 2025 to 15 Nov 2026.
- Gaia DR3 context: a 12 M-star Milky Way density map, 6,764 stars brighter than G = 6, and a 1.34 M-star HR diagram.
- Gaia crossmatch: 870 objects matched within 1″ after propagating proper motion; 427 Gaia periods; 1,275 objects with a distance of some kind.

---

## 1. What data exists (research summary)

| Source | Public, no login? | What we use | Notes |
|---|---|---|---|
| **Fink LSST API** `api.lsst.fink-portal.org/api/v1` | Yes | `explore` (samples per catalogue class), `tags` (per filter), `objects` (aggregates), `sources` (light curves), `fp` (forced photometry), `cutouts` (stamps), `statistics` (per night) | Fast (0.3–10 s per call). No published rate limit; we pause 0.5–1 s between calls and batch 10–100 IDs per call. One 502 on `tags` during the run. Crossmatches attached by Fink: VSX, SIMBAD, TNS (name, type, redshift), Mangrove host galaxies (luminosity distance), Legacy Survey DR8 photo-z, GCVS, SPICY. **Fink's own Gaia DR3 crossmatch field returned "Fail" for every row we saw**, so we crossmatch Gaia ourselves. |
| **Gaia DR3** via ESA Gaia Archive TAP `gea.esac.esa.int/tap-server/tap` | Yes (anonymous). The default MAXREC is 50,000 rows, so we pass MAXREC. Sync jobs time out at about 60 s and **uploaded-table joins time out**, so the crossmatch uses batches of 40 OR-ed `CONTAINS` circles (1–2 s each). | All-sky star density (12 M random stars binned 0.5°), bright stars (G < 7), a nearby-star HR diagram (1.34 M stars within 200 pc), positional crossmatch of Rubin's stellar objects with parallaxes, Bailer-Jones distances and Gaia variability periods | Licence CC BY-SA 3.0 IGO, acknowledgement required (Section 9). |
| **ALeRCE** `api.alerce.online` | Yes | Nothing | Public API serves ZTF only; `survey=lsst` returns no objects. |
| **ANTARES** `api.antares.noirlab.edu` | Yes | Nothing | Public loci are ZTF. |
| **Lasair (LSST)** `lasair.lsst.ac.uk` | Account + API token | Nothing | Free sign-up, but a token is a login; out of scope. |
| **Rubin Data Preview 1** `dp1.lsst.io` | **No** | Nothing | "Only Rubin data rights holders may have an account in the Rubin Science Platform (RSP) and access to Data Preview 1." |

**Not available publicly:** Rubin's visit/pointing history, so the true survey footprint cannot be drawn. The map shows where *this sample's* alerts came from, and says so.

### How the sample was drawn (and why it is biased)

- `explore` returns a small, recent sample per catalogue class (1 to ~200 alerts; 1,362 in total). We asked for 89 classes grouped into 12 families (VSX, SIMBAD and TNS labels; full list in `scripts/fetch_stars.py`, `FAMILIES`).
- `tags` returns the last *n* alerts inside a date window. We asked for up to 150 alerts per half-month, Jan–Dec 2026, for seven tags: `in_tns`, `most_likely_sn`, `mdwarf_flare`, `sn_near_galaxy_candidate`, `extragalactic_new_candidate`, `extragalactic_lt20mag_candidate`, `hostless_candidate`. Because it is "last n", each window leans to its last nights.
  - Result: 7,327 alerts. in_tns 1,950, sn_near_galaxy 1,650, extragalactic_new 1,457, extragalactic_lt20mag 891, most_likely_sn 750, hostless 479, mdwarf_flare 150 (M-dwarf flares are rare in the stream).
  - Tags were not requested for Oct–Dec 2025; objects from those months appear through their light curves.
- Every object seen in either list got its `objects` aggregate (first/last detection, number of detections, per-band means).
- Light curves (`sources`) were fetched for the best-sampled objects of each family (quota per family, `LC_QUOTA`), forced photometry and stamps for 4 featured objects per family.
- **Consequence:** the relative numbers of families reflect our quotas, not the sky. The page must never present them as "Rubin found X% supernovae". The census view (V5) states the selection.

---

## 2. Concepts considered

**A. "The restless sky": a galactic all-sky map that lights up night by night.** Gaia's Milky Way drawn in pencil and gold; every Rubin alert in the sample sparks at its position on its night and leaves an ember. Strength: hypnotic, immediately readable, and it shows a real surprise. In this first season almost all of Rubin's alerts come from high Galactic latitudes, looking *out* of the Milky Way. The deep drilling fields show as bright clusters, and nothing extragalactic appears in the dusty plane. Weakness: the sky is 2D; it hides the most astonishing number in the data, the range of distances.

**B. "Ten powers of distance": a depth ladder.** One logarithmic distance axis from 1 pc to 10 Gpc. Each object sits at its own, honestly sourced distance: Gaia parallax, RR Lyrae standard candle, TNS spectroscopic redshift, host-galaxy distance, photometric redshift. Landmarks: Proxima, Pleiades, the Galactic centre, the LMC, M31, Virgo, Coma. Strength: it answers "how far does Rubin see?" with nine decades on one line. Weakness: alone it is a static strip; most objects have no distance and must sit in an honest "unknown" pile.

**C. "Light-curve score": a music sheet.** Every object a stave; periodic stars folded on their Gaia period become repeating motifs, supernovae one crescendo. Strength: beautiful and true to the data's time structure. Weakness: dense, hard to read for 1,000+ objects; best as a detail view.

(Also weighed: a 3D Gaia distance cloud, rejected because only a few dozen Rubin stellar objects have good parallaxes and 3D adds cost without adding truth; a supernova stamp gallery, kept as the featured strip inside the card; a footprint-growth map, rejected as the main idea because the real footprint is not public.)

### Chosen: A + B, linked, with C as the object card

The sky map is the hero and the clock; the depth ladder sits right under it and shares the same objects, colours, selection and time. When a spark fires on the sky, the same object pulses on the ladder, so the viewer sees in one glance *where* (direction) and *how far* (distance). The music sheet lives in the object card and the auto-tour.

Reasoning: A carries the half-hour of mesmerising (the season replays, the sky fills, the "sky above Rubin tonight" lantern slides along the Milky Way as the months pass). B carries the "wow, nine orders of magnitude" fact and keeps the map honest (two sparks side by side on the sky can be a flare star 300 pc away and a supernova 1 Gpc behind it). C rewards clicking. Each answers a question nobody can answer from the asteroid mode.

---

## 3. Views and the question each answers

Mode title: **Rubin's restless sky** . Subtitle (Plex, generated): "4,780 objects that changed · 25 Oct 2025 – 15 Nov 2026 · Fink alerts + Gaia DR3"

| # | View | Question it answers | Units / encoding |
|---|---|---|---|
| V1 | Sky map (hero) | *Where in the sky does something change, and where is Rubin looking tonight?* | Galactic coordinates (l, b) in degrees, Hammer equal-area projection, l = 0 at centre and increasing to the left (astronomical convention). |
| V2 | Depth ladder | *How far away are the things that change?* | Log10 distance in parsecs, 1 pc to 10 Gpc, with kpc/Mpc/Gpc labels and light-travel time. |
| V3 | Season ribbon (the scrubber) | *When was Rubin watching, and in which filters?* | Alerts per night (Fink, all alerts, log scale), stacked by band; sample alerts per night as dots; gaps hatched. |
| V4 | Object card ("postcard") | *What does this one object do?* | Light curve in difference flux (nJy) and apparent magnitude (AB); folded light curve when a Gaia period exists; stamps; distance with method. |
| V5 | Census | *What is in this sample, and how was it chosen?* | Counts per family; how many have a light curve, a distance, a period. |
| V6 | HR diagram (recommended: 201 objects qualify) | *What kind of star is it?* | Gaia BP−RP colour (mag) vs absolute G (mag), 1.34 M nearby Gaia stars as background; Rubin variables with parallax S/N ≥ 5 on top. |

### V1 Sky map

Layers, back to front:

1. **Paper** (#161c2b with the existing generated texture).
2. **The Galaxy, drawn.** From `milkyWay.density` (Gaia DR3, 12 M random stars, 0.5° cells). A preview rendered during design showed the disk, the bulge, the dust rifts and both Magellanic Clouds cleanly.
   - a soft wash: density → alpha of a chalk/gold mix (#ece6d6 60% + #f0bf4f 40%), gamma 1.6 after log-scaling, max alpha about 0.55. The dust lanes appear on their own as dark rifts; the bulge glows; the LMC and SMC are two clear islands at lower right.
   - three iso-density contours (marching squares on the grid smoothed with a 3×3 box) drawn as gold pencil lines at 0.35/0.25/0.15 alpha: these are the "hand-drawn" outline of the Milky Way.
   - optional hatching inside the outer contour at 45°, 1 px, 6 px gap, alpha 0.05 (use the existing `hatch()` helper style).
3. **Bright stars** (`brightStars`, Gaia G < 6, 6,764 stars): chalk dots, radius 0.4–1.8 px by magnitude, tinted from pale blue (BP−RP < 0.3) through chalk to amber (BP−RP > 1.5). They give the sense of a real sky without becoming a star chart. No constellation lines.
4. **Graticule & guides** (pencil, alpha 0.12–0.3):
   - b = ±30°, ±60°, l every 60°; labels "Galactic centre", "anticentre" at l = 180°.
   - Celestial equator (dashed) and **dec = +30° (dashed gold, label "north of this line Rubin cannot see")**.
   - Ecliptic (dotted, label "the asteroids' plane (other mode)"). Clicking that label switches mode.
   - Labels: "Large Magellanic Cloud", "Small Magellanic Cloud", "Galactic bulge", "dust lanes" (one arrow), and the deep drilling fields (see below).
5. **Deep drilling fields**: small pencil circles (radius ~1.75°, Rubin's field of view) with small labels: COSMOS (RA 150.11, Dec +2.18), XMM-LSS (35.71, −4.75), ECDFS (53.13, −28.10), ELAIS-S1 (9.45, −44.03), EDFS (58.90, −49.32 and 63.60, −47.60). Caption: *"Clusters of sparks here are where Rubin stares longest, not where the Universe is busiest."*
6. **"Sky above Rubin tonight" lantern**: the part of the sky higher than 30° (airmass < 2) at local midnight at Cerro Pachón (lat −30.2446°, lon −70.7494°) on the scrubbed date. It is a small circle of radius 60° around the zenith (RA = LST at midnight, Dec = −30.24°). Draw as a dashed gold outline and a radial gold fill at alpha 0.04. It is computed, not data, and the legend says so. As the season plays it slides along the Milky Way: over the bulge in June/July, over the Magellanic Clouds and the south Galactic pole in Nov–Jan. This is the stars-mode equivalent of the asteroid mode's searchlight.
7. **Embers**: every object whose first detection `t0` ≤ now is a dot (radius 1.2 px, family-group colour, alpha 0.35). The sky fills up over the season.
8. **Sparks**: every alert point with `t` in (now − 4 d, now] draws a glow sprite: radius 3–12 px by difference magnitude (brighter = bigger; mag 16 → 12 px, mag 24 → 3 px), alpha = exp(−age/1.5 d). Composite `lighter`. Negative difference flux (`sgn = −1`, the star got *fainter* than the template) draws as a ring instead of a filled glow, a real and important distinction for variable stars.
9. **Selection** (vermilion #ef5f4a): ring + leader line to a label; same object highlighted on V2 and V3.

Caption (V1): *"Gaia's Milky Way in pencil; each spark is one night on which a Rubin object in this sample changed. In this first season Rubin's alerts mostly come from high Galactic latitudes, looking out of the Milky Way: the stars it caught are halo stars along the way, and the plane and the Magellanic Clouds, drawn from Gaia, have almost no alerts here. Clusters are deep drilling fields, where Rubin returns night after night."*

### V2 Depth ladder

- Horizontal axis, full width under the map, log10(distance / pc) from 0 to 10. Major ticks at every decade, labelled `1 pc, 10 pc, 100 pc, 1 kpc, 10 kpc, 100 kpc, 1 Mpc, 10 Mpc, 100 Mpc, 1 Gpc, 10 Gpc`, and a second, smaller row in light-travel time (`3 yr, 33 yr, 330 yr, … 3.3 Gyr`). (1 pc = 3.26 light years.)
- Landmarks from `meta.landmarks` as short pencil ticks above the axis with small labels: Proxima, Pleiades, Galactic centre, LMC, SMC, M31, Virgo cluster, Coma cluster, z = 0.5. These are context, not data, drawn in chalk not gold.
- Lanes: five rows (one per family group, same order and colour as the legend). In each lane objects are a beeswarm along x (dot radius 2.5 px; jitter only in y inside the lane).
- **Marker = method** (the honesty encoding):
  - filled dot: direct measurement (`gaia_parallax`, `tns_redshift`);
  - open ring: indirect (`rr_lyrae_candle`, `cloud_member`, `host_galaxy`);
  - dotted ring: weak (`photo_z`).
  - Error whisker from `distLo` to `distHi` drawn only on hover/selection (otherwise too busy).
- **The unknown pile**: at the right end, a hatched box per lane: "no distance: N". Its height or count is honest about how much of the sample cannot be placed. Hovering it explains why (no Gaia match, faint, no redshift).
- Time link: when a spark fires on V1, the same object pulses on V2 (same glow sprite, half size).
- Caption: *"Each object at its own distance, measured the way its marker shows. Flaring and eclipsing stars sit within a few kpc, RR Lyrae 10–100 kpc out in the halo, supernovae hundreds of Mpc to Gpc away. Nine powers of ten on one line; three in four objects cannot be placed and wait in the pile."*

### V3 Season ribbon (time scrubber)

- x: date, 25 Oct 2025 (first Fink night) to the last night in `nights` (15 Nov 2026). Bars: `nights[].alerts`, log scale, stacked by `bands` (u g r i z y with the existing band tokens `--b-u` … `--b-y`).
- Nights with no statistics are hatched as gaps. Label each gap longer than 10 nights: 29 Jan–17 Feb, 10 Mar–5 Apr, and the long one, 14 Jul–30 Oct 2026 ("no data for 108 nights"). Do not interpolate.
- Dots below the bars: number of sample alert points per night (`alerts.t`), so the viewer sees how sparse our sample is relative to the full stream.
- Playhead (vermilion line) + date label; Play/Pause; speed 1, 2, 5, 15 days/s (default 2). Option **"skip gaps"** (default on): while inside a stretch with no stats nights, time advances at 30 days/s and the map shows a centred chalk note "No observations in this stretch".
- Click/drag to scrub; keyboard ←/→ = ±1 night, Shift = ±7.

### V4 Object card (postcard)

Cream postcard (`--card`), same component as the asteroid card. Content:

- Title: TNS name if any (`objects.name`), else "Rubin object" + last 6 digits of `id`; family chip; catalogue type string (`catType`), e.g. "VSX RRAB", "TNS SN Ia".
- Grid of facts: RA/Dec and l/b; first–last detection and N detections; per-band mean magnitude (`meanMag`, from science-image flux, so the total brightness); Gaia G and BP−RP when matched (with match separation in arcsec); distance with method in words and its range; period and its source.
- **Light curve** (`lcs[lc]`): x = date, y = difference flux in nJy (linear, zero line drawn) — the quantity Rubin alerts on, which can be negative. Toggle to apparent magnitude of the science flux (`s`, total brightness) for stars.
- **Folded "score"** (the music sheet), shown when `period` exists:
  - x = phase 0–2 (two cycles).
  - One thin stave per band (u at the top … y at the bottom), only for bands with ≥ 5 points. Each stave is normalised to its own 2nd–98th percentile of difference flux, because every band has its own template offset.
  - Points coloured by band, with a faint gold pencil line through a running median.
  - Fold the unbinned `fp` points for featured objects, otherwise the `lcs` points (binned at P/20, so still sharp).
  - The caption names the source: "Folded on 0.3721 d from Gaia DR3 vari_rrlyrae (2014–2017 data); Rubin's 2026 points still line up."
  - If `featured[].periodRubin` exists and `reliable` is true, add one line: "Rubin alone finds 0.3721 d (agrees)", or "… half the Gaia period: two eclipses per orbit", or "… a different, probably aliased period". Omit the line when `reliable` is false.
- **Supernovae, TDEs and CVs:** zoom the x-axis to [t0 − 30 d, t1 + 30 d], not the whole season.
- **Featured objects** add: forced photometry (`featured[].fp`) as hollow points with error bars, which shows the flat baseline before a supernova rose; and the stamp triplet (science − template = difference) at `stampT`.
- Close on Esc / tap outside; on phone it is a bottom sheet.

### V5 Census

A small horizontal bar list per family (count of objects), with three thin overlays: has light curve, has distance, has period. Footnote: *"How we chose these: up to ~200 recent alerts per catalogue class and up to 150 per half-month per Fink tag. Proportions reflect that choice, not the sky."* Clicking a family filters V1/V2 (dims the rest to 15%).

### V6 HR diagram (optional)

Background: `hrDiagram` (1.34 M Gaia stars within 200 pc) as a grey/chalk density raster, main sequence, giant branch and white-dwarf sequence clearly visible. Overlay: Rubin objects with `gaiaPlx/gaiaPlxErr ≥ 5`, M_G = G + 5 log10(plx/100) (plx in mas), coloured by group. Caption: *"Where the changing stars sit among ordinary ones: flare stars at the cool bottom of the main sequence, white-dwarf binaries below it."* Objects that qualify today: 93 flare/spotted stars, 60 eclipsing binaries, 22 CVs, 15 other stars, 6 young stars, 4 δ Scuti and only 1 RR Lyrae. RR Lyrae are too far for good parallaxes, which is worth one line in the caption. Do not claim an instability strip from 5 points.

---

## 4. Interactions and animation

- **Mode switch** in the header: segmented control "Asteroids | Stars & beyond"; URL `?mode=stars`. `stars.json` (3.85 MB) is loaded lazily the first time the mode opens (inject a `<script>`), with a pencil-drawn "loading the sky…" state.
- **Hover** (desktop): nearest object within 8 px on V1 or V2 → tooltip (name/family/type/distance). Use a uniform grid index over projected positions (rebuild on resize).
- **Click/tap**: select → card, vermilion highlight in all views. Tap empty space clears.
- **Family legend** chips (5 groups, expandable to 14 families): toggle visibility; Alt-click solo.
- **Presets** (like the asteroid mode's): "Everything", "Pulsating stars", "Explosions", "Black holes", "Deep drilling fields" (`reason > 0`), "Halo RR Lyrae", "Farthest 20", "Nearest 20", "Tour". There is no Magellanic Cloud preset, because the sample has no objects there.
- **Tour** (the half-hour mode): every 20 s pick the next featured object, scrub time to its peak, select it, show the card; between featured objects the season plays at 2 days/s. Stops on any user input. This is what keeps the page alive on a wall.
- **Drop to distance** (delight, one button on V1): animated transition (900 ms, ease-in-out) where each visible ember travels from its sky position down to its ladder position, unknown-distance ones dropping into the hatched pile. It makes the link between "where" and "how far" physical. Draw the flight on an overlay canvas spanning both views; skip on phone.
- **Reduced motion**: no autoplay, no sparks decay animation (show all alerts of the selected night as static dots), Drop-to-distance becomes an instant switch.
- Animation pauses when the tab is hidden (same as asteroid mode).

---

## 5. Visual language (Postman night)

- Paper #161c2b, panels framed with the existing seeded rough SVG frames, IBM Plex Sans for all text and numbers, weight and size for emphasis.
- **Restraint**: five family-group colours only, all from the existing palette:

  | Group | Families | Token | Hex |
  |---|---|---|---|
  | Pulsating stars | rrlyr, ceph, dsct, lpv | `--gold` | #f0bf4f |
  | Binaries, flares & other stars | ecl, active, yso, cv, star | `--c-tro` | #78d3ec |
  | Explosions | sn, sncand | `--c-neo` | #ff9a5c |
  | Black holes | agn, tde | `--c-hil` | #b9a9ff |
  | Unclassified | unk | `--ink3` | chalk 58% |

  Vermilion (#ef5f4a) stays reserved for selection and the playhead.
- **Glows**: pre-render one sprite per group at 64×64 (radial gradient: core white-tinted 100%, group colour 60% at r = 0.2, 0 at r = 1). Draw with `globalCompositeOperation = 'lighter'`. Cap total sparks per frame at 1,500 (oldest dropped first).
- **Pencil**: graticule, contours, axes and ladder ticks use the existing `pencilLine`/`pencilCircle` (seeded, cached). Never animate the wobble.
- **Day paper** theme: the Milky Way wash becomes graphite on grey-blue; glows switch to `source-over` with 0.8 alpha (lighter does not work on light paper).

### Desktop layout (≥ 1100 px)

```
+------------------------------------------------------------------------------------------+
| Rubin's restless sky                       [Asteroids | Stars & beyond]   [find…] [Day]  |
| 4,780 objects that changed · 25 Oct 2025 – 15 Nov 2026 · Fink alerts + Gaia DR3          |
| [Everything][Pulsating][Explosions][Black holes][Deep fields][Magellanic][Far][Near][Tour]|
+------------------------------------------------------------+-----------------------------+
| Where in the sky does something change?                    |  POSTCARD (object card)     |
|  caption                                                   |  name · family · type       |
|   .-~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~-.        |  facts grid                 |
|  (    ~~~ Milky Way pencil wash, sparks, embers ~~~ )      |  light curve  [flux|mag]    |
|   '-~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~-'        |  folded score (if period)   |
|  legend chips (5)            [Drop to distance]            |  stamps (if featured)       |
+------------------------------------------------------------+                             |
| How far away are the things that change?                   |                             |
| 1pc  10  100  1kpc 10  100  1Mpc 10  100  1Gpc 10 | ?pile  |                             |
|  lanes x5 beeswarm  + landmarks                    |       |                             |
+------------------------------------------------------------+-----------------------------+
| When was Rubin watching?  [>] ===|=========  ////gap////  ==  date  speed  [skip gaps]    |
+---------------------------------------------+--------------------------------------------+
| What is in this sample? (census bars)       | What kind of star is it? (HR diagram)      |
+---------------------------------------------+--------------------------------------------+
| footer: credits                                                                          |
```

Map aspect 2:1 (Hammer), width ≈ 62% of the viewport; ladder height 200 px; ribbon 110 px.

### Phone layout (≤ 600 px, no horizontal scroll)

```
+------------------------------+
| Rubin's restless sky         |
| [Asteroids|Stars]  [find]    |
| presets (wrap, 2 rows max)   |
+------------------------------+
| Where in the sky…            |
|  .-~~~~~~~~~~~~~~~~~~-.      |   map full width, 2:1
| (  Milky Way + sparks  )     |
|  '-~~~~~~~~~~~~~~~~~~-'      |
| legend chips (wrap)          |
+------------------------------+
| [>] ====|====  date  2d/s    |   ribbon, sticky at bottom while map visible
+------------------------------+
| How far away…                |
| 1pc  1kpc  1Mpc  1Gpc | ?    |   ladder, ticks every 3 decades
| lanes                        |
+------------------------------+
| Census                       |
| HR diagram                   |
+------------------------------+
  card = bottom sheet (60% height, swipe down to close)
```

Touch: tap radius 14 px; no hover tooltips, tap shows the card directly.

---

## 6. Performance plan

- **Canvas 2D**, no WebGL: the data are ~10⁴ objects and ~10⁴–10⁵ alert points; 2D with cached layers is enough and keeps the pencil look.
- **Static layer (offscreen canvas, rebuilt on resize/theme only)**: Milky Way wash, contours, hatching, bright stars, graticule, DDF circles. Build the wash by inverse-projecting each output pixel at 1× CSS resolution (≈ 900×450 = 0.4 M px, ~20–40 ms once) then draw scaled to DPR with smoothing; contours from marching squares on the 720×360 grid (~10 ms).
- **Ember layer (offscreen)**: incremental: when time moves forward, draw only newly-appeared objects; when time moves backward or the filter changes, rebuild (≤ 10 ms for 10⁴ dots, one path per group).
- **Spark layer (per frame)**: alerts sorted by time (they already are); find the window [now − 4 d, now] with two binary searches; draw ≤ 1,500 sprites. Target < 4 ms per frame at 1440×900, < 16 ms on a mid phone at DPR 2 with 4× CPU throttle. Precompute projected x/y for all objects once per resize (Float32Array).
- **Lantern**: 128-point small circle, recomputed only when the date changes by > 0.5 day.
- **Ladder**: static per filter/resize; per frame only the pulse sprites.
- Decode base64 grids once with `atob` → `Uint8Array`.
- Lazy-load `stars.json`; measure with the existing `?bench=` mechanism.

---

## 7. Data: `site/data/stars.json`

Built by `python scripts/build_stars.py` from local files only (`data/stars-2026-11-22/`). Fetch with `python scripts/fetch_stars.py [steps…]` (resumable; files that exist are skipped). Steps: `stats tags explore objects sources fp cutouts gaia_map gaia_xmatch`.

The file sets one global: `stars.json = { meta, nights, objects, alerts, lcs, featured, milkyWay, brightStars, hrDiagram }`.

Times: all `t`, `t0`, `t1`, `stampT` are **MJD (TAI) − 61000** (`meta.mjdOffset`), in days. 0 is 21 Nov 2025. The season runs from −25 (25 Oct 2025, the first Fink night) to +359.2 (15 Nov 2026). Bands are indices into `meta.bands` = `["u","g","r","i","z","y"]`. Magnitudes are AB: `m = 31.4 − 2.5 log10(flux / nJy)`.

```text
stars.json = {
  meta: {
    built: "2026-11-22",
    mjdOffset: 61000,                       // add to every t / t0 / t1 / stampT to get MJD (TAI)
    bands: ["u","g","r","i","z","y"],
    magZeroPointNJy: 31.4,                  // m_AB = 31.4 - 2.5 log10(flux_nJy)
    families: [{key, label, blurb}] x14,    // order = index used by objects.fam; keys:
                                            // rrlyr ceph dsct lpv ecl active yso cv star sn sncand tde agn unk
    catTypes: [string] x153,                // lookup for objects.catType: "VSX RRAB", "TNS SN Ia",
                                            // "SIMBAD AGN", "Fink tag most_likely_sn", ...
    distMethods: ["gaia_parallax","rr_lyrae_candle","cloud_member","tns_redshift","host_galaxy","photo_z"],
    reasons: ["wide","ddf_cosmos","ddf_edfs","ddf_ecdfs","ddf_xmm_lss","ddf_elaiss1","other"],
    landmarks: [{name, pc, ref}] x9,        // depth-ladder context marks (Proxima ... z = 0.5)
    rrLyraeAbsMagG: 0.63, photoZMax: 1.0, cosmology: {H0: 70, Om: 0.3, flat: true},
    counts: {objects, alertPoints, lightCurves, featured, objectsWithoutAggregate, badCoordinates,
             nights, alertsAllNights, brightStars},
    mjdRange: [60975.2032, 61359.2319],     // span of the sparks (MJD)
    stats: {...},                           // build diagnostics: dist_*, fam_*, t0_from_sample_alerts, ...
    sources: [string]
  },

  nights: [                                 // 145 entries from Fink /statistics, sorted by date
    {night: "20251025", mjd: 60973,         // mjd = the civil date at 0h UTC
     alerts, visits, objects, new, sso, tns, // ALL alerts Fink received that night, not just our sample
     bands: [u,g,r,i,z,y]}                  // alerts per band
  ],

  objects: {                                // struct of arrays, length N = 4,780; position = object index
    id:         string        // Rubin diaObjectId (64-bit; keep as string)
    fam:        int           // index into meta.families
    ra, dec:    deg           // ICRS, 4 decimals
    l, b:       deg           // Galactic, 2 decimals
    t0, t1:     days          // first / last detection, MJD - 61000
    tSrc:       0|1           // 0 = Fink object aggregate; 1 = aggregate lacked times, so min/max of our sample alerts
    nDet:       int           // number of detections (diaSources) Fink holds for the object
    nDetBand:   [6 int]       // detections per band u..y
    meanMag:    [6 num|null]  // mean magnitude of the science-image (total) flux per band, 1 decimal
    refBand:    int           // band with most detections
    name:       string        // TNS name ("SN 2026ctw", "AT 2026elk", "TDE 2026pag") or ""
    catType:    int           // index into meta.catTypes
    reason:     int           // index into meta.reasons (Rubin observation_reason)
    dist, distLo, distHi: pc|null
    distMethod: int           // index into meta.distMethods; -1 = no distance (3,505 objects)
    period:     days|null     // from Gaia DR3 variability tables (427 objects)
    periodSrc:  string        // which Gaia table
    gaiaG, gaiaBpRp: mag|null; gaiaPlx, gaiaPlxErr: mas|null; gaiaSep: arcsec|null   // 870 matched
    lc:         int           // index into lcs; -1 = none
  },

  alerts: {                                 // the sparks: one per object per night (brightest |flux| that night)
    o:   [int]                // object index
    t:   [days]               // MJD - 61000, ascending (binary-search friendly)
    b:   [int]                // band index
    m:   [mag]                // magnitude of |difference flux|: how much it changed, not how bright it is
    sgn: [+1|-1]              // +1 brighter than the template, -1 fainter (3,088 sparks are -1)
  },

  lcs: [                                    // 975 light curves from Fink /sources, binned
    {binDays: 1 | P/20,                     // whole night, or period/20 for periodic stars so folds stay sharp
     t: [days], b: [int],
     f: [nJy], fe: [nJy|null],              // inverse-variance mean difference flux and its error
     s: [nJy|null],                         // median science-image (total) flux -> apparent magnitude
     n: [int]}                              // raw exposures in the bin
  ],

  featured: [                               // 56 = 4 per family, the best-sampled
    {o: int, fam: string, diaSourceId: string,
     stampT: days, stampPx: [w,h],          // stamps vary 30..102 px; pixel scale 0.2"/px
     stamps: {science, template, difference},  // PNG data URIs from Fink /cutouts (sigmoid stretch, greyscale)
     fp: {t, b, f, fe},                     // forced photometry, unbinned, includes non-detections
     periodRubin: null | {period, power, band, points, method,
                          vsGaia: "agrees"|"half"|"double"|"differs"|null,
                          reliable: bool}}  // reliable = power >= 0.5
  ],

  milkyWay: {width: 720, height: 360, cellDeg: 0.5, density: base64 uint8, bpRp: base64 uint8,
             countMin, countMax, starsSampled: 12000000, indexing, densityEncoding, bpRpEncoding},

  brightStars: {l: [deg], b: [deg], G: [mag], bpRp: [mag|null], gMax: 6},   // 6,764 stars

  hrDiagram: {width: 110, height: 220, bpRpMin: -0.5, bpRpStep: 0.05, absGMin: -5, absGStep: 0.1,
              counts: base64 uint8, countMax, stars: 1342485, selection, indexing, countsEncoding}
}
```

Decoding notes:
- **Grids.** Decode with `Uint8Array.from(atob(x), c => c.charCodeAt(0))`.
  - In `milkyWay`, cell (li, bi) is byte `bi*720 + li`; l = (li + 0.5)/2 and b = (bi + 0.5)/2 − 90.
  - In `hrDiagram`, row 0 is the brightest M_G (−5), so drawing y downward makes it fainter, the usual way.
- **Magnitudes.** `31.4 - 2.5*Math.log10(f)`, only for f > 0. Difference flux is often negative, so in flux mode plot it linearly around zero.
- **Light curves.** They are in difference flux, and every band has its own template offset. That is why the score uses one stave per band. Folding the featured stars confirmed it: the RRab sawtooth, the RRc and the W UMa double dip are all clean.
- **Hammer projection.** λ = −(l wrapped to ±180°) so that l increases to the left; φ = b.
  - Forward: x = 2√2 cosφ sin(λ/2)/√(1 + cosφ cos(λ/2)), y = √2 sinφ/√(1 + cosφ cos(λ/2)).
  - Inverse, for the wash: z = √(1 − (x/4)² − (y/2)²), λ = 2 atan2(z x, 2(2z² − 1)), φ = asin(z y).
- **Lantern.**
  - GMST(deg) = 280.46061837 + 360.98564736629·(JD − 2451545.0).
  - Local midnight at Cerro Pachón ≈ 04:43 UTC.
  - Zenith: RA = GMST + lon (lon = −70.7494°), Dec = −30.2446°.
  - Draw a small circle of radius 60° around the zenith (128 points), convert it to l, b, project it, and split the path where it crosses the l = 180° seam.
  - Equatorial → Galactic: use the J2000 rotation matrix in `scripts/build_stars.py` (`GAL`).

### Census (what is in the file)

| Family | Objects | Light curve | Distance | Gaia period | TNS name |
|---|---|---|---|---|---|
| RR Lyrae (`rrlyr`) | 239 | 120 | 238 | 179 | 3 |
| Cepheids (`ceph`) | 13 | 13 | 0 | 3 | 1 |
| Delta Scuti & SX Phe (`dsct`) | 53 | 53 | 4 | 1 | 0 |
| Miras & long-period variables (`lpv`) | 56 | 56 | 0 | 37 | 1 |
| Eclipsing binaries (`ecl`) | 236 | 100 | 60 | 202 | 0 |
| Flare & spotted stars (`active`) | 228 | 120 | 93 | 3 | 1 |
| Young stars (`yso`) | 16 | 16 | 6 | 0 | 4 |
| Cataclysmic variables & novae (`cv`) | 65 | 65 | 22 | 1 | 24 |
| Other catalogued stars (`star`) | 60 | 60 | 15 | 1 | 0 |
| Supernovae (classified) (`sn`) | 88 | 88 | 85 | 0 | 88 |
| Supernova candidates (`sncand`) | 1,348 | 120 | 291 | 0 | 1 |
| Tidal disruption events (`tde`) | 4 | 4 | 4 | 0 | 4 |
| AGN, quasars & blazars (`agn`) | 117 | 100 | 46 | 0 | 25 |
| Unclassified transients (`unk`) | 2,257 | 60 | 411 | 0 | 521 |
| **Total** | **4,780** | **975** | **1,275** | **427** | **673** |

| Distance method | Objects | Range |
|---|---|---|
| Gaia parallax (Bailer-Jones r_med_geo, ϖ/σ ≥ 5) | 201 | 98 pc – 4.9 kpc |
| RR Lyrae candle (M_G = 0.63, no extinction) | 237 | 9.7 – 103 kpc, median 25 kpc (the halo) |
| TNS spectroscopic z | 93 | 13 Mpc – 7 Gpc |
| Host galaxy (Mangrove) | 131 | 9 – 230 Mpc |
| Photo-z (Legacy DR8, z ≤ 1, p_star < 0.5) | 613 | 0.13 – 6.6 Gpc |
| None | 3,505 | |

Observation reason: wide 2,538; COSMOS 1,065; EDFS 834; ELAIS-S1 159; ECDFS 149; XMM-LSS 35.

---

## 8. Checks run on the output

- **Integrity.** Every `objects` column has length 4,780. `alerts.t` is sorted, and the JSON is written with `allow_nan=False`.
- **Coordinates.**
  - RA covers 0.11–359.93°; Dec runs from −51.0° to +9.8°. Nothing lies north of +35°, as expected from latitude −30°.
  - Our equatorial→Galactic rotation reproduces Gaia's own l, b for 1,415 rows to 1e-13°.
- **Magnitudes.**
  - Gaia G minus Rubin's mean science-flux r has a median of −0.09 mag (n = 509), which is consistent for normal stars. The 31.4 nJy zero point and the science fluxes are sane.
  - Spark difference magnitudes at the 1st / 50th / 99th percentile are 17.3 / 22.3 / 24.2. Rubin's single-visit depth is about 24.5.
  - Mean science magnitudes are 15.7 / 20.6 / 23.6.
- **Gaia match.** We searched within 8″, propagated Gaia's 2016.0 positions with proper motion to the last detection, and kept the nearest star within 1″. The median separation is 0.03″.
- **Time.**
  - Sparks run from 27 Oct 2025 to 15 Nov 2026; 904 of them fall before 2026.
  - Fink statistics start on 25 Oct 2025.
  - Gaps longer than 10 nights: 19, 26 and 108 nights (see V3).
- **Classes.** All 14 families are populated, from 4 TDEs to 2,257 unclassified objects.
- **Photo-z cap.** Photo-z above z = 1 was dropped; it had placed about 700 objects out to 25 Gpc, where Legacy DR8 photo-z is not trustworthy.
- **Periods.** Rubin-only Lomb–Scargle periods on the featured forced photometry, compared with Gaia:
  - The RRc 313677516768805021 agrees to 1e-5 (0.37211 vs 0.37212 d, power 0.94).
  - Two contact binaries come out at exactly half the Gaia period (two eclipses per orbit).
  - The others are 1-day-sampling aliases, and the flare stars give noise (power < 0.06).
  - Hence the rule: **fold on the Gaia period. Show a Rubin period only as "Rubin alone finds …" with its agreement word, and only when `reliable` is true.**
- **Galactic latitude (key honesty finding).**
  - Only 38 of 966 stellar objects lie within |b| < 10°.
  - **No** object lies in the Magellanic Clouds; the sample stops at Dec −51°.
  - No extragalactic or unclassified object lies within |b| < 10°.
  - So the page must not say that stars hug the plane.

---

## 9. Credits and licences (put in the footer and README)

- **Rubin alerts**: "This work uses alert data from the NSF–DOE Vera C. Rubin Observatory Legacy Survey of Space and Time." Rubin alerts are world-public.
- **Fink**: alerts, crossmatches, classifiers, statistics and stamps via the Fink broker (api.lsst.fink-portal.org); cite Möller et al. 2021, MNRAS 501, 3272. Crossmatch labels come from catalogues Fink queries: AAVSO VSX (Watson et al. 2006), SIMBAD (CDS, Wenger et al. 2000), the Transient Name Server (TNS), Mangrove (Ducoin et al. 2020), Legacy Surveys DR8 photo-z.
- **Gaia**: "This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement." Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1. Licence CC BY-SA 3.0 IGO. Distances: Bailer-Jones et al. 2021, AJ 161, 147.
- **Distances of landmarks**: as listed in `meta.landmarks[].ref`.
- **RR Lyrae absolute magnitude** M_G = 0.63 (Muraveva et al. 2018); **cosmology** flat ΛCDM, H0 = 70 km/s/Mpc, Ωm = 0.3.
- Fonts as in the asteroid mode (OFL 1.1).

---

## 10. Risks and honest gaps

1. **The sample is not the survey.** It holds 4,780 objects out of the full alert stream, chosen by `explore` caps and `tags` windows, so family proportions reflect our quotas.
   - Mitigations: the V5 footnote; the ribbon shows all-alert bars next to the sample dots; no "% of the sky" figures anywhere.
2. **No public footprint.** Rubin's pointing history needs an RSP account. Empty sky can mean "not observed" or "not sampled".
   - The caption says "this sample's alerts".
   - The deep drilling fields hold 2,242 of the 4,780 objects. Label them so their clusters are not read as astrophysics.
3. **The plane and the Magellanic Clouds are empty of data.** This is a property of the early survey and the sample, not of the Galaxy.
   - The V1 caption says so.
   - The lantern shows the plane *was* overhead in June–July, so the emptiness reads as a survey choice.
4. **Class labels are catalogue crossmatches.**
   - VSX and SIMBAD types can be wrong.
   - Fink tags can contradict each other, e.g. `mdwarf_flare,sn_near_galaxy_candidate`.
   - `sncand` and `unk` are candidates.
   - The card always shows the raw `catType` string.
5. **Distances are heterogeneous.**
   - Photo-z (±20% in z assumed; the true error is not in the alert) and host-galaxy distances (±20%) are weak.
   - The RR Lyrae candle ignores extinction (under 5% in distance at |b| > 30°) and metallicity (±10%).
   - The marker-by-method encoding and the hatched "no distance: 3,505" pile carry this.
   - `cloud_member` exists in the code but is unused (0 objects).
6. **Time fields.** For 2,614 objects the Fink aggregate had no first/last time, so `t0`/`t1` come from our own sample alerts (`tSrc = 1`). Their embers can appear later than the true first detection.
7. **TNS names on stars.** Some variable stars carry old TNS "AT" names; for example, RR Lyrae "AT 2018lnm" was reported as a transient years ago. Show the family first and the name second.
8. **API drift.** The Fink LSST API is young.
   - Its Gaia crossmatch fields returned "Fail", its schema may change, and one call returned a 502.
   - The scripts are resumable, and the app reads only the built file.
   - Keep `data/stars-2026-11-22/` as the frozen input; a re-fetch will change the numbers. The objects step batches by sorted ID, so a fresh fetch needs a new `--date` folder.
9. **Stamps** vary from 30 to 102 px. Draw them pixelated in a fixed box and state 0.2″/px.
10. **Licence.** The derived Gaia grids are CC BY-SA 3.0 IGO (attribution, share-alike). Keep the credits in the footer.
11. **Phones.** The Milky Way wash at DPR 3 is the heaviest one-off cost. Render it at 1× CSS pixels and upscale.
12. **Size.** 3.85 MB uncompressed (it compresses well under gzip). Lazy-load it so the asteroid mode stays fast.
