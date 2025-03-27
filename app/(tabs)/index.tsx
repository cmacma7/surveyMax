import "react-native-get-random-values";
import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback} from "react";
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
  Pressable,
  TouchableNativeFeedback, 
  Keyboard, 
  TouchableWithoutFeedback,
  useWindowDimensions 
} from "react-native";

const SERVER_URL = 'https://b200.tagfans.com:5301';
// const SERVER_URL = 'http://192.168.100.125:5300';


import Modal from "react-native-modal";
import ImageZoom from 'react-native-image-pan-zoom';
import { t, setLanguage } from "../i18n/translations";
import * as ImageManipulator from 'expo-image-manipulator';
import CachedImage from '../i18n/cachedImage';

import { Image } from "react-native";

// Inside ChatScreen component
import { ScrollView, Animated} from "react-native";



import { io } from "socket.io-client";



//const socket = io(SERVER_URL);
//const socket = io(SERVER_URL, {
//  transports: ['polling']
//});



const socketOptions = Platform.OS === 'android'
  ? {
      transports: ['polling'],
      // Disable the upgrade so it sticks with polling.
      upgrade: false,
      // The following options are passed to engine.io,
      // though note that the client-side polling interval isn’t always officially supported.
      transportOptions: {
        polling: {
          // For example, try setting a custom polling interval (in milliseconds)
          pollingInterval: 5000, // Adjust this value as needed
        }
      }
    }
  : {
      transports: ['websocket']
    };

const socket = io(SERVER_URL, socketOptions);




import * as ImagePicker from "expo-image-picker";
import { GiftedChat, IMessage, Send, Message } from "react-native-gifted-chat";
import Icon from "react-native-vector-icons/MaterialIcons";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
// NEW: Import AsyncStorage for token persistence.
import AsyncStorage from "@react-native-async-storage/async-storage";


const { width, height } = Dimensions.get("window");
const screen = Dimensions.get('screen');
// At the top of your file or inside your component:
const { width: screenWidth, height: screenHeight } = Dimensions.get("window");



var HttpAuthHeader = {};

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


// Helper function to generate the authentication header
const getAuthHeaders = async () => {
  const token = await AsyncStorage.getItem("userToken");
  const userId = await AsyncStorage.getItem("userId");
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "x-user-id": userId,
  };
};



// Helper function to register for push notifications.
async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'web') {
    console.log("Push notifications are not supported on web. Skipping registration.");
    return;
  }
  
  let token;
  console.log("check isDevice", Device.isDevice)
  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    
    let finalStatus = existingStatus;

    console.log(existingStatus)

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") {
      alert(t('failedPushToken'));
      return;
    }

    try {
      console.log("Geting token...");
      const tokenData = await Notifications.getExpoPushTokenAsync();
      token = tokenData.data;
      console.log("Expo Push Token:", token);
    } catch (error) {
      console.error("Error getting push token:", error);
    }
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


  // State to manage full screen view
  const [modalVisible, setModalVisible] = useState(false);
  const [fullScreenImageUri, setFullScreenImageUri] = useState("");
  const [scaleValue] = useState(new Animated.Value(0.8)); // initial scale value


// 1. --- Helper: update message status and persist ---
const updateMessageStatus = (messageId: string, status: "pending" | "failed" | "sent" | "giveup") => {
  setMessages((prevMessages) => {
    let updatedMessages = prevMessages.map((msg) => {
      if (msg._id === messageId) {
        if (status === "sent") {
          // Remove the sendStatus property once sent
          const { sendStatus, ...rest } = msg;
          return rest;
        } else {
          return { ...msg, sendStatus: status };
        }
      }
      return msg;
    });
    updatedMessages = deduplicateMessages(updatedMessages);
    // Persist updated messages without the sendStatus for sent messages.
    AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(updatedMessages));
    return updatedMessages;
  });
};


