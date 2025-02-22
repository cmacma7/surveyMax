import "react-native-get-random-values";
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Button,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  FlatList,
  Alert,
} from "react-native";
import { io } from "socket.io-client";
const socket = io("http://127.0.0.1:3000");

import * as ImagePicker from "expo-image-picker";
import { GiftedChat, IMessage } from "react-native-gifted-chat";
import Icon from "react-native-vector-icons/MaterialIcons";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
// NEW: Import AsyncStorage for token persistence.
import AsyncStorage from "@react-native-async-storage/async-storage";

// Configure the notification handler.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Helper function to register for push notifications.
async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'web') {
    console.log("Push notifications are not supported on web. Skipping registration.");
    return;
  }
  
  let token;
  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      alert("Failed to get push token for push notifications!");
      return;
    }
    token = (await Notifications.getExpoPushTokenAsync()).data;
    console.log("Expo Push Token:", token);
  } else {
    alert("Must use a physical device for Push Notifications");
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }
  return token;
}


// ------------------ ChatScreen ------------------
const ChatScreen: React.FC<any> = ({ route, navigation }) => {
  const { chatroomId, chatroomName, userId } = route.params;
  const [messages, setMessages] = useState<IMessage[]>([]);
 
  // Refs for notification listeners.
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
    console.log("Entered ChatRoom:", chatroomName, "ID:", chatroomId);
    // Even though the client joins all rooms in the list, we can call join here as well.
    // This ensures that if the ChatScreen is opened directly, the user is in this room.
    socket.emit("joinRoom", chatroomId);
    // Fetch saved/offline messages for this channel.
    fetch(`http://127.0.0.1:3000/api/messages/${chatroomId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.messages) {
          console.log("Fetched messages:", data.messages);
          setMessages(data.messages.reverse());
        }
      })
      .catch((err) => console.error(err));
  }, [chatroomId, chatroomName]);

  useEffect(() => {
    async function initPushNotifications() {
      const token = await registerForPushNotificationsAsync();
      if (token) {
        // Send the token along with userId to your backend.
        fetch("http://127.0.0.1:3000/api/register-push-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, token }),
        })
          .then((res) => res.json())
          .then((data) => console.log("Token registration response:", data))
          .catch((err) => console.error(err));
      }
    }
    initPushNotifications();

    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("Notification received:", notification);
      }
    );

    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log("Notification response received:", response);
      }
    );

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [userId]);

  useEffect(() => {
    const handleReceiveMessage = (incomingMessage: IMessage) => {
      // Only update the chat if the message belongs to the current room.
      if (incomingMessage.channelId === chatroomId) {
        setMessages((prev) => GiftedChat.append(prev, incomingMessage));
      }
    };
    socket.on("receiveMessage", handleReceiveMessage);
    return () => {
      socket.off("receiveMessage", handleReceiveMessage);
    };
  }, [chatroomId]);

  const onSend = (newMessages: IMessage[] = []) => {
    // Attach channelId (chatroomId) to the message.
    const messageWithChannel = { ...newMessages[0], channelId: chatroomId };
    setMessages((prev) => GiftedChat.append(prev, messageWithChannel));
    socket.emit("sendMessage", messageWithChannel);
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      base64: true,
    });
    if (!result.canceled && result.assets?.length) {
      const imageMessage: IMessage = {
        _id: Math.random().toString(36),
        createdAt: new Date(),
        user: { _id: userId, name: "User" },
        image: `data:image/jpeg;base64,${result.assets[0].base64}`,
        channelId: chatroomId, // include channelId for image messages too
      };
      onSend([imageMessage]);
    }
  };

  const renderCustomActions = () => (
    <TouchableOpacity onPress={pickImage} style={styles.actionButton}>
      <Icon name="image" size={28} color="#555" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1, marginBottom: 50 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <GiftedChat
          messages={messages}
          onSend={onSend}
          user={{ _id: userId }}
          placeholder="Type a message..."
          renderActions={renderCustomActions}
          listViewProps={{
            contentContainerStyle: styles.contentContainer,
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// ------------------ ChatroomListScreen ------------------
const ChatroomListScreen: React.FC<any> = ({ navigation, route }) => {
  // Modified: If route.params is undefined, try to load userId from AsyncStorage.
  const [storedUserId, setStoredUserId] = useState<string | null>(null);
  useEffect(() => {
    if (route.params && route.params.userId) {
      setStoredUserId(route.params.userId);
    } else {
      AsyncStorage.getItem("userId").then((id) => {
        if (id) setStoredUserId(id);
      });
    }
  }, [route.params]);

  const userId = storedUserId;
  const [chatrooms, setChatrooms] = useState<{ id: string; name: string }[]>([]);

  // Sample implementation to fetch chatrooms.
  const fetchChatrooms = async () => {
    // Replace with your API call.
    const sampleChatrooms = [
      { id: "1", name: "Survey Chatroom 1" },
      { id: "2", name: "Survey Chatroom 2" },
      { id: "3", name: "Survey Chatroom 3" },
    ];
    setChatrooms(sampleChatrooms);
  };

  useEffect(() => {
    fetchChatrooms();
  }, []);

  // Once chatrooms are fetched, join all rooms.
  useEffect(() => {
    chatrooms.forEach((room) => {
      socket.emit("joinRoom", room.id);
    });
  }, [chatrooms]);

  const renderItem = ({ item }: { item: { id: string; name: string } }) => (
    <TouchableOpacity
      style={styles.chatroomItem}
      onPress={() =>
        navigation.navigate("Chat", {
          chatroomId: item.id,
          chatroomName: item.name,
          userId,
        })
      }
    >
      <Text style={styles.chatroomName}>{item.name}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Available Chatrooms</Text>
      <FlatList
        data={chatrooms}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.chatroomList}
      />
    </SafeAreaView>
  );
};

// ------------------ LoginScreen ------------------
const LoginScreen: React.FC<any> = ({ navigation }) => {
  // Modified: Using email instead of username.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Modified: Actual login using the /api/login endpoint.
  // On success, store the token and userId so that the user remains logged in.
  const handleLogin = async () => {
    if (email.trim() === "" || password.trim() === "") {
      Alert.alert("Error", "Please enter both email and password");
      return;
    }
    try {
      const response = await fetch("http://127.0.0.1:3000/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert("Error", data.error || "Login failed");
        return;
      }
      // Store token and userId so user doesn't need to login next time.
      await AsyncStorage.setItem("userToken", data.token);
      await AsyncStorage.setItem("userId", data.userId);
      // Navigate to the ChatroomList screen and pass the userId.
      navigation.navigate("ChatroomList", { userId: data.userId });
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "An error occurred during login.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.loginContainer}>
        <Text style={styles.title}>Login</Text>
        <TextInput
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          style={styles.input}
          secureTextEntry
        />
        <Button title="Login" onPress={handleLogin} />
        {/* New: Buttons to navigate to Register and Forgot Password screens */}
        <View style={{ marginTop: 10 }}>
          <Button
            title="Create Account"
            onPress={() => navigation.navigate("Register")}
          />
          <Button
            title="Forgot Password"
            onPress={() => navigation.navigate("ForgotPassword")}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

// ------------------ RegisterScreen ------------------
const RegisterScreen: React.FC<any> = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState(1); // step 1: register, step 2: verify

  const handleRegister = async () => {
    if (email.trim() === "") {
      Alert.alert("Error", "Please enter email");
      return;
    }
    try {
      const response = await fetch("http://127.0.0.1:3000/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert("Error", data.error || "Registration failed");
        return;
      }
      Alert.alert("Success", "Verification email sent. Please check your email.");
      setStep(2);
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "An error occurred during registration.");
    }
  };

  const handleVerify = async () => {
    if (token.trim() === "" || password.trim() === "") {
      Alert.alert("Error", "Please enter token and password");
      return;
    }
    try {
      const response = await fetch("http://127.0.0.1:3000/api/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert("Error", data.error || "Verification failed");
        return;
      }
      Alert.alert("Success", "Email verified and password set. Please login.");
      navigation.navigate("Login");
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "An error occurred during email verification.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.loginContainer}>
        <Text style={styles.title}>Register</Text>
        {step === 1 && (
          <>
            <TextInput
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button title="Register" onPress={handleRegister} />
          </>
        )}
        {step === 2 && (
          <>
            <TextInput
              placeholder="Verification Token"
              value={token}
              onChangeText={setToken}
              style={styles.input}
              autoCapitalize="none"
            />
            <TextInput
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              style={styles.input}
              secureTextEntry
            />
            <Button title="Verify Email" onPress={handleVerify} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

// ------------------ ForgotPasswordScreen ------------------
const ForgotPasswordScreen: React.FC<any> = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [step, setStep] = useState(1); // step 1: request reset, step 2: reset password

  const handleRequestReset = async () => {
    if (email.trim() === "") {
      Alert.alert("Error", "Please enter email");
      return;
    }
    try {
      const response = await fetch("http://127.0.0.1:3000/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert("Error", data.error || "Failed to send reset email");
        return;
      }
      Alert.alert("Success", "Password reset email sent. Please check your email.");
      setStep(2);
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "An error occurred while requesting password reset.");
    }
  };

  const handleResetPassword = async () => {
    if (token.trim() === "" || newPassword.trim() === "") {
      Alert.alert("Error", "Please enter token and new password");
      return;
    }
    try {
      const response = await fetch("http://127.0.0.1:3000/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert("Error", data.error || "Reset password failed");
        return;
      }
      Alert.alert("Success", "Password has been reset. Please login.");
      navigation.navigate("Login");
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "An error occurred during password reset.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.loginContainer}>
        <Text style={styles.title}>Forgot Password</Text>
        {step === 1 && (
          <>
            <TextInput
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button title="Send Reset Email" onPress={handleRequestReset} />
          </>
        )}
        {step === 2 && (
          <>
            <TextInput
              placeholder="Reset Token"
              value={token}
              onChangeText={setToken}
              style={styles.input}
              autoCapitalize="none"
            />
            <TextInput
              placeholder="New Password"
              value={newPassword}
              onChangeText={setNewPassword}
              style={styles.input}
              secureTextEntry
            />
            <Button title="Reset Password" onPress={handleResetPassword} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

// ------------------ Navigation Setup ------------------
const Stack = createNativeStackNavigator();

const App: React.FC = () => {
  // NEW: Check AsyncStorage to determine initial route so user stays logged in.
  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const [storedUserId, setStoredUserId] = useState<string | null>(null);

  useEffect(() => {
    const checkLogin = async () => {
      const token = await AsyncStorage.getItem("userToken");
      const userId = await AsyncStorage.getItem("userId");
      if (token && userId) {
        setStoredUserId(userId);
        setInitialRoute("ChatroomList");
      } else {
        setInitialRoute("Login");
      }
    };
    checkLogin();
  }, []);

  if (!initialRoute) {
    return (
      <View style={styles.container}>
        <Text style={{ textAlign: "center", marginTop: 50 }}>Loading...</Text>
      </View>
    );
  }

  return (
      <Stack.Navigator initialRouteName={initialRoute}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen
          name="ChatroomList"
          component={ChatroomListScreen}
          options={{ title: "Chat Rooms" }}
          // NEW: Pass stored userId as initialParams if available.
          initialParams={{ userId: storedUserId }}
        />
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={({ route }) => ({ title: route.params.chatroomName })}
        />
        {/* New screens for registration and forgot password */}
        <Stack.Screen name="Register" component={RegisterScreen} options={{ title: "Register" }} />
        <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: "Forgot Password" }} />
      </Stack.Navigator>
  );
};

export default App;

// ------------------ Styles ------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  loginContainer: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 10,
    marginBottom: 10,
    borderRadius: 5,
  },
  title: {
    fontSize: 24,
    textAlign: "center",
    marginVertical: 20,
  },
  chatroomList: {
    padding: 20,
  },
  chatroomItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  chatroomName: {
    fontSize: 18,
  },
  actionButton: {
    padding: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  contentContainer: {
    paddingBottom: 10,
  },
});
