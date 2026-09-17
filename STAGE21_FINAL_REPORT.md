# Stage 21 (Snakes & Ladders + Quiz) — STATUS: COMPLETE

## ملخص
تم بناء محرك قواعد حقيقي (server-side) لكل من Snakes & Ladders و Quiz فوق
الـ framework الموجود من Stage 19 (`game-match.service.js`) بدون إعادة بناء
الـ lobby/matchmaking. النرد، بنك الأسئلة، التوقيت، وتحديد الفوز/الخسارة
كلها تتحدد من السيرفر فقط — العميل لا يقدر يتحكم فيها ولا يشوفها قبل وقتها.

## الملفات الجديدة
- `Backend/src/domain/snakes-ladders.board.js` — لوح 100 خانة، سلالم/ثعابين
  ثابتة، قواعد حركة نقية (pure functions، بدون state).
- `Backend/src/services/snakes-ladders.service.js` — المحرك: النرد يترمى
  server-side (`node:crypto.randomInt`)، فرض الدور (turn)، حل السلالم/الثعابين،
  فوز حقيقي عند الوصول بالضبط للخانة 100، ينادي `finishMatch()` بنفسه.
- `Backend/src/domain/quiz-bank.js` — بنك 12 سؤال، server-only،
  `publicQuestion()` تشيل `correctIndex` قبل ما توصل للعميل.
- `Backend/src/services/quiz.service.js` — المحرك: ساعة server-side، تسجيل
  نقاط مع bonus للسرعة، تقدّم تلقائي (auto-advance) عند إجابة الكل أو انتهاء
  الوقت، فوز حقيقي (أو تعادل صادق بدون رابح مختلق) من النقاط الفعلية، ينادي
  `finishMatch()` بنفسه.

## الملفات المعدّلة
- `Backend/src/routes/platform.routes.js`:
  - Routes جديدة: `GET/POST /api/games/:matchId/board`, `/roll`,
    `GET /api/games/:matchId/quiz`, `POST /api/games/:matchId/quiz/answer`.
  - `POST /api/games/:matchId/finish`: الـ403 بقى مخصص فقط للألعاب اللي ما
    عندهاش محرك حقيقي بعد (ludo, carrom, chess, eight_ball, domino). بالنسبة
    لـ snakes_ladders و quiz، الـroute بقى **read-confirmation** فقط: يرجع
    409 حتى المحرك الحقيقي يخلص اللعبة بنفسه server-side، وما يقراش أي
    winner/result من `req.body` أبدًا (العميل ما يقدرش يفرض نتيجة).
- `Backend/src/index.js`: ربط `snakesLaddersService` و `quizService`.

## التستات
- ملفات جديدة: `snakes-ladders.board.test.js` (7)، `snakes-ladders.service.test.js` (17)،
  `quiz.service.test.js` (13)، تعديلات على `platform.games.routes-contract.test.js` (+5 صافي).
- **Stage 21 لحالها: 43/43 ✅** — تغطي: قواعد اللوح النقية، فوز حقيقي بعد
  محاكاة لعبة كاملة (بداية→نهاية) بسلسلة نرد محسوبة ومتحقق منها، دور
  اللاعبين، reconnect (state ما يضيعش)، حماية 403 لغير المشاركين، رفض اللعب
  خارج الدور، سؤال بلا إجابة صحيحة مكشوفة، bonus السرعة، تعادل صادق، تقدم
  تلقائي عند انتهاء الوقت، و/finish الجديد بكل حالاته.
- **السويت الكامل: 1573 تست / 1569 ينجحوا / 4 يفشلوا.** الـ4 فشل هوما نفس
  الفشل البيئي القديم (`Cannot find module 'express'` — ما كاينش نت
  لـnpm install فهاذ الـsandbox) في `accounts.routes.test.js`,
  `agora.routes.test.js`, `auth.routes.test.js`, `config.routes.test.js` —
  موجودين من قبل هاذ الـstage، ماشي regression جديد. Stage 19/20/22 ما
  تكسروش (ما كاين والو زادة بـStage 20 لحد الآن — هي أول محرك لعبة حقيقي
  فهاذ المشروع أصلاً).

## تبسيطات موثقة (intentional, documented)
- Snakes & Ladders: بدون "extra roll on 6"، وبدون bounce-back عند overshoot
  (overshoot = ما تتحركش، دور يضيع). موثقة فالكود نفسه.
- Quiz: 5 أسئلة لكل match افتراضيًا (قابلة للتعديل)، مدة كل سؤال 15 ثانية
  افتراضيًا، bonus السرعة خطي بسيط.
- الـstate (board/quiz) محفوظ فـMap in-memory داخل العملية — كافي لـ
  reconnect بدون فقدان الحالة طول ما السيرفر شغال، لكن ما ينجاش يعيش restart
  فعلي للسيرفر (يحتاج تخزين فـPostgres — خارج نطاق هاذ الـpass، نفس وضعية كل
  InMemory*Repository آخر فالمشروع).

## المتبقي (out of scope لهاذ الـpass)
- Ludo, Carrom, Chess, Eight Ball, Domino: مازالوا بلا محرك حقيقي — الـ403
  مازال مسلط عليهم كيف قبل.
- Persistence حقيقي للـboard/quiz state فـPostgres (بدل in-memory) إذا
  الهدف يكون البقاء عبر restart فعلي للسيرفر.
- Mobile UI لهاذوما اللعبتين (زوج) ما تلمسش فهاذ الـpass — Backend فقط.
