# Stage 4 — TODO المؤجّل

بنفس تصنيف Stage 1/Stage 3: **الفئة أ** (قيد شبكة/بيئة تنفيذ حالية فقط،
مش قيد Stage 4 نفسها)، **الفئة ب** (قرار/حساب/بنية خارجية حقيقية لاحقة).

---

## الفئة أ — قيود بيئة التنفيذ الحالية (تُحل بـ `npm install` / متصفح حقيقي، بدون أي تعديل كود)

1. **`Backend/test/config.routes.test.js` لم يُشغَّل فعليًا.**
   نفس قيد `accounts.routes.test.js` من Stage 3 بالضبط: يحتاج
   `express` من `node_modules`، وده مش موجود في بيئة التنفيذ الحالية
   (بدون إنترنت). الكود جاهز ومنطقي (روجع سطر بسطر) وسيعمل فور
   `npm install` مرة واحدة.

2. **سلوك Splash/Onboarding تحت `file://` لم يُختبر في متصفح فعلي.**
   لا يوجد متصفح متاح في بيئة التنفيذ الحالية (Container بدون UI). فتح
   `Mobile/app/screens/splash/index.html` مباشرة (`file://`) قد يمنع
   بعض المتصفحات تحميل ملفات JSON محلية عبر `fetch()` (قيد CORS على
   `file://`). الكود يتعامل مع هذا صراحة (embedded fallback في
   `Localization/i18n.js` و`Mobile/app/config/config.client.js`) لكن
   لم يتم إثباته بلقطة شاشة حية. **الحل الموصى به وموثّق في
   `Mobile/app/README.md`:** تشغيل عبر أي static server بسيط
   (`npx serve .`) أو عبر بيئات Docker الموجودة أصلًا من Stage 1.

3. **اختبار حي لـ `GET /config` عبر HTTP فعلي (curl/متصفح).**
   نفس قيد #1 — يحتاج `npm install` أولاً.

---

## الفئة ب — قرارات/بنية خارجية حقيقية (Stage 5+ أو قرار منتج)

4. **مصدر Config الحقيقي على الـ Backend.**
   حاليًا Config Backend-side بيُقرأ من ملف محلي
   (`Backend/src/config/local-config.json`) وليس من قاعدة بيانات/لوحة
   تحكم. البنية (schema + service + route) جاهزة لاستقبال أي مصدر بديل
   بدون تغيير الـ Contract — لكن ربط قاعدة بيانات حقيقية أو Admin Panel
   قرار Stage 5+ خارج نطاق هذه المرحلة (ممنوع صراحة في تعليمات
   Stage 4).

5. **قاعدة بيانات/تخزين حقيقي لإكمال Onboarding على مستوى الجهاز.**
   `Mobile/app/state/onboarding-state.js` يستخدم `localStorage` (يعمل
   فعليًا في هذا الشكل Web-based الحالي)، مع fallback في الذاكرة لو
   `localStorage` غير متاح. لو اتقرر لاحقًا بناء تطبيق Native حقيقي
   (React Native/Flutter)، المطلوب استبدال طبقة التخزين فقط
   (AsyncStorage/SharedPreferences أو مكافئها) — بدون تغيير منطق الشاشة
   نفسه.

6. **توحيد Validation بين Backend و Client.**
   `Backend/src/config/config.schema.js` (Validation كامل) و
   `Mobile/app/config/config-shape.js` (فحص سطحي بسيط على الـ Client)
   مكرَّرين جزئيًا وبيتم صيانتهم يدويًا الاثنين. مقبول الآن لأنه لا يوجد
   Build Step مشترك بين Backend (CommonJS/Node) وMobile (ES Modules في
   المتصفح مباشرة بدون Bundler). لو اتضاف Bundler لاحقًا (Stage 5+)،
   يُفضَّل توحيدهم في مكتبة مشتركة واحدة.

7. **قرار إطار العمل النهائي للموبايل (نفس بند Stage 2 لسه مفتوح).**
   Splash/Onboarding هنا اتبنوا Web-based (HTML/JS + Web Components من
   DesignSystem) بنفس منطق `DesignSystem/screens/*`. لو اتقرر لاحقًا
   React Native/Flutter، المطلوب إعادة كتابة طبقة العرض فقط
   (Components/Screens) فوق نفس الـ Config Client ونفس الـ Localization
   Strings — مفيش تغيير في العقود (Contracts) بين الطبقات.

8. **رقم نسخة تطبيق حقيقي (`minimumSupported`/`latestRecommended`) وربطه
   بمنطق فعلي لإجبار تحديث.**
   Schema والـ Config جاهزين لحمل القيم (`version.minimumSupported`,
   `version.latestRecommended`) لكن لا يوجد منطق Client فعلي يقارن نسخة
   التطبيق الحالية بيهم ويجبر تحديث — قرار/سلوك يخص شاشة تطبيق فعلية
   لاحقة (Stage 5+)، ومربوط أصلًا بوجود متجر تطبيقات حقيقي (ممنوع صراحة
   هذه المرحلة).

9. **Base URL حقيقي للـ Backend من الـ Client.**
   `Mobile/app/config/config.client.js` بيعمل `fetch('/config')` نسبي
   (same-origin). ده تمام دلوقتي (لا يوجد Server خارجي مطلوب هذه
   المرحلة) لكن يحتاج Base URL صريح (staging/production) وقت وجود Deploy
   فعلي — TODO فقط، بدون أي Secret أو رابط حقيقي مكتوب الآن.

---

كل ما سبق **لا يمنع** استخدام/مراجعة/تشغيل بقية Stage 4 كما هي — هذه فقط
النقاط اللي محتاجة إنترنت/حساب خارجي/قرار منتج لاحق، وكلها مسجّلة هنا
بدل ما تتنفذ جزئيًا أو توهميًا.
