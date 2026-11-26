import argparse
import base64
import json
import os
import re
import struct
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

SITE = Path(__file__).resolve().parent.parent / "site" / "data"
MAX_BRIEF = 4096
MINUS = "−"
TNS_NAME = re.compile(r"^(?:SN|AT)\s?(\d{4}[a-z]{2,4})$")
SAFE_NAME = re.compile(r"^[\w .:+\-()/'’]{1,64}$")
LINKS = {
    "act": ("ACT DR6", "https://arxiv.org/abs/2507.21459"),
    "fink": ("Fink", "https://lsst.fink-portal.org/"),
    "swpc": ("SWPC", "https://www.swpc.noaa.gov/products/real-time-solar-wind"),
    "aurora": ("SWPC aurora", "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast"),
    "goes": ("GOES imagery", "https://www.star.nesdis.noaa.gov/GOES/index.php"),
    "eumetsat": ("EUMETView", "https://view.eumetsat.int/"),
}
CLASS_WORD = {"NEO": "near-Earth asteroid", "MC": "Mars-crosser", "HUN": "Hungaria", "TRO": "Jupiter Trojan", "HIL": "Hilda", "CYB": "Cybele", "MB": "main-belt asteroid", "OMB": "outer main-belt asteroid"}


def load(data, name):
    return json.loads((data / name).read_text(encoding="utf-8"))


def link(key, url=None):
    label, base = LINKS[key]
    return {"label": label, "url": url or base}


def day(n):
    d = datetime.strptime(str(n), "%Y%m%d")
    return f"{d.day} {d.strftime('%b')}"


def plural(n, one, many):
    return f"{n} {one if n == 1 else many}"


def sig(v):
    return ("+" if v >= 0 else MINUS) + f"{abs(v):.1f}σ"


def clip(s, n):
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1].rstrip(" ,;:") + "…"


def safe_name(s):
    s = str(s or "").strip()
    return s if SAFE_NAME.match(s) else None


def last_of(xs):
    for i in range(len(xs or []) - 1, -1, -1):
        if xs[i] is not None:
            return i, xs[i]
    return None


def big(v, unit, **extra):
    return {"v": v, "unit": unit, **extra}


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def status_line(health):
    v = health.get("verdict") or {}
    code = v.get("code")
    since = v.get("since")
    rubin = (health.get("links") or {}).get("rubin", "https://rubinobservatory.org/for-scientists/rubin-101/live-status")
    if code == "rubin-silent" and since:
        gap = int(v.get("gap") or 0)
        text = (f"Rubin has sent no alerts since {day(since)} ({plural(gap, 'quiet night', 'quiet nights')}); short gaps are usually weather."
                if gap <= 3 else
                f"Rubin has been silent since {day(since)} ({gap} nights): weather or a technical stop. The sky floors show the last data night.")
    elif code == "broker-lag" and since:
        text = f"Rubin is observing, but Fink stops at {day(since)}. The sky floors wait for Fink to catch up."
    elif code == "pipeline":
        text = f"The last nightly refresh failed for {', '.join(v.get('failed') or ['some steps'])}. Those floors show the run before."
    elif code == "behind" and since:
        text = f"Fink has data up to {day(since)}, but some floors stop earlier. The next nightly refresh catches up."
    elif code in ("ok", "partial") and since:
        text = f"All in step: Rubin observed on {day(since)}, Fink has it, and every floor shows it."
    else:
        text = "Fink and ANTARES could not be reached at the last check, so the state upstream is unknown."
    return {"text": text, "level": v.get("level") or "warn", "asOf": health.get("checked"), "source": "Fink and ANTARES brokers",
            "link": {"label": "Rubin status", "url": rubin}}


