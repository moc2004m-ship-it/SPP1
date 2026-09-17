# Stage 32 (Couple/CP + Guard/Fan Club) — تقرير نهائي

**الحالة: DONE بالكامل، بدليل تست حقيقي run فعليًا هذه الجلسة (التاسعة). هذا الملف يحل محل `STAGE32_PROGRESS_STOPPED.md` (محذوف) كتوثيق نهائي.**

---

## 1. النطاق الكامل لـStage 32

- **Couple/CP**: علاقة زوجية متماثلة بين حسابين (لا هرمية، خلافًا لـFamily) — دعوة/قبول/رفض/إلغاء/فك ارتباط، cp تراكمي حقيقي من هدايا مدفوعة فعليًا بين الشريكين، level محسوب من cp.
- **Guard/Fan Club**: اشتراك فان-مضيف مدفوع بعملات حقيقية، تيرات bronze/silver/gold (سعر+مدة سيرفر-سايد)، تجديد يمدد من `expiresAt` الحالي إذا نشط أو يبدأ من الآن إذا منتهي، لوحة صدارة (fan club) لكل مضيف مرتبة حسب المساهمة التراكمية.

## 2. الكود (كامل، عبر جلستين)

### Couple/CP (من جلسة سابقة، لم يُلمس هذه الجلسة إلا إعادة تحقق)
| الملف | الغرض |
|---|---|
| `src/database/models/couple.model.js` | توليد ids، `assertNotSelfPair` |
| `src/domain/couple-level-curve.js` | منحنى level من cp |
| `src/database/repositories/couple.repository.js` | In-Memory + Postgres: couples + couple_invites |
| `src/services/couple.service.js` | sendInvite/acceptInvite/declineInvite/cancelInvite/listMyInvites/unpair/getStatus/recordGift |
| `src/database/schema/019_create_couples.sql` | جداول couples/couple_invites |
| `src/services/gifts.service.js` | + dependency اختيارية `coupleService.recordGift` بعد send حقيقي |

### Guard/Fan Club (جديد هذه الجلسة، مكتمل)
| الملف | الغرض |
|---|---|
| `src/domain/guard-catalog.js` | تيرات bronze/silver/gold (سعر coins + مدة أيام)، `resolveGuardTier` |
| `src/database/models/guard.model.js` | `generateGuardId`, `generateGuardPurchaseId`, `assertNotSelfGuard` |
| `src/database/repositories/guard.repository.js` | In-Memory + Postgres: جدول `guards` واحد، `renewGuard` (upsert أتومي: يمدد من expiresAt الحالي إذا ساري، أو يبدأ من now() إذا منتهي، totalContributionCoins تراكمي دائمًا) |
| `src/services/guard.service.js` | `purchaseGuard` (wallet debit حقيقي قبل أي منح)، `getGuardStatus`، `listFanClub` — isActive/secondsRemaining محسوبين دائمًا من now() مُحقّن، لا حقل مخزّن |
| `src/database/schema/020_create_guards.sql` | جدول guards، UNIQUE(fan_id, host_id)، CHECK(fan_id <> host_id) |

## 3. الـWiring (كامل، الاثنان معًا)

- `src/database/index.js`: `db.couples` و`db.guards` فكل من builders الـPostgres والـIn-Memory.
- `src/index.js`: `createCoupleService` (مبني قبل `giftsService`، ومُمرَّر لها ولـ`platformRouter`) و`createGuardService` (مستقل، لا تكامل خارجي مطلوب له).
- `src/routes/platform.routes.js`:
  - `/api/couple/invites` (POST/GET mine)، `/api/couple/invites/:inviteId/accept|decline|cancel`، `/api/couple/status`، `/api/couple/:coupleId/unpair`.
  - `/api/guard/purchase` (POST)، `/api/guard/status/:hostId` (GET)، `/api/guard/fan-club/:hostId` (GET).
  - الاثنان: acting account دائمًا `req.session.accountId`، أي `hostId`/`inviteeId`/`coupleId` فالـbody/params هو target فقط أبدًا لا يُستعمل كهوية.

## 4. نتيجة التستات (بالأرقام الحقيقية، run فعلي هذه الجلسة)

```
$ node --test test/couple.service.test.js test/couple.repository.test.js test/couple-level-curve.test.js
# tests 53 / pass 53 / fail 0

$ node --test test/guard-catalog.test.js test/guard.repository.test.js test/guard.service.test.js
# tests 35 / pass 35 / fail 0
```
(guard-catalog: 5، guard.repository: 12، guard.service: 18.)

