# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

## Publication Android et mises à jour

La version **Android Release** vérifie au lancement (et au retour au premier plan) :

`https://storage.googleapis.com/eau-cascade-assets/installers/mobile/android/latest.json`

Si `versionCode` en ligne est plus élevé, une fenêtre **dans l’app** propose **Mettre à jour** :
téléchargement interne, barre de progression, puis dialogue Android **Installer ?**.
Pas de lien navigateur, pas de fichier à retrouver. iOS n’est pas concerné.

Pour publier :

1. augmenter `expo.version` et `expo.android.versionCode` dans `app.json` ;
2. synchroniser la version de `package.json` ;
3. pousser un tag `mobile-vX.Y.Z`, ou lancer manuellement le workflow
   **Mobile Android - release to GCS**.

Le workflow exige une clé Android stable et les secrets :

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `GCP_PROJECT_ID` (`eau-cascade` uniquement)
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`

Publication locale après build :

```powershell
pwsh ../../infra/scripts/upload-mobile-apk.ps1 `
  -ApkPath ./android/app/build/outputs/apk/release/app-release.apk `
  -Notes "Résumé de la version"
```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
