import type { CapacitorConfig } from "@capacitor/cli";

const liveReloadUrl = process.env.CAPACITOR_LIVE_RELOAD_URL;

const config: CapacitorConfig = {
  appId: "com.louishasashi.konglogame",
  appName: "KONGLOGAME",
  webDir: "dist",
  ...(liveReloadUrl
    ? { server: { url: liveReloadUrl, cleartext: true } }
    : {}),
};

export default config;
