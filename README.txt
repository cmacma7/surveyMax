To install the react native
https://expo.dev/accounts/cmacma77  is my expo account
follow:
https://reactnative.dev/docs/environment-setup

1. npx create-expo-app@latest
2. create your app
3. cd your new created app dir
4. follow the https://reactnative.dev/docs/environment-setup next steps to choose platform you need, and run the commands 


After you build your app

eas build --platform ios --profile development


You should see the QR Code to download the app, scan the QRCode on your development device.

Once you install the app, you should be able to enable the development mode. Before install, you might not see the mode under
Settings > Privacy & Security, scroll down to the Developer Mode
enable it.

Then you can run the app : You need to make sure the device and your development server running npx expo start on the same wifi network.
If PC/Mac of your development server are using LAN, and not on the same subnet, you will connect fail.


#####################
For the survey-max, you need to run the server.js under server directory. This server serve as the sockjs server, to dispatch messages.
You can use node sendMessage.js <message> <user>  to send a system message that broadcast to all the clients (devices) of sockjs.               
1. cd server    node server.js
2. cd /Users/chenma/mongodb-macos-aarch64-8.0.4/bin   ./mongod --dbpath ~/data/db
3. For development: under the root survey-max, npx expo start -c  to run already build expo, to rebuild   npx expo run:ios
4. if use real device, then   npx expo run:ios --device.  Remember to change the IP address in index.tsx, the SERVER_URL need to set to the server.
   *It seems we need to open XCode, and go under survey-max/ios directory, to open the project. 
    You can also build the project inside XCode, use Xcode to build and run under product menu, the code will upload to device, then you can npx expo start 
   *We use eas credentials to handle the push notification certification. So eas will handle the certification for us, suppose in the Expo server.
   *focus on surveyMax project, fill in all the necessary data, like general, Signing and Capabilities (and you need to add push notification and other features here)
   *after enabled push notification in Xcode, just rebuild in XCode, then Expo notification can work, otherwise, we won't get the Expo notification Key.
   when the iOS app of Expo open, it need to connect to the npx expo start  server, the IP address need to enter at the iOS app Expo menu at the bottom to connect. 
   * you can manage credentials by:  eas credentials

5. To deploy
   npx expo build:ios
   in XCode, go to the surveymax project, make sure signing and capabilities, release build has the push notification cap. 
   on production tab of Xcode, click archive.
   after upload, make sure to 
     https://appstoreconnect.apple.com/teams/69a6de84-62fe-47e3-e053-5b8c7c11a4d1/apps/6742369482/testflight/ios 
   to agree the encryption to activate the upload version.
  