```
$ node --check src/index.js src/database/index.js src/routes/platform.routes.js src/services/guard.service.js src/database/repositories/guard.repository.js
OK لكل الملفات (صفر خطأ syntax فالـwiring الجديد)

$ node --test test/*.test.js
# tests 466
# suites 0
# pass 462
# fail 4
# cancelled 0
# skipped 0
# todo 0
```

**الـ4 fails (بيئية، معروفة من 5 جلسات سابقة متتالية، بلا تغيير):**
- `test/accounts.routes.test.js`
- `test/agora.routes.test.js`
- `test/auth.routes.test.js`
- `test/config.routes.test.js`

السبب فالأربعة: `Error: Cannot find module 'express'` — `node_modules` غير مثبتة (لا شبكة فهذه البيئة). قيد بيئي دائم، ماشي regression — نفس الأربعة أسماء بالضبط.

**466 = 431 (baseline قبل Guard) + 35 (guard-catalog: 5 + guard.repository: 12 + guard.service: 18). صفر تست جديد فشل. صفر regression.**

## 5. لماذا Stage 32 DONE الآن فعليًا (وماشي ادعاء)

- **Couple/CP**: كود+wiring+تكامل gifts (من جلسة سابقة) مؤكد بإعادة تشغيل فعلية هذه الجلسة (53/53 + السويت الكامل قبل إضافة Guard: 431/427/4، صفر regression عن آخر checkpoint).
- **Guard/Fan Club**: مسار كامل end-to-end مختبر بلا أي mock —
  - `purchaseGuard` يدبت المحفظة الحقيقية (`InMemoryWalletRepository` حقيقي، مو stub) بالسعر الحقيقي من الكتالوج **قبل** أي `renewGuard`؛ رصيد غير كافٍ يفشل الدبت (409) ولا يُنشئ أي صف guard ولا يمس الرصيد.
  - منع self-guard (400)، tier غير معروف (400)، كلاهما يفشلان قبل أي دبت.
  - التجديد مختبر فكلا الاتجاهين: يمدد من expiresAt الحالي وهو ساري (تست مباشر يقارن التاريخ الناتج حسابيًا)، ويبدأ من now() وهو منتهي (نفس الشيء).
  - `totalContributionCoins` تراكمي عبر تجديدات متعددة، حتى بعد انتهاء الاشتراك — مختبر مباشرة.
  - `isActive`/`secondsRemaining` فـ`getGuardStatus` و`listFanClub` محسوبة من `now()` مُحقّن، لا حقل staleness-prone — مختبرة نشطة ومنتهية.
  - `listFanClub` مرتبة تنازليًا حسب المساهمة، معزولة لكل host — مختبرة بثلاث fans مختلفين.
  - idempotency: كل شراء يولّد `purchaseId`/`walletTransactionId` جديدين، والرصيد ينخصم فعليًا فكل مرة (لا إعادة استخدام مفتاح) — مختبر مباشرة.
- **صفر fake/mock** فأي من الاثنين: `InMemoryWalletRepository` و`InMemoryGuardRepository`/`InMemoryCoupleRepository` هي نفس implementations المستعملة فـProduction عبر `database/index.js`, مو test doubles منفصلة.
- **صفر regression**: 462/466 (4 fails بيئية دائمة معروفة فقط)، مؤكد بتشغيل فعلي بعد كل خطوة (كتابة، ثم wiring، ثم السويت الكامل).

## 6. الملفات (تراكمي، Guard/Fan Club جديد هذه الجلسة)

**جديد:**
```
Backend/src/domain/guard-catalog.js
Backend/src/database/models/guard.model.js
Backend/src/database/repositories/guard.repository.js
Backend/src/services/guard.service.js
Backend/src/database/schema/020_create_guards.sql
Backend/test/guard-catalog.test.js
Backend/test/guard.repository.test.js
Backend/test/guard.service.test.js
```

**تعديل:**
```
Backend/src/database/index.js       (db.guards فكل من InMemory + Postgres builders)
Backend/src/index.js                (createGuardService، مُمرَّر لـplatformRouter)
Backend/src/routes/platform.routes.js  (راوترات /api/guard/...)
```

**لم يُلمس:** كل ملفات Couple/CP، وكل ملفات Stage 10، 14، 16، 23، 27/28، 29، 30، 31.

## 7. باقي (خارج نطاق Stage 32، لم يُمس)

- `PostgresGuardRepository`/`PostgresCoupleRepository` مكتوبة ومراجعة كودياً لكن **لم تُشغَّل ضد قاعدة حقيقية إطلاقًا** فهذه البيئة (لا شبكة) — نفس الحالة كباقي كل Postgres* repository فالمشروع.
- Stage 33 (Push)، Stage 34، Stage 35، Games (20-22)، Mobile UI، Music/DJ — **غير مبدوءة**، كما كانت.
