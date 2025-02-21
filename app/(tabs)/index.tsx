import "react-native-get-random-values";
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  Button,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from "react-native";
import { io } from "socket.io-client";
import * as ImagePicker from "expo-image-picker";
import { GiftedChat, IMessage } from "react-native-gifted-chat";
import Icon from "react-native-vector-icons/MaterialIcons";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

// Configure the notification handler so that notifications are displayed when received.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Establish Socket.IO connection.
const socket = io("http://127.0.0.1:3000");

// Helper function to register for push notifications.
async function registerForPushNotificationsAsync() {
  let token;
  if (Device.isDevice) {
    // Check current permissions.
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      // Request permissions if not already granted.
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      alert("Failed to get push token for push notifications!");
      return;
    }
    // Get the token.
    token = (await Notifications.getExpoPushTokenAsync()).data;
    console.log("Expo Push Token:", token);
  } else {
    alert("Must use a physical device for Push Notifications");
  }

  // Configure the Android notification channel.
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

const ChatScreen: React.FC = () => {
  const [messages, setMessages] = useState<IMessage[]>([]);
  // Generate a random user ID for demonstration purposes.
  const [userId] = useState<string>(Math.random().toString(36).substring(7));

  // Refs for notification listeners.
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  // Register for push notifications and set up notification listeners.
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

    // Listener triggered when a notification is received while the app is foregrounded.
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log("Notification received:", notification);
      }
    );

    // Listener triggered when the user interacts with a notification.
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

  // Listen for incoming messages via Socket.IO.
  useEffect(() => {
    socket.on("receiveMessage", (incomingMessage: IMessage) => {
      setMessages((prev) => GiftedChat.append(prev, incomingMessage));
    });
    return () => {
      socket.off("receiveMessage");
    };
  }, []);

  // Send a message using Socket.IO.
  const onSend = (newMessages: IMessage[] = []) => {
    setMessages((prev) => GiftedChat.append(prev, newMessages));
    if (newMessages[0]) {
      socket.emit("sendMessage", newMessages[0]);
    }
  };

  // Allow the user to pick an image from the gallery and send it.
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
      };
      onSend([imageMessage]);
    }
  };

  // Render a custom button for sending images.
  const renderCustomActions = () => (
    <TouchableOpacity onPress={pickImage} style={styles.actionButton}>
      <Icon name="image" size={28} color="#555" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Button title="Chat Room" onPress={() => {}} />
      </View>

      {/* Chat interface wrapped in KeyboardAvoidingView */}
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

export default ChatScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    paddingVertical: 12,
    backgroundColor: "#A1CEDC",
    alignItems: "center",
    justifyContent: "center",
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
