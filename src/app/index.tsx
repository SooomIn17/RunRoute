import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Alert, Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
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
  const [isBuildingRoute, setIsBuildingRoute] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [movingWaypointIndex, setMovingWaypointIndex] = useState<number | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
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
    
    // 마커 이동 모드라면 새 위치로 이동
    if (movingWaypointIndex !== null) {
      setPoints((prev) =>
        prev.map((point, index) =>
          index === movingWaypointIndex ? coordinate : point
        )
      );
      
      // 경유지 변경 시 기존 실제 경로 초기화
      setRouteCoordinates([]);
      setRouteDistance(0);

      setSelectedRouteId(null);           // 기존 저장 코스 선택 상태 해제
      setMovingWaypointIndex(null);       // 이동 모드 종료

      return;
    }

    // 일반 모드라면 새 경유지 추가
    setPoints((prev) => [...prev, coordinate,]);

    // 경유지 변경 시 기존 실제 경로 초기화
    setRouteCoordinates([]);
    setRouteDistance(0);

    setSelectedRouteId(null);       // 기존 저장 코스 선택 상태 해제
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
      setRouteError("Select at least two waypoints.");
      return;
    }

    if (!KAKAO_REST_API_KEY) {
      console.log("Kakao REST API key is missing");
      return;
    }

    const origin = points[0];                         // 출발지
    const destination = points[points.length - 1];    // 도착지
    const intermediatePoints = points.slice(1, -1);   // 중간 경유지

    // 경유지 최대 5개까지 지원
    if (intermediatePoints.length > 5) {
      console.log("Kakao walking route supports up to 5 waypoints");
      return;
    }

    // 로딩 시작/기존 오류 초기화
    setIsBuildingRoute(true);
    setRouteError("");

    // Query String 생성 (x: 경도, y: 위도)
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

    // 카카오 도보 경로 API 호출
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
        setRouteError("Failed to load walking route.");
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
        setRouteError("Route coordinates are missing.");
        return;
      }

      setRouteCoordinates(coordinates);     // 지도에 실제 경로 표시
    } catch (error) {
      setRouteError("Failed to build route.");
      console.log("Kakao route request failed:", error);
    } finally {
      setIsBuildingRoute(false);    // 성공/실패 관계없이 로딩 종료
    }
  };

  // 마지막 경유지 삭제
  const undoLastPoint = () => {
    setPoints((prev) => prev.slice(0, -1));

    // 경유지 변경 시 기존 실제 경로 초기화
    setRouteCoordinates([]);
    setRouteDistance(0);
    setSelectedRouteId(null);
  };

  // 전체 경로 초기화
  const resetRoute = () => {
    setPoints([]);
    setRouteCoordinates([]);
    setRouteDistance(0);
    setSelectedRouteId(null);
  };

  // 저장 버튼 클릭 시 이름 입력 팝업
  const handleSaveRoute = () => {
    if (routeCoordinates.length < 2) {
      console.log("저장할 경로가 없습니다.");
      return;
    }

    Alert.prompt("Save Route", "Enter a route name",
      [
        {
          text:"Cancel",
          style:"cancel",
        },
        {
          text:"Save",
          onPress: (name?: string) => {
            saveRoute(name ?? "");
          },
        },
      ],
      "plain-text",
      "",
      "default"
    );
  };
  // 현재 코스 저장
  const saveRoute = async (name: string) => {
    if (routeCoordinates.length < 2) {
      console.log("저장할 경로가 없습니다.");
      return;
    }

    const newRoute: SavedRoute = {
      id:Date.now().toString(),
      name:
        name.trim() !== ""
          ? name.trim()
          : `Route ${new Date().toLocaleString()}`,
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
    setSelectedRouteId(route.id);

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

  // 전체 경로 화면 안에 맞추기
  const fitRouteToScreen = () => {
    if (routeCoordinates.length === 0) {
      return;
    }

    mapRef.current?.fitToCoordinates(routeCoordinates, {
      edgePadding: {
        top: 120,
        right: 40,
        bottom: 260,
        left: 40,
      },
      animated: true,
    });
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
        {points.map((point, index) => {
          const isStart = index === 0;
          const isEnd = index === points.length - 1;
          const isMoving = movingWaypointIndex === index;

          return (
            <Marker
                key={index}
                coordinate={point}
                stopPropagation={true}
                onPress={() => {
                  setMovingWaypointIndex(index);
                }}
            >
              <View
                style={[
                  styles.customMarker,
                  isStart && styles.startMarker,
                  isEnd && styles.endMarker,
                  isMoving && styles.movingMarker,
                ]}
              >
                <Text style={styles.markerText}>
                  {isStart ? "S" : isEnd ? "E" : index + 1}
                </Text>
              </View>
            </Marker>   
          );
        })}

        {/*실제 도로 경로*/}
        {routeCoordinates.length >= 2 && (
          <Polyline
              coordinates={routeCoordinates}
              strokeWidth={4}
          />
        )}
        </MapView>

        {movingWaypointIndex !== null && (
          <View style={styles.moveWaypointBanner}>
            <Text style={styles.moveWaypointBannerText}>
              Moving Waypoint {movingWaypointIndex + 1}
            </Text>

            <Text style={styles.moveWaypointBannerSubText}>
              Tap a new location on the map
            </Text>
          </View>
        )}

        {/*거리 정보*/}
        <View style={styles.distanceBox}>
          <Text style={styles.summaryTitle}>Route Summary</Text>

          <Text style={styles.distanceValue}>
            {routeDistance.toFixed(2)} km
          </Text>

          {/*경유지 개수*/}
          <Text style={styles.waypointText}>
            {points.length} waypoints selected
          </Text>
          
          <View style={styles.divider}/>

          <Text style={styles.targetLabel}>Target Distance</Text>
          
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
                ? `${remainingDistance.toFixed(2)} km shorter than target`
                : remainingDistance < 0
                ? `${Math.abs(remainingDistance).toFixed(2)} km longer than target`
                : "Target distance matched"}
            </Text>
          )}
          
          {routeError !== "" && (
            <Text style={styles.errorText}>{routeError}</Text>
          )}
        </View>

        {/*경로 제어 버튼*/}
        <View style={styles.bottomControls}>
          <View style={styles.buttonRow}>
            <TouchableOpacity
                style={styles.tertiaryButton}
                onPress={undoLastPoint}>
                  <Text style={styles.tertiaryButtonText}>Undo</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.tertiaryButton}
                onPress={resetRoute}
            >
              <Text style={styles.tertiaryButtonText}>Reset</Text>
            </TouchableOpacity>
          </View>

          {/*메인 액션*/}
          <TouchableOpacity
            style={[
              styles.primaryButton,
              (points.length < 2 || isBuildingRoute) &&
                styles.disabledButton,
            ]}
            onPress={fetchRoute}
            disabled={points.length < 2 || isBuildingRoute}
          >
            <Text style={styles.primaryButtonText}>
              {isBuildingRoute ? "Building Route...":"Build Route"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.secondaryFullButton,
              routeCoordinates.length < 2 && styles.disabledButton,
            ]}
            onPress={fitRouteToScreen}
            disabled={routeCoordinates.length < 2}
          >
            <Text style={styles.secondaryFullButtonText}>View Full Route</Text>
          </TouchableOpacity>

          {/*저장 관련*/}
          <View style={styles.buttonRow}>
            <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleSaveRoute}
            >
              <Text style={styles.secondaryButtonText}>Save Route</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setShowSavedRoutes(true)}
            >
              <Text style={styles.secondaryButtonText}>Saved Routes</Text>
            </TouchableOpacity>
          </View>
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
                  style={[
                    styles.savedRouteItem,
                    selectedRouteId === route.id && styles.selectedRouteItem,
                  ]}
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

  moveWaypointBanner: {
    position: "absolute",
    top: 250,
    left: 20,
    right: 20,
    backgroundColor: "white",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
    zIndex: 100,
    elevation: 10,
  },

  moveWaypointBannerText: {
    fontSize: 15,
    fontWeight: "700",
  },

  moveWaypointBannerSubText: {
    marginTop: 2,
    fontSize: 12,
    color: "#666",
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

  summaryTitle: {
    fontSize: 14,
    fontWeight: "600",
  },

  distanceValue: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: "700",
  },

  waypointText: {
    marginTop: 6,
    fontSize: 13,
    color: "#666",
  },

  divider: {
    width: "100%",
    height: 1,
    backgroundColor: "#eee",
    marginVertical: 12,
  },

  targetLabel: {
    alignSelf: "flex-start",
    fontSize: 13,
    fontWeight: "600",
  },

  moveWaypointText: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },

  bottomControls: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    gap: 10,
  },

  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },

  primaryButton: {
    backgroundColor: "#111",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    elevation: 5,
  },

  primaryButtonText: {
    color: "white",
    fontSize: 17,
    fontWeight: "700",
  },

  secondaryFullButton: {
    backgroundColor: "white",
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ddd",
  },

  secondaryFullButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },

  secondaryButton: {
    flex: 1,
    backgroundColor: "white",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ddd",
    elevation: 3,
  },

  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },

  tertiaryButton: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },

  tertiaryButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },

  disabledButton: {
    opacity: 0.5,
  },

  buildRouteButtonText: {
    color: "white",
    fontSize: 17,
    fontWeight: "700",
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

  selectedRouteItem: {
    backgroundColor: "#f0f0f0",
    borderRadius: 10,
    paddingHorizontal: 10,
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

  errorText: {
    marginTop: 8,
    fontSize: 14,
    textAlign: "center",
  },

  customMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "white",
    borderWidth: 2,
    borderColor: "#777",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },

  startMarker: {
    borderColor: "#2E7D32",
    backgroundColor: "#E8F5E9",
  },

  endMarker: {
    borderColor: "#C62828",
    backgroundColor: "#FFEBEE"
  },

  movingMarker: {
    borderWidth: 3,
    borderColor: "#1565C0"
  },

  markerText: {
    fontSize: 14,
    fontWeight: "700",
  },
});