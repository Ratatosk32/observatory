# Data licences

The JSON files in this folder are derived data, built by the scripts in `scripts/` from public sources. They are not covered by the MIT licence of the code.

| File | Derived from | Licence |
|---|---|---|
| `asteroids.json` | Rubin alerts via the Fink broker (SSO alerts, SSOFT, nightly statistics) | Rubin alerts are world-public; credit Fink (Möller et al. 2021, MNRAS 501, 3272). Shared under CC BY-SA 4.0 as a derived compilation. |
| `stars.json` | Rubin alerts via Fink; Gaia DR3; SDSS DR16 | Gaia-derived parts (Milky Way grid, bright stars, HR diagram, crossmatch fields) are CC BY-SA 3.0 IGO. Fink-derived parts are shared under CC BY-SA 4.0. Credit SDSS DR16 (Ahumada et al. 2020). |
| `cmb-sky.png`, `cmb-lens.png`, `cmb.json` | Planck SMICA CMB map and PR4 lensing reconstruction (ESA); ACT DR5 clusters (LAMBDA); Fink SN-like alerts | Planck products under the Planck Legacy Archive terms (credit ESA and the Planck Collaboration); ACT DR5 public via LAMBDA (credit Hilton et al. 2021); Fink-derived parts CC BY-SA 4.0. |
| `earth-lights-4096.jpg`, `earth-lights-2048.jpg` | NASA Black Marble 2016 via NASA GIBS | Public domain; credit NASA Earth Observatory / NOAA NGDC, Suomi NPP VIIRS (Román et al. 2018), via NASA GIBS. |
| `earth-land-2048.png` | Natural Earth 1:50m land | Public domain. |
| `earth.json`, `earth-lightning.json`, `earth-tiles/`, `earth-aurora.json` | GOES-R GLM via NOAA Open Data Dissemination; MTG-I1 Lightning Imager via EUMETSAT; NOAA SWPC products | GLM and SWPC: US Government open data, credit NOAA. Lightning Imager: EUMETSAT Core data under CC BY 4.0, "Contains modified EUMETSAT Meteosat data 2026". The derived files are shared under CC BY 4.0. |
| `stars-tiles.json` | Gaia DR3 density tiles; IAU Catalog of Star Names (WGSN, E. Mamajek) | Gaia tiles: CC BY-SA 3.0 IGO. Star names: CC BY. |

Gaia acknowledgement: "This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement."
