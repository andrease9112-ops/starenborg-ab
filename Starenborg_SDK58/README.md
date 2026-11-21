# Starenborg mobilapp

Gemensamt React Native-projekt för Android och iPhone, baserat på kundflödet i version 1.6. Kunden kan fotografera flera kvitton i följd med bakre kameran, granska eller ta om varje foto och lägga till flera bilder och PDF-filer. Urvalet är tillfälligt och kan rensas när appen stängs. Största filstorlek är 15 MB per fil.

## Testa på en telefon

Använd Node.js 24 LTS. Installera beroendena med `npm ci` och starta projektet med `npm start`. Öppna QR-koden i Expo Go för SDK 58 på Android. På iPhone behövs ett eget signerat testbygge för SDK 58. Telefonen och datorn behöver kunna nå varandra på nätverket. Testa mot exempelbilder och kontrollera att kameran fortsätter efter ett sparat foto, att Ta om ersätter fotot, att fler än en bild eller PDF går att välja, och att en borttagen fil försvinner ur listan.

## Bygg fristående appar

Logga in med företagets Expo-konto med `npx eas-cli login`. Koppla sedan projektet till kontot med `npx eas-cli init`. Behåll paketnamnet `se.starenborg.kundapp` om Starenborg kan registrera det hos båda plattformarna.

- **Android:** `npx eas-cli build --platform android --profile preview` bygger en signerad APK för intern installation.
- **iPhone:** `npx eas-cli build --platform ios --profile preview` bygger för registrerade testenheter via ett Apple Developer-konto. Registrera testenheten enligt byggtjänstens instruktioner innan bygget.
- **Butik:** använd profilen `production` för AAB respektive iOS-produktionsbygge. Kundtest på iPhone kan sedan distribueras via TestFlight.

[Expo Go och SDK-versioner](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/) · [Signering och interna byggen](https://docs.expo.dev/build/internal-distribution/)

## Kundportalen

Appen använder portalens befintliga Supabase-inloggning och privata dokumentarkiv. Varje kundanvändare måste vara kopplad till sitt företag i portalens adminvy. Se STARTA_HAR.txt för test, integration i befintligt EAS-projekt och publicering.
