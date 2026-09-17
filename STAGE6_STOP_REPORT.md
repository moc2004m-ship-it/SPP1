# Stage 6 (Home) — تقرير توقف (STOP)، ليس تقرير إنجاز

**الحالة: Stage 6 غير مكتملة.** هذا الملف يوثّق بصدق ما تم فعليًا في هذه الجلسة قبل التوقف بأمر المستخدم،
وما تبقّى، حتى لا تُقرأ الجلسة القادمة على أنها "DONE" وهي ليست كذلك.

## 0. لماذا تم التوقف هنا
أمر المستخدم بالتوقف الفوري في منتصف العمل (`STOP`) قبل إكمال طبقة الواجهة (Mobile) وقبل أي
اختبارات/تقارير/ZIP نهائية كانت مخطَّطة. هذا الملف + الـZIP المرفق هما لقطة صادقة للحالة عند لحظة
التوقف، لا أكثر.

## 1. نقطة البداية (مؤكدة بتشغيل فعلي قبل أي تعديل)
- Backend: `node --test test/*.test.js` → **818 تست / 814 pass / 4 fail بيئي** (نفس السبب الدائم الموثَّق
  سابقًا: `Cannot find module 'express'` في accounts/agora/auth/config routes.test.js — لا شبكة لـ
  `npm install` في هذه البيئة، صفر تغيير جديد).
- Mobile: `node --test test/*.test.js` → **34/34 pass**.
- مطابقة تمامة لما وثّقته `STAGES_05_35_STATUS.md`/`STAGE12_FINAL_REPORT.md` — صفر انحراف قبل البدء.

## 2. ما تم فعليًا في هذه الجلسة (Backend فقط — لا شيء في Mobile)

### 2.1 `Backend/src/feature-platform.js` — إضافة صرفة، لا تعديل على أي دالة قديمة
- `rooms.discoverForHome({ actingAccountId, tab, category, language, tag, query })` — **جديدة بالكامل**،
  لا تلمس `rooms.listDiscoverable()` الموجودة (Stage 12/13 يعتمدان عليها حرفيًا). تدعم:
  - `tab: 'live'` — الغرف التي فيها عضوية Stage 13 حقيقية بحالة `joined` واحدة على الأقل الآن (لا رقم
    وهمي، لا عشوائية).
  - `tab: 'popular'` — ترتيب تنازلي حسب عدد الأعضاء `joined` الحقيقي لكل غرفة.
  - `tab: 'following'` — يتطلب `actingAccountId`، يُصفّي الغرف حسب ملاك يتابعهم المستخدم فعليًا (سجل
    Stage 10 `follow`/`active` الحقيقي، نفس السجل الذي يستخدمه `social.follow()/unfollow()`).
  - `tab: 'new'` (افتراضي) — الأحدث أولًا.
  - كل تبويب يحافظ على نفس قواعد الخصوصية/الفلترة الموجودة في `listDiscoverable()` (إخفاء الغرف
    الخاصة عن الغرباء، حذف `passwordHash`، فلاتر category/language/tag/q القابلة للتركيب).
- `rooms.categoryCounts({ actingAccountId })` — **جديدة**. تُرجع كل فئة حقيقية من كتالوج الفئات
  الموجود (`room-catalog.js`) مع عدد حقيقي للغرف المرئية لهذا المستخدم في كل فئة (صفر إن لم توجد،
  وليس حذفًا للفئة).

### 2.2 `Backend/src/routes/platform.routes.js`
- `GET /api/home` — **إثراء إضافي فقط**: أُضيف حقلا `categories` و`unreadNotifications` إلى نفس
  الاستجابة القديمة تمامًا (`rooms`/`events`/`tabs`/`entries` كما كانت حرفيًا، لم يتغيّر ترتيبها ولا شكلها).
- `GET /api/home/rooms?tab=&category=&language=&tag=&q=` — **route جديد بالكامل**، يستدعي
  `rooms.discoverForHome()`. لا علاقة له بـ `GET /api/rooms` القديم (الذي بقي بلا أي تعديل حرفي).

### 2.3 اختبارات جديدة
- `Backend/test/rooms.stage6.home-feed.test.js` — **6 تستات جديدة، كلها PASS فعليًا** (تكامل حقيقي عبر
  `createPlatform()` الفعلية، بلا mock): رفض tab غير معروف، following تتطلب actingAccountId وتعكس
  سجل المتابعة الحقيقي (متابعة ثم إلغاء متابعة)، live/popular يعكسان عدد الأعضاء الحقيقي (انضمام
  ومغادرة فعليَّين)، new = الأحدث أولًا مع إخفاء الخاص/حذف passwordHash، تركيب الفلاتر مع tab، وعدّاد
  الفئات الحقيقي مع فرق الرؤية بين المالك والغريب.

