# Band naming spike

Presets: true-color, color-infrared, agriculture, swir, geology, urban, land-water, atmospheric, bathymetric, ndvi, evi, savi, ndre, ndwi, mndwi, ndmi, nbr, ndbi, ndsi, bai, lst, scl, worldcover

| Source | Items | Today: names (varies across items?) | Keyed: canonical (varies?) | Presets usable today | Presets usable keyed |
|---|---|---|---|---|---|
| PC Sentinel-2 | 20 | AOT,B05,B06,B07,B09,B8A,SCL,WVP,blue,coastal,green,nir,red,swir16,swir22 (same) | AOT,B01,B02,B03,B04,B05,B06,B07,B08,B09,B11,B12,B8A,SCL,WVP,visual_b1,visual_b2,visual_b3 (same) | true-color, color-infrared, agriculture, swir, geology, urban, land-water, atmospheric, bathymetric, ndvi, evi, savi, ndwi, mndwi, ndmi, nbr, ndbi, ndsi, bai | true-color, color-infrared, agriculture, swir, geology, urban, land-water, atmospheric, bathymetric, ndvi, evi, savi, ndwi, mndwi, ndmi, nbr, ndbi, ndsi, bai |
| ES Sentinel-2 | 20 | aot,blue,cloud,coastal,green,nir,nir08,nir09,red,rededge1,rededge2,rededge3,scl,snow,swir16,swir22,wvp (same) | aot,blue,cloud,coastal,green,nir,nir08,nir09,red,rededge1,rededge2,rededge3,scl,snow,swir16,swir22,wvp (same) | true-color, color-infrared, agriculture, swir, geology, urban, land-water, atmospheric, bathymetric, ndvi, evi, savi, ndre, ndwi, mndwi, ndmi, nbr, ndbi, ndsi, bai, scl | true-color, color-infrared, agriculture, swir, geology, urban, land-water, atmospheric, bathymetric, ndvi, evi, savi, ndre, ndwi, mndwi, ndmi, nbr, ndbi, ndsi, bai, scl |
| INPE Sentinel-2 cube | 20 | B05,B06,B07,CLEAROB,EVI,NBR,NDVI,PROVENANCE,SCL,TOTALOB,blue,coastal,green,nir,nir08,nir09,red,swir16,swir22 (same) | B01,B02,B03,B04,B05,B06,B07,B08,B09,B11,B12,B8A,CLEAROB,EVI,NBR,NDVI,PROVENANCE,SCL,TOTALOB (same) | true-color, color-infrared, agriculture, swir, geology, urban, land-water, atmospheric, bathymetric, ndvi, evi, savi, ndwi, mndwi, ndmi, nbr, ndbi, ndsi, bai | true-color, color-infrared, agriculture, swir, geology, urban, land-water, atmospheric, bathymetric, ndvi, evi, savi, ndwi, mndwi, ndmi, nbr, ndbi, ndsi, bai |
| PC Landsat | 20 | atran,blue,cdist,coastal,drad,emis,emsd,green,lwir,nir,qa,qa_aerosol,qa_pixel,qa_radsat,red,swir16,swir22,trad,urad (same) | atran,blue,cdist,coastal,drad,emis,emsd,green,lwir11,nir08,qa,qa_aerosol,qa_pixel,qa_radsat,red,swir16,swir22,trad,urad (same) | true-color, color-infrared, agriculture, swir, geology, urban, land-water, atmospheric, bathymetric, ndvi, evi, savi, ndwi, mndwi, ndmi, nbr, ndbi, ndsi, bai, lst | true-color, geology, urban, bathymetric, mndwi, ndsi |
| ES Landsat | 20 | atran,blue,cdist,coastal,drad,emis,emsd,green,lwir,nir,qa,qa_aerosol,qa_pixel,qa_radsat,red,swir16,swir22,trad,urad (same) | atran,blue,cdist,coastal,drad,emis,emsd,green,lwir11,nir08,qa,qa_aerosol,qa_pixel,qa_radsat,red,swir16,swir22,trad,urad (same) | true-color, color-infrared, agriculture, swir, geology, urban, land-water, atmospheric, bathymetric, ndvi, evi, savi, ndwi, mndwi, ndmi, nbr, ndbi, ndsi, bai, lst | true-color, geology, urban, bathymetric, mndwi, ndsi |
| PC NAIP | 20 | blue,green,nir,red (same) | image_b1,image_b2,image_b3,image_b4 (same) | true-color, color-infrared, ndvi, evi, savi, ndwi, bai | true-color, color-infrared, ndvi, evi, savi, ndwi, bai |
| PC WorldCover | 2 | map (same) | map (same) | - | - |
| swisstopo SWISSIMAGE | 20 | swissimage_dop10_2018_2602_1197_0_1_2056_tif,swissimage_dop10_2018_2602_1197_2_2056_tif (**varies: 20 sets**) | swissimage_dop10_2018_2602_1197_0_1_2056_tif,swissimage_dop10_2018_2602_1197_2_2056_tif (**varies: 20 sets**) | - | - |
| swisstopo swissALTI3D | 20 | swissalti3d_2019_2598_1198_0_5_2056_5728_tif,swissalti3d_2019_2598_1198_2_2056_5728_tif (**varies: 20 sets**) | swissalti3d_2019_2598_1198_0_5_2056_5728_tif,swissalti3d_2019_2598_1198_2_2056_5728_tif (**varies: 20 sets**) | - | - |

