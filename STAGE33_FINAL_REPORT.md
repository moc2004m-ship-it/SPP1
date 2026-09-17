# Stage 33 (Notifications + Push) — التقرير النهائي

**الحالة: DONE.** يحل هذا التقرير محل `STAGE33_PROGRESS_STOPPED.md` (المحذوف)، بنفس نمط `STAGE32_FINAL_REPORT.md`/`STAGE32_PROGRESS_STOPPED.md`.

## 0. الرقم الرسمي النهائي (مؤكد بتشغيل فعلي في هذه الجلسة)
```
node --test test/*.test.js
tests 583 / pass 579 / fail 4
```
الأربعة fails بيئية دائمة فقط (لا تغيير، لا regression): `accounts.routes.test.js`، `agora.routes.test.js`، `auth.routes.test.js`، `config.routes.test.js` — جميعها بسبب `Cannot find module 'express'` (لا npm/شبكة في هذه البيئة، موثّق منذ Stage 10).

نقطة البداية لهذه الجلسة (checkpoint ثامن، مؤكدة بإعادة تشغيل فعلي قبل أي تعديل): **575 تست / 571 pass / 4 fail** — مطابق تمامًا لما وثّقه `STAGE33_PROGRESS_STOPPED.md`. صفر انحراف عن التوثيق قبل البدء.

**هذه الجلسة أضافت 8 تست جديد فعلي** (575 → 583)، ولم تُعدّل ولم تُحذف أي تست موجود مسبقًا.

## 1. ما تم في هذه الجلسة تحديدًا (كل ما تبقى من خطة checkpoint ثامن، القسم 4)

### 1.1 `src/routes/platform.routes.js` — الكود الوحيد المتبقي في Stage 33
- **توقيع `createPlatformRouter({...})`** يستقبل الآن `notificationService` (كان `index.js` يمرره بالفعل منذ الجلسة السابقة، لكن التوقيع هنا لم يكن يذكره).
- **`GET /api/notifications/:userId`** رُحِّل من `platform.store.list(33, ...)` القديم (فارغ دائمًا، بلا كاتب حقيقي) إلى `notificationService.list({ actingAccountId: userId })` الحقيقي. نفس شكل الاستجابة (مصفوفة بحقول `type`/`status`/`createdAt`)، **بدون** `.slice().reverse()` إضافي لأن `listForAccount()` تُعيدها الأحدث أولاً بالفعل — تحقق تم بقراءة `Mobile/app/app.js` (`notificationRow()`، السطر 81) و`api()` (السطر 21-28) للتأكد أن شكل الاستجابة (`{ ok, data }` مع `data` = المصفوفة مباشرة) يبقى متوافقًا 100% مع الواجهة الحالية — **صفر تعديل على Mobile/app**.
- **الستة مسارات الجديدة**، مسجّلة بالترتيب الصحيح (المسارات الحرفية قبل `:userId` العام، بالضبط كما خُطِّط):
  1. `GET /api/notifications/unread-count` → `getUnreadCount({ actingAccountId })`
  2. `GET /api/notifications/preferences` + `POST /api/notifications/preferences` → `getPreferences`/`updatePreferences({ mutedCategories: req.body?.mutedCategories })`
  3. `POST /api/notifications/read-all` → `markAllRead({ actingAccountId })`
  4. `POST /api/notifications/devices` (register) + `POST /api/notifications/devices/remove` → `registerDevice`/`removeDevice({ token: req.body?.token, platform: req.body?.platform })`
  5. `POST /api/notifications/:notificationId/read` → `markRead({ actingAccountId, notificationId: req.params.notificationId })`
  6. `POST /api/notifications/:notificationId/redeliver` → `redeliverPendingPush({ actingAccountId, notificationId: req.params.notificationId })`
- **الهوية دائمًا من `req.session.accountId`**، أبدًا من `req.body`/`req.params` — نفس انضباط كل مسار آخر في هذا الملف. `notificationId`/`userId` في الـparams هما هدف فقط، وownership يُعاد التحقق منه داخل `notificationService` نفسها (403/404 عبر `requireOwnNotification`) — طبقة أمان مزدوجة كما في couple/guard.

### 1.2 تستات جديدة حقيقية (8، كل الجديد هذه الجلسة)
ملف جديد: `test/platform.notifications.routes-contract.test.js` — **8/8 PASS فعليًا** (تأكيد معزول منفصل أيضًا). يختبر بالضبط شكل الاستدعاء الذي يستخدمه كل مسار جديد (بلا express — نفس أسلوب `platform.auth.guards.test.js`: منطق مباشر بمدخلات مُصطنَعة)، شاملاً تست ownership لكل من `markRead`/`redeliverPendingPush` (رفض 403 لمحاولة عبر حساب آخر) ولـ`assertOwnAccount` (رفض قراءة صف مستخدم آخر عبر `:userId`).

