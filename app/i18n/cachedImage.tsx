// CachedImage.js
import React, { useState, useEffect } from "react";
import { Image, ActivityIndicator } from "react-native";
import * as FileSystem from "expo-file-system";
import * as Crypto from "expo-crypto";

const CachedImage = ({ source, style, resizeMode, chatroomId }) => {
  const [localUri, setLocalUri] = useState(null);

  useEffect(() => {
    if (!source || !source.uri) {
        console.warn("CachedImage: No valid source.uri provided");
        return;
    }    
    // If the URI is already a local file, skip caching.
    if (source.uri.startsWith("file://")) {
        setLocalUri(source.uri);
        return;
    }    
    async function loadImage() {
      try {
        // Create a directory path based on chatroomId
        const directory = `${FileSystem.cacheDirectory}${chatroomId}/`;
        // Check if the directory exists; if not, create it
        const dirInfo = await FileSystem.getInfoAsync(directory);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
        }
        // Generate a unique filename based on the image URI
        const filename = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          source.uri
        );
        // Use the chatroom-specific directory for the file path
        const localPath = `${directory}${filename}`;

        // Check if the file already exists
        const fileInfo = await FileSystem.getInfoAsync(localPath);
        if (fileInfo.exists) {
          setLocalUri(localPath);
        } else {
          // Download and save the file locally
          const { uri } = await FileSystem.downloadAsync(source.uri, localPath);
          setLocalUri(uri);
        }
      } catch (error) {
        console.error("Error caching image:", error);
      }
    }
    loadImage();
  }, [source.uri, chatroomId]);

  if (!localUri) {
    return (
      <ActivityIndicator
        style={style}
        size="small"
        color="#ccc"
      />
    );
  }
  return (
    <Image
      source={{ uri: localUri }}
      style={style}
      resizeMode={resizeMode || "contain"}
    />
  );
};

export default CachedImage;