def dm_item(data, health):
    c = load(data, "cmb.json")
    lt, ct = c["lensing"], c["clusterTest"]
    best = max(lt["sigma"], ct["sigma"])
    when = re.search(r"around ([^,]+)|about ([^,]+)$", lt.get("forecast", "")) or re.search(r"about (late \d{4}|early \d{4}|\d{4})", ct.get("forecast", ""))
    fc = next((g for g in when.groups() if g), None) if when else None
    detail = f"Lensing {sig(lt['sigma'])}, clusters {sig(ct['sigma'])} ({ct['observed']:,} seen, {ct['expected']:,.0f} expected)."
    if fc and best < 3:
        detail += f" 3σ expected {fc}."
    return {
        "floor": "Galaxy clusters, the CMB", "mode": "dm",
        "headline": "Explosions follow the dark matter: " + ("yes, above 3σ" if best >= 3 else "not yet"),
        "detail": detail, "source": "Planck PR4, ACT DR6, Fink", "state": "nightly", "asOf": health["site"].get("dm"),
        "go": {"inst": "Meters"}, "links": [link("act")],
        "big": big(sig(best), ("clusters" if ct["sigma"] >= lt["sigma"] else "lensing") + ", against 3σ", axis=[round(lt["sigma"], 1), round(ct["sigma"], 1)]),
    }


def stars_item(data, health, show, tonight):
    ob = load(data, "stars.json")["objects"]
    sc = show["modes"]["stars"]
    top = sc["rank"][0]
    name = safe_name(ob["name"][top])
    oid = str(ob["id"][top])
    f = sc.get("facts", {}).get(str(top), {})
    bits = []
    if f.get("rareLabel"):
        bits.append(f"rare here: {f['rareLabel']}")
    if f.get("amp"):
        bits.append(f"swung {f['amp']:.1f} mag")
    detail = ", ".join(bits)
    detail = (detail[:1].upper() + detail[1:] + ".") if detail else ""
    kept = len(tonight.get("recent", []) or [])
    if kept:
        detail += f" {plural(kept, 'bright transient', 'bright transients')} for a small telescope in the last 30 days."
    amount = big(f"{f['amp']:.1f}", "magnitudes of swing") if f.get("amp") else big(f"{kept:,}", "bright transients in 30 days") if kept else None
    tns = TNS_NAME.match(name or "")
    links = [{"label": "TNS", "url": "https://www.wis-tns.org/object/" + tns.group(1)}] if tns else [link("fink")]
    return {
        "floor": "Supernovae, AGN", "mode": "stars",
        "headline": f"{name or 'Rubin object ' + oid[-6:]} leads the night",
        "detail": detail.strip(), "source": "Rubin via Fink", "state": "nightly", "asOf": health["site"].get("stars"),
        "go": {"find": oid}, "alt": {"label": "Tonight’s list", "go": {"preset": "tonight"}} if kept else None, "links": links,
        "big": amount,
    }


def asteroid_item(data, health, show):
    a = load(data, "asteroids.json")
    sc = show["modes"]["asteroids"]
    top = sc["rank"][0]
    o = a["objs"][top]
    name = safe_name(o["n"]) or "an asteroid"
    f = sc.get("facts", {}).get(str(top), {})
    cls = CLASS_WORD.get(o.get("c"), "asteroid")
    detail = f"A {cls}, e {o['el'][1]:.2f}"
    moid = f.get("moid")
    amount = big(f"{o['el'][1]:.2f}", "orbital eccentricity")
    if moid is not None and moid < 0.05 and o.get("c") == "NEO":
        detail += f"; its orbit passes {moid:.3f} AU from Earth’s, so it counts as potentially hazardous"
        amount = big(f"{moid:.3f}", "AU from Earth’s orbit")
    nneo = (a["meta"].get("classes") or {}).get("NEO", 0)
    detail += f". {nneo:,} near-Earth asteroids among {a['meta']['nobj']:,} tracked."
    return {
        "floor": "Asteroids", "mode": "asteroids",
        "headline": f"{name}, {cls}", "detail": detail,
        "source": "Rubin via Fink, two-body orbits", "state": "nightly", "asOf": health["site"].get("asteroids"),
        "go": {"find": name}, "links": [{"label": "JPL SBDB", "url": "https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=" + quote(name)}],
        "big": amount,
    }


