# Band naming spike: findings and decision

Spikes: `band-naming.spike.ts` (results in `band-naming-results.md`) and `tile-keys.spike.ts`. Run 2026-11-20 on 20
real items each of PC and Earth Search Sentinel-2, the INPE Sentinel-2 cube, PC and Earth Search Landsat, PC NAIP, PC
WorldCover, and swisstopo SWISSIMAGE and swissALTI3D. The 23 style presets of ria-geotiff were replayed against each.

## Question

The implementation review recommended replacing today's names (EO common name first: `red`, `nir`) with odc-stac's
model: a canonical name per asset key (`B04`), with common names as aliases, and styles storing the canonical
names. The reason given was that today's names depend on the asset list, so a saved style could silently pick
another band. Is that true on real data, and what do saved styles need?

## What the data says

1. **Today's names are stable within every collection that has stable asset keys.** All 20 items of each
   Sentinel-2, Landsat and NAIP collection give the same names. The "depends on the asset list" risk is real in
   theory (an item without B08 would name B8A `nir`), but no tested collection varies its assets across items.
2. **Role names are what makes styles portable, and asset keys are not.** The presets need `red`, `nir`, `swir16`
   and so on:
   - With today's names, 19 to 21 presets work on every Sentinel-2 and Landsat source and 7 on NAIP.
   - With asset keys as names, a style saved on Planetary Computer (`B08 - B04`) means nothing on Earth Search,
     whose keys are `nir` and `red`. Aliases are needed just to get back to where role names already are.
   - Storing canonical (key) names in styles would make every saved style specific to one catalog.
3. **Aliases still help, as an addition.** A style written with Planetary Computer's `B05` or Landsat's `OLI_B4`
   resolves on another catalog when the band's own `name` and its asset key are aliases of the role name. The
   `nir08 → nir` rule for Landsat is an alias too: with keys as canonical names and no such alias, 14 presets are
   lost on Landsat (6 usable instead of 20).
4. **The real instability is per-tile asset keys, and neither scheme handles it.** swisstopo names assets after the
   tile (`swissalti3d_2019_2598-1198_0.5_2056_5728.tif`). Thirty items of swissALTI3D have 120 different keys, so
   every tile gets different band names, under both schemes, and a mosaic or time series of tiles cannot share a
   band name.
   - **Removing the item id from the key fixes it:** the 120 keys become 4 (`_0.5_2056_5728.tif`,
     `_2_2056_5728.tif` and two zipped XYZ files).
   - SWISSIMAGE: 60 keys become 2. swissSURFACE3D: 60 become 2.
   - The studio worked around this with a "Heights from" choice by `gsd`; this rule makes it unnecessary.
5. **Catalogs disagree about metadata, not about naming.** Earth Search has `nir08` where Planetary Computer has
   `B8A` without a common name, so no scheme can map them without a curated table.

## Decision (proposed)

- **Keep role-first names as the band names, and have styles store role names.** Today's rule stays: the EO common
  name when unique, else the asset key. This is what presets and saved styles use, and what makes them work across
  catalogs.
- **Make asset keys stable before naming:** a key that starts with the item's id loses that prefix (and the
  separator after it) wherever a key becomes a band name. This fixes swisstopo-like catalogs, where tiles become one
  band.
- **Add aliases for resolving names, without changing the names themselves:** each band answers to its asset key,
  its band `name`, and the role aliases (`nir08 → nir`, `lwir11 → lwir`).
  - A style that names a band the model lacks is resolved through the aliases, and the substitution is reported
    (never silent).
  - This covers styles written against another catalog's keys.
- **Report what a name was made from:** `common-name`, `key`, `key without item id`, or `band name`. A UI can then
  show it, and a saved style can record it (a manifest may store the alias table it was saved with).
- **Not adopted:** keys as canonical names stored in styles. The evidence says that would break portability without
  fixing anything seen in practice.

## Where the code goes

The rule lives where a model is built: ria-geotiff's `stacToManifest` (today `bridge.ts`), which writes the
manifest's band names. ria-stac keeps `nameAssetBands` only to estimate a collection's bands for display
(`collectionBands`), so both apply the same rule. They should share one tested definition (a small table of
fixtures, run by both test suites) rather than drift.
