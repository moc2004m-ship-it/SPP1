# Stage 3 — Database Design / Basic Account Model

نطاق هذا المستند: **Stage 3 فقط**، كما ورد حرفيًا في خطة المشروع. لا يوجد
هنا أي شيء من Stage 4 أو ما بعدها (لا Agencies، لا عمولات، لا سحب نقدي).

---

## 1) Account Model

الكيان الأساسي هو **الحساب (Account)** — `Backend/src/database/models/account.model.js`.

| الحقل | القيمة الافتراضية | مين بيحددها |
|---|---|---|
| `id` | مولّد تلقائيًا (`usr_<uuid>`) | Backend فقط |
| `vip` | `0` | Backend فقط |
| `svip` | `0` | Backend فقط |
| `lvl` | `0` | Backend فقط |
| `coins` | `0` | Backend فقط |
| `diamonds` | `0` | Backend فقط |
| `createdAt` / `updatedAt` | وقت الإنشاء (ISO 8601) | Backend فقط |

الدالة `createAccount()` **لا تقبل أي مدخلات من العميل إطلاقًا** — توقيعها
بدون أي parameters. حتى لو حاول caller تمرير قيم، مفيش أي سطر كود بيقرأها.
هذا مثبت باختبار `test/account.model.test.js` ("createAccount takes no
client input and cannot be influenced by one").

الكائن المُرجَع `Object.freeze()` — أي محاولة تعديل بعد الإنشاء بتفشل بدل
ما تتجاهل بصمت.

> **ملاحظة تحديث (خارج نطاق Stage 3 نفسه):** مراحل لاحقة أضافت حقولًا على
> نفس الموديل بشكل تراكمي فقط (بدون تعديل مبدأ الـ Stage 3 الأساسي):
> `xp` و`lifetimeDiamondsRecharged` (Stage 27/28، تُستخدم لحساب `lvl`/`vip`/
> `svip` تلقائيًا من عداد سيرفر-سايد) و`deletedAt` (Stage 34، soft-delete
> فقط). القيم الافتراضية لكل هذه الحقول الجديدة كمان `0`/`null` من السيرفر
> حصريًا — نفس مبدأ Stage 3 تمامًا، ولم يُعَد بناء أي شيء من الصفر.

---

## 2) User ID Generation

- الملف: `Backend/src/database/id-generator.js`.
- الآلية: `crypto.randomUUID()` (جزء أصلي من Node.js — بدون أي مكتبة خارجية).
- الشكل: `usr_<uuid-v4>` للحسابات، و`txn_<uuid-v4>` للـ Reference/Transaction.
- **مين بيولّده:** Backend فقط، داخل `createAccount()` نفسها. لا يوجد أي
  route أو model بيقبل `id` جاهز من طلب العميل.
- **التفرد:** UUID v4 عمليًا فريد؛ اختبار `id-generator.test.js` بيتأكد من
  عدم تكرار 1000 قيمة متتالية.

---

## 3) Default Values

القيم الافتراضية (`vip=0, svip=0, lvl=0, coins=0, diamonds=0`) مثبّتة على
مستويين مستقلين، عشان لو مستوى اتخطّى بالغلط يفضل التاني حاميها:

1. **مستوى التطبيق (Application level):** هارد-كودد داخل `account.model.js`
   نفسها — مش مجرد قيمة افتراضية بتتقرا من env أو config.
2. **مستوى قاعدة البيانات (Database level):** `DEFAULT 0` + `CHECK (... >= 0)`
   على كل عمود في `schema/001_create_accounts.sql`، جاهزة للحظة ما تتوصل DB
   حقيقية.

---

## 4) Backend Source of Truth

Backend هو المصدر الوحيد للحقيقة بالنسبة لـ:

- **الحسابات:** عن طريق `src/database/index.js` (factory واحد) →
  `db.accounts` — لا يوجد أي طريقة تانية للوصول للحسابات في المشروع.
- **الأرصدة (coins/diamonds) والصلاحيات (vip/svip/lvl):** بتتحدد فقط جوه
  `createAccount()`. الـ routes (`routes/accounts.routes.js`) **لا تقرأ
  `req.body` إطلاقًا** عند إنشاء حساب — أي قيمة يبعتها العميل (حتى لو
  `id`/`vip`/`coins`) بتتجاهل تمامًا. مُثبَت باختبار
  "POST /accounts ignores client-supplied sensitive fields".
- **النتائج والرومات:** لم تُبنَ أي بنية بيانات لها في Stage 3 (خارج
  النطاق المطلوب حاليًا) — لكن أي بنية مستقبلية لازم تتبع نفس المبدأ:
  الـ backend/repository هو اللي بيكتب، مش العميل.

---

## 5) Reference / Transaction Model (عام لأي مرحلة قادمة)

- الملف: `Backend/src/database/models/reference.model.js`
  + الجدول: `Backend/src/database/schema/002_create_references_log.sql`.
- **متعمّد إنه عام:** مفيش ربط بـ coins/diamonds أو أي عملية مالية محددة.
  الحقول: `id` (`txn_<uuid>`), `type` (نص حر يحدده أي stage مستقبلية),
  `status` (`pending|completed|failed|reversed`), `userId` (اختياري),
  `amount`/`currency` (اختياريين — مش كل reference مالي), `metadata`
  (JSON حر), `createdAt`/`updatedAt`.
- **قابل للتتبع والمراجعة:** كل سجل له ID فريد، حالة، وطابع زمني —
  الحقل `metadata` مفتوح لأي بيانات إضافية تحتاجها مرحلة مستقبلية بدون
  تعديل الـ schema.
- **بدون إعادة بناء لاحقًا:** أي stage مالية قادمة تقدر تستخدم
  `references_log` مباشرة، أو تضيف جدول جديد بـ foreign key عليه، من غير
  ما تلمس Stage 3.

---

## 6) Security Boundaries

- الـ Routes الوحيدة الموجودة الآن (`POST /accounts`, `GET /accounts/:id`)
  **لا تقبل أي جسم طلب (body) للحقول الحساسة** — مفيش حتى محاولة قراءة.
- كل الكتابة تمر حصريًا عبر `Repository.create()` اللي بيستدعي الـ model
  دايمًا — مفيش أي مكان في المشروع بيبني كائن حساب "يدويًا".
- الـ ID مولّد سيرفر-سايد بس، مفيش أي endpoint بيقبل ID جاهز من العميل.
- ممنوع تمامًا في Stage 3: أي بنية لـ Agencies، Agency commissions، Cash
  withdrawal/Cash-out. تم التأكد بفحص نصي شامل على كل ملفات Stage 3
  (`grep` لكلمات agency/commission/withdraw/cash-out ومرادفاتها بالعربي) —
  النتيجة الوحيدة كانت في التعليقات التي تنص صراحة أنها **غير منفذة
  ومؤجلة**، وليست أي كود فعلي.

---

## 7) ما تم تأجيله للمراحل القادمة

راجع [`STAGE3_TODO.md`](./STAGE3_TODO.md) للتفاصيل الكاملة. باختصار:

- الاتصال الفعلي بقاعدة بيانات Postgres حقيقية (الكود جاهز، الاتصال لأ).
- تشغيل `migrate.js` فعليًا على تلك القاعدة.
- تثبيت حزمة `pg` عبر `npm install` (يحتاج اتصال إنترنت غير متاح في بيئة
  التنفيذ الحالية — نفس القيد المسجل في `STAGE1_TODO.md`).
- أي منطق أعمال (business logic) لاستخدام `references_log` فعليًا —
  متروك بالكامل لأي Stage مالية قادمة.
