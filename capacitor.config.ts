import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'games.amelia.boardgames',
  appName: "Amelia's Games",
  // Kept separate from `dist`, which is what gets deployed to the web. The two
  // builds differ (this one bakes in VITE_SERVER_ORIGIN), so sharing an output
  // directory made shipping the wrong one a matter of build order.
  webDir: 'dist-android',
  server: {
    androidScheme: 'https',
  },
  // Cleartext and mixed content are not set here on purpose. They were
  // app-wide switches, on in the APK handed to friends, for the sake of LAN
  // testing. That allowance now lives in the debug build's
  // network_security_config.xml, so it cannot reach a release build.
};

export default config;
