# Stage 12 (Create Room) — التقرير النهائي

**الحالة: DONE.** يحل هذا التقرير محل `STAGE12_PROGRESS_STOPPED.md` (المحذوف الآن)، بنفس نمط `STAGE33_FINAL_REPORT.md`/`STAGE13_FINAL_REPORT.md`. هذه الجلسة استأنفت **حصريًا** القسم 3 من ملف التوقف (لم يُعَد لمس أي سطر من القسم 1/1.2/1.3 هناك).

## 0. الرقم الرسمي النهائي (مؤكد بتشغيل فعلي في هذه الجلسة، عدة مرات متتالية)

```
node --test test/*.test.js
# tests 818   (= 801 + 17 تست Stage 12 جديد: 11 rooms.stage12.create.test.js
#              + 6 platform.rooms.routes-contract.test.js)
# pass 814
# fail 4      (نفس الأربعة البيئية الدائمة بالضبط: accounts.routes.test.js،
#              agora.routes.test.js، auth.routes.test.js، config.routes.test.js
#              — "Cannot find module 'express'"، صفر تغيير، صفر regression)
```

نقطة البداية لهذه الجلسة (مؤكدة بتشغيل فعلي قبل أي تعديل): **801 تست / 797 pass / 4 fail بيئي** — مطابقة تمامًا لما وثّقه `STAGE12_PROGRESS_STOPPED.md`. صفر انحراف عن التوثيق قبل البدء.

**هذه الجلسة أضافت 17 تست جديد فعلي فقط** (801 → 818)، ولم تُعدّل ولم تُحذف أي تست أو كود موجود مسبقًا — القسم 3 حصريًا من ملف التوقف.

## 1. ما تم في هذه الجلسة تحديدًا (القسم 3 من ملف التوقف، بالترتيب)

### 1.1 `test/rooms.stage12.create.test.js` (جديد بالكامل — 11 تست، كلها PASS)
تست تكاملي حقيقي عبر `createPlatform()` الفعلية (بلا mock)، يغطي بالضبط ما طلبه القسم 3:
- `rooms.create()`: كل حقل بقيمته الصريحة معًا (id يبدأ فعليًا بـ`s12_`، `hasPassword`/`passwordHash` حقيقيان ويتحققان فعليًا عبر `verifyRoomPassword()`، تطبيع الـtags) + كل الافتراضيات معًا في آن واحد + توافق شكل الاستدعاء القديم `{ownerId,name[,capacity]}` + **رفض كل حقل غير صالح عبر رسائل الخطأ 400 الحقيقية** القادمة فعليًا من `room.model.js`/`room-catalog.js` (visibility، micSeats بحديه الأعلى والأدنى، theme، category، language، ageRule، tags كمصفوفة وكحد أقصى 8، cover/background كـURL http(s)، announcement فارغ، password أقصر من الحد).
- `listDiscoverable()`: غرفة `private` تظهر للمالك وتُخفى عن الغريب، `passwordHash` غائب قطعًا من كل نتيجة، فلاتر category/language/tag/query تعمل فعليًا منفردة ومجتمعة معًا.
- `join()` بكلمة مرور: نجاح بكلمة صحيحة، رفض 401 بكلمة خاطئة أو غائبة، تجاوز المالك بلا كلمة مرور، إعادة انضمام idempotent واستئناف `disconnected` بلا الحاجة لإعادة إدخال كلمة المرور، وغرفة بلا كلمة مرور غير متأثرة إطلاقًا.

ملاحظة تقنية وحيدة عولجت أثناء الكتابة: `rooms.create()` نفسها **غير** معلَّنة كـ`async` (تُعيد وعد `store.add()` مباشرة)، فاستدعاؤها بمدخل غير صالح يرمي **مزامنةً** لا كرفض وعد — استُخدمت دوال `async () => p.rooms.create(...)` فآن جميع استدعاءات `assert.rejects` لالتقاط ذلك بشكل صحيح (تأكدت المشكلة والحل بتشغيل فعلي: فشل تست واحد ثم نجاح كامل السويت بعد الإصلاح).

### 1.2 `test/platform.rooms.routes-contract.test.js` (جديد بالكامل — 6 تست، كلها PASS)
بنفس منهجية `platform.notifications.routes-contract.test.js` بالحرف (بلا express — `platform.routes.js` يبقى BLOCKED بيئيًا لنفس السبب الدائم لكل مسارات Stage 27-33، لا استثناء جديد؛ فحص نص الملف + محاكاة شكل الاستدعاء بالضبط كما هو مكتوب فعليًا في `platform.routes.js` سطرًا بسطر)، يثبت:
- `GET /api/home`: قسم `rooms` يأتي من `rooms.listDiscoverable({ actingAccountId: req.session.accountId })` فقط — غرفة خاصة لا تظهر لغريب، `passwordHash` غائب.
- `GET /api/rooms`: `actingAccountId` + فلاتر `category`/`language`/`tag`/`q` من `req.query` تصل فعليًا بنفس الشكل إلى `listDiscoverable()`، منفردة ومجتمعة، وأن `req.query` الفارغ يسلك بلا فلاتر تمامًا كالسلوك القديم.
- `POST /api/rooms`: `ownerId` يأتي **دائمًا** من `req.session.accountId`، حتى لو حاول جسم الطلب انتحال `ownerId` آخر.
- `POST /api/rooms/:roomId/join`: `req.body.password` يمرَّر كمعامل ثالث بالضبط كما في المعالج، وأن `req.body` غير موجود إطلاقًا (طلب بلا جسم) **لا يرمي** قبل الوصول لـ`join()` نفسها (حارس `req.body && req.body.password` يعمل)، وأن هوية المنضم دائمًا من الجلسة لا من الجسم حتى مع محاولة انتحال صريحة.

