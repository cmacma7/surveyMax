import "react-native-get-random-values";
import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback} from "react";
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as FileSystem from 'expo-file-system';
import * as Crypto from "expo-crypto";

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
  useWindowDimensions,
  useColorScheme,
  Linking, 
} from "react-native";

import { useThemeColor } from '@/hooks/useThemeColor';
import { ThemedText } from "../../components/ThemedText";
import { ThemedView } from "../../components/ThemedView";
import { ThemedTextInput } from "../../components/ThemedTextInput";

const SERVER_URL = 'https://b200.tagfans.com:5301';
// const SERVER_URL = 'http://192.168.100.125:5300';


import Modal from "react-native-modal";
import ImageZoom from 'react-native-image-pan-zoom';
import { t, setLanguage } from "../i18n/translations";
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from "expo-router";
import { useNavigation, useLocalSearchParams } from 'expo-router';


// UI components
import CachedImage from '../components/CachedImage';
import ChatRoomSettingsScreen from "../components/ChatRoomSettingsScreen";

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
import { GiftedChat, IMessage, Send, Message, InputToolbar } from "react-native-gifted-chat";
import Icon from "react-native-vector-icons/MaterialIcons";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
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


  // handle image full screen view
  const [modalVisible, setModalVisible] = useState(false);
  const [fullScreenImageUri, setFullScreenImageUri] = useState("");
  const [scaleValue] = useState(new Animated.Value(0.5)); // initial scale value
  const [modalBackdropOpacity] = useState(new Animated.Value(1.0)); // initial opacity value


  // read/unread message divider
  const flatListRef = useRef<FlatList<any>>(null);
  const lastVisibleMessageRef = useRef<string | null>(null);   // Track the last visible message, the last message user is focus on
  const lastReadMessageRef = useRef<string | null>(null);  // Track the last read message, the last message of last enter the chat room
  const lastFechedMessageRef = useRef<string | null>(null);  // Track the last fetched message, the last message user has fetched from server

  // initial scroll done
  const initialScrollDone = useRef(false);

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
    // AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(updatedMessages));
    return (updatedMessages);
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
    // AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(updatedMessages));
    return (updatedMessages);
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
        lastReadMessageRef.current = await AsyncStorage.getItem(`chat_${chatroomId}_lastReadMessageId`);
        if (!lastReadMessageRef.current) {
          lastReadMessageRef.current = localMessages[0]?._id;
        }
        const tmpMessage = insertUnreadDivider(localMessages);
        setMessages(tmpMessage);
      }
    } catch (err) {
      console.error("Error loading local messages", err);
    }


    // Determine the reference timestamp
    let referenceTimestamp;
    let lastFetchedTimestamp;
    if (localMessages.length > 0) {
      referenceTimestamp   = localMessages[0]?.createdAt;
      lastFetchedTimestamp = localMessages[0]?.createdAt; // keep the last fetched timestamp in the local messages
    } else {
      // If there are no messages locally, try to get the last fetched timestamp
      referenceTimestamp = await AsyncStorage.getItem(`chat_${chatroomId}_lastFetchedTimestamp`);
      // Optionally, you can default to the current time to avoid loading older messages
      if (!referenceTimestamp) {
        const now = new Date();
        const threeMonthsAgo = new Date(now);
        threeMonthsAgo.setMonth(now.getMonth() - 3);
        console.log("first time fetch, fetch 3 month's data",threeMonthsAgo.toISOString());
        referenceTimestamp = threeMonthsAgo.toISOString();
      }
    }
    
    let url = `${SERVER_URL}/api/messages/${chatroomId}?after=${encodeURIComponent(referenceTimestamp)}`;
 


    try {
      const res = await fetch(url, { headers: HttpAuthHeader });
      const data = await res.json();
      if (data.messages && data.messages.length) {
        const newMessages = data.messages.reverse();
        const updatedMessages = GiftedChat.append(localMessages, newMessages);
        lastFetchedTimestamp = updatedMessages[0]?.createdAt;
        const finalMessages = insertUnreadDivider(updatedMessages);       
        setMessages(finalMessages);
        // await AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(updatedMessages));
      }

      if (lastFetchedTimestamp) {
        AsyncStorage.setItem(`chat_${chatroomId}_lastFetchedTimestamp`, lastFetchedTimestamp);
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

  // 1. Define the closeModal function:
  const closeModal = () => {
    Animated.parallel([
      Animated.timing(scaleValue, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(modalBackdropOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setModalVisible(false);
    });
  };

  // Animate when the modal is visible
  useEffect(() => {
    //console.log("modalVisible", modalVisible)
    if (modalVisible) {
      Animated.timing(scaleValue, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      // Reset scale for next time
      //scaleValue.setValue(0.5);
    }
  }, [modalVisible, scaleValue]);

  useEffect(() => {
    console.log("Entered ChatRoom:", chatroomName, "ID:", chatroomId);
    socket.emit("joinRoom", chatroomId);
    //loadAndFetchMessages();

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
      loadAndFetchMessages();
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



  // leave the chat room when the component is unmounted
  useEffect(() => {
    return () => {
      if (lastVisibleMessageRef.current) {
        AsyncStorage.setItem(`chat_${chatroomId}_lastVisableMessageId`, lastVisibleMessageRef.current)
          .catch((err) => console.error("Error saving last visible id", err));
      }
      if (lastFechedMessageRef.current) {
        AsyncStorage.setItem(`chat_${chatroomId}_lastReadMessageId`, lastFechedMessageRef.current)
          .catch((err) => console.error("Error saving last read id", err));
      }      
    };
  }, [chatroomId]);  

  // Use onViewableItemsChanged to track the bottom-most (read) message
  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    // Filter out divider items
    const visibleMsgs = viewableItems.filter(item => !item.item.isDivider);
    if (visibleMsgs.length > 0) {
      // In an inverted list, the last visible item in the array is the one at the beginning.
      const lastVisible = visibleMsgs[0];
      if (lastVisible?.item?._id) {
        lastVisibleMessageRef.current = lastVisible.item._id;
      }
    }
  }, []);

  const insertUnreadDivider = (msgs: IMessage[]): IMessage[] => {
    if (!lastReadMessageRef.current) return msgs;

    const visibleMsgs = msgs.filter(item => !item.isDivider); // remove all dividers
    const index = msgs.findIndex(msg => msg._id === lastReadMessageRef.current);
    if (index <= 0) return msgs;

    // Create a divider object (ensure its _id is unique and does not conflict)
    const divider = {
      _id: `divider_${lastReadMessageRef.current}`,
      isDivider: true,
      text: t('unreadMessages') // Use a translation or a fixed string such as "Unread messages"
    };
    // Insert the divider immediately before the last read message.
    visibleMsgs.splice(index, 0, divider);
    return visibleMsgs;
  };



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
          // AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(newMessages));
          return (newMessages);
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
      // AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(deduped));
      return (deduped);
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
    if (props.currentMessage.isDivider) {
      return (
        <ThemedView style={styles.unreadDivider}>
          <Text style={styles.unreadDividerText}>{props.currentMessage.text}</Text>
        </ThemedView>
      );
    }
    // Otherwise, render the normal message with resend/giveup UI as before:
    const isCurrentUser = props.currentMessage?.user?._id === props?.user?._id;
    return (
      <ThemedView style={{ flexDirection: 'column' }}>
        <Message {...props} />
        {(props.currentMessage.sendStatus === "failed" || props.currentMessage.sendStatus === "pending") && (
          <ThemedView
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
          </ThemedView>
        )}
      </ThemedView>
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
    if (messages.length > 0) {
      const visibleMsgs = messages.filter(item => !item.isDivider); // remove all dividers
      AsyncStorage.setItem(`chat_${chatroomId}_messages`, JSON.stringify(visibleMsgs));  
      lastFechedMessageRef.current = messages[0]?._id; 
    }
  }, [messages]);  
  
  useEffect(() => {
    if (flatListRef.current && !initialScrollDone.current) {      
      const dividerIndex = messages.findIndex(msg => msg.isDivider);
      if (dividerIndex !== -1 && flatListRef.current.scrollToIndex) {
        // Use a short delay to ensure the list is rendered.
        initialScrollDone.current = true; 
        setTimeout(() => {
          // Scroll to the divider index.
          const toIndex = Math.max(0, dividerIndex - 3); // Scroll to the message before the divider
          flatListRef.current?.scrollToIndex({ index: toIndex, animated: true });
        }, 500);
      }
    }
  }, [messages]);
  

  const sendIconColor = useThemeColor({ light: "#007AFF", dark: "#0A84FF" }, 'text');
  const sendContainerBackground = useThemeColor({ light: "#fff", dark: "#333" }, 'background');
  const inputTextColor = useThemeColor({ light: '#000', dark: '#fff' }, 'text');
  const inputBackground = useThemeColor({ light: '#fff', dark: '#333' }, 'background');

  const CustomInputToolbar = (props) => {
    const backgroundColor = useThemeColor({ light: '#fff', dark: '#333' }, 'background');
    
    return (
      <InputToolbar
        {...props}
        containerStyle={[props.containerStyle, { backgroundColor, borderTopColor: backgroundColor }]}
      />
    );
  };

// console.log("modalVisible --", modalVisible) 
// Add the Modal component (e.g., at the bottom of ChatScreen's return statement)
return (
  <>
  
    <SafeAreaView style={{flex:1, marginBottom: Platform.OS === "ios" ? 86 : 0}}>
      <KeyboardAvoidingView
        style={{ flex: 1}} // the keyboard will cover the message input without this
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={-500} // this will push up the chat area
      >
      
      {/* Inside your ChatScreen component's return statement: */}
      <GiftedChat
        messages={messages}
        onSend={onSend}
        user={{ _id: userId }}
        placeholder={t('typeMessage')}
        renderActions={renderCustomActions}
        renderMessage={renderMessage} // our custom renderer now handles divider messages
        renderInputToolbar={(props) => <CustomInputToolbar {...props} />}
        textInputProps={{
          multiline: true,
          style: {
            // Fixed width so that the input doesn't occupy the entire space
            width: Dimensions.get("window").width * 0.75,
            minHeight: 38,
            maxHeight: 120,
            color: inputTextColor,           // Dynamic text color
            backgroundColor: inputBackground, // Dynamic background color
            //padding: 0,
            //borderWidth: 1,
            //borderColor: "#ccc",
            //borderRadius: 5,
          },
        }}
        renderSend={(props) => (
          <Send {...props}>
            <ThemedView style={{ margin: 10, backgroundColor: sendContainerBackground }}>
              <Icon name="send" size={28} color={sendIconColor} />
            </ThemedView>
          </Send>
        )}
        listViewProps={{
          ref: flatListRef,
          onViewableItemsChanged: onViewableItemsChanged,
          viewabilityConfig: {
            itemVisiblePercentThreshold: 50,
          },
          contentContainerStyle: styles.contentContainer,
          keyboardShouldPersistTaps: 'handled',
        }}
        renderMessageImage={renderCustomImage}
      />
      </KeyboardAvoidingView>
     
    </SafeAreaView>
  

    <Modal
      isVisible={modalVisible}
      onBackdropPress={closeModal}
      style={{ margin: 0 }} // Ensures the modal occupies the full screen
      animationIn="fadeIn"
      animationOut="fadeOut"
      useNativeDriver
      hideModalContentWhileAnimating
      backdropColor="black"  // Use transparent since customBackdrop defines the color.
      backdropOpacity={1.0}
      customBackdrop={
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "black", opacity: modalBackdropOpacity },
          ]}
        />
      }
      onModalHide={() => {
        // Reset values only after modal has fully closed
        scaleValue.setValue(0.5);
        modalBackdropOpacity.setValue(1.0);
      }}
    >
      <TouchableWithoutFeedback onPress={closeModal}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: scaleValue }] }]}>
          {/* Close button at top left */}
          <TouchableOpacity
            onPress={closeModal}
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


