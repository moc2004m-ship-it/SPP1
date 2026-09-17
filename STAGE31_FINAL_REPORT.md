# Stage 31 (Rankings + Events) — تقرير نهائي

**الحالة: DONE، بدليل تست حقيقي run فعليًا هذه الجلسة (الخامسة). هذا الملف يحل محل `STAGE31_PROGRESS_STOPPED.md` (محذوف) كتوثيق نهائي.**

---

## 1. النطاق الكامل لـStage 31

- **Rankings**: wealth / charm / family، بفترات (period)، مع `getMyRank`.
- **Events**: كتالوج أحداث سيرفر-سايد حقيقي (`events-catalog.js`)، missions لكل حدث، progress، share، claim، history.
- **التكامل الحرج**: أي فعل حقيقي فالمنصة (إرسال/استقبال هدية) لازم يقدر يغذي progress مهمة حقيقية فأي حدث نشط، بلا ما تكون خدمة الأحداث (`event.service.js`) عارفة بأي منطق خارجي، وبلا ما تكون الخدمة المصدر (`gifts.service.js`) عارفة بأي شيء عن الكتالوج.

## 2. الكود (مكتوب عبر 4 جلسات، لم يُلمس هذه الجلسة إلا الإضافة الموصوفة فـ§3)

| الملف | الغرض |
|---|---|
| `src/domain/ranking-periods.js` | حساب حدود الفترات (daily/weekly/monthly/all) |
| `src/domain/events-catalog.js` | الكتالوج الحقيقي + `statusOf()` (upcoming/active/ended) |
| `src/database/models/event.model.js` | نموذج progress/claim/share |
| `src/database/repositories/event.repository.js` | In-Memory + Postgres: `upsertProgress`, `getProgress`, `markClaimed`, `listClaimsForAccount`, `recordShare`, `countShares` |
| `src/database/repositories/gift.repository.js` | + `sumBySender`/`sumByReceiver` (لـranking charm/wealth حسب الهدايا) |
| `src/database/schema/018_create_events.sql` | جداول progress/claims/shares |
| `src/services/ranking.service.js` | wealth/charm/family rankings + `getMyRank` |
| `src/services/event.service.js` | كل منطق الأحداث: `listEvents`, `getEvent`, `getMyProgress`, `incrementMissionProgress`, `incrementMissionsByType`, `recordShare`, `claimReward`, `getHistory` |
| `src/services/gifts.service.js` | + dependency اختيارية `eventService` (نفس نمط `accounts` من Stage 27/28): send حقيقي يبلّغ `incrementMissionsByType` بـ`gift_sent` للمرسل و`gift_received` للمستقبل |

## 3. ما تم هذه الجلسة بالضبط (الإضافة الوحيدة، بدليل)

النقطة الوحيدة الناقصة من الجلسة الرابعة: `test/gifts.service.test.js` ماكانتش فيها تست مباشر يأكد أن وصلة `eventService` الاختيارية فـ`gifts.service.js` تشتغل فعليًا (كانت مغطاة بشكل غير مباشر فقط عبر عدم-regression فالسويت الكامل، لأن التستات الموجودة ماكانتش تمرر `eventService` أصلاً).

**الإضافة:**
- `setupWithEvents()` جديدة فنفس الملف، بنفس نمط `setupWithAccounts()` الموجود: تبني `event.service.js` **حقيقي** فوق `event.repository.js` **حقيقي** (In-Memory) و fixture catalog صغير قابل للتحكم (`GIFTS_EVENTS_FIXTURE_CATALOG`، بنفس منطق fixture catalog الموجود فـ`event.service.test.js` — مو الكتالوج الحقيقي، باش التست يتحكم فـ`startAt`/`endAt`/`targetCount` مباشرة بدل الاعتماد على تواريخ حقيقية حية).
- **5 تستات جديدة، كلهم PASS فعليًا:**
  1. send حقيقي (`sendGift`) يزيد progress مهمة `gift_sent` للمرسل على event نشط حقيقي.
  2. نفس الـsend يزيد progress مهمة `gift_received` للمستقبل.
  3. 3 sends متتالية توصل progress لـ3/3 (completed) + claim حقيقي عبر `event.service.js` (credit حقيقي، `walletTransactionId` حقيقي) — end-to-end، بلا أي mock لـ`incrementMissionsByType`.
  4. send مرفوض (insufficient balance، 409) لا يزيد أي progress لا للمرسل ولا للمستقبل.
  5. لما `eventService` يكون غائب (نفس `setup()` القديمة المستعملة فكل التستات السابقة فالملف)، السلوك يبقى بلا تغيير (نفس الـpricing، نفس الـdebit، send ينجح بشكل طبيعي).