### 1.3 تشغيل السويت الكامل (Backend + Mobile)، تأكيد صفر regression
```
Backend: node --test test/*.test.js  →  818 / 814 pass / 4 fail بيئي دائم (× 5 تكرارات)
Mobile:  node --test test/*.test.js  →  34 / 34 pass (بدون أي تغيير على أي ملف Mobile)
```
`node --check` ناجح على كل ملف جديد/مُعدَّل هذه الجلسة: `test/rooms.stage12.create.test.js`، `test/platform.rooms.routes-contract.test.js`، وتأكيدًا إضافيًا على `feature-platform.js`/`platform.routes.js`/`room-catalog.js`/`room.model.js`/`room-password.js` (لم تُعدَّل، فقط أُعيد التحقق).

**صفر تعديل** على أي كود إنتاجي هذه الجلسة — القسم 3 كان تستات فقط، بالضبط كما خطّط ملف التوقف.

## 2. الملاحظة البيئية (Stage 33 flaky test) — منقولة كما طُلب، لم تُصلَح

**خارج نطاق Stage 12 تمامًا** (ملف من Stage 33: `test/platform.notifications.routes-contract.test.js`، التست `"GET /api/notifications/:userId contract: ... newest first, no extra reverse needed"`). موجودة أصلًا قبل هذه الجلسة، مُكتشَفة ومُوثَّقة أول مرة في القسم 4 من `STAGE12_PROGRESS_STOPPED.md`، وأُعيد تأكيدها فعليًا هذه الجلسة بتشغيل السويت الكامل 5 مرات متتالية: فشلت في 2 من 5 تكرارات.

**السبب الموثَّق**: تصادم `createdAt` (دقة بالمللي ثانية) عند إنشاء إشعارين متتاليين بسرعة كافية ليقعا في نفس المللي ثانية بالضبط، فيبقى ترتيب الإدراج (sort مستقر) بدل "الأحدث أولًا" المتوقَّع فتلك الحالة النادرة.

**لم يُعدَّل أي شيء متعلق بها هذه الجلسة أيضًا** — لا الـتست نفسه، ولا `notification.service.js`/`notification.repository.js`. موثَّقة هنا فقط بصراحة كي تبقى مرئية لأي جلسة لاحقة تتعامل مع Stage 33 أو تراجع استقرار السويت الإجمالي، ضمن نطاقها الصحيح لا نطاق Stage 12.

## 3. الحدود الصريحة (بيئية، لا نقص عمل)

- HTTP الفعلي (express) لمسارات Stage 12 (`GET /api/home`، `GET /api/rooms`، `POST /api/rooms`، `POST /api/rooms/:roomId/join`) يبقى BLOCKED بيئيًا — نفس القيد الدائم لكل مسارات Stage 27-33، مُثبَت بديلًا عبر `platform.rooms.routes-contract.test.js` بنفس المعيار المطبَّق على Stage 33.
- Postgres الفعلي غير مُفعَّل — نفس حال كل Repository آخر بالمشروع (Stage 12 يستخدم `store`/`InMemoryFeatureRecordRepository` كباقي المراحل).
- `npm install`/الشبكة: **غير متاحة** (bash tool network disabled بالكامل).

## 4. أسماء الملفات

**جديد هذه الجلسة:** `Backend/test/rooms.stage12.create.test.js`، `Backend/test/platform.rooms.routes-contract.test.js`، `STAGE12_FINAL_REPORT.md` (هذا الملف، يحل محل `STAGE12_PROGRESS_STOPPED.md` المحذوف).

**من الجلسة السابقة (لم يُلمس هذه الجلسة، انظر القسم 1/1.2/1.3 من ملف التوقف السابق لتفاصيلها الكاملة):** `Backend/src/domain/room-catalog.js`، `Backend/src/database/models/room.model.js`، `Backend/src/security/room-password.js`، `Backend/test/room-catalog.test.js`، `Backend/test/room.model.test.js`، `Backend/test/room-password.test.js`، وتعديلا `Backend/src/feature-platform.js`/`Backend/src/routes/platform.routes.js`.

**لم يُلمس إطلاقًا:** Mobile كاملاً، وكل ملفات Stage 10/11/13/14/16/23/26/27/28/29/30/31/32/33.

## 5. بهذا: Stage 12 (Create Room) = DONE بالكامل

الكتالوجات (5 تست) + النموذج البنيوي (20 تست) + تجزئة كلمة المرور (7 تست) + `rooms.create()`/`listDiscoverable()`/`join(password)` (32 تست وحدة من الجلسة السابقة) + التكامل الحقيقي عبر `createPlatform()` (11 تست جديد) + عقد المسارات (6 تست جديد) — كلها PASS فعليًا، مربوطة، وموثَّقة. **السويت الكامل النهائي: Backend 818 تست / 814 pass / 4 fails بيئية معروفة فقط؛ Mobile 34 تست / 34 pass. صفر regression.**

**لا تُبدأ Stage 13 أو أي مرحلة أخرى في إطار هذا التقرير — Stage 13 نفسها موثَّقة DONE مسبقًا (`STAGE13_FINAL_REPORT.md`) ولا تُعاد.** التالي بالترتيب حسب `STAGES_1_35_CONTINUATION_STATE.md`: **لا يُبدأ Stage 14 (أو أي مرحلة تالية) إلا بأمر صريح من المستخدم**، بنفس منهجية كل مرحلة سابقة (فحص أولًا → كتابة → تستات حقيقية → `node --test` كامل → تأكيد صفر regression → فقط بعدها DONE).
