import fs from "node:fs";

function replaceOnce(text, needle, replacement, label) {
  if (text.includes(replacement)) return text;
  if (!text.includes(needle)) {
    throw new Error(`Could not find ${label}`);
  }
  return text.replace(needle, replacement);
}

function configureAndroid() {
  const path = "android/app/src/main/AndroidManifest.xml";
  let xml = fs.readFileSync(path, "utf8");

  const marker = `                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>`;

  const replacement = `                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- Kodiak native wallet return -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="kodiak" />
            </intent-filter>`;

  xml = replaceOnce(
    xml,
    marker,
    replacement,
    "Android launcher intent-filter",
  );

  fs.writeFileSync(path, xml);
  console.log("Configured Android kodiak:// deep link.");
}

function configureIOS() {
  const path = "ios/App/App/Info.plist";
  let plist = fs.readFileSync(path, "utf8");

  if (!plist.includes("<string>kodiak</string>")) {
    const marker = "</dict>\n</plist>";
    const addition = `\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleTypeRole</key>
\t\t\t<string>Editor</string>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>com.kodiak.launchpad</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>kodiak</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>`;

    plist = replaceOnce(
      plist,
      marker,
      addition,
      "iOS plist closing tags",
    );
  }

  fs.writeFileSync(path, plist);
  console.log("Configured iOS kodiak:// URL scheme.");
}

configureAndroid();
configureIOS();
