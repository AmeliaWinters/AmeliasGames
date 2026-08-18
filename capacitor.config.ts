import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'games.amelia.boardgames',
  appName: "Amelia's Games",
  webDir: 'dist',
  android: {
    // The UI ships inside the APK over https://localhost, while the game
    // socket goes out to the deployed server — that counts as mixed content
    // unless we allow it.
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    // Lets the same APK also talk to a plain-http dev server on your LAN,
    // which is handy for testing before you deploy.
    cleartext: true,
  },
};

export default config;