def earth_items(data):
    e = load(data, "earth.json")
    sw, meta = e["sw"], e["meta"]
    t0, step = sw.get("t0", 0), sw.get("step", 300)
    kp = (sw.get("kp") or [None])[-1]
    kp_v = kp[1] if isinstance(kp, list) else None
    sp, bz, hp = last_of(sw.get("speed")), last_of(sw.get("bz")), last_of(sw.get("hpN"))
    g = ((sw.get("scales") or {}).get("now") or {}).get("G")
    parts = []
    if sp:
        parts.append(f"Solar wind {sp[1]:.0f} km/s")
    if bz:
        b = bz[1] / 10
        parts.append(f"Bz {'+' if b >= 0 else MINUS}{abs(b):.1f} nT, {'north' if b >= 0 else 'south'}")
    if g:
        parts.append(f"G{g} storm")
    at = max([t0 + x[0] * step for x in (sp, bz) if x] or [0])
    word = "Quiet space weather" if kp_v is None or kp_v < 3 else "Unsettled space weather" if kp_v < 4 else "Active space weather" if kp_v < 5 else "Geomagnetic storm"
    items = [{
        "floor": "Solar wind at L1", "mode": "earth",
        "headline": word + (f": Kp {kp_v:.1f}" if kp_v is not None else ""),
        "detail": (", ".join(parts) + ".") if parts else "No solar-wind values in the last nightly copy.",
        "source": "NOAA SWPC", "state": "nightly", "asOf": iso(at) if at else meta.get("built"),
        "live": "sw", "go": {"inst": "Space weather"}, "links": [link("swpc")],
        "big": big(f"{kp_v:.1f}", "Kp, planetary index") if kp_v is not None else big(f"{sp[1]:.0f}", "km/s solar wind") if sp else None,
    }, {
        "floor": "Aurora", "mode": "earth",
        "headline": f"Aurora power {hp[1]:.0f} GW in the north" if hp else "Aurora oval from the model",
        "detail": "OVATION Prime: the chance of aurora overhead in the next 30 to 90 minutes, a model, not a sighting.",
        "source": "NOAA SWPC OVATION", "state": "model", "asOf": (meta.get("swpc") or {}).get("ovationRun") or meta.get("built"),
        "live": "hp", "go": {"preset": "north"}, "links": [link("aurora")],
        "big": big(f"{hp[1]:.0f}", "GW of aurora, north") if hp else None,
    }]
    cells = sorted(e.get("cells") or [], key=lambda c: -c.get("peak", 0))
    li = (meta.get("li") or {}).get("state")
    top = cells[0] if cells else None
    end = meta["window"][1]
    detail = f"{meta['flashes'] / 1e6:.2f} million flashes in the 24 hours to {end[11:16]} UTC."
    if li != "nightly":
        detail += " No Lightning Imager data that night: Europe and Africa are missing."
    links = [link("goes")] + ([link("eumetsat")] if li == "nightly" else [])
    top_name = safe_name(top["name"]) if top else None
    items.append({
        "floor": "Lightning", "mode": "earth",
        "headline": f"{top_name}, {top['peak']:,} flashes an hour at its peak" if top_name else "A quiet night for lightning",
        "detail": detail, "source": "GOES GLM" + (", MTG LI" if li == "nightly" else ""), "state": "nightly", "asOf": end,
        "go": {"preset": "night"} if top else {}, "links": links,
        "big": big(f"{top['peak']:,}", "flashes an hour at peak") if top_name else big(f"{meta['flashes'] / 1e6:.2f}", "million flashes in 24 hours"),
    })
    return items


def decode_inside(clusters):
    n, fields = clusters["n"], clusters["fields"]
    if "data" not in clusters or "inside" not in fields:
        return [0] * n
    raw = base64.b64decode(clusters["data"])
    k, nf = fields.index("inside"), len(fields)
    vals = struct.unpack(f"<{len(raw) // 2}H", raw)
    sc, off = clusters["scale"][k], clusters["offset"][k]
    return [vals[i * nf + k] / sc - off for i in range(n)]


