# Stage 6 (Home) — تقرير إنجاز نهائي (يحل محل STAGE6_STOP_REPORT.md)

**لا نسبة إنجاز مذكورة هنا عمداً.** هذا الملف يوثّق فقط ما تم تشغيله واختباره فعليًا. أي عبارة
"مكتمل" أدناه تعني: "بنفس معيار التحقق الذي طُبِّق على كل مرحلة سابقة في `STAGES_05_35_STATUS.md`
(node --check + node --test كامل + صفر regression)" — لا أكثر ولا أقل.

## 0. نقطة البداية (من STAGE6_STOP_REPORT.md)
عند التوقف، كان الجزء الخلفي (Backend) فقط جاهزًا: `rooms.discoverForHome()`، `rooms.categoryCounts()`،
`GET /api/home/rooms`، وإثراء `GET /api/home`. طبقة الواجهة (Mobile) لم تُلمس إطلاقًا. هذا الملف يوثّق
إكمال تلك الطبقة تحديدًا، بندًا بندًا مقابل قائمة "ما لم يبدأ" في القسم 3 من التقرير القديم.

## 1. ما تم إنجازه فعليًا هذه الجلسة، مقابل كل بند كان ناقصًا

| بند من STAGE6_STOP_REPORT.md § 3 | الحالة الآن | الدليل |
|---|---|---|
| ربط تبويبات (مباشر/متابعة/شعبي/جديد) في `home()` بـ `GET /api/home/rooms` | **تم** | `home()`/`bindHomeControls()` في `Mobile/app/app.js`؛ مختبَر في `app.home.stage6.test.js` (تست 1، 2) |
| صف الفئات (Categories) مربوط بـ `categories` الحقيقية | **تم** | نفس الملف؛ مختبَر في `app.home.stage6.test.js` (تست 3) |
| أقسام Games/Events/Rankings/Family/Search/Notifications داخل شاشة Home | **تم** | كل قسم يستدعي endpoint حقيقي موجود مسبقًا (`/api/games`, `/api/events` عبر `/api/home`, `/api/rankings/:type`, `/api/families`, `/api/search`, `/api/notifications/:userId`) |
| حالات loading/error/empty لكل قسم | **تم** | `loadHomeSection()` — نص تحميل حقيقي، ثم النتيجة الحقيقية أو رسالة خطأ حقيقية تتضمن `e.message`، لا حالة وهمية؛ مختبَر صراحة في تست "الفشل الحقيقي" (`app.home.stage6.test.js`) |
| Route-contract test لـ `GET /api/home/rooms` و`GET /api/home` المُثرى | **تم** | `Backend/test/platform.home.stage6.routes-contract.test.js` — 4 تستات جديدة |
| تست Mobile جديد لواجهة Stage 6 | **تم** | `Mobile/app/test/app.home.stage6.test.js` — 6 تستات جديدة |
| تحديث `STAGES_05_35_STATUS.md` | **تم** | قسم "Stage 6 (Home) completion" أُضيف في نهاية الملف |
| `STAGE6_FINAL_REPORT.md` | **تم** | هذا الملف |

## 2. التحقق المُشغَّل فعليًا (نتائج حقيقية، ليست مذكورة من الذاكرة)

```
node --check Backend/src/routes/platform.routes.js        → OK
node --check Backend/src/feature-platform.js               → OK
node --check Mobile/app/app.js                              → OK
node --check Backend/test/platform.home.stage6.routes-contract.test.js  → OK
node --check Mobile/app/test/app.home.stage6.test.js        → OK

Backend: node --test test/*.test.js  → 828 تست / 824 pass / 4 fail بيئي
  (نفس الأربعة الدائمة بالضبط: accounts/agora/auth/config routes.test.js،
  Cannot find module 'express'، لا شبكة npm install في هذه البيئة — صفر جديد)
  → أُعيد التشغيل 3 مرات متتالية لتأكيد الاستقرار: 824/828 في كل مرة.

Mobile: node --test test/*.test.js  → 40/40 pass
  (34 تست سابق + 6 تستات Stage 6 جديدة)
  → أُعيد التشغيل مرتين لتأكيد الاستقرار: 40/40 في كل مرة.
```

**ملاحظة أمانة إضافية:** عند تشغيل السويت الكامل عدة مرات متتالية، ظهر أحيانًا (وليس دائمًا) فشل خامس
عابر في تست غير متعلق بهذه الجلسة إطلاقًا: `platform.notifications.routes-contract.test.js` — تست
ترتيب الإشعارات حسب وقت الإنشاء (على الأرجح تعادل بالميلي ثانية بين سجلين عند تشغيل السويت الكامل تحت
ضغط، حيث ينفَّذ node:test الملفات بالتوازي). جرى التحقق مما يلي قبل تجاهله:
1. تشغيل ذلك الملف بمفرده 5 مرات متتالية → نجاح 8/8 في كل مرة، بلا استثناء.
2. تشغيل السويت الكامل بعد إزالة ملفَي Stage 6 الجديدين مؤقتًا → نفس الفشل العابر ظهر أيضًا.
3. تشغيل السويت الكامل من داخل الـZIP النهائي نفسه 4 مرات متتالية → ظهر 3 من 4 مرات، بالضبط في نفس
   التست، ولم يظهر في أي تست آخر جديد أو قديم غيره.
