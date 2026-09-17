# تدقيق شامل: جاهزية المشروع 100% (بدون أي كود مُولَّد في هذا الملف)

رأيي بصراحة أول شي: هاذ المشروع **مبني بانضباط ملحوظ** — كل نقطة ناقصة موثقة
بصراحة في ملفات `*_TODO.md` بدل ما تتخبى، وكل مكان كان يقدر يستعمل بيانات
وهمية (SMS، OAuth، RTC Token، Cloud Deploy) **يفشل بوضوح (fail closed)**
بدل ما يتظاهر بالنجاح. هذا نادر وممتاز. لكن معناه أيضاً إنه فيه بزاف حسابات
وقيم خارجية حقيقية لازم تجيب أنت باش يشتغل فعلاً — هذا الملف يلخصها كلها.

---

## 1) بيانات وهمية موجودة فعلاً حالياً (ليست خداع — لكن لازم تعرفها)

ما لقيتش أي "بيانات مزيفة يتظاهر الكود إنها حقيقية". اللي كاين هو حالتين
واضحتين ومُعلنتين:

| المكان | الوضع الحالي | ليه مو خطر |
|---|---|---|
| `Backend/src/config/local-config.json` | ملف Config محلي فيه قيم تطوير (`environmentLabel: development`, نسخة `1.0.0`...) | مكتوب صراحة `"_note": "Development/fallback config only"` — مش سر ولا Fake، بس لازم يتغير وقت production |
| بيانات النطاقات 6-35 (Rooms/Events/Wallet/Gifts/...) | كلها **In-Memory** — تختفي عند إعادة تشغيل الـ Backend | مو "بيانات وهمية"، هي بيانات حقيقية لكن **غير دائمة** (مفيش Postgres حقيقي متصل بعد) |

---

## 2) بيانات/حسابات خارجية ناقصة تماماً (لازم تجيبها أنت)

هاذو ما يقدرش أي كود يعوّضهم — لازم قرار أو حساب حقيقي منك:

| # | القيمة الناقصة | وين تتحط | تأثير عدم توفرها الآن |
|---|---|---|---|
| 1 | `AGORA_APP_CERTIFICATE` | env السيرفر الحقيقي فقط | `/platform/api/rtc/token` يرجع 503 (مش fake token) |
| 2 | `DATABASE_URL` حقيقي (Postgres فعلي) + `STAGE3_ENABLE_POSTGRES=true` | env السيرفر | البيانات تبقى In-Memory (تضيع عند أي Restart) |
| 3 | SMS Provider: `url` + `headers` + `messageTemplate` (`Backend/src/auth/otp-sender.js`) | Config/env الخاص بالمصادقة | إرسال OTP يفشل بـ503 بدل ما يبعت SMS حقيقي |
| 4 | Google OAuth: تأكيد `userInfoUrl`/Client ID الحقيقي | Config | تسجيل الدخول بـGoogle يشتغل بس على القيمة الافتراضية العامة — يحتاج مراجعة لمشروعك الخاص |
| 5 | Facebook Login: نفس الشيء (`userInfoUrl`/App credentials) | Config | نفس ملاحظة Google |
| 6 | Apple: `jwksUrl` + `issuer` + `audience` | Config | بدونها، تسجيل الدخول بـApple يفشل بـ503 دايماً حالياً (503 مقصود، مش خطأ) |
| 7 | `LOG_DRAIN_URL` (Better Stack/Logtail أو مكافئ) | secrets الـ CI/CD | الـ logging يشتغل محلي فقط، بدون تجميع مركزي |
| 8 | `WALLET_INTERNAL_KEY` حقيقي عشوائي | secrets السيرفر | `/internal/wallet/*` غير محمي فعلياً بدونه |
| 9 | حساب Cloud حقيقي (Render/Fly.io/غيره) لنشر Staging/Production | خارج المشروع | خطوة `deploy-staging` في CI حالياً `[External Setup — Deferred]` فقط |
| 10 | `package-lock.json` (غير موجود إطلاقاً) | يتولد تلقائي | يحتاج `npm install` مرة واحدة **من عندك، بإنترنت حقيقي** — بيئتي أنا بلا إنترنت أصلاً |

