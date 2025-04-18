import React, { useState, useEffect } from 'react';
import { StyleSheet, Image, Platform, View, Button, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';

import { Collapsible } from '@/components/Collapsible';
import { ExternalLink } from '@/components/ExternalLink';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import * as Updates from 'expo-updates';

const SERVER_URL = 'https://b200.tagfans.com:5301';
const SURVEY_ADMIN_URL = 'https://b200.tagfans.com/surveyMax/admin.html';
// const SERVER_URL = 'http://192.168.100.125:5300';

import { t, setLanguage } from "../i18n/translations";

export default function TabTwoScreen() {
  const router = useRouter();
  const [lang, setLang] = useState("zh");
  const [userId, setUserId] = useState("");
  const [userToken, setUserToken] = useState("");
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    AsyncStorage.getItem("language").then((storedLang) => {
      if (storedLang) {
        setLanguage(storedLang);
        setLang(storedLang);
      } else {
        // Default to Chinese if no language saved
        setLanguage("zh");
        setLang("zh");
        AsyncStorage.setItem("language", "zh");
      }
    }).catch((err) => {
      console.error("Failed to load language", err);
    });

    const fetchData = async () => {
      try {
        const token = await AsyncStorage.getItem("userToken");
        const storedUserId = await AsyncStorage.getItem("userId");
        const storedEmail  = await AsyncStorage.getItem('userEmail');

        if (storedUserId) setUserId(storedUserId);
        if (token) setUserToken(token);
        if (storedEmail)  setUserEmail(storedEmail);

        console.log('survey admin url', SURVEY_ADMIN_URL + "?userId=" + storedUserId + "&userToken=" + token);
        if (!storedUserId || !token) {
          router.replace("/");
        }
      } catch (error) {
        console.error("Error reading AsyncStorage:", error);
        router.replace("/");
      }
    };

    fetchData();


  }, []);

  const updateLanguage = (newLang: string) => {
    setLanguage(newLang);
    setLang(newLang);
    AsyncStorage.setItem("language", newLang).catch((err) => {
      console.error("Failed to save language", err);
    });
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
  

      {/* 帳號資訊 */}
      <ThemedView style={{ padding: 16,  borderRadius: 8, marginVertical: 12 }}>
        <ThemedText type="title" style={{ marginBottom: 4 }}>帳號資訊</ThemedText>
        <ThemedText>Email: {userEmail}</ThemedText>
        <ThemedText>User ID: {userId}</ThemedText>
      </ThemedView>

      <Collapsible title={t('applications')}>
        <ThemedText>
          {t('applicationDescription')}
        </ThemedText>
        <ExternalLink href={SURVEY_ADMIN_URL+"?userId="+userId+"&userToken="+userToken}>
          <ThemedText type="link">{t('surveyAdmin')}</ThemedText>
        </ExternalLink>
      </Collapsible>


      <Collapsible title={t('languageSettings')}>
        <ThemedText>{t('chooseLanguage')}</ThemedText>
        <View style={styles.languageContainer}>
          <Button title="English" onPress={() => updateLanguage("en")} />
          <Button title="中文" onPress={() => updateLanguage("zh")} />
          <Button title="日本語" onPress={() => updateLanguage("ja")} />
        </View>
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

        

      {/* Logout button added here */}
      <ThemedView style={{ padding: 20 }}>
        <ThemedText
          onPress={() => {
            Alert.alert(
              t('Logout'),
              t('Confirm to logout your account'),
              [
                { text: t('cancel'), style: 'cancel' },
                { text: t('confirm'), onPress: async () => {
                    // Place your existing logout code here.
                    try {
                      const pushToken = await AsyncStorage.getItem("pushToken");
                      const userId = await AsyncStorage.getItem("userId");
                      if (pushToken && userId) {
                        const response = await fetch(`${SERVER_URL}/api/logout`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ userId, token: pushToken }),
                          credentials: "include"
                        });
                        if (!response.ok) {
                          console.error("Logout API failed with status:", response.status);
                          Alert.alert(t('logoutErrorTitle'), t('failedLogoutMessage'));
                          return;
                        }
                        await AsyncStorage.removeItem("pushToken");
                      }
                    } catch (error) {
                      console.error("Error during logout API call:", error);
                      Alert.alert(t('logoutErrorTitle'), t('logoutErrorMessage'));
                      return;
                    }
                    await AsyncStorage.removeItem("userToken");
                    await AsyncStorage.removeItem("userId");
                    if (Platform.OS === 'web') {
                      window.location.reload();
                    } else {
                      await Updates.reloadAsync();
                    }
                  }
                }
              ]
            );
          }}

          style={{ color: 'red', textAlign: 'left', paddingVertical: 10 }}
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
