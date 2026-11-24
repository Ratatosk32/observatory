# Observatory nightly archive

This branch holds one snapshot per night of what observatory.noetx.com computed, written by the nightly refresh (`scripts/build_archive.py` on `main`). Snapshots wait as workflow artifacts and are committed here once a week, on Mondays. The branch never shares history with `main` and is not deployed. When a day had several runs, the latest one's file is kept.

Raw Rubin alerts are not here: Fink keeps them and they can be fetched again. The snapshots keep what cannot be recovered later: classifications as they stood that night, the site's own scores and meters, and the state of the upstream data.

## Layout

`snapshots/<year>/<YYYY-MM-DD>.json.gz`, gzip-compressed JSON, about 60 KB each.

## Fields (version 1)

- `version`, `date` (UTC day of the run), `built` (UTC time), `commit` (site commit, 8 characters).
- `health`: the site's `health.json` for that run: Fink's and ANTARES's newest Rubin night, 60 nights of Fink alert counts, each refresh step's outcome, and the verdict.
- `dm.lensing`: the CMB-lensing stack (sigma against rotated skies, bias, object count, area, the ACT positive control).
- `dm.clusterTest`: SN-like objects inside ACT DR6 clusters, observed against expected, sigma, the forecast, and the DR5 ghost needle.
- `dmClassified`: SN-like objects with a TNS spectroscopic type, as `[l, b, firstMJD, tnsType, z]`.
- `showcase.<mode>`: the desktop showcase for stars, asteroids and dark matter, in rank order, each row with the object id (Rubin diaObjectId, asteroid designation or ACT cluster name), score, `why` bits (stars) and the facts behind the chips.
- `stars.objects`: every object in the stars sample as `id: [family, catalogueType, name, z, zSource]`, so reclassifications can be found by comparing nights.
- `asteroids`: the asteroid sample's counts by class and band, and its date range.
- `tonight`: the Tonight targets for amateur telescopes, with their recent detections.
- `earth` (from 2026-11-25): the Earth mode's 24-hour window to the nightly build.
  - `kp` as `[unix time, Kp]` per 3 hours, `kpForecast`, the NOAA `scales` (R, S, G now and the day's maximum), and GOES X-ray `flares` as `[unix time, class, peak flux W/m²]`.
  - `solarWind`: the active L1 spacecraft and its backups, and the mean, minimum and maximum of the 5-minute medians of speed (km/s), density (per cm³) and Bz in GSM (nT).
  - `auroraPowerGW`: the OVATION hemispheric power, north and south, summarised the same way (the text product starts at 00:00 UTC, so the early part of the window is missing), and the model run kept that night.
  - `lightning`: the flash total, per-satellite file counts and flashes for GOES-East and GOES-West GLM and for the MTG Lightning Imager (`li`, with its state), flashes per hour, flashes per region (with whether open data covers it), and the ten largest storm cells. Counts that include the Lightning Imager contain modified EUMETSAT Meteosat data 2026 (CC BY 4.0).

A field is `null` when that part of the refresh failed that night; the run's log says why.
