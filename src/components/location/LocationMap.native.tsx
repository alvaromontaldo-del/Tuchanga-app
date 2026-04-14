import MapView, { Circle, Marker, UrlTile } from 'react-native-maps';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { osmTileUrlTemplate } from '../../config/nominatim';
import { colors, radii, spacing } from '../../constants/theme';

export type LocationMapGeo = { lat: number; lng: number };

type Props = {
  geo: LocationMapGeo;
  coverageMeters: number;
  showCoverage: boolean;
  onPinMoved: (lat: number, lng: number) => void;
  onLocateMe?: () => void;
  locating?: boolean;
};

export function LocationMap({
  geo,
  coverageMeters,
  showCoverage,
  onPinMoved,
  onLocateMe,
  locating,
}: Props) {
  return (
    <View style={styles.wrap}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: geo.lat,
          longitude: geo.lng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        region={{
          latitude: geo.lat,
          longitude: geo.lng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        <UrlTile urlTemplate={osmTileUrlTemplate()} maximumZ={19} />
        <Marker
          coordinate={{ latitude: geo.lat, longitude: geo.lng }}
          draggable
          onDragEnd={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            onPinMoved(latitude, longitude);
          }}
        />
        {showCoverage && coverageMeters > 0 ? (
          <Circle
            center={{ latitude: geo.lat, longitude: geo.lng }}
            radius={coverageMeters}
            strokeColor="rgba(239, 68, 68, 0.55)"
            fillColor="rgba(239, 68, 68, 0.12)"
            strokeWidth={2}
          />
        ) : null}
      </MapView>

      <View style={styles.overlay}>
        <Pressable
          onPress={onLocateMe}
          disabled={!onLocateMe || locating}
          style={[styles.locateBtn, (!onLocateMe || locating) && styles.locateBtnDisabled]}
          hitSlop={10}
        >
          {locating ? (
            <ActivityIndicator color="#111827" />
          ) : (
            <Text style={styles.locateText}>Ubicarme</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
    borderRadius: radii.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  map: {
    width: '100%',
    height: 220,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    padding: spacing.md,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    pointerEvents: 'box-none',
  },
  locateBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  locateBtnDisabled: {
    opacity: 0.6,
  },
  locateText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#111827',
  },
});

