export type LocationMapGeo = { lat: number; lng: number };

export type LocationMapProps = {
  geo: LocationMapGeo;
  coverageMeters: number;
  showCoverage: boolean;
  onPinMoved: (lat: number, lng: number) => void;
  onLocateMe?: () => void;
  locating?: boolean;
};
