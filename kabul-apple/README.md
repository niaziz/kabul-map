# Kabul Map: Next.js + FastAPI

Apple Maps-style map of Kabul province only, with Map / Satellite views, optional geolocated place pins, and no sidebar.
Ports: backend 8100, frontend 3100 (different from older versions on purpose).
Use the upper-right map controls to toggle the isometric 3D city view, geolocated Kabul place pins and labels, proposed streets, permitted building, and all published district-zoning plans; click a zoning area to see its district and land-use category. Place pins cluster at city scale and show labels on zoom-in. Popups link to openly licensed reference photos where available, and the Bibi Mahru Hill popup includes its credited Sketchfab model. Map labels prefer OpenFreeMap's Dari (`name:fa`) names where available, with standard-name and English fallbacks. 3D building footprints and heights come from OpenStreetMap data served by OpenFreeMap/OpenMapTiles. Mapped building colors are preserved; buildings without a mapped color use a decorative palette. Coverage, height, and facade detail depend on what has been mapped in OpenStreetMap, so the extrusions are stylized rather than photo-accurate models. Only places with a geolocated point are included; do not infer missing locations from the broader 100-place list.
Street and building plans load on startup from `/api/street-plans`. The much larger district zoning collection is fetched and cached only when its layer is enabled, from `/api/district-plans`, and is sent with gzip compression. The municipality cautions that proposed road lines are indicative and may change after field surveys.
The municipality site currently publishes district zoning pages for districts 9–22; other district IDs return 404.

Quick start: `bash start.sh`, then open http://localhost:3100
