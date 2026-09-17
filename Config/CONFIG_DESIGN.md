# CONFIG_DESIGN — تصميم نظام Config + اللغات + Splash/Onboarding

## 1) فلسفة التصميم

> "لا تجعل الـ client هو مصدر الحقيقة النهائي" — المطلوب الأصلي.

القرار المعماري الأساسي في Stage 4: **الـ Backend هو مصدر الحقيقة**
لأي إعداد عام (لغة افتراضية، صيانة، نسخة، feature flags، محتوى
Onboarding)، والـ Client لا يخزّن نسخته الخاصة كمصدر دائم — فقط:

1. يحاول يجيب Config من الـ Backend (`GET /config`).
2. لو فشل، يستخدم **Local Safe Config** محلي (ملف JSON مُعلَّم صراحة
   Development/Fallback).
3. لو حتى الملف المحلي فشل تحميله (حالة نادرة جدًا — راجع § 6)، يستخدم
   نسخة embedded صغيرة في الكود نفسه، عشان الشاشة متفضلش فاضية أو تنهار.

الـ Backend نفسه (Stage 4) لسه بياخد Config من ملف محلي
(`local-config.json`) مش من قاعدة بيانات حقيقية — لكن هذا تفصيل تنفيذ
داخلي فقط، مش جزء من العقد (Contract) اللي بيشوفه الـ Client. استبدال
مصدر الـ Backend بقاعدة بيانات/لوحة تحكم في مرحلة لاحقة **لا يتطلب أي
تغيير في الـ Schema أو الـ Route أو أي كود Client** — راجع
`STAGE4_TODO.md`.

## 2) Config Schema

المصدر الوحيد للحقيقة: `Backend/src/config/config.schema.js`
(`DEFAULT_CONFIG` + `validateConfig()`).

```
{
  configVersion: number,
  app: { nameKey: string, environmentLabel: string },
  languages: { supported: string[], default: string },   // default ∈ supported
  maintenance: { enabled: boolean, messageKey: string },
  version: { minimumSupported: "x.y.z", latestRecommended: "x.y.z" },
  featureFlags: { onboardingEnabled: boolean, ... },
  onboarding: {
    skipEnabled: boolean,
    slides: [{ id: string, icon: string, titleKey: string, bodyKey: string }, ...]
  }
}
```

**قرار مهم:** `onboarding.slides` ما بيحملش نص اللغة نفسه — بيحمل
`titleKey`/`bodyKey` بس (مفاتيح Localization). ده يحقق شرطين مع بعض:
- Config يتحكم في "إيه اللي موجود وبأي ترتيب" (ممكن تضيف/تحذف/ترتّب
  Slide من غير ما تلمس كود أو تضيف ترجمة جديدة لو استخدمت مفاتيح
  موجودة).
- Localization يتحكم في "بيقول إيه" لكل لغة — مفيش نص لغة متبعثر جوه أي
  ملف Config أو أي شاشة.

## 3) Validation + Fallback (Backend)

`Backend/src/config/config.service.js`:

1. يقرأ `local-config.json`.
2. يعمل **deep-merge** فوق `DEFAULT_CONFIG` (مش استبدال كامل — لو الملف
   عدّل حقل واحد بس، الباقي كله يفضل من الـ Default).
3. يشغّل `validateConfig()` على الناتج.
4. لو كل حاجة تمام → `{ config: merged, source: 'local-file' }`.
5. لو أي خطوة فشلت (ملف مفقود / JSON غير صالح / فشل Validation) →
   `{ config: DEFAULT_CONFIG, source: 'default-fallback', errors: [...] }`
   — **مفيش استثناء (throw) بيوصل للـ route أبدًا**، ده متعمَّد.

نتيجة عملية: الـ endpoint (`GET /config`) بيرجّع دايمًا Config صحيح
بنيويًا (Schema-valid)، حتى لو الملف المحلي اتبعت فيه أو اتمسح بالغلط.

## 4) Config API Structure

```
GET /config
```

Response:
```json
{
  "config": { ...same shape as § 2... },
  "meta": {
    "apiVersion": "v1",
    "source": "local-file",
    "servedAt": "2026-...",
    "warnings": ["..."]   // موجود فقط لو حصل fallback
  }
}
```

- **مافيش auth** — Config عام وللقراءة فقط، مفيش بيانات حساسة فيه (راجع
  § 7 Security).
