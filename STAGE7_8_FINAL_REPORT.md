# STAGE7_8_FINAL_REPORT.md — Profile + Profile Actions/Privacy

**الحالة: DONE (بحدود واضحة، موثّقة بالكامل)، بدليل تست حقيقي run فعليًا هذه الجلسة.**

هذا الملف يوثّق إكمال الجزء اللي كان مخطط له فـ`CHECKPOINT_Stage7_8_STOPPED.md` (الـRoutes + التستات)، بنفس منهجية `STAGE30_...`/`STAGE32_FINAL_REPORT.md` (فحص → كتابة → تستات حقيقية → `node --test` كامل → تأكيد صفر regression).

---

## 1) الكود (كامل هذه الجلسة، فوق أساس الجلسة السابقة)

### Stage 7 — Profile (`Backend/src/feature-platform.js`)
| الدالة | الوصف |
|---|---|
| `profile.create()` | **إصلاح Bug حقيقي**: كانت append-only (كل نداء = سجل جديد، `get()` يرجع الأقدم دايمًا). أصبحت upsert حقيقي (تحديث فـمكانه لو موجود). + حقل `avatarUrl` + `privacy` بقيم افتراضية |
| `profile.get()` | بدون تغيير — الآن يرجع القيمة الصحيحة فعليًا بفضل إصلاح upsert |
| `profile.getFull(viewerId, targetUserId)` | **جديد**: يجمع الملف + LVL/VIP/SVIP من `accounts` (بدون Coins/Diamonds أبدًا) + عدد Followers/Following/Friends حي من Stage 10 + فرض الحظر (403) + فرض الخصوصية (public/friends/private) |
| `profile.updatePrivacy(userId, patch)` | **جديد**: تحديث جزئي لإعدادات الخصوصية، بدون فقدان بقية القيم |

### Stage 8 — Profile Actions + Privacy (`Backend/src/feature-platform.js`)
| الدالة | الوصف |
|---|---|
| `social.unfollow(userId, targetId)` | **جديد**: كانت غير موجودة إطلاقًا (follow فقط، بلا رجوع). الآن تحدّث السجل النشط لـ`removed` |
| `social.follow()` / `social.friend()` | أصبحوا يتحققوا من `social.allowed()` (الحظر) قبل التنفيذ — 403 لو محظور |
| `search.query()` | **Discoverability حقيقي**: حساب `discoverable:false` ما يظهرش فـنتائج بحث شخص غريب (batch lookup واحد، بدون N+1) |

### Routes (`Backend/src/routes/platform.routes.js`) — الجزء اللي كان ناقص من الـcheckpoint السابق
```
GET  /platform/api/profile/:userId/full   → platform.profile.getFull(session, params.userId)
POST /platform/api/profile/privacy        → platform.profile.updatePrivacy(session, body)
POST /platform/api/unfollow               → platform.social.unfollow(session, body.targetId)
```
الهوية الفاعلة دايمًا من `req.session.accountId` — نفس قاعدة الأمان المطبّقة على كل مسار آخر فهذا الملف، ماشي من أي حقل فـ`body`/`params`.

---

## 2) التستات (جديدة كلها هذه الجلسة، `Backend/test/feature-platform.test.js`)

**15 تست جديد، كلهم PASS فعليًا:**

