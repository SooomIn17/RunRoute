import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import MapView, {
  MapPressEvent,
  Marker,
  Polyline,
} from "react-native-maps";

const KAKAO_REST_API_KEY = process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY;

// 지도 좌표 타입 정의
type Coordinate = {
  latitude: number;
  longitude: number;
};

// 로컬 저장
type SavedRoute = {
  id: string;
  name: string;
  points: Coordinate[];
  routeCoordinates: Coordinate[];
  distance: number;
  createdAt: string;
};

export default function HomeScreen(){
  // 상태 관리
  const [points, setPoints] = useState<Coordinate[]>([]);
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null);
  const [targetDistance, setTargetDistance] = useState("");
  const [routeCoordinates, setRouteCoordinates] = useState<Coordinate[]>([]);
  const [routeDistance, setRouteDistance] = useState<number>(0);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [showSavedRoutes, setShowSavedRoutes] = useState(false);
  
  const mapRef = useRef<MapView>(null);

  // 저장된 코스 목록 불러오기
  const loadSavedRoutes = async () => {
    try {
      const saved = await AsyncStorage.getItem("savedRoutes");

      const routes: SavedRoute[] = saved
        ? JSON.parse(saved)
        : [];
      
      setSavedRoutes(routes);
    } catch (error) {
      console.log("Failed to load saved routes:", error);
    }
  };
  
  useEffect(() => {
    loadSavedRoutes();
  }, []);

  // 현재 위치 가져오기
  useEffect(() => {
    const getCurrentLocation = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        console.log("Location permission denied");
        return;
      }

      const location = await Location.getCurrentPositionAsync({});

      // 현재 위치
      setCurrentLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      // 처음부터 현재 위치 중심으로 열리기
      mapRef.current?.animateToRegion(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        1000
      );
    };

    getCurrentLocation();
  }, []);

  // 지도 터치 시 경유지 추가
  const handleMapPress = (event: MapPressEvent) => {
    const coordinate = event.nativeEvent.coordinate;
    setPoints((prev) => [...prev, coordinate]);

    // 경유지 변경 시 기존 실제 경로 초기화
    setRouteCoordinates([]);
    setRouteDistance(0);
  };

  // 두 좌표 사이 직선 거리 계산
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

  // 전체 경유지 직선 거리 합산
  const calculateTotalDistance = () => {
    let total = 0;

    for (let i = 0; i < points.length - 1; i++){
      total += calculateDistance(
        points[i], points[i+1]
      );
    }

    return total;
  };

  const totalDistance = calculateTotalDistance();   // 직선 기준 전체 거리

  // 목표 거리 계산
  const target = parseFloat(targetDistance);
  const remainingDistance = !isNaN(target) ? target - routeDistance : null;

  // 실제 도보 경로 계산(API 호출)
  const fetchRoute = async () => {
    if (points.length < 2) {
      console.log("At least two waypoints are required");
      return;
    }

    if (!KAKAO_REST_API_KEY) {
      console.log("Kakao REST API key is missing");
      return;
    }

    const origin = points[0];     // 출발지
    const destination = points[points.length - 1];    // 도착지
    const intermediatePoints = points.slice(1, -1);   // 중간 경유지

    // 경유지 최대 5개까지 지원
    if (intermediatePoints.length > 5) {
      console.log("Kakao walking route supports up to 5 waypoints");
      return;
    }

    // 요청 Query String 생성 (x: 경도, y: 위도)
    const params = new URLSearchParams({
      start_x:origin.longitude.toString(),
      start_y:origin.latitude.toString(),
      end_x:destination.longitude.toString(),
      end_y:destination.latitude.toString(),
      input_coord:"WGS84",
      output_coord:"WGS84",
      route_mode:"SHORTEST",
    });

    // 경유지 있으면 추가
    if (intermediatePoints.length > 0) {
      params.append("via_x", 
        intermediatePoints.map((point) => point.longitude).join(","));
      params.append("via_y",
        intermediatePoints.map((point) => point.latitude).join(","));
    }

    try {
      const response = await fetch(
        `https://dapi.kakao.com/v2/routing/walk?${params.toString()}`,
        {
          method:"GET",
          headers: {
            Authorization:`KakaoAK ${KAKAO_REST_API_KEY}`,
          },
        }
      );

      const data = await response.json();

      if(!response.ok) {
        console.log(
          "Kakao Routes API error:",
          JSON.stringify(data, null, 2)
        );
        return;
      }

      // 경로 탐색 실패 상태 확인
      if (data.status !== "OK") {
        console.log("No walking route found:", data.status);
        return;
      }

      const route = data.route;

      if (!route) {
        console.log("Route data is missing");
        return;
      }

      // 실제 도보 거리 저장(meter -> km)
      const totalDistance = route.properties?.totalDistance;

      if (typeof totalDistance === "number") {
        setRouteDistance(totalDistance / 1000);
      }

      // 실제 도보 경로 좌표 추출
      const coordinates:Coordinate[] = [];

      route.legs?.forEach((leg:any) => {
        leg.steps?.forEach((step:any) => {
          const pathPoints = step.path?.points;

          if (!Array.isArray(pathPoints)) {
            return;
          }

          pathPoints.forEach(
            ([longitude, latitude]:[number, number]) => {
              coordinates.push({
                latitude,
                longitude,
              });
            }
          );
        });
      });

      if (coordinates.length < 2) {
        console.log("Route coordinates are missing");
        return;
      }

      setRouteCoordinates(coordinates);
    } catch (error) {
      console.log("Kakao route request failed:",error);
    }
  };

  // 마지막 경유지 삭제
  const undoLastPoint = () => {
    setPoints((prev) => prev.slice(0, -1));

    // 경유지 변경 시 기존 실제 경로 초기화
    setRouteCoordinates([]);
    setRouteDistance(0);
  };

  // 전체 경로 초기화
  const resetRoute = () => {
    setPoints([]);
    setRouteCoordinates([]);
    setRouteDistance(0);
  };

  // 현재 코스 저장
  const saveRoute = async () => {
    if (routeCoordinates.length < 2) {
      console.log("저장할 경로가 없습니다.");
      return;
    }

    const newRoute: SavedRoute = {
      id:Date.now().toString(),
      name:`Route ${new Date().toLocaleString()}`,
      points,
      routeCoordinates,
      distance:routeDistance,
      createdAt:new Date().toISOString(),
    };

    try {
      const savedRoutes = await AsyncStorage.getItem("savedRoutes");

      const routes:SavedRoute[] = savedRoutes
        ? JSON.parse(savedRoutes)
        : [];
      
      const updatedRoutes = [...routes, newRoute];

      await AsyncStorage.setItem(
        "savedRoutes", JSON.stringify(updatedRoutes)
      );

      setSavedRoutes(updatedRoutes);

      console.log("Route saved:", newRoute);
    } catch (error) {
      console.log("Failed to save route:", error);
    }
  };

  // 저장된 코스 불러오기
  const loadRoute = (route: SavedRoute) => {
    setPoints(route.points);
    setRouteCoordinates(route.routeCoordinates);
    setRouteDistance(route.distance);

    setShowSavedRoutes(false);

    if(route.routeCoordinates.length > 0) {
      mapRef.current?.fitToCoordinates(
        route.routeCoordinates,
        {
          edgePadding: {
            top: 100,
            right: 50,
            bottom: 200,
            left: 50,
          },
          animated: true,
        }
      );
    }
  };

  // 저장된 코스 삭제
  const deleteRoute = async (routeId: string) => {
    try {
      const updatedRoutes = savedRoutes.filter(
        (route) => route.id !== routeId
      );

      await AsyncStorage.setItem("savedRoutes", JSON.stringify(updatedRoutes));

      setSavedRoutes(updatedRoutes);
    } catch (error) {
      console.log("Failed to delete route:", error);
    }
  };

  // UI
  return (
    <View style={styles.container}>
      {/* 지도 */}
      <MapView
          ref={mapRef}
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
        {/*선택한 경유지*/}       
        {points.map((point, index) => (
          <Marker
              key={index}
              coordinate={point}
              title={`Waypoint ${index + 1}`}
          />
        ))}

        {/*실제 도로 경로*/}
        {routeCoordinates.length >= 2 && (
          <Polyline
              coordinates={routeCoordinates}
              strokeWidth={4}
          />
        )}
        </MapView>

        {/*거리 정보*/}
        <View style={styles.distanceBox}>
          <Text style={styles.distanceLabel}>
            Estimated Distance
          </Text>

          <Text style={styles.distanceValue}>
            {routeDistance.toFixed(2)} km
          </Text>

          {/*경유지 개수*/}
          <Text style={styles.waypointText}>
            {points.length} waypoints selected
          </Text>
          
          {/*목표 거리 입력*/}
          <View style={styles.inputRow}>
            <TextInput
                style={styles.input}
                placeholder="Target distance (km)"
                keyboardType="decimal-pad"
                value={targetDistance}
                onChangeText={setTargetDistance}
            />

            <TouchableOpacity style={styles.doneButton} onPress={Keyboard.dismiss}>
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>

          {/*목표까지 남은 거리*/}
          {remainingDistance !== null && (
            <Text style={styles.remainingText}>
              {remainingDistance > 0
                ? `${remainingDistance.toFixed(2)} km remaining`
                : `${Math.abs(remainingDistance).toFixed(2)} km over target`}
            </Text>
          )}
        </View>

        {/*경로 제어 버튼*/}
        <View style={styles.bottomControls}>
          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.secondaryButton} onPress={undoLastPoint}>
              <Text style={styles.secondaryButtonText}>Undo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryButton} onPress={resetRoute}>
              <Text style={styles.secondaryButtonText}>Reset</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.buildRouteButton} onPress={fetchRoute}>
              <Text style={styles.buildRouteButtonText}>Build Route</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.saveRouteButton} onPress={saveRoute}>
            <Text style={styles.saveRouteButtonText}>Save Route</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.saveRouteButton} onPress={() => setShowSavedRoutes(true)}>
            <Text style={styles.saveRouteButtonText}>Saved Routes</Text>
          </TouchableOpacity>
        </View>

        {showSavedRoutes && (
          <View style={styles.savedRoutesPanel}>
            <View style={styles.savedRoutesHeader}>
              <Text style={styles.savedRoutesTitle}>Saved Routes</Text>

              <TouchableOpacity onPress={() => setShowSavedRoutes(false)}>
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </View>

          {savedRoutes.length === 0 ? (
            <Text style={styles.emptyText}>No saved routes</Text>
          ):(
            savedRoutes.map((route) => (
              <View
                  key={route.id}
                  style={styles.savedRouteItem}
              >
                <TouchableOpacity
                  style={styles.savedRouteContent} 
                  onPress={() => loadRoute(route)}
                >
                  <Text style={styles.savedRouteName}>{route.name}</Text>
                  <Text style={styles.savedRouteInfo}>{route.distance.toFixed(2)} km</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => deleteRoute(route.id)}
                >
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity> 
              </View>
            ))
          )}
          </View>
        )}
    </View>
  );
}