def build_index(data):
    out = {"version": 1}
    try:
        ob = load(data, "stars.json")["objects"]
        out["stars"] = [[n, str(i)] for n, i in zip(ob["name"], ob["id"]) if safe_name(n)]
    except (OSError, ValueError, KeyError) as e:
        print(f"index: stars skipped ({e})", file=sys.stderr)
    try:
        out["asteroids"] = [o["n"] for o in load(data, "asteroids.json")["objs"] if safe_name(o.get("n"))]
    except (OSError, ValueError, KeyError) as e:
        print(f"index: asteroids skipped ({e})", file=sys.stderr)
    try:
        cl = load(data, "cmb.json")["clusters"]
        names = cl["names"].split("|")
        inside = decode_inside(cl)
        out["dm"] = ["ACT-CL " + n for n, k in zip(names, inside) if k >= 1 and safe_name(n)]
        out["dmAll"] = len(names)
    except (OSError, ValueError, KeyError, struct.error) as e:
        print(f"index: clusters skipped ({e})", file=sys.stderr)
    try:
        e = load(data, "earth.json")
        storms = []
        for c in sorted(e.get("cells") or [], key=lambda c: -c.get("peak", 0)):
            nm = safe_name(c.get("name"))
            if nm and nm not in storms:
                storms.append(nm)
        out["earth"] = storms
        out["regions"] = [[r["id"], r["name"]] for r in e.get("regions") or [] if safe_name(r.get("name")) and re.match(r"^[a-z0-9-]{1,12}$", str(r.get("id", "")))]
    except (OSError, ValueError, KeyError) as e:
        print(f"index: earth skipped ({e})", file=sys.stderr)
    return out


def previous(path):
    try:
        old = json.loads(Path(path).read_text(encoding="utf-8"))
        return {f["floor"]: f for f in old.get("floors", [])}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def write(path, obj, limit=None):
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    size = len(text.encode("utf-8"))
    if limit and size > limit:
        raise SystemExit(f"{Path(path).name} would be {size} bytes, over the {limit}-byte limit; the old file stays")
    fd, tmp = tempfile.mkstemp(dir=str(Path(path).parent), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)
    return size


def main():
    ap = argparse.ArgumentParser(description="Write site/data/brief.json (one headline per floor, with provenance) and site/data/index.json (names on every floor).")
    ap.add_argument("--data", default=str(SITE))
    ap.add_argument("--out", default=None)
    ap.add_argument("--index", default=None)
    args = ap.parse_args()
    data = Path(args.data)
    out_path = args.out or str(data / "brief.json")
    index_path = args.index or str(data / "index.json")
    health = load(data, "health.json")
    show = load(data, "showcase.json")
    try:
        tonight = load(data, "tonight.json")
    except (OSError, ValueError):
        tonight = {}
    old = previous(out_path)
    order = ["Galaxy clusters, the CMB", "Supernovae, AGN", "Asteroids", "Solar wind at L1", "Aurora", "Lightning"]
    built = {}
    for name, make in [("dm", lambda: [dm_item(data, health)]), ("stars", lambda: [stars_item(data, health, show, tonight)]),
                       ("asteroids", lambda: [asteroid_item(data, health, show)]), ("earth", lambda: earth_items(data))]:
        try:
            for item in make():
                built[item["floor"]] = item
        except (OSError, ValueError, KeyError, IndexError, TypeError, AttributeError) as e:
            print(f"brief: {name} kept from the last run ({type(e).__name__}: {e})", file=sys.stderr)
    floors = []
    for name in order:
        f = built.get(name) or old.get(name)
        if not f:
            continue
        f = {k: v for k, v in f.items() if v not in (None, "", {})}
        f["headline"] = clip(f["headline"], 90)
        f["detail"] = clip(f.get("detail", ""), 220)
        floors.append(f)
    brief = {"version": 2, "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "status": status_line(health), "floors": floors}
    size = write(out_path, brief, MAX_BRIEF)
    isize = write(index_path, build_index(data))
    print(f"wrote {out_path}: {len(floors)} floors, {size} bytes; {index_path}: {isize} bytes")


if __name__ == "__main__":
    main()