// ********************************************************
// ------------------ ChatroomListScreen ------------------
const ChatroomListScreen: React.FC<any> = ({ navigation, route }) => {
  // Modified: If route.params is undefined, try to load userId from AsyncStorage.
  const [storedUserId, setStoredUserId] = useState<string | null>(null);
  const [storedUserEmail, setStoredUserEmail] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const borderColor = colorScheme === 'dark' ? '#444' : '#eee';
  const deepLinkUrlRef = useRef<string | null>(null);

  const [chatrooms, setChatrooms] = useState<{ id: string; name: string }[]>([]);


  // url scheme for deep linking
  const router = useRouter();
  // A helper function to parse and handle the incoming URL.
  const handleUrl = async (url) => {
    console.log("Deep link URL:", url);
    // Example URL formats:
    // surveyMax://chatroom?id=12345  --> go to a chat room screen
    // surveyMax://login?mode=reset     --> go to login/reset password screen
    try {
      const parsed = new URL(url);
      const path = parsed.hostname; // For URL "surveyMax://chatroom", hostname is "chatroom"
      const params = parsed.searchParams;

      // Get chatroom ID from query params
      const chatroomId = params.get("id");
      const userId = route.params.userId;
      
      if (path === "chatroom") {
 

        // Lookup the chatroom name from the state array.
        const room = chatrooms.find((item) => item.id === chatroomId);
        const chatroomName = room ? room.name : chatroomId;

       
        if (chatroomId) {
            navigation.navigate("Chat", {
              chatroomId: chatroomId,
              chatroomName: chatroomName, // pass a default or fetched name
              userId: userId,          // pass the current user id
            });
        } else {
          Alert.alert("Missing chatroom ID");
        }          
      } 
    } catch (error) {
      console.error("Error handling URL:", error);
    }
  };

  // Deep link listener; if chatrooms are not yet ready, store the URL in deepLinkUrlRef.
  useEffect(() => {
    const processDeepLink = (url: string) => {
      if (chatrooms.length === 0) {
        // Defer processing until chatrooms are loaded.
        deepLinkUrlRef.current = url;
      } else {
        handleUrl(url);
      }
    };

    // Check if the app was launched with a deep link.
    Linking.getInitialURL().then((url) => {
      if (url) {
        console.log("getInitialURL", url);
        processDeepLink(url);
      }
    });

    // Listen for incoming deep links while the app is running.
    const subscription = Linking.addEventListener("url", ({ url }) => {
      processDeepLink(url);
    });

    return () => {
      subscription.remove();
    };
  }, [chatrooms]); // Re-run effect when chatrooms change

  // When chatrooms finish loading, check if a deep link URL is pending.
  useEffect(() => {
    if (chatrooms.length > 0 && deepLinkUrlRef.current) {
      handleUrl(deepLinkUrlRef.current);
      deepLinkUrlRef.current = null;
    }
  }, [chatrooms]);


  useEffect(() => {
    const responseListener = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log("Notification response received:", response);
        // Assume the payload has a 'url' field in data.
        const url = response.notification.request.content.data.url;
        if (url) {
          // Handle the URL deep link.
          router.push(url);
        }
      }
    );
  
    return () => {
      Notifications.removeNotificationSubscription(responseListener);
    };
  }, [router]);

  // ---- End of deep linking setup ----








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
      style={[styles.chatroomItem,{ borderBottomColor: borderColor }]}
      onPress={() =>
        navigation.navigate("Chat", {
          chatroomId: item.id,
          chatroomName: item.name,
          userId: storedUserId
        })
      }
    >
      <ThemedText style={styles.chatroomName}>{item.name}</ThemedText>
    </TouchableOpacity>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container}>
        <ThemedText style={styles.title}>{t('availableChatrooms')}</ThemedText>
        <FlatList
          data={chatrooms}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.chatroomList}
          onRefresh={fetchChatrooms}      // Trigger refresh when pulling down
          refreshing={refreshing}          // Bind to the refreshing state        
        />
      </SafeAreaView>
    </ThemedView>
  );
};
// ********************************************************
// ------------------ LoginScreen -------------------------

