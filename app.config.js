// app.config.js
const IS_PROD = process.env.EAS_BUILD_PROFILE === 'production';

// The package name must be consistent across all configurations
const packageName = 'com.shannarlly.mobileappolin';

export default {
  "expo": {
    "name": "Olin",
    "slug": "mobile_app",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/splash-icon-dark.png",
    "scheme": packageName, // Use the package name as the scheme for consistency
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": packageName, // Add bundleIdentifier for iOS
      "googleServicesFile": process.env.GOOGLE_SERVICES_PLIST,
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/splash-icon-dark.png",
        "backgroundColor": "#ffffff"
      },
      removeTestIds: false,
      "edgeToEdgeEnabled": true,
      "package": packageName, // Ensure package name is correct
      "googleServicesFile": process.env.GOOGLE_SERVICES_JSON,
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "https",
              "host": "olinlms.com",
              "pathPrefix": "/--/auth/callback"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    },
    "web": {
      "bundler": "metro",
      "output": "static",
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon-dark.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#ffffff"
        }
      ],
      "expo-sqlite",
      "expo-secure-store",
      "expo-web-browser",
      // Background sync notifications
      [
        "expo-notifications",
        {
          "icon": "./assets/images/splash-icon-dark.png",
          "color": "#ffffff",
          "sounds": []
        }
      ],
      // Add expo-build-properties for signing config
      [
        "expo-build-properties",
        {
          "android": {
            // This assumes you have a keystore.jks in your project root
            // and you've set the required environment variables in eas.json or your build environment
            "signingInfo": {
              "alias": process.env.ANDROID_KEYSTORE_ALIAS,
              "keystore": "./keystore.jks",
              "storePassword": process.env.ANDROID_KEYSTORE_PASSWORD,
              "keyPassword": process.env.ANDROID_KEYSTORE_PRIVATE_KEY_PASSWORD
            }
          }
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true
    },
    "extra": {
      "router": {
        "origin": IS_PROD ? "https://olinlms.com" : undefined
      },
      "eas": {
        "projectId": "824ee34b-3739-4280-82b8-dd7a8ba8e5ee"
      }
      // "eas": {
      //   "projectId": "3438c390-06db-4c15-a5ab-b41868009b2a"
      // }
      // "eas": {
      //   "projectId": "eeec91a6-0879-483f-bd94-fc0eb53e0c66"
      // }
      // "eas": {
      //   "projectId": "864813f8-e96b-4dc2-980a-f78f61b3a262"
      // }
      // "eas": {
      //   "projectId": "c02beff9-ba4a-4afb-91b0-b2fff90a38ab"
      // }
      // "eas": {
      //   "projectId": "f1b3f445-d766-4b2b-8b1a-5e486cc41470"
      // }
    }
  }
};