// 2. --- Resend / Give up Handlers ---
const handleResend = (message: IMessage) => {
  // Mark as pending again
  updateMessageStatus(message._id, "pending");
  socket.emit("sendMessage", message, (ack: any) => {
    if (ack && ack.error) {
      // If sending fails again, mark as failed.
      updateMessageStatus(message._id, "failed");
    } else {
      // Otherwise mark as sent.
      updateMessageStatus(message._id, "sent");
    }
  });
};

const handleGiveUp = (message: IMessage) => {
  setMessages((prevMessages) => {
    const updatedMessages = prevMessages.filter((msg) => msg._id !== message._id);
    AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(updatedMessages));
    return updatedMessages;
  });  
};


// helper function to deduplicate messages:
const deduplicateMessages = (msgs: IMessage[]): IMessage[] => {
  const messageMap: { [key: string]: IMessage } = {};
  msgs.forEach((msg) => {
    if (!messageMap[msg._id]) {
      messageMap[msg._id] = msg;
    } else {
      // Prefer the version marked as "sent" or the one with a later createdAt timestamp
      if (
        messageMap[msg._id].sendStatus !== "sent" &&
        msg.sendStatus === "sent"
      ) {
        messageMap[msg._id] = msg;
      } else if (new Date(msg.createdAt) > new Date(messageMap[msg._id].createdAt)) {
        messageMap[msg._id] = msg;
      }
    }
  });
  // Return messages sorted by createdAt descending
  return Object.values(messageMap);
};

  const loadAndFetchMessages = useCallback(async () => {
    let localMessages: IMessage[] = [];
    try {
      const saved = await AsyncStorage.getItem(`chat_${chatroomId}_messages`);
      if (saved) {
        localMessages = JSON.parse(saved);
        localMessages = deduplicateMessages(localMessages);
        setMessages(localMessages);
      }
    } catch (err) {
      console.error("Error loading local messages", err);
    }

    const lastMessage = localMessages[0];
    let url = `${SERVER_URL}/api/messages/${chatroomId}`;
    if (lastMessage && lastMessage.createdAt) {
      url += `?after=${encodeURIComponent(lastMessage.createdAt)}`;
    }

    try {
      const res = await fetch(url, { headers: HttpAuthHeader });
      const data = await res.json();
      if (data.messages && data.messages.length) {
        const newMessages = data.messages.reverse();
        const updatedMessages = GiftedChat.append(localMessages, newMessages);
        setMessages(updatedMessages);
        await AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(updatedMessages));
      }
    } catch (err) {
      console.error("Error fetching new messages", err);
    }
  }, [chatroomId]);


  // Function to open full screen image
  const openFullScreen = (uri) => {
    Keyboard.dismiss();
    setTimeout(() => {
      setFullScreenImageUri(uri);
      setModalVisible(true);
    }, 50); // Adjust the delay if needed
  };


  // Animate when the modal is visible
  useEffect(() => {
    if (modalVisible) {
      Animated.timing(scaleValue, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      // Reset scale for next time
      scaleValue.setValue(0.8);
    }
  }, [modalVisible, scaleValue]);

  useEffect(() => {
    console.log("Entered ChatRoom:", chatroomName, "ID:", chatroomId);
    socket.emit("joinRoom", chatroomId);
    loadAndFetchMessages();

    const handleReconnect = () => {
      console.log("Socket reconnected. Rejoining room:", chatroomId);
      socket.emit("joinRoom", chatroomId);
      loadAndFetchMessages();
    };
    socket.on("connect", handleReconnect);
    return () => {
      socket.off("connect", handleReconnect);
    };
  }, [chatroomId, chatroomName, loadAndFetchMessages]);
 

  useFocusEffect(
    useCallback(() => {
      //loadAndFetchMessages();
    }, [loadAndFetchMessages])
  );


  useEffect(() => {
    async function initPushNotifications() {
      console.log("init push notification")
      const storedPushToken = await AsyncStorage.getItem("pushToken");
      let token;
      if (!storedPushToken) {
        console.log("get token")
        token = await registerForPushNotificationsAsync();
        console.log("got token", token)
      }
      else {
        token = storedPushToken;
      }
     
      if (token && token!=storedPushToken) {      
        console.log("saving token to server")
        
        // Send the token along with userId to your backend.
        fetch(`${SERVER_URL}/api/register-push-token`, {
          method: "POST",
          headers: HttpAuthHeader,
          body: JSON.stringify({ userId, token }),
        })
          .then((res) => res.json())
          .then(async (data) => {
              console.log("Token registration response:", data);
              await AsyncStorage.setItem("pushToken", token);
            } 
          )
          .catch((err) => console.error(err));
        
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
      if (incomingMessage.channelId === chatroomId) {
        setMessages((prev) => {
          const exists = prev.find(msg => msg._id === incomingMessage._id);
          let newMessages;
          if (exists) {
            // Replace the old message with the new one and mark as sent
            newMessages = prev.map(msg => 
              msg._id === incomingMessage._id ? { ...incomingMessage, sendStatus: "sent" } : msg
            );
          } else {
            newMessages = GiftedChat.append(prev, { ...incomingMessage, sendStatus: "sent" });
          }
          newMessages = deduplicateMessages(newMessages);
          AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(newMessages));
          return newMessages;
        });
      }
    };
    socket.on("receiveMessage", handleReceiveMessage);
    return () => {
      socket.off("receiveMessage", handleReceiveMessage);
    };
  }, [chatroomId]);

  const onSend = (newMessages: IMessage[] = []) => {
    // Attach channelId and set initial sendStatus to pending.
    const messageWithChannel = { 
      ...newMessages[0], 
      channelId: chatroomId,
      sendStatus: "pending"  // new field to track sending status
    };
    setMessages((prev) => {
      // Remove any message with the same _id
      const filtered = prev.filter(msg => msg._id !== messageWithChannel._id);
      const newMsgList = GiftedChat.append(filtered, messageWithChannel);
      const deduped = deduplicateMessages(newMsgList);
      AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(deduped));
      return deduped;
    });
    // Create a copy of the message without sendStatus for transmission
    const { sendStatus, ...messagePayload } = messageWithChannel;
    console.log("sendMessage");
    socket.emit("sendMessage", messagePayload, (ack: any) => {
      console.log("sendMessage callback");
      if (ack && ack.error) {
        updateMessageStatus(messageWithChannel._id, "failed");
      } else {
        updateMessageStatus(messageWithChannel._id, "sent");
      }
    });
  };

  const pickImage = async () => {
    // Launch image picker to select an image from the device
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
    });
  
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      let localUri = asset.uri; // Use local URI immediately
  
      // Create a unique temporary message ID for tracking
      const tempMessageId = Math.random().toString(36).substr(2, 9);
  
      // Create a temporary message that shows the local image immediately.
      const tempMessage = {
        _id: tempMessageId,
        createdAt: new Date(),
        user: { _id: userId, name: "User" },
        image: localUri, // Local file path is used for now.
        channelId: chatroomId,
        temp: true, // Mark this message as temporary.
        sendStatus: "pending"  // new field to track sending status
      };
  
      // Insert the temporary message into the chat locally.
      setMessages((prevMessages) => GiftedChat.append(prevMessages, tempMessage));
  
      // Now run background work: scale (if needed) and upload the image.
      (async () => {
        try {
          // Scale the image if its width is greater than 1024.
          let finalUri = localUri;
          if (asset.width > 1024) {
            const manipResult = await ImageManipulator.manipulateAsync(
              localUri,
              [{ resize: { width: 1024 } }],
              { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
            );
            finalUri = manipResult.uri;
          }
  
          // Generate a unique key for the image using the chatroom id.
          const imageKey = `chat_images/${chatroomId}/${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}.jpg`;
  
          // Step 1: Request a presigned URL for uploading the image.
          const presignResponse = await fetch(
            `${SERVER_URL}/presigned-url/put?key=${encodeURIComponent(imageKey)}`
          );
          const presignData = await presignResponse.json();
          if (!presignResponse.ok || !presignData.signedUrl) {
            console.error("Failed to get upload URL");
            return;
          }
          const uploadUrl = presignData.signedUrl;
  
          // Step 2: Get the image file as a blob from the (possibly scaled) final URI.
          const fileResponse = await fetch(finalUri);
          const blob = await fileResponse.blob();
  
          // Step 3: Upload the blob to S3 using the presigned URL.
          const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            body: blob,
            headers: {
              "Content-Type": "image/jpeg",
            },
          });
          if (!uploadResponse.ok) {
            console.error("Image upload failed");
            return;
          }
  
          // Step 4: Construct the final S3 URL.
          const imageUrl = `https://tagfans-survey-image.s3.amazonaws.com/${imageKey}`;
  
          // Create the final message with the S3 URL.
          const finalMessage = {
            ...tempMessage,
            image: imageUrl,
            temp: false, // Mark as final.
          };
  
          // Send the final message via socket.io so that other devices receive it.
          socket.emit("sendMessage", finalMessage, (ack: any) => {
            if (ack && ack.error) {
              updateMessageStatus(tempMessageId, "failed");
            } else {
              updateMessageStatus(tempMessageId, "sent");
            }
          });
          // Replace the temporary message in local state with the final message.
          /*
          setMessages((prevMessages) =>
            prevMessages.map((msg) => (msg._id === tempMessageId ? finalMessage : msg))
          );
          */
        } catch (error) {
          console.error("Error during background image upload:", error);
          // Optionally: update the temporary message to indicate a failure.
        }
      })();
    }
  };
  
  
  

  const renderCustomActions = () => (
    <TouchableOpacity onPress={pickImage} style={styles.actionButton}>
      <Icon name="image" size={28} color="#555" />
    </TouchableOpacity>
  );


  // Then define a custom renderer:
  const renderMessage = (props: any) => {
    const isCurrentUser = props.currentMessage?.user?._id === props?.user?._id;
    return (
      <View style={{ flexDirection: 'column' }}>
        <Message {...props} />
        {(props.currentMessage.sendStatus === "failed" || props.currentMessage.sendStatus === "pending") && (
          <View
            style={[
              styles.resendContainer,
              isCurrentUser ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' },
            ]}
          >
            <TouchableOpacity onPress={() => handleResend(props.currentMessage)}>
              <Icon name="replay" size={20} color="red" style={styles.iconStyle} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleGiveUp(props.currentMessage)}>
              <Icon name="cancel" size={20} color="red" style={styles.iconStyle} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };
   


  const renderMessage1 = (props: any) => {
    // Check if the message is from the current user
    const isCurrentUser = props.currentMessage?.user?._id === props?.user?._id;
    
    return (
      <>
        <Message {...props} />
        { (props.currentMessage.sendStatus === "failed" || props.currentMessage.sendStatus === "pending") && (
          <View
            style={[
              styles.resendContainer,
              isCurrentUser ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' },
            ]}
          >
            <TouchableOpacity onPress={() => handleResend(props.currentMessage)}>
              <Icon name="replay" size={20} color="red" style={styles.iconStyle} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleGiveUp(props.currentMessage)}>
              <Icon name="cancel" size={20} color="red" style={styles.iconStyle} />
            </TouchableOpacity>
          </View>
        )}
      </>
    );
  };
  
  
  

  // Modify your renderCustomImage function:
  const renderCustomImage = (props) => {
    return (
      <TouchableOpacity onPress={() => openFullScreen(props.currentMessage.image)}>
        <CachedImage
          style={[{ width: 200, height: 150, borderRadius: 13 }]}
          source={{ uri: props.currentMessage.image }}
          resizeMode="contain"
          chatroomId={chatroomId}
        />
      </TouchableOpacity>
    );
  };

  useEffect(() => {
    AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(messages));
  }, [messages]);  

 
