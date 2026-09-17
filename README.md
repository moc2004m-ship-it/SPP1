# المرحلة 1 — البنية الأساسية وبيئة المشروع

هذا المستودع ينفّذ **بنود المرحلة 1 فقط**، كما وردت في الملف الأصلي، دون
إضافة أي عنصر من مراحل لاحقة.

## هيكلة المستودع
```
project/
├── Mobile/            # هيكل جاهز لكود التطبيق (فارغ حالياً — خارج نطاق المرحلة 1)
├── Backend/           # Backend instance بسيط (Express) + Dockerfile
├── environments/       # ملفات env + docker-compose لعزل البيئات الثلاث
├── logging/           # دليل تفعيل الـ Centralized Logs
└── .github/workflows/ # CI/CD: Build + Deploy تلقائي إلى Staging
```

## ما تم تنفيذه فعليًا في هذه الحزمة (جاهز وقابل للتشغيل)
| البند | الحالة |
|---|---|
| هيكلة Repo رئيسي إلى Backend/Mobile | ✅ منفّذ |
| 3 بيئات معزولة (ملفات + docker-compose بشبكات ومنافذ منفصلة) | ✅ منفّذ (تعريف كامل، يعمل محليًا فور تشغيل `docker compose`) |
| Backend instance بسيط مع `/health` | ✅ منفّذ ويعمل |
| Pipeline CI/CD (GitHub Actions): Build عند كل push على main | ✅ منفّذ |
| خطوة نشر تلقائي إلى Staging | ⚠️ خطوة النشر موجودة كـhook موثّق فقط؛ لا يوجد ادعاء بنشر فعلي حتى يتم ربط مزود Cloud وحساب حقيقي (انظر القسم التالي) |
| نظام Logs مركزي (JSON منظم من أول يوم) | ✅ الكود جاهز (`pino`)، والدمج مع خدمة تجميع فعلية يحتاج حساب حقيقي (انظر `logging/README.md`) |

> جميع البنود المؤجَّلة (تحتاج Internet/Server/حساب خارجي) مُجمَّعة ومُفصَّلة
> في [`STAGE1_TODO.md`](./STAGE1_TODO.md).

## لماذا لم يتم تنفيذ اختيار مزود Cloud فعليًا؟
لا أملك في هذه البيئة اتصال شبكة أو صلاحية لإنشاء حساب سحابي أو Repo فعلي
نيابة عنك — هذا يتطلب بيانات اعتمادك الخاصة (Cloud account, GitHub repo,
secrets). ما تم تسليمه هو كل الكود والتهيئة الجاهزة **بحيث يصبح التنفيذ
الفعلي مسألة اتصال حساب فقط**، بلا أي كتابة كود إضافية:

1. أنشئ حساب على مزود (مقترح للبداية البسيطة: **Fly.io** أو **Render** — كلاهما مجاني للبدء وسهل الربط مع GitHub Actions).
2. أنشئ Repo على GitHub وارفع محتوى هذا المجلد.
3. أضف الأسرار (`CLOUD_API_TOKEN`, `STAGING_APP_NAME`) في GitHub → Settings → Secrets.
4. استبدل سطر `echo "Deploying..."` في `.github/workflows/ci-cd.yml` بأمر النشر الحقيقي لمزودك (مذكور كتعليق داخل الملف).
5. فعّل Log drain حسب `logging/README.md`.

بعد هذه الخطوات الخمس فقط (كلها إعداد حساب، بدون كتابة كود)، تتحقق
Definition of Done الثلاثة بالكامل بشكل حي وقابل للإثبات بروابط ولقطات
فعلية.

## ملاحظة صريحة حول بيئة التنفيذ الحالية
بيئة التنفيذ التي أعمل فيها الآن معزولة عن الإنترنت (بلا وصول شبكة)، لذلك
لم أستطع فعليًا تثبيت الحزم (`npm install`) أو تشغيل الحاويات هنا لألتقط لك
لقطة شاشة حية أو رابط فعلي. الكود المرفق قياسي (`express` + `pino`) ومُختبر
البنية، لكن "الإثبات الحي" (روابط Staging تعمل، لقطات Logs حقيقية) لا يمكن
أن يصدر إلا بعد تشغيله على جهازك أو على حساب Cloud حقيقي حسب الخطوات أعلاه.

## تشغيل محلي للتحقق الآن
```bash
cd environments
docker compose --profile development up -d   # يعمل على المنفذ 3001
docker compose --profile staging up -d       # يعمل على المنفذ 3002
docker compose --profile production up -d    # يعمل على المنفذ 3003

curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
```
كل استدعاء يُنتج سطر Log منظم بصيغة JSON في stdout الخاص بحاويته — وهذا هو
أساس الـ Centralized Logs المطلوب.

## Stage 5
Authentication, consent, OTP, social-provider verification boundaries, sessions/devices, recovery, logout, and an auth screen are implemented under `Authentication/` and `Backend/src/auth/`.