هذا تذبذب توقيت (timing flake) موجود مسبقًا وغير مرتبط بأي تعديل من هذه الجلسة (لم يُلمس
`notification.service.js` ولا `notification.repository.js` إطلاقًا هنا) — وليس regression تسبّبت فيه
هذه الجلسة، لكنه يُذكر هنا بصراحة بدل إخفائه.

**صفر regression حقيقي**: الفرق الوحيد بين 824→828 (Backend) هو الـ4 تستات الجديدة نفسها؛ والفرق بين
34→40 (Mobile) هو الـ6 تستات الجديدة نفسها. لا تست قديم تغيّر أو حُذف.

## 3. الملفات التي لُمِست هذه الجلسة (ولا شيء غيرها)
- `Mobile/app/app.js` — إعادة كتابة `home()` بالكامل + دوال مساعدة جديدة (`loadHomeSection`,
  `bindHomeControls`, `loadHomeSections`, `eventRow`, `familyRow`, `searchResultRow`)؛ `bindRooms()`
  بُسِّطت (نُقلت ربطات `#refresh`/`#newRoom` إلى `bindHomeControls()`)؛ `rooms()`/`events()` عُدِّلتا
  فقط لاستخدام `eventRow()` المشتركة بدل نسخة inline مكررة — لا تغيير في سلوكهما.
- `Backend/test/platform.home.stage6.routes-contract.test.js` — جديد.
- `Mobile/app/test/app.home.stage6.test.js` — جديد.
- `STAGES_05_35_STATUS.md` — إضافة قسم في النهاية فقط، لا حذف لأي محتوى سابق.
- `STAGE6_FINAL_REPORT.md` — هذا الملف.
- **لم يُلمس:** أي ملف Backend آخر (`feature-platform.js`, `platform.routes.js` هما بالضبط كما كانا عند
  التوقف)، وأي ملف من مراحل أخرى.

## 4. الحدود المعروفة المتبقية (صادقة، لم تُخفَ)
- **لا اختبار HTTP حقيقي عبر Express فعلي.** نفس القيد البيئي الدائم (لا شبكة لـ `npm install express`
  في هذا الصندوق) — موثّق في كل مرحلة سابقة في `STAGES_05_35_STATUS.md`، لم يتغيّر هنا. كل تحقق تم
  عبر `createPlatform()` مباشرة (Backend) أو `node:vm` يشغّل ملف `app.js` الحقيقي (Mobile) — بلا Mock
  للمنطق نفسه، لكن بلا خادم HTTP فعلي يعمل فعلاً.
- **لا اختبار ضد Postgres فعلي.** كل الدومينات لا تزال in-memory، كما في كل مرحلة سابقة.
- **لا تصميم بصري جديد.** الأقسام الجديدة تستخدم فئات CSS الموجودة مسبقًا (`.list`, `.card`, `.tabs`,
  `.chip`, `.empty`) بلا أي تنسيق إضافي مخصص — وظيفية بالكامل، لكن لا "تجميل" بصري جرى تنفيذه.
- **البحث (search) واجهة جديدة كليًا لم تكن موجودة قبل هذه الجلسة** (لا endpoint سابق كان مربوطًا
  بواجهة Mobile) — أُضيف حقل بحث حي (debounce 350ms) يستدعي `/api/search?q=` الحقيقي.
- أزرار الكتابة السابقة في شاشة Profile (إنشاء لعبة/عائلة/تحدٍ إلخ) لم تُمس ولم تُكرَّر داخل Home —
  Home يعرض فقط قراءة (read-only) لكل دومين، بالضبط كما ينص `home.entries` (قوائم عرض، لا نماذج كتابة).

## 5. الخلاصة
Stage 6 مكتملة بنفس معيار التحقق (تستات فعلية تعمل + node --check + node --test كامل + صفر regression
موثَّق) الذي يُطبَّق على بقية المراحل في `STAGES_05_35_STATUS.md` — لا أكثر من ذلك الادعاء، ولا نسبة رقمية
تتجاوز 100% بأي شكل. القيود البيئية (لا شبكة، لا Postgres حي) هي نفسها الثابتة في كل تقرير سابق ولم
تتغيّر بفعل هذه الجلسة.
