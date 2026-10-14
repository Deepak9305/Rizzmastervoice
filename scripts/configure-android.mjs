import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
const manifestPath = 'android/app/src/main/AndroidManifest.xml';
if (!existsSync(manifestPath)) throw new Error('Run npm run android:add first.');
let manifest = readFileSync(manifestPath, 'utf8');
if (!manifest.includes('android.permission.RECORD_AUDIO')) manifest = manifest.replace('</manifest>', '    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n</manifest>');
if (!manifest.includes('android.permission.MODIFY_AUDIO_SETTINGS')) manifest = manifest.replace('</manifest>', '    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />\n</manifest>');
if (!manifest.includes('android:usesCleartextTraffic')) manifest = manifest.replace('<application', '<application android:usesCleartextTraffic="false"');
manifest = manifest.replace('android:allowBackup="true"', 'android:allowBackup="false"');
writeFileSync(manifestPath, manifest);
const stringsPath = 'android/app/src/main/res/values/strings.xml';
const strings = readFileSync(stringsPath, 'utf8').replace(/<string name="app_name">.*?<\/string>/, '<string name="app_name">Rizzmaster Voice</string>').replace(/<string name="title_activity_main">.*?<\/string>/, '<string name="title_activity_main">Rizzmaster Voice</string>');
writeFileSync(stringsPath, strings);
// Android's own runtime is preserved. BridgeWebChromeClient handles runtime microphone permission.
console.log('Android voice permission and app identity configured.');
