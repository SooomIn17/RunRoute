import { useState } from "react";
import { StyleSheet, View } from "react-native";
import MapView, {
  MapPressEvent,
  Marker,
  Polyline,
} from "react-native-maps";

type Coordinate = {
  latitude: number;
  longitude: number;
}
export default function HomeScreen(){
  const [points, setPoints] = useState<Coordinate[]>([]);

  const handleMapPress = (event: MapPressEvent) => {
    const coordinate = event.nativeEvent.coordinate;
    setPoints((prev) => [...prev, coordinate]);
  };

  return (
    <View style={styles.container}>
      <MapView
          style={styles.map}
          initialRegion={{
            latitude: 36.019,
            longitude: 129.3435,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          }}
          onPress={handleMapPress}
      >
        {points.map((point, index) => (
          <Marker
              key={index}
              coordinate={point}
              title={`Waypoint ${index + 1}`}
          />
        ))}

        {points.length >= 2 && (
          <Polyline
              coordinates={points}
              strokeWidth={4}
          />
        )}
        </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: "100%",
    height: "100%",
  },
});