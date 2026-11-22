> Design notes written while the project was built. Where the shipped site differs, the README describes the shipped behaviour.

# Stars mode v2: from dashboard to story

Addendum to `STARS-DESIGN.md`. Everything there still holds unless this file overrides it. New data is already built:
- **`site/data/stars.json`** (4.18 MB): new fields are additive. New top-level `stories`; new `objects.z`, `zSrc`, `lookbackGyr`, `sdssClass`, `gc`; new `meta.horizons`; distance method `sdss_specz`.
- **`site/data/stars-tiles.jsonon`** (0.57 MB, new, lazy-loaded): fine Gaia density tiles for 8 zoom regions, plus 339 named stars.

---

## 0. What I saw (headless Chrome, 1440 × 2600, `?mode=stars&still`)

The build is faithful to v1 and well crafted, but it reads as **a dashboard of five panels**. Nothing tells the visitor where to look, or what is surprising. Specific weaknesses:

1. **The hero has no climax.** The map loads already full: all sparks visible on 15 Nov, with the DDF clusters as coloured blobs. The eye has nowhere to go.
2. **The card's "Featured" list is a wall of "Rubin object …305021" chips.** Nobody clicks a number. Objects need names and one-line hooks ("a star 38 kpc out, pulsing every 9 hours").
3. **The ladder is five sausages of dots.** The most astonishing fact, eight decades of distance *in one patch of sky*, is never made physical.
4. **No hands-on moment.** The visitor never *does* anything a scientist does: find a period, measure a distance, check a standard candle.
5. **Honest caveats are present but scattered** in long captions. They are stronger as a chapter of their own ("What Rubin can't see").

The fix is **guided chapters** that drive the existing views, plus **four toys**. The free-explore page stays underneath.

---

## 1. Principles

- **One question per screen, one number to remember.** Every chapter ends with a single "takeaway number", large and bold: "8 decades", "−19.1", "12.2 billion years".
- **Real objects, named.** Every chapter is built on specific objects from the sample (IDs below; all verified to exist with good data).
- **The data does the talking.** Light curves draw themselves at the speed of the season; folds snap when the period is right; distances are computed in front of the viewer from numbers they can see.
- **Uncertainty is part of the story, not a footnote.** Each chapter has one "how sure are we?" line, and one chapter is entirely about the limits.

---

## 2. Opening

The shipped build opens directly on the sky with a slow play (2 days per second, off under reduced motion) and the story chips under the header. An earlier plan for a 3-second season replay with an alert counter was dropped.

---

## 3. The chapters

Chapter cards sit in a horizontal strip under the header. On desktop the strip wraps to two rows; on phone it is a vertical list, with no horizontal scroll.

Each card shows:
- a small icon drawn in pencil;
- the title;
- a one-line hook;
- the takeaway number.

Opening a chapter puts the page in **story mode**:
- a narrow narration column (desktop: left, 340 px; phone: a bottom sheet at 45% height) shows numbered "beats";
- **Next / Back** buttons and ←/→ keys step through them;
- each beat *drives* the existing views: zoom the map, scrub time, select an object, open a toy.

Leave with Esc or "Back to the sky". All chapter data is in `stars.json` `stories[key]`, with the object index `o` into `objects`.

Times below are `t` = MJD − 61000. Calendar dates are given for the captions.

### Chapter 1. "How a supernova rises and fades" — key `sn_ia`

Object: **AT 2026ivl**.
- `diaObjectId` 170235219334922248, `objects` index 886.
- TNS SN Ia, z = 0.090 (TNS spectroscopic redshift), luminosity distance 411 Mpc, lookback time 1.18 Gyr.
- In the COSMOS deep field: RA 148.474°, Dec +1.718°; l 236.09°, b 40.50°.
- 65 detections and 88 forced-photometry points (unbinned, in `stories.sn_ia`).
- Stamps at three epochs: first detection t = 137.17 (g), peak t = 160.01 (r), late t = 190.98 (g).

