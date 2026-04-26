import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "in.indevs.ciphora",
  appName: "Ciphora",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