### 2.4 التحقق المُشغَّل فعليًا بعد كل تعديل (لا PASS وهمي)
```
node --check src/feature-platform.js                      → OK
node --check src/routes/platform.routes.js                 → OK
node --check test/rooms.stage6.home-feed.test.js            → OK
Backend: node --test test/*.test.js  → 824 تست / 820 pass / 4 fail بيئي (نفس الأربعة الدائمة بالضبط)
Mobile:  node --test test/*.test.js  → 34/34 pass (لم يُلمس أي ملف Mobile هذه الجلسة)
```
**صفر regression**: الفرق الوحيد بين 818→824 و814→820 هو الـ6 تستات الجديدة نفسها؛ لا تست قديم
تغيّر أو حُذف، والأربعة fails البيئية الدائمة نفسها بالحرف.

## 3. ما لم يبدأ إطلاقًا (هذا هو الجزء الأكبر من Stage 6 المطلوب)

**لم يُلمس أي ملف Mobile في هذه الجلسة.** تحديدًا لم يتم بعد:
- ربط تبويبات الواجهة (مباشر/متابعة/شعبي/جديد) في `Mobile/app/app.js`'s `home()` بـ
  `GET /api/home/rooms` الجديد — التبويبات في الواجهة حاليًا ثابتة بصريًا فقط (لا `onclick`، لا تبديل
  حالة فعلي).
- صف/شرائح الفئات (Categories) على شاشة Home نفسها مربوطة بـ `categories` الحقيقية.
- أقسام Games/Events/Rankings/Family/Search/Notifications **داخل شاشة Home** (موجودة اليوم فقط
  متفرقة داخل تبويبات Profile/Rooms/Events المنفصلة، وليست ضمن Home كما تنص `home.entries`).
- حالات loading/error/empty منفصلة وواضحة لكل قسم جديد.
- Route-contract test (بنفس أسلوب `platform.rooms.routes-contract.test.js`) للـ`GET /api/home/rooms`
  الجديد و`GET /api/home` المُثرى — **لم يُكتب بعد**.
- أي تست Mobile جديد لواجهة Stage 6.
- تحديث `STAGES_05_35_STATUS.md` ليعكس هذه الإضافة الجزئية.
- **لا يوجد `STAGE6_FINAL_REPORT.md`** — هذا الملف (`STAGE6_STOP_REPORT.md`) يحل محله مؤقتًا ويجب
  ألا يُقرأ كإنجاز نهائي.

## 4. الحدود البيئية الثابتة (كما في كل مرحلة سابقة، لم تتغيّر)
- `npm install`/الشبكة غير متاحة إطلاقًا في هذه البيئة (bash tool network disabled) — HTTP الفعلي عبر
  express يبقى BLOCKED بيئيًا لكل شيء، بما فيه الـroute الجديد `GET /api/home/rooms`؛ لم يُختبر إلا
  منطقيًا عبر `createPlatform()` مباشرة، بلا express.
- Postgres الفعلي غير مُفعَّل (كما في كل الدومينات الأخرى).

## 5. أسماء الملفات
**جديد هذه الجلسة:** `Backend/src/feature-platform.js` (تعديل إضافي)، `Backend/src/routes/platform.routes.js`
(تعديل إضافي)، `Backend/test/rooms.stage6.home-feed.test.js` (جديد)، `STAGE6_STOP_REPORT.md` (هذا الملف).
**لم يُلمس إطلاقًا:** كل ملفات Mobile، وكل ملفات باقي المراحل.

## 6. الخلاصة
Stage 6 **ليست DONE**. تم إنجاز الأساس الخلفي (Backend) الحقيقي والمختبَر لـ live/following/popular/new
وcategoryCounts فقط. طبقة الواجهة كاملة (التبويبات الفعلية + أقسام games/events/rankings/family/search/
notifications داخل Home + حالات loading/error/empty) **لم تبدأ بعد** وهي الجزء الأكبر مما طلبه المستخدم
أصلًا. لا تُبدأ Stage 15 أو أي مرحلة أخرى — وأيضًا لا يُعتبر Stage 6 نفسها منتهية إلى أن تُستكمل طبقة
الواجهة وتُشغَّل نفس دورة التحقق (تستات → node --test كامل → node --check → صفر regression) عليها.
