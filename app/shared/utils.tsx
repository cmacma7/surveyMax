// authHelper.js
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function getAuthHeaders() {
  const token = await AsyncStorage.getItem("userToken");
  const userId = await AsyncStorage.getItem("userId");
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "x-user-id": userId,
  };
}