---

## 3) فجوة كود حقيقية غير مكتملة (مو بيانات — تنفيذ ناقص فعلي)

⚠️ هذي **ماشي بيانات ناقصة** — هي جزء من الكود نفسه غير مكتمل عمداً:

- **`Backend/src/auth/provider-verifiers.js` → `verifyApple()`**
  التحقق من توقيع Apple JWT (JWKS signature verification) **غير مُنفَّذ** —
  الدالة ترمي `'Apple signature verification adapter required'` دايماً حتى
  لو حطيت `jwksUrl`/`issuer`/`audience`. هذا يحتاج **كتابة كود verifier
  حقيقي** (مكتبة زي `jose` أو مكافئها) في مرحلة لاحقة — مش مجرد قيمة تتحط
  في env.

---

## 4) قيد بيئة واحد يأثر على كل شي فوق تقريباً

بيئة التنفيذ الحالية عندي (Sandbox) **بلا إنترنت نهائياً** — تأكدت هذا
مرتين (`npm install` و`curl` لأي دومين خارج القائمة المسموحة يرجعوا
403/Forbidden). هذا يعني:
- ما نقدرش نولّد `package-lock.json` حقيقي.
- ما نقدرش نثبّت `express`/`agora-token`/`pg` فعلياً هنا.
- ما نقدرش نختبر أي endpoint عبر HTTP حقيقي أو أتصل بـAgora/Postgres/SMS
  فعلياً من هذا الـ sandbox — بغض النظر عن أي بيانات تجيبها.

هذا القيد **يزول فقط لما تشغّل `npm install` بنفسك** على جهازك الحقيقي أو
على GitHub Actions — مو مشكلة كود.

---

## 5) Checklist نهائي مرتب بالأولوية باش توصل 100% Production-Ready

**أولوية 1 — بيئة (بلوكر عام):**
- [ ] `npm install` بإنترنت حقيقي (يولّد `package-lock.json` ويثبت كل الحزم)

**أولوية 2 — أسرار السيرفر (Server Secrets، تتحط أنت فقط):**
- [ ] `AGORA_APP_CERTIFICATE`
- [ ] `DATABASE_URL` حقيقي + `STAGE3_ENABLE_POSTGRES=true`
- [ ] `WALLET_INTERNAL_KEY` عشوائي حقيقي
- [ ] `LOG_DRAIN_URL`

**أولوية 3 — مزودي مصادقة خارجيين:**
- [ ] SMS provider (url/headers/template)
- [ ] Google OAuth credentials حقيقية لمشروعك
- [ ] Facebook Login credentials حقيقية لمشروعك
- [ ] Apple: credentials + **بناء verifier توقيع حقيقي** (كود، مو بيانات فقط)

**أولوية 4 — نشر/بنية تحتية:**
- [ ] حساب Cloud provider وربطه بـCI/CD للنشر الفعلي
- [ ] تشغيل `npm run migrate` بعد تفعيل Postgres

**أولوية 5 — قرارات منتج مؤجلة (موثقة أصلاً في كل `STAGE*_TODO.md`):**
- [ ] القرار النهائي لإطار عمل الموبايل (Web-PWA الحالي / React Native / Flutter)
- [ ] سكربت توليد `tokens.css` تلقائياً من `tokens/*.json`
- [ ] توحيد Validation بين Backend والـ Client (بعد إضافة Bundler لاحقاً)

---

كل بند فوق موجود أصلاً موثّق بنفس التصنيف داخل الملفات التالية لو حبيت
التفاصيل الكاملة لكل واحد: `STAGE1_TODO.md`، `Database/STAGE3_TODO.md`،
`Config/STAGE4_TODO.md`، `Authentication/STAGE5_TODO.md`،
`AGORA_VOICE_FINAL_STATUS.md`.
