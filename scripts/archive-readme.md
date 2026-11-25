# Observatory nightly archive

This branch holds what observatory.noetx.com computed each night, written by the nightly refresh on `main`. The scheduled run (and any manual run) writes one snapshot with `scripts/build_archive.py`; pushes do not. Snapshots wait as workflow artifacts and are packed here once a week, on Mondays, by `scripts/archive_week.py`. The branch never shares history with `main` and is not deployed. When a day had several runs, the one built last is kept.

Raw Rubin alerts are not here: Fink keeps them and they can be fetched again. The archive keeps what cannot be recovered later: classifications as they stood that night, the site's own scores and meters, and the state of the upstream data.

## Layout

- `weeks/<YYYY>-W<ww>.json.gz`: one gzip JSON file per ISO week of run dates (Monday to Sunday, UTC), a keyframe plus per-night deltas plus a weekly summary. About 60 KB for the keyframe and 1 to 25 KB per night after it.
- `history/index.json`: short series across all weeks, one row per run and one per data night, so a time machine can load this file alone and fetch a week file only when it needs the detail.
- `snapshots/<year>/<YYYY-MM-DD>.json.gz`: daily snapshots, present only for a week whose week file failed its self-check (see below). Normally empty.

## Replay key

Each run is keyed on its data night, `health.fink.last` (Fink's newest Rubin night, `YYYYMMDD`), not on the run date. A run whose data night equals the previous run's, or whose `health` part is missing, is silent. Consecutive silent runs are merged into one timeline entry marked `silent`, with the Data Health verdict code as its `reason` (`rubin-silent`, `broker-lag`, `pipeline` and so on, or `no health`). The first run ever archived counts as a data night.

## Week file (week 1, delta 1, events 1, summary 1)

- `versions`: the version of each part of this file, and `snapshot`, the snapshot versions it contains.
- `week`, `from`, `to` (first and last run date), `prevNight` (the data night before the week, or null).
- `timeline`: the replay entries, `{night, silent, dates: [first, last], runs}`, with `verdict` for data nights and `reason`, `level`, `gap` for merged silent runs.
- `keyframe`: `{date, night, silent, sha256, events, state}`. `state` is the full snapshot of the week's first run.
- `deltas`: one per later run, in date order, `{date, night, silent, sha256, events, ops}`.
  - `ops` rebuild the run's snapshot from the one before it. Paths are lists of object keys; lists are never addressed inside.
    - `["+", path, value]` adds a key, `["=", path, value]` replaces a value, `["-", path]` removes a key.
    - `["L", path, items]` rebuilds a list of objects or lists: an integer item is a copy of the old list's element at that index, anything else is a new element.
    - `["@", [part], j, ops]` restores a part that was missing on the previous run: copy it from run `j` of this week (0 is the keyframe), then apply `ops` to it.
  - `events` say what changed, for reading; they are not needed to rebuild:
    - `verdict`: the run's Data Health verdict, always present (null when `health` is missing);
    - `missing`: parts that are null on this run; `restored`: parts back after being null;
    - `objects`: stars-sample ids `added` and `removed`, and `reclassified` as `[id, old, new]` with rows `[family, catalogueType, name, z, zSource]`;
    - `showcase.<mode>`: `entered` as `[id, rank, score]`, `exited` as `[id, oldRank]`, `moved` as `[id, oldRank, newRank]`, ranks from 1;
    - `meters`: new values of `lensSigma`, `lensBias`, `lensObjects`, `controlSigma`, `clusterObserved`, `clusterExpected`, `clusterSigma`, `dr5Sigma`;
    - `kp` (and `kpMax`), `scales`, `flares`, `solarWind`, `auroraPowerGW`: the new Earth values when they changed;
    - `lightning`: the new flash total and the new count of each region whose count changed.
- `summary`:
  - `runs`, `dataNights` (`{night, date, verdict}`), `silent` (the merged silent entries with their reasons);
  - `series`: one row per run, with the same fields as the index `days` table;
  - `top`: the weirdest object (`weirdest`, the highest-scoring stars showcase row of the week) and each mode's leader, the five strongest storm cells, the busiest lightning day, each region's peak, the highest Kp, the fastest solar wind, the most southward Bz, and every reclassification as `[date, id, old, new]` (at most 200, with the full count in `reclassified`);
  - `showcase.<mode>`: over the week's data nights, how many objects were seen, the ids that `stayed` on every data night and the `fleeting` ones seen on only one.

Every `sha256` is the SHA-256 of the run's snapshot as canonical JSON: keys sorted, no spaces, UTF-8, `json.dumps(x, sort_keys=True, separators=(',', ':'), ensure_ascii=False)`.

## Self-check

Before a week file is written, it is read back from its gzip bytes, every run is rebuilt from the keyframe and the deltas, and each one must equal the original snapshot byte for byte as canonical JSON and match its `sha256`. Only then are that week's daily files dropped. If the check fails, the week's daily files are written to `snapshots/`, an existing week file is left as it was, and the run logs a `::warning::`; the next weekly run tries again. A week is rebuilt whenever new snapshots for it arrive, so a run on Monday that starts the next week is merged in the week after.

To rebuild a night by hand, from a checkout of `main`:

```
python -I scripts/archive_week.py verify weeks/2026-W48.json.gz
python -I scripts/archive_week.py extract weeks/2026-W48.json.gz --date 2026-11-26 --out <dir>
```

## Index (index 1)

`history/index.json` has `version`, `updated` (the newest run date), and three tables:

- `days` (`fields`, `rows`): one row per run: `date`, `night`, `silent`, `verdict`, `finkAlerts` (Fink alerts on the data night), `objects` (stars sample size), `lensSigma`, `clusterSigma`, `clusterObserved`, `topStar` and `topScore` (the top stars showcase row), `kpMax`, `windMax` (km/s), `bzMin` (nT), `flashes`, `auroraMax` (GW).
- `nights` (`fields`, `rows`): one row per data night and one merged row per run of silent days: `night`, `from`, `to`, `runs`, `silent`, `verdict`, then the Rubin values of the data night (null on silent rows).
- `weeks`: `{week, file, from, to, runs, dataNights, bytes, sha256}` for each week file. A run date in `days` whose week is not listed is in `snapshots/`.

## Snapshot fields (snapshot 2)

- `version`, `parts` (the version of each part below), `date` (UTC day of the run), `night` (`health.fink.last`), `built` (UTC time), `commit` (site commit, 8 characters).
- `health` (part 1): the site's `health.json` for that run: Fink's and ANTARES's newest Rubin night, 60 nights of Fink alert counts, each refresh step's outcome, and the verdict.
- `dm.lensing` (part `dm` 1): the CMB-lensing stack (sigma against rotated skies, bias, object count, area, the ACT positive control).
- `dm.clusterTest`: SN-like objects inside ACT DR6 clusters, observed against expected, sigma, the forecast, and the DR5 ghost needle.
- `dmClassified` (part 1): SN-like objects with a TNS spectroscopic type, as `[l, b, firstMJD, tnsType, z]`.
- `showcase.<mode>` (part 1): the desktop showcase for stars, asteroids and dark matter, in rank order, each row with the object id (Rubin diaObjectId, asteroid designation or ACT cluster name), score, `why` bits (stars) and the facts behind the chips.
- `stars.objects` (part `stars` 1): every object in the stars sample as `id: [family, catalogueType, name, z, zSource]`, so reclassifications can be found by comparing nights.
- `asteroids` (part 1): the asteroid sample's counts by class and band, and its date range.
- `tonight` (part 1): the Tonight targets for amateur telescopes, with their recent detections.
- `earth` (part 1): the Earth mode's 24-hour window to the nightly build.
  - `kp` as `[unix time, Kp]` per 3 hours, `kpForecast`, the NOAA `scales` (R, S, G now and the day's maximum), and GOES X-ray `flares` as `[unix time, class, peak flux W/m²]`.
  - `solarWind`: the active L1 spacecraft and its backups, and the mean, minimum and maximum of the 5-minute medians of speed (km/s), density (per cm³) and Bz in GSM (nT).
  - `auroraPowerGW`: the OVATION hemispheric power, north and south, summarised the same way (the text product starts at 00:00 UTC, so the early part of the window is missing), and the model run kept that night.
  - `lightning`: the flash total, per-satellite file counts and flashes for GOES-East and GOES-West GLM and for the MTG Lightning Imager (`li`, with its state), flashes per hour, flashes per region (with whether open data covers it), and the ten largest storm cells. Counts that include the Lightning Imager contain modified EUMETSAT Meteosat data 2026 (CC BY 4.0).

A part is `null` when that part of the refresh failed that night; the run's log says why.

## Changelog

- 2026-11-25: snapshot 2 adds `parts` and `night`. The weekly run now packs snapshots into week files (week 1, delta 1, events 1, summary 1) and keeps `history/index.json` (index 1) instead of committing daily files. Snapshots are built only by the scheduled and manual runs, not on every push.
- 2026-11-24: snapshot 1 gains the `earth` part (from the 2026-11-25 run).
- 2026-11-24: snapshot 1. Daily snapshots wait as artifacts and are flushed to `snapshots/<year>/` on Mondays.