const LoginScreen: React.FC<any> = ({ navigation }) => {
  // Modified: Using email instead of username.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");


  // Deep link handling inside LoginScreen
  useEffect(() => {
    const handleUrl = (url: string) => {
      try {
        const parsed = new URL(url);
        // For a link like "surveyMax://reset-password?token=890kdfkfjdfd00",
        // the hostname will be "reset-password".
        const path = parsed.hostname;
        if (path === "reset-password") {
          const resetToken = parsed.searchParams.get("token") || "";
          // Navigate to ForgotPassword screen, passing the reset token
          navigation.navigate("ForgotPassword", { resetToken });
        }
        else if (path === "login") {
          navigation.navigate("Login", { });
        }
      } catch (error) {
        console.error("Error parsing deep link URL:", error);
      }
    };

    // Check if the app was launched with a deep link.
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleUrl(url);
      }
    });

    // Listen for incoming deep links while the app is running.
    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleUrl(url);
    });

    return () => {
      subscription.remove();
    };
  }, [navigation]);


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
      navigation.reset({
        index: 0,
        routes: [{ name: 'ChatroomList', params: { userId: data.userId } }],
      });
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
        <ThemedView style={styles.loginContainer}>
          <ThemedText style={styles.title}>{t('login')}</ThemedText>
          <ThemedTextInput
            placeholder={t('email')}
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <ThemedTextInput
            placeholder={t('password')}
            value={password}
            onChangeText={setPassword}
            style={styles.input}
            secureTextEntry
          />
          <Button title={t('login')} onPress={handleLogin} />
        {/* New: Buttons to navigate to Register and Forgot Password screens */}
          <ThemedView style={{ marginTop: 10 }}>
            <Button
              title={t('createAccount')}
              onPress={() => navigation.navigate("Register")}
            />
            <Button
              title={t('forgotPassword')}
              onPress={() => navigation.navigate("ForgotPassword")}
            />
          </ThemedView>
        </ThemedView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// ********************************************************
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
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 20}
      >
        <ThemedView style={styles.loginContainer}>
          <ThemedText style={styles.title}>{t('register')}</ThemedText>
          {step === 1 && (
            <>
              <ThemedTextInput
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
              <ThemedTextInput
                placeholder={t('verificationToken')}
                value={token}
                onChangeText={setToken}
                style={styles.input}
                autoCapitalize="none"
              />
              <ThemedTextInput
                placeholder={t('password')}
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                secureTextEntry
              />
              <Button title={t('verifyEmail')} onPress={handleVerify} />
            </>
          )}
        </ThemedView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