Beats:
1. **Zoom** to COSMOS (`zoomTo(236.1, 40.5, 30)`), time = t 130 (1 Apr 2026). "This patch of sky, 3° across, is one of Rubin's deep fields. On 1 April nothing here is new."
2. **The light curve draws itself.** Time plays at 1 day/s from t 130 to 210. The card shows the *forced photometry* (`fp`) per band in difference flux (nJy), points appearing as the playhead passes them; the spark on the map pulses at each point. Pre-explosion points sit on zero: "Rubin measured this spot before anything was there. That flat line is the proof the star wasn't visible before."
3. **Stamps at three epochs** (science / template / difference, pixelated at 0.2″/px), side by side, captioned with their dates. "Same 6″ of sky, three nights. The template is the galaxy before; the difference is only the new light."
4. **The colours tell the physics.** Highlight the u band: it fades fastest (63k nJy at t 151 to 4k by t 180), while i shows a second bump around t 186. "Blue light fades first as the debris cools. The second red bump is iron recombining: a fingerprint of Type Ia."
   - Honesty line: "the second bump is a hint in 3 points, not a measurement."
5. **The standard candle, computed live.** Show the arithmetic as a small table that fills in:
   - peak r = 18.95 mag (`stories.sn_ia.peak.diffMag`);
   - distance from redshift = 411 Mpc, so the distance modulus is 38.07;
   - absolute magnitude **−19.12** (`peak.absMag`); every SN Ia peaks near −19.3.
   - Takeaway: **"−19.1: this is a standard candle, and it checks out."**
   - Honesty line: "No K-correction, no dust correction; ±0.3 mag."
6. **Light-travel clock** (toy B) set to 1.18 Gyr: "The light left before animals existed on Earth."

### Chapter 2. "A core sample through the Universe" — the COSMOS zoom

Region: COSMOS, `stars-tiles.json` `tiles` name `COSMOS`, 0.05° Gaia cells. The sample has 1,065 objects here; 417 have distances, from 118 pc to 7.07 Gpc.

Beats:
1. **Zoom from the full sky to COSMOS** (×30, 1.2 s ease). The fine tile fades in over the coarse grid, and named stars disappear (none here). "One field, about the size of 15 full Moons."
2. **The pins drop.** All COSMOS objects appear as embers. Then **the depth ladder becomes vertical beside the zoomed map** (a "core sample"): each object is drawn as a dot at its ladder height, joined to its sky position by a faint pencil line.
   - Nearest: M dwarf 313875416235900942 at **118 pc**. Gaia BP−RP 2.96, so a true red dwarf; Fink also tagged it `extragalactic_lt20mag_candidate`.
   - Then SN Ic-BL **SN 2026gzf** (314003014107006318, 151 Mpc).
   - Then SN Ia **AT 2026ivl** (411 Mpc).
   - Deepest: SLSN-I **AT 2025altn** (313928194567700757, z = 1.056, 7.07 Gpc).
3. Caption: "Side by side on the sky, nearly eight powers of ten apart in depth. A red dwarf 385 light years away, and an exploding star whose light left 7.9 billion years ago." Takeaway: **"8 decades in 3 degrees."**
4. **Why the clusters?** Toggle "all fields": the same core-sample view for EDFS (834 objects), ELAIS-S1, ECDFS and XMM-LSS. "These clusters are where Rubin stares, not where the Universe is busier."

### Chapter 3. "Find the beat" — toy A, keys `contact_binary` then `rr_lyrae`

Objects:
- **Contact binary** 313637935274000406 (VSX "E", EDFS, RA 58.946° Dec −49.863°). 430 forced-photometry points over 271 days. Gaia period 0.2680735 d.
- **RRc pulsator** 313677516768805021 (EDFS). 292 forced-photometry points. Gaia period 0.3721206 d. Its distance from the RR Lyrae standard candle is 38.4 kpc.

