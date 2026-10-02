import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MapView, {
  MapPressEvent,
  Marker,
  Polyline,
} from "react-native-maps";

type Coordinate = {
  latitude: number;
  longitude: number;
};

export default function HomeScreen(){
  const [points, setPoints] = useState<Coordinate[]>([]);
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null);

  useEffect(() => {
    const getCurrentLocation = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        console.log("Location permission denied");
        return;
      }

      const location = await Location.getCurrentPositionAsync({});

      setCurrentLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
    };

    getCurrentLocation();
  }, []);

  const handleMapPress = (event: MapPressEvent) => {
    const coordinate = event.nativeEvent.coordinate;
    setPoints((prev) => [...prev, coordinate]);
  };

  const calculateDistance = (
    point1: Coordinate,
    point2: Coordinate
  ) => {
    const earthRadius = 6371;     // km

    const lat1 = (point1.latitude * Math.PI) / 180;
    const lat2 = (point2.latitude * Math.PI) / 180;

    const deltaLat = ((point2.latitude - point1.latitude) * Math.PI) /180;
    const deltaLon = ((point2.longitude - point1.longitude) * Math.PI) / 180;

    const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return earthRadius * c;
  };

  const calculateTotalDistance = () => {
    let total = 0;

    for (let i = 0; i < points.length - 1; i++){
      total += calculateDistance(
        points[i], points[i+1]
      );
    }

    return total;
  };

  const totalDistance = calculateTotalDistance();

  const undoLastPoint = () => {
    setPoints((prev) => prev.slice(0, -1));
  };

  const resetRoute = () => {
    setPoints([]);
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
          showsUserLocation={true}        // 현재 위치 표시
      >
        {currentLocation && (
          <Marker coordinate={currentLocation}
          />
        )}
        
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

        <View style={styles.distanceBox}>
          <Text style={styles.distanceLabel}>
            Estimated Distance
          </Text>

          <Text style={styles.distanceValue}>
            {totalDistance.toFixed(2)} km
          </Text>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={undoLastPoint}>
            <Text style={styles.buttonText}>Undo</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={resetRoute}>
            <Text style={styles.buttonText}>Reset</Text>
          </TouchableOpacity>
        </View>
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

  distanceBox: {
    position: "absolute",
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: "white",
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    elevation: 5,
  },

  distanceLabel: {
    fontSize: 14,
  },

  distanceValue: {
    marginTop: 4,
    fontSize: 24,
    fontWeight: "bold",
  },

  buttonContainer: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: "row",
    gap: 12,
  },

  button: {
    flex: 1,
    backgroundColor: "white",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    elevation: 5,
  },

  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});