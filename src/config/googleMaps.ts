/**
 * Clave para Maps JavaScript API (solo web vía @react-google-maps/api).
 * En .env: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...
 * En Google Cloud Console: habilitar "Maps JavaScript API" y restringir por referrer en desarrollo/producción.
 */
export function getGoogleMapsWebApiKey(): string {
  return (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim();
}