- **Versioning**: الـ response متغلّف بـ `meta.apiVersion` بدل ما ترجع
  Config عارية، عشان أي تغيير مستقبلي في شكل الـ Response يبقى قابل
  للتمييز من غير ما يكسر Clients قديمة اللي بتقرا `config` بس.
- **Error handling**: لو حصل استثناء غير متوقع أصلًا (نظريًا مش متوقع لأن
  `getConfig()` مصمم إنه ميرميش) → `503 { error: 'config_unavailable' }`.
  الـ Client هو المسؤول عن التصرف وقتها (Local Safe Config) — مش
  الـ Backend بيحاول يخمّن.

## 5) نظام اللغات (`Localization/`)

```
Localization/
├── languages.json      # قائمة اللغات المدعومة (code/name/direction) + الافتراضية
├── strings/ar.json      # كل نصوص الواجهة بالعربي
├── strings/en.json      # نفس المفاتيح بالإنجليزي
└── i18n.js              # المحمّل المركزي (loadStrings, t, getSupportedLanguages)
```

- **قاعدة صارمة:** أي شاشة (Splash/Onboarding/أي شاشة لاحقة) تستورد
  `t()`/`loadStrings()` من هنا فقط — ممنوع نص عربي/إنجليزي inline جوه
  أي `.html`/`.js` شاشة. تم التحقق من ده بفحص يدوي لكل ملفات
  `Mobile/app/screens/*` (راجع STAGE4_REPORT.md § الاختبارات).
- **RTL/LTR:** كل لغة في `languages.json` عندها `direction` صريح. الشاشات
  بتستخدم `theme.js` الموجود من Stage 2 (`setDirection()`) بدل ما تحسب
  RTL/LTR بنفسها.
- **مقاومة الأعطال:** `i18n.js` لو فشل يحمّل `languages.json` أو
  `strings/<code>.json` (مثلاً فتح المشروع بـ `file://` ومنع المتصفح
  لـ `fetch` محلي) بيرجع لمجموعة نصوص embedded صغيرة (Splash فقط) بدل ما
  يرمي استثناء يوقف الشاشة كلها.

## 6) Splash — الحالات الكاملة

`Mobile/app/screens/splash/`:

| الحالة | إيه اللي بيحصل |
|---|---|
| Loading | Spinner + عنوان التطبيق + Tagline، من أول لحظة |
| Success | تحميل Config + اللغة، ثم انتقال لـ Onboarding أو Login |
| Offline | Banner واضح "أنت غير متصل" + الاستمرار بـ Local Safe Config |
| Maintenance | لو `config.maintenance.enabled === true` → رسالة صيانة + زر إعادة محاولة، بدون انتقال |
| Error | فقط لو حصل خطأ غير متوقع فعلاً (كل الاحتمالات التانية اتغطّت بالـ fallback) → رسالة خطأ + زر Retry |
| Retry | يعيد تشغيل نفس دورة الـ bootstrap من الأول |

## 7) Onboarding — الخطوات

`Mobile/app/screens/onboarding/`:

1. **اختيار اللغة** (أول خطوة) — تُطبَّق فورًا (RTL/LTR + كل النصوص).
2. **Slides** من `config.onboarding.slides` (عدد/محتوى/ترتيب قابل للتعديل
   من Config لاحقًا بدون تعديل كود).
3. **Skip** (يظهر فقط لو `config.onboarding.skipEnabled === true`) —
   يقفل الـ Onboarding فورًا.
4. **حفظ الحالة**: `Mobile/app/state/onboarding-state.js` — أول ما
   يخلص/يتخطى، يتسجل كمكتمل ومايتعرضش تاني (`localStorage`، مع fallback
   في الذاكرة لو `localStorage` مش متاح — راجع STAGE4_TODO.md لتخزين
   حقيقي على مستوى الجهاز في تطبيق Mobile فعلي لاحقًا).
5. الانتقال النهائي لشاشة تسجيل الدخول (`DesignSystem/screens/login/`
   من Stage 2 — بدون أي تعديل عليها).

## 8) Security

- لا يوجد أي API key/secret/production credential داخل أي ملف من هذه
  المرحلة (`local-config.json`, `local-safe-config.json` كلاهما بيانات
  عامة/تطويرية فقط).
- Config الحالي كله بيانات عامة (لغات مدعومة، صيانة، نسخة، محتوى
  Onboarding) — لا يوجد فيه أي بيانات مستخدم أو صلاحيات.