Beats:
1. Show the raw light curve over 271 days. It is noise to the eye. "Hundreds of measurements, a few each night. Is there a rhythm?"
2. **The period dial** (toy A, Section 4) opens. The user drags; the fold scrambles and, near a right answer, *snaps*. On a snap at 0.134 d (half the period): "Two dips that look the same. Try doubling." At 0.268 d both eclipses separate into a deep one and a shallow one: "Two stars so close they touch, orbiting every 6 h 26 min." Takeaway **"6 h 26 min"**.
3. **How sure are we?**
   - Rubin alone finds 0.26834 d; Gaia (2014–17) says 0.26807 d.
   - Over 271 days Rubin cannot tell these apart: one cycle more or fewer across the season.
   - The two folds look equally clean. Show both ticks on the dial.
4. Switch to the RRc: the snap at 0.3721 d gives a smooth hump. "A single star breathing in and out every 8.9 hours. Stars like this all have about the same true brightness, so its faintness gives its distance: 38 kpc, in the stellar halo." Link to Chapter 4.

### Chapter 4. "The halo in 3D" — toy C

Data: the 238 RR Lyrae with `gc` (galactocentric X, Y, Z in kpc; Sun at X = −8.178, Z = +0.021). Their galactocentric radii have a median of 21.9 kpc and range from 2.8 to 99.1 kpc. A further 200 other stars have `gc` from Gaia parallax, all within about 5 kpc of the Sun.

Beats:
1. **The 3D view** opens (toy C):
   - a gold pencil disk of the Milky Way, radius 15 kpc;
   - the bulge as a soft ellipse;
   - the Sun as a gold dot;
   - RR Lyrae as glow points coloured by distance.
   It auto-rotates at 6°/s and can be dragged.
2. "Each point: one star whose distance we know because all RR Lyrae shine with about the same power (M_G ≈ +0.6)." Show the formula live for the hovered star: "G = 18.55, M = 0.63 → 10^((18.55 − 0.63 + 5)/5) pc = 38.4 kpc".
3. **The cone.** Rotate to show the stars sit in a few wedges: these are the directions Rubin looked (mostly RA 330–336°, Dec −17° to −9°, observed in July). "Rubin's sample is a set of probes into the halo, not a census."
4. **The edge is Gaia's, not Rubin's.** Our candle uses Gaia's mean G, which stops near G ≈ 20.7, so about 100 kpc. Rubin's single-visit limit would reach about 600 kpc (`meta.horizons`, RR Lyrae). Draw two spheres: "where our distances stop" at 100 kpc (solid) and "what Rubin can reach" at 600 kpc (dashed, reaching past the Magellanic Clouds and the dwarf galaxies). Takeaway: **"6× deeper, once Rubin measures its own mean magnitudes."**
5. Honesty line: "We looked for the Sagittarius stream in this patch and did not detect it: the distances fall off smoothly. Extinction is ignored (< 5% at these latitudes)."

### Chapter 5. "Light older than the Sun" — keys `slsn_old_light`, `quasar`, `quasar_far`

Objects (all spectroscopic redshifts; cosmology flat ΛCDM, H0 = 70, Ωm = 0.3, age 13.47 Gyr):

| Object | ID | z (source) | Lookback | Universe age then | Data |
|---|---|---|---|---|---|
| SLSN-I AT 2025altn | 313928194567700757 | 1.056 (TNS) | 7.93 Gyr | 5.5 Gyr | 614 detections, peak i 21.16 → M ≈ −23.1 |
| Quasar | 170028526654193761 | 2.956 (SDSS DR16) | 11.32 Gyr | 2.2 Gyr | 376 detections, 395 forced photometry points, varies by about 10–14% (5–95% range of total flux) over the season |
| Quasar | 171141216007618582 | 4.573 (SDSS DR16) | 12.18 Gyr | 1.3 Gyr | only 5 detections: say so |

