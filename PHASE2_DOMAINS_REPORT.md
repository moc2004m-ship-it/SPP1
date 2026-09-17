# تقرير المتابعة 2 — Phase 2: باقي الدومينات (Rooms→Moderation) على Postgres/Supabase حقيقي

**التاريخ:** 13 سبتمبر 2026

---

## 0. ما طلبته بالضبط، وما فعلته

طلبت إكمال ربط: Rooms, Battles, Games, Gifts, Family, Events, Notifications, Settings, Moderation/Support بـPostgres/Supabase حقيقي، بدون إعادة Auth أو Wallet، وبدون InMemory كحل نهائي، وبدون ادّعاء DONE بلا اختبار حقيقي.

**القرار المعماري الذي اتخذته (ولازم توافق عليه):** هذه التسعة دومينات كانت جميعها، قبل هذه الجلسة، تُخزَّن في مصفوفة واحدة عامة داخل الذاكرة (`FeatureStore` في `feature-platform.js`) — كل دومين هو رقم "stage" يُضاف له سجل JSON عام، بلا جدول خاص به. بدل إعادة تصميم تسعة جداول علائقية منفصلة من الصفر (وهذا عمل ضخم لكل دومين، ويخالف "لا تبدأ من الصفر")، نقلت **نفس التصميم بالضبط** إلى جدول Postgres حقيقي واحد (`feature_records`، عمود JSONB)، بنفس نمط `wallet_repository.js`/`account_repository.js` (InMemory + Postgres، قابل للتبديل بنفس متغيرات البيئة).

**هذا يعني:** البيانات الآن حقيقية وتُخزَّن بشكل دائم (تنجو من إعادة التشغيل) عند تفعيل Postgres — هذا ليس InMemory كحل نهائي. لكنه **لا** يضيف قيوداً علائقية خاصة بكل دومين (مثل foreign key من room إلى account، أو unique constraint على matchId) — هذه القيود موجودة فقط على مستوى الكود (`requireId`/`requireString`) كما كانت من قبل. أي دومين يحتاج قيوداً حقيقية إضافية (مثل ما فعلته مع Wallet: منع رصيد سالب + idempotency) يحتاج جدول خاص به لاحقاً — هذا مذكور صراحة كخطوة تالية ممكنة، وليس ادّعاءً بأنه تم.

---

## 1. الملفات الجديدة/المعدَّلة هذه الجلسة

### جديدة
| الملف | الوصف |
|---|---|
| `Backend/src/database/schema/004_create_feature_records.sql` | جدول `feature_records` (id, stage, data JSONB, created_at, updated_at) + index على (stage, created_at). |
| `Backend/src/database/repositories/feature-record.repository.js` | `InMemoryFeatureRecordRepository` (نشطة الآن) + `PostgresFeatureRecordRepository` (جاهزة، غير مُختبرة على قاعدة حقيقية). |
| `Backend/test/feature-record.repository.test.js` | 4 اختبارات حقيقية للـrepository الجديد. |

### معدَّلة
| الملف | التعديل |
|---|---|
| `Backend/src/feature-platform.js` | `FeatureStore` أصبحت غلافاً async حول repository حقيقي بدل مصفوفة في الذاكرة مباشرة. `createPlatform({store})` يقبل الآن store خارجي (متوافق للخلف: بدون args تبقى كما كانت). منطق كل دومين (rooms/battles/games/...) لم يتغيّر حرفياً — فقط أصبح async لأن `store.add/list/find` أصبحت async. أصلحت `social.allowed` (كانت ستنكسر بصمت مع async). |
| `Backend/src/routes/platform.guards.js` | `requireRoomOwner` أصبحت async (لأنها تستخدم `store.find`). |
| `Backend/src/routes/platform.routes.js` | كل route handler يلمس `platform.store` أصبح async ويعمل `await` — لا تغيير في منطق الصلاحيات/الهوية الذي أثبته `AUTH_MIDDLEWARE_REPORT.md` سابقاً، فقط التوافق مع async. |
| `Backend/src/database/index.js` | إضافة `featureRecords` repository لنفس factory (InMemory/Postgres حسب `STAGE3_ENABLE_POSTGRES`). |
| `Backend/src/index.js` | تمرير `db.featureRecords` عبر `new FeatureStore(...)` إلى `createPlatform`. |
| `Backend/test/feature-platform.test.js` | تحديث لاستخدام `await` (نفس الأسينشيوهات القديمة تماماً + إضافة اختبارين للتحقق من أن البيانات فعلاً تُقرأ عبر store.list/find، وأن منصتين منفصلتين لا تتشاركان بيانات). |
| `Backend/test/platform.auth.guards.test.js` | 3 اختبارات `requireRoomOwner`/`rooms.create` عُدِّلت لـ`await`/`assert.rejects` بدل sync. |
| `Backend/.env.example` | إضافة `WALLET_INTERNAL_KEY` (كانت مفقودة من التوثيق). |