**لم يُمس:** أي كود فـ`gifts.service.js` نفسه، أي تست موجود سابقًا فـ`gifts.service.test.js` (الـ9 القدام)، ولا أي ملف آخر فالمشروع.

## 4. نتيجة التستات (بالأرقام الحقيقية، run فعلي)

```
$ node --test test/gifts.service.test.js
# tests 14
# pass 14
# fail 0
```
(9 قديمة + 5 جديدة، كلهم PASS.)

```
$ node --test test/*.test.js
# tests 378
# suites 0
# pass 374
# fail 4
# cancelled 0
# skipped 0
# todo 0
```

**الـ4 fails (بيئية، معروفة من قبل، بلا تغيير):**
- `test/accounts.routes.test.js`
- `test/agora.routes.test.js`
- `test/auth.routes.test.js`
- `test/config.routes.test.js`

السبب فالأربعة: `Error: Cannot find module 'express'` — الـ`node_modules` غير مثبتة (npm install يفشل بـ`403 Forbidden` من `registry.npmjs.org` لأن الشبكة معطلة فهذه البيئة). تحققت من هذا مباشرة (`npm install` حاولت فعليًا هذه الجلسة، رجع 403). هذا قيد بيئي دائم، ماشي regression من هذا الكود — نفس الأربعة أسماء بالضبط من 3 جلسات سابقة متتالية.

**378 = 373 (آخر رقم مؤكد نهاية الجلسة الرابعة) + 5 (تستات `eventService` الجداد هذه الجلسة). صفر تست جديد فشل. صفر regression.**

## 5. لماذا Stage 31 DONE الآن فعليًا (وماشي ادعاء)

- كل جزء فالنطاق (§1) عنده تستات حقيقية PASS: rankings (13)، events catalog/repository (13+7)، event.service منطق كامل (25)، والتكامل الحرج مع gifts (5 جداد + التستات القديمة التسع اللي تأكد عدم تأثرها).
- التكامل end-to-end (send حقيقي → progress حقيقي → claim حقيقي → credit حقيقي بمعاملة محفظة حقيقية) مختبر بتست واحد كامل (رقم 3 فـ§3) بلا أي mock.
- صفر fake/mock: `incrementMissionsByType` تستدعى حقيقيًا (مو stub)، `event.repository.js` المستعمل In-Memory حقيقي (نفس implementation المستعملة فـProduction عبر الواجهة، مو test double منفصل)، الـwallet credit حقيقي بـidempotency key حقيقي.
- صفر regression: 378/378 المتوقع pass لولا القيد البيئي المعروف (npm/express) — نفس الأربعة بالضبط بلا تغيير عبر 4 جلسات متتالية.

## 6. باقي (خارج نطاق Stage 31، لم يُمس)

- Route-level tests (`/platform/api/*`) غير موجودة لأي stage فالمشروع كامل (قيد قديم عام، ماشي خاص بـStage 31 — نفس الحال فـFamily/Store/Referral).
- Postgres-backed تشغيل حي (فقط In-Memory مختبر) — قيد بيئي (لا شبكة/DB حي فهذه البيئة).

## 7. التالي: Stage 32 (Couple/CP + Guard/Fan Club)

قبل البدء: يجب مراجعة خطة الـ40 مرحلة الأصلية لتأكيد نطاق Stage 32 بالضبط (Couple/CP + Guard/Fan Club فقط)، بلا اختراع نطاق زيادة، وبلا تجاوز إلى Stage 33 قبل إنهاء 32 فعليًا (نفس الانضباط المتبع من Stage 30 و31).
