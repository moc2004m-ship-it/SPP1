# المرحلة 4 — Config API + Splash / Onboarding

هذا المجلد يوثّق **بنود المرحلة 4 فقط**، بنفس أسلوب `Database/` (Stage 3)
و`DesignSystem/` (Stage 2): وثائق تصميم + تقرير Audit + TODO مؤجَّل. أما
الكود الفعلي فموزّع حسب موقعه الطبيعي في المشروع:

```
Backend/src/config/        # Config schema + service + local fallback (server)
Backend/src/routes/config.routes.js   # GET /config
Backend/test/config.*.test.js         # اختبارات Config

Localization/               # اللغات المدعومة + نصوص ar/en + المحمّل المركزي

Mobile/app/                  # Splash + Onboarding + Config client (الاستهلاك)
```

## لماذا هذا التوزيع؟

نفس منطق Stage 3 بالضبط: `Database/` كان مجلد توثيق فقط، والكود الفعلي
عاش داخل `Backend/src/database/`. هنا `Config/` توثيق فقط، والكود الفعلي
Backend-side عاش في `Backend/src/config/`، والكود الفعلي Client-side عاش
في `Mobile/app/` (لأنه Splash/Onboarding فعليًا هما شاشات التطبيق، مكانها
الطبيعي هو مجلد التطبيق `Mobile/`، مش مجلد توثيق).

اللغات (`Localization/`) اتحطت في مجلد مستقل على مستوى الجذر، مش داخل
`DesignSystem/` ولا داخل `Mobile/`، لأنها **مصدر حقيقة مشترك** بين
الاثنين: أي شاشة مستقبلية (Backend error messages، Mobile screens، حتى
DesignSystem demos لاحقًا) المفروض تسحب النصوص من نفس المكان بدل ما كل
جزء من المشروع يعمل نسخته الخاصة.

## أين أبدأ؟

- **تصميم Config الكامل (Schema/Validation/Fallback/API):**
  [`CONFIG_DESIGN.md`](./CONFIG_DESIGN.md)
- **تقرير التسليم والـ Audit:** [`STAGE4_REPORT.md`](./STAGE4_REPORT.md)
- **كل ما يحتاج Backend/Cloud/قرار لاحق:** [`STAGE4_TODO.md`](./STAGE4_TODO.md)
- **تشغيل الشاشات (Splash/Onboarding) فعليًا:**
  [`Mobile/app/README.md`](../Mobile/app/README.md)
