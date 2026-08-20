/**
 * Clave opcional solo para **web** (Google Maps JavaScript API).
 * Android usa OpenStreetMap vía WebView (`LocationMap.android.tsx`) — no requiere esta variable.
 * iOS usa MapKit nativo (`LocationMap.ios.tsx`) — tampoco.
 */
export function getGoogleMapsWebApiKey(): string {
  return (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
}