Beats:
1. **Light-travel clock** (toy B) spins back from "now" through the Sun's birth (4.57 Gyr, marked) to 7.9 Gyr: "When this star exploded, the Sun did not exist yet."
2. **Time dilation, visible.** AT 2025altn's light curve rises over about 90 days in i (t 41 → 135). "Its clock runs 2.06× slow as seen from here (1 + z): the 90-day rise was about 44 days at home." This is a real, measurable cosmological effect in this light curve.
3. **Quasars**: the z = 2.96 quasar's total brightness wanders by about 10–14% over the season (5th–95th percentile of science flux in g, r, i). "A black hole a billion times the Sun's mass, feeding. We see it as it was when the Universe was 2.2 billion years old." Then the z = 4.57 quasar: "the oldest light in this sample: 12.2 billion years." Takeaway: **"12.2 billion years"**.
4. Honesty line: "155 objects in this sample have spectroscopic redshifts that put their light before the Sun's birth. The rest of the far objects (photo-z) are estimates."

### Chapter 6. "What Rubin can't see"

Five short beats, each driving one view:
1. **The northern sky.** Draw the dec = +30° line, then hatch everything north of it: "Rubin is in Chile; about a quarter of the sky never rises high enough." (No object in the sample is north of Dec +9.8°.)
2. **Daylight and weather: the gaps.** The ribbon flashes its gaps: 29 Jan–17 Feb (19 nights), 10 Mar–5 Apr (26 nights), 14 Jul–30 Oct (108 nights).
   - Then **SN 2026gzf** (314003014107006318, SN Ic-BL, 151 Mpc): its last pre-explosion measurement was t 95 (24 Feb, flux ≈ 0), and the next was t 136 (6 Apr), already at 571,000 nJy, peak r = 17.0, M ≈ −18.9.
   - "It exploded while Rubin was not looking. We have the fall, not the rise."
3. **Dust.** Toggle the map to show extragalactic objects only: none within 10° of the plane. "The Milky Way's dust hides the Universe behind it."
4. **Faintness.** Toy D (the horizon): for each kind of object, how far Rubin can see it, against where our sample's objects actually are.
5. **Labels can be wrong.** SDSS spectra say 54 of our Fink "supernova candidates" are quasars, e.g. 171141216039075877 (tag `most_likely_sn`, SDSS QSO z = 2.82). "Classifiers guess from light curves; spectra decide."
   - Takeaway: **"54 'supernovae' were quasars."**

### Chapter 7. "Free sky"

This is today's page, unchanged, with the chapter strip still on top. The "Tour" preset becomes "Play all chapters" (auto-advance every 12 s per beat).

---

## 4. The toys

### Toy A: the period dial (Chapter 3; also in the card for any object with `stories[*].periodogram` or a Gaia `period`)

- **Strip.** `periodogram.curve` (1,500 values, quality = 1 − PDM θ) drawn as a gold pencil "skyline" over log-period, from `logPeriodMin` (0.04 d) to `logPeriodMax` (2 d).
  - A ghost tick marks the Gaia period (`objects.period`), hidden until a snap or a "show answer" tap.
- **Dial.** A wide slider over the strip, with fine control: the drag speed is ÷10 while holding Shift (desktop) or with two-finger drag (phone).
  - The fold redraws each input on the unbinned `fp` points: two cycles, one stave per band, normalised to the 5–95% range.
- **Snap.** When the dial is within `peaks[i].halfWidthDays` × 3 of a peak with `quality ≥ 0.6`:
  - animate to the exact peak period (200 ms, ease-out);
  - the points glide to their folded positions (interpolate the x of each point over 300 ms);
  - fire a small gold pencil burst;
  - name the period in h/min.
