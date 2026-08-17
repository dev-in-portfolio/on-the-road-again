# Android releases

The app update manifest is served at `/mobile/android/stable.json` and `/mobile/android/beta.json`. These endpoints read release metadata from Netlify environment variables and never contain signing material.

## Current stable release

- Version: `1.0.2`
- Build: `10002`
- Tag: `android-v1.0.2-stable`
- Release purpose: package the per-restaurant Google Maps route action and the bulk-route limit handling into the installed Android app.

The release workflow requires the existing signing lineage. It must be configured with:

- `OTRA_ANDROID_KEYSTORE_BASE64`
- `OTRA_ANDROID_KEYSTORE_PASSWORD`
- `OTRA_ANDROID_KEY_ALIAS`
- `OTRA_ANDROID_KEY_PASSWORD`

The build also requires `VITE_API_ORIGIN` to point at the deployed API. The stable manifest requires these Netlify variables after the signed APK is published:

- `OTRA_ANDROID_STABLE_APK_URL`
- `OTRA_ANDROID_STABLE_SHA256`
- `OTRA_ANDROID_STABLE_SIZE`
- `OTRA_ANDROID_STABLE_VERSION`
- `OTRA_ANDROID_STABLE_BUILD`
- optional `OTRA_ANDROID_STABLE_MINIMUM_BUILD`, `OTRA_ANDROID_STABLE_CRITICAL`, and `OTRA_ANDROID_STABLE_RELEASE_NOTES`

Do not generate a replacement keystore. Android updates only preserve the installed app and its data when the APK is signed by the same key lineage as the installed build.