**لم أحذف أي كود صحيح.** كل تعديل هو: (أ) نقل نفس المنطق من array محلي إلى repository حقيقي، أو (ب) إضافة `await` حيث أصبح ذلك ضرورياً تقنياً بسبب (أ). لم يتغيّر شكل أي API response أو أي قرار صلاحيات.

---

## 2. الاختبار الفعلي الذي تم — Verification بعد كل جزء

✅ `node --check` على **كل** ملفات `src/` و`test/` في Backend (بدون استثناء) — نجح بلا أخطاء.

✅ **66 اختبار حقيقي** عبر `node --test test/*.test.js`:
- **63 نجح** (52 من قبل + 4 جديدة لـ feature-record repository + تعديلات feature-platform/guards بلا فقدان أي تغطية).
- **3 فشلت** — وهي **بالضبط** نفس الثلاثة الموثّقة مسبقاً في `AUTH_MIDDLEWARE_REPORT.md` كـBLOCKED (`accounts.routes.test.js`, `auth.routes.test.js`, `config.routes.test.js`) بسبب غياب `express` في `node_modules` — **لم أُحدث أي regression جديد**، تحققت أنها نفس السبب (`Cannot find module 'express'`) وليس خطأ نتج عن تعديلاتي.

✅ **اختبار تكاملي يدوي إضافي** (end-to-end عبر كل الطبقات الحقيقية معاً — store حقيقي + platform + guards، بدون أي mock): أنشأت room → battle → game → gift → family → event → notification → setting → moderation report بالتتابع على نفس الـstore، ثم تحققت أن:
- كل سجل يُقرأ صحيحاً عبر `store.list()` بعد الإضافة (يثبت أن الكتابة/القراءة الحقيقية تعمل، وليس فقط أنها لا ترمي خطأ)
- `requireRoomOwner` يقبل المالك الحقيقي ويرفض متطفلاً حقيقياً (403) على غرفة محفوظة فعلياً في الـstore، وليس بيانات وهمية

النتيجة الكاملة لهذا الاختبار موثّقة في نص هذه المحادثة (تم تشغيله فعلياً، وليس افتراضاً).

❌ **لم يُختبر (ولا أستطيع اختباره من هنا):** `PostgresFeatureRecordRepository` ضد أي قاعدة Postgres/Supabase حقيقية متصلة فعلياً — **BLOCKED**، بنفس السبب الدقيق الموثّق سابقاً: هذا الـsandbox بلا اتصال إنترنت (أعدت التأكد: `npm install` لا يزال يرجع 403 من registry.npmjs.org). لا يوجد أي طريقة لي لتشغيل `pg` الحقيقي أو الاتصال بأي Supabase من هذه الجلسة — بغض النظر عمّا تزوّدني به من بيانات اتصال.

---

## 3. الخلاصة النهائية — Phase 2

| الدومين | الحالة |
|---|---|
| Wallet (من الجلسة السابقة) | **DONE** — schema + idempotency + منع رصيد سالب، مُختبر منطقياً (InMemory)، **BLOCKED** فعلياً على Postgres حقيقي |
| Rooms, Battles, Games, Gifts, Family, Events, Notifications, Settings, Moderation/Support | **DONE جزئياً** — الكود والـschema والاختبارات المنطقية جاهزة وتعمل حقيقياً (InMemory)، بنفس نمط Wallet، **BLOCKED** فعلياً على Postgres/Supabase حقيقي لنفس سبب انعدام الشبكة |
| قيود علائقية خاصة بكل دومين (مثل ما حدث لـWallet: CHECK/UNIQUE مخصصة) | **لم يبدأ** — الجدول الحالي عام (JSONB)، ولا يوجد قيد قاعدة بيانات خاص بكل دومين بعد |
| تشغيل فعلي كامل على Supabase حقيقي (migrate + npm test) لأي دومين | **BLOCKED** — لا يوجد اتصال إنترنت في هذا الـsandbox، تم التحقق فعلياً وليس افتراضاً |
| Phase 3 (Mobile → Backend) | **لم يبدأ بعد**، بانتظار قرارك: هل هذا المستوى من Phase 2 (JSONB عام + repository حقيقي قابل للتفعيل) كافٍ للانتقال، أم تريد قيوداً علائقية مخصصة لكل دومين أولاً؟ |

**لتشغيل هذا فعلياً على Supabase عندك:**
```bash
npm install
export DATABASE_URL="<supabase connection string>"
export STAGE3_ENABLE_POSTGRES=true
export WALLET_INTERNAL_KEY="<a real random secret>"
npm run migrate     # يطبّق 001, 002, 003, 004 بالترتيب — بما فيها feature_records
npm test            # كل الاختبارات، بما فيها HTTP الكاملة التي لا تعمل هنا
```