**لماذا لا يوجد تست HTTP فعلي (`supertest`/express حقيقي) لـ`platform.routes.js` نفسه:** الملف يستدعي `require('express')` في أول سطر، وexpress غير مثبَّت في هذه البيئة (لا npm، لا شبكة) — نفس السبب البيئي الدائم للأربعة fails أعلاه. **هذا ليس استثناءً جديدًا:** لا يوجد أي ملف `*.routes.test.js` مخصص أصلاً لمسارات Stage 30/31/32 (family/ranking/event/couple/guard) في هذا المشروع — كلها مختبَرة على مستوى الخدمة فقط (`family.service.test.js`/`event.service.test.js`/`couple.service.test.js`/`guard.service.test.js`)، بنفس الانضباط المطبَّق هنا الآن لـnotifications (`notification.service.test.js`: 36 تست + `platform.notifications.routes-contract.test.js`: 8 تست جديد). لا ادّعاء بتغطية HTTP فعلية لم تحدث.

### 1.3 تحقق يدوي إضافي (ليس تست دائم، تأكيد إضافي فقط)
شُغِّل سكربت تحقق سلسلة كاملة (notify → list → unread-count → markRead → ownership rejection → preferences → devices → markAllRead → redeliverPendingPush) بنفس أشكال الاستدعاء بالحرف التي يستخدمها كل مسار — **نجح بالكامل**، مؤكدًا أن السلسلة الكاملة (وليس فقط كل استدعاء منفرد) تعمل بلا تعارض.

## 2. صفر عمل أُعيد (كما طُلب صراحة)
- **Stage 32 لم تُلمس إطلاقًا** — لا تعديل على `couple.*`/`guard.*`.
- **الثمانية تكاملات notify()** (Couple/Guard/Event/Family/Payment/Gifts/Friend-Follow/Room-Mic) وتستاتها الـ16 من الجلسة السابقة **لم تُعدَّل** — أُعيد تشغيلها فقط للتأكد (571/571 قبل البدء).
- **`notification.service.js`، `notification-bus.js`، `push.service.js`، `notification.repository.js`، `notification-catalog.js`** وكل تستاتهم (من جلسات سابقة) **لم تُلمس إطلاقًا** هذه الجلسة.

## 3. ما يبقى BLOCKED بصراحة (لا ادّعاء بخلافه)
- **تسليم Push الحقيقي عبر Firebase**: `push.service.js` يُرجع 503 حقيقي لأن `firebase-admin` غير مثبَّت ولا توجد بيانات اعتماد Firebase حقيقية في هذه البيئة — **لم يُختبَر تسليم push حقيقي فعليًا، ولن يُدَّعى ذلك.** كل تست push موجود يستخدم SDK وهمي مُحقَن (fake فقط داخل test/، بنفس تقنية `agora.token.service.test.js`) — يثبت منطق الخدمة (تجميع النتائج، تنظيف tokens غير صالحة، احترام mute) وليس اتصالًا حقيقيًا بـFCM.
- **اختبار HTTP فعلي لأي مسار في `platform.routes.js`** (بما فيها الستة الجديدة): BLOCKED بسبب غياب express — موثَّق بصراحة، ليس مُتجاهَلًا.
- **Postgres حي**: كل تستات الـrepository (بما فيها `notification.repository.js`) تُشغَّل فقط بنسخة In-Memory في هذه البيئة؛ نسخة Postgres مكتوبة (نفس نمط كل repository آخر هنا) لكن غير مُشغَّلة ضد قاعدة بيانات حقيقية.

## 4. الرقم النهائي حسب الملف (تأكيد معزول)
| الملف | تست | الحالة |
|---|---|---|
| `notification-catalog.test.js` | 8 | PASS (من جلسات سابقة، غير مُعاد لمسه) |
| `notification.repository.test.js` | 16 | PASS (من جلسات سابقة) |
| `notification-bus.test.js` | 7 | PASS (من جلسات سابقة) |
| `push-config.test.js` | 4 | PASS (من جلسات سابقة) |
| `push.service.test.js` | 10 | PASS (من جلسات سابقة) |
| `notification.service.test.js` | 36 | PASS (من جلسات سابقة، أُعيد تشغيله للتأكد) |
| `recharge.service.test.js` (notify() جزء) | 4 من 15 | PASS (من جلسة سابقة) |
| `gifts.service.test.js` (notify() جزء) | 4 من 18 | PASS (من جلسة سابقة) |
| `feature-platform.test.js` (notify() جزء) | 8 من 45 | PASS (من جلسة سابقة) |
| **`platform.notifications.routes-contract.test.js`** | **8** | **PASS — جديد هذه الجلسة** |

## 5. خلاصة Stage 33
كل ثمانية تكاملات `notify()` تعمل وتم اختبارها. الخدمة الكاملة (10 دوال) مكتملة ومختبَرة. المسارات السبعة (الموجود المُرحَّل + الستة الجديدة) مربوطة بـ`notificationService` الحقيقي، بترتيب تسجيل صحيح، بأمان ownership مزدوج، ومختبَرة على مستوى العقد/المنطق (بلا express، BLOCKED بصراحة على مستوى HTTP فقط — كبقية مسارات Stage 30-32). Push الحقيقي عبر FCM يبقى BLOCKED بصراحة (لا اعتماد/شبكة). **صفر fake/mock كتنفيذ إنتاج** — الوهمي الوحيد المستخدم هو `fakeNotificationService`/`fakePushProvider`/`sdk` وهمي، وكلها داخل `test/` فقط لعزل الاختبارات، تمامًا كما طُلب.

**Stage 33 = DONE.** لا تُفتَح Stage 34 إلا بأمر صريح.