// 스타일
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

  waypointText: {
    marginTop: 6,
    fontSize: 13,
    color: "#666",
  },

  bottomControls: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    gap: 10,
  },

  buttonContainer: {
    flexDirection: "row",
    gap: 12,
  },

  secondaryButton: {
    flex: 1,
    backgroundColor: "white",
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    elevation: 4,
  },

  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },

  buildRouteButton: {
    backgroundColor: "#111",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    elevation: 5,
  },

  buildRouteButtonText: {
    color: "white",
    fontSize: 17,
    fontWeight: "700",
  },

  saveRouteButton: {
    backgroundColor: "white",
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: "center",
    elevation: 4,
  },

  saveRouteButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },

  input: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    fontSize: 16,
  },

  inputRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },

  doneButton: {
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#ccc"
  },

  doneButtonText: {
    fontWeight: "600",
  },

  savedRoutesPanel: {
    position: "absolute",
    top: 120,
    left: 20,
    right: 20,
    bottom: 180,
    backgroundColor: "white",
    borderRadius: 16,
    padding: 16,
    elevation: 8,
  },

  savedRoutesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },

  savedRoutesTitle: {
    fontSize: 20,
    fontWeight: "700",
  },

  closeButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },

  savedRouteItem: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingVertical: 12,
  },

  savedRouteContent: {
    flex: 1,
  },

  deleteButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },

  deleteButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },

  savedRouteName: {
    fontSize: 16,
    fontWeight: "600",
  },

  savedRouteInfo: {
    marginTop: 4,
    fontSize: 14,
    color: "#666",
  },

  emptyText: {
    textAlign: "center",
    marginTop: 20,
    color: "#666",
  },

  remainingText: {
    marginTop: 8,
    fontSize: 14,
  },
});