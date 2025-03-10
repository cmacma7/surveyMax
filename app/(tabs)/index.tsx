import "react-native-get-random-values";
import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from "react";
import { useFocusEffect } from '@react-navigation/native';
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
  Dimensions,
} from "react-native";

const SERVER_URL = 'https://b200.tagfans.com:5301';
// const SERVER_URL = 'http://192.168.100.125:5300';
import { t, setLanguage } from "./translations";


import { io } from "socket.io-client";
const socket = io(SERVER_URL);

import * as ImagePicker from "expo-image-picker";
import { GiftedChat, IMessage, Send } from "react-native-gifted-chat";
import Icon from "react-native-vector-icons/MaterialIcons";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
// NEW: Import AsyncStorage for token persistence.
import AsyncStorage from "@react-native-async-storage/async-storage";




AsyncStorage.getItem("language").then((storedLang) => {
      if (storedLang) {
        setLanguage(storedLang);
       
      } else {
        // Default to Chinese if no language saved
        setLanguage("zh");
      
        AsyncStorage.setItem("language", "zh");
      }
    }).catch((err) => {
      console.error("Failed to load language", err);
    });



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
      alert(t('failedPushToken'));
      return;
    }
    token = (await Notifications.getExpoPushTokenAsync()).data;
    console.log("Expo Push Token:", token);
  } else {
    alert(t('mustUsePhysicalDevice'));
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
    fetch(`${SERVER_URL}/api/messages/${chatroomId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.messages) {
          console.log("Fetched messages:", data.messages);
          setMessages(data.messages.reverse());
        }
      })
      .catch((err) => console.error(err));

    const handleReconnect = () => {
      console.log("Socket reconnected. Rejoining room:", chatroomId);
      socket.emit("joinRoom", chatroomId);
    };
  
    socket.on("connect", handleReconnect);
  
    return () => {
      socket.off("connect", handleReconnect);
    };
    
  }, [chatroomId, chatroomName]);

  useEffect(() => {
    async function initPushNotifications() {
      const storedPushToken = await AsyncStorage.getItem("pushToken");
      if (!storedPushToken) {
        const token = await registerForPushNotificationsAsync();
        if (token) {
          await AsyncStorage.setItem("pushToken", token);
          // Send the token along with userId to your backend.
          fetch(`${SERVER_URL}/api/register-push-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, token }),
          })
            .then((res) => res.json())
            .then((data) =>
              console.log("Token registration response:", data)
            )
            .catch((err) => console.error(err));
        }
      } else {
        console.log("Push token already registered:", storedPushToken);
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

  // NEW: Add settings icon at top right of chat screen for channel settings.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() =>
            navigation.navigate("ChatRoomSettings", { chatroomId, chatroomName, userId })
          }
          style={{ marginRight: 10 }}
        >
          <Icon name="settings" size={28} color="#007AFF" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, chatroomId, chatroomName, userId]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1,  marginBottom: 51}} // the keyboard will cover the message input without this
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={-1000} // this will push up the chat area
      >
      
      {/* Inside your ChatScreen component's return statement: */}
      <GiftedChat
        messages={messages}
        onSend={onSend}
        user={{ _id: userId }}
        placeholder={t('typeMessage')}
        renderActions={renderCustomActions}
        textInputProps={{
          multiline: true,
          style: {
            // Fixed width so that the input doesn't occupy the entire space
            width: Dimensions.get("window").width * 0.8,
            minHeight: 40,
            maxHeight: 120,
            padding: 10,
            borderWidth: 1,
            borderColor: "#ccc",
            borderRadius: 5,
          },
        }}
        renderSend={(props) => (
          <Send {...props}>
            <View style={{ margin: 10 }}>
                <Icon name="send" size={28} color="#007AFF" />
              </View>
          </Send>
        )}
        
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
  const [storedUserEmail, setStoredUserEmail] = useState<string | null>(null);
  
  useEffect(() => {
    if (route.params) {
      if (route.params.userId) setStoredUserId(route.params.userId);
      if (route.params.email) setStoredUserEmail(route.params.email);
    } else {
      AsyncStorage.getItem("userId").then((id) => {
        if (id) setStoredUserId(id);
      });
      AsyncStorage.getItem("userEmail").then((email) => {
        if (email) setStoredUserEmail(email);
      });
    }
  }, [route.params]);

  const userIdentifier = useMemo(() => storedUserId || storedUserEmail, [storedUserId, storedUserEmail]);


  // Use userId if available; otherwise, fallback to email.
   
  const [chatrooms, setChatrooms] = useState<{ id: string; name: string }[]>([]);

  // NEW: Set headerRight with add chat room icon.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate("AddChatRoom", { userId: userIdentifier })}
          style={{ marginRight: 10 }}
        >
          <Icon name="add" size={28} color="#007AFF" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, userIdentifier]);

  // Sample implementation to fetch chatrooms from listAdmin endpoint.
  const [refreshing, setRefreshing] = useState(false);

  const fetchChatrooms = async () => {
    if (!userIdentifier) {
      console.log("No userId or email found.");
      return;
    }
    setRefreshing(true); // Start refreshing
    let payload = {};
    if (storedUserId) {
      payload["userId"] = storedUserId;
    } else {
      payload["email"] = storedUserEmail;
    }
    
    try {
      const response = await fetch(`${SERVER_URL}/api/list-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (response.ok && data.channels) {
      // Map channels to expected format: id and name.
        const formattedChannels = data.channels.map(channel => ({
          id: channel.channelId,
          name: channel.channelDescription || channel.channelId,
        }));
        setChatrooms(formattedChannels);
      } else {
        console.error("Error fetching admin channels:", data.error);
        setChatrooms([]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setRefreshing(false); // End refreshing
    }
  };

  useEffect(() => {
    fetchChatrooms();
  }, [userIdentifier]);

  useFocusEffect(
    React.useCallback(() => {
      fetchChatrooms();
    }, [userIdentifier])
  );

  // Additionally, set up a socket listener to handle real-time updates:
  useEffect(() => {
    if (!userIdentifier) {
      return;
    }
    const handleChatroomsUpdated = () => {
      fetchChatrooms();
    };
    socket.on("chatroomsUpdated", handleChatroomsUpdated);
    return () => {
      socket.off("chatroomsUpdated", handleChatroomsUpdated);
    };
  }, [userIdentifier]);


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
          userId: storedUserId
        })
      }
    >
      <Text style={styles.chatroomName}>{item.name}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{t('availableChatrooms')}</Text>
      <FlatList
        data={chatrooms}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.chatroomList}
        onRefresh={fetchChatrooms}      // Trigger refresh when pulling down
        refreshing={refreshing}          // Bind to the refreshing state        
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
      Alert.alert(t('Error'), t('pleaseEnterEmailPassword'));
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t('Error'), data.error || t('loginFailed'));
        return;
      }
      // Store token and userId so user doesn't need to login next time.
      await AsyncStorage.setItem("userToken", data.token);
      await AsyncStorage.setItem("userId", data.userId);
      await AsyncStorage.setItem("userEmail", email);
      // Navigate to the ChatroomList screen and pass the userId.
      navigation.navigate("ChatroomList", { userId: data.userId });
    } catch (err) {
      console.error(err);
      Alert.alert(t('Error'), t('loginError'));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Wrap login content with KeyboardAvoidingView to keep buttons visible when keyboard appears */}
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 20}
      >
        <View style={styles.loginContainer}>
          <Text style={styles.title}>{t('login')}</Text>
          <TextInput
            placeholder={t('email')}
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            placeholder={t('password')}
            value={password}
            onChangeText={setPassword}
            style={styles.input}
            secureTextEntry
          />
          <Button title={t('login')} onPress={handleLogin} />
        {/* New: Buttons to navigate to Register and Forgot Password screens */}
          <View style={{ marginTop: 10 }}>
            <Button
              title={t('createAccount')}
              onPress={() => navigation.navigate("Register")}
            />
            <Button
              title={t('forgotPassword')}
              onPress={() => navigation.navigate("ForgotPassword")}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
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
      Alert.alert(t('Error'), t('pleaseEnterEmail'));
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t('Error'), data.error || t('registrationFailed'));
        return;
      }
      Alert.alert(t('Success'), t('verificationEmailSent'));
      setStep(2);
    } catch (err) {
      console.error(err);
      Alert.alert(t('Error'), t('registrationError'));
    }
  };

  const handleVerify = async () => {
    if (token.trim() === "" || password.trim() === "") {
      Alert.alert(t('Error'), t('pleaseEnterTokenPassword'));
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/api/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t('Error'), data.error || t('verificationFailed'));
        return;
      }
      Alert.alert(t('Success'), t('emailVerified'));
      navigation.navigate("Login");
    } catch (err) {
      console.error(err);
      Alert.alert(t('Error'), t('emailVerificationError'));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.loginContainer}>
        <Text style={styles.title}>{t('register')}</Text>
        {step === 1 && (
          <>
            <TextInput
              placeholder={t('email')}
              value={email}
              onChangeText={setEmail}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button title={t('register')} onPress={handleRegister} />
          </>
        )}
        {step === 2 && (
          <>
            <TextInput
              placeholder={t('verificationToken')}
              value={token}
              onChangeText={setToken}
              style={styles.input}
              autoCapitalize="none"
            />
            <TextInput
              placeholder={t('password')}
              value={password}
              onChangeText={setPassword}
              style={styles.input}
              secureTextEntry
            />
            <Button title={t('verifyEmail')} onPress={handleVerify} />
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
      Alert.alert(t('Error'), t('pleaseEnterEmail'));
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/api/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t('Error'), data.error || t('failedSendResetEmail'));
        return;
      }
      Alert.alert(t('Success'), t('resetEmailSent'));
      setStep(2);
    } catch (err) {
      console.error(err);
      Alert.alert(t('Error'), t('forgotPasswordError'));
    }
  };

  const handleResetPassword = async () => {
    if (token.trim() === "" || newPassword.trim() === "") {
      Alert.alert(t('Error'), t('pleaseEnterTokenNewPassword'));
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/api/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t('Error'), data.error || t('resetPasswordFailed'));
        return;
      }
      Alert.alert(t('Success'), t('passwordResetSuccess'));
      navigation.navigate("Login");
    } catch (err) {
      console.error(err);
      Alert.alert(t('Error'), t('resetPasswordError'));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.loginContainer}>
        <Text style={styles.title}>{t('forgotPassword')}</Text>
        {step === 1 && (
          <>
            <TextInput
              placeholder={t('email')}
              value={email}
              onChangeText={setEmail}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button title={t('sendResetEmail')} onPress={handleRequestReset} />
          </>
        )}
        {step === 2 && (
          <>
            <TextInput
              placeholder={t('resetToken')}
              value={token}
              onChangeText={setToken}
              style={styles.input}
              autoCapitalize="none"
            />
            <TextInput
              placeholder={t('newPassword')}
              value={newPassword}
              onChangeText={setNewPassword}
              style={styles.input}
              secureTextEntry
            />
            <Button title={t('resetPassword')} onPress={handleResetPassword} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

// ------------------ AddChatRoomScreen ------------------
// NEW: Screen to add a new chat room (channel)
const AddChatRoomScreen: React.FC<any> = ({ navigation, route }) => {
  const [channelName, setChannelName] = useState("");

  const handleAddChatRoom = async () => {
    if (channelName.trim() === "") {
      Alert.alert(t('Error'), t('pleaseEnterChatRoomName'));
      return;
    }
    try {
      // Call /api/update-channel without channelId so server generates a new one.
      const response = await fetch(`${SERVER_URL}/api/update-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelDescription: channelName }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t('Error'), data.error || t('createChatRoomFailed'));
        return;
      }
      const newChannel = data.channel;
      // Call /api/add-channel-admin to add the new channel to the user's admin list.
      const userId = route.params?.userId;
      const adminResponse = await fetch(`${SERVER_URL}/api/add-channel-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: newChannel.channelId, userId }),
      });
      const adminData = await adminResponse.json();
      if (!adminResponse.ok) {
        Alert.alert(t('Error'), adminData.error || t('addChatRoomAdminFailed'));
        return;
      }
      Alert.alert(t('Success'), t('chatRoomCreated'));
      navigation.goBack();
    } catch (error) {
      console.error(error);
      Alert.alert(t('Error'), t('chatRoomCreationError'));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.loginContainer}>
        <Text style={styles.title}>{t('addChatRoom')}</Text>
        <TextInput
          placeholder={t('enterChatRoomName')}
          value={channelName}
          onChangeText={setChannelName}
          style={styles.input}
        />
        <Button title={t('createChatRoom')} onPress={handleAddChatRoom} />
      </View>
    </SafeAreaView>
  );
};

// ------------------ ChatRoomSettingsScreen ------------------
// NEW: Screen for chat room settings: change channel name, invite and remove users.
const ChatRoomSettingsScreen: React.FC<any> = ({ route, navigation }) => {
  const { chatroomId, chatroomName } = route.params;
  const [newName, setNewName] = useState(chatroomName);
  const [inviteEmail, setInviteEmail] = useState("");
  const [removeEmail, setRemoveEmail] = useState("");

  const handleChangeName = async () => {
    if (newName.trim() === "") {
      Alert.alert(t('Error'), t('pleaseEnterValidChannelName'));
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/api/update-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: chatroomId, channelDescription: newName }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t('Error'), data.error || t('updateChannelNameFailed'));
        return;
      }
      Alert.alert(t('Success'), t('channelNameUpdated'));
      navigation.setParams({ chatroomName: newName });
    } catch (error) {
      console.error(error);
      Alert.alert(t('Error'), t('updateChannelNameError'));
    }
  };

  const handleInviteUser = async () => {
    if (inviteEmail.trim() === "") {
      Alert.alert(t('Error'), t('pleaseEnterEmailToInvite'));
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/api/add-channel-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: chatroomId, email: inviteEmail }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t('Error'), data.error || t('inviteUserFailed'));
        return;
      }
      Alert.alert(t('Success'), t('userInvited'));
      setInviteEmail("");
    } catch (error) {
      console.error(error);
      Alert.alert(t('Error'), t('inviteUserError'));
    }
  };

  const handleRemoveUser = async () => {
    if (removeEmail.trim() === "") {
      Alert.alert(t('Error'), t('pleaseEnterEmailToRemove'));
      return;
    }
    try {
      const response = await fetch(`${SERVER_URL}/api/add-channel-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: chatroomId, email: removeEmail, deleteAdmin: "Yes" }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t('Error'), data.error || t('removeUserFailed'));
        return;
      }
      Alert.alert(t('Success'), t('userRemoved'));
      setRemoveEmail("");
    } catch (error) {
      console.error(error);
      Alert.alert(t('Error'), t('removeUserError'));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ padding: 20 }}>
        <Text style={styles.title}>{t('chatRoomSettings')}</Text>
        {/* Change Channel Name */}
        <Text style={{ marginTop: 10 }}>{t('changeChannelName')}</Text>
        <TextInput
          placeholder={t('newChannelName')}
          value={newName}
          onChangeText={setNewName}
          style={styles.input}
        />
        <Button title={t('updateName')} onPress={handleChangeName} />

        {/* Invite User */}
        <Text style={{ marginTop: 20 }}>{t('inviteUser')}</Text>
        <TextInput
          placeholder={t('userEmail')}
          value={inviteEmail}
          onChangeText={setInviteEmail}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Button title={t('invite')} onPress={handleInviteUser} />

        {/* Remove User */}
        <Text style={{ marginTop: 20 }}>{t('removeUser')}</Text>
        <TextInput
          placeholder={t('userEmail')}
          value={removeEmail}
          onChangeText={setRemoveEmail}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Button title={t('remove')} onPress={handleRemoveUser} />
      </View>
    </SafeAreaView>
  );
};

// ------------------ Navigation Setup ------------------
const Stack = createNativeStackNavigator();

const App: React.FC = () => {
  // Check AsyncStorage to determine initial route so user stays logged in.
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
        <Text style={{ textAlign: "center", marginTop: 50 }}>{t('loading')}</Text>
      </View>
    );
  }

  return (
      <Stack.Navigator initialRouteName={initialRoute}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen
          name="ChatroomList"
          component={ChatroomListScreen}
          options={{ 
            title: "Chat Rooms",
            // Hide the back button so the user can’t go back to Login.
            headerLeft: () => null 
          }}
          initialParams={{ userId: storedUserId }}
        />
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={({ route }) => ({ title: route.params.chatroomName })}
        />
        {/* New screens for registration, forgot password, add chat room, and chat room settings */}
        <Stack.Screen name="Register" component={RegisterScreen} options={{ title: t('register') }} />
        <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: t('forgotPassword') }} />
        <Stack.Screen name="AddChatRoom" component={AddChatRoomScreen} options={{ title: t('addChatRoom') }} />
        <Stack.Screen name="ChatRoomSettings" component={ChatRoomSettingsScreen} options={{ title: t('chatRoomSettings') }} />
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
