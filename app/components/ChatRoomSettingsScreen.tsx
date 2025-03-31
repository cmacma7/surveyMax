import React, { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  Button,
  Alert,
  TouchableOpacity
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import * as Crypto from "expo-crypto";
import Icon from "react-native-vector-icons/MaterialIcons";
import { t } from "../i18n/translations";
import { getAuthHeaders } from "../shared/utils"; // adjust path as needed

// Ensure SERVER_URL and HttpAuthHeader are imported or defined as needed.
const SERVER_URL = "https://b200.tagfans.com:5301";

const ChatRoomSettingsScreen = ({ route, navigation }) => {
  const { chatroomId, chatroomName } = route.params;
  const [newName, setNewName] = useState(chatroomName);
  const [inviteEmail, setInviteEmail] = useState("");
  const [removeEmail, setRemoveEmail] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Instead of individual booleans, use one state to track the active section.
  // Valid values: "updateName", "inviteUser", "removeUser", or null.
  const [activeSection, setActiveSection] = useState(null);

  const toggleSection = (section) => {
    if (activeSection === section) {
      setActiveSection(null);
    } else {
      setActiveSection(section);
    }
  };

  const handleUpdateName = async () => {
    if (newName.trim() === "") {
      Alert.alert(t("Error"), t("pleaseEnterValidChannelName"));
      return;
    }
    try {
      const HttpAuthHeader = await getAuthHeaders();  
      const response = await fetch(`${SERVER_URL}/api/update-channel`, {
        method: "POST",
        headers: HttpAuthHeader,
        body: JSON.stringify({ channelId: chatroomId, channelDescription: newName }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t("Error"), data.error || t("updateChannelNameFailed"));
        return;
      }
      Alert.alert(t("Success"), t("channelNameUpdated"));
      navigation.setParams({ chatroomName: newName });
    } catch (error) {
      console.error(error);
      Alert.alert(t("Error"), t("updateChannelNameError"));
    }
  };

  const handleInviteUser = async () => {
    if (inviteEmail.trim() === "") {
      Alert.alert(t("Error"), t("pleaseEnterEmailToInvite"));
      return;
    }
    try {
      const HttpAuthHeader = await getAuthHeaders();  
      const response = await fetch(`${SERVER_URL}/api/add-channel-admin`, {
        method: "POST",
        headers: HttpAuthHeader,
        body: JSON.stringify({ channelId: chatroomId, email: inviteEmail }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t("Error"), data.error || t("inviteUserFailed"));
        return;
      }
      Alert.alert(t("Success"), t("userInvited"));
      setInviteEmail("");
    } catch (error) {
      console.error(error);
      Alert.alert(t("Error"), t("inviteUserError"));
    }
  };

  const handleRemoveUser = async () => {
    if (removeEmail.trim() === "") {
      Alert.alert(t("Error"), t("pleaseEnterEmailToRemove"));
      return;
    }
    try {
      const HttpAuthHeader = await getAuthHeaders();  
      const response = await fetch(`${SERVER_URL}/api/add-channel-admin`, {
        method: "POST",
        headers: HttpAuthHeader,
        body: JSON.stringify({ channelId: chatroomId, email: removeEmail, deleteAdmin: "Yes" }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert(t("Error"), data.error || t("removeUserFailed"));
        return;
      }
      Alert.alert(t("Success"), t("userRemoved"));
      setRemoveEmail("");
    } catch (error) {
      console.error(error);
      Alert.alert(t("Error"), t("removeUserError"));
    }
  };

  const handleDeleteLocalMessages = async () => {
    try {
      const storageKey = `chat_${chatroomId}_messages`;
      const storedMessagesStr = await AsyncStorage.getItem(storageKey);
      if (!storedMessagesStr) {
        Alert.alert(t("Info"), "No local messages found.");
        return;
      }
      const storedMessages = JSON.parse(storedMessagesStr);
      const cutoffTime = selectedDate.getTime();

      const messagesToKeep = [];
      const messagesToDelete = [];
      for (const msg of storedMessages) {
        const msgTime = new Date(msg.createdAt).getTime();
        if (msgTime < cutoffTime) {
          messagesToDelete.push(msg);
        } else {
          messagesToKeep.push(msg);
        }
      }

      // Delete cached images for messages to delete.
      for (let i = 0; i < messagesToDelete.length; i++) {
        const msg = messagesToDelete[i];
        if (msg.image) {
          let filePath = msg.image;
          if (!msg.image.startsWith("file://")) {
            const directory = `${FileSystem.cacheDirectory}${chatroomId}/`;
            const filename = await Crypto.digestStringAsync(
              Crypto.CryptoDigestAlgorithm.SHA256,
              msg.image
            );
            filePath = `${directory}${filename}`;
          }
          try {
            const fileInfo = await FileSystem.getInfoAsync(filePath);
            if (fileInfo.exists) {
              await FileSystem.deleteAsync(filePath, { idempotent: true });
              console.log("Deleted cached image:", filePath);
            }
          } catch (error) {
            console.error("Error deleting cached image:", filePath, error);
          }
        }
      }

      // Save the remaining messages.
      await AsyncStorage.setItem(storageKey, JSON.stringify(messagesToKeep));
      Alert.alert(
        t("Success"),
        `Deleted ${messagesToDelete.length} messages before ${selectedDate.toLocaleDateString()}`
      );
    } catch (error) {
      console.error("Error deleting local messages:", error);
      Alert.alert(t("Error"), "Failed to delete local messages.");
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={{ fontSize: 24, textAlign: "center", marginVertical: 20 }}>
          {t("chatRoomSettings")}
        </Text>

        {/* Condensed Action Icons */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-around",
            marginVertical: 20,
          }}
        >
          <TouchableOpacity
            onPress={() => toggleSection("updateName")}
            style={{ alignItems: "center" }}
          >
            <Icon name="edit" size={28} color="#007AFF" />
            <Text style={{marginTop:5}}>{t("updateName")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => toggleSection("inviteUser")}
            style={{ alignItems: "center" }}
          >
            <Icon name="person-add" size={28} color="#007AFF" />
            <Text  style={{marginTop:5}}>{t("inviteUser")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => toggleSection("removeUser")}
            style={{ alignItems: "center" }}
          >
            <Icon name="person-remove" size={28} color="#007AFF" />
            <Text  style={{marginTop:5}}>{t("removeUser")}</Text>
          </TouchableOpacity>
        </View>

        {/* Expandable Section: Change Channel Name */}
        {activeSection === "updateName" && (
          <View style={{ marginBottom: 20 }}>
            <Text style={{ marginBottom: 10 }}>{t("changeChannelName")}</Text>
            <TextInput
              placeholder={t("newChannelName")}
              value={newName}
              onChangeText={setNewName}
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                padding: 10,
                marginBottom: 10,
                borderRadius: 5,
              }}
            />
            <Button title={t("updateName")} onPress={handleUpdateName} />
          </View>
        )}

        {/* Expandable Section: Invite User */}
        {activeSection === "inviteUser" && (
          <View style={{ marginBottom: 20 }}>
            <Text style={{ marginBottom: 10 }}>{t("inviteUser")}</Text>
            <TextInput
              placeholder={t("userEmail")}
              value={inviteEmail}
              onChangeText={setInviteEmail}
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                padding: 10,
                marginBottom: 10,
                borderRadius: 5,
              }}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button title={t("invite")} onPress={handleInviteUser} />
          </View>
        )}

        {/* Expandable Section: Remove User */}
        {activeSection === "removeUser" && (
          <View style={{ marginBottom: 20 }}>
            <Text style={{ marginBottom: 10 }}>{t("removeUser")}</Text>
            <TextInput
              placeholder={t("userEmail")}
              value={removeEmail}
              onChangeText={setRemoveEmail}
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                padding: 10,
                marginBottom: 10,
                borderRadius: 5,
              }}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button title={t("remove")} onPress={handleRemoveUser} />
          </View>
        )}

        {/* Separated Section: Delete Local Messages */}
        <View style={{ marginTop: 30, padding: 20, borderTopWidth: 1, borderColor: "#ccc" }}>
          <Text style={{ fontSize: 18, fontWeight: "bold", marginBottom: 10 }}>
            {t("deleteLocalMessagesTitle") || "Delete Local Messages"}
          </Text>
          <Text style={{ marginBottom: 10 }}>
            {t("deleteLocalMessagesDescription") ||
              "Select a date. All messages before this date (and their local images) will be deleted."}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10, marginTop: 10 }}>
            <View style={{ flex: 1, marginRight: 10 }}>
                <DateTimePicker
                value={selectedDate}
                mode="date"
                display="default"
                onChange={(event, date) => {
                    if (date) {
                    setSelectedDate(date);
                    }
                }}
                />
            </View>
            <Button
                title={t("deleteMessages") || "Delete Messages"}
                onPress={handleDeleteLocalMessages}
            />
            </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ChatRoomSettingsScreen;
