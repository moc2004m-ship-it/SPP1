# كيفاش تحول التطبيق لـ APK تجربو (عبر GitHub Actions)

## الفكرة
`Mobile/app` حاليًا Web shell (HTML/CSS/JS) خدام أصلاً، والـBackend
يسرفيه على `/app` (نفس الأصل متاع `/platform/api/*`). ما عنديش أنا
هنا (بيئة Claude) لا Android SDK ولا Gradle ولا وصول إنترنت باش نبني
APK فعلي بروحي — الحل العملي هو **Capacitor** (يلف الـweb app جوه
WebView Android حقيقي) + **GitHub Actions** يبنيه على سيرفرات GitHub
ويعطيك ملف `.apk` تحمّلو.

زدت 3 ملفات جداد بالمشروع (بلا ما نلمس أي كود Backend/Mobile موجود):
- `package.json` (روت) — dependencies متاع Capacitor بس
- `capacitor.config.json` — يقول لـCapacitor وين يلقى الـweb app
- `.github/workflows/build-apk.yml` — الـworkflow يلي يبني الـAPK

## خطوة 0 — لازم تختار: تجربة سريعة محلية، ولا نسخة حقيقية أونلاين؟

### أ) تجربة سريعة (بلا نشر Backend حقيقي)
شغّل الـBackend عندك بالحاسوب (`cd Backend && npm install && npm start`
— يخدم على منفذ 3000 افتراضيًا)، وسيّب `capacitor.config.json` كيفما
هو:
```json
"server": { "url": "http://10.0.2.2:3000/app", "cleartext": true }
```
`10.0.2.2` هو alias خاص بـAndroid Emulator يشاور على `localhost`
متاع حاسوبك. هذا يخدم **بس على Emulator**، مش على تليفون حقيقي.

لو تحب تجرب على **تليفون حقيقي** بنفس الواي فاي متاع حاسوبك، بدّل
السطر بـIP متاع حاسوبك بالشبكة المحلية (مثلاً):
```json
"server": { "url": "http://192.168.1.50:3000/app", "cleartext": true }
```
(لقى الـIP بـ`ipconfig` بويندوز أو `ifconfig`/`ip a` بلينكس/ماك).

### ب) نسخة حقيقية أونلاين (أفضل للتجربة الجدية)
انشر الـBackend على Render/Fly.io (نفس الخطوات المذكورة بـ`README.md`
الأصلي)، وبعدها بدّل `capacitor.config.json` بالرابط الحقيقي:
```json
"server": { "url": "https://your-backend.onrender.com/app", "cleartext": false }
```

**مهم:** بلا Backend شغال (محلي ولا أونلاين)، الـAPK يولي غير شاشة
"جاري الاتصال بالخادم…" بلا ما يخدم — لازم يكون فيه سيرفر يرد فعليًا.

## خطوة 1 — ارفع المشروع لـGitHub
لو ما عندكش Repo بعد:
```bash
git init
git add .
git commit -m "Add Capacitor Android wrapper + APK build workflow"
git remote add origin https://github.com/<اليوزر>/<اسم-الريبو>.git
git push -u origin main
```

## خطوة 2 — شغّل الـWorkflow
1. روح لـRepo متاعك على GitHub → تبويب **Actions**.
2. اختار **"Build Android APK (Capacitor wrapper, debug/testing)"**.
3. دوس **"Run workflow"** (زر أخضر، فوق يمين) → **Run workflow** مرة
   أخرى للتأكيد.
4. استنى شوية (2-5 دقايق) حتى يخلص (✅ أخضر).

## خطوة 3 — حمّل الـAPK
بنفس صفحة الـrun اللي خلصت، تحت **Artifacts**، تلقى
`liveroom-debug-apk` — دوس عليه يحمّلك ملف `.zip` فيه `app-debug.apk`.

## خطوة 4 — ركّبو بتليفونك
1. حوّل ملف الـAPK لتليفونك (Google Drive/USB/إلخ).
2. فعّل **"تثبيت من مصادر غير معروفة"** (Install unknown apps) بإعدادات
   Android للتطبيق اللي تحوّل بيه الملف (File Manager مثلاً).
3. دوس على الملف `.apk` → Install.

## ملاحظات صريحة
- هذا APK **debug فقط** للتجربة — مش موقّع بـkeystore إنتاجي، ما
  يصلحش للنشر بـGoogle Play بحالو (يحتاج خطوة signing إضافية وقتها).
- هذا **WebView wrapper** حول نفس الـweb app الموجود — ما بدّل حتى
  سطر بمنطق Backend ولا Mobile. لو تحب تطبيق React Native/Flutter
  حقيقي (نقاش القرار اللي مذكور بتقارير التدقيق السابقة)، هذا خطوة
  مختلفة تمامًا وأكبر بكثير.
- الصوت الحي (Agora) ومكتبات JS الخارجية لازم تخدم داخل WebView —
  ما جربتهاش بنفسي هنا (بلا إنترنت/جهاز حقيقي)، إذا صار مشكل بالصوت
  خصيصًا قولي نشوفو بالتفصيل.
