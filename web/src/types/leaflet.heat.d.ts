// Type augmentation for the leaflet.heat plugin (no bundled types).
import "leaflet";

declare module "leaflet" {
  type HeatLatLngTuple = [number, number, number];

  interface HeatMapOptions {
    minOpacity?: number;
    maxZoom?: number;
    max?: number;
    radius?: number;
    blur?: number;
    gradient?: Record<number, string>;
  }

  interface HeatLayer extends Layer {
    setLatLngs(latlngs: HeatLatLngTuple[]): HeatLayer;
    setOptions(options: HeatMapOptions): HeatLayer;
    redraw(): HeatLayer;
  }

  function heatLayer(latlngs: HeatLatLngTuple[], options?: HeatMapOptions): HeatLayer;
}

declare module "leaflet.heat";
