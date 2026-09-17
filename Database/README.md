# Database — Stage 3

هذا المجلد يوثّق **Stage 3: Database Design / Basic Account Model** فقط.
الكود الفعلي (schema/models/repositories/routes) موجود داخل `Backend/src/`
لأنه جزء من الـ backend نفسه ويحتاج يتحمّل بـ `require()` من هناك — هذا
المجلد هو التوثيق والتصميم، على نفس نمط `DesignSystem/` في Stage 2.

## أين الكود فعليًا

```
Backend/
├── src/
│   ├── database/
│   │   ├── schema/                     # SQL — Source of Truth للبنية (Postgres)
│   │   │   ├── 001_create_accounts.sql
│   │   │   └── 002_create_references_log.sql
│   │   ├── models/
│   │   │   ├── account.model.js        # Basic Account Model + defaults
│   │   │   └── reference.model.js      # Generic Reference/Transaction Model
│   │   ├── repositories/
│   │   │   ├── account.repository.js   # In-memory (نشط الآن) + Postgres (جاهز لاحقًا)
│   │   │   └── reference.repository.js # نفس النمط
│   │   ├── migrations/
│   │   │   └── migrate.js              # مؤجَّل التنفيذ حتى تتصل DB حقيقية
│   │   ├── id-generator.js             # توليد User ID / Reference ID من السيرفر فقط
│   │   └── index.js                    # نقطة الدخول الوحيدة (factory)
│   └── routes/
│       └── accounts.routes.js          # POST/GET /accounts
├── scripts/
│   └── create-demo-account.js          # حساب تجريبي عبر الـ backend الحقيقي
└── test/                               # اختبارات node:test لكل ما سبق
```

## اقرأ أيضًا

- [`DATABASE_DESIGN.md`](./DATABASE_DESIGN.md) — الشرح الكامل المطلوب في بند 11
  (Account Model, User ID generation, Default values, Backend Source of
  Truth, Reference/Transaction model, Security boundaries, ما تم تأجيله).
- [`STAGE3_REPORT.md`](./STAGE3_REPORT.md) — تقرير التسليم والـ Audit.
- [`STAGE3_TODO.md`](./STAGE3_TODO.md) — كل ما هو مؤجَّل لسبب حقيقي (شبكة/حساب خارجي).