// ********************************************************
// ------------------ ForgotPasswordScreen ------------------
const ForgotPasswordScreen: React.FC<any> = ({ navigation , route}) => {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [step, setStep] = useState(1); // step 1: request reset, step 2: reset password

  const resetToken = route?.params?.resetToken;
  if (resetToken && token != resetToken) setToken(resetToken);
  if (resetToken && step === 1) {    
    setStep(2);
  }

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
      <KeyboardAvoidingView
              style={styles.container}
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 20}
            >
        <ThemedView style={styles.loginContainer}>
          <ThemedText style={styles.title}>{t('forgotPassword')}</ThemedText>
          {step === 1 && (
            <>
              
                <ThemedTextInput
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
              <ThemedTextInput
                placeholder={t('resetToken')}
                value={token}
                onChangeText={setToken}
                style={styles.input}
                autoCapitalize="none"
              />
              <ThemedTextInput
                placeholder={t('newPassword')}
                value={newPassword}
                onChangeText={setNewPassword}
                style={styles.input}
                secureTextEntry
              />
              <Button title={t('resetPassword')} onPress={handleResetPassword} />
            </>
          )}
        </ThemedView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// **********************************************************
// ------------------ AddChatRoomScreen ------------------

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
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 20}
      >
        <ThemedView style={styles.loginContainer}>
          <ThemedText style={styles.title}>{t('addChatRoom')}</ThemedText>
          <ThemedTextInput
            placeholder={t('enterChatRoomName')}
            value={channelName}
            onChangeText={setChannelName}
            style={styles.input}
          />
          <Button title={t('createChatRoom')} onPress={handleAddChatRoom} />
        </ThemedView>
      </KeyboardAvoidingView>
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
      <ThemedView style={styles.container}>
        <ThemedText style={{ textAlign: "center", marginTop: 50 }}>{t('loading')}</ThemedText>
      </ThemedView>
    );
  }

  return (
      <Stack.Navigator initialRouteName={initialRoute}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen
          name="ChatroomList"
          component={ChatroomListScreen}
          options={({ navigation, route }) => ({
            title: t("chatRooms"),
            // Hide the left back button
            headerLeft: () => null,
            headerRight: () => (
              <TouchableOpacity
                onPressIn={() =>
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
                onPressIn={() =>
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
    flex: 1
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
  unreadDivider: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#e0e0e0',
    borderRadius: 12,
    marginVertical: 10,
  },
  unreadDividerText: {
    fontSize: 12,
    color: '#333',
  },
  
});