- **Peaks** (precomputed, in `stories.contact_binary.periodogram.peaks` and `stories.rr_lyrae.periodogram.peaks`):
  - contact binary: 0.13403, 0.13417, **0.26834** (true; Gaia 0.26807), …
  - RRc: **0.37322**, **0.37215** (Gaia 0.37212), 0.74627 (double), …

  The two RRc solutions differ by a seasonal alias. Say so when the user snaps to the wrong one: "Close! There is a near-twin period 0.0011 d away. With one season, Rubin can't tell which; Gaia's longer baseline says 0.37212."
- **Perf.** ≤ 650 points per fold; recompute on `input` (not RAF), O(n).

### Toy B: the light-travel clock (Chapters 1, 5; also in every card with `lookbackGyr`)

- A horizontal **timeline from now back to the Big Bang** (13.47 Gyr), log-compressed near "now" so that 100 years and 10 Gyr both fit.
  - Use `x ∝ log10(1 + T/1 yr)` up to 1 Myr, then linear in Gyr. Mark the seam.
- **Markers** (pencil ticks, small labels):
  - telescope invented (417 yr);
  - first modern humans (300 kyr);
  - dinosaurs end (66 Myr);
  - first land plants (~470 Myr);
  - first animals (~600 Myr);
  - Sun and Earth form (4.57 Gyr);
  - first galaxies (~13.2 Gyr).
- **The object's lookback** (`objects.lookbackGyr`) is a vermilion pin, with "light left N years ago" in words.
  - For stars, the value is distance/c, in Gyr: the 118-pc M dwarf's light left 385 years ago, "about when the telescope was new".
  - For redshifts it is the cosmological lookback time.
- **Honesty.** For `zSrc = 'photo'`, draw the pin as an uncertainty bar (from z × 0.8 to z × 1.2).

### Toy C: the halo, rotatable (Chapter 4)

- Canvas 2D with a hand-rolled 3D projection (≤ 450 points; WebGL is not needed).
- Points: the `objects.gc` [x, y, z] in kpc, available for RR Lyrae and for parallax stars.
- Drawing:
  - the disk as an ellipse ring set (pencil, 5, 10, 15 kpc);
  - the bulge as an ellipsoid outline;
  - the Sun as a gold star;
  - the Galactic centre labelled.
- Interaction: drag to rotate (yaw/pitch), wheel or pinch to zoom, hover/tap to select (links to the card).
- Spheres at 100 kpc and 600 kpc are drawn as dashed circles in the current view.
- Depth cue: points further from the camera are smaller and dimmer. Sort by depth once per frame (450 points, trivial).

### Toy D: the horizon (Chapter 6; also as an overlay on the depth ladder)

- From `meta.horizons`: for 8 kinds of objects, the absolute magnitude, plus `singlePc`/`singleZ` (single visit, m = 24.5) and `deepPc`/`deepZ` (deep-field night, m = 26.0).
- **Ladder overlay.** A horizontal bar per kind from 1 pc to its horizon, with the sample's actual objects of that kind as dots on top.
  - Example: M dwarf horizon 3.2 kpc, RR Lyrae 600 kpc, Cepheid 5.2 Mpc, nova 32 Mpc, SN II-P z ≈ 0.31, SN Ia z ≈ 0.89, SLSN z ≈ 2.0.
- **The quasar row is special.** The naive number (z ≈ 12) is meaningless, because intergalactic hydrogen blocks the light bluewards of Lyman-α. Cap the bar at z ≈ 6.5 with the caption "in practice ~z 6–7 in the reddest filters".
- Caption: "Ignoring K-corrections and dust. An order-of-magnitude horizon, not a survey limit."

### Optional E: sonification (off by default; a "listen" toggle in the card)

Only for folded periodic objects:
- Play one folded cycle per second.
- Pitch maps linearly to normalised flux in the dominant band (two octaves, 220–880 Hz); the volume envelope follows the data density.
- Sine oscillator via WebAudio, gain ≤ 0.15.

Honest because it is a direct mapping of the same fold the eye sees, and the caption says so ("one cycle per second; real period 6 h 26 min").

