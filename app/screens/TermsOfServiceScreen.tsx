// src/screens/TermsOfServiceScreen.tsx
import React from 'react';
import {
  SafeAreaView,
  ScrollView,
  View,
  Button,
  Text,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function TermsOfServiceScreen({ navigation }) {
  const handleAccept = async () => {
    await AsyncStorage.setItem('acceptedEULA', 'true');
    navigation.replace('Login');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* scrolls only its content, won’t fill whole screen */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.text}>
          歡迎使用本應用。{'\n\n'}
          使用者同意不發布任何不當、辱罵或仇恨內容。違者將被移除帳號。{'\n\n'}
          1. 不得傳送色情、仇恨或歧視性文字。{'\n'}
          2. 不得騷擾、威脅或恐嚇他人。{'\n'}
          3. 違規內容將於24小時內被移除，發文者將被封鎖。
          {'\n\n'}
          本應用保留隨時修改或更新條款的權利。{'\n'}
          使用本應用即表示您同意遵守以上條款。{'\n\n'}
        </Text>

        <Button title="我已閱讀並同意" onPress={handleAccept} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    // space between scroll and button
    justifyContent: 'space-between',
  },
  scrollContent: {
    padding: 16,
  },
  text: {
    lineHeight: 24,
    fontSize: 16,
  },
  buttonContainer: {
    padding: 16,
    borderTopWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
  },
});
