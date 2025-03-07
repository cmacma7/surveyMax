import React, { useState } from 'react';
import { StyleSheet, Image, Platform, View, Button, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';

import { Collapsible } from '@/components/Collapsible';
import { ExternalLink } from '@/components/ExternalLink';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';

const SERVER_URL = 'https://b200.tagfans.com:5301';
// const SERVER_URL = 'http://192.168.100.125:5300';

import { t, setLanguage } from "./translations";

export default function TabTwoScreen() {
  const router = useRouter();
  const [lang, setLang] = useState("en");

  const updateLanguage = (newLang: string) => {
    setLanguage(newLang);
    setLang(newLang);
  };

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={
        <IconSymbol
          size={310}
          color="#808080"
          name="chevron.left.forwardslash.chevron.right"
          style={styles.headerImage}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">{t('explore')}</ThemedText>
      </ThemedView>
      <ThemedText>{t('exploreDescription')}</ThemedText>
      <Collapsible title={t('fileBasedRouting')}>
        <ThemedText>
          {t('fileBasedRoutingDescription')}
        </ThemedText>
        <ThemedText>
          {t('layoutFileDescription')}
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/router/introduction">
          <ThemedText type="link">{t('learnMore')}</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title={t('platformSupport')}>
        <ThemedText>
          {t('platformSupportDescription')}
        </ThemedText>
      </Collapsible>
      <Collapsible title={t('images')}>
        <ThemedText>
          {t('imagesDescription')}
        </ThemedText>
        <Image source={require('@/assets/images/react-logo.png')} style={{ alignSelf: 'center' }} />
        <ExternalLink href="https://reactnative.dev/docs/images">
          <ThemedText type="link">{t('learnMore')}</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title={t('customFonts')}>
        <ThemedText>
          {t('customFontsDescription')}
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/versions/latest/sdk/font">
          <ThemedText type="link">{t('learnMore')}</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title={t('lightDarkMode')}>
        <ThemedText>
          {t('lightDarkModeDescription')}
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/develop/user-interface/color-themes/">
          <ThemedText type="link">{t('learnMore')}</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title={t('animations')}>
        <ThemedText>
          {t('animationsDescription')}
        </ThemedText>
        {Platform.select({
          ios: (
            <ThemedText>
              {t('parallaxScrollViewDescription')}
            </ThemedText>
          ),
        })}
      </Collapsible>
      <Collapsible title={t('languageSettings')}>
        <ThemedText>{t('chooseLanguage')}</ThemedText>
        <View style={styles.languageContainer}>
          <Button title="English" onPress={() => updateLanguage("en")} />
          <Button title="中文" onPress={() => updateLanguage("zh")} />
          <Button title="日本語" onPress={() => updateLanguage("ja")} />
        </View>
      </Collapsible>
      {/* NEW: Logout button added here */}
      <ThemedView style={{ padding: 20 }}>
        <ThemedText
          onPress={async () => {
            try {
              const pushToken = await AsyncStorage.getItem("pushToken");
              const userId = await AsyncStorage.getItem("userId");
              if (pushToken && userId) {
                const response = await fetch(`${SERVER_URL}/api/logout`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ userId, token: pushToken }),
                });
                if (!response.ok) {
                  // Handle non-OK responses (e.g., server errors)
                  console.error("Logout API failed with status:", response.status);
                  Alert.alert(t('logoutErrorTitle'), t('failedLogoutMessage'));
                  return; // Stop the logout process if API call failed.
                }
                await AsyncStorage.removeItem("pushToken");
              }
            } catch (error) {
              console.error("Error during logout API call:", error);
              Alert.alert(t('logoutErrorTitle'), t('logoutErrorMessage'));
              return;
            }
            // Clear local tokens and navigate to login.
            await AsyncStorage.removeItem("userToken");
            await AsyncStorage.removeItem("userId");
            router.push("/login");
          }}
          style={{ color: 'red', textAlign: 'center', paddingVertical: 10 }}
        >
          {t('logout')}
      </ThemedText>
    </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute',
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  languageContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 10,
  },
});