---

## 5. Zoom detail: `site/data/stars-tiles.jsonon`

Load it the first time zoom passes ×6, or a chapter needs it: fetch `data/stars-tiles.json`.

```text
stars-tiles.json = {
  meta: {built, tileEncoding, tileIndexing, tileSource, bpRpEncoding, namesSource},
  tiles: [                                   // 8 regions, Gaia DR3 full depth (sampleFraction = 1)
    {name: "COSMOS"|"XMM-LSS"|"ECDFS"|"ELAIS-S1"|"EDFS"|"SMC"|"LMC"|"Bulge",
     raCenter, decCenter, radiusDeg,         // the ICRS circle that was queried; cells outside it are 0 = NO DATA
     l0, b0, step, width, height,            // galactic grid: l = l0 + (li+0.5)*step, wrapped to [-180,180);
                                             //                b = b0 + (bi+0.5)*step; byte index bi*width + li
     sampleFraction, starsCounted, countMin, countMax,
     density: base64 uint8,                  // count = exp(ln(countMin) + (v-1)/254*(ln(countMax)-ln(countMin))), 0 = none
     bpRp: base64 uint8}                     // mean BP-RP = v/255*3 mag, 0 = none
  ],
  namedStars: [                              // 339 stars, IAU-CSN, V <= 6.5, sorted bright first
    {name: "Sirius", bayer: "α CMa", designation: "HR 2491", constellation: "CMa", hip: "32349",
     mag: -1.45, ra, dec, l, b}
  ]
}
```

| Tile | Step | Radius | Grid | Gaia stars counted |
|---|---|---|---|---|
| COSMOS | 0.05° | 2.5° | 136 × 101 | 77,145 |
| XMM-LSS | 0.05° | 2.5° | 194 × 101 | 55,839 |
| ECDFS | 0.05° | 2.5° | 174 × 101 | 68,838 |
| ELAIS-S1 | 0.05° | 2.5° | 341 × 101 | 69,011 |
| EDFS (both pointings) | 0.05° | 3.5° | 207 × 141 | 167,538 |
| SMC | 0.05° | 3.0° | 169 × 121 | 3,849,347 |
| LMC | 0.1° | 8.0° | 192 × 161 | 25,436,937 |
| Bulge (l = 0, b = 0) | 0.1° | 8.0° | 162 × 161 | 154,759,518 |

Rendering rules:
- **Draw** a tile when its region is ≥ 25% of the viewport. Cross-fade over the global 0.5° wash between zoom ×6 and ×10.
- **Mask the circle.** Clip to the queried circle (project `raCenter`/`decCenter`/`radiusDeg` as a small circle) and feather its edge over 0.3°. Outside it, zero means no data, not empty sky.
- **Normalise each tile.** Densities differ by 1,000× between the bulge and COSMOS, so each tile gets its own log normalisation (countMin…countMax). Show a tiny "stars per deg²" scale when zoomed:
  - stars/deg² = count / step² / cos b.
  - Very high latitudes (ELAIS-S1, b ≈ −73°) have wide l extents; that is expected.
- **Do not over-claim the high-latitude tiles.** At 0.05° they hold 1–70 stars per cell, so they look grainy. That grain is real Poisson noise: draw them softer (1 px blur) rather than pretending to be smooth.
- **Named stars.**
  - Labels from `namedStars` appear by zoom: mag < 1.5 from ×1, mag < 3 from ×4, all from ×10.
  - Label as "Sirius" and add the Bayer name (α CMa) on hover.
  - Collision-avoid labels with a simple greedy pass in screen space.

Fetching and building (resumable):
```
python scripts/fetch_stars.py tiles names sdss story
python scripts/build_stars.py            # site/data/stars.json
python scripts/build_stars.py --tiles    # site/data/stars-tiles.jsonon
```

### Notes for the existing `RubinStars.zoomTo(l, b, k)` hook

