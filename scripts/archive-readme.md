# Observatory nightly archive

This branch holds one snapshot per night of what observatory.noetx.com computed, written by the nightly refresh (`scripts/build_archive.py` on `main`). It never shares history with `main` and is not deployed. A later run on the same day replaces that day's file.

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

A field is `null` when that part of the refresh failed that night; the run's log says why.
