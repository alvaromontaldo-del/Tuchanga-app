import type { LocationMapProps } from './locationMapTypes';
import { LocationMapOsmWebView } from './LocationMapOsmWebView';

export type { LocationMapGeo } from './locationMapTypes';

/** Android: OpenStreetMap en WebView (gratis, sin Google Maps SDK). */
export function LocationMap(props: LocationMapProps) {
  return <LocationMapOsmWebView {...props} />;
}