| Region | l | b | k |
|---|---|---|---|
| COSMOS | 236.8 | 42.1 | 30 |
| EDFS | 256.1 | −47.2 | 18 |
| ELAIS-S1 | 311.3 | −72.9 | 25 |
| ECDFS | 224.1 | −54.5 | 30 |
| XMM-LSS | 171.2 | −58.8 | 30 |
| LMC | 280.5 | −32.9 | 8 |
| SMC | 302.8 | −44.3 | 12 |
| Bulge | 0 | −2 | 6 |

The DDF centres above are the l, b of the RA/Dec used in v1.

---

## 6. Schema additions to `site/data/stars.json` (all additive)

```text
objects.z            num|null   redshift used for the distance
objects.zSrc         "tns"|"sdss"|"photo"|""
objects.lookbackGyr  num|null   cosmological lookback time for redshifts; distance/c (in Gyr) for stars
objects.sdssClass    "QSO"|"GALAXY"|"STAR"|""   SDSS DR16 spectroscopic class of the counterpart within 1.5"
objects.gc           [x,y,z] kpc | null   galactocentric, Sun at (-8.178, 0, +0.0208); stars with a distance only
meta.distMethods     + "sdss_specz" (index 6): SDSS DR16 spec_z, zWarning = 0, match <= 1.5"  (193 objects)
meta.horizons        [{kind, absMag, band, note, singlePc, singleZ, deepPc, deepZ}] x8
meta.horizonLimits   {singleVisit: 24.5, deepDrillingNight: 26.0}
stories: {
  sn_ia | sn_gap | slsn_old_light | quasar | quasar_far | contact_binary | rr_lyrae: {
    key, id, o,                                   // o = objects index
    sources: {t, b, f, fe, s},                    // unbinned detections (difference flux, science flux; nJy)
    fp:      {t, b, f, fe},                       // unbinned forced photometry incl. pre-explosion zeros
    stamps:  [{epoch: "first"|"peak"|"late", diaSourceId, t, band, px:[w,h], science, template, difference}],
    peak:    {t, band, diffMag, absMag?, absMagNote?},
    periodogram?: {logPeriodMin, logPeriodMax, curve[1500], peaks[{period, quality, halfWidthDays}],
                   spanDays, medianQuality, method}   // contact_binary and rr_lyrae only
  }
}
```

Counts after the SDSS crossmatch (GAVO TAP, `sdssdr16.main`; 214 spectra matched):
- Distances: SDSS spectroscopic redshift 193, TNS redshift 93, Gaia parallax 201, RR Lyrae candle 237, host galaxy 126, photo-z 585, none 3,345.
- SDSS classes: QSO 174, galaxy 33, star 7. Of the 174 QSOs, 54 were Fink "supernova candidates" and 83 "unclassified".

---

## 7. Layouts

### Desktop, story mode (≥ 1100 px)

```
+------------------------------------------------------------------------------------------+
| Rubin's restless sky        [Asteroids | Stars & beyond]                [search] [theme]  |
| [1 Supernova][2 Core sample][3 Find the beat][4 Halo 3D][5 Old light][6 Can't see][Free] |
+------------------------+-----------------------------------------------------------------+
| CHAPTER 1 · beat 3/6   |                                                                 |
| How a supernova rises  |        MAP (zoomed to COSMOS, fine Gaia tile)                   |
| and fades              |              ( ring + label on AT 2026ivl )                     |
|                        |                                                                 |
| narration, 2-4 lines   +-----------------------------------------------------------------+
| (Plex 16/24)           |  STAGE: the beat's instrument                                   |
|                        |  e.g. light curve drawing itself / stamps x3 / dial / 3D halo   |
| takeaway, large and bold |  / horizon ladder / light-travel clock                          |
|   -19.1                |                                                                 |
|  [Back]   [Next ->]    |  ribbon (time) slim, 48 px                                      |
+------------------------+-----------------------------------------------------------------+
```