- PC Sentinel-2 aliases: coastal→B01, blue→B02, green→B03, red→B04, rededge→B05, nir→B08, swir16→B11, swir22→B12
- ES Sentinel-2 aliases: B02→blue, B01→coastal, B03→green, B08→nir, B8A→nir08, B09→nir09, B04→red, rededge→rededge1, B05→rededge1, B06→rededge2, B07→rededge3, B11→swir16, B12→swir22
- INPE Sentinel-2 cube aliases: coastal→B01, blue→B02, green→B03, red→B04, rededge→B05, nir→B08, nir09→B09, swir16→B11, swir22→B12, nir08→B8A
- PC Landsat aliases: OLI_B2→blue, OLI_B1→coastal, OLI_B3→green, TIRS_B10→lwir11, OLI_B5→nir08, OLI_B4→red, OLI_B6→swir16, OLI_B7→swir22
- ES Landsat aliases: OLI_B2→blue, OLI_B1→coastal, OLI_B3→green, TIRS_B10→lwir11, OLI_B5→nir08, OLI_B4→red, OLI_B6→swir16, OLI_B7→swir22
- PC NAIP aliases: red→image_b1, Red→image_b1, green→image_b2, Green→image_b2, blue→image_b3, Blue→image_b3, nir→image_b4, NIR→image_b4
- PC WorldCover aliases: Band1→map
- swisstopo SWISSIMAGE aliases: 
- swisstopo swissALTI3D aliases: 

Role names (those the presets use) of a style saved on a source, found on another: today · keyed (canonical or alias).

| Saved on → opened on | PC Sentinel-2 | ES Sentinel-2 | INPE Sentinel-2 cube | PC Landsat | ES Landsat | PC NAIP | PC WorldCover | swisstopo SWISSIMAGE | swisstopo swissALTI3D |
|---|---|---|---|---|---|---|---|---|---|
| PC Sentinel-2 | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 6/7 | 7/7 · 6/7 | 4/7 · 4/7 | 0/7 · 0/7 | 0/7 · 0/7 | 0/7 · 0/7 |
| ES Sentinel-2 | 7/9 · 7/9 | 9/9 · 9/9 | 7/9 · 7/9 | 7/9 · 6/9 | 7/9 · 6/9 | 4/9 · 4/9 | 0/9 · 0/9 | 0/9 · 0/9 | 0/9 · 0/9 |
| INPE Sentinel-2 cube | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 7/7 | 7/7 · 6/7 | 7/7 · 6/7 | 4/7 · 4/7 | 0/7 · 0/7 | 0/7 · 0/7 | 0/7 · 0/7 |
| PC Landsat | 7/8 · 7/8 | 7/8 · 7/8 | 7/8 · 7/8 | 8/8 · 6/8 | 8/8 · 6/8 | 4/8 · 4/8 | 0/8 · 0/8 | 0/8 · 0/8 | 0/8 · 0/8 |
| ES Landsat | 7/8 · 7/8 | 7/8 · 7/8 | 7/8 · 7/8 | 8/8 · 6/8 | 8/8 · 6/8 | 4/8 · 4/8 | 0/8 · 0/8 | 0/8 · 0/8 | 0/8 · 0/8 |
| PC NAIP | 4/4 · 4/4 | 4/4 · 4/4 | 4/4 · 4/4 | 4/4 · 3/4 | 4/4 · 3/4 | 4/4 · 4/4 | 0/4 · 0/4 | 0/4 · 0/4 | 0/4 · 0/4 |
| PC WorldCover | - | - | - | - | - | - | - | - | - |
| swisstopo SWISSIMAGE | - | - | - | - | - | - | - | - | - |
| swisstopo swissALTI3D | - | - | - | - | - | - | - | - | - |