// Add the Modal component (e.g., at the bottom of ChatScreen's return statement)
return (
  <>
  
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1,  marginBottom: 51}} // the keyboard will cover the message input without this
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0} // this will push up the chat area
      >
      
      {/* Inside your ChatScreen component's return statement: */}
      <GiftedChat
        messages={messages}
        onSend={onSend}
        user={{ _id: userId }}
        placeholder={t('typeMessage')}
        renderActions={renderCustomActions}
        renderMessage={renderMessage}  // our custom message renderer
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
          keyboardShouldPersistTaps: 'handled',
        }}
        // Add custom image renderer
        renderMessageImage={renderCustomImage}
      />
      </KeyboardAvoidingView>
     
    </SafeAreaView>
  

    <Modal
      isVisible={modalVisible}
      onBackdropPress={() => setModalVisible(false)}
      style={{ margin: 0 }} // Ensures the modal occupies the full screen
      animationIn="fadeIn"
      animationOut="fadeOut"
      useNativeDriver
      hideModalContentWhileAnimating
      backdropColor="black"
      backdropOpacity={1}
    >
      <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: scaleValue }] }]}>
          {/* Close button at top left */}
          <TouchableOpacity
            onPress={() => setModalVisible(false)}
            style={{
              position: "absolute",
              top: 40,
              left: 20,
              zIndex: 1,
            }}
          >
            <Icon name="close" size={28} color="#fff" />
          </TouchableOpacity>
       
            <ImageZoom
              cropWidth={screenWidth}
              cropHeight={screenHeight}
              imageWidth={screenWidth}
              imageHeight={screenHeight}
            >          
        

              <CachedImage
                style={{
                  width: screen.width,
                  height: screen.height
                }}
                source={{ uri: fullScreenImageUri }}
                resizeMode="contain"
                chatroomId={chatroomId}
              />
          
          </ImageZoom>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  </>
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
    HttpAuthHeader = await getAuthHeaders();
    try {
      const response = await fetch(`${SERVER_URL}/api/list-admin`, {
        method: "POST",
        headers: HttpAuthHeader,
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

      HttpAuthHeader = await getAuthHeaders();

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
        headers: HttpAuthHeader,
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
        headers: HttpAuthHeader,
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
        headers: HttpAuthHeader,
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
        headers: HttpAuthHeader,
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
        headers: HttpAuthHeader,
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
        HttpAuthHeader = await getAuthHeaders();
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
          options={({ navigation, route }) => ({
            title: "Chat Rooms",
            // Hide the left back button
            headerLeft: () => null,
            headerRight: () => (
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate("AddChatRoom", { userId: route.params.userId })
                }
                style={{ paddingHorizontal: 10 }}
              >
                <Icon name="add" size={28} color="#007AFF" />
              </TouchableOpacity>
            ),
          })}
          initialParams={{ userId: storedUserId }}
        />

        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={({ route, navigation }) => ({
            title: route.params.chatroomName,
            headerRight: () => (
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate("ChatRoomSettings", {
                    chatroomId: route.params.chatroomId,
                    chatroomName: route.params.chatroomName,
                    userId: route.params.userId,
                  })
                }
                style={{ paddingHorizontal: 10 }}
              >
                <Icon name="settings" size={28} color="#007AFF" />
              </TouchableOpacity>
            ),
          })}
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
  resendContainer: {
    marginTop: 5,
    flexDirection: 'row',
    // No absolute positioning or fixed width here—this container will take the natural width of its parent.
  },
  iconStyle: {
    marginHorizontal: 5,
  },
});