1. `profile.create()`: نداء ثاني لنفس userId يحدّث بدل ما يكرر
2. `profile.create()`: القيم الافتراضية للخصوصية + الحفاظ على avatarUrl عند تحديث ما يذكرهاش
3. `social.unfollow()`: يشيل متابعة نشطة فعليًا (العداد ينقص)
4. `social.unfollow()`: 404 لو ما كانش فيه متابعة أصلاً
5. `social.follow()`: مرفوض (403) بين حسابين محظورين
6. `social.friend()`: مرفوض (403) بين حسابين محظورين
7. `profile.getFull()`: LVL/VIP/SVIP يظهرو، Coins/Diamonds **لا يظهروش أبدًا**
8. `profile.getFull()`: العدادات (Followers/Following/Friends) محسوبة حية وصح من Stage 10
9. `profile.getFull()`: viewer محظور → 403، بلا أي بيانات
10. `profile.getFull()`: بروفايل Private → الغريب يشوف `bio:null`، المالك يشوف بياناته كاملة
11. `profile.getFull()`: بروفايل Friends-only → الصديق يشوف، الغريب لا
12. `profile.updatePrivacy()`: تحديث جزئي بدون فقدان بقية إعدادات الخصوصية
13. `profile.updatePrivacy()`: ينشئ بروفايل بالقيم الافتراضية + الباتش لو ما كانش موجود
14. `search.query()`: حساب `discoverable:false` مستبعد من نتائج البحث
15. `search.query()`: حساب بلا بروفايل أصلاً يبقى ظاهر (افتراضي discoverable=true)

```
$ node --test test/feature-platform.test.js
# tests 60   (45 قديمة + 15 جديدة)
# pass 60
# fail 0
```

---

## 3) تشغيل السويت الكامل للمشروع (بعد كل التعديلات أعلاه)

```
$ node --test test/*.test.js
# tests 598   (583 قديم مؤكد + 15 جديد)
# pass 594
# fail 4      (accounts.routes.test.js, agora.routes.test.js, auth.routes.test.js,
#              config.routes.test.js -- نفس الأربعة البيئية القديمة بالضبط:
#              "Cannot find module 'express'" -- npm install غير متاح فهذا الـsandbox)
```
**صفر تست جديد فشل. صفر regression.** نفس الأربعة فشلوا لنفس السبب البيئي الموثّق فكل تقرير سابق فهذا المشروع.

---

## 4) واش لسا خارج نطاق هذا الإكمال (بصراحة، بدون ادّعاء)

هذوما **مو أخطاء ولا نسيان** — موثّقين من الجلسة السابقة (`CHECKPOINT_Stage7_8_STOPPED.md`) كخارج النطاق المنطقي لأنهم يحتاجو بنية غير موجودة أصلاً فمكان تاني:

| البند | ليه برا النطاق |
|---|---|
| فرض `whoCanMessage` على الرسائل الفعلية | `chat.send()` (Stage 11) يشتغل بـ`conversationId` عام، بلا مفهوم "أطراف المحادثة" (participants) بعد — الإضافة تحتاج بنية Stage 11 نفسها أولاً |
| فرض `whoCanInviteToRoom` | ما فيش endpoint "ادعُ شخص X للغرفة" بـtargetId أصلاً فـRooms (Stage 12/14) — الدعوة حاليًا self-serve فقط (Join/Seat Request) |
| Badges/Frames/Titles/Achievements على البروفايل | يحتاج مفهوم Equip/Unequip فـInventory، وهو نفسه ناقص فـStage 29 (موثّق سابقًا فتقرير المراحل 1-35) |
| واجهة الموبايل الحقيقية | شاشة Profile فـ`Mobile/app/app.js` بقيت شاشة مطوّر مبسّطة (prompt-based) — لم تُلمس |

**الخلاصة:** Stage 7 (Profile) وStage 8 (Profile Actions + Privacy) **كاملين ومختبرين على مستوى الـBackend** بحدود النطاق المذكور أعلاه (Follow/Unfollow/Friend/Block/Discoverability/Privacy Gating/Public-Standing Merge) — الأجزاء المتبقية مربوطة ببنية ناقصة فمراحل تانية (11، 12/14، 29) ومُوثّقة كـ"غير مبدوءة" هناك، ماشي هنا.

---

## 5) الملفات المتغيرة هذه الجلسة

**تعديل:** `Backend/src/feature-platform.js` (profile + social)، `Backend/src/routes/platform.routes.js` (3 مسارات جديدة)، `Backend/test/feature-platform.test.js` (+15 تست)

**لم تتغير:** كل باقي الملفات (Family/Rankings/Couple/Guard/Notifications/Store/Wallet/Recharge/Games...) — صفر لمس، صفر regression مؤكد بالتشغيل الكامل أعلاه.