The narration column is 340 px. The map gets about 60% of the remaining height and the stage 40%. The card is hidden in story mode; its content moves to the stage.

### Phone, story mode (≤ 600 px)

```
+------------------------------+
| Rubin's restless sky   [x]   |
| Ch.1 Supernova · 3/6         |
+------------------------------+
|  MAP (2:1, zoomed)           |
+------------------------------+
|  STAGE (light curve / dial / |
|  stamps / 3D)  ~40% height   |
+------------------------------+
| narration (bottom sheet,     |
| swipe up for more)           |
| -19.1      [<]  [Next >]     |
+------------------------------+
```

- Swipe left/right on the narration steps through beats.
- The dial is a full-width slider with a fine-mode toggle button (no hover).
- The 3D halo uses one-finger rotate and pinch zoom.

---

## 8. Performance

- Story mode reuses the existing canvases. New per-frame work: drawing the light curve progressively (≤ 650 points) and the 3D halo (≤ 450 points). Both are well under 2 ms.
- The PDM curve is precomputed; the fold is O(n) per input event.
- Tiles: decode on first use, then render each tile once per zoom-settle into an offscreen canvas at screen resolution (the implementer's re-render-on-settle). The largest tile is 192 × 161 cells.
- Stamps are data URIs (57 extra images in `stories`); create `Image`s lazily per chapter.
- Budgets:
  - `stars.json` 4.18 MB (+0.33 MB vs v1, mostly story photometry and stamps);
  - `stars-tiles.jsonon` 0.57 MB, lazy;

---

## 9. Honesty notes (put each in its chapter, not a footer)

- **Absolute magnitudes** (−19.12 for the SN Ia, −18.9 for SN 2026gzf, −23.1 for the SLSN, −25.7 for the z = 4.57 quasar) use the difference-flux peak in one band, with no K-correction and no extinction correction: ±0.3 mag at best, worse at high z.
- **RR Lyrae candle.** It uses Gaia mean G with M_G = 0.63, which gives about ±10% in distance. It cannot exceed ~100 kpc because of Gaia's own depth.
- **Periods.**
  - Rubin's one season gives alias ambiguities: the seasonal alias for the RRc, the one-cycle-count ambiguity for the binary.
  - Show both and credit Gaia's longer baseline.
  - The earlier Lomb–Scargle strip was dominated by 1-day sampling aliases, which is why the dial uses PDM. Do not show a Lomb–Scargle periodogram to users.
- **The z = 4.57 quasar** has 5 detections. Treat it as "we saw it flicker", not as a light curve.
- **SDSS covers only the equatorial fields.** EDFS, ELAIS-S1 and ECDFS have no SDSS spectra, so "54 supernova candidates were quasars" is a lower bound from a partial check.
- **The core-sample view.** Its lines connect sky position to distance and do not imply physical association.

---

## 10. Credits to add

- **SDSS DR16** (Ahumada et al. 2020), via the GAVO Data Center TAP (dc.g-vo.org). "Funding for the Sloan Digital Sky Survey IV has been provided by the Alfred P. Sloan Foundation, the U.S. Department of Energy Office of Science, and the Participating Institutions."
- **IAU Catalog of Star Names**: IAU Working Group on Star Names (WGSN), compiled by E. Mamajek; CC BY.
- **Gaia DR3** zoom tiles: same acknowledgement as v1 (CC BY-SA 3.0 IGO).
- **Fink** stamps and forced photometry for the story objects: as v1.

## 11. Data access notes

- SIMBAD and VizieR (CDS) were unreachable during this run (timeouts). Star names therefore come from IAU-CSN, and redshifts from SDSS via GAVO.
- ESA's Gaia TAP rejects `CASE` and fails on `random_index`-sampled region queries, so the tiles use full-depth `CONTAINS` queries, which took 7–44 s each.
