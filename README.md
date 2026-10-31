# KONGLOGAME
Konglogame is a web-based game, which has a business, investment and assets theme.

Play Here!➡️➡️➡️
https://louishasashi-dev.github.io/KONGLOGAME/

display/preview⬇️⬇️⬇️
<img width="1917" height="877" alt="image" src="https://github.com/user-attachments/assets/56b5b766-3850-4839-b4fe-fe43b10cb0d8" />
<img width="641" height="892" alt="image" src="https://github.com/user-attachments/assets/2c76cc85-d063-47e9-a23e-8313c36614ec" />
<img width="642" height="883" alt="image" src="https://github.com/user-attachments/assets/5b402c61-0457-47a1-a8f9-a75b31cb24d9" />
<img width="692" height="819" alt="image" src="https://github.com/user-attachments/assets/6919167c-6d48-4591-b474-5b88f9827c82" />
<img width="714" height="775" alt="image" src="https://github.com/user-attachments/assets/d95dfc46-3e16-43c5-b368-186f1558be6c" />
<img width="692" height="665" alt="image" src="https://github.com/user-attachments/assets/fc99c6a2-632a-4fa7-8b7d-9c702fc56c17" />
<img width="706" height="834" alt="image" src="https://github.com/user-attachments/assets/18e331e5-269a-4af5-90cc-aa5405259b84" />
<img width="710" height="834" alt="image" src="https://github.com/user-attachments/assets/480282c1-32b5-4d07-833e-3ec6f1c7be49" />
<img width="701" height="839" alt="image" src="https://github.com/user-attachments/assets/2f3bbe68-7fdc-4987-a4d3-915fd569ac4b" />
<img width="1915" height="885" alt="image" src="https://github.com/user-attachments/assets/1df87f47-e02b-4826-b6de-f9d76dfc42dc" />

## Development & Production

Prasyarat: Node.js 22+ (Capacitor 8) dan dependency sudah terpasang.

### Development

```bash
npm run dev
```

Vite berjalan di `0.0.0.0:5173` (strict port). Buka `http://localhost:5173` atau `http://<IP-LAN>:5173` dari perangkat lain.

```bash
npm run preview   # preview hasil build
npm test          # 34 test otomatis
```

### Production

```bash
npm run build     # hasil build ada di dist/
npm run cap:sync  # build lalu sinkronkan dist/ ke platform Capacitor
```

Build production memakai `capacitor.config.ts` tanpa `server.url`, sehingga APK tidak mengarah ke dev server. Jangan set `CAPACITOR_LIVE_RELOAD_URL` saat membuat build/sync production.

### Live Reload (khusus development)

Live reload hanya aktif jika environment variable `CAPACITOR_LIVE_RELOAD_URL` di-set. Contoh PowerShell:

```powershell
npm run dev
$env:CAPACITOR_LIVE_RELOAD_URL = "http://192.168.1.10:5173"
npm run cap:sync
npx cap run android
Remove-Item Env:\CAPACITOR_LIVE_RELOAD_URL
```

Hapus environment variable tersebut sebelum sync production.

### Android

Platform Android belum dibuat (sesuai batasan proyek). Saat nanti ditambahkan dengan `npx cap add android`, atur orientasi Auto di `android/app/src/main/AndroidManifest.xml` pada activity utama:

```xml
android:screenOrientation="fullSensor"
```
